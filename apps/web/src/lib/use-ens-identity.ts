import { useEffect, useState, useSyncExternalStore } from 'react';
import { ensClient } from './ens';
import { ensIdentityLabel, resolveEnsIdentity, type EnsIdentity } from './ens-identity';
import { useAccount } from './account';
import { useSession } from './session';
import deployment from '../../../../deployments/ens-sepolia.json';

const cache = new Map<string, { expires: number; result: Promise<EnsIdentity> }>();
const listeners = new Set<() => void>();
let cacheRevision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getRevision = () => cacheRevision;
function refreshIdentities() { cache.clear(); cacheRevision++; listeners.forEach(listener => listener()); }
export type IdentityRequest = { address: string; hints?: readonly string[] };
export function useEnsIdentities(requests: readonly IdentityRequest[]) {
  const key = JSON.stringify(requests.map(({ address, hints = [] }) => ({ address: address.toLowerCase(), hints: [...new Set(hints.filter(Boolean))] })));
  const [snapshot, setSnapshot] = useState<{ key: string; values: Record<string, EnsIdentity> }>({ key: '', values: {} });
  const [revision, setRevision] = useState(0);
  const sharedRevision = useSyncExternalStore(subscribe, getRevision, getRevision);
  useEffect(() => {
    let active = true;
    const entries = JSON.parse(key) as IdentityRequest[];
    setSnapshot({ key, values: Object.fromEntries(entries.map(item => [item.address, { status: 'loading' }])) });
    for (const item of entries) {
      if (!item.address) continue;
      const assigned = [deployment.recipientSetup, ...deployment.recipientAssignments].filter(assignment => assignment.wallet.toLowerCase() === item.address).map(assignment => assignment.name);
      const hints = [...new Set([...(item.hints ?? []), ...assigned])];
      const cacheKey = JSON.stringify([item.address, hints]);
      let cached = cache.get(cacheKey);
      if (!cached || cached.expires <= Date.now()) {
        const result = resolveEnsIdentity(ensClient, item.address, hints).catch((): EnsIdentity => ({ status: 'error' }));
        cached = { expires: Date.now() + 60_000, result };
        if (cache.size > 100) cache.clear();
        cache.set(cacheKey, cached);
      }
      void cached.result.then(identity => { if (active) setSnapshot(previous => ({ key, values: { ...previous.values, [item.address]: identity } })); });
    }
    const timer = window.setTimeout(() => setRevision(value => value + 1), 60_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, revision, sharedRevision]);
  return {
    get: (address?: string): EnsIdentity => snapshot.key === key && address ? snapshot.values[address.toLowerCase()] ?? { status: 'loading' } : { status: 'loading' },
    retry: refreshIdentities,
  };
}

export function useWorkspaceIdentity() {
  const { profile } = useAccount();
  const session = useSession();
  const addresses = profile?.type === 'organization' ? [profile.organizationAddress].filter((value): value is string => !!value) : session.walletAddresses ?? [];
  const identities = useEnsIdentities(addresses.map(address => ({ address, hints: profile?.ensName ? [profile.ensName] : [] })));
  const results = addresses.map(address => identities.get(address));
  const verified = results.find(result => result.status === 'verified' && (!profile?.ensName || result.name === profile.ensName));
  const state = verified ?? results.find(result => result.status === 'loading') ?? results.find(result => result.status === 'error') ?? { status: 'missing' as const };
  const fallback = profile?.type === 'organization' ? 'Organization' : 'Account';
  return { ...identities, identity: state, label: ensIdentityLabel(state, fallback) };
}
