import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPrivacyProfile, parseAmount, type CompiledDistribution } from '@null-protocol/sdk';
import { LiveBalanceRecoveryLoader } from '../components/LiveBalanceRecoveryLoader';
import { config } from './config';
import { useAccount } from './account';
import type { PaymentNameSnapshot } from '@null-protocol/ens';
import { useSession } from './session';
import { identitySession, type IdentitySession } from './identity-session';
import { EntryLayout } from '../components/EntryLayout';
import { replaceWithdrawnNote } from './withdrawal-amount';

export type Route = 'overview' | 'distributions' | 'new' | 'treasury' | 'inbox' | 'balance' | 'inspector' | 'protocol' | 'settings' | 'about';
export type RecipientRow = { id: string; name: string; amount: string; profile: string; destination?: string; paymentName?: PaymentNameSnapshot };
export type Distribution = { id: string; name: string; category: string; createdAt: string; status: 'Draft' | 'Prepared' | 'Published locally' | 'Confirmed'; recipients: RecipientRow[]; compiled?: CompiledDistribution; transactionHash?: string };
export type Activity = { id: string; title: string; detail: string; createdAt: string; type: 'shield' | 'distribution' | 'claim' | 'workspace' };
export type PrivateNote = { id: string; amount: bigint; commitment: string; createdAt: string; allocationId: string };
export type Identity = ReturnType<typeof createPrivacyProfile>;

function newWorkspace() {
  return { identity: createPrivacyProfile(), recipients: [] as RecipientRow[], drafts: [] as Distribution[] };
}

type Store = {
  receivingName?: PaymentNameSnapshot; setReceivingName: (snapshot?: PaymentNameSnapshot) => void;
  paymentPins: Record<string, PaymentNameSnapshot>; rememberPaymentName: (snapshot: PaymentNameSnapshot) => void;
  mode: 'sandbox' | 'testnet';
  organization: string; setOrganization: (name: string) => void;
  identityBackedUp: boolean; markIdentityBackedUp: () => Promise<void>;
  identity: Identity; setIdentity: (identity: Identity) => Promise<void>;
  recipients: RecipientRow[]; setRecipients: (rows: RecipientRow[]) => void;
  distributions: Distribution[]; saveDistribution: (distribution: Distribution) => void; removeDraft: (id: string) => void;
  treasury: bigint; shield: (amount: bigint) => void; publish: (distribution: Distribution) => void;
  treasuryReady: boolean; recoverLiveBalances: () => void;
  setLiveTreasuryBalance: (balance: bigint | null) => void;
  recordLiveActivity: (transactionHash: string, title: string, type: Activity['type']) => void;
  notes: PrivateNote[]; addNote: (note: PrivateNote) => void;
  activities: Activity[]; addActivity: (title: string, detail: string, type: Activity['type']) => void;
  recordWithdrawal: (commitment: string, amount: bigint, treasury: boolean) => void;
  recordPrivateWithdrawal: (spent: string, change?: PrivateNote) => void;
  hideBalances: boolean; setHideBalances: (hidden: boolean) => void;
  toast: (message: string) => void; toastMessage: string;
  navigate: (route: Route) => void; editingId: string | null; editDistribution: (id: string | null) => void;
};
const StoreContext = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  const [restored, setRestored] = useState<{ userId: string | null; session: IdentitySession | null; warning: string }>();
  useEffect(() => {
    let cancelled = false;
    void identitySession.load(userId!).then(session => {
      if (!cancelled) setRestored({ userId, session, warning: '' });
    }).catch(() => {
      if (!cancelled) setRestored({ userId, session: null, warning: 'This browser could not restore your inbox session. Restore your backup to keep using your existing Payment ID.' });
    });
    return () => { cancelled = true; };
  }, [userId]);
  if (!restored || restored.userId !== userId) return <EntryLayout><h1>Opening your workspace</h1><p role="status">Restoring your saved session…</p></EntryLayout>;
  return <WorkspaceStore key={userId} initialSession={restored.session} initialWarning={restored.warning}>{children}</WorkspaceStore>;
}
function WorkspaceStore({ children, initialSession, initialWarning }: { children: ReactNode; initialSession: IdentitySession | null; initialWarning: string }) {
  const { profile } = useAccount();
  const { userId } = useSession();
  const [initial] = useState(() => initialSession ? { identity: initialSession.identity, recipients: [] as RecipientRow[], drafts: [] as Distribution[] } : newWorkspace());
  const [mode] = useState<'sandbox' | 'testnet'>(config.defaultEnvironment);
  const [organization, setOrganization] = useState(profile?.organizationName || 'My organization');
  const [identity, setIdentity] = useState(initial.identity);
  const [identityBackedUp, setIdentityBackedUp] = useState(initialSession?.backedUp ?? false);
  const [sessionWarning, setSessionWarning] = useState(initialWarning);
  const [recipients, setRecipients] = useState(initial.recipients);
  const [paymentPins, setPaymentPins] = useState<Record<string, PaymentNameSnapshot>>({});
  const [receivingName, setReceivingName] = useState<PaymentNameSnapshot>();
  const [allDistributions, setDistributions] = useState(initial.drafts);
  const [testnetDistributions, setTestnetDistributions] = useState<Distribution[]>([]);
  const [treasury, setTreasury] = useState(config.network === 'mainnet' ? 0n : 100_000_000000n);
  const [liveTreasury, setLiveTreasury] = useState<bigint | null>(null);
  const [liveRecoveryOpen, setLiveRecoveryOpen] = useState(false);
  const [allNotes, setNotes] = useState<PrivateNote[]>([]);
  const [liveNotes, setLiveNotes] = useState<PrivateNote[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hideBalances, setHideBalances] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const navigate = (route: Route) => { window.location.hash = `/${route}`; };
  const toast = (message: string) => { setToastMessage(message); };
  const addActivity = (title: string, detail: string, type: Activity['type']) => setActivities(items => [{ id: crypto.randomUUID(), title, detail, type, createdAt: new Date().toISOString() }, ...items]);
  const saveDistribution = (distribution: Distribution) => (mode === 'sandbox' ? setDistributions : setTestnetDistributions)(items => items.some(item => item.id === distribution.id) ? items.map(item => item.id === distribution.id ? distribution : item) : [distribution, ...items]);
  async function rememberIdentity(next: Identity, backedUp: boolean) {
    try { await identitySession.save(userId!, { identity: next, backedUp }); setSessionWarning(''); }
    catch { setSessionWarning('This browser could not remember your inbox for refresh. Keep your backup and restore it if you reload.'); }
  }
  const value: Store = {
    recordPrivateWithdrawal: (spent, change) => setLiveNotes(items => replaceWithdrawnNote(items, spent, change)),
    recordWithdrawal: (commitment, amount, treasury) => { if (treasury) setLiveTreasury(value => value === null ? null : value >= amount ? value - amount : null); else setLiveNotes(items => items.filter(note => note.commitment !== commitment)); },
    receivingName, setReceivingName,
    paymentPins, rememberPaymentName: snapshot => setPaymentPins(pins => ({ ...pins, [snapshot.name]: snapshot })),
    identityBackedUp, markIdentityBackedUp: async () => { await rememberIdentity(identity, true); setIdentityBackedUp(true); },
    mode, organization, setOrganization, identity, setIdentity: async next => { await rememberIdentity(next, true); setIdentity(next); setIdentityBackedUp(true); setReceivingName(undefined); setNotes([]); setLiveNotes([]); }, recipients, setRecipients,
    distributions: mode === 'sandbox' ? allDistributions : testnetDistributions, saveDistribution, removeDraft: id => (mode === 'sandbox' ? setDistributions : setTestnetDistributions)(items => items.filter(item => item.id !== id || item.status === 'Published locally')),
    treasury: mode === 'sandbox' ? treasury : liveTreasury ?? 0n,
    treasuryReady: mode === 'sandbox' || liveTreasury !== null,
    recoverLiveBalances: () => setLiveRecoveryOpen(true),
    setLiveTreasuryBalance: setLiveTreasury,
    recordLiveActivity: (transactionHash, title, type) => setActivities(items => items.some(item => item.id === transactionHash) ? items : [{ id: transactionHash, title, detail: 'Confirmed on Sepolia.', type, createdAt: new Date().toISOString() }, ...items]),
    shield: value => { if (mode !== 'sandbox') throw new Error('Use Add funds to prepare a test-network deposit.'); setTreasury(balance => balance + value); addActivity('Practice funds added', 'Your practice balance is ready to use.', 'shield'); },
    publish: distribution => {
      if (mode !== 'sandbox') throw new Error('Use the payment review to prepare and approve a test-network payment.');
      if (!distribution.compiled) throw new Error('Check this payment before sending it.');
      if (allDistributions.some(item => item.id === distribution.id && item.status === 'Published locally')) throw new Error('This practice payment has already been sent.');
      const total = distribution.recipients.reduce((sum, row) => sum + parseAmount(row.amount), 0n);
      if (total > treasury) throw new Error('Add enough practice funds before sending.');
      setTreasury(balance => balance - total); saveDistribution({ ...distribution, status: 'Published locally' });
      addActivity('Practice payment sent', 'The payment can now be collected in this practice session.', 'distribution');
    },
    notes: mode === 'sandbox' ? allNotes : liveNotes, addNote: note => { (mode === 'sandbox' ? setNotes : setLiveNotes)(items => items.some(item => item.allocationId === note.allocationId) ? items : [...items, note]); if (mode === 'sandbox') addActivity('Practice payment collected', 'The payment was added to your practice balance.', 'claim'); },
    activities, addActivity, hideBalances, setHideBalances, toast, toastMessage, navigate, editingId,
    editDistribution: id => { setEditingId(id); navigate('new'); },
  };
  return <StoreContext.Provider value={value}>{sessionWarning && <p className="form-error" role="status">{sessionWarning}</p>}{children}<Toast message={toastMessage} onDismiss={() => setToastMessage('')} /><LiveBalanceRecoveryLoader open={liveRecoveryOpen} onClose={() => setLiveRecoveryOpen(false)} identityKeys={identity.keys} onRecovered={recovered => { if (recovered.treasuryBalance !== null) setLiveTreasury(recovered.treasuryBalance); setLiveNotes(recovered.notes); toast('Your balances have been checked and updated.'); }} /></StoreContext.Provider>;
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => { if (!message) return; const timer = setTimeout(onDismiss, 4500); return () => clearTimeout(timer); }, [message, onDismiss]);
  return message ? <div className="toast" role="status"><span>{message}</span><button onClick={onDismiss} aria-label="Dismiss notification">×</button></div> : null;
}
export function useStore(): Store { const context = useContext(StoreContext); if (!context) throw new Error('Workspace is not available.'); return context; }
