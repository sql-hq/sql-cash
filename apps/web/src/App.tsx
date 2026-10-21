import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, HelpCircle, Inbox, LayoutDashboard, LockKeyhole, Menu, Send, Settings2, Wallet, X, type LucideIcon } from 'lucide-react';
import { Logo } from './components/Logo';
import { StoreProvider, useStore, type Route } from './lib/store';
import { useSession } from './lib/session';
import { AccountProvider, useAccount } from './lib/account';
import { resolveRoute } from './lib/account-profile';
import { WalletConnection } from './components/WalletConnection';
import { WalletGate, WalletStatusChip, useEvmWallet } from './components/WalletGate';
import { SignIn, ChooseAccount } from './components/Onboarding';
import { EnsAccessGate } from './components/EnsAccessGate';
import { Overview, Distributions } from './pages/Overview';
import { DistributionWizard } from './pages/DistributionWizard';
import { Treasury } from './pages/Treasury';
import { PrivateInbox, PrivateBalance } from './pages/Recipient';
import { Inspector, Protocol, Settings, About } from './pages/Workspace';
import { config } from './lib/config';
const RailgunVault = lazy(() => import('./pages/RailgunConsole').then(m => ({ default: m.RailgunVault })));
const RailgunPayout = lazy(() => import('./pages/RailgunConsole').then(m => ({ default: m.RailgunPayout })));
const RailgunReceive = lazy(() => import('./pages/RailgunConsole').then(m => ({ default: m.RailgunReceive })));
const MainnetHelp = lazy(() => import('./pages/RailgunConsole').then(m => ({ default: m.MainnetHelp })));
const MainnetStatus = lazy(() => import('./pages/RailgunConsole').then(m => ({ default: m.MainnetStatus })));
const MAINNET = config.network === 'mainnet';

type NavItem = { route: Route; label: string; icon: LucideIcon; meta: string };
const organizationNavigation: NavItem[] = [{ route: 'overview', label: 'Overview', icon: LayoutDashboard, meta: 'Status' }, { route: 'distributions', label: 'Payments', icon: Send, meta: 'Batches' }, { route: 'treasury', label: 'Funds', icon: Wallet, meta: 'Vault' }];
const individualNavigation: NavItem[] = [{ route: 'inbox', label: 'Inbox', icon: Inbox, meta: 'Envelopes' }, { route: 'balance', label: 'Balance', icon: LockKeyhole, meta: 'Notes' }];
const extraTitles: Partial<Record<Route, string>> = { new: 'New payment', settings: 'Settings', about: 'Help', inspector: 'Advanced privacy details', protocol: 'Connection status' };

const mainnetOrganizationNavigation: NavItem[] = [{ route: 'treasury', label: 'Private vault', icon: Wallet, meta: 'Railgun' }, { route: 'distributions', label: 'Payouts', icon: Send, meta: 'Private' }];
const mainnetIndividualNavigation: NavItem[] = [{ route: 'inbox', label: 'Receive', icon: Inbox, meta: '0zk address' }, { route: 'balance', label: 'Balance', icon: LockKeyhole, meta: 'Railgun' }];
const NETWORK_TILES = [{ id: 'sandbox', tier: 'T1', label: 'Practice' }, { id: 'testnet', tier: 'T2', label: 'Sepolia' }, { id: 'l2', tier: 'T3', label: 'Layer 2' }, { id: 'mainnet', tier: 'T4', label: 'Mainnet' }] as const;
function shortId(value: string) { let h = 0; for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(16).toUpperCase().padStart(6, '0').slice(-6); }
function SystemCard({ item, active, owner, badge, locked }: { item: { route: string; label: string; icon: LucideIcon; meta: string }; active: boolean; owner: string; badge?: string; locked?: boolean }) {
  return <a href={`#/${item.route}`} className={`nav-item sys-card ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
    <span className="sys-icon" aria-hidden><item.icon size={20} strokeWidth={1.6} /></span>
    <span className="sys-body"><span className="sys-top"><span className="sys-title">{item.label}</span><span className="sys-owner">{owner}</span></span>
      <span className="sys-meta">{item.meta}{locked && <> · <LockKeyhole size={10} aria-label="Wallet required" /> wallet</>}</span>{badge && !locked && <span className="sys-pill">{badge}</span>}<span className="sys-tick" aria-hidden /></span>
  </a>;
}

export function App() {
  const session = useSession();
  if (!session.ready || !session.authenticated || !session.userId) return <SignIn />;
  // Private state is created only after authentication and disposed on account change.
  return <AccountProvider key={session.userId} userId={session.userId}><StoreProvider><AccountFlow /></StoreProvider></AccountProvider>;
}
function AccountFlow() {
  const account = useAccount();
  return !account.profile || account.choosingType ? <ChooseAccount /> : MAINNET ? <WorkspaceApp /> : <EnsAccessGate><WorkspaceApp /></EnsAccessGate>;
}
function WorkspaceApp() {
  const { profile, storageWarning } = useAccount(); const store = useStore();
  const [hash, setHash] = useState(window.location.hash); const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => !window.matchMedia('(min-width: 761px)').matches);
  const menuButton = useRef<HTMLButtonElement>(null); const sidebar = useRef<HTMLElement>(null);
  const type = profile!.type;
  const navigation = MAINNET ? (type === 'organization' ? mainnetOrganizationNavigation : mainnetIndividualNavigation) : type === 'organization' ? organizationNavigation : individualNavigation;
  const route = resolveRoute(hash, type);
  const title = extraTitles[route] || navigation.find(item => item.route === route)?.label || 'Workspace';
  const home = type === 'organization' ? 'overview' : 'inbox';
  const owner = profile!.ensName || profile!.organizationName || (type === 'organization' ? 'Org' : 'You');
  const workspaceId = shortId(`${owner}:${type}`);
  useEffect(() => {
    const onHash = () => { setHash(window.location.hash); setMobileOpen(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (window.location.hash !== `#/${route}`) window.history.replaceState(null, '', `#/${route}`);
    document.title = `${title} · SQL`; document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [route, title, hash]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    // Let the browser finish moving focus out of the newly inert workspace first.
    const focusFrame = requestAnimationFrame(() => sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const items = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(focusFrame); document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKey); menuButton.current?.focus(); };
  }, [mobileOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => { setMobileViewport(!desktop.matches); if (desktop.matches) setMobileOpen(false); };
    desktop.addEventListener('change', closeOnDesktop); return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  const isActive = (r: Route) => route === r || route === 'new' && r === 'distributions';
  const evm = useEvmWallet();
  const fundRoutes: Route[] = MAINNET ? ['overview', 'distributions', 'new', 'treasury', 'inbox', 'balance'] : ['distributions', 'new', 'treasury', 'inbox', 'balance'];
  const walletLocked = evm.status !== 'ready';
  const featureName = route === 'treasury' || route === 'overview' ? 'your vault' : route === 'balance' ? 'your private balance' : route === 'inbox' ? 'your inbox' : 'payments';
  return <div className="app-shell term">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    {mobileOpen && <button className="nav-backdrop" onClick={() => { setMobileOpen(false); menuButton.current?.focus(); }} aria-label="Close navigation" />}
    <header className="term-header">
      <button ref={menuButton} className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="workspace-navigation"><Menu size={20} /></button>
      <div className="term-block"><span className="term-cap">{type === 'organization' ? 'Organization' : 'Recipient'}</span><span className="term-level"><small>Level</small><b>{type === 'organization' ? 'O1' : 'R1'}</b></span></div>
      <div className="term-block term-id"><span className="term-cap">#SQL{workspaceId}</span>
        <div className="term-stamp"><Logo size={26} className="brand-logo" /><span className="term-stamp-name"><b>Protocol</b><b>{MAINNET ? 'SQL × RAILGUN' : 'SQL-0.3'}</b></span><p>Only key holders can open envelopes. Payouts stay sealed until claimed.</p></div>
        <span className="term-chip">{MAINNET ? 'ETH 1 · RAILGUN' : 'SEP 11155111 · POOL V3'} · {owner}</span></div>
      <div className="term-block term-security"><span className="term-cap">Network level</span>
        <div className="term-tiles" role="list">{NETWORK_TILES.map(tile => { const on = MAINNET ? tile.id === 'mainnet' : tile.id === store.mode; const locked = tile.id === 'l2' || (!MAINNET && tile.id === 'mainnet') || (MAINNET && tile.id !== 'mainnet'); return <span role="listitem" key={tile.id} className={`term-tile ${on ? 'is-on' : ''} ${locked ? 'is-locked' : ''}`} title={locked ? `${tile.label}: not available` : tile.label} aria-current={on || undefined}><small>Level</small><b>{tile.tier}</b><em>{tile.label}</em></span>; })}</div></div>
      <div className="term-actions"><WalletStatusChip /><button className="icon-button balance-toggle" onClick={() => store.setHideBalances(!store.hideBalances)} aria-pressed={store.hideBalances} title={store.hideBalances ? 'Show balances' : 'Hide balances'} aria-label={store.hideBalances ? 'Show balances' : 'Hide balances'}>{store.hideBalances ? <EyeOff size={17} /> : <Eye size={17} />}</button><WalletConnection /></div>
    </header>
    <div className="term-body">
      <span className="term-marker term-marker-1" aria-hidden>1</span><span className="term-marker term-marker-2" aria-hidden>2</span>
      <span className="term-vertical" aria-hidden>00032 05 54 08 CP · 00032 05 54 08 CP</span>
      <aside ref={sidebar} className={`sidebar term-systems ${mobileOpen ? 'sidebar-open' : ''}`} inert={mobileViewport && !mobileOpen || undefined} aria-label="Main navigation" id="workspace-navigation">
        <div className="term-colhead"><span>Computer systems</span><button className="icon-button mobile-menu" onClick={() => { setMobileOpen(false); menuButton.current?.focus(); }} aria-label="Close navigation"><X size={18} /></button></div>
        <nav className="primary-navigation">{navigation.map((item, i) => <SystemCard key={item.route} item={item} active={isActive(item.route)} owner={owner} badge={!MAINNET && i === 0 ? 'New' : undefined} locked={walletLocked && fundRoutes.includes(item.route)} />)}
          <SystemCard item={{ route: 'settings', label: 'Settings', icon: Settings2, meta: 'Config' }} active={route === 'settings'} owner={owner} />
          <SystemCard item={{ route: 'about', label: 'Help', icon: HelpCircle, meta: 'Manual' }} active={['about', 'inspector', 'protocol'].includes(route)} owner="SQL" />
        </nav>
        <div className="sidebar-footer"><LockKeyhole size={12} /><span>Private payments</span></div>
      </aside>
      <div className="term-rail" aria-hidden><span className="term-rail-track"><i /></span><span className="term-rail-glyph">⇅</span><span className="term-rail-r">R</span><small>Scrl<br />{workspaceId}</small></div>
      <div className="workspace" inert={mobileOpen || undefined}>
        <div className="term-colhead"><span>Content</span><span className="term-colhead-path">/{route}</span></div>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {storageWarning && <p className="form-error" role="status">{storageWarning}</p>}
          {!MAINNET && route === 'overview' && <Overview />}
          {fundRoutes.includes(route) && <WalletGate feature={featureName}>
            {MAINNET ? <Suspense fallback={<p className="rg-progress" role="status">Loading Railgun…</p>}>
              {['overview', 'treasury', 'balance'].includes(route) && <RailgunVault audience={type} />}
              {['distributions', 'new'].includes(route) && <RailgunPayout />}
              {route === 'inbox' && <RailgunReceive />}
            </Suspense> : <>
              {route === 'distributions' && <Distributions />}{route === 'new' && <DistributionWizard key={`${store.editingId || 'new'}-${store.mode}`} />}{route === 'treasury' && <Treasury />}{route === 'inbox' && <PrivateInbox />}{route === 'balance' && <PrivateBalance />}
            </>}
          </WalletGate>}{MAINNET ? <Suspense fallback={null}>{route === 'protocol' && <MainnetStatus />}{route === 'about' && <MainnetHelp audience={type} />}{route === 'inspector' && <MainnetStatus />}{route === 'settings' && <WalletGate feature="Vault settings"><RailgunVault audience={type} /></WalletGate>}</Suspense> : <>{route === 'inspector' && <Inspector />}{route === 'protocol' && <Protocol />}{route === 'settings' && <Settings />}{route === 'about' && <About />}</>}
        </main>
        <footer className="content-footer"><span>JHN 102 SQL 151 CC10 A55 ←</span><p>{MAINNET ? 'Ethereum mainnet · Railgun · Wallet-signed transactions' : store.mode === 'sandbox' ? 'Practice mode · No real money' : 'Early version · Test money only'}</p><span className="term-marker term-marker-3" aria-hidden>3</span></footer>
      </div>
    </div>
  </div>;
}
