import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConfirmedOperation, NullLiveClient, OwnedPrivateNote, PreparedOperation, WithdrawalOptions } from '@null-protocol/client';
import { planWithdrawal, WithdrawalJob } from './withdrawals';
import { NullError } from '@null-protocol/sdk';
import { confirmedNoPayment } from './internal';
import { SubmissionUncertainError } from '@null-protocol/client';

const hex = (id: number) => `0x${id.toString(16).padStart(64, '0')}` as const;
const note = (id: number, amountAtomic: bigint) => ({ commitment: hex(id), amountAtomic }) as OwnedPrivateNote;
test('known pre-broadcast rejection permits fresh preparation while uncertainty remains blocked', async () => {
  for (const code of ['NULL_WALLET_REJECTED', 'NULL_GAS_LIMIT', 'NULL_INTENT_EXPIRED', 'NULL_TRANSACTION_REVERTED']) assert.equal(confirmedNoPayment(new NullError(code, 'Test')), true);
  assert.equal(confirmedNoPayment(new SubmissionUncertainError({} as never)), false);
  assert.equal(confirmedNoPayment(new Error('Timeout')), false);
  let attempts = 0;
  const client = { prepareWithdrawal: async () => ({} as PreparedOperation), submit: async () => {
    if (++attempts === 1) throw new NullError('NULL_WALLET_REJECTED', 'User declined');
    return { transactionHash: hex(1), localRecoverySaved: true } as ConfirmedOperation;
  } } as unknown as NullLiveClient;
  const job = new WithdrawalJob(client, [note(1, 200_000n)], 100_000n, '0x1111111111111111111111111111111111111111');
  const options = { transport: { mode: 'relay' as const, url: 'https://example.com' }, acknowledgePublicWithdrawal: true as const, beforeSubmit: async () => {}, onConfirmed: async () => {} };
  await assert.rejects(job.send(options), /declined/);
  assert.equal(job.requiresReconciliation, false);
  assert.equal((await job.send(options)).length, 1);
});
test('withdrawal planning covers any amount within the private balance with exact change', () => {
  const notes = [note(1, 200_000n), note(2, 300_000n), note(3, 100_000n)];
  const plan = planWithdrawal(notes, 450_000n);
  assert.deepEqual(plan.map(step => [step.note.amountAtomic, step.amountAtomic]), [[300_000n, 300_000n], [200_000n, 150_000n]]);
  assert.equal(planWithdrawal(notes, 100_000n).length, 1);
  assert.equal(planWithdrawal(notes, 600_000n).length, 3);
  plan[0]!.note.amountAtomic = 1n;
  assert.equal(notes[1]!.amountAtomic, 300_000n);
  for (const amount of [0n, -1n, 600_001n]) assert.throws(() => planWithdrawal(notes, amount));
  assert.throws(() => planWithdrawal([notes[0]!, notes[0]!], 1n), /distinct/);
});
test('a withdrawal job saves each confirmed transfer and never repeats an uncertain transfer', async () => {
  let sends = 0; const preparedAmounts: bigint[] = []; const approved: number[] = []; const completed: number[] = [];
  const result = (id: number) => ({ transactionHash: hex(id), localRecoverySaved: true }) as ConfirmedOperation;
  let reconciled = false;
  const client = {
    prepareWithdrawal: async (options: WithdrawalOptions) => { preparedAmounts.push(options.amountAtomic!); return {} as PreparedOperation; },
    submit: async () => { if (++sends === 2) throw new Error('Unknown network result'); return result(sends); },
    reconcile: async () => reconciled ? { status: 'confirmed', result: result(2) } : { status: 'not-observed', explanation: 'No evidence yet' },
  } as unknown as NullLiveClient;
  const job = new WithdrawalJob(client, [note(1, 200_000n), note(2, 300_000n)], 400_000n, '0x1111111111111111111111111111111111111111');
  const options = { transport: { mode: 'sponsored' as const, send: async () => hex(1) }, acknowledgePublicWithdrawal: true as const,
    beforeSubmit: async (_operation: PreparedOperation, index: number) => { approved.push(index); },
    onConfirmed: async (_result: ConfirmedOperation, index: number) => { completed.push(index); },
  };
  await assert.rejects(job.send(options), /Unknown/);
  assert.deepEqual(preparedAmounts, [300_000n, 100_000n]);
  assert.deepEqual(approved, [0, 1]); assert.deepEqual(completed, [0]);
  assert.equal(job.completedTransactions, 1); assert.equal(job.requiresReconciliation, true);
  assert.equal((await job.reconcile()).status, 'not-observed');
  await assert.rejects(job.send(options), /reconciliation/);
  assert.equal(sends, 2);
  reconciled = true; await job.reconcile();
  assert.equal((await job.send(options)).length, 2); assert.equal(sends, 2);
  assert.throws(() => JSON.stringify(job), /private notes/);
});
