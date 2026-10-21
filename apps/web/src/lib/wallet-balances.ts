import { getAddress, type Address } from 'viem';

export function fundingWalletAddresses(addresses: readonly string[], approvalAddress?: string): Address[] {
  return [...new Set(addresses.map(address => getAddress(address)))].filter(address => address.toLowerCase() !== approvalAddress?.toLowerCase());
}

export type WalletBalances = { eth: bigint | null; usdc: bigint | null };
export type WalletBalanceReader = {
  getChainId: () => Promise<number>;
  getBlockNumber: () => Promise<bigint>;
  eth: (address: Address, block: bigint) => Promise<bigint>;
  usdc: (address: Address, block: bigint) => Promise<bigint>;
};

/** Both assets belong to this wallet at one block on the expected chain, never its private pool balance. */
export async function readWalletBalances(reader: WalletBalanceReader, address: Address, expectedChainId = 11155111): Promise<WalletBalances> {
  if (await reader.getChainId() !== expectedChainId) throw new Error(`Wallet balances require ${expectedChainId === 11155111 ? 'Ethereum Sepolia' : expectedChainId === 1 ? 'Ethereum mainnet' : `chain ${expectedChainId}`}.`);
  const block = await reader.getBlockNumber();
  const [eth, usdc] = await Promise.allSettled([reader.eth(address, block), reader.usdc(address, block)]);
  return { eth: eth.status === 'fulfilled' ? eth.value : null, usdc: usdc.status === 'fulfilled' ? usdc.value : null };
}

export function walletAmount(value: bigint, decimals: number, minimumFraction = 0): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '').padEnd(minimumFraction, '0');
  if (value > 0n && whole === 0n && !/[1-9]/.test(fraction)) return '<0.000001';
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}
