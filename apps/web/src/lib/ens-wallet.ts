import { zeroAddress, type Address } from 'viem';
import { PaymentNameError } from '@null-protocol/ens';

export type NameWallet = { address: Address; label: string };

/** Prefer the name owner, but verify resolver permission for every candidate. */
export async function findNameWallet(wallets: readonly NameWallet[], owner: Address, canUpdate: (address: Address) => Promise<boolean>): Promise<NameWallet | undefined> {
  const unique = [...new Map(wallets.map(wallet => [wallet.address.toLowerCase(), wallet])).values()];
  const ordered = [...unique.filter(wallet => wallet.address.toLowerCase() === owner.toLowerCase()),
    ...unique.filter(wallet => wallet.address.toLowerCase() !== owner.toLowerCase())];
  let failed = false;
  for (const wallet of ordered) {
    try { if (await canUpdate(wallet.address)) return wallet; }
    catch { failed = true; }
  }
  if (failed) throw new Error('Wallet permissions could not be checked. Try again.');
  return undefined;
}

/** Deployment hints are candidates only. Recheck current ownership and record access. */
export async function findAssignedNames(
  names: readonly string[], wallets: readonly NameWallet[],
  inspect: (name: string) => Promise<{ name: string; owner: Address }>,
  canUpdate: (name: string, wallet: Address) => Promise<boolean>,
): Promise<string[]> {
  const found: string[] = [];
  if (!wallets.length) return found;
  for (const name of new Set(names)) {
    let current: Awaited<ReturnType<typeof inspect>>;
    try { current = await inspect(name); }
    catch (error) {
      if (error instanceof PaymentNameError && ['invalid', 'missing', 'unsupported'].includes(error.code)) continue;
      throw error;
    }
    if (current.owner === zeroAddress || !wallets.some(wallet => wallet.address.toLowerCase() === current.owner.toLowerCase())) continue;
    if (await findNameWallet(wallets, current.owner, address => canUpdate(current.name, address))) found.push(current.name);
  }
  return [...new Set(found)];
}
