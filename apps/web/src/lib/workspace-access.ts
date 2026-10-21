import type { PublicClient } from 'viem';
import { normalizePaymentName, PaymentNameError, resolvePaymentName, type PaymentNameSnapshot } from '@null-protocol/ens';
import type { WorkspaceProfile } from './account-profile';
import { resolveEnsIdentity } from './ens-identity';

export type WorkspaceAccessInput = {
  profile: WorkspaceProfile;
  walletAddresses: readonly string[];
  organizationAddress?: string;
  paymentProfile: string;
  backedUp: boolean;
};
export type LinkedWorkspace = { name: string; address: string; type: WorkspaceProfile['type']; receivingName?: PaymentNameSnapshot };
export type AccessReaders = {
  identity: typeof resolveEnsIdentity;
  payment: typeof resolvePaymentName;
};

/** Saved names and wallet addresses are preferences, never evidence of a live link. */
export async function verifyWorkspaceAccess(client: PublicClient, input: WorkspaceAccessInput,
  readers: AccessReaders = { identity: resolveEnsIdentity, payment: resolvePaymentName }): Promise<LinkedWorkspace> {
  if (!input.profile.ensName) throw new PaymentNameError('missing', 'Link your ENS name before opening the workspace.');
  const name = normalizePaymentName(input.profile.ensName);
  const addresses = input.profile.type === 'organization'
    ? input.organizationAddress ? [input.organizationAddress] : [] : input.walletAddresses;
  if (!addresses.length) throw new PaymentNameError('permission', input.profile.type === 'organization'
    ? 'Connect your organization account so we can verify its approval wallet.' : 'Connect the wallet that owns your ENS name.');
  const identities = await Promise.all(addresses.map(address => readers.identity(client, address, [name])));
  const linked = identities.find(identity => identity.status === 'verified' && identity.name === name);
  if (!linked || linked.status !== 'verified') throw new PaymentNameError(identities.some(identity => identity.status === 'error') ? 'network' : 'permission',
    identities.some(identity => identity.status === 'error') ? 'We could not verify your ENS link. Check the connection and try again.'
      : input.profile.type === 'organization' ? 'This ENS name must belong to, or resolve to, your organization’s approval wallet.' : 'This ENS name is not linked to one of your connected wallets.');
  let receivingName: PaymentNameSnapshot | undefined;
  if (input.profile.type === 'individual') {
    if (!input.backedUp) throw new PaymentNameError('permission', 'Restore your existing Payment ID or save its backup before linking your inbox.');
    const payment = await readers.payment(client, name);
    if (payment.profile !== input.paymentProfile) throw new PaymentNameError('changed', 'This name is linked to a different Payment ID. Restore its original backup, or explicitly link your current Payment ID.');
    receivingName = payment;
  }
  return { name, address: linked.address, type: input.profile.type, ...(receivingName ? { receivingName } : {}) };
}

export function requireOrganizationSigner(linked: LinkedWorkspace, signer: string) {
  if (linked.type !== 'organization' || linked.address.toLowerCase() !== signer.toLowerCase()) {
    throw new PaymentNameError('changed', 'This organization setup uses a different signer. Link that organization’s ENS name before paying.');
  }
}
