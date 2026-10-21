import test from 'node:test';
import assert from 'node:assert/strict';
import { sepolia } from 'viem/chains';
import { zeroAddress, type PublicClient } from 'viem';
import { bigintToBytes, compileDistribution, profileFromKeys, type AuthPolicyOpening } from '@null-protocol/sdk';
import { ENS_V2 } from '@null-protocol/ens';
import type { DistributionOptions, PreparedOperation, ConfirmedOperation } from '@null-protocol/client';
import { PayoutDraft, preparePayout, resolvePayoutRecipients } from './index';
import { PayoutClient } from './client';
import { PayoutJob, partitionPayoutRecipients, resolvePayoutJobRecipients } from './jobs';

const context = { chainId: 11155111n, poolAddress: '0x1111111111111111111111111111111111111111' as const };
const profile = (key: bigint) => profileFromKeys({ spendPrivateKey: bigintToBytes(key), viewPrivateKey: bigintToBytes(key + 1n) }).stealthMetaAddress;
function fixture() {
  const state = { profile: profile(1n), implementation: ENS_V2.resolverImplementation as string, owner: context.poolAddress as string };
  const ens = {
    chain: sepolia, getChainId: async () => 11155111, getBlockNumber: async () => 123n,
    getEnsResolver: async () => context.poolAddress, getEnsText: async () => state.profile,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'findOwner') return state.owner;
      if (functionName === 'findParentRegistry') return zeroAddress;
      if (functionName === 'verifyContract') return state.implementation;
      throw new Error(`Unexpected read: ${functionName}`);
    },
  } as unknown as PublicClient;
  const recipients = () => resolvePayoutRecipients(ens, [{ reference: 'private-reference', amount: '0.01', name: 'ALICE.ETH' }]);
  const draft = async () => preparePayout({ ens, context, recipients: await recipients() });
  return { state, ens, recipients, draft };
}
function transport() {
  const calls = { prepare: 0, submit: 0, reconcile: 0 };
  const operation = { publicOperation: { method: 'createDistribution' } } as PreparedOperation;
  const live = {
    context,
    prepareDistribution: async (options: DistributionOptions) => {
      calls.prepare++;
      await options.authorize({ context, digest: '0x01', publicInputs: [], commitment: options.compiled.commitment, envelopeRoot: options.compiled.envelopeRoot });
      return operation;
    },
    submit: async () => { calls.submit++; return {} as ConfirmedOperation; },
    reconcile: async () => { calls.reconcile++; return { status: 'not-observed' as const, explanation: 'Test double: no transaction' }; },
  };
  return { calls, operation, live };
}
const approval = () => ({ compilation: { mode: 'local' as const }, treasuryNotes: [], authPolicy: {} as AuthPolicyOpening, authorize: async () => '0x01' as const });

test('ENS preparation uses real encryption, protects private drafts, and returns isolated copies', async () => {
  const f = fixture(); const draft = await f.draft();
  assert.equal(draft.summary.totalAmountAtomic, 10_000n);
  assert.equal(draft.summary.recipientCount, 1);
  assert.equal(draft.publicBundle.envelopes.length, 8);
  assert.equal(draft.paymentNames[0]!.name, 'alice.eth');
  const publicJson = JSON.stringify(draft.publicBundle);
  for (const privateValue of ['private-reference', 'alice.eth', f.state.profile, draft.creInput.batchEntropyHex]) assert.ok(!publicJson.includes(privateValue));
  assert.throws(() => JSON.stringify(draft), /private data/);
  const compiled = draft.compiled; compiled.totalAmount = 999n;
  const names = draft.paymentNames; names[0]!.profile = profile(3n);
  assert.equal(draft.compiled.totalAmount, 10_000n);
  assert.equal(draft.paymentNames[0]!.profile, f.state.profile);
});

test('rejects raw destinations, missing confirmation, unsupported resolvers, and incorrect contexts', async () => {
  const f = fixture();
  await assert.rejects(resolvePayoutRecipients(f.ens, [{ reference: 'a', amount: '1', name: f.state.profile }]));
  await assert.rejects(resolvePayoutRecipients(f.ens, []));
  await assert.rejects(resolvePayoutRecipients(f.ens, [{ reference: 'a', amount: '0.0000001', name: 'a.eth' }]));
  const recipients = await f.recipients();
  await assert.rejects(preparePayout({ ens: f.ens, context, recipients: [{ ...recipients[0]!, paymentName: undefined! }] }));
  await assert.rejects(preparePayout({ ens: f.ens, context: { ...context, chainId: 1n }, recipients }));
  f.state.implementation = zeroAddress;
  await assert.rejects(f.draft(), /supported ENSv2/);
});

test('blocks a destination change while compilation is running', async () => {
  const f = fixture(); const recipients = await f.recipients();
  await assert.rejects(preparePayout({ ens: f.ens, context, recipients, compiler: async input => {
    const compiled = await compileDistribution(input);
    f.state.profile = profile(3n);
    return compiled;
  } }), /changed/);
});

test('rejects inconsistent compiler output before exposing a draft', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(preparePayout({ ens: f.ens, context, recipients: await f.recipients(), compiler: async input => {
    const compiled = await compileDistribution(input);
    if (++calls === 2) compiled.totalAmount = 42n;
    return compiled;
  } }), /inconsistent/);
});

test('CRE approval rejects a stale result and a forged draft before asking for a signature', async () => {
  const f = fixture(); const draft = await f.draft(); const t = transport(); const client = new PayoutClient(t.live, f.ens);
  const result = JSON.stringify({ version: 1, mode: 'cre-local-simulation', batchId: 'stale', publicBundle: draft.publicBundle });
  await assert.rejects(client.approve(draft, { ...approval(), compilation: { mode: 'cre-local-simulation', result } }), /another payment/);
  await assert.rejects(client.approve({} as PayoutDraft, approval()), /in-memory draft/);
  assert.equal(t.calls.prepare, 0);
  const exact = JSON.stringify({ version: 1, mode: 'cre-local-simulation', batchId: draft.creInput.batchId, publicBundle: draft.publicBundle });
  await client.approve(draft, { ...approval(), compilation: { mode: 'cre-local-simulation', result: exact } });
  assert.equal(t.calls.prepare, 1);
});

test('rechecks ENS after the owner returns a signature', async () => {
  const f = fixture(); const draft = await f.draft(); const t = transport(); const client = new PayoutClient(t.live, f.ens);
  await assert.rejects(client.approve(draft, { ...approval(), authorize: async () => {
    f.state.owner = zeroAddress;
    return '0x01';
  } }), /changed/);
  await assert.rejects(client.submit(t.operation, { mode: 'relay', url: 'https://example.com' }), /not approved/);
  assert.equal(t.calls.submit, 0);
});

test('checks names at submission but permits reconciliation after names change', async () => {
  const f = fixture(); const draft = await f.draft(); const t = transport(); const client = new PayoutClient(t.live, f.ens);
  const operation = await client.approve(draft, approval());
  await client.submit(operation, { mode: 'relay', url: 'https://example.com' });
  assert.equal(t.calls.submit, 1);
  f.state.profile = profile(3n);
  await assert.rejects(client.submit(operation, { mode: 'relay', url: 'https://example.com' }), /changed/);
  assert.equal(t.calls.submit, 1);
  assert.equal((await client.reconcile(operation)).status, 'not-observed');
  assert.equal(t.calls.reconcile, 1);
  await assert.rejects(new PayoutClient(t.live, f.ens).submit(operation, { mode: 'relay', url: 'https://example.com' }), /not approved/);
});

test('a draft cannot be approved for another pool', async () => {
  const f = fixture(); const t = transport();
  const client = new PayoutClient({ ...t.live, context: { ...context, poolAddress: '0x2222222222222222222222222222222222222222' } }, f.ens);
  await assert.rejects(client.approve(await f.draft(), approval()), /another chain or pool/);
  assert.equal(t.calls.prepare, 0);
});

test('large payout jobs partition at eight slots and reject duplicate references across batches', () => {
  const recipients = Array.from({ length: 25 }, (_, index) => ({ reference: 'invoice-' + index, name: 'alice.eth', amount: '1' }));
  assert.deepEqual(partitionPayoutRecipients(recipients).map(group => group.length), [8, 8, 8, 1]);
  assert.throws(() => partitionPayoutRecipients([...recipients, recipients[0]!]));
  const large = [{ reference: 'a', name: 'alice.eth', amount: '18446744073709.551615' }, { reference: 'b', name: 'alice.eth', amount: '1' }];
  assert.deepEqual(partitionPayoutRecipients(large).map(group => group.length), [1, 1]);
});

test('a job retains confirmed batches, stops on an uncertain send, and resumes only after reconciliation', async () => {
  const f = fixture();
  const recipients = await resolvePayoutJobRecipients(f.ens, Array.from({ length: 9 }, (_, index) => ({ reference: 'invoice-' + index, name: 'alice.eth', amount: '0.01' })));
  const job = await PayoutJob.prepare({ ens: f.ens, context, recipients });
  const commitments = job.draftSummaries.map(summary => summary.commitment);
  assert.equal(new Set(commitments).size, 2);
  let sends = 0;
  const result = (n: number) => ({ transactionHash: ('0x' + String(n).repeat(64)), localRecoverySaved: true }) as ConfirmedOperation;
  const client = {
    approve: async () => ({} as PreparedOperation),
    submit: async () => { if (++sends === 2) throw new Error('Transport timed out'); return result(sends); },
    reconcile: async () => ({ status: 'confirmed', result: result(2) }),
  } as unknown as PayoutClient;
  const options = { client, transport: { mode: 'relay' as const, url: 'https://example.com' }, approveBatch: async () => approval(), onProgress: async () => {} };
  await assert.rejects(job.send(options), /timed out/);
  assert.equal(job.completedBatches, 1);
  assert.equal(job.requiresReconciliation, true);
  await assert.rejects(job.send(options), /Reconcile/);
  assert.equal(sends, 2);
  assert.equal((await job.reconcile(client)).status, 'confirmed');
  assert.equal((await job.send(options)).length, 2);
  assert.equal(sends, 2);
});
