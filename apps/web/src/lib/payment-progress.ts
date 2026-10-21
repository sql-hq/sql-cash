import type { OperationStage } from '@null-protocol/client';

export type PaymentProgressInput = {
  unlocked: boolean; prepared: boolean; backupSaved: boolean; confirmed: boolean;
  busy: boolean; approvalNeeded: boolean; uncertain: boolean; submitted: boolean; stage?: OperationStage; transport?: 'wallet' | 'relay';
};
export const paymentSteps = ['Unlock', 'Choose funds', 'Approve & protect', 'Save backup', 'Confirm', 'Receipt'];
export function paymentProgress(input: PaymentProgressInput) {
  if (input.confirmed) return { index: 5, title: 'Payment confirmed', body: 'The network confirmed this payment. Save the receipt and your updated recovery backup.' };
  if (input.uncertain) return { index: 4, title: 'Checking the payment’s status', body: 'The result is not known yet. Check this transaction before trying to send again.' };
  if (input.busy && (input.submitted && input.stage === 'submitting' || input.stage === 'confirming')) return { index: 4, title: 'Waiting for network confirmation', body: 'Your request has been sent. Keep this window open while we check its receipt.' };
  if (input.approvalNeeded) return { index: 2, title: 'Your organization’s approval', body: 'The approval is for this exact payment, network and recipient list. Review it in the Privy prompt.' };
  if (input.busy && input.stage === 'saving-recovery') return { index: input.prepared ? 3 : 2, title: 'Saving your recovery data', body: 'We are preparing an encrypted recovery copy. Keep the downloaded file safe.' };
  if (!input.unlocked) return { index: 0, title: input.busy ? 'Checking your saved funds' : 'Unlock your funds', body: input.busy ? 'We are checking the deployment and reconstructing your balance from confirmed history.' : 'Your password opens the encrypted recovery file on this device. It is not sent to the organization.' };
  if (input.prepared) {
    if (input.busy) return { index: 4, title: input.stage === 'simulating' ? 'Checking before sending' : input.stage === 'approval' ? 'Wallet permission needed' : input.transport === 'relay' ? 'Sending through the payment service' : 'Confirm in your wallet', body: input.stage === 'simulating' ? 'We simulate the exact transaction and recheck its destination before submission.' : input.transport === 'relay' && input.stage !== 'approval' ? 'The service submits this prepared transaction and pays the network fee. We will check the receipt before marking it confirmed.' : 'Review the Sepolia request in your wallet. Your approval submits the transaction.' };
    return input.backupSaved ? { index: 4, title: 'Ready for your confirmation', body: 'Your proof is ready and the backup export was requested. Confirm only after the encrypted file is saved.' }
      : { index: 3, title: 'Keep a recovery copy', body: 'Save your encrypted funds backup before sending. It can recover this payment if the connection is interrupted.' };
  }
  if (input.busy) return { index: 2, title: input.stage === 'proving' ? 'Creating your private proof' : input.stage === 'witness' || input.stage === 'loading' ? 'Preparing the private proof' : 'Checking this payment', body: input.stage === 'proving' ? 'Your device proves that these funds can be used without publishing the private allocation amounts. This can take a few minutes.' : input.stage === 'saving-recovery' ? 'We are saving encrypted recovery data locally before continuing.' : 'We are checking ENS names, available funds and the exact payment details. Nothing has been sent.' };
  return { index: 1, title: 'Choose the funds to use', body: 'Select a balance and the wallet that will pay the network fee. Any unspent remainder stays in your private funds.' };
}

export function paymentCompletionDetail(confirmed: boolean, completedBatches: number) {
  return confirmed ? 'Your transaction is confirmed. The updated recovery copy is ready to keep.'
    : completedBatches > 0 ? 'Completed transfers remain confirmed. Follow the current step for the remaining transfers.'
    : 'Preparation complete. Follow the current step before submitting.';
}
