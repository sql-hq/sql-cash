import { type ProfileKeys, NullError, concatBytes, equalBytes, fromHex, randomBytes, toHex, utf8, validateProfileKeys } from '@null-protocol/crypto';

const VAULT_VERSION = 1;
const ITERATIONS = 600_000;
const VAULT_AAD = utf8('null.v1.recovery|PBKDF2-SHA256|600000|AES-256-GCM');
const DATABASE_NAME = 'null-private-wallet-v1';
const STORE_NAME = 'encrypted-vaults';

interface EncryptedRecovery {
  format: 'null-recovery'; version: 1; kdf: 'PBKDF2-SHA256'; iterations: 600000;
  cipher: 'AES-256-GCM'; salt: string; nonce: string; ciphertext: string;
}

function parseEncryptedRecovery(serialized: string): EncryptedRecovery {
  if (serialized.length > 16_384) throw new NullError('NULL_RECOVERY_INVALID', 'The recovery file is too large.');
  let data: unknown; try { data = JSON.parse(serialized); } catch { throw new NullError('NULL_RECOVERY_INVALID', 'The recovery file is invalid.'); }
  if (!data || typeof data !== 'object') throw new NullError('NULL_RECOVERY_INVALID', 'The recovery file is invalid.');
  const record = data as Record<string, unknown>;
  if (record.format !== 'null-recovery' || record.version !== VAULT_VERSION || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== ITERATIONS || record.cipher !== 'AES-256-GCM' || typeof record.salt !== 'string' || typeof record.nonce !== 'string' || typeof record.ciphertext !== 'string') throw new NullError('NULL_RECOVERY_INVALID', 'The recovery file format is unsupported.');
  fromHex(record.salt, 32); fromHex(record.nonce, 12); fromHex(record.ciphertext, 85);
  return record as unknown as EncryptedRecovery;
}

async function passwordKey(password: string, salt: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new NullError('NULL_PASSWORD_INVALID', 'Use a password containing 12 to 1,024 characters.');
  const passwordBytes = utf8(password);
  try {
    const baseKey = await crypto.subtle.importKey('raw', new Uint8Array(passwordBytes), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: new Uint8Array(salt) }, baseKey, { name: 'AES-GCM', length: 256 }, false, [usage]);
  } finally { passwordBytes.fill(0); }
}

/** CLIENT ONLY: encrypted recovery contains the base keys needed for chain-history recovery. */
export async function encryptRecovery(keys: ProfileKeys, password: string): Promise<string> {
  validateProfileKeys(keys);
  const salt = randomBytes(32); const nonce = randomBytes(12);
  const key = await passwordKey(password, salt, 'encrypt');
  const plain = concatBytes(utf8('NULL'), new Uint8Array([1]), keys.spendPrivateKey, keys.viewPrivateKey);
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(VAULT_AAD), tagLength: 128 }, key, new Uint8Array(plain)));
    const record: EncryptedRecovery = { format: 'null-recovery', version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, cipher: 'AES-256-GCM', salt: toHex(salt), nonce: toHex(nonce), ciphertext: toHex(ciphertext) };
    return JSON.stringify(record, null, 2);
  } finally { plain.fill(0); }
}

/** CLIENT ONLY. Password failures and modified ciphertext intentionally use the same error. */
export async function decryptRecovery(serialized: string, password: string): Promise<ProfileKeys> {
  const record = parseEncryptedRecovery(serialized);
  const key = await passwordKey(password, fromHex(record.salt, 32), 'decrypt');
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromHex(record.nonce, 12)), additionalData: new Uint8Array(VAULT_AAD), tagLength: 128 }, key, new Uint8Array(fromHex(record.ciphertext, 85))));
  } catch { throw new NullError('NULL_RECOVERY_UNLOCK_FAILED', 'Unable to unlock. Check the password and recovery file.'); }
  try {
    if (plaintext.length !== 69 || !equalBytes(plaintext.slice(0, 4), utf8('NULL')) || plaintext[4] !== 1) throw new NullError('NULL_RECOVERY_INVALID', 'The decrypted recovery record is invalid.');
    const keys = { spendPrivateKey: plaintext.slice(5, 37), viewPrivateKey: plaintext.slice(37, 69) };
    validateProfileKeys(keys); return keys;
  } finally { plaintext.fill(0); }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new NullError('NULL_STORAGE_UNAVAILABLE', 'Encrypted browser storage is unavailable. Download a recovery file.');
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'Encrypted browser storage could not be opened.'));
    request.onblocked = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'Close other NULL tabs and retry encrypted storage.'));
  });
}
function validateVaultId(id: string): void { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new NullError('NULL_STORAGE_INVALID', 'Invalid local vault identifier.'); }

/** Only authenticated encrypted recovery records are accepted; plaintext keys cannot be persisted here. */
export async function saveVault(encryptedRecovery: string, id = 'default'): Promise<void> {
  validateVaultId(id); parseEncryptedRecovery(encryptedRecovery); const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(encryptedRecovery, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'The encrypted vault could not be saved.'));
    });
  } finally { database.close(); }
}
export async function loadVault(id = 'default'): Promise<string | null> {
  validateVaultId(id); const database = await openDatabase();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => { if (request.result === undefined) resolve(null); else if (typeof request.result === 'string') resolve(request.result); else reject(new NullError('NULL_STORAGE_INVALID', 'The local vault record is invalid.')); };
      request.onerror = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'The encrypted vault could not be read.'));
    });
  } finally { database.close(); }
}
export async function clearVault(id = 'default'): Promise<void> {
  validateVaultId(id); const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite'); transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new NullError('NULL_STORAGE_UNAVAILABLE', 'The encrypted vault could not be removed.'));
    });
  } finally { database.close(); }
}
/** Best effort only: JavaScript and browser garbage collectors cannot guarantee memory zeroization. */
export function clearProfileKeys(keys: ProfileKeys): void { keys.spendPrivateKey.fill(0); keys.viewPrivateKey.fill(0); }
