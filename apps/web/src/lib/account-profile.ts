import type { Route } from './store';
import { normalizePaymentName } from '@null-protocol/ens';
import { getAddress, isAddress, zeroAddress } from 'viem';

export type AccountType = 'individual' | 'organization';
export type WorkspaceProfile = { type: AccountType; organizationName?: string; ensName?: string; organizationAddress?: string };

// This is a local UI preference, never proof of organization membership.
export function profileStorageKey(userId: string) { return `null:workspace:v1:${encodeURIComponent(userId)}`; }
export function parseProfile(raw: string | null): WorkspaceProfile | null {
  try {
    const value: unknown = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object' || !('type' in value)) return null;
    const ensName = 'ensName' in value && typeof value.ensName === 'string' ? normalizePaymentName(value.ensName) : undefined;
    if (value.type === 'individual') return { type: 'individual', ...(ensName ? { ensName } : {}) };
    if (value.type !== 'organization' || !('organizationName' in value) || typeof value.organizationName !== 'string') return null;
    const name = value.organizationName.trim();
    const organizationAddress = 'organizationAddress' in value && typeof value.organizationAddress === 'string' && isAddress(value.organizationAddress) && value.organizationAddress !== zeroAddress ? getAddress(value.organizationAddress) : undefined;
    return name && name.length <= 50 ? { type: 'organization', organizationName: name, ...(ensName ? { ensName } : {}), ...(organizationAddress ? { organizationAddress } : {}) } : null;
  } catch { return null; }
}

const shared: Route[] = ['settings', 'about', 'inspector', 'protocol'];
export function resolveRoute(hash: string, type: AccountType): Route {
  const requested = hash.replace(/^#\/?/, '').split('?')[0];
  const allowed: Route[] = [...shared, ...(type === 'organization' ? ['overview', 'treasury', 'distributions', 'new'] as const : ['inbox', 'balance'] as const)];
  return allowed.includes(requested as Route) ? requested as Route : type === 'organization' ? 'overview' : 'inbox';
}
