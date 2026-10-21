import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectTransactionWallet } from './transaction-wallet';

const signer = { address: '0x6567226D425c423b1A5765384Ae343aE5FDeB1d1', walletClientType: 'privy' };
const funding = { address: '0x7fD5B5B80E9F7a811b1d27Ec20879185fB987433', walletClientType: 'privy' };

test('multiple Privy wallets require a choice, regardless of returned order', () => {
  for (const wallets of [[signer, funding], [funding, signer]]) {
    assert.throws(() => selectTransactionWallet(wallets), /Choose the wallet/);
    assert.equal(selectTransactionWallet(wallets, funding.address.toLowerCase()), funding);
  }
});

test('a disconnected selection never silently switches to another wallet', () => {
  assert.throws(() => selectTransactionWallet([signer], funding.address), /no longer connected/);
  assert.throws(() => selectTransactionWallet([], funding.address), /no longer connected/);
});

test('a single connected wallet can connect without a redundant choice', () => {
  assert.equal(selectTransactionWallet([funding]), funding);
  assert.throws(() => selectTransactionWallet([]), /Connect a wallet/);
});
