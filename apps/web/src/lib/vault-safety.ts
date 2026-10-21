import type { VaultRecord } from '@silentquery/railgun/engine';

const listeners = new Set<() => void>();
const lockListeners = new Set<(walletId: string) => void>();
let cleanupFailed = false;
let owner: string | null = null, generation = 0;
let unlocked: { owner: string; record: VaultRecord; key: string } | null = null;
const notify = () => { generation++; listeners.forEach(fn => fn()); };
export const vaultVersion = () => generation;
export const subscribeVault = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const subscribeVaultLock = (fn: (walletId: string) => void) => { lockListeners.add(fn); return () => { lockListeners.delete(fn); }; };
export const vaultCleanupError = () => cleanupFailed ? 'Vault memory cleanup could not complete. Reload this tab before unlocking again.' : '';
function clearUnlock() {
  const previous = unlocked; unlocked = null;
  if (previous) lockListeners.forEach(fn => { try { fn(previous.record.walletId); } catch { cleanupFailed = true; } });
}
export function activateVaultOwner(next: string | null) {
  if (owner !== next) { owner = next; clearUnlock(); notify(); }
}
export function lockPrivateVault() { clearUnlock(); notify(); }
export function vaultContext(expected: string) {
  const version = generation;
  return () => {
    if (cleanupFailed) throw new Error(vaultCleanupError());
    if (owner !== expected || generation !== version) throw new Error('Your wallet or vault changed. Unlock the selected vault and try again.');
  };
}
export function currentVaultSession(expected: string) { return owner === expected && unlocked?.owner === expected ? unlocked : null; }
export function unlockPrivateVault(expected: string, record: VaultRecord, key: string) {
  if (cleanupFailed) throw new Error(vaultCleanupError());
  if (owner !== expected) throw new Error('Your wallet changed. Connect the selected account again.');
  unlocked = { owner: expected, record, key }; notify();
}
export const vaultStorageKey = (id: string) => {
  if (!/^eip155:0x[0-9a-f]{40}$/.test(id)) throw new Error('Connect a valid wallet before opening a vault.');
  return `sql-railgun-vault:${id}`;
};
export function validateVaultRecord(value: unknown): VaultRecord {
  const r = value as VaultRecord;
  if (!r || typeof r.walletId !== 'string' || r.walletId.length > 256 || !/^[0-9a-z_-]+$/i.test(r.walletId) ||
    typeof r.railgunAddress !== 'string' || !/^0zk1[0-9a-z]{50,250}$/i.test(r.railgunAddress) ||
    typeof r.salt !== 'string' || !/^0x[0-9a-f]{32}$/i.test(r.salt) ||
    !Number.isSafeInteger(r.createdAt) || r.createdAt < 0) throw new Error('Saved vault metadata is damaged. Restore from your backup; the original data has not been changed.');
  return { walletId: r.walletId, railgunAddress: r.railgunAddress, salt: r.salt, createdAt: r.createdAt };
}
export function readVault(storage: Pick<Storage, 'getItem'>, id: string): VaultRecord | null {
  let raw: string | null;
  try { raw = storage.getItem(vaultStorageKey(id)); }
  catch { throw new Error('Browser storage is unavailable. Enable storage before opening a vault.'); }
  if (raw === null) return null;
  try { return validateVaultRecord(JSON.parse(raw)); }
  catch { throw new Error('Saved vault metadata is damaged. Restore from your backup; the original data has not been changed.'); }
}
export function writeVault(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, id: string, record: VaultRecord | null) {
  const name = vaultStorageKey(id);
  try {
    if (record) {
      const raw = JSON.stringify(validateVaultRecord(record));
      storage.setItem(name, raw);
      if (storage.getItem(name) !== raw) throw Error();
    } else storage.removeItem(name);
  } catch { throw new Error('The vault could not be saved in this browser. Keep your recovery backup and enable browser storage before continuing.'); }
}
