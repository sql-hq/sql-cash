/** Wallet connection identifies a local workspace; it is not server authentication. */
export function reownUserId(address: string | undefined): string | null {
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? `eip155:${address.toLowerCase()}` : null;
}

export function validReownProjectId(value: string | undefined): boolean {
  return !!value && /^[0-9a-f]{32}$/i.test(value);
}

export type WalletProvider = { request: (args: { method: 'eth_accounts' }) => Promise<unknown> };

/** Recheck the real provider before signing; never trust a stale rendered account. */
export async function requireWalletAccount(provider: WalletProvider, expected: string): Promise<void> {
  if (!reownUserId(expected)) throw new Error('Select a valid Ethereum wallet.');
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Your connected wallet changed. Connect the selected account again.');
  }
}
