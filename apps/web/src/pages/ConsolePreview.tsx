import { useEffect, useState } from 'react';
import { Eye, HelpCircle, Inbox, LockKeyhole, Mail, Settings2, ShieldCheck, type LucideIcon, LogOut } from 'lucide-react';
import { Logo } from '../components/Logo';
import { MAINNET_ID, WalletGatePanel, short } from '../components/WalletGate';

// Design preview of the workspace console with sample data. It renders the same
// shell markup and classes as App.tsx without sign-in, ENS or network access.
type Envelope = { id: string; title: string; from: string; amount: string; age: string; fresh: boolean; body: string[] };
const envelopes: Envelope[] = [
  { id: '03', title: 'Payroll · October', from: 'Private', amount: '2,400.00', age: '2 min', fresh: true,
    body: ['A sealed payout for you was found in batch slot 3 of 8. Only your key could open it; nobody watching the chain can tell which slot was yours or how much it holds.',
      'Collecting adds 2,400.00 USDC to your private balance inside the pool. Nothing moves to a public wallet until you choose to withdraw.',
      'Sample data. Practice mode does not use real money.'] },
  { id: '02', title: 'Grant milestone', from: 'Private', amount: '1,150.00', age: '1 h', fresh: true, body: ['Sealed envelope. Open it to see the amount and reference.'] },
  { id: '01', title: 'Bounty · audit fix', from: 'Private', amount: '540.00', age: '3 d', fresh: false, body: ['Collected into your private balance on 18 Oct.'] },
  { id: '00', title: 'Contributor share', from: 'Private', amount: '860.00', age: '9 d', fresh: false, body: ['Collected into your private balance on 12 Oct.'] },
  { id: '—', title: 'Practice payment', from: 'Private', amount: '25.00', age: '12 d', fresh: false, body: ['A practice envelope from your first walkthrough.'] },
];
const tiles = [['T1', 'Practice', false], ['T2', 'Sepolia', false], ['T3', 'Layer 2', false], ['T4', 'Mainnet', true]] as const;
const actions = ['Collect payment', 'Withdraw', 'Save backup', 'Inspect proof'];

function Card({ icon: Icon, title, owner, meta, active, badge, onClick }: { icon: LucideIcon; title: string; owner: string; meta: string; active: boolean; badge?: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`nav-item sys-card ${active ? 'active' : ''}`} aria-current={active || undefined} style={{ width: '100%', textAlign: 'left' }}>
    <span className="sys-icon" aria-hidden><Icon size={20} strokeWidth={1.6} /></span>
    <span className="sys-body"><span className="sys-top"><span className="sys-title">{title}</span><span className="sys-owner">{owner}</span></span>
      <span className="sys-meta">{meta}</span>{badge && <span className="sys-pill">{badge}</span>}<span className="sys-tick" aria-hidden /></span>
  </button>;
}

export function ConsolePreview() {
  const [selected, setSelected] = useState(envelopes[0].id);
  const [notice, setNotice] = useState('');
  // Demo wallet: starts disconnected, connects on Base, then switches to Ethereum mainnet, like the live flow.
  const [wallet, setWallet] = useState<{ address: string; chainId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = wallet?.chainId === MAINNET_ID;
  const connect = () => { setBusy(true); window.setTimeout(() => { setWallet({ address: '0x7f3a9c2b44d1e0a6b5c8f9e2d1a0b3c4d5e6e21c', chainId: 8453 }); setBusy(false); }, 650); };
  const switchNet = () => { setBusy(true); window.setTimeout(() => { setWallet(w => w && { ...w, chainId: MAINNET_ID }); setBusy(false); }, 650); };
  useEffect(() => { document.title = 'Console · SQL'; }, []);
  const env = envelopes.find(e => e.id === selected) ?? envelopes[0];
  return <div className="app-shell term">
    <header className="term-header">
      <a className="icon-button mobile-menu" href="#/developers" aria-label="Back to home"><Logo size={20} /></a>
      <div className="term-block"><span className="term-cap">Recipient</span><span className="term-level"><small>Level</small><b>R1</b></span></div>
      <div className="term-block term-id"><span className="term-cap">#SQL4B8840</span>
        <div className="term-stamp"><Logo size={26} className="brand-logo" /><span className="term-stamp-name"><b>Protocol</b><b>SQL-0.3</b></span><p>Only key holders can open envelopes. Payouts stay sealed until claimed.</p></div>
        <span className="term-chip">ETH 1 · RAILGUN</span></div>
      <div className="term-block term-security"><span className="term-cap">Network level</span>
        <div className="term-tiles" role="list">{tiles.map(([tier, label, on]) => <span role="listitem" key={tier} className={`term-tile ${on ? 'is-on' : ''} ${tier === 'T3' || tier === 'T4' ? 'is-locked' : ''}`} title={label}><small>Level</small><b>{tier}</b><em>{label}</em></span>)}</div></div>
      <div className="term-actions">
        {ready && wallet ? <button type="button" className="wg-chip is-ok" onClick={() => setWallet(null)} title="Disconnect demo wallet"><i aria-hidden />EVM {short(wallet.address)} · SEP</button>
          : wallet ? <span className="wg-chip is-warn"><i aria-hidden />{short(wallet.address)} · wrong network</span>
          : <button type="button" className="wg-chip is-off" onClick={connect} disabled={busy}><i aria-hidden />{busy ? 'Connecting…' : 'Connect wallet'}</button>}
        <a className="button button-secondary" href="#/developers"><LogOut size={16} />Exit console</a></div>
    </header>
    <div className="term-body">
      <span className="term-marker term-marker-1" aria-hidden>1</span><span className="term-marker term-marker-2" aria-hidden>2</span>
      <span className="term-vertical" aria-hidden>00032 05 54 08 CP · 00032 05 54 08 CP</span>
      <aside className="sidebar term-systems term-systems-inline" aria-label="Envelopes">
        <div className="term-colhead"><span>Computer systems</span></div>
        <nav className="primary-navigation">
          {envelopes.map(e => <Card key={e.id} icon={e.fresh ? Mail : Inbox} title={e.title} owner={e.from} meta={ready ? `Envelope ${e.id} · ${e.age}` : `Envelope ${e.id} · wallet required`} active={e.id === selected} badge={e.fresh ? 'New' : undefined} onClick={() => { setSelected(e.id); setNotice(''); }} />)}
          <Card icon={LockKeyhole} title="Private balance" owner="You" meta={ready ? 'Notes · 3' : 'Notes · wallet required'} active={false} onClick={() => setNotice('Balance view opens in the live app.')} />
          <Card icon={Settings2} title="Settings" owner="You" meta="Config" active={false} onClick={() => setNotice('Settings open in the live app.')} />
          <Card icon={HelpCircle} title="Help" owner="SQL" meta="Manual" active={false} onClick={() => setNotice('Help opens in the live app.')} />
        </nav>
        <div className="sidebar-footer"><LockKeyhole size={12} /><span>Private payments</span></div>
      </aside>
      <div className="term-rail" aria-hidden><span className="term-rail-track"><i /></span><span className="term-rail-glyph">⇅</span><span className="term-rail-r">R</span><small>Scrl<br />4B8840</small></div>
      <div className="workspace">
        <div className="term-colhead"><span>Content</span><span className="term-colhead-path">/inbox/{env.id}</span></div>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {!ready ? <>
            <div className="page-heading"><div className="heading-row"><div><h1>Wallet required</h1></div></div></div>
            <WalletGatePanel status={wallet ? 'wrong-network' : 'disconnected'} feature="your inbox" address={wallet?.address} chainId={wallet?.chainId} busy={busy} onConnect={connect} onSwitch={switchNet} />
            <p role="status" style={{ marginTop: 12, color: 'var(--muted)' }}><Eye size={14} /> Demo: the wallet connects on Base first so you can see the switch to Ethereum mainnet.</p>
          </> : <>
          <div className="page-heading"><div className="heading-row"><div><h1>{env.fresh ? 'Sealed envelope' : 'Collected envelope'}</h1></div></div></div>
          <section aria-label="Envelope contents">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="badge">{env.fresh ? 'Unclaimed' : 'Collected'}</span>
              <span className="numeric" style={{ fontSize: 22, fontWeight: 600 }}>{env.amount}<span className="currency">USDC</span></span>
            </div>
            {env.body.map(p => <p key={p} style={{ marginTop: 12, maxWidth: '70ch' }}>{p}</p>)}
            <p style={{ marginTop: 18, color: 'var(--muted)', fontSize: 13 }}><ShieldCheck size={14} /> Sender hidden · slot {env.id} · zero-knowledge proof</p>
          </section>
          <div className="button-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 4 }}>
            {actions.map((a, i) => <button key={a} type="button" className={`button ${i === 0 ? 'button-primary' : 'button-secondary'}`} disabled={i === 0 && !env.fresh} onClick={() => setNotice(`${a}: signed by ${wallet ? short(wallet.address) : 'your wallet'} in the live app.`)}>{a}</button>)}
          </div>
          {notice && <p role="status" style={{ marginTop: 12, color: 'var(--muted)' }}><Eye size={14} /> {notice}</p>}
          </>}
        </main>
        <footer className="content-footer"><span>JHN 102 SQL 151 CC10 A55 ←</span><p>Demo workspace · sample data · no live funds</p><span className="term-marker term-marker-3" aria-hidden>3</span></footer>
      </div>
    </div>
  </div>;
}
