import { useEffect, useRef, useState } from 'react';
import { createWalletClient, custom, encodeFunctionData, getAddress, zeroAddress, type Address, type EIP1193Provider, type Hex, type WalletClient } from 'viem';
import { sepolia } from 'viem/chains';
import { Check, Copy, Download, ExternalLink, Globe2 } from 'lucide-react';
import { ENS_CHAIN_ID, PaymentNameError, inspectPaymentEditorScope, inspectPaymentName, paymentEditorAccess, preparePaymentDelegate, prepareProfileWrite, profileFingerprint, resolvePaymentName, type PaymentNameSnapshot } from '@null-protocol/ens';
import { config } from '../lib/config';
import { ensClient } from '../lib/ens';
import { useStore } from '../lib/store';
import { useSession } from '../lib/session';
import { useAccount } from '../lib/account';
import { clearPendingNameUpdate, readPendingNameUpdate, savePendingNameUpdate, type PendingNameUpdate } from '../lib/ens-pending';
import { matchesNameUpdate } from '../lib/ens-receipt';
import { Button, KeyValue, Notice } from './ui';
import { download } from '../lib/format';
import { findAssignedNames, findNameWallet, type NameWallet } from '../lib/ens-wallet';
import ensDeployment from '../../../../deployments/ens-sepolia.json';
import { editablePaymentName, paymentNameInput, paymentNameSuffix as inboxNameSuffix } from '../lib/ens-name-input';
import { EnsIdentity } from './EnsIdentity';
import { EnsAddressInput } from './EnsAddressInput';
import { useEnsIdentities } from '../lib/use-ens-identity';
import { ensIdentityLabel, recheckEnsAddress, type EnsAddress } from '../lib/ens-identity';

type Connection = (address?: Address) => Promise<WalletClient>;
type SetupProps = { onRecovery: (mode: 'export' | 'restore') => void; onLinked?: () => void; initialName?: string; onNameChange?: (name: string) => void };
export function PaymentNameManager(props: SetupProps) {
  const session = useSession();
  const wallets = (session.evmWallets ?? []).map(wallet => ({ address: wallet.address as Address, label: 'Connected wallet' }));
  return <NameManager {...props} walletsReady={session.walletsReady ?? session.ready} wallets={wallets}
    onConnectWallet={session.connectWallet} connect={async address => {
      const selected = address ?? wallets[0]?.address;
      if (!selected || !session.getEvmProvider) throw new PaymentNameError('permission', 'Connect the wallet for this name, then check the name again.');
      const provider = await session.getEvmProvider(selected) as EIP1193Provider;
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${ENS_CHAIN_ID.toString(16)}` }] });
      if (Number(await provider.request({ method: 'eth_chainId' })) !== ENS_CHAIN_ID) throw new PaymentNameError('permission', 'Switch your wallet to Sepolia to manage this legacy ENS name.');
      await session.getEvmProvider(selected);
      return createWalletClient({ account: selected, chain: sepolia, transport: custom(provider) });
    }} />;
}

export function NameManager({ connect, wallets, walletsReady = true, onConnectWallet, onRecovery, onLinked, initialName, onNameChange }: SetupProps & {
  connect: Connection; wallets?: readonly NameWallet[]; walletsReady?: boolean; onConnectWallet?: () => void;
}) {
  const store = useStore();
  const account = useAccount();
  const { userId } = useSession();
  const userKey = userId ?? 'connected-wallet';
  const [savedUpdate] = useState(() => readPendingNameUpdate(userKey));
  const updateRef = useRef<PendingNameUpdate | undefined>(savedUpdate);
  const [name, setName] = useState(() => editablePaymentName(savedUpdate?.name ?? initialName ?? store.receivingName?.name ?? account.profile?.ensName ?? ''));
  const { showSuffix: showNameSuffix, completeName } = paymentNameInput(name);
  const [checked, setChecked] = useState<Awaited<ReturnType<typeof inspectPaymentName>> | undefined>(() => store.receivingName ? { ...store.receivingName, value: store.receivingName.profile } : undefined);
  const [linked, setLinked] = useState<PaymentNameSnapshot | undefined>(store.receivingName);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [editor, setEditor] = useState(savedUpdate?.editor ?? '');
  const [editorName, setEditorName] = useState<EnsAddress>();
  const [hash, setHash] = useState<Hex | undefined>(savedUpdate?.hash);
  const [pending, setPending] = useState(!!savedUpdate);
  const [walletAddress, setWalletAddress] = useState<Address>();
  const [scope, setScope] = useState<Awaited<ReturnType<typeof inspectPaymentEditorScope>>>();
  const [chosenWallet, setChosenWallet] = useState<NameWallet>();
  const [walletsChecked, setWalletsChecked] = useState(false);
  const [unassignedName, setUnassignedName] = useState('');
  const [assignedNames, setAssignedNames] = useState<string[]>();
  const [permissionWallet, setPermissionWallet] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const discoveryKey = useRef('');
  const connectedWalletKey = (wallets ?? []).map(wallet => wallet.address.toLowerCase()).sort().join(',');
  const revision = useRef(0), inFlight = useRef(false);
  const previousIdentity = useRef(store.identity);
  const walletAvailable = chosenWallet && (!wallets || wallets.some(wallet => wallet.address.toLowerCase() === chosenWallet.address.toLowerCase()));
  const ownerConnected = checked && wallets?.some(wallet => wallet.address.toLowerCase() === checked.owner.toLowerCase());
  const permissionIdentities = useEnsIdentities([...new Set([...(wallets ?? []).map(wallet => wallet.address), ...(checked ? [checked.owner] : [])])].map(address => ({ address, hints: checked ? [checked.name] : [] })));
  const setupStep = !checked || !walletAvailable ? 0 : !store.identityBackedUp ? 1 : 2;
  const restoringExisting = !!checked?.value && checked.value !== store.identity.profile.stealthMetaAddress && !replaceExisting;
  const checkingSavedName = !!account.profile?.ensName && !checked && !unassignedName && !error;
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    if (previousIdentity.current === store.identity) return;
    previousIdentity.current = store.identity; revision.current++;
    setChecked(undefined); setLinked(undefined); setChosenWallet(undefined); setWalletsChecked(false);
    setUnassignedName(''); setAssignedNames(undefined);
    setConsent(false); setStatus(''); setError(''); setBusy(false);
  }, [store.identity]);
  // Discover only names whose current ownership and resolver access are verified.
  // This is read-only: a refresh must never publish a new receiving identity.
  useEffect(() => {
    if (!walletsReady || !connectedWalletKey || pending || linked) return;
    const key = connectedWalletKey + ':' + store.identity.profile.stealthMetaAddress;
    if (discoveryKey.current === key) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || inFlight.current) return;
      discoveryKey.current = key;
      void run(async version => {
        // A returning inbox already knows its name. Resolve that first instead
        // of repeating assignment discovery and the three setup steps.
        if (account.profile?.ensName) { await lookup(version, account.profile.ensName); return; }
        const names = await findAssigned(version);
        if (version !== revision.current || !names?.length) return;
        const preferred = names.includes(completeName) ? completeName : names.length === 1 ? names[0] : undefined;
        if (preferred) await lookup(version, preferred);
      });
    });
    return () => { cancelled = true; };
  }, [walletsReady, connectedWalletKey, store.identity, pending, busy, linked]);
  async function run(work: (version: number) => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; const version = revision.current; setBusy(true); setError(''); setStatus(''); setScope(undefined);
    try { await work(version); }
    catch (reason) { if (version === revision.current) { setStatus(''); setError(reason instanceof PaymentNameError ? reason.message : 'This step was not confirmed. Check your wallet and connection, then try again.'); } }
    finally { inFlight.current = false; if (version === revision.current) setBusy(false); }
  }
  async function findAssigned(version: number) {
    setAssignedNames(undefined);
    if (!walletsReady) throw new PaymentNameError('permission', 'Your wallets are still loading. Try again in a moment.');
    let candidates = wallets;
    if (!candidates) {
      const wallet = await connect();
      if (!wallet.account) throw new PaymentNameError('permission', 'Connect your wallet to check its assigned name.');
      candidates = [{ address: wallet.account.address, label: 'Connected wallet' }];
    }
    setStatus('Checking names assigned to your connected wallets…');
    const hints = [completeName, ...ensDeployment.recipientAssignments.map((item: { name: string }) => item.name), ensDeployment.recipientSetup.name, account.profile?.ensName, store.receivingName?.name].filter((value): value is string => !!value);
    const names = await findAssignedNames(hints, candidates, name => inspectPaymentName(ensClient, name), async (name, address) => (await paymentEditorAccess(ensClient, name, address)).allowed)
      .catch(() => { throw new PaymentNameError('network', 'Could not check assigned names. Check your connection and try again.'); });
    if (version !== revision.current) return;
    setAssignedNames(names); setStatus('');
    return names;
  }
  async function lookup(version: number, input = completeName) {
    setChecked(undefined); setChosenWallet(undefined); setWalletsChecked(false); setConsent(false); setLinked(undefined); setReplaceExisting(false);
    setUnassignedName(''); setAssignedNames(undefined);
    setStatus('Checking your name…');
    const result = await inspectPaymentName(ensClient, input);
    if (version !== revision.current) return;
    setName(editablePaymentName(result.name)); onNameChange?.(result.name);
    // A parent resolver can answer for an unregistered child. Resolution alone
    // does not give the child an owner or make it suitable for inbox setup.
    // Read-only alias resolution remains supported by the ENS package.
    if (result.owner === zeroAddress) {
      setUnassignedName(result.name); setStatus('');
      if (walletsReady && wallets?.length) await findAssigned(version);
      return;
    }
    setChecked(result);
    if (result.value === store.identity.profile.stealthMetaAddress) {
      const snapshot = await resolvePaymentName(ensClient, result.name);
      if (version === revision.current) { setLinked(snapshot); onLinked?.(); store.setReceivingName(snapshot); if (account.profile?.type === 'individual') account.updateProfile({ ...account.profile, ensName: snapshot.name }); setStatus(''); }
      return;
    }
    if (!walletsReady) throw new PaymentNameError('permission', 'Your wallets are still loading. Try again in a moment.');
    setStatus('Finding a wallet that can update this name…');
    let candidates = wallets;
    if (!candidates) {
      const wallet = await connect();
      if (!wallet.account) throw new PaymentNameError('permission', 'Connect the wallet that owns this name.');
      candidates = [{ address: wallet.account.address, label: 'Connected wallet' }];
    }
    const selected = await findNameWallet(candidates, result.owner, async address => (await paymentEditorAccess(ensClient, result.name, address)).allowed)
      .catch(() => { throw new PaymentNameError('network', 'Could not check wallet permissions. Check your connection and try again.'); });
    if (version !== revision.current) return;
    setChosenWallet(selected); setWalletsChecked(true); setStatus('');
  }
  async function confirmed(transaction: Hex, version: number) {
    const update = updateRef.current;
    if (!update || transaction !== update.hash) throw new PaymentNameError('changed', 'The saved name update could not be verified. Check this transaction in your wallet.');
    const receipt = await ensClient.waitForTransactionReceipt({ hash: transaction, confirmations: 2, timeout: 90_000 });
    if (version !== revision.current) return;
    // A wallet may replace a pending transaction. Verify the transaction that was
    // actually mined, so a cancellation cannot be mistaken for the intended write.
    const actual = await ensClient.getTransaction({ hash: receipt.transactionHash });
    if (version !== revision.current) return;
    setPending(false);
    setHash(receipt.transactionHash);
    try { clearPendingNameUpdate(userKey); } catch { /* The receipt still settles this component's pending action. */ }
    if (receipt.status !== 'success') throw new PaymentNameError('permission', 'The transaction failed on Sepolia. Nothing was updated. Check this name’s permissions before trying again.');
    if (!matchesNameUpdate(update, actual, receipt)) throw new PaymentNameError('changed', 'This transaction did not confirm the expected name update. Check the name again before trying to publish.');
    if (update.kind === 'profile') {
      const snapshot = await resolvePaymentName(ensClient, update.name);
      if (snapshot.profile !== store.identity.profile.stealthMetaAddress || snapshot.fingerprint !== update.fingerprint) throw new PaymentNameError('changed', 'The transaction was confirmed, but this device has a different Payment ID. Restore your backup before sharing this name.');
      if (version !== revision.current) return;
      setChecked({ ...snapshot, value: snapshot.profile }); setLinked(snapshot); onLinked?.(); store.setReceivingName(snapshot); if (account.profile?.type === 'individual') account.updateProfile({ ...account.profile, ensName: snapshot.name }); setStatus('Your payment name is live on Sepolia.');
    } else {
      const access = await paymentEditorAccess(ensClient, update.name, update.editor!);
      if (version !== revision.current) return;
      if (update.kind === 'grant' && !access.recordAccess) throw new PaymentNameError('permission', 'The transaction was confirmed, but the record permission could not be verified. Check access again.');
      setStatus(access.broaderAccess ? 'This wallet has broader permissions on the resolver. Removing this record permission alone does not remove its other access.' : access.allowed ? 'This wallet can update only this name’s SQL payment record through this permission.' : 'This wallet can no longer update the SQL payment record.');
    }
  }
  async function write(kind: 'profile' | 'grant' | 'revoke', version: number) {
    if (!checked || pending || (kind === 'profile' && !consent)) return;
    if (kind === 'profile' && checked.value && checked.value !== store.identity.profile.stealthMetaAddress && !replaceExisting) throw new PaymentNameError('changed', 'Restore this inbox’s backup, or explicitly choose a new Payment ID before replacing it.');
    if (kind === 'profile' && !store.identityBackedUp) throw new PaymentNameError('permission', 'Save your Payment ID backup from the inbox before linking this name.');
    if (kind === 'profile' && !walletAvailable) throw new PaymentNameError('permission', 'Check the name again to find an authorized wallet.');
    const wallet = await connect(kind === 'profile' ? chosenWallet?.address : (permissionWallet || checked.owner) as Address);
    if (version !== revision.current) return;
    const account = wallet.account?.address;
    if (!account || await wallet.getChainId() !== ENS_CHAIN_ID) throw new PaymentNameError('network', 'Connect the name’s wallet on Sepolia.');
    if (kind === 'profile' && account.toLowerCase() !== chosenWallet?.address.toLowerCase()) throw new PaymentNameError('changed', 'The wallet changed. Check your name again before linking.');
    setWalletAddress(account);
    if (kind === 'grant' || kind === 'revoke' && editorName) {
      if (!editorName || editorName.address.toLowerCase() !== editor.toLowerCase()) throw new PaymentNameError('missing', 'Check and confirm the editor’s ENS name first.');
      await recheckEnsAddress(ensClient, editorName);
    }
    const simulation = kind === 'profile'
      ? await prepareProfileWrite(ensClient, checked.name, store.identity.profile.stealthMetaAddress, account, checked.resolver)
      : await preparePaymentDelegate(ensClient, checked.name, getAddress(editor.trim()), kind === 'grant', account, checked.resolver);
    if (version !== revision.current) return;
    // Recheck the selected account after wallet dialogs and asynchronous preflight.
    if (!(await wallet.getAddresses()).some(value => value.toLowerCase() === account.toLowerCase()) || await wallet.getChainId() !== ENS_CHAIN_ID) throw new PaymentNameError('changed', 'The connected wallet changed. Check the name again.');
    if (kind !== 'profile' && editorName) await recheckEnsAddress(ensClient, editorName);
    setStatus('Confirm the record update in your wallet…');
    const request = simulation.request;
    // Narrow the request union so viem preserves each function's ABI/argument types.
    const data = request.functionName === 'setText' ? encodeFunctionData(request) : encodeFunctionData(request);
    const transaction = await wallet.sendTransaction({ to: request.address, data, account, chain: sepolia });
    const update: PendingNameUpdate = { version: 1, hash: transaction, data, name: checked.name, resolver: checked.resolver, account, kind, ...(kind === 'profile' ? {} : {editor: getAddress(editor.trim())}), fingerprint: profileFingerprint(store.identity.profile.stealthMetaAddress) };
    updateRef.current = update;
    // Receipt data is public. Keep it through reloads; never automatically re-send an uncertain update.
    try { savePendingNameUpdate(userKey, update); } catch { setError('This browser could not save the pending transaction. Keep its link until confirmation.'); }
    setHash(transaction); setPending(true); setStatus('Waiting for Sepolia confirmation…');
    await confirmed(transaction, version);
  }
  function changeName() {
    setReplaceExisting(false);
    revision.current++; setChecked(undefined); setLinked(undefined); setChosenWallet(undefined);
    setUnassignedName(''); setAssignedNames(undefined);
    setWalletsChecked(false); setConsent(false); setStatus(''); setError(''); setHash(undefined);
  }
  return <div className="payment-name-manager">
    {!linked && !pending && !restoringExisting && !checkingSavedName && <ol className="inbox-setup-progress" aria-label="Inbox setup progress">
      {['Choose name', 'Save backup', 'Link name'].map((label, index) => <li key={label} aria-current={index === setupStep ? 'step' : undefined} className={index < setupStep ? 'complete' : ''}>
        <span aria-hidden="true">{index < setupStep ? <Check size={13} /> : index + 1}</span>{label}
      </li>)}
    </ol>}
    {!checked && !pending && <form onSubmit={event => { event.preventDefault(); if (name.trim()) void run(lookup); }}>
      <label className="field" htmlFor="receiving-ens-name">Your ENS name on Sepolia</label>
      <div className="name-input-row">
        <div className="inbox-name-input">
          <input id="receiving-ens-name" value={name} disabled={busy} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="your-name" aria-describedby={`receiving-ens-preview receiving-ens-hint${unassignedName ? 'receiving-ens-unassigned' : ''}`} aria-invalid={!!error || !!unassignedName} onChange={event => { changeName(); setName(editablePaymentName(event.target.value)); onNameChange?.(event.target.value); }} />
          {showNameSuffix && <span className="inbox-name-suffix" aria-hidden="true">{inboxNameSuffix}</span>}
        </div>
        <Button type="submit" disabled={!name.trim() || !walletsReady} busy={busy}>Continue</Button>
      </div>
      <span id="receiving-ens-preview" className="sr-only">{completeName ? `Full ENS name: ${completeName}.` : `Name ending in ${inboxNameSuffix}.`}</span>
      <p id="receiving-ens-hint" className="field-hint">Use an assigned name, or paste a full ENS name you own. <a href="https://app.ens.dev" target="_blank" rel="noopener noreferrer">Get an ENS name <ExternalLink size={12} /></a></p>
      {!unassignedName && !assignedNames && <p className="field-hint"><button type="button" className="text-link" disabled={busy || !walletsReady} onClick={() => void run(findAssigned)}>Find my assigned SQL name</button></p>}
    </form>}
    {!checked && !pending && unassignedName && <div className="inbox-name-help">
      <div id="receiving-ens-unassigned" role="status"><h3>This name isn’t assigned yet</h3><p><bdi>{unassignedName}</bdi> has no registered owner on Sepolia. Choose an assigned name, or ask the parent name’s owner to create it for your wallet.</p></div>
      {!assignedNames && !busy && <Button variant="secondary" onClick={() => void run(findAssigned)}>Find my assigned SQL name</Button>}
    </div>}
    {!checked && !pending && assignedNames && <div className="inbox-name-options">
      {assignedNames.length ? <><p className="name-wallet-ready" role="status"><Check size={14} />Your wallet can use {assignedNames.length === 1 ? 'this name' : 'these names'}.</p>{assignedNames.map(assigned => <Button key={assigned} disabled={busy} onClick={() => { setName(editablePaymentName(assigned)); onNameChange?.(assigned); void run(version => lookup(version, assigned)); }}>Use {assigned}</Button>)}</> : <p role="status">No usable name was found among this app’s configured assignments for your connected wallets. Enter another name you own, or ask the parent name’s owner to assign one.</p>}
    </div>}
    {checked && !pending && <div className="name-setup-result">
      <div className="name-summary"><span><Globe2 size={16} /><bdi>{checked.name}</bdi></span><button type="button" className="text-link" disabled={busy} onClick={changeName}>Change name</button></div>
      {linked ? <><h3>Your inbox is ready</h3><p>Share this name to receive payments.</p><Button icon={Copy} busy={busy} onClick={() => void run(async version => {
        const fresh = await resolvePaymentName(ensClient, linked.name);
        if (version !== revision.current) return;
        if (fresh.profile !== store.identity.profile.stealthMetaAddress) { setLinked(undefined); store.setReceivingName(undefined); throw new PaymentNameError('changed', 'This name’s Payment ID changed. Link it again before sharing.'); }
        await navigator.clipboard.writeText(fresh.name); setStatus('Payment name copied.');
      })}>Copy ENS name</Button></> : restoringExisting ? <div className="inbox-setup-action">
        <h3>Your name is already linked</h3>
        <p>Restore your encrypted backup to open your existing inbox. Your name is already set up; no new transaction is needed.</p>
        <Button onClick={() => onRecovery('restore')}>Restore existing inbox</Button>
        <p className="setup-restore"><button type="button" className="text-link" disabled={busy} onClick={() => setReplaceExisting(true)}>Use a new Payment ID instead</button></p>
      </div> : busy && !chosenWallet ? null : !walletAvailable ? <div className="inbox-setup-action">
        <h3>{walletsChecked ? ownerConnected ? 'Payment permission needed' : 'Connect a wallet for this name' : 'Check your connected wallets'}</h3>
        <p>{walletsChecked ? ownerConnected ? 'Your wallet owns this name, but cannot update its Payment ID yet. Ask the resolver administrator to allow this wallet to update the SQL payment record, then check again.' : 'None of your connected wallets can update this name. Connect its owner or an authorized wallet, then check again.' : 'We need to confirm which wallet can update your name before continuing.'}</p>
        <KeyValue label="Name owner"><EnsIdentity address={checked.owner} hints={[checked.name]} fallback="Name owner" /></KeyValue>
        <div className="button-row">{onConnectWallet && <Button onClick={onConnectWallet} disabled={busy}>Connect another wallet</Button>}<Button variant={onConnectWallet ? 'secondary' : 'primary'} busy={busy} onClick={() => void run(lookup)}>Check wallets again</Button></div>
      </div> : <>
        <p className="name-wallet-ready"><Check size={14} />Wallet found. We’ll use it when you confirm.</p>
        {!store.identityBackedUp ? <div className="inbox-setup-action">
          <h3>Save your inbox backup</h3>
          <p>This file keeps access to your payments if you change devices. Choose a password and save it once.</p>
          <Button icon={Download} onClick={() => onRecovery('export')}>Save backup and continue</Button>
          <p className="setup-restore">Already have a Payment ID? <button type="button" className="text-link" onClick={() => onRecovery('restore')}>Restore your backup</button></p>
        </div> : <div className="inbox-setup-action">
          <h3>Link your name</h3>
          <p>Your name and receiving Payment ID will be public. Your recovery keys stay private.</p>
          {checked.value && <Notice tone="warning">This name already has a Payment ID. Linking replaces it for future payments. Restore its existing backup instead if you want to keep that Payment ID.</Notice>}
          <label className="checkbox-field"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>I agree to link my Payment ID publicly.</span></label>
          <Button disabled={!consent || !walletsReady} busy={busy} onClick={() => void run(version => write('profile', version))}>Link name</Button>
          <p className="field-hint">Confirm one Sepolia transaction in your wallet. You’ll need Sepolia ETH for the network fee.</p>
        </div>}
        <KeyValue label="Wallet for name updates"><EnsIdentity address={chosenWallet!.address} hints={[checked.name]} fallback={chosenWallet!.label} /></KeyValue>
      </>}
      {linked && <details className="name-permissions"><summary>Advanced: payment record access</summary><p>Allow another wallet to update only this name’s Payment ID.</p><p className="field-hint">Only trust an editor who may redirect future payments. Name ownership and other records are unchanged.</p>
        {wallets && <label className="field">Wallet for permission changes<select value={permissionWallet || checked.owner} disabled={busy} onChange={event => setPermissionWallet(event.target.value)}><option value={checked.owner}>{ensIdentityLabel(permissionIdentities.get(checked.owner), 'Name owner')} · Owner</option>{wallets.filter(wallet => wallet.address.toLowerCase() !== checked.owner.toLowerCase()).map((wallet, index) => <option key={wallet.address} value={wallet.address}>{ensIdentityLabel(permissionIdentities.get(wallet.address), `${wallet.label} ${index + 1}`)}</option>)}</select></label>}
        <EnsAddressInput label="Editor wallet" allowAddress addressHelp="You can check or remove existing access by address if the editor’s name expires. Granting new access requires a confirmed ENS name." disabled={busy || pending} onChange={(address, name) => { setEditor(address); setEditorName(name); setScope(undefined); setStatus(''); setError(''); }} />
        <div className="button-row"><Button variant="secondary" disabled={pending || !editorName || !/^0x[\da-fA-F]{40}$/.test(editor.trim())} busy={busy} onClick={() => void run(version => write('grant', version))}>Grant record access</Button><Button variant="ghost" disabled={pending || !/^0x[\da-fA-F]{40}$/.test(editor.trim()) || busy} onClick={() => void run(version => write('revoke', version))}>Remove record access</Button><Button variant="ghost" disabled={!/^0x[\da-fA-F]{40}$/.test(editor.trim()) || busy} onClick={() => void run(async version => { const result = await inspectPaymentEditorScope(ensClient, checked.name, getAddress(editor.trim())); if (version === revision.current) setScope(result); })}>Check access</Button></div>
        {scope && scope.name === checked.name && scope.editor.toLowerCase() === editor.trim().toLowerCase() && <div className="section-block" role="status">
          <h3>Current editor permissions</h3>
          <KeyValue label="SQL payment record">{scope.paymentRecord ? 'Can update' : 'Cannot update'}</KeyValue>
          <KeyValue label="Website record (url)">{scope.websiteRecord ? 'Can update' : 'Cannot update'}</KeyValue>
          <p className="field-hint">Read from Sepolia at block {scope.blockNumber}. These checks cover the two named text records. No transaction was sent; existing payments are unchanged.</p>
          {scope.broaderPaymentAccess && <Notice tone="warning">This wallet has broader payment-record permissions. Removing one grant may leave other access in place.</Notice>}
          <Button variant="ghost" icon={Download} onClick={() => download('sql-ens-permissions.json', JSON.stringify({ schema: 'null.ens-permissions.v1', chainId: ENS_CHAIN_ID, ...scope, transactionsSent: 0 }, null, 2))}>Download permission check</Button>
        </div>}
      </details>}
    </div>}
    {walletAddress && <KeyValue label="Signing wallet"><EnsIdentity address={walletAddress} hints={checked ? [checked.name] : []} fallback="Signing wallet" /></KeyValue>}
    {hash && <p className="field-hint"><a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction on Sepolia <ExternalLink size={12} /></a></p>}
    {pending && !busy && <><Notice>Confirmation is still pending. Check this transaction before sending another update.</Notice><Button variant="secondary" onClick={() => void run(version => confirmed(hash!, version))}>Check confirmation</Button></>}
    {status && <p className="name-status" role="status">{status}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
