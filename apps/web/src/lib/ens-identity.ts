import { getAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import { assertEnsChain, inspectPaymentName, normalizePaymentName, PaymentNameError } from '@null-protocol/ens';

export type EnsIdentity = { status: 'verified'; name: string; address: Address; source: 'address' | 'owner' } | { status: 'missing' | 'error' | 'loading'; name?: never };
export type EnsAddress = { name: string; address: Address };
export type IdentityReader = {
  primaryName: (address: Address) => Promise<string | null>;
  address: (name: string) => Promise<Address | null>;
  owner: (name: string) => Promise<Address>;
};

// Ownership can identify a name's controller, but is NEVER a withdrawal destination
// or proof of organization membership. Transfers always use the address record.
export async function findEnsIdentity(reader: IdentityReader, addressInput: string, hints: readonly string[] = []): Promise<EnsIdentity> {
  const address = getAddress(addressInput);
  let failed = false;
  for (const hint of [...new Set(hints)]) {
    let name: string;
    try { name = normalizePaymentName(hint); } catch { continue; }
    try {
      const owner = await reader.owner(name);
      if (owner.toLowerCase() === address.toLowerCase()) return { status: 'verified', name, address, source: 'owner' };
    } catch (error) {
      // Expired/unregistered hints must not revive a stale wildcard address record.
      if (error instanceof PaymentNameError && error.code === 'missing') continue;
      failed = true; continue;
    }
    try {
      const resolved = await reader.address(name);
      if (resolved?.toLowerCase() === address.toLowerCase()) return { status: 'verified', name, address, source: 'address' };
    } catch { failed = true; }
  }
  try {
    const reverse = await reader.primaryName(address);
    if (reverse) {
      const name = normalizePaymentName(reverse);
      await reader.owner(name); // Also reject expired names served by a parent wildcard.
      const resolved = await reader.address(name);
      if (resolved?.toLowerCase() === address.toLowerCase()) return { status: 'verified', name, address, source: 'address' };
    }
  } catch (error) { if (!(error instanceof PaymentNameError && error.code === 'missing')) failed = true; }
  return { status: failed ? 'error' : 'missing' };
}

export async function resolveEnsIdentity(client: PublicClient, address: string, hints: readonly string[] = []) {
  await assertEnsChain(client);
  return findEnsIdentity({
    primaryName: address => client.getEnsName({ address }),
    address: name => client.getEnsAddress({ name }),
    owner: async name => (await inspectPaymentName(client, name)).owner,
  }, address, hints);
}

export async function resolveEnsAddress(client: PublicClient, input: string): Promise<EnsAddress> {
  const name = normalizePaymentName(input);
  const inspected = await inspectPaymentName(client, name);
  let address: Address | null;
  try { address = await client.getEnsAddress({ name, blockNumber: BigInt(inspected.blockNumber) }); }
  catch { throw new PaymentNameError('network', 'Could not check this ENS address on Sepolia. Try again.'); }
  if (!address || address === zeroAddress) throw new PaymentNameError('missing', 'This ENS name has no receiving wallet on Sepolia. Ask its owner to set its ETH address record. A SQL Payment ID cannot be used for a public withdrawal.');
  return { name, address: getAddress(address) };
}

export async function recheckEnsAddress(client: PublicClient, previous: EnsAddress) {
  const current = await resolveEnsAddress(client, previous.name);
  if (current.address.toLowerCase() !== previous.address.toLowerCase()) throw new PaymentNameError('changed', 'This ENS name now points to a different wallet. Check the name and confirm the new destination before continuing.');
  return current;
}

export function ensIdentityLabel(identity: EnsIdentity | undefined, fallback = 'Wallet') {
  if (identity?.status === 'verified') return identity.name;
  return `${fallback} · ${identity?.status === 'loading' ? 'Checking ENS…' : identity?.status === 'error' ? 'ENS lookup unavailable' : 'ENS name needed'}`;
}

export function ensIdentityOption(identity: EnsIdentity, walletLabel: string) {
  return identity.status === 'verified' ? `${identity.name} · ${walletLabel}` : ensIdentityLabel(identity, walletLabel);
}
