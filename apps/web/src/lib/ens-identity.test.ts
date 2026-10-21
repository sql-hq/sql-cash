import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroAddress, type Address, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { PaymentNameError } from '@null-protocol/ens';
import { ensIdentityLabel, ensIdentityOption, findEnsIdentity, recheckEnsAddress, resolveEnsAddress, type IdentityReader } from './ens-identity';

const alice = '0x1111111111111111111111111111111111111111' as Address;
const bob = '0x2222222222222222222222222222222222222222' as Address;
const reader = (overrides: Partial<IdentityReader> = {}): IdentityReader => ({ primaryName: async () => null, address: async () => null, owner: async () => zeroAddress, ...overrides });
const client = (address: Address | null, chainId = 11155111) => ({ chain: { ...sepolia, id: chainId }, getChainId: async () => chainId, getBlockNumber: async () => 1n, getEnsResolver: async () => alice, getEnsText: async () => null, readContract: async () => zeroAddress, getEnsAddress: async () => address }) as unknown as PublicClient;

test('primary names require a matching forward address, including spoofed reverse records', async () => {
  assert.equal((await findEnsIdentity(reader({ primaryName: async () => 'alice.eth', address: async () => alice }), alice)).name, 'alice.eth');
  assert.equal((await findEnsIdentity(reader({ primaryName: async () => 'alice.eth', address: async () => bob }), alice)).status, 'missing');
  assert.equal((await findEnsIdentity(reader({ primaryName: async () => 'alice.eth' }), alice)).status, 'missing');
});

test('assigned individual and organization names are verified against live ownership', async () => {
  for (const name of ['alice.nullpay2026.eth', 'treasury.nullpay2026.eth']) {
    const result = await findEnsIdentity(reader({ owner: async () => alice }), alice, [name.toUpperCase()]);
    assert.deepEqual(result, { status: 'verified', name, address: alice, source: 'owner' });
  }
  assert.equal((await findEnsIdentity(reader({ owner: async () => bob }), alice, ['alice.eth'])).status, 'missing');
});

test('a saved preference or deployment hint never proves identity by itself', async () => {
  assert.equal((await findEnsIdentity(reader(), alice, ['someone-else.eth'])).status, 'missing');
  assert.equal((await findEnsIdentity(reader({ owner: async () => alice }), alice, ['not a name', alice])).status, 'missing');
});

test('expired name hints cannot revive stale wildcard addresses', async () => {
  let addressLookups = 0;
  const result = await findEnsIdentity(reader({ owner: async () => { throw new PaymentNameError('missing', 'Expired'); }, address: async () => { addressLookups++; return alice; } }), alice, ['expired.eth']);
  assert.equal(result.status, 'missing'); assert.equal(addressLookups, 0);
});

test('lookup failures remain distinct from a wallet with no name', async () => {
  assert.equal((await findEnsIdentity(reader(), alice)).status, 'missing');
  const result = await findEnsIdentity(reader({ primaryName: async () => { throw new Error('offline'); } }), alice);
  assert.equal(result.status, 'error');
  assert.match(ensIdentityLabel(result, 'Organization'), /lookup unavailable/);
  for (const status of ['loading', 'error', 'missing'] as const) assert.doesNotMatch(ensIdentityLabel({ status }), /0x/);
});

test('wallet options stay distinguishable when name ownership and the address record point to different wallets', () => {
  const owner = { status: 'verified', name: 'team.eth', address: alice, source: 'owner' } as const;
  const destination = { ...owner, address: bob, source: 'address' } as const;
  assert.notEqual(ensIdentityOption(owner, 'Privy wallet 1'), ensIdentityOption(destination, 'Connected wallet 2'));
  assert.match(ensIdentityOption(owner, 'Privy wallet 1'), /^team.eth/);
});

test('ENS destinations normalize names, reject addresses and reject missing/zero address records', async () => {
  assert.deepEqual(await resolveEnsAddress(client(alice), ' ALICE.ETH '), { name: 'alice.eth', address: alice });
  for (const invalid of [alice, '', 'alice']) await assert.rejects(resolveEnsAddress(client(alice), invalid), /ENS name/);
  for (const address of [null, zeroAddress]) await assert.rejects(resolveEnsAddress(client(address), 'alice.eth'), /no receiving wallet/);
  await assert.rejects(resolveEnsAddress(client(alice, 1), 'alice.eth'), /Sepolia/);
});

test('a changed ENS destination blocks submission instead of silently redirecting funds or editor access', async () => {
  const previous = { name: 'alice.eth', address: alice };
  assert.deepEqual(await recheckEnsAddress(client(alice), previous), previous);
  await assert.rejects(recheckEnsAddress(client(bob), previous), /different wallet/);
  await assert.rejects(recheckEnsAddress(client(null), previous), /no receiving wallet/);
});
