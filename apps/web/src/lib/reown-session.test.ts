import assert from 'node:assert/strict';
import test from 'node:test';
import { requireWalletAccount, reownUserId, validReownProjectId } from './reown-session';

const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';

test('workspace IDs are wallet-scoped, normalized, and do not depend on chain', () => {
  const address = '0xAbCdEf0000000000000000000000000000000000';
  assert.equal(reownUserId(address), `eip155:${address.toLowerCase()}`);
  assert.notEqual(reownUserId(first), reownUserId(second));
  assert.equal(reownUserId(undefined), null);
  assert.equal(reownUserId('not-an-address'), null);
});
test('rejects missing, borrowed-placeholder, and malformed project configuration', () => {
  assert.equal(validReownProjectId(undefined), false);
  assert.equal(validReownProjectId('YOUR_PROJECT_ID'), false);
  assert.equal(validReownProjectId('abcdef0123456789abcdef0123456789'), true);
});
test('the connected provider must authorize the selected account before signing', async () => {
  const calls: string[] = [];
  await requireWalletAccount({ request: async ({ method }) => { calls.push(method); return [first]; } }, first);
  assert.deepEqual(calls, ['eth_accounts']);
  await assert.rejects(requireWalletAccount({ request: async () => [second] }, first), /wallet changed/);
  await assert.rejects(requireWalletAccount({ request: async () => [second, first] }, first), /wallet changed/);
  await assert.rejects(requireWalletAccount({ request: async () => [] }, first), /wallet changed/);
  await assert.rejects(requireWalletAccount({ request: async () => null }, first), /wallet changed/);
});
test('provider refusal is not treated as a successful connection', async () => {
  await assert.rejects(requireWalletAccount({ request: async () => { throw new Error('Disconnected'); } }, first), /Disconnected/);
});
