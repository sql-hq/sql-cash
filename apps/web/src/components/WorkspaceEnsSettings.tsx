import { useState, type FormEvent } from 'react';
import { normalizePaymentName } from '@null-protocol/ens';
import { useAccount } from '../lib/account';
import { useStore } from '../lib/store';
import { useWorkspaceIdentity } from '../lib/use-ens-identity';
import { editablePaymentName, paymentNameInput, paymentNameSuffix } from '../lib/ens-name-input';
import { Button, KeyValue } from './ui';

export function WorkspaceEnsSettings() {
  const account = useAccount(); const store = useStore(); const identity = useWorkspaceIdentity();
  const [name, setName] = useState(() => editablePaymentName(account.profile?.ensName ?? ''));
  const [error, setError] = useState('');
  const { completeName, showSuffix } = paymentNameInput(name);
  const organization = account.profile?.type === 'organization';
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const ensName = normalizePaymentName(completeName);
      account.updateProfile({ ...account.profile!, ensName }); identity.retry();
      setError(''); store.toast('ENS name saved. Checking its identity on Sepolia.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enter a complete ENS name.'); }
  }
  return <section className="settings-section"><div className="settings-description"><h2>ENS identity</h2><p>Your name across SQL.</p></div><form className="settings-fields" onSubmit={save}>
    <KeyValue label={organization ? 'Organization identity' : 'Individual identity'}><bdi>{identity.label}</bdi></KeyValue>
    <label className="field">{organization ? 'Organization ENS name' : 'Your ENS name'}<span className="inbox-name-input"><input aria-label={organization ? 'Organization ENS name' : 'Your ENS name'} value={name} maxLength={512} required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={organization ? 'organization' : 'your-name'} onChange={event => { setName(editablePaymentName(event.target.value)); setError(''); }} />{showSuffix && <span className="inbox-name-suffix" aria-hidden="true">{paymentNameSuffix}</span>}</span><small>{completeName && <>Full name: <bdi>{completeName}</bdi>. </>}Saving selects an existing name. It does not register one.</small></label>
    <div className="button-row"><Button type="submit" variant="secondary">Save ENS name</Button><Button variant="ghost" onClick={identity.retry}>Check again</Button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="field-hint">{organization ? account.profile?.organizationAddress ? 'We verify the name against the signer from your organization setup. ENS identity does not grant payment approval.' : 'Connect or restore your organization setup under Funds to verify its signer. Your personal sending wallet has its own ENS identity.' : 'We verify the name against your connected wallets. Link its SQL Payment ID in your inbox before sharing it to receive payments.'}</p>
    <a className="text-link" href="https://app.ens.dev" target="_blank" rel="noopener noreferrer">Manage ENS names on Sepolia</a>
  </form></section>;
}
