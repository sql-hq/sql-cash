import { NullError } from '@null-protocol/sdk';
import { PaymentNameError } from '@null-protocol/ens';

export function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** These client errors establish that this attempt did not complete a payment. */
export function confirmedNoPayment(error: unknown): boolean {
  return error instanceof PaymentNameError || error instanceof NullError && [
    'NULL_WALLET_REJECTED', 'NULL_GAS_LIMIT', 'NULL_INTENT_EXPIRED',
    'NULL_TRANSACTION_REVERTED', 'NULL_RELAY_REJECTED', 'NULL_CONTEXT_MISMATCH',
  ].includes(error.code);
}
