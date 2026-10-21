import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingWalletAddresses, readWalletBalances, walletAmount, type WalletBalanceReader } from './wallet-balances';

const wallet = '0x1111111111111111111111111111111111111111';
const signer = '0x2222222222222222222222222222222222222222';
test('the funding menu excludes the separate approval signer and duplicate addresses', () => {
  assert.deepEqual(fundingWalletAddresses([signer, wallet, wallet], signer), [wallet]);
});
test('balance reads pin both assets to one Sepolia block and preserve partial failure', async () => {
  const reader: WalletBalanceReader = { getChainId: async () => 11155111, getBlockNumber: async () => 42n,
    eth: async (address, block) => { assert.equal(address, wallet); assert.equal(block, 42n); return 123n; },
    usdc: async (address, block) => { assert.equal(address, wallet); assert.equal(block, 42n); throw Error('RPC unavailable'); } };
  assert.deepEqual(await readWalletBalances(reader, wallet), { eth: 123n, usdc: null });
  await assert.rejects(readWalletBalances({ ...reader, getChainId: async () => 1 }, wallet), /Sepolia/);
  assert.deepEqual(await readWalletBalances({ ...reader, usdc: async () => 0n }, wallet), { eth: 123n, usdc: 0n });
});
test('wallet amounts preserve small funds and exact large integer digits', () => {
  assert.equal(walletAmount(0n, 18), '0');
  assert.equal(walletAmount(1n, 18), '<0.000001');
  assert.equal(walletAmount(12_345_678_000_000_000n, 18), '0.012345');
  assert.equal(walletAmount(20_000_000n, 6, 2), '20.00');
  assert.equal(walletAmount(1n, 6, 2), '0.000001');
  assert.equal(walletAmount(9007199254740993000001n, 6, 2), '9,007,199,254,740,993.000001');
});
test('mainnet balance reads reject Sepolia and use the explicitly selected chain', async () => {
  const reader: WalletBalanceReader = { getChainId: async () => 1, getBlockNumber: async () => 99n,
    eth: async () => 5n, usdc: async () => 10n };
  assert.deepEqual(await readWalletBalances(reader, wallet, 1), { eth: 5n, usdc: 10n });
  await assert.rejects(readWalletBalances({ ...reader, getChainId: async () => 11155111 }, wallet, 1), /mainnet/);
});
