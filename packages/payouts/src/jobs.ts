import { parseAmount } from '@null-protocol/sdk';
import type { PublicClient } from 'viem';
import type { BroadcastTransport, ConfirmedOperation, PreparedOperation } from '@null-protocol/client';
import { preparePayout, resolvePayoutRecipients, type PayoutDraft, type PayoutRecipient, type PreparePayoutOptions, type ResolvedPayoutRecipient } from './index';
import { PayoutClient, type ApprovePayoutOptions } from './client';
import { confirmedNoPayment } from './internal';

/** One logical payout can contain many fixed-size onchain distributions. */
export function partitionPayoutRecipients<T extends PayoutRecipient>(recipients: readonly T[]): T[][] {
  if (!recipients.length) throw new Error('Add at least one ENS recipient.');
  const seen = new Set<string>(); const groups: T[][] = []; let group: T[] = []; let total = 0n;
  for (const recipient of recipients) {
    const ref = recipient.reference.normalize('NFKC').trim().toLowerCase();
    if (!ref || seen.has(ref)) throw new Error('Private references must be unique across the entire payout.');
    seen.add(ref);
    const amount = parseAmount(recipient.amount);
    if (group.length === 8 || total + amount > (1n << 64n) - 1n) { groups.push(group); group = []; total = 0n; }
    group.push(structuredClone(recipient)); total += amount;
  }
  if (group.length) groups.push(group);
  return groups;
}

export async function resolvePayoutJobRecipients(ens: PublicClient, recipients: readonly PayoutRecipient[]): Promise<ResolvedPayoutRecipient[]> {
  const resolved: ResolvedPayoutRecipient[] = [];
  // Bounded RPC concurrency: at most one eight-recipient group at a time.
  for (const group of partitionPayoutRecipients(recipients)) resolved.push(...await resolvePayoutRecipients(ens, group));
  return resolved;
}

export interface PayoutJobProgress {
  batch: number; batchCount: number;
  phase: 'prepared' | 'approved' | 'confirmed';
  transactionHash?: string;
}

/** In-memory sequential job. Each completed batch is retained if a later one fails. */
export class PayoutJob {
  readonly batchCount: number;
  private busy = false;
  private cursor = 0;
  private approved?: PreparedOperation;
  private needsReconciliation = false;
  private results: ConfirmedOperation[] = [];
  private constructor(private readonly drafts: readonly PayoutDraft[]) { this.batchCount = drafts.length; }
  static async prepare(options: Omit<PreparePayoutOptions, 'batchEntropy'>): Promise<PayoutJob> {
    const drafts: PayoutDraft[] = [];
    for (const recipients of partitionPayoutRecipients(options.recipients)) {
      // Independent fresh entropy for every group. Never reuse one batch's seed.
      drafts.push(await preparePayout({ ...options, recipients, batchEntropy: undefined }));
    }
    return new PayoutJob(drafts);
  }
  get completedBatches() { return this.cursor; }
  get confirmed() { return [...this.results]; }
  get requiresReconciliation() { return this.needsReconciliation; }
  get draftSummaries() { return this.drafts.map(draft => draft.summary); }
  toJSON(): never { throw new Error('Payout jobs contain private drafts. Persist encrypted recovery and public transaction receipts explicitly.'); }

  async send(options: {
    client: PayoutClient;
    transport: BroadcastTransport;
    /** Recover/select current treasury change after each confirmed batch. */
    approveBatch: (draft: PayoutDraft, batch: number) => Promise<ApprovePayoutOptions>;
    /** Save public receipt/checkpoint progress. Do not upload the private roster. */
    onProgress: (progress: PayoutJobProgress) => Promise<void>;
  }): Promise<readonly ConfirmedOperation[]> {
    if (this.busy) throw new Error('This payout job is already running.');
    if (this.needsReconciliation) throw new Error('Reconcile the pending batch before continuing this payout.');
    this.busy = true;
    try {
      while (this.cursor < this.drafts.length) {
        const draft = this.drafts[this.cursor]!;
        if (!this.approved) {
          await options.onProgress({ batch: this.cursor, batchCount: this.batchCount, phase: 'prepared' });
          this.approved = await options.client.approve(draft, await options.approveBatch(draft, this.cursor));
          await options.onProgress({ batch: this.cursor, batchCount: this.batchCount, phase: 'approved' });
        }
        // Fail closed even if a custom adapter throws without a usable hash.
        this.needsReconciliation = true;
        let result: ConfirmedOperation;
        try {
          result = await options.client.submit(this.approved, options.transport, {
            onTransactionSubmitted: event => { this.lastHash = event.hash; },
          });
        } catch (error) {
          if (confirmedNoPayment(error)) { this.approved = undefined; this.needsReconciliation = false; this.lastHash = undefined; }
          throw error;
        }
        this.results.push(result); this.cursor++; this.approved = undefined; this.needsReconciliation = false; this.lastHash = undefined;
        await options.onProgress({ batch: this.cursor - 1, batchCount: this.batchCount, phase: 'confirmed', transactionHash: result.transactionHash });
        if (!result.localRecoverySaved) throw new Error('Payment confirmed, but local recovery was not saved. Restore the confirmed change before continuing.');
      }
      return this.confirmed;
    } finally { this.busy = false; }
  }
  private lastHash?: `0x${string}`;
  async reconcile(client: PayoutClient) {
    if (this.busy || !this.needsReconciliation || !this.approved) throw new Error('There is no idle pending batch to reconcile.');
    this.busy = true;
    try {
      const state = await client.reconcile(this.approved, this.lastHash);
      if (state.status === 'confirmed') {
        this.results.push(state.result); this.cursor++; this.approved = undefined; this.needsReconciliation = false; this.lastHash = undefined;
      } else if (state.status === 'reverted') {
        this.approved = undefined; this.needsReconciliation = false; this.lastHash = undefined;
      }
      return state;
    } finally { this.busy = false; }
  }
}
