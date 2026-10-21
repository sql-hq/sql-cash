import type { Address, Hex } from 'viem';
import type { BroadcastTransport, ConfirmedOperation, NullLiveClient, OperationOptions, OwnedPrivateNote, PreparedOperation } from '@null-protocol/client';
import { confirmedNoPayment } from './internal';

export interface WithdrawalStep { note: OwnedPrivateNote; amountAtomic: bigint }

/** Private local plan. Chain verification still determines whether each note is spendable. */
export function planWithdrawal(notes: readonly OwnedPrivateNote[], amountAtomic: bigint): WithdrawalStep[] {
  if (amountAtomic <= 0n) throw new Error('Choose a positive withdrawal amount.');
  const seen = new Set<string>();
  const available = notes.map(note => {
    if ('policyCommitment' in note || note.amountAtomic <= 0n || seen.has(note.commitment.toLowerCase())) throw new Error('Use distinct, positive recipient notes.');
    seen.add(note.commitment.toLowerCase());
    return structuredClone(note);
  }).sort((a, b) => a.amountAtomic === b.amountAtomic ? 0 : a.amountAtomic > b.amountAtomic ? -1 : 1);
  if (available.reduce((sum, note) => sum + note.amountAtomic, 0n) < amountAtomic) throw new Error('The requested amount exceeds the available private balance.');
  const exact = available.find(note => note.amountAtomic === amountAtomic);
  if (exact) return [{ note: exact, amountAtomic }];
  let remaining = amountAtomic;
  const steps: WithdrawalStep[] = [];
  for (const note of available) {
    if (remaining === 0n) break;
    const amount = note.amountAtomic < remaining ? note.amountAtomic : remaining;
    steps.push({ note, amountAtomic: amount }); remaining -= amount;
  }
  return steps;
}

type WithdrawalClient = Pick<NullLiveClient, 'prepareWithdrawal' | 'submit' | 'reconcile'>;

/** In-memory job. Several source notes require several public transfers, never an atomic aggregate. */
export class WithdrawalJob {
  private readonly steps: WithdrawalStep[];
  private cursor = 0;
  private busy = false;
  private pending?: PreparedOperation;
  private hash?: Hex;
  private uncertain = false;
  private results: ConfirmedOperation[] = [];
  constructor(private readonly client: WithdrawalClient, notes: readonly OwnedPrivateNote[], readonly amountAtomic: bigint, private readonly recipient: Address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient) || BigInt(recipient) === 0n) throw new Error('Choose a valid public withdrawal address.');
    this.steps = planWithdrawal(notes, amountAtomic);
  }
  get transactionCount() { return this.steps.length; }
  get completedTransactions() { return this.cursor; }
  get requiresReconciliation() { return this.uncertain; }
  get confirmed() { return [...this.results]; }
  toJSON(): never { throw new Error('Withdrawal jobs contain private notes. Save encrypted recovery and public receipts explicitly.'); }

  async send(options: OperationOptions & {
    transport: BroadcastTransport;
    acknowledgePublicWithdrawal: true;
    /** Host obtains consent and durably saves/exports encrypted recovery before each send. */
    beforeSubmit: (operation: PreparedOperation, index: number) => Promise<void>;
    onConfirmed: (result: ConfirmedOperation, index: number) => Promise<void>;
  }) {
    if (this.busy || this.uncertain) throw new Error('This withdrawal is running or needs reconciliation before continuing.');
    if (options.acknowledgePublicWithdrawal !== true) throw new Error('Acknowledge that withdrawal amounts and destinations are public.');
    this.busy = true;
    try {
      while (this.cursor < this.steps.length) {
        const step = this.steps[this.cursor]!;
        if (!this.pending) this.pending = await this.client.prepareWithdrawal({ ...options, ...step, recipient: this.recipient });
        await options.beforeSubmit(this.pending, this.cursor);
        this.uncertain = true;
        let result: ConfirmedOperation;
        try {
          result = await this.client.submit(this.pending, options.transport, {
            ...options, onTransactionSubmitted: event => { this.hash = event.hash; options.onTransactionSubmitted?.(event); },
          });
        } catch (error) {
          if (confirmedNoPayment(error)) { this.pending = undefined; this.hash = undefined; this.uncertain = false; }
          throw error;
        }
        const index = this.cursor; this.record(result);
        await options.onConfirmed(result, index);
        if (!result.localRecoverySaved) throw new Error('Withdrawal confirmed, but local recovery was not saved. Recover the private remainder before continuing.');
      }
      return this.confirmed;
    } finally { this.busy = false; }
  }
  private record(result: ConfirmedOperation) {
    this.results.push(result); this.cursor++; this.pending = undefined; this.hash = undefined; this.uncertain = false;
  }
  async reconcile() {
    if (this.busy || !this.uncertain || !this.pending) throw new Error('There is no idle pending withdrawal to reconcile.');
    this.busy = true;
    try {
      const state = await this.client.reconcile(this.pending, this.hash);
      if (state.status === 'confirmed') this.record(state.result);
      else if (state.status === 'reverted') { this.pending = undefined; this.hash = undefined; this.uncertain = false; }
      return state;
    } finally { this.busy = false; }
  }
}
