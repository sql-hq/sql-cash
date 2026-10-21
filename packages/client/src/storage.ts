import { NullError, assertAmount, assertField, authPolicyCommitment, fieldFromHex, fromHex, randomBytes, toHex, utf8, validateContext, type AuthPolicyOpening } from '@null-protocol/sdk';
import type { SecretCheckpoint } from './types';

interface EncryptedRecord { version: 1; salt: string; nonce: string; ciphertext: string }
type PrivateRecord = { type: 'checkpoint'; value: SecretCheckpoint } | { type: 'policy'; value: AuthPolicyOpening };
const ITERATIONS = 600_000;
const DB_NAME = 'null-live-recovery-v1';
const STORE = 'encrypted-records';
const codec = {
  stringify: (value: unknown) => JSON.stringify(value, (_key, data: unknown) => typeof data === 'bigint' ? { $bigint: data.toString() } : data),
  parse: (value: string): unknown => JSON.parse(value, (_key, data: unknown) => {
    if (data && typeof data === 'object' && Object.keys(data).length === 1 && '$bigint' in data && typeof data.$bigint === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(data.$bigint)) return BigInt(data.$bigint);
    return data;
  }),
};

async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new NullError('NULL_STORAGE_UNAVAILABLE', 'Encrypted browser storage is required for live treasury notes.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'The local encrypted recovery store could not be opened.'));
  });
}
function validateRecord(value: unknown): asserts value is PrivateRecord {
  if (!value || typeof value !== 'object' || !('type' in value) || !('value' in value) || !value.value || typeof value.value !== 'object') throw new NullError('NULL_RECOVERY_INVALID', 'Invalid encrypted recovery content.');
  if (value.type === 'policy') { authPolicyCommitment(value.value as AuthPolicyOpening); return; }
  if (value.type !== 'checkpoint') throw new NullError('NULL_RECOVERY_INVALID', 'Unknown recovery record type.');
  const checkpoint = value.value as SecretCheckpoint;
  if ((checkpoint.kind !== 'treasury' && checkpoint.kind !== 'private-note') || (checkpoint.phase !== 'prepared' && checkpoint.phase !== 'confirmed')) throw new NullError('NULL_RECOVERY_INVALID', 'Invalid recovery checkpoint.');
  validateContext(checkpoint.context); fieldFromHex(checkpoint.bodyCommitment); assertAmount(checkpoint.amountAtomic, checkpoint.kind === 'treasury');
  if (assertField(checkpoint.ownerNullifierKey) === 0n || assertField(checkpoint.noteSecret) === 0n) throw new NullError('NULL_RECOVERY_INVALID', 'Invalid note recovery secrets.');
  if (checkpoint.kind === 'treasury') fieldFromHex(checkpoint.policyCommitment!); else fieldFromHex(checkpoint.claimNullifier!);
  if (checkpoint.phase === 'confirmed') {
    fieldFromHex(checkpoint.commitment!); fromHex(checkpoint.transactionHash!, 32);
    if (!Number.isInteger(checkpoint.leafIndex) || checkpoint.leafIndex! < 0 || checkpoint.leafIndex! >= 2 ** 20) throw new NullError('NULL_RECOVERY_INVALID', 'Invalid confirmed note index.');
  }
}

/** Passwords stay in the caller's memory. Only AES-GCM ciphertext is written to IndexedDB. */
export function createEncryptedCheckpointStore(options: { namespace: string; getPassword: () => Promise<string> }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(options.namespace)) throw new NullError('NULL_STORAGE_INVALID', 'Choose a simple local wallet namespace.');
  const aad = utf8(`null.v1.live-recovery|PBKDF2-SHA256|600000|AES256-GCM|${options.namespace}`);
  const recordPrefix = `${options.namespace}:`;
  async function key(salt: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
    const password = await options.getPassword();
    if (password.length < 12 || password.length > 1024) throw new NullError('NULL_PASSWORD_INVALID', 'Use a recovery password of at least twelve characters.');
    const bytes = utf8(password);
    try {
      const base = await crypto.subtle.importKey('raw', new Uint8Array(bytes), 'PBKDF2', false, ['deriveKey']);
      return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: new Uint8Array(salt) }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
    } finally { bytes.fill(0); }
  }
  async function encrypt(record: PrivateRecord): Promise<EncryptedRecord> {
    validateRecord(record); const salt = randomBytes(32); const nonce = randomBytes(12); const cryptoKey = await key(salt, 'encrypt');
    const plaintext = utf8(codec.stringify(record));
    try {
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(aad), tagLength: 128 }, cryptoKey, new Uint8Array(plaintext)));
      return { version: 1, salt: toHex(salt), nonce: toHex(nonce), ciphertext: toHex(ciphertext) };
    } finally { plaintext.fill(0); }
  }
  async function decrypt(record: EncryptedRecord): Promise<PrivateRecord> {
    if (record.version !== 1 || typeof record.ciphertext !== 'string' || record.ciphertext.length > 64_000) throw new NullError('NULL_RECOVERY_INVALID', 'Unsupported encrypted recovery record.');
    const cryptoKey = await key(fromHex(record.salt, 32), 'decrypt'); let plaintext: Uint8Array;
    try { plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromHex(record.nonce, 12)), additionalData: new Uint8Array(aad), tagLength: 128 }, cryptoKey, new Uint8Array(fromHex(record.ciphertext)))); }
    catch { throw new NullError('NULL_RECOVERY_UNLOCK_FAILED', 'The password or encrypted recovery record is incorrect.'); }
    try { const parsed = codec.parse(new TextDecoder().decode(plaintext)); validateRecord(parsed); return parsed; }
    finally { plaintext.fill(0); }
  }
  async function save(id: string, value: PrivateRecord): Promise<void> {
    const encrypted = await encrypt(value); const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).put(encrypted, `${recordPrefix}${id}`);
        transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'Encrypted recovery could not be persisted.'));
      });
    } finally { db.close(); }
  }
  async function readEncrypted(): Promise<{ id: string; value: EncryptedRecord }[]> {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const values: { id: string; value: EncryptedRecord }[] = [];
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(IDBKeyRange.bound(recordPrefix, `${recordPrefix}\uffff`));
        request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(values); return; } values.push({ id: String(cursor.key).slice(recordPrefix.length), value: cursor.value as EncryptedRecord }); cursor.continue(); };
        request.onerror = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'Encrypted recovery could not be loaded.'));
      });
    } finally { db.close(); }
  }
  return {
    persistLocalSecret: async (checkpoint: SecretCheckpoint): Promise<void> => save(`note:${checkpoint.bodyCommitment}`, { type: 'checkpoint', value: checkpoint }),
    persistLocalPolicy: async (opening: AuthPolicyOpening): Promise<void> => save(`policy:${authPolicyCommitment(opening)}`, { type: 'policy', value: opening }),
    async load(): Promise<{ checkpoints: SecretCheckpoint[]; policies: AuthPolicyOpening[] }> {
      const checkpoints: SecretCheckpoint[] = []; const policies: AuthPolicyOpening[] = [];
      for (const entry of await readEncrypted()) { const value = await decrypt(entry.value); if (value.type === 'checkpoint') checkpoints.push(value.value); else policies.push(value.value); }
      return { checkpoints, policies };
    },
    /** The exported file contains ciphertext only and still requires the original password. */
    async exportEncrypted(): Promise<string> { return JSON.stringify({ format: 'null-live-recovery', version: 1, namespace: options.namespace, entries: await readEncrypted() }, null, 2); },
    async importEncrypted(serialized: string): Promise<void> {
      if (serialized.length > 2_000_000) throw new NullError('NULL_RECOVERY_INVALID', 'The recovery archive is too large.');
      let archive: unknown; try { archive = JSON.parse(serialized); } catch { throw new NullError('NULL_RECOVERY_INVALID', 'Invalid recovery archive.'); }
      const value = archive as { format?: unknown; version?: unknown; namespace?: unknown; entries?: { id: unknown; value: EncryptedRecord }[] };
      if (value.format !== 'null-live-recovery' || value.version !== 1 || value.namespace !== options.namespace || !Array.isArray(value.entries) || value.entries.length > 1_000) throw new NullError('NULL_RECOVERY_INVALID', 'This archive belongs to a different wallet namespace or format.');
      // Authenticate every entry before committing anything to the database.
      for (const entry of value.entries) {
        if (typeof entry.id !== 'string' || !/^(note|policy):0x[0-9a-f]{64}$/.test(entry.id)) throw new NullError('NULL_RECOVERY_INVALID', 'Invalid archive record identifier.');
        const record = await decrypt(entry.value);
        const expected = record.type === 'checkpoint' ? `note:${record.value.bodyCommitment}` : `policy:${authPolicyCommitment(record.value)}`;
        if (entry.id !== expected) throw new NullError('NULL_RECOVERY_INVALID', 'Recovery identifier does not match its authenticated contents.');
      }
      const db = await database();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
          for (const entry of value.entries!) store.put(entry.value, `${recordPrefix}${entry.id}`);
          transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'The encrypted recovery archive could not be saved.'));
        });
      } finally { db.close(); }
    },
  };
}
