import test from 'node:test';
import assert from 'node:assert/strict';
import { activateVaultOwner, currentVaultSession, lockPrivateVault, readVault, unlockPrivateVault, vaultContext, vaultStorageKey, writeVault, subscribeVaultLock } from './vault-safety';
const a = `eip155:0x${'1'.repeat(40)}`, b = `eip155:0x${'2'.repeat(40)}`;
const record = { walletId: 'test-wallet-id', railgunAddress: `0zk1${'q'.repeat(100)}`, salt: `0x${'1'.repeat(32)}`, createdAt: 123 };
function memory() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); }, map };
}
test('each connected wallet has isolated metadata; switching and disconnecting erase only in-memory unlock state', () => {
  const storage = memory(); activateVaultOwner(a); writeVault(storage, a, record); unlockPrivateVault(a, record, 'test-in-memory-key');
  const guard = vaultContext(a);
  assert.equal(currentVaultSession(a)?.record.walletId, record.walletId);
  activateVaultOwner(b); assert.equal(currentVaultSession(a), null); assert.equal(currentVaultSession(b), null);
  assert.equal(readVault(storage, b), null); assert.deepEqual(readVault(storage, a), record); assert.throws(guard, /changed/);
  activateVaultOwner(null); assert.deepEqual(readVault(storage, a), record);
  activateVaultOwner(a); assert.equal(currentVaultSession(a), null);
});
test('manual/idle lock invalidates already-started work and cannot unlock another wallet', () => {
  activateVaultOwner(a); unlockPrivateVault(a, record, 'test-key'); const guard = vaultContext(a);
  const unloaded: string[] = []; const off = subscribeVaultLock(id => unloaded.push(id));
  lockPrivateVault(); assert.throws(guard, /changed/); assert.equal(currentVaultSession(a), null);
  assert.deepEqual(unloaded, [record.walletId]); off();
  assert.throws(() => unlockPrivateVault(b, record, 'test-key'), /changed/);
});
test('corrupt or inaccessible storage is explicit, not silently treated as a new vault', () => {
  const storage = memory(); storage.map.set(vaultStorageKey(a), '{broken');
  assert.throws(() => readVault(storage, a), /damaged/);
  assert.equal(storage.map.get(vaultStorageKey(a)), '{broken');
  assert.throws(() => readVault({ getItem() { throw Error('denied'); } }, a), /unavailable/);
  assert.throws(() => writeVault({ ...storage, setItem() { throw Error('quota'); } }, a, record), /could not be saved/);
  assert.throws(() => writeVault({ ...storage, setItem() {} }, a, record), /could not be saved/);
});
test('metadata contains no password/key, and removing one wallet never removes another or the legacy record', () => {
  const storage = memory(); storage.map.set('sql-railgun-vault', 'legacy');
  writeVault(storage, a, { ...record, password: 'must-not-persist', key: 'must-not-persist' } as typeof record);
  writeVault(storage, b, record);
  assert.ok(!storage.getItem(vaultStorageKey(a))!.includes('must-not-persist'));
  writeVault(storage, a, null);
  assert.equal(readVault(storage, a), null); assert.deepEqual(readVault(storage, b), record);
  assert.equal(storage.getItem('sql-railgun-vault'), 'legacy');
});
