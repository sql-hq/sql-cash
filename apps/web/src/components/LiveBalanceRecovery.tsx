import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { createPublicClient, http } from 'viem';
import {
  NullLiveClient, createEncryptedCheckpointStore, validateDeploymentManifest,
  type DeploymentManifest, type OwnedTreasuryNote, type SecretCheckpoint,
} from '@null-protocol/client';
import { NullError, type ProfileKeys } from '@null-protocol/sdk';
import { config } from '../lib/config';
import { download, money } from '../lib/format';
import { Button, KeyValue, Modal, Notice } from './ui';

export interface RecoveredBalanceResult {
  treasuryBalance: bigint | null;
  notes: { id: string; amount: bigint; commitment: string; createdAt: string; allocationId: string }[];
}
export interface LiveBalanceRecoveryProps {
  open: boolean;
  onClose: () => void;
  onRecovered: (result: RecoveredBalanceResult) => void;
  identityKeys: ProfileKeys;
}
type RecoveryStore = ReturnType<typeof createEncryptedCheckpointStore>;
interface RecoverySummary {
  treasuryBalance: bigint | null;
  privateBalance: bigint;
  treasuryCount: number;
  privateCount: number;
  blockNumber: bigint;
  blockHash: string;
  source: 'graph' | 'rpc';
  checkedAt: string;
  treasuryWarning?: string;
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Restore canceled. Your displayed balances have not changed.';
  const message = error instanceof NullError ? error.code : error instanceof Error ? error.message : '';
  if (/NULL_CONTEXT_MISMATCH|NULL_VERIFIER_MISMATCH/.test(message)) return 'The test network settings do not match. Ask your administrator to check Settings before trying again.';
  if (/NULL_ROOT_STALE|NULL_HISTORY/.test(message)) return 'Payment history could not be confirmed. Wait a moment and try again, or choose another connection under Advanced recovery.';
  if (/NULL_RPC_UNAVAILABLE|NULL_GRAPH_UNAVAILABLE|fetch/i.test(message)) return 'Could not load payment history. Try another connection under Advanced recovery. This does not mean your balance is zero.';
  if (/NULL_PASSWORD_INVALID/.test(message)) return 'Enter your funds backup password, using 12 to 1,024 characters. Leave it blank if you only want to restore received payments.';
  if (/NULL_RECOVERY_UNLOCK_FAILED/.test(message)) return 'Could not unlock your funds backup. Check the password and backup file, then try again.';
  if (/NULL_RECOVERY_INVALID|NULL_ENCODING_INVALID/.test(message)) return 'This funds backup could not be opened. Choose an SQL funds backup (.json, under 2 MB) for this test network. A Payment ID backup is a different file.';
  if (/NULL_RECOVERY_EMPTY/.test(message)) return 'No funds backup is saved here yet. Restore a previous backup or add test funds first.';
  if (/NULL_STORAGE/.test(message)) return 'Could not open the backup saved in this browser. Try closing other SQL tabs, then try again.';
  if (/NULL_DEPLOYMENT/.test(message)) return 'The test network is not ready. Ask your administrator to check Settings, then try again.';
  return 'Could not restore your balance. Check your connection and backup password, then try again.';
}

export function LiveBalanceRecovery({ open, onClose, onRecovered, identityKeys }: LiveBalanceRecoveryProps) {
  const [manifest, setManifest] = useState<DeploymentManifest>();
  const [manifestError, setManifestError] = useState('');
  const [password, setPassword] = useState('');
  const [forceRpc, setForceRpc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [archiveMessage, setArchiveMessage] = useState('');
  const [summary, setSummary] = useState<RecoverySummary>();
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordRef = useRef('');
  const abortRef = useRef<AbortController | undefined>(undefined);
  const runRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setManifest(undefined); setManifestError(''); setError(''); setSummary(undefined); setArchiveMessage('');
    void (async () => {
      try {
        const url = new URL(config.manifestUrl, window.location.origin);
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'The test network settings could not be loaded.');
        const text = await response.text();
        if (text.length > 128_000) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'The test network settings could not be checked.');
        const value = JSON.parse(text) as DeploymentManifest;
        validateDeploymentManifest(value);
        if (config.poolAddress && value.contracts.nullPool.toLowerCase() !== config.poolAddress.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'The test network settings do not match.');
        if (!controller.signal.aborted) setManifest(value);
      } catch (reason) {
        if (!controller.signal.aborted) setManifestError(readableError(reason));
      }
    })();
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); runRef.current++; passwordRef.current = ''; };
  }, []);
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort(); runRef.current++; passwordRef.current = '';
      setPassword(''); setBusy(false); setStage('');
    }
  }, [open]);
  useEffect(() => {
    abortRef.current?.abort(); runRef.current++; setBusy(false); setSummary(undefined); setStage('');
  }, [identityKeys]);

  function close() {
    abortRef.current?.abort(); runRef.current++;
    passwordRef.current = ''; setPassword(''); setBusy(false); setStage(''); setError('');
    onClose();
  }
  function makeStore(): RecoveryStore {
    if (!manifest) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Load a valid deployed environment first.');
    return createEncryptedCheckpointStore({
      namespace: `null-${manifest.chainId}-${manifest.contracts.nullPool.slice(2).toLowerCase()}`,
      getPassword: async () => passwordRef.current,
    });
  }
  function makeClient(store: RecoveryStore): NullLiveClient {
    if (!manifest) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Load a valid deployed environment first.');
    return new NullLiveClient({ manifest, rpcUrls: config.rpcUrls, graphUrl: forceRpc ? undefined : config.graphUrl,
      artifactBaseUrl: (import.meta.env.VITE_ARTIFACT_BASE_URL || window.location.origin) as string,
      confirmations: config.confirmations, persistLocalSecret: store.persistLocalSecret,
    });
  }
  async function work(action: (signal: AbortSignal, runId: number) => Promise<void>) {
    if (busy) return;
    const runId = ++runRef.current; const controller = new AbortController(); abortRef.current = controller;
    passwordRef.current = password; setBusy(true); setError(''); setArchiveMessage('');
    try { await action(controller.signal, runId); }
    catch (reason) { if (runId === runRef.current && openRef.current) setError(readableError(reason)); }
    finally { if (runId === runRef.current) { setBusy(false); setStage(''); } }
  }
  const stillCurrent = (signal: AbortSignal, runId: number) => !signal.aborted && runId === runRef.current && openRef.current;

  async function recover(signal: AbortSignal, runId: number) {
    if (password && password.length < 12) throw new NullError('NULL_PASSWORD_INVALID', 'Use at least 12 characters, or leave the password blank to restore received payments only.');
    const store = makeStore(); const client = makeClient(store);
    setStage('Checking the test network…');
    await client.verifyDeployment({ signal });
    let checkpoints: SecretCheckpoint[] = [];
    let treasuryWarning: string | undefined;
    if (password) {
      setStage('Opening your saved funds backup…');
      try { checkpoints = (await store.load()).checkpoints.filter(checkpoint => checkpoint.context.chainId === client.context.chainId && checkpoint.context.poolAddress.toLowerCase() === client.context.poolAddress.toLowerCase()); }
      catch (reason) { treasuryWarning = `${readableError(reason)} Received payments can still be restored using your saved Payment ID.`; }
    }
    if (!treasuryWarning && checkpoints.length === 0) treasuryWarning = password
      ? 'No funds backup was found for this test network. Restore your funds backup file to check your available funds.'
      : 'Your available funds have not been checked. Enter your funds backup password, or restore the backup file, to include them.';
    let treasuryBalance: bigint | null = null;
    let treasuryNotes: OwnedTreasuryNote[] = [];
    if (checkpoints.some(checkpoint => checkpoint.kind === 'treasury')) {
      setStage('Checking your available funds…');
      try {
        const recovered = await client.recoverTreasuryNotes(checkpoints, { signal });
        treasuryNotes = recovered.filter(item => !item.spent && item.note.amountAtomic > 0n).map(item => item.note);
        treasuryBalance = treasuryNotes.reduce((total, note) => total + note.amountAtomic, 0n);
      } catch (reason) {
        signal.throwIfAborted(); treasuryWarning = `${readableError(reason)} Available funds could not be restored.`;
      }
    }
    setStage('Finding your collected payments…');
    const keys = { spendPrivateKey: new Uint8Array(identityKeys.spendPrivateKey), viewPrivateKey: new Uint8Array(identityKeys.viewPrivateKey) };
    let privateNotes;
    try { privateNotes = await client.recoverPrivateNotes({ keys, checkpoints, forceRpc, signal }); }
    finally { keys.spendPrivateKey.fill(0); keys.viewPrivateKey.fill(0); }
    setStage('Confirming payment amounts and dates…');
    const history = await client.syncHistory({ forceRpc, signal });
    const rpc = createPublicClient({ transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
    if (await rpc.getChainId() !== manifest!.chainId) throw new NullError('NULL_CONTEXT_MISMATCH', 'The RPC changed chains during recovery. Existing balances were kept.');
    const dates = new Map<bigint, Promise<{ hash: string; date: string }>>();
    const notes: RecoveredBalanceResult['notes'] = [];
    for (const note of privateNotes) {
      signal.throwIfAborted();
      const receipt = await rpc.getTransactionReceipt({ hash: note.transactionHash });
      if (receipt.status !== 'success' || receipt.blockNumber > history.blockNumber) throw new NullError('NULL_HISTORY_UNCONFIRMED', 'A recovered note has not reached the current confirmed history window. Refresh after the next confirmation.');
      let date = dates.get(receipt.blockNumber);
      if (!date) {
        date = rpc.getBlock({ blockNumber: receipt.blockNumber }).then(block => {
          if (block.hash !== receipt.blockHash) throw new NullError('NULL_ROOT_STALE', 'A note block changed during recovery. Refresh the confirmed history.');
          return { hash: block.hash, date: new Date(Number(block.timestamp) * 1000).toISOString() };
        });
        dates.set(receipt.blockNumber, date);
      }
      const verifiedBlock = await date;
      if (verifiedBlock.hash !== receipt.blockHash) throw new NullError('NULL_ROOT_STALE', 'A recovered note changed blocks during verification. Refresh the confirmed history.');
      notes.push({ id: note.commitment, amount: note.amountAtomic, commitment: note.commitment, createdAt: verifiedBlock.date, allocationId: note.claimNullifier });
    }
    if ((await rpc.getBlock({ blockNumber: history.blockNumber })).hash !== history.blockHash) throw new NullError('NULL_ROOT_STALE', 'Confirmed history changed before recovery finished. Existing balances were left unchanged.');
    if (!stillCurrent(signal, runId)) return;
    const privateBalance = notes.reduce((total, note) => total + note.amount, 0n);
    setSummary({ treasuryBalance, privateBalance, treasuryCount: treasuryNotes.length, privateCount: notes.length,
      blockNumber: history.blockNumber, blockHash: history.blockHash, source: history.source, checkedAt: new Date().toISOString(), treasuryWarning,
    });
    try { onRecovered({ treasuryBalance, notes }); }
    catch { setError('Your balance was checked, but the page could not update. Reopen the balance page to try again.'); }
  }

  async function importArchive(file: File | undefined, signal: AbortSignal, runId: number) {
    if (!file) return;
    if (password.length < 12) throw new NullError('NULL_PASSWORD_INVALID', 'Enter the funds backup password before restoring the file.');
    if (file.size > 2_000_000) throw new NullError('NULL_RECOVERY_INVALID', 'Choose an SQL funds backup file under 2 MB.');
    const store = makeStore(); const client = makeClient(store);
    setStage('Checking the test network…'); await client.verifyDeployment({ signal });
    setStage('Opening and saving your funds backup…');
    await store.importEncrypted(await file.text());
    if (stillCurrent(signal, runId)) { setSummary(undefined); setArchiveMessage('Funds backup restored on this device. Select Restore balance to check your payments.'); }
  }
  async function exportArchive(signal: AbortSignal, runId: number) {
    if (password.length < 12) throw new NullError('NULL_PASSWORD_INVALID', 'Enter your funds backup password before downloading the file.');
    const store = makeStore(); setStage('Opening your saved funds backup…');
    const saved = await store.load();
    if (saved.checkpoints.length === 0 && saved.policies.length === 0) throw new NullError('NULL_RECOVERY_EMPTY', 'No funds backup is saved here yet.');
    const encrypted = await store.exportEncrypted();
    if (!stillCurrent(signal, runId)) return;
    download('sql-encrypted-live-recovery.json', encrypted);
    setArchiveMessage('Funds backup downloaded. Keep the file and password in separate safe places.');
  }

  return <Modal open={open} onClose={close} title="Restore balance" description="Find your saved payments and check their latest balance." wide>
    <Notice icon={ShieldCheck}>This checks your test payments without sending money. Your backup stays on this device.</Notice>
    {manifestError ? <Notice tone="warning">{manifestError}<p>Your displayed balances have not been changed.</p></Notice>
      : !manifest ? <p className="processing-status" role="status">Connecting to the test network…</p>
      : <>
        <label className="field">Funds backup password <span className="field-hint">(optional)</span>
          <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder="At least 12 characters" />
          <small>Leave blank to restore received payments using your saved Payment ID. To also restore your available funds, enter the password you chose when adding funds or sending a payment (12 to 1,024 characters).</small>
        </label>
        <div className="button-row">
          <Button variant="secondary" icon={FileUp} disabled={busy || password.length < 12} onClick={() => fileInput.current?.click()}>Restore funds backup</Button>
          <Button variant="ghost" icon={Download} disabled={busy || password.length < 12} onClick={() => void work(exportArchive)}>Save funds backup</Button>
        </div>
        <input ref={fileInput} type="file" hidden accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void work((signal, runId) => importArchive(file, signal, runId)); }} />
        <p className="field-hint">Your funds backup (.json, under 2 MB) keeps access to your available funds and saved payment rules. It is separate from your Payment ID backup, which you can restore from your inbox.</p>
        <details className="section-block">
          <summary>Advanced recovery</summary>
          <label className="checkbox-field"><input type="checkbox" checked={forceRpc} onChange={event => setForceRpc(event.target.checked)} disabled={busy} /><span>Use another connection.</span></label>
          <p className="field-hint">Try this if your payment history does not load, then restore your balance again.</p>
        </details>
        {summary && <div className="section-block">
          <h3>Balance check</h3>
          <div className="detail-list">
            <KeyValue label="Available funds">{summary.treasuryBalance === null ? 'Not restored' : `${money(summary.treasuryBalance, true)} USDC`}</KeyValue>
            <KeyValue label="Collected payments">{money(summary.privateBalance, true)} USDC</KeyValue>
            <KeyValue label="Payments found">{summary.privateCount}</KeyValue>
            <KeyValue label="Checked at">{new Date(summary.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</KeyValue>
          </div>
          {summary.treasuryWarning && <Notice tone="warning">{summary.treasuryWarning}<p>Your collected payments were checked separately.</p></Notice>}
          {summary.privateCount === 0 && <p className="field-hint">No collected payments were found for this Payment ID. Check your inbox for payments waiting to be collected.</p>}
        </div>}
      </>}
    {archiveMessage && <Notice tone="success" icon={Check}>{archiveMessage}</Notice>}
    {busy && <p className="processing-status" role="status" aria-live="polite">{stage || 'Preparing to restore…'}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="secondary" onClick={close}>{summary ? 'Done' : busy ? 'Cancel check' : 'Cancel'}</Button><Button icon={RefreshCw} busy={busy} disabled={!manifest || Boolean(manifestError)} onClick={() => void work(recover)}>{summary ? 'Check again' : 'Restore balance'}</Button></div>
  </Modal>;
}
