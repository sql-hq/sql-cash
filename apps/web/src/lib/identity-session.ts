import { profileFromKeys, type ProfileKeys } from '@null-protocol/sdk';

export type IdentitySession = { identity: { keys: ProfileKeys; profile: ReturnType<typeof profileFromKeys> }; backedUp: boolean };
type KeyStore = { get: (userId: string, create: boolean) => Promise<CryptoKey | undefined>; remove: (userId: string) => Promise<void> };
const storageKey = (userId: string) => `null:inbox-session:v1:${encodeURIComponent(userId)}`;

async function withKeys<T>(work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('null-inbox-sessions-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { failed = true; reject(new Error('Browser session storage is unavailable.')); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      let value: T;
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () => reject(new Error('Browser session storage is unavailable.'));
      work(transaction.objectStore('keys'), result => { value = result; });
    });
  } finally { database.close(); }
}

const browserKeys: KeyStore = {
  async get(userId, create) {
    const existing = await withKeys<CryptoKey | undefined>((store, result) => {
      const request = store.get(userId); request.onsuccess = () => result(request.result);
    });
    if (existing || !create) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // Two tabs can initialize together. Read and insert in one transaction.
    return withKeys<CryptoKey>((store, result) => {
      const request = store.get(userId);
      request.onsuccess = () => { if (!request.result) store.put(key, userId); result(request.result ?? key); };
    });
  },
  remove: userId => withKeys<void>((store, result) => { store.delete(userId); result(undefined); }),
};

/** Refresh continuity only: ciphertext lives in this tab's session storage; its
 * non-exportable browser key is separate in IndexedDB. No backup password is
 * stored. This is not protection against compromised same-origin JavaScript and
 * does not replace a password-protected recovery file. ENS is verified afresh. */
export function createIdentitySessionCache(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, keys: KeyStore) {
  const queues = new Map<string, Promise<unknown>>();
  const signedOut = new Set<string>();
  function enqueue<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(userId) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(userId, next);
    // Do not retain a fulfilled load promise containing decrypted identity keys.
    const release = () => { if (queues.get(userId) === next) queues.delete(userId); };
    void next.then(release, release);
    return next;
  }
  return {
    load(userId: string): Promise<IdentitySession | null> {
      signedOut.delete(userId);
      return enqueue(userId, async () => {
        const raw = storage().getItem(storageKey(userId));
        if (!raw) return null;
        if (raw.length > 2048) throw new Error('Invalid inbox session.');
        const record = JSON.parse(raw);
        if (record.version !== 1 || typeof record.nonce !== 'string' || typeof record.ciphertext !== 'string') throw new Error('Invalid inbox session.');
        const nonce = Uint8Array.from(atob(record.nonce), c => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(record.ciphertext), c => c.charCodeAt(0));
        const key = await keys.get(userId, false);
        if (!key || key.extractable || nonce.length !== 12 || ciphertext.length !== 82) throw new Error('Inbox session is locked.');
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(storageKey(userId)) }, key, ciphertext));
        try {
          if (plain.length !== 66 || plain[0] !== 1 || plain[1] > 1) throw new Error('Invalid inbox session.');
          const restored = { spendPrivateKey: plain.slice(2, 34), viewPrivateKey: plain.slice(34) };
          return { identity: { keys: restored, profile: profileFromKeys(restored) }, backedUp: plain[1] === 1 };
        } finally { plain.fill(0); }
      });
    },
    save(userId: string, session: IdentitySession): Promise<void> {
      return enqueue(userId, async () => {
        if (signedOut.has(userId)) throw new Error('The inbox session has ended.');
        profileFromKeys(session.identity.keys);
        const key = await keys.get(userId, true);
        if (!key || key.extractable) throw new Error('Browser session storage is unavailable.');
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const plain = new Uint8Array(66);
        plain.set([1, session.backedUp ? 1 : 0]);
        plain.set(session.identity.keys.spendPrivateKey, 2); plain.set(session.identity.keys.viewPrivateKey, 34);
        try {
          const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(storageKey(userId)) }, key, plain));
          if (signedOut.has(userId)) throw new Error('The inbox session has ended.');
          storage().setItem(storageKey(userId), JSON.stringify({ version: 1, nonce: btoa(String.fromCharCode(...nonce)), ciphertext: btoa(String.fromCharCode(...ciphertext)) }));
        } finally { plain.fill(0); }
      });
    },
    clear(userId: string): Promise<void> {
      signedOut.add(userId);
      return enqueue(userId, async () => {
        // Remove both pieces; either removal makes this tab unable to resume.
        const removed = await Promise.allSettled([
          Promise.resolve().then(() => storage().removeItem(storageKey(userId))), keys.remove(userId),
        ]);
        if (removed.every(result => result.status === 'rejected')) throw new Error('Could not clear the inbox session.');
      });
    },
  };
}

export const identitySession = createIdentitySessionCache(() => sessionStorage, browserKeys);
