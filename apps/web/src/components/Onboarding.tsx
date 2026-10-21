import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, LockKeyhole, LogOut, UserRound } from 'lucide-react';
import { useSession } from '../lib/session';
import { useAccount, type AccountType } from '../lib/account';
import { useStore } from '../lib/store';
import { Button } from './ui';
import { EntryLayout } from './EntryLayout';
import { normalizePaymentName } from '@null-protocol/ens';
import { editablePaymentName, paymentNameInput, paymentNameSuffix } from '../lib/ens-name-input';

export function SignIn() {
  const session = useSession();
  const loading = !session.ready || session.authenticated && !session.userId;
  useEffect(() => { document.title = 'Sign in · SQL'; }, []);
  return <EntryLayout action={<a className="text-link" href="#/developers">Developer quickstart<ArrowLeft size={15} /></a>}>
    <h1>Open your mainnet workspace.</h1>
    <p className="entry-description">Connect your Ethereum wallet to receive private payments, manage your vault, or send private USDC payouts through Railgun.</p>
    {loading ? <div className="entry-loading" role="status"><span className="skeleton" /><p>Checking your session…</p></div> : session.configured ? <>
      <Button className="entry-continue" onClick={session.signIn}><span>Connect wallet with Reown</span><ArrowRight size={17} /></Button>

    </> : <div className="entry-unavailable" role="status"><strong>Wallet connection is unavailable.</strong><p>Reown must be configured for this domain before a wallet can connect. No wallet or private vault has been opened.</p><Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button></div>}
    {session.error && <p className="form-error" role="alert">{session.error}</p>}
    <div className="entry-security"><LockKeyhole size={18} strokeWidth={1.5} /><div><strong>Keep a backup.</strong><p>Returning? Restore your backup after signing in. Sign-in alone won’t restore payments.</p></div></div>
  </EntryLayout>;
}

export function ChooseAccount() {
  const session = useSession(); const account = useAccount(); const store = useStore();
  const [type, setType] = useState<AccountType | null>(account.profile?.type || null);
  const [organizationName, setOrganizationName] = useState(account.profile?.organizationName || '');
  const [ensName, setEnsName] = useState(() => editablePaymentName(account.profile?.ensName || ''));
  const nameDrafts = useRef<Partial<Record<AccountType, string>>>(account.profile ? { [account.profile.type]: editablePaymentName(account.profile.ensName || '') } : {});
  function chooseType(next: AccountType) {
    if (type) nameDrafts.current[type] = ensName;
    setEnsName(nameDrafts.current[next] ?? ''); setType(next); setError('');
  }
  const { showSuffix, completeName } = paymentNameInput(ensName);
  const [error, setError] = useState(''); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { document.title = 'Choose your account type · SQL'; heading.current?.focus(); }, []);
  function complete(event: FormEvent) {
    event.preventDefault();
    if (!type) { setError('Choose how you will use SQL.'); return; }
    if (type === 'organization' && !organizationName.trim()) { setError('Enter an organization name.'); return; }
    let normalizedName = account.profile?.ensName;
    try { normalizedName = normalizePaymentName(completeName); } catch { setError('Enter your assigned name, or paste a full ENS name you own.'); return; }
    account.updateProfile(type === 'organization' ? { type, organizationName: organizationName.trim(), ensName: normalizedName, ...(account.profile?.type === 'organization' ? { organizationAddress: account.profile.organizationAddress } : {}) } : { type, ensName: normalizedName });
    if (type === 'organization') store.setOrganization(organizationName.trim());
    store.navigate(type === 'organization' ? 'overview' : 'inbox');
  }
  return <EntryLayout className="account-setup" action={!account.profile && <Button variant="ghost" icon={LogOut} busy={session.signingOut} onClick={() => void session.signOut()}>Sign out</Button>} footer={<>Signed in as <span>{session.label}</span></>}>
      <ol className="setup-progress" aria-label="Account setup"><li className="complete"><Check size={14} />Signed in</li><li aria-current="step"><span>2</span>Choose account type</li></ol>
      <h1 ref={heading} tabIndex={-1}>How will you use SQL?</h1>

      <form onSubmit={complete}>
        <fieldset className="account-options"><legend className="sr-only">Account type</legend>
          <label className={`account-option ${type === 'individual' ? 'is-selected' : ''}`}><input type="radio" name="accountType" value="individual" checked={type === 'individual'} onChange={() => chooseType('individual')} /><UserRound size={22} strokeWidth={1.6} /><span><strong>Individual</strong><small>Receive payments</small></span></label>
          <label className={`account-option ${type === 'organization' ? 'is-selected' : ''}`}><input type="radio" name="accountType" value="organization" checked={type === 'organization'} onChange={() => chooseType('organization')} /><Building2 size={22} strokeWidth={1.6} /><span><strong>Organization</strong><small>Pay people and manage funds</small></span></label>
        </fieldset>
        <div className={`organization-reveal ${type === 'organization' ? 'is-open' : ''}`} inert={type !== 'organization' || undefined} aria-hidden={type !== 'organization'}><div><div className="organization-setup-fields"><label className="field" htmlFor="onboarding-organization">Organization name<input id="onboarding-organization" name="organization" autoComplete="organization" value={organizationName} maxLength={50} required={type === 'organization'} disabled={type !== 'organization'} onChange={event => { setOrganizationName(event.target.value); setError(''); }} placeholder="e.g. Acme Studio" aria-describedby="organization-hint" /></label><p id="organization-hint" className="field-hint">Display name only. Sending requires organization approval.</p></div></div></div>
        {type && <label className="field" htmlFor="onboarding-ens">{type === 'organization' ? 'Organization ENS name' : 'Your ENS payment name'}
          <span className="inbox-name-input"><input id="onboarding-ens" aria-label={type === 'organization' ? 'Organization ENS name' : 'Your ENS payment name'} maxLength={512} value={ensName} onChange={event => { setEnsName(editablePaymentName(event.target.value)); setError(''); }} required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={type === 'organization' ? 'organization' : 'your-name'} aria-describedby="onboarding-ens-hint" />{showSuffix && <span className="inbox-name-suffix" aria-hidden="true">{paymentNameSuffix}</span>}</span>
          <small id="onboarding-ens-hint">Use an assigned name, or paste a full ENS name you own. {completeName && <>Full name: <bdi>{completeName}</bdi>. </>}{type === 'organization' ? 'We’ll verify this name against your organization’s signer when you connect its setup. Saving a name does not register it or grant organization access.' : 'Next, we’ll check your wallet, save your backup and link the name. It is ready to receive only after that link is confirmed.'}</small>
        </label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button className="entry-continue" type="submit" disabled={!type}><span>Continue</span><ArrowRight size={17} /></Button>
      </form>
      <p className="entry-hint">You can change your account type in Settings.</p>
      {account.profile && <Button variant="ghost" icon={ArrowLeft} onClick={account.cancelChange}>Back to account</Button>}
      {session.error && <p className="form-error" role="alert">{session.error}</p>}
    </EntryLayout>;
}
