import assert from 'node:assert/strict';
import test from 'node:test';
import { profileFromKeys } from '@null-protocol/crypto';
import { keccak256, stringToHex, zeroAddress, type Address, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { namehash, packetToBytes } from 'viem/ens';
import { ENS_V2, PAYMENT_RECORD, PaymentNameError, canonicalPaymentProfile, inspectPaymentEditorScope, normalizePaymentName, paymentDestination, paymentEditorAccess, preparePaymentDelegate, prepareProfileWrite, profileFingerprint, recheckPaymentNames, requiredPaymentNames, recheckRequiredPaymentNames, resolvePaymentName, samePaymentDestination, type PaymentNameSnapshot } from './index';

// Unit-test fixtures only. Production names always resolve through Sepolia RPC.
const scalar = (value: number) => Uint8Array.from([...Array(31).fill(0), value]);
const profile = profileFromKeys({ spendPrivateKey: scalar(31), viewPrivateKey: scalar(32) }).stealthMetaAddress;
const otherProfile = profileFromKeys({ spendPrivateKey: scalar(31), viewPrivateKey: scalar(33) }).stealthMetaAddress;
const owner: Address = '0x1111111111111111111111111111111111111111';
const resolver: Address = '0x2222222222222222222222222222222222222222';
const editor: Address = '0x3333333333333333333333333333333333333333';
const parent: Address = '0x4444444444444444444444444444444444444444';
function fixture(options: { value?: string | null; resolver?: Address | null; owner?: Address; chain?: number; expiry?: bigint; implementation?: Address; alias?: `0x${string}`; permission?: boolean; direct?: string } = {}) {
  const calls: { method: string; args: any }[] = [];
  const client = {
    chain: sepolia, getChainId: async () => options.chain ?? 11155111,
    getBlockNumber: async () => 123n, getBlock: async () => ({ timestamp: 1000n }),
    getEnsResolver: async (args: unknown) => { calls.push({ method: 'resolver', args }); return options.resolver === undefined ? resolver : options.resolver; },
    getEnsText: async (args: unknown) => { calls.push({ method: 'text', args }); return options.value === undefined ? profile : options.value; },
    readContract: async (args: any) => {
      calls.push({ method: 'read', args });
      if (args.functionName === 'findOwner') return options.owner ?? owner;
      if (args.functionName === 'findParentRegistry') return parent;
      if (args.functionName === 'getState') return { status: 2, expiry: options.expiry ?? 2000n, latestOwner: owner, tokenId: 123n, resource: 1n };
      if (args.functionName === 'verifyContract') return options.implementation ?? ENS_V2.resolverImplementation;
      if (args.functionName === 'getAlias') return options.alias ?? '0x';
      if (args.functionName === 'text') return options.direct ?? (options.value === undefined ? profile : options.value ?? '');
      if (args.functionName === 'hasRoles') return false;
      throw new Error('Unexpected fixture read');
    },
    simulateContract: async (args: any) => { calls.push({ method: 'simulate', args }); if (options.permission === false) throw Error('EAC revert'); return { request: args }; },
  } as unknown as PublicClient;
  return { client, calls };
}

test('ENSIP-15 normalization accepts complete ENS and DNS names without suffix assumptions', () => {
  assert.equal(normalizePaymentName('  ALICE.ETH '), 'alice.eth');
  assert.equal(normalizePaymentName('payments.example.com'), 'payments.example.com');
  assert.equal(normalizePaymentName('école.eth'), 'école.eth');
  for (const value of ['', 'alice', owner, 'https://alice.eth', 'alice@company.eth', '.eth', 'a..eth', `${'a'.repeat(513)}.eth`, 'bad\u0000.eth']) assert.throws(() => normalizePaymentName(value), PaymentNameError);
});
test('only valid, distinct elliptic-curve keys become direct Payment IDs', () => {
  assert.deepEqual(paymentDestination(` ${profile} `), {kind: 'profile', profile});
  assert.deepEqual(paymentDestination('ALICE.ETH'), {kind: 'name', name: 'alice.eth'});
  for (const value of [owner, 'st:eth:0x1234', `st:eth:0x${'00'.repeat(66)}`, profile.slice(0, -1)]) assert.throws(() => canonicalPaymentProfile(value), PaymentNameError);
  assert.equal(profileFingerprint(profile), keccak256(stringToHex(profile)));
});
test('live reads use the canonical proxy and one block for records and hierarchy', async () => {
  const {client,calls} = fixture(); const result = await resolvePaymentName(client, 'ALICE.ETH');
  assert.equal(result.profile, profile); assert.equal(result.name, 'alice.eth'); assert.equal(result.owner, owner); assert.equal(result.blockNumber, '123');
  assert.equal(calls.find(call => call.method === 'text')!.args.key, PAYMENT_RECORD);
  assert.ok(calls.filter(call => call.method === 'read').every(call => call.args.blockNumber === 123n));
  assert.equal(calls.find(call => call.args.functionName === 'findOwner')!.args.address, sepolia.contracts.ensUniversalResolver.address);
});
test('missing names, bad records, wrong networks and expired wildcard records fail closed', async () => {
  for (const options of [{resolver: null}, {value: null}, {value: owner}, {chain: 1}, {expiry: 999n}]) await assert.rejects(resolvePaymentName(fixture(options).client, 'alice.eth'), PaymentNameError);
  // An unregistered wildcard/alias has no historical expiry; its live resolver can serve it.
  assert.equal((await resolvePaymentName(fixture({expiry: 0n, owner: zeroAddress}).client, 'alias.alice.eth')).profile, profile);
});
test('a payment snapshot detects profile, resolver, owner and network changes', async () => {
  const a = await resolvePaymentName(fixture().client, 'alice.eth');
  assert.ok(samePaymentDestination(a, {...a,blockNumber: '456'}));
  for (const patch of [{profile: otherProfile}, {resolver: editor}, {owner: editor}, {chainId: 1}, {fingerprint: `0x${'00'.repeat(32)}`}]) assert.equal(samePaymentDestination(a, {...a,...patch} as PaymentNameSnapshot), false);
  await assert.rejects(recheckPaymentNames(fixture({value: otherProfile}).client, [a]), error => error instanceof PaymentNameError && error.code === 'changed');
  await assert.rejects(recheckPaymentNames(fixture({owner: editor}).client, [a]), error => error instanceof PaymentNameError && error.code === 'changed');
  await recheckPaymentNames(fixture().client, [a]);
  await assert.rejects(recheckPaymentNames(fixture().client, Array(9).fill(a)), PaymentNameError);
});
test('publishing targets the freshly discovered v2 resolver and only the public payment record', async () => {
  const {client,calls} = fixture();
  await prepareProfileWrite(client, 'ALICE.ETH', otherProfile, editor, resolver);
  const simulation = calls.find(call => call.method === 'simulate')!.args;
  assert.equal(simulation.address, resolver); assert.equal(simulation.account, editor);
  assert.equal(simulation.functionName, 'setText'); assert.deepEqual(simulation.args, [namehash('alice.eth'), PAYMENT_RECORD, otherProfile]);
});
test('writes reject moved resolvers, unauthorized accounts, unsupported implementations and aliases', async () => {
  for (const options of [{resolver: editor}, {implementation: editor}, {alias: '0x03626f620365746800' as const}, {permission: false}]) await assert.rejects(prepareProfileWrite(fixture(options).client, 'alice.eth', profile, owner, resolver), PaymentNameError);
  await assert.rejects(prepareProfileWrite(fixture({value: otherProfile, direct: profile}).client, 'alice.eth', profile, owner, resolver), PaymentNameError);
});
test('delegation grants and revokes exactly one key on one DNS-encoded name', async () => {
  for (const grant of [true, false]) {
    const {client,calls} = fixture(); await preparePaymentDelegate(client, 'ALICE.ETH', editor, grant, owner, resolver);
    const simulation = calls.find(call => call.method === 'simulate')!.args;
    assert.equal(simulation.functionName, 'authorizeTextRoles');
    assert.deepEqual(simulation.args, [`0x${Buffer.from(packetToBytes('alice.eth')).toString('hex')}`, PAYMENT_RECORD, editor, grant]);
    assert.equal(simulation.account, owner);
  }
  await assert.rejects(preparePaymentDelegate(fixture().client, 'alice.eth', owner, true, owner, resolver), PaymentNameError);
  await assert.rejects(preparePaymentDelegate(fixture().client, 'alice.eth', zeroAddress, true, owner, resolver), PaymentNameError);
});
test('access inspection checks root, global-key, name and record permissions', async () => {
  const {client,calls} = fixture(); assert.deepEqual(await paymentEditorAccess(client, 'alice.eth', editor), {allowed:false, broaderAccess:false, recordAccess:false});
  const rights = calls.filter(call => call.args.functionName === 'hasRoles'); assert.equal(rights.length, 4);
  assert.equal(rights[0].args.args[0], 0n); assert.ok(rights.every(call => call.args.args[1] === 16n && call.args.args[2] === editor));
});

test('live payments reject raw IDs, unconfirmed names and mismatched profile snapshots', async () => {
  const paymentName = await resolvePaymentName(fixture().client, 'alice.eth');
  const row = { destination: 'ALICE.ETH', profile, paymentName };
  assert.deepEqual(requiredPaymentNames([row]), [paymentName]);
  for (const rows of [[], Array(9).fill(row), [{profile}], [{...row, paymentName: undefined}], [{...row, profile: otherProfile}], [{...row, destination: 'bob.eth'}], [{...row, paymentName: {...paymentName, fingerprint: zeroAddress}}]]) {
    assert.throws(() => requiredPaymentNames(rows), PaymentNameError);
  }
});

test('approval and submission require ENS coverage for every real compiled recipient', async () => {
  const { client, calls } = fixture();
  const snapshot = await resolvePaymentName(client, 'alice.eth');
  const before = calls.length;
  for (const snapshots of [undefined, [], [snapshot]]) await assert.rejects(recheckRequiredPaymentNames(client, snapshots, 2), PaymentNameError);
  for (const count of [0, 9, NaN, 1.5]) await assert.rejects(recheckRequiredPaymentNames(client, [snapshot], count), PaymentNameError);
  assert.equal(calls.length, before, 'incomplete coverage must fail before any network lookup');
  await recheckRequiredPaymentNames(client, [snapshot], 1);
  for (const changed of [{value: otherProfile}, {owner: editor}, {resolver: editor}, {value: null}, {expiry: 999n}, {implementation: editor}]) {
    await assert.rejects(recheckRequiredPaymentNames(fixture(changed).client, [snapshot], 1), PaymentNameError);
  }
});


test('permission comparison pins both concrete records to one observed block and preserves read failures', async () => {
  const { client, calls } = fixture();
  const result = await inspectPaymentEditorScope(client, 'alice.eth', editor);
  assert.equal(result.paymentRecord, false);
  assert.equal(result.websiteRecord, false);
  assert.equal(result.blockNumber, '123');
  const rights = calls.filter(call => call.args.functionName === 'hasRoles');
  assert.equal(rights.length, 8);
  assert.ok(rights.every(call => call.args.blockNumber === 123n));
  assert.notEqual(rights[3].args.args[0], rights[7].args.args[0]);
  const broken = fixture().client;
  const read = broken.readContract.bind(broken);
  broken.readContract = (async (args: any) => {
    if (args.functionName === 'hasRoles') throw new Error('RPC offline');
    return read(args);
  }) as typeof broken.readContract;
  await assert.rejects(inspectPaymentEditorScope(broken, 'alice.eth', editor), /RPC offline/);
});
