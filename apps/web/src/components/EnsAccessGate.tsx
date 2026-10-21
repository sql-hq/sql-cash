import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Link2, LogOut, ShieldCheck } from 'lucide-react';
import { normalizePaymentName, PaymentNameError } from '@null-protocol/ens';
import { useAccount } from '../lib/account';
import { useSession } from '../lib/session';
import { useStore } from '../lib/store';
import { config } from '../lib/config';
import { ensClient } from '../lib/ens';
import { verifyWorkspaceAccess, requireOrganizationSigner, type LinkedWorkspace } from '../lib/workspace-access';
import { OrganizationAccountError } from '../lib/organization-error';
import { editablePaymentName, paymentNameInput, paymentNameSuffix } from '../lib/ens-name-input';
import { EntryLayout } from './EntryLayout';
import { Button } from './ui';
import { PaymentNameManager } from './PaymentNameManager';
import { Recovery } from './Recovery';

type Access = { linked: LinkedWorkspace; verify: (signer?: string) => Promise<LinkedWorkspace>; setOperationOpen: (open: boolean) => void };
const AccessContext = createContext<Access | null>(null);
export function useWorkspaceAccess() {
  const value = useContext(AccessContext);
  if (!value) throw new Error('A verified ENS workspace is required.');
  return value;
}

export function EnsAccessGate({ children }: { children: ReactNode }) {
  return <EnsAccessGateBody>{children}</EnsAccessGateBody>;
}

export function EnsAccessGateBody({ children, loadOrganization }: { children: ReactNode; loadOrganization?: () => Promise<string> }) {
  const account = useAccount(), session = useSession(), store = useStore();
  const profile = account.profile!;
  const organization = profile.type === 'organization';
  const loadApprovalWallet = organization ? loadOrganization : undefined;
  const [name, setName] = useState(() => editablePaymentName(profile.ensName ?? ''));
  const { completeName, showSuffix } = paymentNameInput(name);
  const [state, setState] = useState<{ key: string; linked?: LinkedWorkspace; error?: string; accountErrorTitle?: string; checking?: boolean; retryOnly?: boolean }>({ key: '', checking: true });
  const [recovery, setRecovery] = useState<'export' | 'restore' | null>(null);
  const [revision, setRevision] = useState(0);
  const [operationOpen, setOperationOpen] = useState(false);
  const [serverAddress, setServerAddress] = useState<string>();
  const lastEntered = useRef<LinkedWorkspace | undefined>(undefined);
  const request = useRef(0);
  const key = JSON.stringify([profile.type, profile.ensName, session.walletAddresses, store.identity.profile.stealthMetaAddress, store.identityBackedUp]);
  const latestKey = useRef(key); latestKey.current = key;
  const verify = useCallback(async (signer?: string) => {
    const currentKey = key;
    // Obtain the approval wallet from the authenticated service, never local preferences.
    const organizationAddress = await loadApprovalWallet?.();
    if (latestKey.current === currentKey) setServerAddress(organizationAddress);
    const linked = await verifyWorkspaceAccess(ensClient, { profile, organizationAddress,
      walletAddresses: session.walletAddresses ?? [], paymentProfile: store.identity.profile.stealthMetaAddress, backedUp: store.identityBackedUp });
    if (latestKey.current !== currentKey) throw new Error('Your account changed. Verify its ENS link again.');
    if (signer) requireOrganizationSigner(linked, signer);
    return linked;
  }, [key, loadApprovalWallet]);
  useEffect(() => {
    const version = ++request.current;
    setState(previous => ({ key, checking: true, ...(previous.key === key ? { linked: previous.linked } : {}) }));
    void verify().then(linked => {
      if (request.current !== version) return;
      store.setReceivingName(linked.receivingName);
      lastEntered.current = linked;
      setState({ key, linked });
      if (organization && account.profile?.organizationAddress?.toLowerCase() !== linked.address.toLowerCase()) account.updateProfile({ ...profile, organizationAddress: linked.address });
    }).catch(error => {
      if (request.current !== version) return;
      store.setReceivingName(undefined);
      setState({ key, error: error instanceof Error ? error.message : 'Could not verify your ENS link.', accountErrorTitle: error instanceof OrganizationAccountError ? error.title : undefined, retryOnly: !(error instanceof PaymentNameError) || error.code === 'network' });
    });
    return () => { request.current++; };
  }, [key, revision, verify]);
  useEffect(() => {
    const refresh = () => {
      if (!operationOpen && document.visibilityState === 'visible') setRevision(value => value + 1);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [operationOpen]);
  const linked = state.key === key ? state.linked : undefined;
  // Wallet changes must not unmount an active proof or an unresolved transaction.
  // Its own action guards verify the current identity; reconciliation remains usable.
  const active = linked ?? (operationOpen ? lastEntered.current : undefined);
  if (active) return <AccessContext.Provider value={{ linked: active, verify, setOperationOpen }}>{children}</AccessContext.Provider>;
  // Keep a first-time setup mounted while saving its backup; only a saved name
  // needs the returning-user check before any setup is displayed.
  if (profile.ensName && (state.key !== key || state.checking)) return <EntryLayout><h1>Opening your {organization ? 'organization' : 'inbox'}</h1><p className="entry-description" role="status">Checking your saved ENS link…</p></EntryLayout>;
  function saveName() {
    try { account.updateProfile({ ...profile, ensName: normalizePaymentName(completeName) }); setRevision(value => value + 1); }
    catch { setState({ key, error: 'Enter an assigned name or a complete ENS name you control.' }); }
  }
  return <EntryLayout className="ens-entry" action={<Button variant="ghost" icon={LogOut} busy={session.signingOut} onClick={() => void session.signOut()}>Sign out</Button>}>
    {!profile.ensName && <ol className="setup-progress" aria-label="Account setup"><li className="complete"><Check size={14} />Signed in</li><li className="complete"><Check size={14} />Account chosen</li><li aria-current="step"><span>3</span>Link ENS</li></ol>}
    <h1>{state.accountErrorTitle ? 'Check your organization account.' : state.retryOnly ? 'Check your ENS connection.' : organization ? 'Link your organization.' : profile.ensName ? 'Open your inbox.' : 'Link your payment inbox.'}</h1>
    <p className="entry-description">{state.accountErrorTitle ? 'Your saved setup is still here. We need to verify access to the organization’s approval wallet before checking its ENS link.' : state.retryOnly ? 'Your saved setup is still here. We need to verify the current ENS link before opening your workspace.' : organization ? 'Use a verified ENS name for your organization’s approval wallet. People can see who they are paying with.' : profile.ensName ? 'Use your existing Payment ID to open this inbox. If it is no longer available in this browser, restore your backup.' : 'Connect your name to the Payment ID you keep on this device. Your private workspace opens after the link is verified.'}</p>
    {organization ? <form onSubmit={event => { event.preventDefault(); saveName(); }}>
      <label className="field">Organization ENS name<span className="inbox-name-input"><input value={name} onChange={event => setName(editablePaymentName(event.target.value))} autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={512} placeholder="your-organization" />{showSuffix && <span className="inbox-name-suffix" aria-hidden="true">{paymentNameSuffix}</span>}</span><small>{completeName && <>Full name: <bdi>{completeName}</bdi>. </>}Use an existing name owned by, or resolving to, the dedicated organization approval wallet.</small></label>
      <Button variant="secondary" type="submit" icon={Link2} busy={state.checking}>Verify and link name</Button>
      <details className="progressive-details"><summary>Which wallet needs this name?</summary><p>The dedicated wallet that approves organization payments. Your personal wallet may pay gas, but its name does not identify the organization.</p>{serverAddress && <code>{serverAddress}</code>}<p><a href="https://app.ens.dev" target="_blank" rel="noreferrer">Manage your ENS name</a> on Ethereum Sepolia, then check the link again.</p></details>
    </form> : !linked && !state.retryOnly && <><PaymentNameManager onRecovery={setRecovery} onLinked={() => setRevision(value => value + 1)} /><div className="ens-entry-recovery"><p>Already received payments? Restore your original Payment ID before linking.</p><Button variant="secondary" onClick={() => setRecovery('restore')}>Restore Payment ID backup</Button></div></>}
    <div className="ens-entry-status" role="status"><ShieldCheck size={20} /><div><strong>{state.accountErrorTitle ?? (state.retryOnly ? 'ENS check unavailable' : profile.ensName ? 'Verify your saved inbox' : 'ENS linking is required')}</strong><p>{state.error || 'Finish linking to continue.'}</p></div></div>
    <div className="button-row"><Button variant="ghost" disabled={state.checking} onClick={() => setRevision(value => value + 1)}>Check link again</Button><Button variant="ghost" onClick={account.changeAccountType}>Change account type</Button></div>
    <p className="entry-hint">Your ENS name and linked public records are public. Private payment keys stay on your device. Linking a name does not grant organization approval.</p>
    <Recovery key={recovery ?? 'closed'} open={!!recovery} initialMode={recovery ?? 'restore'} continueSetup onClose={() => setRecovery(null)} />
  </EntryLayout>;
}
