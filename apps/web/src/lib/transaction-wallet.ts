import { NullError } from '@null-protocol/sdk';

/** Funding/broadcast wallets are selected separately from the organization signer. */
export function selectTransactionWallet<T extends { address: string }>(wallets: readonly T[], address?: string): T {
  if (address) {
    const selected = wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase());
    if (!selected) throw new NullError('NULL_WALLET_UNAVAILABLE', 'The selected wallet is no longer connected. Choose your sending wallet again.');
    return selected;
  }
  if (wallets.length === 1) return wallets[0]!;
  throw new NullError('NULL_WALLET_UNAVAILABLE', wallets.length ? 'Choose the wallet that holds your test USDC and Sepolia ETH.' : 'Connect a wallet to continue.');
}
