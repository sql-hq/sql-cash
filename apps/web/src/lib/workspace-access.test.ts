import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicClient, Address } from 'viem';
import { createPrivacyProfile } from '@null-protocol/sdk';
import { profileFingerprint, type PaymentNameSnapshot } from '@null-protocol/ens';
import { createIdentitySessionCache } from './identity-session';
import { requireOrganizationSigner, verifyWorkspaceAccess, type WorkspaceAccessInput, type AccessReaders } from './workspace-access';

const address = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const client = {} as PublicClient;
const input: WorkspaceAccessInput = { profile: { type: 'individual', ensName: 'alice.eth' }, walletAddresses: [address], paymentProfile: 'original-profile', backedUp: true };
const snapshot: PaymentNameSnapshot = { name: 'alice.eth', profile: input.paymentProfile, fingerprint: `0x${'0'.repeat(64)}`, resolver: address, owner: address, chainId: 11155111, blockNumber: '123' };
function readers(overrides: Partial<AccessReaders> = {}): AccessReaders {
  return { identity: async (_client, candidate, names) => ({ status: 'verified', address: candidate as Address, name: names?.[0] ?? '', source: 'owner' }),
    payment: async () => snapshot, ...overrides };
}
test('missing ENS cannot open either account type', async () => {
  for (const type of ['individual', 'organization'] as const) await assert.rejects(verifyWorkspaceAccess(client, { ...input, profile: { type } }, readers()), /Link your ENS/);
});
test('individual entry needs the original backed-up Payment ID and a connected wallet', async () => {
  const linked = await verifyWorkspaceAccess(client, input, readers());
  assert.equal(linked.name, 'alice.eth');
  assert.deepEqual(linked.receivingName, snapshot);
  await assert.rejects(verifyWorkspaceAccess(client, { ...input, backedUp: false }, readers()), /backup/);
  await assert.rejects(verifyWorkspaceAccess(client, { ...input, paymentProfile: 'new-profile' }, readers()), /different Payment ID/);
  await assert.rejects(verifyWorkspaceAccess(client, { ...input, walletAddresses: [] }, readers()), /Connect the wallet/);
});
test('organization entry uses the authenticated signer, never a saved address or gas wallet', async () => {
  const org = { ...input, profile: { type: 'organization' as const, ensName: 'org.eth', organizationAddress: address } };
  await assert.rejects(verifyWorkspaceAccess(client, org, readers()), /organization account/);
  const result = await verifyWorkspaceAccess(client, { ...org, organizationAddress: other }, readers());
  assert.equal(result.address, other);
  assert.equal(result.receivingName, undefined);
  requireOrganizationSigner(result, other);
  assert.throws(() => requireOrganizationSigner(result, address), /different signer/);
  assert.throws(() => requireOrganizationSigner({ ...result, type: 'individual' }, other), /different signer/);
});

test('a refreshed backed-up inbox reuses its Payment ID and returns the verified receiving name', async () => {
  let encrypted: string | null = null;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const cache = createIdentitySessionCache(() => ({ getItem: () => encrypted, setItem: (_id, value) => { encrypted = value; }, removeItem: () => { encrypted = null; } }), { get: async () => key, remove: async () => {} });
  const identity = createPrivacyProfile();
  await cache.save('alice', { identity, backedUp: true });
  const restored = await cache.load('alice');
  assert.ok(restored);
  const receivingName = { ...snapshot, profile: identity.profile.stealthMetaAddress, fingerprint: profileFingerprint(identity.profile.stealthMetaAddress) };
  const linked = await verifyWorkspaceAccess(client, { ...input, paymentProfile: restored.identity.profile.stealthMetaAddress, backedUp: restored.backedUp }, readers({ payment: async () => receivingName }));
  assert.deepEqual(linked.receivingName, receivingName);
});
test('stale saved links and a different reverse name cannot authorize entry', async () => {
  await assert.rejects(verifyWorkspaceAccess(client, input, readers({ identity: async () => ({ status: 'missing' }) })), /not linked/);
  await assert.rejects(verifyWorkspaceAccess(client, input, readers({ identity: async () => ({ status: 'verified', name: 'someone-else.eth', address, source: 'address' }) })), /not linked/);
});
test('network failure fails closed and is distinguished from missing ownership', async () => {
  await assert.rejects(verifyWorkspaceAccess(client, input, readers({ identity: async () => ({ status: 'error' }) })), /connection/);
  await assert.rejects(verifyWorkspaceAccess(client, input, readers({ payment: async () => { throw new Error('ENS unavailable'); } })), /ENS unavailable/);
});
test('every verification reads again, so a transferred ENS name blocks the next action', async () => {
  let linked = true;
  const liveReaders = readers({ identity: async () => linked ? { status: 'verified', name: 'alice.eth', address, source: 'owner' } : { status: 'missing' } });
  await verifyWorkspaceAccess(client, input, liveReaders);
  linked = false;
  await assert.rejects(verifyWorkspaceAccess(client, input, liveReaders), /not linked/);
});
