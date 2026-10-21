import { useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, LockKeyhole, Plus, Search, Send, ShieldCheck } from 'lucide-react';
import { useStore, type Distribution } from '../lib/store';
import { useWorkspaceIdentity } from '../lib/use-ens-identity';
import { config } from '../lib/config';
import { amount, date, money } from '../lib/format';
import { paymentStatusLabel } from '../lib/ui-copy';
import { Badge, Button, EmptyState, KeyValue, Modal, Notice, PageHeader, SectionTitle } from '../components/ui';

const isPublished = (item: Distribution) => ['Published locally', 'Confirmed'].includes(item.status);

export function DistributionTable({ items, compact = false }: { items: Distribution[]; compact?: boolean }) {
  const store = useStore();
  const [selected, setSelected] = useState<Distribution | null>(null);
  const openDistribution = (item: Distribution) => isPublished(item) ? setSelected(item) : store.editDistribution(item.id);

  return <>
    {items.length ? <div className="table-scroll"><table className="distribution-table">
      <thead><tr><th>Payment</th><th>People</th><th>Total</th><th>Status</th>{!compact && <th>Created</th>}<th><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id}>
        <td><button className="table-title" onClick={() => openDistribution(item)}><span className="distribution-icon"><Send size={17} strokeWidth={1.6} /></span><span><strong>{item.name}</strong>{!compact && <small>{item.category}</small>}</span></button></td>
        <td><span className="recipient-count">{item.recipients.length}</span></td>
        <td className="numeric"><strong>{store.hideBalances ? '••••••' : money(item.recipients.reduce((sum, row) => sum + amount(row.amount), 0n))}</strong><span className="currency">USDC</span></td>
        <td><Badge tone={isPublished(item) ? 'success' : item.status === 'Prepared' ? 'purple' : 'neutral'} dot>{paymentStatusLabel(item.status)}</Badge></td>
        {!compact && <td className="muted">{date(item.createdAt)}</td>}
        <td><button className="icon-button" aria-label={`Open ${item.name}`} onClick={() => openDistribution(item)}><ChevronRight size={16} /></button></td>
      </tr>)}</tbody>
    </table></div> : <EmptyState icon={Send} title="Make your first payment" description="Add recipients and amounts to get started." action={<Button icon={Plus} onClick={() => store.editDistribution(null)}>New payment</Button>} />}
    <Modal title={selected?.name || 'Payment'} description={selected?.status === 'Confirmed' ? 'Sent on the test network' : 'Sent in practice · No real money moved'} open={!!selected} onClose={() => setSelected(null)}>
      {selected && <>
        <div className="detail-list">
          <KeyValue label="Status"><Badge tone="success">{paymentStatusLabel(selected.status)}</Badge></KeyValue>
          <KeyValue label="People paid">{selected.recipients.length}</KeyValue>
          <KeyValue label="Total">{store.hideBalances ? '••••••' : money(selected.recipients.reduce((sum, row) => sum + amount(row.amount), 0n), true)} USDC</KeyValue>
        </div>
        <Notice>{selected.status === 'Confirmed' ? 'Each person can now open their inbox to collect their payment.' : 'This practice payment lasts until you reload or sign out. It cannot be restored later.'}</Notice>
        {selected.transactionHash && <a className="text-link" href={`https://sepolia.etherscan.io/tx/${selected.transactionHash}`} target="_blank" rel="noreferrer">View payment receipt<ArrowUpRight size={14} /></a>}
        <div className="modal-actions"><Button onClick={() => setSelected(null)}>Done<Check size={15} /></Button></div>
      </>}
    </Modal>
  </>;
}

export function Overview() {
  const store = useStore();
  const workspaceIdentity = useWorkspaceIdentity();
  const drafts = store.distributions.filter(item => !isPublished(item));
  const pending = drafts.reduce((total, item) => total + item.recipients.reduce((sum, row) => sum + amount(row.amount), 0n), 0n);

  return <>
    <PageHeader title={workspaceIdentity.label} action={<Button icon={Plus} onClick={() => store.editDistribution(null)}>New payment</Button>} />
    {store.mode === 'testnet' && !store.treasuryReady && <Notice tone="warning">{config.poolAddress ? 'Check your funds before making a payment.' : 'Payments are not set up yet. Check your connection in Settings.'}<button className="text-link" onClick={() => store.navigate(config.poolAddress ? 'treasury' : 'settings')}>{config.poolAddress ? 'Check funds' : 'Open settings'}<ArrowRight size={14} /></button></Notice>}
    <div className="overview-account-grid"><section className="private-balance-panel organization-treasury" aria-label="Available funds">
      <div className="balance-label"><span><ShieldCheck size={17} />Available funds</span><Badge tone="purple">{store.mode === 'sandbox' ? 'Practice money' : store.treasuryReady ? 'Last checked' : 'Not checked yet'}</Badge></div>
      <div className="balance-value">{!store.treasuryReady ? '—' : store.hideBalances ? '••••••' : money(store.treasury)}<span>USDC</span></div>
      <div className="balance-bottom"><p>{store.mode === 'sandbox' ? 'Practice money only.' : store.treasuryReady ? 'Checked again before you send a payment.' : 'Check your funds to see the balance.'}</p><button className="text-link" onClick={() => store.navigate('treasury')}>Manage funds<ArrowRight size={14} /></button></div>
      <div className="treasury-ledger"><div><span>Total in drafts</span><strong>{store.hideBalances ? '••••••' : money(pending)} <small>USDC</small></strong></div><div><span>Draft payments</span><strong>{drafts.length}</strong></div></div>
    </section>
    <section className="workspace-next" aria-labelledby="workspace-next-heading"><div className="workspace-next-heading"><h2 id="workspace-next-heading">Drafts</h2><span>{drafts.length} draft{drafts.length === 1 ? '' : 's'}</span></div>
      {drafts.length ? <div className="draft-shortcuts">{drafts.slice(0, 3).map(item => <button key={item.id} onClick={() => store.editDistribution(item.id)}><span className="draft-shortcut-icon"><Send size={17} strokeWidth={1.6} /></span><span><strong>{item.name}</strong><small>{item.recipients.length} recipient{item.recipients.length === 1 ? '' : 's'} · {paymentStatusLabel(item.status)}</small></span><ChevronRight size={16} /></button>)}</div> : <div className="workspace-next-empty"><p>No drafts yet.</p><Button variant="secondary" icon={Plus} onClick={() => store.editDistribution(null)}>New payment</Button></div>}

    </section></div>
    <section className="section-block">
      <SectionTitle title="Recent payments" caption={drafts.length ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} · ${store.hideBalances ? '••••••' : money(pending)} USDC in drafts` : undefined} action={store.distributions.length ? <button className="text-link" onClick={() => store.navigate('distributions')}>View all<ArrowRight size={14} /></button> : undefined} />
      <div className="table-panel"><DistributionTable items={store.distributions.slice(0, 4)} compact /></div>
    </section>
    <details className="progressive-details workspace-activity">
      <summary>Recent activity{store.activities.length > 0 && <Badge>{store.activities.length}</Badge>}</summary>
      {store.activities.length ? <div className="activity-list">{store.activities.slice(0, 6).map(item => <div className="activity-row" key={item.id}>
        <span className="activity-icon">{item.type === 'shield' ? <ArrowDownLeft size={16} /> : item.type === 'distribution' ? <Send size={16} /> : item.type === 'claim' ? <LockKeyhole size={16} /> : <Check size={16} />}</span>
        <div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{new Date(item.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>
      </div>)}</div> : <p className="subtle-empty">Your payment and balance updates will appear here.</p>}
    </details>
  </>;
}

export function Distributions() {
  const store = useStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All payments');
  const filtered = store.distributions.filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'All payments' || (filter === 'Drafts' ? item.status === 'Draft' : filter === 'Ready to send' ? item.status === 'Prepared' : isPublished(item))));

  return <>
    <PageHeader title="Payments" action={<Button icon={Plus} onClick={() => store.editDistribution(null)}>New payment</Button>} />
    {store.distributions.length > 0 && <div className="list-toolbar">
      <div className="tabs" role="group" aria-label="Filter payments">{['All payments', 'Drafts', 'Ready to send', 'Sent'].map(tab => <button key={tab} aria-pressed={tab === filter} className={tab === filter ? 'selected' : ''} onClick={() => setFilter(tab)}>{tab}{tab === 'All payments' && <span>{store.distributions.length}</span>}</button>)}</div>
      <label className="search-field"><Search size={16} /><input aria-label="Search payments" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search payments…" /></label>
    </div>}
    <div className="table-panel">
      {filtered.length || !search && filter === 'All payments' ? <DistributionTable items={filtered} /> : <EmptyState icon={Search} title="No matching payments" description="Try another name or clear the filters." action={<Button variant="secondary" onClick={() => { setSearch(''); setFilter('All payments'); }}>Clear filters</Button>} />}
      {store.distributions.length > 0 && <div className="table-footer"><span>{filtered.length} payment{filtered.length !== 1 ? 's' : ''}</span><span>Amounts are private to your workspace</span></div>}
    </div>
  </>;
}
