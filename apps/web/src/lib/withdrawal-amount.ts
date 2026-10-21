import { parseAmount } from '@null-protocol/sdk';
import { planWithdrawal, type WithdrawalStep } from '@null-protocol/payouts/withdrawals';
import type { OwnedPrivateNote } from '@null-protocol/client';

export function withdrawalAmountState(notes: readonly OwnedPrivateNote[], input: string): {
  balance: bigint; amount: bigint; remainder: bigint; steps: WithdrawalStep[]; error?: string;
} {
  const balance = notes.reduce((sum, note) => sum + note.amountAtomic, 0n);
  const invalid = (error: string) => ({ balance, amount: 0n, remainder: balance, steps: [], error });
  if (!input.trim()) return invalid('Enter the amount you want to withdraw.');
  if (!/^\d+(\.\d{1,6})?$/.test(input.trim())) return invalid('Enter a USDC amount with up to 6 decimal places.');
  let amount: bigint;
  try { amount = parseAmount(input.trim()); } catch { return invalid('Enter a valid USDC amount.'); }
  if (amount <= 0n) return invalid('Enter an amount greater than zero.');
  if (amount > balance) return invalid('This amount exceeds your available private balance. Enter a smaller amount.');
  try { return { balance, amount, remainder: balance - amount, steps: planWithdrawal(notes, amount) }; }
  catch { return invalid('Restore your balance before withdrawing.'); }
}

/** Replace the consumed note, never subtract from a new change commitment. Safe to replay. */
export function replaceWithdrawnNote<T extends { commitment: string }>(notes: readonly T[], spent: string, change?: T): T[] {
  const spentId = spent.toLowerCase();
  const changeId = change?.commitment.toLowerCase();
  const remaining = notes.filter(note => note.commitment.toLowerCase() !== spentId && note.commitment.toLowerCase() !== changeId);
  return change ? [...remaining, change] : remaining;
}
