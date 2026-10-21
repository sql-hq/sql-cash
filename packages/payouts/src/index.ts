import type { PublicClient } from 'viem';
import {
  compileDistribution, parseAmount, randomBytes, serializeEnvelope, toHex, validateContext,
  type ChainContext, type CompileDistributionOptions, type CompiledDistribution,
} from '@null-protocol/sdk';
import {
  ENS_CHAIN_ID, PaymentNameError, normalizePaymentName, resolvePaymentName,
  requiredPaymentNames, recheckRequiredPaymentNames, type PaymentNameSnapshot,
} from '@null-protocol/ens';
import type { CrePayrollExport } from './cre';
import { canonical } from './internal';

export { PaymentNameError } from '@null-protocol/ens';
export type { PaymentNameSnapshot } from '@null-protocol/ens';

export interface PayoutRecipient {
  /** Your private identifier. Never put it in public metadata or telemetry. */
  reference: string;
  /** Decimal USDC string, up to six decimal places. Never a JS float. */
  amount: string;
  name: string;
}
export interface ResolvedPayoutRecipient extends PayoutRecipient {
  paymentName: PaymentNameSnapshot;
}
export interface PreparePayoutOptions {
  ens: PublicClient;
  context: ChainContext;
  /** Resolve, display, and obtain user confirmation before calling preparePayout. */
  recipients: readonly ResolvedPayoutRecipient[];
  /** Optional worker adapter. Must run the actual compileDistribution implementation. */
  compiler?: (options: CompileDistributionOptions) => Promise<CompiledDistribution>;
  /** Fresh secret entropy; supplied only for a matching confidential compilation. */
  batchEntropy?: Uint8Array;
}

function validateRecipients(recipients: readonly PayoutRecipient[]): void {
  if (recipients.length < 1 || recipients.length > 8) throw new PaymentNameError('invalid', 'A payout needs one to eight ENS recipients.');
  const references = new Set<string>();
  for (const recipient of recipients) {
    const reference = recipient.reference.normalize('NFKC').trim();
    if (!reference || new TextEncoder().encode(reference).length > 200 || /[\u0000-\u001f\u007f]/u.test(reference) || references.has(reference.toLowerCase())) {
      throw new PaymentNameError('invalid', 'Each payout recipient needs a distinct private reference of at most 200 bytes.');
    }
    references.add(reference.toLowerCase());
    normalizePaymentName(recipient.name);
    parseAmount(recipient.amount);
  }
}

/** Public chain reads only. Resolution is not consent to pay or publish a record. */
export async function resolvePayoutRecipients(ens: PublicClient, recipients: readonly PayoutRecipient[]): Promise<ResolvedPayoutRecipient[]> {
  const input = structuredClone(recipients);
  validateRecipients(input);
  const resolved = await Promise.all(input.map(async recipient => ({
    ...recipient, name: normalizePaymentName(recipient.name), paymentName: await resolvePaymentName(ens, recipient.name),
  })));
  await recheckRequiredPaymentNames(ens, resolved.map(recipient => recipient.paymentName), resolved.length);
  return resolved;
}

type DraftData = { compiled: CompiledDistribution; paymentNames: PaymentNameSnapshot[]; creInput: CrePayrollExport };
const drafts = new WeakMap<PayoutDraft, DraftData>();

/** In-memory private draft. Getters return copies; JSON serialization is intentionally blocked. */
export class PayoutDraft {
  private constructor() {}
  static async prepare(options: PreparePayoutOptions): Promise<PayoutDraft> {
    const recipients = structuredClone(options.recipients);
    const context = { ...options.context };
    validateContext(context);
    if (context.chainId !== BigInt(ENS_CHAIN_ID)) throw new PaymentNameError('network', 'The payout SDK currently supports Ethereum Sepolia only.');
    validateRecipients(recipients);
    const paymentNames = requiredPaymentNames(recipients.map(recipient => ({
      destination: recipient.name, profile: recipient.paymentName?.profile ?? '', paymentName: recipient.paymentName,
    })));
    await recheckRequiredPaymentNames(options.ens, paymentNames, recipients.length);
    const entropy = options.batchEntropy ? new Uint8Array(options.batchEntropy) : randomBytes(32);
    try {
      const input: CompileDistributionOptions = {
        context, batchEntropy: entropy,
        recipients: recipients.map((recipient, index) => ({
          employeeRef: recipient.reference, amountAtomic: parseAmount(recipient.amount), stealthMetaAddress: paymentNames[index]!.profile,
        })),
      };
      const compiler = options.compiler ?? compileDistribution;
      // Independent copies isolate caller/worker mutation. Determinism is an integrity
      // check, not remote attestation or proof that a supplied compiler is trustworthy.
      const first = await compiler(structuredClone(input));
      const second = await compiler(structuredClone(input));
      if (canonical(first) !== canonical(second) || first.realCount !== recipients.length ||
          first.totalAmount !== input.recipients.reduce((sum, recipient) => sum + recipient.amountAtomic, 0n) ||
          first.publicBundle.chainId !== context.chainId.toString() || first.publicBundle.poolAddress.toLowerCase() !== context.poolAddress.toLowerCase() ||
          first.envelopes.length !== 8 || new Set(first.envelopes.map(envelope => serializeEnvelope(envelope).length)).size !== 1) {
        throw new Error('The payout compiler returned inconsistent results. Nothing was sent.');
      }
      await recheckRequiredPaymentNames(options.ens, paymentNames, recipients.length);
      const draft = new PayoutDraft();
      drafts.set(draft, structuredClone({ compiled: first, paymentNames, creInput: {
        batchId: crypto.randomUUID(), batchEntropyHex: toHex(entropy),
        recipients: input.recipients.map(recipient => ({ ...recipient, amountAtomic: recipient.amountAtomic.toString() })),
      } }));
      return Object.freeze(draft);
    } finally { entropy.fill(0); }
  }
  get summary() {
    const { compiled } = readDraft(this);
    return { recipientCount: compiled.realCount, totalAmountAtomic: compiled.totalAmount, commitment: compiled.commitment };
  }
  /** Private proof material. Never send this object to an API, logger, or analytics. */
  get compiled() { return readDraft(this).compiled; }
  get paymentNames() { return readDraft(this).paymentNames; }
  /** Explicit private export for the current CRE simulator; contains payroll and entropy. */
  get creInput() { return readDraft(this).creInput; }
  /** Only padded ciphertexts and public protocol fields; no recipient roster or amounts. */
  get publicBundle() { return readDraft(this).compiled.publicBundle; }
  toJSON(): never { throw new Error('Payout drafts contain private data. Export draft.publicBundle explicitly; keep recovery and CRE inputs private.'); }
}

/** @internal Not exported as a package subpath. Rejects forged or serialized drafts. */
export function readDraft(draft: PayoutDraft): DraftData {
  const value = drafts.get(draft);
  if (!value) throw new Error('Use an in-memory draft returned by preparePayout. Serialized or foreign drafts are not accepted.');
  return structuredClone(value);
}

/** Compiles a private draft; does not sign, prove, fund, or broadcast a transaction. */
export const preparePayout = PayoutDraft.prepare;
