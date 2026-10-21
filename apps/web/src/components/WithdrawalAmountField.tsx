import { formatAmount } from '@null-protocol/sdk';
import type { withdrawalAmountState } from '../lib/withdrawal-amount';
import { money } from '../lib/format';
import { Button, KeyValue, Notice } from './ui';

export function WithdrawalAmountField({ value, onChange, state, disabled, hidden = false }: {
  value: string; onChange: (value: string) => void; state: ReturnType<typeof withdrawalAmountState>; disabled: boolean; hidden?: boolean;
}) {
  return <>
    <KeyValue label="Available private balance">{hidden ? '••••••' : money(state.balance, true)} USDC</KeyValue>
    <label className="field">Amount to withdraw (USDC)<input value={value} disabled={disabled} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-describedby="withdrawal-amount-hint" aria-invalid={!!value && !!state.error} onChange={event => onChange(event.target.value)} /><small id="withdrawal-amount-hint">Choose any amount up to your available balance, with up to 6 decimal places. The rest stays in SQL.</small></label>
    <Button variant="ghost" disabled={state.balance === 0n || disabled} onClick={() => onChange(formatAmount(state.balance))}>Use full balance</Button>
    {value && state.error && <p className="form-error" role="status">{state.error}</p>}
    {!state.error && <div className="detail-list" aria-live="polite"><KeyValue label="You receive">{hidden ? '••••••' : money(state.amount, true)} USDC</KeyValue><KeyValue label="Stays in your private balance">{hidden ? '••••••' : money(state.remainder, true)} USDC</KeyValue></div>}
    {state.steps.length > 1 && <Notice>This amount needs {state.steps.length} transfers. You will confirm each one. If you stop, completed transfers stay confirmed and the rest stays in SQL.</Notice>}
  </>;
}
