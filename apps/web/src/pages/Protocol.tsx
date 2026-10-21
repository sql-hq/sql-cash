import { useState } from 'react';
import { createPublicClient, http, toHex } from 'viem';
import { nullPoolAbi } from '@null-protocol/contracts';
import { Activity, Database, Globe, KeyRound, Radio, RefreshCw, Shield, TriangleAlert } from 'lucide-react';
import { config } from '../lib/config';
import { short } from '../lib/format';
import { Logo } from '../components/Logo';
import { Badge, Button, CopyButton, ExternalLink, KeyValue, Notice, PageHeader, SectionTitle } from '../components/ui';

type Snapshot = {
  block: string; noteCount: string; distributionCount: string; checkedAt: string;
  noteRoot: string; distributionRoot: string;
  shieldVerifier: string; distributionVerifier: string; claimVerifier: string; withdrawVerifier: string;
};
type ServiceState = { status: 'Not checked' | 'Checking' | 'Responding' | 'Unavailable'; detail?: string };
const initialService: ServiceState = { status: 'Not checked' };
const number = (value: string) => BigInt(value).toLocaleString();

export function Protocol() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [rpc, setRpc] = useState<ServiceState>(initialService);
  const [graph, setGraph] = useState<ServiceState>(initialService);
  const [relayer, setRelayer] = useState<ServiceState>(initialService);
  const [checkedAt, setCheckedAt] = useState('');
  const poolConfigured = Boolean(config.poolAddress && /^0x[0-9a-fA-F]{40}$/.test(config.poolAddress));

  async function checkPool() {
    try {
      if (!poolConfigured) throw new Error('The pool address is missing or invalid. Ask your administrator to finish the connection setup.');
      const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 12000, retryCount: 1 }) });
      if (await client.getChainId() !== Number(config.chainId)) throw new Error('The connection returned a different network. Ask your administrator to check the Sepolia connection.');
      const block = await client.getBlockNumber();
      const code = await client.getCode({ address: config.poolAddress!, blockNumber: block });
      if (!code || code === '0x') throw new Error('No contract was found at this pool address. Ask your administrator to check the deployment.');
      // Keep roots, counts, and verifier addresses in the same block snapshot.
      const read = (functionName: 'noteRoot' | 'distributionRoot' | 'nextNoteIndex' | 'nextDistributionIndex' | 'shieldVerifier' | 'createDistributionVerifier' | 'claimVerifier' | 'withdrawVerifier') => client.readContract({ address: config.poolAddress!, abi: nullPoolAbi, functionName, blockNumber: block });
      const [noteRoot, distributionRoot, noteCount, distributionCount, shieldVerifier, distributionVerifier, claimVerifier, withdrawVerifier] = await Promise.all([
        read('noteRoot'), read('distributionRoot'), read('nextNoteIndex'), read('nextDistributionIndex'),
        read('shieldVerifier'), read('createDistributionVerifier'), read('claimVerifier'), read('withdrawVerifier'),
      ]);
      setSnapshot({ block: String(block), noteRoot: toHex(BigInt(noteRoot), { size: 32 }), distributionRoot: toHex(BigInt(distributionRoot), { size: 32 }), noteCount: String(noteCount), distributionCount: String(distributionCount), shieldVerifier: String(shieldVerifier), distributionVerifier: String(distributionVerifier), claimVerifier: String(claimVerifier), withdrawVerifier: String(withdrawVerifier), checkedAt: new Date().toLocaleTimeString() });
      setRpc({ status: 'Responding' });
    } catch (reason) {
      setRpc({ status: 'Unavailable' });
      setError(reason instanceof Error && reason.constructor === Error ? reason.message : 'We couldn’t read the public pool. Check your connection and try again.');
    }
  }

  async function checkService(kind: 'graph' | 'relayer', url: string) {
    const update = kind === 'graph' ? setGraph : setRelayer;
    try {
      const response = await fetch(kind === 'graph' ? url : `${url.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(8000), credentials: 'omit', cache: 'no-store',
        ...(kind === 'graph' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ _meta { block { number } hasIndexingErrors } }' }) } : {}),
      });
      if (!response.ok) throw new Error('Unavailable');
      const body = await response.json();
      if (kind === 'graph') {
        const meta = body?.data?._meta;
        if (body.errors?.length || !meta || meta.hasIndexingErrors !== false || !Number.isSafeInteger(meta.block?.number) || meta.block.number < 0) throw new Error('Unavailable');
        update({ status: 'Responding', detail: `Indexed through block ${meta.block.number.toLocaleString()}.` });
      } else {
        if (body?.status !== 'configured') throw new Error('Unavailable');
        update({ status: 'Responding' });
      }
    } catch { update({ status: 'Unavailable', detail: 'Could not complete the check. Try again later.' }); }
  }

  async function refresh() {
    setBusy(true); setError(''); setCheckedAt(''); setRpc({ status: 'Checking' });
    if (config.graphUrl) setGraph({ status: 'Checking' });
    if (config.relayerUrl) setRelayer({ status: 'Checking' });
    try {
      await Promise.allSettled([checkPool(), ...(config.graphUrl ? [checkService('graph', config.graphUrl)] : []), ...(config.relayerUrl ? [checkService('relayer', config.relayerUrl)] : [])]);
      setCheckedAt(new Date().toLocaleTimeString());
    } finally { setBusy(false); }
  }

  const services = [
    { name: 'Network connection', icon: Globe, description: 'Reads the public pool directly from Sepolia.', status: rpc.status },
    { name: 'Payment history', icon: Database, description: graph.detail || 'The Graph finds public payment events.', status: config.graphUrl ? graph.status : 'Not set up' },
    { name: 'Transaction relayer', icon: Radio, description: relayer.detail || 'Broadcasts proofs. A connected wallet can also send.', status: config.relayerUrl ? relayer.status : 'Not set up' },
    { name: 'Wallet connection', icon: KeyRound, description: 'Reown wallet connection. Availability is not checked here.', status: config.reownProjectId ? 'Configured' : 'Not set up' },
    { name: 'Confidential workflow', icon: Shield, description: 'Chainlink CRE compilation. Deployment is not verified here.', status: 'Not verified' },
  ];
  const status = busy ? 'Checking connections' : error ? 'The pool check needs attention' : snapshot ? 'Public pool is responding' : 'Check your connection';

  return <div className="protocol-page">
    <PageHeader title="Connection status" description="Check the public pool and the services used by your workspace." />
    <section className="protocol-overview" aria-labelledby="protocol-status-heading">
      <div className="protocol-network"><span className="protocol-brand"><Logo size={24} /><strong>SQL</strong><span>v0.1</span></span><Badge>Sepolia test network</Badge></div>
      <div className="protocol-check"><div><h2 id="protocol-status-heading">{status}</h2><p>{busy ? 'Reading public data and checking configured services…' : error ? 'Other service results are listed below. You can retry the check.' : snapshot ? 'The latest read succeeded. Review each service below for its own status.' : 'Run a check to see what is available. This does not send a transaction.'}</p></div><Button icon={RefreshCw} busy={busy} onClick={() => void refresh()}>{busy ? 'Checking…' : checkedAt ? 'Check again' : 'Check connections'}</Button></div>
      <p className="protocol-check-time" role="status">{checkedAt ? `Check completed at ${checkedAt}. Results do not update automatically.` : 'Public network data only. No wallet approval needed.'}</p>
    </section>
    {error && <div className="form-error protocol-error" role="alert">{error}{snapshot && ' The last successful snapshot is kept below.'}</div>}
    <div className="protocol-columns">
      <section aria-labelledby="protocol-services-heading"><h2 id="protocol-services-heading">Workspace services</h2><p className="protocol-section-caption">Configured means a connection is saved; it does not confirm availability.</p>
        <ul className="protocol-services">{services.map(({ name, icon: Icon, description, status: serviceStatus }) => <li key={name}><Icon size={18} aria-hidden="true" /><div><strong>{name}</strong><p>{description}</p></div><Badge tone={serviceStatus === 'Responding' ? 'success' : serviceStatus === 'Unavailable' ? 'warning' : 'neutral'}>{serviceStatus === 'Checking' ? 'Checking…' : serviceStatus}</Badge></li>)}</ul>
      </section>
      <section className="protocol-snapshot" aria-labelledby="protocol-pool-heading"><h2 id="protocol-pool-heading">Public pool</h2><p className="protocol-section-caption">The contract that records private notes and distributions.</p>
        <div className="protocol-address"><span>Pool address</span>{poolConfigured ? <><code>{config.poolAddress}</code><div><ExternalLink href={`https://sepolia.etherscan.io/address/${config.poolAddress}`}>View contract</ExternalLink><CopyButton value={config.poolAddress!} /></div></> : <p>Not set up. Ask your administrator to configure the pool.</p>}</div>
        {snapshot ? <><div className="protocol-snapshot-caption"><Activity size={15} aria-hidden="true" /><span>{error ? 'Last successful read' : 'Snapshot'} · {snapshot.checkedAt}</span>{error && <Badge tone="warning">May be outdated</Badge>}</div><div className="detail-list"><KeyValue label="Block read"><ExternalLink href={`https://sepolia.etherscan.io/block/${snapshot.block}`}>{number(snapshot.block)}</ExternalLink></KeyValue><KeyValue label="Private notes recorded">{number(snapshot.noteCount)}</KeyValue><KeyValue label="Distributions recorded">{number(snapshot.distributionCount)}</KeyValue></div><p className="protocol-section-caption">Public counts across the pool, not your balance or payment history.</p></> : <div className="protocol-unread"><Activity size={20} aria-hidden="true" /><strong>{busy ? 'Reading the pool…' : 'No snapshot yet'}</strong><p>{error ? 'A snapshot will appear after a successful check.' : 'Check connections to load the current block and public counts.'}</p></div>}
      </section>
    </div>
    <details className="progressive-details protocol-technical"><summary>Technical details</summary><p>SQL v0.1 supports eight-slot distributions and a single asset. Roots and verifier addresses come from the same block as the pool snapshot.</p>
      {snapshot ? <><SectionTitle title="Commitment roots" caption="Public fingerprints of the note and distribution trees." /><div className="detail-list">{[['Note root', snapshot.noteRoot], ['Distribution root', snapshot.distributionRoot]].map(([label, value]) => <KeyValue key={label} label={label!}><span className="code-with-copy"><code title={value}>{short(value!, 12)}</code><CopyButton value={value!} /></span></KeyValue>)}</div><SectionTitle title="Proof verifiers" caption="Addresses alone do not establish safety. Verify deployed bytecode and proving-artifact hashes before using funds." /><div className="detail-list">{[['Shield', snapshot.shieldVerifier], ['Create distribution', snapshot.distributionVerifier], ['Claim', snapshot.claimVerifier], ['Withdraw', snapshot.withdrawVerifier]].map(([label, value]) => <KeyValue key={label} label={label!}><ExternalLink href={`https://sepolia.etherscan.io/address/${value}`}><code>{short(value!, 12)}</code></ExternalLink></KeyValue>)}</div>{error && <p>These values belong to the last successful read and may be outdated.</p>}</> : <p>Run a successful connection check to inspect commitment roots and proof-verifier addresses.</p>}
    </details>
    <Notice tone="warning" icon={TriangleAlert}><strong>Test tokens only.</strong> SQL is a prototype without an independent security review. A successful connection check does not verify contract safety or prove that every payment feature is ready.</Notice>
  </div>;
}
