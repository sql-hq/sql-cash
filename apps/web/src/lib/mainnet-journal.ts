export type JournalEntry = { id: string; createdAt: string; status: 'awaiting_wallet' | 'pending' | 'uncertain' | 'confirmed' | 'reverted' | 'cancelled'; hash?: `0x${string}` };
const statuses = new Set(['awaiting_wallet', 'pending', 'uncertain', 'confirmed', 'reverted', 'cancelled']);
const listeners = new Set<() => void>();
let version = 0;
export const journalVersion = () => version;
export const subscribeJournal = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const notifyJournal = () => { version++; listeners.forEach(fn => fn()); };
const name = (owner: string) => {
  if (!/^eip155:0x[0-9a-f]{40}$/.test(owner)) throw new Error('Connect the selected wallet first.');
  return `sql-mainnet-activity:${owner}`;
};
export function readJournal(storage: Pick<Storage, 'getItem'>, owner: string): JournalEntry[] {
  try {
    const raw = storage.getItem(name(owner));
    if (!raw) return [];
    const items: JournalEntry[] = JSON.parse(raw);
    if (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item.id !== 'string' || !statuses.has(item.status) || !Number.isFinite(Date.parse(item.createdAt)) ||
      (item.hash !== undefined && !/^0x[0-9a-f]{64}$/i.test(item.hash)))) throw Error();
    return items;
  } catch { throw new Error('Transaction activity storage is unavailable or damaged. Check wallet activity before submitting another transaction.'); }
}
function write(storage: Pick<Storage, 'getItem' | 'setItem'>, owner: string, entries: JournalEntry[]) {
  try {
    const raw = JSON.stringify(entries);
    storage.setItem(name(owner), raw);
    if (storage.getItem(name(owner)) !== raw) throw Error();
  } catch { throw new Error('Transaction activity could not be saved. No new transaction will be requested.'); }
  notifyJournal();
}
export function beginTransaction(storage: Pick<Storage, 'getItem' | 'setItem'>, owner: string) {
  const entries = readJournal(storage, owner);
  if (entries.some(entry => ['awaiting_wallet', 'pending', 'uncertain'].includes(entry.status))) throw new Error('A transaction is already in progress. Check recent activity before sending again.');
  const entry: JournalEntry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'awaiting_wallet' };
  write(storage, owner, [entry, ...entries].slice(0, 50)); return entry.id;
}
export function updateTransaction(storage: Pick<Storage, 'getItem' | 'setItem'>, owner: string, id: string, status: JournalEntry['status'], hash?: `0x${string}`) {
  const entries = readJournal(storage, owner);
  const target = entries.find(entry => entry.id === id || entry.hash === id);
  if (!target) throw new Error('Transaction activity could not be found. Check your wallet before sending again.');
  if (hash && !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('The wallet returned an invalid transaction hash. Check wallet activity before sending again.');
  target.status = status; if (hash) target.hash = hash;
  write(storage, owner, entries);
}
