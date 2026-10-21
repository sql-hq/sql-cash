import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivyOrganizationAuthorizer, type PrivyOrganizationConfig } from './server';
import { identifyOrganizationSigner, organizationIdentityRequest } from './index';

const config: PrivyOrganizationConfig = { appId: 'testapp', appSecret: 'synthetic-test-secret', walletId: 'wallet', walletAddress: '0x1111111111111111111111111111111111111111', ownerQuorumId: 'quorum', organizationEntityId: 'organization', requiredPolicyIds: [], controlMode: 'owner-quorum', expectedOwnerUserIds: ['did:privy:owner'], minimumApprovals: 1, chainId: 11155111n, poolAddress: '0x2222222222222222222222222222222222222222' };
const wallet = { id: 'wallet', address: config.walletAddress, chain_type: 'ethereum', owner_id: 'quorum', entity: {type: 'organization', id: 'organization'}, policy_ids: [], additional_signers: [], archived_at: null };
const quorum = { id: 'quorum', authorization_threshold: 1, user_ids: ['did:privy:owner'], authorization_keys: [], key_quorum_ids: [] };

test('identity setup preserves operational errors without claiming a signature mismatch', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'NULL_ORGANIZATION_UNAVAILABLE' }, { status: 503 }));
  await assert.rejects(identifyOrganizationSigner({ ...config, endpoint: 'https://example.test', getAccessToken: async () => 'synthetic-session', generateAuthorizationSignature: async () => { throw Error('Must not sign after failed preparation'); } }), /NULL_ORGANIZATION_UNAVAILABLE/);
});

test('empty policies require explicit, feasible owner-quorum configuration', () => {
  assert.doesNotThrow(() => createPrivyOrganizationAuthorizer(config));
  for (const change of [{controlMode: undefined}, {controlMode: 'unknown'}, {expectedOwnerUserIds: []}, {minimumApprovals: 2}, {requiredPolicyIds: ['policy']}]) {
    assert.throws(() => createPrivyOrganizationAuthorizer({...config, ...change} as PrivyOrganizationConfig), /NULL_PRIVY_CONFIG_REQUIRED/);
  }
});
test('live control validation rejects altered ownership, bypass signers and quorum membership', async () => {
  const original = globalThis.fetch;
  try {
    const check = async (w: unknown, q: unknown) => {
      globalThis.fetch = (async (url: string | URL | Request) => Response.json(String(url).includes('key_quorums') ? q : w)) as typeof fetch;
      return createPrivyOrganizationAuthorizer(config).verifyWalletControl();
    };
    await check(wallet, quorum);
    for (const change of [{owner_id: 'other'}, {address: config.poolAddress}, {additional_signers: [{signer_id: 'bypass'}]}, {policy_ids: ['unexpected']}, {entity: {type:'user',id:'organization'}}, {archived_at: 1}]) await assert.rejects(check({...wallet,...change}, quorum), /NULL_PRIVY_CONTROL_MISMATCH/);
    for (const change of [{user_ids: ['did:privy:intruder']}, {authorization_threshold: 0}, {authorization_keys: ['bypass']}, {key_quorum_ids: ['nested']}]) await assert.rejects(check(wallet, {...quorum,...change}), /NULL_PRIVY_CONTROL_MISMATCH/);
    await assert.rejects(createPrivyOrganizationAuthorizer(config).identify(Date.now()+60_000, []), /NULL_PRIVY_APPROVALS_REQUIRED/);
  } finally { globalThis.fetch = original; }
});
test('identity challenge is bound to the application, wallet, chain and pool with a short expiry', () => {
  const original = organizationIdentityRequest(config);
  for (const change of [{appId:'other'}, {walletId:'other'}, {poolAddress:config.walletAddress}]) assert.notEqual(organizationIdentityRequest({...config,...change}).body.params.hash, original.body.params.hash);
  assert.throws(() => organizationIdentityRequest({...config,chainId:1n}));
  assert.throws(() => organizationIdentityRequest({...config,requestExpiryMs:Date.now()-1}));
  assert.throws(() => organizationIdentityRequest({...config,requestExpiryMs:Date.now()+600_000}));
});
