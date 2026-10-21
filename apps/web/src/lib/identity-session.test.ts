import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivacyProfile } from '@null-protocol/sdk';
import { createIdentitySessionCache } from './identity-session';

function fixture() {
  const records = new Map<string, string>(), browserKeys = new Map<string, CryptoKey>();
  const storage = { getItem: (id: string) => records.get(id) ?? null, setItem: (id: string, value: string) => { records.set(id, value); }, removeItem: (id: string) => { records.delete(id); } };
  const keys = {
    async get(id: string, create: boolean) {
      if (!browserKeys.has(id) && create) browserKeys.set(id, await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
      return browserKeys.get(id);
    },
    async remove(id: string) { browserKeys.delete(id); },
  };
  return { records, browserKeys, storage, keys, cache: createIdentitySessionCache(() => storage, keys), reload: () => createIdentitySessionCache(() => storage, keys) };
}

test('reload restores the exact Payment ID and backup state without a password or plaintext keys', async () => {
  const f = fixture(), identity = createPrivacyProfile();
  await f.cache.save('alice', { identity, backedUp: true });
  const restored = await f.reload().load('alice');
  assert.deepEqual(restored, { identity, backedUp: true });
  const raw = [...f.records.values()][0];
  assert.ok(!raw.includes(identity.profile.stealthMetaAddress));
  assert.ok(!raw.includes(Buffer.from(identity.keys.spendPrivateKey).toString('hex')));
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['version', 'nonce', 'ciphertext']);
  assert.equal(f.browserKeys.get('alice')?.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', f.browserKeys.get('alice')!));
});

test('accounts remain isolated, including a ciphertext copied under another account', async () => {
  const f = fixture();
  await f.cache.save('alice', { identity: createPrivacyProfile(), backedUp: true });
  assert.equal(await f.cache.load('bob'), null);
  const [id, record] = [...f.records.entries()][0];
  f.records.set(id.replace('alice', 'bob'), record);
  f.browserKeys.set('bob', f.browserKeys.get('alice')!);
  await assert.rejects(f.cache.load('bob'));
});

test('tampered sessions and missing browser keys cannot silently become a new inbox', async () => {
  const f = fixture();
  await f.cache.save('alice', { identity: createPrivacyProfile(), backedUp: true });
  const [id, raw] = [...f.records.entries()][0], record = JSON.parse(raw);
  record.ciphertext = (record.ciphertext[0] === 'A' ? 'B' : 'A') + record.ciphertext.slice(1);
  f.records.set(id, JSON.stringify(record));
  await assert.rejects(f.cache.load('alice'));
  f.records.set(id, raw); f.browserKeys.clear();
  await assert.rejects(f.cache.load('alice'), /locked/);
});

test('restored replacements and backup status survive reload in save order', async () => {
  const f = fixture(), original = createPrivacyProfile(), replacement = createPrivacyProfile();
  await Promise.all([f.cache.save('alice', { identity: original, backedUp: false }), f.cache.save('alice', { identity: replacement, backedUp: true })]);
  assert.deepEqual(await f.reload().load('alice'), { identity: replacement, backedUp: true });
});

test('sign-out clears resumption and an in-flight save cannot recreate it', async () => {
  const f = fixture(), session = { identity: createPrivacyProfile(), backedUp: true };
  await f.cache.save('alice', session);
  const saving = f.cache.save('alice', session), clearing = f.cache.clear('alice');
  await Promise.allSettled([saving, clearing]);
  assert.equal(f.records.size, 0); assert.equal(f.browserKeys.size, 0);
  await assert.rejects(f.cache.save('alice', session), /ended/);
  assert.equal(await f.reload().load('alice'), null);
});

test('unavailable storage reports failure instead of claiming refresh persistence', async () => {
  const f = fixture();
  const unavailable = createIdentitySessionCache(() => { throw new Error('Storage blocked'); }, f.keys);
  await assert.rejects(unavailable.save('alice', { identity: createPrivacyProfile(), backedUp: true }), /Storage blocked/);
  await assert.rejects(unavailable.load('alice'), /Storage blocked/);
});
