import { useEnsIdentities } from '../lib/use-ens-identity';
import { ensIdentityLabel } from '../lib/ens-identity';
import { CopyButton } from './ui';

export function EnsIdentity({ address, hints = [], fallback = 'Wallet', details = true }: { address: string; hints?: readonly string[]; fallback?: string; details?: boolean }) {
  const identities = useEnsIdentities([{ address, hints }]);
  const identity = identities.get(address);
  return <span className="ens-identity">
    <bdi className="ens-identity-name">{ensIdentityLabel(identity, fallback)}</bdi>
    {identity.status === 'verified' && <small>{identity.source === 'owner' ? 'ENS name owner' : 'ENS address verified'} · Sepolia</small>}
    {identity.status === 'error' && <button type="button" className="text-link" onClick={identities.retry}>Retry ENS lookup</button>}
    {details && <details className="ens-identity-details"><summary>Wallet details</summary><span className="code-with-copy"><code>{address}</code><CopyButton value={address} /></span></details>}
  </span>;
}
