import test from 'node:test';
import assert from 'node:assert/strict';
import { beginTransaction, readJournal, updateTransaction } from './mainnet-journal';
import { assertTransactionsEnabled, safeMainnetError } from './mainnet-safety';
const a = `eip155:0x${'1'.repeat(40)}`, b = `eip155:0x${'2'.repeat(40)}`, hash = `0x${'a'.repeat(64)}` as const;
function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }
test('pending/uncertain transaction tracking survives reload and prevents duplicate submission', () => {
  const storage = memory(); const id = beginTransaction(storage, a);
  assert.throws(() => beginTransaction(storage, a), /already in progress/);
  updateTransaction(storage, a, id, 'pending', hash);
  assert.equal(readJournal(storage, a)[0].hash, hash); assert.deepEqual(readJournal(storage, b), []);
  updateTransaction(storage, a, id, 'uncertain'); assert.throws(() => beginTransaction(storage, a), /already in progress/);
  updateTransaction(storage, a, hash, 'confirmed'); assert.doesNotThrow(() => beginTransaction(storage, a));
});
test('cancelled or reverted requests can be reviewed and explicitly retried, never automatically', () => {
  const storage = memory(); const id = beginTransaction(storage, a); updateTransaction(storage, a, id, 'cancelled');
  const next = beginTransaction(storage, a); updateTransaction(storage, a, next, 'reverted', hash);
  assert.equal(readJournal(storage, a).length, 2);
  assert.doesNotThrow(() => beginTransaction(storage, a));
});
test('unavailable tracking storage and a paused release fail before a wallet request', () => {
  assert.throws(() => beginTransaction({ getItem: () => null, setItem: () => { throw Error('quota'); } }, a), /could not be saved/);
  assert.throws(() => assertTransactionsEnabled(false), /paused/); assert.doesNotThrow(() => assertTransactionsEnabled(true));
});
test('unknown provider/SDK errors cannot leak keys, URLs or payloads through UI messages', () => {
  assert.equal(safeMainnetError(Error('private request body https://provider.invalid/?key=private')), 'The operation could not be completed. Check your wallet and connection, then try again. No automatic retry will be made.');
  assert.match(safeMainnetError({ code: 4001 }), /cancelled/);
  assert.match(safeMainnetError(Error('Wallet changed')), /Unlock/);
  assert.ok(!safeMainnetError(Error('storage recovery phrase: never echo this private fixture')).includes('private fixture'));
});
