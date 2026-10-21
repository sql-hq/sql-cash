import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Download, LogOut, Settings2, UserRound } from 'lucide-react';
import { config } from '../lib/config';
import { Button, Modal, Notice } from './ui';
import { Recovery } from './Recovery';
import type { ReactNode } from 'react';
import { useSession } from '../lib/session';
import { EntryLayout } from './EntryLayout';
import { useWorkspaceIdentity } from '../lib/use-ens-identity';
import { useAccount } from '../lib/account';
import { useStore } from '../lib/store';
import { fundingWalletAddresses } from '../lib/wallet-balances';
import { ConnectedWalletBalance } from './PrivyWalletBalance';
import { validReownProjectId } from '../lib/reown-session';

const ReownRuntime = lazy(() => import('./ReownRuntime').then(module => ({ default: module.ReownRuntime })));

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!validReownProjectId(config.reownProjectId)) return children;
  return <Suspense fallback={<EntryLayout><h1>Opening your workspace</h1><div className="entry-loading" role="status"><span className="skeleton" aria-hidden="true" /><p>Opening your wallet connection…</p></div></EntryLayout>}><ReownRuntime>{children}</ReownRuntime></Suspense>;
}
export function WalletConnection() {
  const session = useSession();
  const identity = useWorkspaceIdentity();
  const { profile } = useAccount();
  const store = useStore();
  const connectedAddresses = fundingWalletAddresses(session.walletAddresses ?? [], config.network === 'sepolia' && profile?.type === 'organization' ? profile.organizationAddress : undefined);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <>
    <div className="account-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <Button className="account-menu-trigger" variant="secondary" icon={UserRound} aria-label={`Account options for ${identity.label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><bdi className="account-button-label">{identity.label}</bdi><ChevronDown size={14} /></Button>
      {open && <div className="account-menu-panel" id={id}>
        <div className="account-menu-identity"><small>ENS identity · {config.network === 'mainnet' ? 'Mainnet' : 'Sepolia'}</small><strong><bdi>{identity.label}</bdi></strong></div>
        <ConnectedWalletBalance addresses={connectedAddresses} ready={session.walletsReady ?? session.ready} hideBalances={store.hideBalances} onFeedback={store.toast} />
        <button onClick={() => { setOpen(false); window.location.hash = '/settings'; }}><Settings2 size={16} />Account settings</button>
        <button onClick={() => { setOpen(false); if (config.network === 'mainnet') window.location.hash = '/settings'; else setRecovery(true); }}><Download size={16} />{config.network === 'mainnet' ? 'Vault backup and recovery' : 'Save Payment ID backup'}</button>
        <button className="account-sign-out" onClick={() => { setOpen(false); setLeaving(true); }}><LogOut size={16} />Sign out</button>
      </div>}
    </div>
    <Modal open={leaving} title="Sign out?" description="Save a backup so you can come back." onClose={() => { if (!session.signingOut) setLeaving(false); }}>
      <Notice tone="warning">Signing out clears the drafts from this session and your access to this Payment ID. Keep a backup and its password to restore access. Signing in alone will not restore it.</Notice>
      {session.error && <p className="form-error" role="alert">{session.error}</p>}
      <div className="modal-actions"><Button variant="secondary" disabled={session.signingOut} onClick={() => { setLeaving(false); setRecovery(true); }}>Save backup</Button><Button busy={session.signingOut} icon={LogOut} onClick={() => void session.signOut()}>Sign out</Button></div>
    </Modal>
    <Recovery open={recovery} initialMode="export" onClose={() => setRecovery(false)} />
  </>;
}
