import { useEffect, useMemo, useRef, useState } from 'react';
import type { PayoutDraft } from '@null-protocol/payouts';
import { PayoutClient, type ApprovePayoutOptions } from '@null-protocol/payouts/client';
import { type WithdrawalStep } from '@null-protocol/payouts/withdrawals';
import { createWalletClient, custom, getAddress, type EIP1193Provider, type Hex, type WalletClient } from 'viem';
import { publicKeyToAddress } from 'viem/accounts';
import { Check, Download, FileUp, KeyRound, ShieldCheck, Wallet } from 'lucide-react';
import {
  NullLiveClient, SubmissionUncertainError, createEncryptedCheckpointStore,
  validateDeploymentManifest, type ConfirmedOperation, type DeploymentManifest, type DistributionOptions,
  type WithdrawalOptions, type OwnedPrivateNote, type OperationStage, type OwnedTreasuryNote, type PreparedOperation,
} from '@null-protocol/client';
import {
  NullError, parseAmount, noteNullifier, authPolicyCommitment, fromHex, secp256k1, toHex, deriveField, randomBytes, utf8,
  type AuthPolicyOpening, type CompiledDistribution, type DiscoveredAllocation,
} from '@null-protocol/sdk';
import { config } from '../lib/config';
import { useStore } from '../lib/store';
import { PaymentNameError, recheckRequiredPaymentNames, type PaymentNameSnapshot } from '@null-protocol/ens';
import { ensClient } from '../lib/ens';
import { download, money, short, amount as displayAmount } from '../lib/format';
import { publicOperationReceipt, type ApprovalSource, type PublicOperationReceipt } from '../lib/operation-receipt';
import { useSession } from '../lib/session';
import { operationDiagnostic } from '../lib/operation-diagnostic';
import { Badge, Button, CopyButton, ExternalLink, KeyValue, Modal, Notice } from './ui';
import { useAccount } from '../lib/account';
import { useEnsIdentities } from '../lib/use-ens-identity';
import { ensIdentityLabel, ensIdentityOption, recheckEnsAddress, type EnsAddress } from '../lib/ens-identity';
import { EnsIdentity } from './EnsIdentity';
import { EnsAddressInput } from './EnsAddressInput';
import { PaymentProgress } from './PaymentProgress';
import { paymentCompletionDetail } from '../lib/payment-progress';
import { useWorkspaceAccess } from './EnsAccessGate';
import { withdrawalAmountState } from '../lib/withdrawal-amount';
import { WithdrawalAmountField } from './WithdrawalAmountField';

export type LiveOperationRequest = { kind: 'withdraw'; treasury: boolean } | { kind: 'shield'; amountAtomic: bigint } |
  { kind: 'claim'; allocation: DiscoveredAllocation } |
  { kind: 'create_distribution'; compiled: CompiledDistribution; paymentNames: PaymentNameSnapshot[]; draft: PayoutDraft; compilation: ApprovePayoutOptions['compilation']; batches?: { draft: PayoutDraft; compilation: ApprovePayoutOptions['compilation'] }[] };
export interface LiveOperationProps {
  open: boolean;
  onClose: () => void;
  operation: LiveOperationRequest;
  onConfirmed?: (result: ConfirmedOperation) => void;
  onBatchConfirmed?: (result: ConfirmedOperation, index: number) => void;
}
type Intent = Parameters<DistributionOptions['authorize']>[0] | Parameters<NonNullable<WithdrawalOptions['authorize']>>[0];
type SecretStore = ReturnType<typeof createEncryptedCheckpointStore>;
type WalletBridge = {
  connect: (chainId: number, address?: string) => Promise<WalletClient>;
  walletChoices?: readonly { address: string; label: string }[];
  authorize?: (intent: Intent, policy: AuthPolicyOpening) => Promise<Hex>;
  organizationKey?: () => Promise<Hex>;
};
const stageCopy: Record<OperationStage, string> = {
  deployment: 'Checking the connection…', history: 'Checking your balance and payment history…',
  authorization: 'Waiting for organization approval…', 'saving-recovery': 'Saving your encrypted funds backup…',
  loading: 'Getting ready…', witness: 'Preparing payment details…',
  proving: 'Preparing your payment securely…', complete: 'Preparation complete.',
  approval: 'Approve access to this amount in your wallet…', simulating: 'Checking that this payment can go through…',
  submitting: 'Sending your request…', confirming: 'Waiting for confirmation…',
  confirmed: 'Confirmed on the test network.',
};

function chainDefinition(id: number) {
  return { id, name: id === 11155111 ? 'Sepolia' : 'Local development', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } };
}
export function LiveOperation(props: LiveOperationProps) {
  const session = useSession();
  if (!props.open) return null;
  return <LiveOperationBody {...props} bridge={{
    walletChoices: (session.evmWallets ?? []).map(wallet => ({ address: wallet.address, label: 'Reown wallet' })),
    connect: async (chainId, address) => {
      const selected = address ?? session.evmWallets?.[0]?.address;
      if (!session.authenticated || !selected || !session.getEvmProvider) throw new NullError('NULL_WALLET_UNAVAILABLE', 'Connect your wallet with Reown first.');
      const provider = await session.getEvmProvider(selected) as EIP1193Provider;
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] });
      if (Number(await provider.request({ method: 'eth_chainId' })) !== chainId) throw new NullError('NULL_CONTEXT_MISMATCH', 'Switch your wallet to the requested network first.');
      await session.getEvmProvider(selected);
      return createWalletClient({ account: selected as Hex, chain: chainDefinition(chainId), transport: custom(provider) });
    },
  }} />;
}

function errorCopy(reason: unknown): string {
  if (reason instanceof PaymentNameError) return reason.message;
  if (operationDiagnostic(reason).some(error => error.code === 4001)) return 'The wallet request was declined. Open the request again and approve it in your wallet to continue.';
  const codes: Record<string, string> = {
    NULL_PRIVY_APPROVALS_REQUIRED: 'More people in your organization need to approve this payment. Complete approval with your organization, then import it using Advanced approval.',
    NULL_SESSION_REQUIRED: 'Sign in to your organization account before requesting approval.',
    NULL_PRIVY_AUTH_FAILED: 'The organization’s approval does not match this payment. Request approval again.',
    NULL_CONTEXT_MISMATCH: 'The payment or wallet network does not match your current setup. Check the selected network and payment before continuing.',
    NULL_ORGANIZATION_UNAVAILABLE: 'Organization approval is unavailable right now. Try again later, or import this payment’s approval using Advanced approval.',
    NULL_ARTIFACT_MISMATCH: 'Payment setup failed a safety check. Ask your administrator to repair the test network setup.',
    NULL_ARTIFACT_UNAVAILABLE: 'Payment setup is incomplete. Ask your administrator to finish the test network setup.',
    NULL_PROOF_FAILED: 'The payment could not be prepared. Your encrypted funds backup is still on this device. Try again.',
    NULL_SUBMISSION_UNCERTAIN: 'We could not confirm the result. Keep your funds backup and check the transaction status before trying again.',
    NULL_DEPLOYMENT_UNAVAILABLE: 'The test network is not set up yet. Ask your administrator to finish setup.',
    NULL_BALANCE_INSUFFICIENT: 'Your wallet does not have enough test USDC for this amount.',
    NULL_NULLIFIER_SPENT: 'This payment has already been collected, or the selected funds have already been used. Refresh your balance before continuing.',
    NULL_ROOT_STALE: 'Your balance or payment history has changed. Refresh it and prepare the payment again.',
    NULL_HISTORY_INCOMPLETE: 'The network returned incomplete payment history, so we could not verify your balance. Try the check again in a moment.',
    NULL_INTENT_EXPIRED: 'This payment’s approval period has ended. Prepare it again to continue.',
    NULL_DISTRIBUTION_UNCONFIRMED: 'This payment is not confirmed yet. Wait for confirmation, then check again.',
    NULL_TRANSACTION_REVERTED: 'The transaction failed on the network. No payment was completed.',
    NULL_TRANSACTION_MISMATCH: 'The transaction does not match the payment you reviewed. Check its status before trying again.',
    NULL_RPC_UNAVAILABLE: 'The network could not be reached. Try checking the status again later.',
    NULL_WALLET_REJECTED: 'The wallet request was declined. Approve it in your wallet if you want to continue.',
    NULL_APPROVAL_FAILED: 'Your wallet’s permission to use this amount was not confirmed. Check your wallet before trying again.',
    NULL_RELAY_REJECTED: 'The sending service did not accept this payment. You can choose My connected wallet to send it yourself.',
    NULL_STORAGE_UNAVAILABLE: 'Your encrypted funds backup could not be opened or saved. Check that this browser allows local storage before continuing.',
    NULL_RECOVERY_UNLOCK_FAILED: 'The funds backup could not be unlocked. Check your password and try again.',
    NULL_RECOVERY_INVALID: 'This funds backup could not be read. Use the encrypted funds backup for this account and test network, under 2 MB.',
    NULL_ENDPOINT_INVALID: 'The network connection is not set up correctly. Ask your administrator to check Advanced setup.',
  };
  if (reason instanceof NullError) return codes[reason.code] ?? reason.message;
  return reason instanceof Error && codes[reason.message] ? codes[reason.message]! : 'This step could not be completed. Check your connection and try again.';
}

function LiveOperationBody({ open, onClose, operation, onConfirmed, onBatchConfirmed, bridge }: LiveOperationProps & { bridge: WalletBridge }) {
  const workspaceStore = useStore();
  const account = useAccount();
  const access = useWorkspaceAccess();
  useEffect(() => { access.setOperationOpen(true); return () => access.setOperationOpen(false); }, [access.setOperationOpen]);
  const [privateNotes, setPrivateNotes] = useState<OwnedPrivateNote[]>([]);
  const [withdrawalNoteId, setWithdrawalNoteId] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [batchProgress, setBatchProgress] = useState(0);
  const batchReceipts = useRef<ConfirmedOperation[]>([]);
  const withdrawalSteps = useRef<WithdrawalStep[]>([]);
  const activeNames = useRef<PaymentNameSnapshot[]>(operation.kind === 'create_distribution' ? operation.paymentNames : []);
  const [recipient, setRecipient] = useState('');
  const [recipientName, setRecipientName] = useState<EnsAddress>();
  const [selectedWallet, setSelectedWallet] = useState('');
  const [manifest, setManifest] = useState<DeploymentManifest>();
  const [manifestError, setManifestError] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef('');
  const [vault, setVault] = useState<SecretStore>();
  const [client, setClient] = useState<NullLiveClient>();
  const payouts = useMemo(() => client ? new PayoutClient(client, ensClient) : undefined, [client]);
  const [policies, setPolicies] = useState<AuthPolicyOpening[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [policyBackup, setPolicyBackup] = useState('');
  const [activatedPolicy, setActivatedPolicy] = useState('');
  const [policyTransaction, setPolicyTransaction] = useState<Hex>();
  const [publicReceipts, setPublicReceipts] = useState<PublicOperationReceipt[]>([]);
  const [receiptError, setReceiptError] = useState('');
  const approvalSource = useRef<ApprovalSource>('not-required');
  const preparedApprovals = useRef(new WeakMap<PreparedOperation, { approval: ApprovalSource; compilation?: 'local' | 'cre-local-simulation' }>());
  const workInFlight = useRef(false), approvalInFlight = useRef(false);
  const [notes, setNotes] = useState<OwnedTreasuryNote[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [wallet, setWallet] = useState<WalletClient>();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<OperationStage>();
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<PreparedOperation>();
  const [confirmed, setConfirmed] = useState<ConfirmedOperation>();
  const [backupSaved, setBackupSaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reconciliation, setReconciliation] = useState('');
  const [transactionHash, setTransactionHash] = useState<Hex>();
  const [transport, setTransport] = useState<'relay' | 'wallet'>(config.relayerUrl && operation.kind !== 'shield' ? 'relay' : 'wallet');
  const [manualIntent, setManualIntent] = useState<Intent>();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [signature, setSignature] = useState('');
  const pendingApproval = useRef<{ resolve: (signature: Hex) => void; reject: (error: Error) => void } | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const policyFile = useRef<HTMLInputElement>(null);
  const recoveryFile = useRef<HTMLInputElement>(null);
  const policy = policies.find(item => authPolicyCommitment(item) === selectedPolicy);
  const policyAddresses = policies.map(item => publicKeyToAddress(toHex(secp256k1.ProjectivePoint.fromHex(fromHex(item.signerPublicKey)).toRawBytes(false))));
  const policyAddress = policy ? policyAddresses[policies.indexOf(policy)] : undefined;
  const identityHints = account.profile?.ensName ? [account.profile.ensName] : [];
  const walletIdentities = useEnsIdentities((bridge.walletChoices ?? []).map(choice => ({ address: choice.address, hints: identityHints })));
  const organizationIdentities = useEnsIdentities(policyAddresses.map(address => ({ address, hints: identityHints })));
  useEffect(() => {
    if (policyAddress && account.profile?.type === 'organization' && account.profile.organizationAddress?.toLowerCase() !== policyAddress.toLowerCase()) account.updateProfile({ ...account.profile, organizationAddress: policyAddress });
  }, [policyAddress, account.profile, account.updateProfile]);
  const treasuryOperation = operation.kind === 'shield' || operation.kind === 'create_distribution' || operation.kind === 'withdraw' && operation.treasury;
  const withdrawalNotes = treasuryOperation ? notes : privateNotes;
  const balanceWithdrawal = operation.kind === 'withdraw' && !operation.treasury && !!manifest?.security.partialWithdrawalsImplemented;
  const withdrawalPreview = useMemo(() => withdrawalAmountState(privateNotes, withdrawalAmount), [privateNotes, withdrawalAmount]);
  const withdrawalNote = balanceWithdrawal ? privateNotes[0] : withdrawalNotes.find(note => note.commitment === withdrawalNoteId);
  const amountAtomic = operation.kind === 'shield' ? operation.amountAtomic : operation.kind === 'claim'
    ? operation.allocation.amountAtomic : operation.kind === 'withdraw' ? balanceWithdrawal ? withdrawalPreview.amount : withdrawalAmount ? displayAmount(withdrawalAmount) : withdrawalNote?.amountAtomic ?? 0n : operation.batches?.reduce((total, batch) => total + batch.draft.summary.totalAmountAtomic, 0n) ?? operation.compiled.totalAmount;
  const proofOptions = () => ({ signal: controller.current?.signal, onProgress: setStage,
    onTransactionSubmitted: ({ hash, purpose }: { hash: Hex; purpose: string }) => {
      if (purpose === 'register-policy') setPolicyTransaction(hash);
      const method = operation.kind === 'create_distribution' ? 'createDistribution' : operation.kind;
      if (purpose === method || method === 'withdraw' && purpose === 'withdrawPartial') setTransactionHash(hash);
    } });

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setManifestError('');
    let url: URL;
    try { url = new URL(config.manifestUrl, window.location.origin); }
    catch { setManifestError('The test network setup is incomplete. Ask your administrator to check it.'); return () => abort.abort(); }
    void fetch(url, { signal: abort.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('manifest');
      const value = await response.json() as DeploymentManifest;
      validateDeploymentManifest(value);
      if (value.chainId !== Number(config.chainId) || value.contracts.nullPool.toLowerCase() !== config.poolAddress?.toLowerCase()) throw new Error('context');
      if ((operation.kind === 'shield' || operation.kind === 'withdraw') && !value.security.withdrawalsImplemented) { setManifestError('This pool has no withdrawals. New deposits are disabled until the withdrawal-capable deployment is ready.'); return; }
      setManifest(value);
    }).catch(() => { if (!abort.signal.aborted) setManifestError('The test network is not ready. Ask your administrator to finish setup before using this action.'); });
    return () => abort.abort();
  }, [open, operation.kind]);
  useEffect(() => () => { controller.current?.abort(); pendingApproval.current?.reject(new DOMException('Cancelled', 'AbortError')); passwordRef.current = ''; }, []);

  function close() {
    if (busy && !pendingApproval.current) {
      setError('Wait for the current operation to finish before closing. If a transaction has been sent, keep this screen open until its status is known.');
      return;
    }
    if (uncertain) {
      setError('Check the pending transaction status before closing. Its result is unknown; starting another payout could pay the same recipients twice.');
      return;
    }
    controller.current?.abort();
    pendingApproval.current?.reject(new DOMException('Cancelled', 'AbortError'));
    pendingApproval.current = undefined;
    setManualIntent(undefined); setPassword(''); passwordRef.current = '';
    onClose();
  }
  async function work(action: () => Promise<unknown>) {
    if (workInFlight.current) return;
    workInFlight.current = true;
    setError(''); setBusy(true); controller.current = new AbortController();
    try { await action(); }
    catch (reason) { setStage(undefined); if (!(reason instanceof DOMException && reason.name === 'AbortError')) { console.warn(JSON.stringify({ event: 'null_operation_failed', operation: operation.kind, causes: operationDiagnostic(reason) })); setError(errorCopy(reason)); } }
    finally { workInFlight.current = false; setBusy(false); }
  }
  async function refreshRecovery(store: SecretStore, live: NullLiveClient) {
    const saved = await store.load(); setPolicies(saved.policies);
    if (saved.policies[0]) setSelectedPolicy(authPolicyCommitment(saved.policies[0]));
    if (operation.kind === 'withdraw' && !operation.treasury) setPrivateNotes(await live.recoverPrivateNotes({keys:workspaceStore.identity.keys,checkpoints:saved.checkpoints,...proofOptions()}));
    if (treasuryOperation) {
      const recovered = await live.recoverTreasuryNotes(saved.checkpoints, proofOptions());
      setNotes(recovered.filter(item => !item.spent && item.note.amountAtomic > 0n).map(item => item.note));
      workspaceStore.setLiveTreasuryBalance(recovered.filter(item => !item.spent).reduce((sum, item) => sum + item.note.amountAtomic, 0n));
    }
  }
  async function unlock() {
    if (!manifest) return;
    if (password.length < 12) throw new NullError('NULL_PASSWORD_INVALID', 'Use a funds backup password with at least 12 characters.');
    passwordRef.current = password;
    const store = createEncryptedCheckpointStore({ namespace: `null-${manifest.chainId}-${manifest.contracts.nullPool.slice(2).toLowerCase()}`, getPassword: async () => passwordRef.current });
    const live = new NullLiveClient({ manifest, rpcUrls: config.rpcUrls, graphUrl: config.graphUrl,
      artifactBaseUrl: (import.meta.env.VITE_ARTIFACT_BASE_URL || window.location.origin) as string,
      confirmations: config.confirmations, persistLocalSecret: store.persistLocalSecret });
    await live.verifyDeployment(proofOptions());
    await refreshRecovery(store, live);
    setVault(store); setClient(live); setStage(undefined);
  }
  async function connect() {
    if (!manifest) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Wait for the network setup to load.');
    const value = await bridge.connect(manifest.chainId, selectedWallet || wallet?.account?.address);
    setWallet(value); setSelectedWallet(value.account?.address ?? ''); return value;
  }
  async function importPolicy(file?: File) {
    if (!file || !vault) return;
    if (file.size > 16_384) throw new NullError('NULL_POLICY_INVALID', 'Choose an organization setup file under 16 KB.');
    let opening: AuthPolicyOpening;
    try {
      const json = JSON.parse(await file.text()) as Record<string, unknown>;
      if (typeof json.signerPublicKey !== 'string' || typeof json.policyMetadata !== 'string' || typeof json.registrationBlinder !== 'string') throw new Error('shape');
      opening = { signerPublicKey: json.signerPublicKey as Hex, policyMetadata: BigInt(json.policyMetadata), registrationBlinder: BigInt(json.registrationBlinder) };
      authPolicyCommitment(opening);
    } catch { throw new NullError('NULL_POLICY_INVALID', 'This organization setup file could not be read. Ask your administrator for the correct file.'); }
    await vault.persistLocalPolicy(opening);
    setPolicyBackup(''); setActivatedPolicy(''); setPolicyTransaction(undefined);
    const values = (await vault.load()).policies; setPolicies(values); setSelectedPolicy(authPolicyCommitment(opening));
  }
  async function useOrganization() {
    if (!vault || !bridge.organizationKey) return;
    const signerPublicKey = await bridge.organizationKey();
    const saved = (await vault.load()).policies.find(item => item.signerPublicKey.toLowerCase() === signerPublicKey.toLowerCase());
    const seed = randomBytes(32);
    try {
      const opening = saved ?? { signerPublicKey, policyMetadata: deriveField(seed, utf8('null.privy.policy')), registrationBlinder: deriveField(seed, utf8('null.privy.registration')) };
      await vault.persistLocalPolicy(opening);
      setPolicyBackup(''); setActivatedPolicy(''); setPolicyTransaction(undefined);
      setPolicies((await vault.load()).policies); setSelectedPolicy(authPolicyCommitment(opening)); setSelectedNotes([]);
    } finally { seed.fill(0); }
  }
  async function importRecovery(file?: File) {
    if (!file || !vault || !client) return;
    if (file.size > 2_000_000) throw new NullError('NULL_RECOVERY_INVALID', 'Choose an encrypted funds backup file under 2 MB.');
    await vault.importEncrypted(await file.text()); await refreshRecovery(vault, client);
    setPolicyBackup(''); setActivatedPolicy(''); setPolicyTransaction(undefined);
  }
  async function exportRecovery() {
    if (!vault) return;
    setStage('saving-recovery');
    download('sql-encrypted-live-recovery.json', await vault.exportEncrypted());
    if (policy) setPolicyBackup(authPolicyCommitment(policy));
    if (prepared) setBackupSaved(true);
    setStage(prepared ? 'complete' : undefined);
  }
  async function registerPolicy() {
    if (!client || !vault || !policy) return;
    if (policyBackup !== selectedPolicy) throw new Error('Download the encrypted organization backup before activation.');
    // A known transaction is checked before permitting another wallet request.
    if (policyTransaction) {
      try {
        const activated = await client.reconcilePolicyRegistration(authPolicyCommitment(policy), policyTransaction, proofOptions());
        setActivatedPolicy(activated.policyCommitment); setPolicyTransaction(activated.transactionHash); setStage(undefined);
        return;
      } catch (reason) {
        if (reason instanceof NullError && reason.code === 'NULL_POLICY_REGISTRATION_FAILED') setPolicyTransaction(undefined);
        throw reason;
      }
    }
    await access.verify(policyAddress);
    const connected = await connect();
    const activated = await client.registerPolicy({ opening: policy, wallet: connected, persistLocalPolicy: vault.persistLocalPolicy, ...proofOptions() });
    setActivatedPolicy(activated.policyCommitment);
    if (activated.transactionHash) setPolicyTransaction(activated.transactionHash);
    setStage(undefined);
  }
  function rememberPrepared(result: PreparedOperation) {
    preparedApprovals.current.set(result, { approval: approvalSource.current, ...(operation.kind === 'create_distribution' ? { compilation: (operation.batches?.[batchReceipts.current.length]?.compilation ?? operation.compilation).mode } : {}) });
    setPrepared(result);
  }
  function recordPublicReceipt(result: ConfirmedOperation) {
    if (!prepared || !manifest) return;
    try {
      const receipt = publicOperationReceipt(prepared, result, {
        ...(preparedApprovals.current.get(prepared) ?? { approval: 'not-required' }), protocolVersion: manifest.protocolVersion,
      });
      setPublicReceipts(values => values.some(value => value.transactionHash === receipt.transactionHash) ? values : [...values, receipt]);
      setReceiptError('');
    } catch { setReceiptError('The transaction is confirmed, but its shareable receipt could not be prepared. Keep the explorer link.'); }
  }
  async function refreshConfirmedFunds(result: ConfirmedOperation) {
    if (operation.kind === 'withdraw' && !operation.treasury && result.withdrawal) {
      const source = [...privateNotes, ...withdrawalSteps.current.map(step => step.note)].find(note => noteNullifier(note.commitment, note.ownerNullifierKey) === result.withdrawal!.nullifier);
      if (source) {
        const change = result.note.commitment !== source.commitment && 'claimNullifier' in result.note ? result.note : undefined;
        workspaceStore.recordPrivateWithdrawal(source.commitment, change ? { id: change.commitment, commitment: change.commitment, amount: change.amountAtomic, allocationId: change.claimNullifier, createdAt: new Date().toISOString() } : undefined);
      }
    }
    const label = operation.kind === 'shield' ? 'Funds added' : operation.kind === 'create_distribution' ? 'Payment sent' : operation.kind === 'claim' ? 'Payment collected' : 'Withdrawal confirmed';
    workspaceStore.recordLiveActivity(result.transactionHash, label, operation.kind === 'shield' || operation.kind === 'withdraw' && operation.treasury ? 'shield' : operation.kind === 'create_distribution' ? 'distribution' : 'claim');
    if (!treasuryOperation || !vault || !client) return;
    // A confirmed transaction stays successful even if a later balance read fails.
    workspaceStore.setLiveTreasuryBalance(null);
    if (!result.localRecoverySaved) return;
    try {
      const recovered = await client.recoverTreasuryNotes((await vault.load()).checkpoints);
      workspaceStore.setLiveTreasuryBalance(recovered.filter(item => !item.spent).reduce((sum, item) => sum + item.note.amountAtomic, 0n));
    } catch { /* Keep the balance unknown; Restore balance can check it again. */ }
  }
  async function prepare() {
    if (!client) return;
    await access.verify(treasuryOperation ? policyAddress : undefined);
    approvalSource.current = 'not-required';
    if (operation.kind === 'create_distribution') await recheckRequiredPaymentNames(ensClient, activeNames.current, activeNames.current.length);
    let result: PreparedOperation;
    if (operation.kind === 'shield') {
      if (!policy || !acknowledged) throw new NullError('NULL_PRIVACY_BOUNDARY', 'Choose your organization in Organization setup and confirm that you understand the deposit notice.');
      result = await client.prepareShield({ amountAtomic: operation.amountAtomic, policyCommitment: authPolicyCommitment(policy), acknowledgePublicDeposit: true, ...proofOptions() });
    } else if (operation.kind === 'withdraw') {
      if (!withdrawalNote || !acknowledged) throw new NullError('NULL_PRIVACY_BOUNDARY', 'Select a note and acknowledge the public withdrawal.');
      if (recipientName) await recheckEnsAddress(ensClient, recipientName);
      if (balanceWithdrawal && !withdrawalSteps.current.length) {
        if (withdrawalPreview.error) throw new NullError('NULL_AMOUNT_INVALID', withdrawalPreview.error);
        withdrawalSteps.current = withdrawalPreview.steps;
      }
      const step = withdrawalSteps.current[batchReceipts.current.length];
      result = await client.prepareWithdrawal({note:step?.note ?? withdrawalNote,recipient:getAddress(recipient.trim()),...(step ? {amountAtomic:step.amountAtomic} : withdrawalAmount ? {amountAtomic:parseAmount(withdrawalAmount)} : {}),acknowledgePublicWithdrawal:true,...proofOptions(),...(operation.treasury ? {authPolicy:policy,authorize:async (intent: Parameters<NonNullable<WithdrawalOptions['authorize']>>[0]) => {setManualIntent(intent);return new Promise<Hex>((resolve,reject)=>{pendingApproval.current={resolve,reject};});}} : {})});
    } else if (operation.kind === 'claim') {
      result = await client.prepareClaim({ allocation: operation.allocation, ...proofOptions() });
    } else {
      if (!policy) throw new NullError('NULL_POLICY_INVALID', 'Connect or restore your organization setup first.');
      const chosen = notes.filter(note => selectedNotes.includes(note.commitment) && note.policyCommitment === selectedPolicy);
      if (chosen.length < 1 || chosen.length > 2) throw new NullError('NULL_NOTE_INVALID', 'Choose one or two available balances in Organization setup.');
      const batch = operation.batches?.[batchReceipts.current.length] ?? { draft: operation.draft, compilation: operation.compilation };
      activeNames.current = batch.draft.paymentNames;
      result = await payouts!.approve(batch.draft, { compilation: batch.compilation, treasuryNotes: chosen, authPolicy: policy, ...proofOptions(),
        authorize: async intent => {
          setManualIntent(intent);
          return new Promise<Hex>((resolve, reject) => { pendingApproval.current = { resolve, reject }; });
        },
      });
    }
    await access.verify(treasuryOperation ? policyAddress : undefined);
    rememberPrepared(result); setBackupSaved(false); setTransactionHash(undefined); setStage('complete');
  }
  async function approveWithOrganization() {
    if (!manualIntent || !policy || !bridge.authorize || approvalInFlight.current) return;
    approvalInFlight.current = true;
    setError(''); setApprovalBusy(true);
    try {
      await access.verify(policyAddress);
      if (operation.kind === 'create_distribution') await recheckRequiredPaymentNames(ensClient, activeNames.current, activeNames.current.length);
      const signed = await bridge.authorize(manualIntent, policy);
      approvalSource.current = 'privy-owner';
      pendingApproval.current?.resolve(signed); pendingApproval.current = undefined; setManualIntent(undefined);
    } catch (reason) { setError(errorCopy(reason)); }
    finally { approvalInFlight.current = false; setApprovalBusy(false); }
  }
  async function importSignature() {
    if (approvalInFlight.current || !pendingApproval.current) return;
    if (!/^0x[0-9a-fA-F]{128}$/.test(signature.trim())) { setError('This approval code could not be read. Copy the full code from your organization’s signing tool; it starts with 0x.'); return; }
    approvalInFlight.current = true; setApprovalBusy(true);
    try {
      await access.verify(policyAddress);
      if (operation.kind === 'create_distribution') await recheckRequiredPaymentNames(ensClient, activeNames.current, activeNames.current.length);
      approvalSource.current = 'imported';
      pendingApproval.current?.resolve(signature.trim() as Hex); pendingApproval.current = undefined;
      setSignature(''); setManualIntent(undefined); setError('');
    } catch (reason) { setError(errorCopy(reason)); }
    finally { approvalInFlight.current = false; setApprovalBusy(false); }
  }
  function recordBatch(result: ConfirmedOperation) {
    if (batchReceipts.current.some(receipt => receipt.transactionHash === result.transactionHash)) return;
    const index = batchReceipts.current.length; batchReceipts.current.push(result); setBatchProgress(batchReceipts.current.length);
    if (operation.kind === 'create_distribution') try { onBatchConfirmed?.(result, index); } catch { /* A UI callback cannot alter a confirmed transaction. */ }
  }
  async function submit() {
    if (!prepared || !client || !backupSaved || uncertain) return;
    await access.verify(treasuryOperation ? policyAddress : undefined);
    if (operation.kind === 'create_distribution') await recheckRequiredPaymentNames(ensClient, activeNames.current, activeNames.current.length);
    setTransactionHash(undefined); setReconciliation('');
    try {
      const connected = transport === 'wallet' ? await connect() : undefined;
      if (connected) setWallet(connected);
      if (operation.kind === 'withdraw' && recipientName) await recheckEnsAddress(ensClient, recipientName);
      const sender = operation.kind === 'create_distribution' ? payouts! : client;
      let result = batchReceipts.current.find(receipt => operation.kind === 'create_distribution' ? receipt.distributionCommitment === prepared.publicOperation.publicInputs[7] : operation.kind === 'withdraw' && receipt.withdrawal?.nullifier === prepared.publicOperation.publicInputs[5]) ?? await sender.submit(prepared, connected ? { mode: 'wallet', wallet: connected } : { mode: 'relay', url: config.relayerUrl! }, proofOptions());
      recordPublicReceipt(result);
      await refreshConfirmedFunds(result);
      if (balanceWithdrawal && withdrawalSteps.current.length > 1) {
        recordBatch(result);
        if (!result.localRecoverySaved) throw new Error('Withdrawal confirmed, but local recovery was not saved. Restore recovery before continuing.');
        if (batchReceipts.current.length < withdrawalSteps.current.length) {
          const step = withdrawalSteps.current[batchReceipts.current.length];
          const next = await client.prepareWithdrawal({ ...step, recipient: getAddress(recipient.trim()), acknowledgePublicWithdrawal: true, ...proofOptions() });
          approvalSource.current = 'not-required'; rememberPrepared(next); setBackupSaved(false); setTransactionHash(undefined);
          setStage('complete');
          setReconciliation('Save the updated funds backup, then confirm the next transfer. The completed transfer will not be repeated.');
          return;
        }
      }
      if (operation.kind === 'create_distribution' && operation.batches && operation.batches.length > 1) {
        recordBatch(result);
        if (!result.localRecoverySaved) throw new Error('Payment confirmed, but recovery could not be saved. Stop and restore the confirmed change before continuing.');
        if (batchReceipts.current.length < operation.batches.length) {
          const batch = operation.batches[batchReceipts.current.length]; activeNames.current = batch.draft.paymentNames;
          const available = (await client.recoverTreasuryNotes((await vault!.load()).checkpoints)).filter(item => !item.spent && item.note.policyCommitment === selectedPolicy && item.note.amountAtomic > 0n).map(item => item.note);
          approvalSource.current = 'not-required';
          const next = await payouts!.approve(batch.draft, { compilation: batch.compilation, treasuryNotes: available.slice(0, 2), authPolicy: policy!, ...proofOptions(),
            authorize: async intent => { setManualIntent(intent); return new Promise<Hex>((resolve, reject) => { pendingApproval.current = { resolve, reject }; }); },
          });
          rememberPrepared(next); setBackupSaved(false); setTransactionHash(undefined);
          setStage('complete');
          setReconciliation('Save the updated funds backup, then confirm the next batch. Completed batches will not be repeated.');
          return;
        }
      }
      setConfirmed(result); setStage('confirmed');
      try { onConfirmed?.(result); } catch { /* A parent UI callback cannot change the confirmed chain result. */ }
    } catch (reason) {
      if (reason instanceof SubmissionUncertainError) { setUncertain(true); if (reason.transactionHash) setTransactionHash(reason.transactionHash); }
      throw reason;
    }
  }

  async function reconcile() {
    if (!prepared || !client) return;
    const sender = operation.kind === 'create_distribution' ? payouts! : client;
    const state = await sender.reconcile(prepared, transactionHash, proofOptions());
    if (state.status === 'confirmed') {
      recordPublicReceipt(state.result);
      await refreshConfirmedFunds(state.result);
      if (balanceWithdrawal && withdrawalSteps.current.length > 1) {
        recordBatch(state.result);
        if (batchReceipts.current.length < withdrawalSteps.current.length) {
          setUncertain(false); setBackupSaved(true); setStage('complete');
          setReconciliation('This transfer is confirmed. Continue to withdraw the remaining amount; completed transfers will not be repeated.');
          return;
        }
      }
      if (operation.kind === 'create_distribution' && operation.batches && operation.batches.length > 1) {
        recordBatch(state.result);
        if (batchReceipts.current.length < operation.batches.length) {
          setUncertain(false); setBackupSaved(true); setStage('complete');
          setReconciliation('This batch is confirmed. Continue to send the remaining batches; confirmed batches will not be repeated.');
          return;
        }
      }
      setConfirmed(state.result); setUncertain(false); setTransactionHash(state.result.transactionHash); setStage('confirmed'); setReconciliation('');
      try { onConfirmed?.(state.result); } catch { /* Confirmed chain state remains authoritative. */ }
    } else if (state.status === 'reverted') {
      setUncertain(false); setPrepared(undefined); setBackupSaved(false); setTransactionHash(state.transactionHash); setStage(undefined);
      setReconciliation('The network confirmed that this transaction failed. No payment was completed. You can prepare it again.');
    } else {
      if (state.status === 'pending') setTransactionHash(state.transactionHash);
      setStage(undefined);
      setReconciliation(state.status === 'pending' ? 'The transaction is still waiting for confirmation. Check again before trying to send it again.' : 'The result is still unknown. Keep your funds backup and check again before trying to send it again.');
    }
  }

  const title = operation.kind === 'shield' ? 'Add funds' : operation.kind === 'claim' ? 'Collect payment' : operation.kind === 'withdraw' ? 'Withdraw funds' : 'Send private payment';
  const paymentRecipients = operation.kind === 'create_distribution' ? (operation.batches ?? [{ draft: operation.draft }]).flatMap(batch => batch.draft.paymentNames.map((row, index) => ({ name: row.name, amount: workspaceStore.hideBalances ? '••••' : money(BigInt(batch.draft.creInput.recipients[index].amountAtomic), true) }))) : undefined;
  const senderName = walletIdentities.get(wallet?.account?.address ?? selectedWallet);
  const gasWalletName = senderName.status === 'verified' ? senderName.name : undefined;
  const fromName = operation.kind === 'claim' ? 'Private payment' : operation.kind === 'shield' ? gasWalletName ?? 'Choose your funding wallet' : access.linked.name;
  const toName = operation.kind === 'create_distribution' ? paymentRecipients?.length === 1 ? paymentRecipients[0].name : `${paymentRecipients?.length ?? operation.paymentNames.length} ENS recipients` : operation.kind === 'withdraw' ? recipientName?.name ?? (recipient ? short(recipient) : 'Choose a receiving wallet') : access.linked.name;
  return <Modal title={title} open={open} onClose={close} wide className="payment-modal">
    <PaymentProgress kind={operation.kind} amount={workspaceStore.hideBalances ? '••••••' : money(amountAtomic, true)} from={fromName} to={toName} recipients={paymentRecipients} gasWallet={gasWalletName}
      cre={operation.kind === 'create_distribution' && operation.compilation.mode === 'cre-local-simulation'} batch={operation.kind === 'create_distribution' && operation.batches && operation.batches.length > 1 ? `Batch ${batchProgress + 1} of ${operation.batches.length}` : undefined}
      state={{ unlocked: !!client, prepared: !!prepared, backupSaved, confirmed: !!confirmed, busy, approvalNeeded: !!manualIntent, uncertain, submitted: !!transactionHash, stage, transport }} />
    {operation.kind === 'create_distribution' && operation.batches && operation.batches.length > 1 && <Notice>{batchProgress} of {operation.batches.length} private batches confirmed. Your wallet may request an approval for each batch. Completed batches are not rolled back if a later batch fails.</Notice>}
    {operation.kind === 'withdraw' && !client && <p className="field-hint">Unlock your funds to check the available balance and choose how much to withdraw.</p>}
    {manifestError ? <Notice tone="warning">{manifestError}<p>Nothing has been sent.</p></Notice>
      : !manifest ? <p className="processing-status" role="status">Checking the connection…</p>
      : <>
        {operation.kind === 'shield' && <Notice tone="warning">Your wallet and the amount you add are public. Adding funds close to payment time may help others link them. Use test funds only.</Notice>}
        {!client ? <>
          <label className="field">Funds backup password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="At least 12 characters" disabled={busy} /><small>First time? Choose a password with at least 12 characters. Returning? Use your existing funds backup password. Only your encrypted backup is saved in this browser.</small></label>
          <Button icon={KeyRound} busy={busy} onClick={() => void work(unlock)}>Unlock funds</Button>
        </> : <>
          {!confirmed && !busy && !manualIntent && <details className="payment-wallet-options" open={!prepared}>
            <summary>{wallet?.account ? 'Sending wallet and network fee' : 'Choose your sending wallet'}</summary>
            {!!bridge.walletChoices && bridge.walletChoices.length > 1 && <label className="field">Sending wallet<select value={selectedWallet} disabled={busy || uncertain} onChange={event => { setSelectedWallet(event.target.value); setWallet(undefined); setError(''); }}><option value="">Choose your funded wallet</option>{bridge.walletChoices.map((choice, index) => <option key={choice.address} value={choice.address}>{ensIdentityOption(walletIdentities.get(choice.address), `${choice.label} wallet ${index + 1}`)}</option>)}</select><small>{operation.kind === 'shield' ? 'Choose the wallet holding your test USDC and Sepolia ETH. Organization approval uses its separate signer.' : 'This wallet pays the Sepolia gas fee. Its address will be public.'}</small></label>}
            <div className="button-row"><Button variant="secondary" disabled={busy || uncertain} icon={Wallet} onClick={() => void work(connect)}>{wallet?.account ? 'Change sending wallet' : 'Connect wallet'}</Button>{!prepared && <Button variant="ghost" disabled={busy} icon={FileUp} onClick={() => recoveryFile.current?.click()}>Restore funds backup</Button>}</div>
            {wallet?.account && <KeyValue label="Connected sending wallet"><EnsIdentity address={wallet.account.address} hints={identityHints} fallback="Sending wallet" /></KeyValue>}
            {selectedWallet && !wallet?.account && <KeyValue label="Selected sending wallet"><EnsIdentity address={selectedWallet} hints={identityHints} fallback="Sending wallet" /></KeyValue>}
          </details>}
          {!prepared && !busy && !manualIntent && <>
            <input ref={recoveryFile} hidden type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void work(() => importRecovery(file)); }} />
            {treasuryOperation && <>
              <section className="section-block" aria-label="Organization setup">
              <details className="payment-organization-settings" open={!policy}><summary>{policy ? 'Organization setup and recovery' : 'Set up your organization'}</summary>
              <p className="field-hint">Connect your Privy organization, save its encrypted backup, then activate it on Sepolia. If this organization already exists, restore its funds backup first.</p>
              {policies.length > 0 && <label className="field">Organization identity<select value={selectedPolicy} disabled={busy} onChange={event => { setSelectedPolicy(event.target.value); setSelectedNotes([]); setActivatedPolicy(''); setPolicyTransaction(undefined); }}>{policies.map((item, index) => { const commitment = authPolicyCommitment(item); return <option key={commitment} value={commitment}>{ensIdentityLabel(organizationIdentities.get(policyAddresses[index]), 'Organization')} · Setup {index + 1}</option>; })}</select></label>}
              {policyAddress && <><KeyValue label="Organization signer"><EnsIdentity address={policyAddress} hints={identityHints} fallback="Organization" /></KeyValue><p className="field-hint"><a href="#/settings" onClick={event => { if (busy || uncertain) event.preventDefault(); else close(); }}>Manage organization ENS name</a></p><details className="progressive-details"><summary>Setup details</summary><span className="code-with-copy"><code>{selectedPolicy}</code><CopyButton value={selectedPolicy} /></span></details></>}
              {bridge.organizationKey && <p className="field-hint">Privy asks your organization owner to approve an identity-only signature. This identifies the signer and moves no funds.</p>}<div className="button-row">{bridge.organizationKey && <Button variant="secondary" disabled={busy} icon={ShieldCheck} onClick={() => void work(useOrganization)}>Use Privy organization</Button>}<Button variant="secondary" disabled={busy} icon={FileUp} onClick={() => policyFile.current?.click()}>Import setup file</Button><Button variant="secondary" disabled={busy || !policy} icon={Download} onClick={() => void work(exportRecovery)}>Save organization backup</Button><Button variant="ghost" disabled={busy || !policy || policyBackup !== selectedPolicy || activatedPolicy === selectedPolicy} onClick={() => void work(registerPolicy)}>{policyTransaction ? 'Check activation' : 'Activate organization setup'}</Button></div>
              <input ref={policyFile} hidden type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void work(() => importPolicy(file)); }} />
              {policy && <p className="field-hint" role="status">{activatedPolicy === selectedPolicy ? 'Organization setup is active on Sepolia.' : policyBackup === selectedPolicy ? 'Backup exported. Keep it safe before activating a new setup.' : 'Keep an encrypted copy of this organization setup.'}</p>}
              {policyTransaction && <p className="field-hint"><ExternalLink href={`https://sepolia.etherscan.io/tx/${policyTransaction}`}>View organization activation</ExternalLink></p>}
              </details>
              {operation.kind === 'create_distribution' && <>
                <h3>Available funds</h3>
                <p className="field-hint">Choose one or two available balances to cover this payment. Any money left over stays in your funds.</p>
                {notes.filter(note => note.policyCommitment === selectedPolicy).length === 0 && <Notice tone="warning">No available funds were found for this organization. Restore its encrypted funds backup or add test funds first.</Notice>}
                {notes.filter(note => note.policyCommitment === selectedPolicy).map(note => <label className="checkbox-field" key={note.commitment}><input type="checkbox" checked={selectedNotes.includes(note.commitment)} disabled={busy || (!selectedNotes.includes(note.commitment) && selectedNotes.length >= 2)} onChange={event => setSelectedNotes(values => event.target.checked ? [...values, note.commitment] : values.filter(value => value !== note.commitment))} /><span>{money(note.amountAtomic, true)} USDC · <code>{short(note.commitment, 5)}</code></span></label>)}
              </>}
            </section></>}
            {operation.kind === 'withdraw' && <div className="section-block">
              {!balanceWithdrawal && <label className="field">Funds to withdraw<select value={withdrawalNoteId} disabled={busy || !!prepared} onChange={event => {setWithdrawalNoteId(event.target.value); setWithdrawalAmount(''); const chosen=withdrawalNotes.find(note=>note.commitment===event.target.value);if(chosen && 'policyCommitment' in chosen)setSelectedPolicy(chosen.policyCommitment);}}><option value="">Choose a note</option>{withdrawalNotes.map((note,index)=><option key={note.commitment} value={note.commitment}>{money(note.amountAtomic,true)} USDC · Note {index+1}</option>)}</select><small>This deployed pool supports full-note withdrawals. Partial recipient withdrawals require the v0.3 pool.</small></label>}
              {balanceWithdrawal && <WithdrawalAmountField value={withdrawalAmount} state={withdrawalPreview} hidden={workspaceStore.hideBalances} disabled={busy || !!prepared || batchProgress > 0} onChange={value => { withdrawalSteps.current = []; setWithdrawalAmount(value); }} />}
              {!withdrawalNotes.length && <Notice>No available notes. Restore your Payment ID or funds backup first.</Notice>}
              <EnsAddressInput label="Receiving wallet" allowAddress disabled={busy || !!prepared || batchProgress > 0} onChange={(address, name) => { setRecipient(address); setRecipientName(name); setAcknowledged(false); }} />
              <Notice tone="warning">The receiving address and amount become public. A known address, timing or wallet used to pay gas can link your activity. A relayer hides your gas-paying wallet, not this public exit.</Notice>
              <label className="checkbox-field"><input type="checkbox" checked={acknowledged} disabled={busy || !recipient} onChange={event=>setAcknowledged(event.target.checked)} /><span>I checked the receiving wallet and understand the withdrawal is public.</span></label>
            </div>}
            {operation.kind === 'shield' && <label className="checkbox-field"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand that my wallet and deposit amount will be public. These are test funds.</span></label>}
          </>}
          {manualIntent && <div className="section-block">
            <h3>Organization approval needed</h3><p className="field-hint">Your organization must approve this payment before it can be sent.</p>
            {bridge.authorize && <Button icon={ShieldCheck} busy={approvalBusy} onClick={() => void approveWithOrganization()}>Approve with organization</Button>}
            {!bridge.authorize && <p className="field-hint">Open Advanced approval to download a request for your administrator, then paste the approval they provide.</p>}
            <details><summary>Advanced approval</summary><p className="field-hint">Use an approval from your organization’s signing tool for this payment only.</p><KeyValue label="Approval reference"><span className="code-with-copy"><code>{short(manualIntent.digest)}</code><CopyButton value={manualIntent.digest} /></span></KeyValue><label className="field">Approval code<input value={signature} disabled={approvalBusy} onChange={event => setSignature(event.target.value)} spellCheck={false} autoComplete="off" placeholder="Paste the full approval code, starting with 0x" /><small>The signing tool must return a 64-byte compact signature for the raw approval digest.</small></label><div className="button-row"><Button variant="secondary" icon={Download} onClick={() => download('sql-public-approval-intent.json', JSON.stringify({ digest: manualIntent.digest, publicInputs: manualIntent.publicInputs }, null, 2))}>Download approval request</Button><Button disabled={approvalBusy} onClick={importSignature}>Use this approval</Button></div></details>
          </div>}
          {prepared && !confirmed && !busy && <div className="section-block payment-backup-step">
            <h3>Save funds backup before confirming</h3>{operation.kind === 'withdraw' && prepared && <KeyValue label="Receiving wallet"><EnsIdentity address={`0x${BigInt(prepared.publicOperation.publicInputs[6]!).toString(16).padStart(40,'0')}`} hints={recipientName ? [recipientName.name] : []} fallback="Receiving wallet" /></KeyValue>}<div className="detail-list"><KeyValue label="Action">{title}</KeyValue>{operation.kind === 'withdraw' && <KeyValue label="This transfer">{workspaceStore.hideBalances ? '••••••' : money(BigInt(prepared.publicOperation.publicInputs[7]), true)} USDC</KeyValue>}{prepared.publicOperation.method === 'withdrawPartial' && <KeyValue label="Private change from this payment">{workspaceStore.hideBalances ? '••••••' : money(prepared.recovery.amountAtomic, true)} USDC</KeyValue>}<KeyValue label="Funds backup"><Badge tone="success">Encrypted on this device</Badge></KeyValue></div>
            <Button variant="secondary" icon={Download} disabled={busy} onClick={() => void work(exportRecovery)}>Download funds backup</Button><p className="field-hint">This file is encrypted. Keep it and your password in separate safe places. You need them to recover your funds on another device.</p>
            <label className="field">Send through<select value={transport} disabled={busy || uncertain} onChange={event => setTransport(event.target.value as 'relay' | 'wallet')}><option value="wallet">My connected wallet</option>{config.relayerUrl && operation.kind !== 'shield' && <option value="relay">Payment sending service</option>}</select><small>{transport === 'wallet' ? 'Your sending wallet and the time you send are public.' : 'The service can see this request and when you send it. It cannot change who receives the payment.'}</small></label>
          </div>}
          {confirmed && <Notice tone={confirmed.localRecoverySaved ? 'success' : 'warning'} icon={Check}><strong>{operation.kind === 'shield' ? 'Funds added on the test network.' : operation.kind === 'claim' ? 'Payment collected on the test network.' : operation.kind === 'withdraw' ? 'Withdrawal confirmed on the test network.' : 'Payment sent on the test network.'}</strong><p>{!confirmed.localRecoverySaved ? 'The transaction succeeded, but this device could not update its funds backup. Keep the backup saved before sending and restore it before another withdrawal.' : confirmed.withdrawal ? 'Tokens arrived at the reviewed receiving address. Any remainder stays in your private balance; keep the updated funds backup.' : confirmed.localRecoverySaved ? 'Your encrypted funds backup has been updated with this payment.' : 'The payment succeeded, but the funds backup on this device could not be updated. Keep the file you saved before sending; it can still be used to recover your funds.'}</p><Button variant="ghost" icon={Download} onClick={() => void work(exportRecovery)}>Download funds backup</Button></Notice>}
          {publicReceipts.length > 0 && <section className="section-block" aria-label="Confirmed transaction receipts">
            <h3>Transaction receipts</h3>
            <p className="field-hint">Contains confirmed transaction references and public workflow details. It excludes payment names, private amounts, keys and approval signatures. Approval and compilation sources are recorded by this app, not independently attested.</p>
            <Button variant="secondary" icon={Download} onClick={() => download('sql-transaction-receipts.json', JSON.stringify({ schema: 'null.receipt-bundle.v1', receipts: publicReceipts }, null, 2))}>Download transaction receipts</Button>
          </section>}
          {receiptError && <Notice tone="warning">{receiptError}</Notice>}
          {uncertain && <Notice tone="warning">The result is still unknown. A slow response does not mean the payment failed. Keep your funds backup and check the status before trying again.<p><Button variant="secondary" busy={busy} onClick={() => void work(reconcile)}>Check transaction status</Button></p></Notice>}
          {reconciliation && <Notice tone="warning">{reconciliation}</Notice>}
          {busy && (stage === 'submitting' || stage === 'confirming') && <p className="field-hint">Closing this window will not cancel a request already sent. Keep your encrypted funds backup.</p>}
          {transactionHash && <p className="field-hint">{manifest.chainId === 11155111 ? <ExternalLink href={`https://sepolia.etherscan.io/tx/${transactionHash}`}>View submitted transaction</ExternalLink> : <code>{transactionHash}</code>}</p>}
        </>}
      </>}
    {stage && <p className="payment-stage-detail">{stage === 'complete' ? paymentCompletionDetail(!!confirmed, batchProgress) : stageCopy[stage]}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="secondary" disabled={busy && !manualIntent} onClick={close}>{confirmed ? 'Done' : 'Cancel'}</Button>{client && !prepared && !manualIntent && !busy && <Button disabled={treasuryOperation && !policy || operation.kind === 'create_distribution' && !selectedNotes.length || operation.kind === 'shield' && !acknowledged || operation.kind === 'withdraw' && (!withdrawalNote || !acknowledged || balanceWithdrawal && !!withdrawalPreview.error || !/^0x[0-9a-fA-F]{40}$/.test(recipient.trim()))} icon={ShieldCheck} onClick={() => void work(prepare)}>{operation.kind === 'claim' ? 'Prepare collection' : operation.kind === 'withdraw' ? 'Prepare withdrawal' : 'Prepare payment'}</Button>}{prepared && !confirmed && !busy && <Button disabled={!backupSaved || uncertain} icon={ShieldCheck} onClick={() => void work(submit)}>{operation.kind === 'shield' ? 'Confirm add funds' : operation.kind === 'claim' ? 'Confirm collection' : operation.kind === 'withdraw' ? 'Confirm withdrawal' : 'Confirm payment'}</Button>}</div>
  </Modal>;
}
