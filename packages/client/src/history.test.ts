import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { IncrementalMerkleTree, NullError, fieldHex } from '@null-protocol/sdk';
import { NullLiveClient, type DeploymentManifest, type PublicHistory } from './index';

const manifest = JSON.parse(readFileSync(new URL('../../../apps/web/public/deployment.json', import.meta.url), 'utf8')) as DeploymentManifest;
const primary = 'https://primary.example/';
const secondary = 'https://secondary.example/';
const makeClient = (rpcUrls = [primary]) => new NullLiveClient({ manifest, rpcUrls, artifactBaseUrl: primary, persistLocalSecret: async () => { throw Error('History must not write secrets'); } });
const eventAbi = parseAbi(['event PolicyRegistered(uint256 indexed policyCommitment, uint256 indexed policyIndex, uint256 postAuthRoot)']);
const root = (leaves: ReturnType<typeof fieldHex>[]) => new IncrementalMerkleTree(20, leaves).root;

function historyFixture(client: NullLiveClient, corrupt = false, missing = false) {
  const notes = [fieldHex(11n)], policies = [fieldHex(22n)];
  const blockNumber = BigInt(manifest.deploymentBlock), blockHash = fieldHex(77n);
  // A successful RPC response can omit logs. Model the reported provider behavior
  // without weakening the real client's count/root and canonical-block checks.
  const rpc = {
    getLogs: async (args: { event?: { name: string } }) => args.event?.name === 'PolicyRegistered' && !missing ? [{
      removed: false, topics: encodeEventTopics({ abi: eventAbi, eventName: 'PolicyRegistered', args: { policyCommitment: corrupt ? 23n : 22n, policyIndex: 0n } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(root(policies))]),
    }] : [],
    readContract: async ({ functionName }: { functionName: string }) => ({ noteRoot: BigInt(root(notes)), distributionRoot: BigInt(root([])), authRoot: BigInt(root(policies)), nextNoteIndex: 1n, nextDistributionIndex: 0n, nextPolicyIndex: 1n })[functionName],
    getBlock: async () => ({ hash: blockHash }),
  };
  Object.assign(client, { rpc, discovery: { scan: async () => ({ source: 'rpc', checkpoint: { blockNumber, blockHash }, confirmedToBlock: blockNumber, notes: [{ noteIndex: 0, commitment: notes[0] }], distributions: [], envelopes: [] }) } });
  return { notes, policies, rpc };
}

test('reconstructs authorization history using the event filter and checks all roots', async () => {
  const client = makeClient(); const fixture = historyFixture(client);
  const history = await client.syncHistory();
  assert.deepEqual(history.noteLeaves, fixture.notes);
  assert.deepEqual(history.policyLeaves, fixture.policies);
});

test('missing events and wrong commitments still block use of a balance', async () => {
  for (const [corrupt, missing] of [[true, false], [false, true]]) {
    const client = makeClient(); historyFixture(client, corrupt, missing);
    await assert.rejects(client.syncHistory(), (error: unknown) => error instanceof NullError && error.code === 'NULL_HISTORY_INCOMPLETE');
  }
});

test('a changed canonical block is rejected even when the roots match', async () => {
  const client = makeClient(); const fixture = historyFixture(client);
  fixture.rpc.getBlock = async () => ({ hash: fieldHex(88n) });
  await assert.rejects(client.syncHistory(), (error: unknown) => error instanceof NullError && error.code === 'NULL_ROOT_STALE');
});

test('incomplete successful responses trigger a bounded full scan on a second provider', async t => {
  const scans: string[][] = [];
  const expected = { source: 'rpc' } as PublicHistory;
  type Internal = { options: { rpcUrls: string[] }; syncHistoryFromSource: (options: { forceRpc?: boolean }) => Promise<PublicHistory> };
  t.mock.method(NullLiveClient.prototype as unknown as Internal, 'syncHistoryFromSource', async function (this: Internal, options: { forceRpc?: boolean }) {
    scans.push(this.options.rpcUrls);
    if (this.options.rpcUrls[0] === primary) throw new NullError('NULL_HISTORY_INCOMPLETE', 'Missing event');
    assert.equal(options.forceRpc, true);
    return expected;
  });
  assert.equal(await makeClient([primary, secondary, secondary]).syncHistory(), expected);
  assert.deepEqual(scans, [[primary, secondary, secondary], [secondary]]);
});

test('all incomplete providers fail closed; cancellation prevents another scan', async t => {
  type Internal = { syncHistoryFromSource: () => Promise<PublicHistory> };
  let scans = 0;
  const controller = new AbortController();
  t.mock.method(NullLiveClient.prototype as unknown as Internal, 'syncHistoryFromSource', async () => {
    scans++; throw new NullError('NULL_HISTORY_INCOMPLETE', 'Missing event');
  });
  await assert.rejects(makeClient([primary, secondary]).syncHistory(), (error: unknown) => error instanceof NullError && error.code === 'NULL_HISTORY_INCOMPLETE');
  assert.equal(scans, 2);
  controller.abort();
  await assert.rejects(makeClient([primary, secondary]).syncHistory({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(scans, 3, 'never starts another provider after cancellation');
});
