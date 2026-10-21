test('invalid money operations fail before requesting any signer action', async () => {
  const { shieldUsdc, unshieldUsdc, privatePayout } = await import('./engine');
  let signerCalls = 0;
  const forbidden = async (): Promise<never> => { signerCalls++; throw Error('No signing is permitted in this test.'); };
  const sender = { address: `0x${'1'.repeat(40)}` as `0x${string}`, chainId: forbidden, signMessage: forbidden, sendTransaction: forbidden, waitForReceipt: forbidden, readAllowance: forbidden, fees: forbidden };
  const record = { walletId: 'unfunded-test', railgunAddress: '', salt: '', createdAt: 0 };
  await assert.rejects(shieldUsdc(sender, record, 0n), /positive/);
  await assert.rejects(shieldUsdc(sender, record, -1n), /positive/);
  await assert.rejects(shieldUsdc(sender, record, 2n ** 256n), /supported/);
  await assert.rejects(unshieldUsdc(sender, record, '', `0x${'0'.repeat(40)}`, 1n), /non-zero/);
  await assert.rejects(privatePayout(sender, record, '', [], undefined), /recipients/);
  assert.equal(signerCalls, 0);
});
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import memdown from 'memdown';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { RAILGUN_PROXY, RAILGUN_RELAY_ADAPT, afterFee, formatUsdc, parseUsdc, railgunFee, resolveRecipients } from './index';
import { RAILGUN_PROXY_ADDRESS, createVault, isRailgunAddress, startEngine, stopEngine, unlockVault, deriveEncryptionKey } from './engine';

const files = new Map<string, string | Uint8Array>();
before(() => startEngine({ db: memdown(), offline: true, rpcUrls: [], poiNodeUrls: [], artifacts: {
  get: async p => files.get(p) ?? null, store: async (_d, p, i) => { files.set(p, i); }, exists: async p => files.has(p) } }));
after(() => stopEngine());

test('mainnet constants match the Railgun SDK', () => {
  const cfg = NETWORK_CONFIG[NetworkName.Ethereum];
  assert.equal(cfg.chain.id, 1);
  assert.equal(cfg.proxyContract.toLowerCase(), RAILGUN_PROXY);
  assert.equal(RAILGUN_PROXY_ADDRESS.toLowerCase(), RAILGUN_PROXY);
  assert.equal(cfg.relayAdaptContract.toLowerCase(), RAILGUN_RELAY_ADAPT);
});

test('USDC amounts parse strictly and fees round down', () => {
  assert.equal(parseUsdc('12.5'), 12_500_000n);
  assert.equal(parseUsdc('0.000001'), 1n);
  for (const bad of ['', '-1', '1e6', '1.1234567', '0', 'abc']) assert.throws(() => parseUsdc(bad));
  assert.equal(formatUsdc(12_500_000n), '12.5');
  assert.equal(railgunFee(1_000_000n), 2_500n);
  assert.equal(afterFee(1_000_000n), 997_500n);
});

test('vault creates a real 0zk wallet, unlocks with the password and rejects a wrong one', async () => {
  const { record, mnemonic, key } = await createVault('correct horse battery');
  assert.match(record.railgunAddress, /^0zk1/);
  assert.equal(isRailgunAddress(record.railgunAddress), true);
  assert.equal(mnemonic!.split(' ').length, 12);
  assert.equal(await unlockVault(record, 'correct horse battery'), key);
  await assert.rejects(unlockVault(record, 'wrong password!!'), /Wrong vault password/);
  assert.throws(() => deriveEncryptionKey('short', record.salt), /at least 10/);
});

test('imported recovery phrase restores the same 0zk address', async () => {
  const first = await createVault('vault password one');
  const again = await createVault('another password', { mnemonic: first.mnemonic });
  assert.equal(again.record.railgunAddress, first.record.railgunAddress);
  assert.equal(again.mnemonic, undefined);
});

test('recipients resolve from ENS railgun records with checksum validation', async () => {
  const a = (await createVault('recipient password a')).record.railgunAddress;
  const b = (await createVault('recipient password b')).record.railgunAddress;
  const records: Record<string, string> = { 'alice.eth': a, 'bob.eth': b, 'twin.eth': a, 'broken.eth': `${a.slice(0, -1)}${a.endsWith('q') ? 'p' : 'q'}` };
  const read = async (name: string, key: string) => (assert.equal(key, 'railgun'), records[name] ?? null);
  const out = await resolveRecipients([
    { name: 'Alice.eth', amount: '10' }, { name: b, amount: '2.5' }, { name: 'nobody.eth', amount: '1' },
    { name: 'twin.eth', amount: '1' }, { name: 'broken.eth', amount: '1' }, { name: 'bad name', amount: '1' }, { name: 'bob.eth', amount: '1.2345678' },
  ], read, isRailgunAddress);
  assert.deepEqual(out.resolved.map(r => [r.name, r.amount]), [['alice.eth', 10_000_000n], [b.toLowerCase(), 2_500_000n]]);
  assert.equal(out.total, 12_500_000n);
  assert.deepEqual(out.issues.map(i => i.reason).sort(), ['duplicate', 'invalid-address', 'invalid-amount', 'invalid-name', 'no-record']);
});
