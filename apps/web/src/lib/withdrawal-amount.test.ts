import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnedPrivateNote } from '@null-protocol/client';
import { withdrawalAmountState, replaceWithdrawnNote } from './withdrawal-amount';
const note = (id: number, amountAtomic: bigint) => ({ commitment: `0x${id.toString(16).padStart(64, '0')}`, amountAtomic }) as OwnedPrivateNote;
test('withdraw an explicit amount across notes and retain the exact remainder', () => {
  const state = withdrawalAmountState([note(1, 600_000n), note(2, 700_000n)], '0.9');
  assert.equal(state.error, undefined); assert.equal(state.amount, 900_000n); assert.equal(state.remainder, 400_000n);
  assert.deepEqual(state.steps.map(step => step.amountAtomic), [700_000n, 200_000n]);
});
test('blank, zero, negative, over-balance and excessive precision never become a full exit', () => {
  for (const input of ['', ' ', '0', '-1', '1.000001', '0.0000001', '1e-6', 'abc']) {
    const state = withdrawalAmountState([note(1, 1_000_000n)], input);
    assert.ok(state.error, input); assert.equal(state.steps.length, 0, input);
  }
  assert.equal(withdrawalAmountState([note(1, 1_000_000n)], '0.000001').amount, 1n);
  assert.equal(withdrawalAmountState([note(1, 1_000_000n)], '1').remainder, 0n);
});
test('a partial withdrawal replaces the source; reconciliation is idempotent and unrelated notes survive', () => {
  const source={commitment:'0xAb',amount:1_000_000n},other={commitment:'0xCd',amount:500_000n},change={commitment:'0xEf',amount:750_000n};
  const updated=replaceWithdrawnNote([source,other],'0xab',change);
  assert.deepEqual(updated,[other,change]); assert.deepEqual(replaceWithdrawnNote(updated,'0xAB',change),updated);
  assert.deepEqual(replaceWithdrawnNote(updated,'0xef'),[other]);
});
