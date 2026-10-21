import type { PublicClient } from 'viem';
import type {
  NullLiveClient, DistributionOptions, PreparedOperation, BroadcastTransport, OperationOptions,
} from '@null-protocol/client';
import { recheckRequiredPaymentNames, type PaymentNameSnapshot } from '@null-protocol/ens';
import { type PayoutDraft, readDraft } from './index';
import { verifyCreResult } from './cre';

export { NullLiveClient, SubmissionUncertainError, createEncryptedCheckpointStore } from '@null-protocol/client';
export type { LiveClientOptions, DistributionOptions, BroadcastTransport, OperationOptions, ConfirmedOperation, ReconciliationResult } from '@null-protocol/client';
export type * from '@null-protocol/client';

export interface ApprovePayoutOptions extends Omit<DistributionOptions, 'compiled'> {
  /** Required explicit choice. Local CRE verifies equality, not execution provenance. */
  compilation: { mode: 'local' } | { mode: 'cre-local-simulation'; result: string };
}
type ClientPort = Pick<NullLiveClient, 'context' | 'prepareDistribution' | 'submit' | 'reconcile'>;

/** Binds mandatory ENS checks to the host's existing proving, custody, and broadcast client. */
export class PayoutClient {
  private readonly prepared = new WeakMap<PreparedOperation, { names: PaymentNameSnapshot[]; count: number }>();
  constructor(private readonly live: ClientPort, private readonly ens: PublicClient) {}

  async approve(draft: PayoutDraft, options: ApprovePayoutOptions): Promise<PreparedOperation> {
    const { compiled, paymentNames, creInput } = readDraft(draft);
    if (compiled.publicBundle.chainId !== this.live.context.chainId.toString() || compiled.publicBundle.poolAddress.toLowerCase() !== this.live.context.poolAddress.toLowerCase()) {
      throw new Error('The payout draft belongs to another chain or pool.');
    }
    if (options.compilation?.mode === 'cre-local-simulation') verifyCreResult(options.compilation.result, creInput.batchId, compiled.publicBundle);
    else if (options.compilation?.mode !== 'local') throw new Error('Choose local compilation or provide the matching CRE simulation result.');
    const recheck = () => recheckRequiredPaymentNames(this.ens, paymentNames, compiled.realCount);
    await recheck();
    const { compilation: _compilation, authorize, ...operationOptions } = options;
    const operation = await this.live.prepareDistribution({ ...operationOptions, compiled,
      authorize: async intent => {
        await recheck();
        const signature = await authorize(intent);
        // Owner approval may remain open while an ENS editor rotates the destination.
        await recheck();
        return signature;
      },
    });
    await recheck();
    this.prepared.set(operation, { names: paymentNames, count: compiled.realCount });
    return operation;
  }

  async submit(operation: PreparedOperation, transport: BroadcastTransport, options: OperationOptions = {}) {
    const record = this.record(operation);
    await recheckRequiredPaymentNames(this.ens, record.names, record.count);
    return this.live.submit(operation, transport, options);
  }

  /** Read-only reconciliation remains available if a name expires after broadcast. */
  reconcile(operation: PreparedOperation, transactionHash?: Parameters<NullLiveClient['reconcile']>[1], options: OperationOptions = {}) {
    this.record(operation);
    return this.live.reconcile(operation, transactionHash, options);
  }

  private record(operation: PreparedOperation) {
    const record = this.prepared.get(operation);
    if (!record) throw new Error('This operation was not approved by this PayoutClient instance.');
    return record;
  }
}

// Brand alias: SQL (Silent Query Layer) name for the live protocol client.
export { NullLiveClient as SqlLiveClient } from '@null-protocol/client';
