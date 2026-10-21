import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Plus, ShieldCheck, Wallet } from 'lucide-react';
import { parseAmount } from '@null-protocol/sdk';
import { useStore } from '../lib/store';
import { money } from '../lib/format';
import { Badge, Button, EmptyState, Modal, Notice, PageHeader, SectionTitle } from '../components/ui';
import { LiveOperationLoader, type LiveOperationInput } from '../components/LiveOperationLoader';

export function Treasury() {
  const store = useStore(); const [open, setOpen] = useState(false); const [value, setValue] = useState(''); const [acknowledged, setAcknowledged] = useState(false); const [error, setError] = useState('');
  const [liveOperation, setLiveOperation] = useState<LiveOperationInput | null>(null);
  const practice = store.mode === 'sandbox';
  const activities = store.activities.filter(item => ['shield', 'distribution'].includes(item.type));
  const openDeposit = () => { setOpen(true); setError(''); setAcknowledged(false); };
  const addFunds = () => {
    try {
      if (!acknowledged) throw new Error('Confirm that you understand the deposit notice.');
      const atomic = parseAmount(value);
      if (!practice) { setOpen(false); setLiveOperation({ kind: 'shield', amountAtomic: atomic }); return; }
      if (atomic > 1_000_000_000000n) throw new Error('Add no more than 1,000,000 sample USDC at a time.');
      store.shield(atomic); setOpen(false); store.toast('Sample funds added.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add funds.'); }
  };
  return <>
    <PageHeader title="Funds" action={<div className="button-row">{!practice && <Button variant="secondary" onClick={store.recoverLiveBalances}>Restore balance</Button>}<Button variant="secondary" icon={ArrowUpRight} onClick={() => setLiveOperation({kind:'withdraw',treasury:true})}>Withdraw</Button><Button icon={Plus} onClick={openDeposit}>Add funds</Button></div>} />
    <div className="treasury-layout">
      <section className="treasury-main-panel">
        <div className="balance-label"><span><ShieldCheck size={18} />Available balance</span><Badge tone="purple">{practice ? 'Practice mode' : 'Test network'}</Badge></div>
        <div className="balance-value">{!store.treasuryReady ? '—' : store.hideBalances ? '••••••' : money(store.treasury)}<span>USDC</span></div>
        <p className="muted">{practice ? 'Sample money for trying payments. It resets when you reload.' : store.treasuryReady ? 'Checked against confirmed payment history in this session.' : 'Restore your funds backup to see your balance.'}</p>
        <div className="treasury-rule" />
        <Button variant="secondary" onClick={() => store.editDistribution(null)}>New payment<ArrowRight size={15} /></Button>
      </section>
      <section className="boundary-panel">
        <span className="boundary-icon"><ArrowDownLeft size={24} /></span><h2>Deposits are public.</h2>
        <p>The wallet, amount and time are visible. An exact deposit just before paying can link the two.</p>
        <p className="deposit-limit">Test USDC only. Withdrawals require organization approval.</p>
      </section>
    </div>
    <section className="section-block">
      <SectionTitle title="Recent activity" />
      {activities.length ? <div className="table-panel"><table><thead><tr><th>Activity</th><th>Time</th><th>Status</th></tr></thead><tbody>{activities.map(item => <tr key={item.id}><td><strong>{item.title}</strong></td><td className="muted">{new Date(item.createdAt).toLocaleString()}</td><td><Badge tone="success">Saved in this session</Badge></td></tr>)}</tbody></table></div> : <div className="table-panel"><EmptyState icon={Wallet} title="No activity yet" description="Add funds to make your first payment." action={<Button variant="secondary" icon={Plus} onClick={openDeposit}>Add funds</Button>} /></div>}
    </section>
    <Modal title="Add funds" description={practice ? 'Try a deposit with sample money.' : 'Add test tokens to your balance.'} open={open} onClose={() => setOpen(false)}>
      <Notice tone="warning" icon={ArrowDownLeft}><strong>Deposits are public.</strong><p>On the test network, anyone can see the sending wallet, token, amount, and time. Withdrawals also reveal the receiving address and amount.</p></Notice>
      <label className="field">Amount in USDC<input value={value} onChange={event => setValue(event.target.value)} inputMode="decimal" placeholder="0.00" autoFocus /><small>{practice ? 'Sample funds only. No wallet or real money is needed.' : 'Use test USDC only. You will review the deposit before sending it.'}</small></label>
      <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand that deposits and withdrawals are public.</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!acknowledged} icon={Plus} onClick={addFunds}>{practice ? 'Add sample funds' : 'Continue'}</Button></div>
    </Modal>
    <LiveOperationLoader operation={liveOperation} onClose={() => setLiveOperation(null)} onConfirmed={result => {store.toast(result.withdrawal ? 'Withdrawal confirmed.' : 'Funds added on the test network.');}} />
  </>;
}
