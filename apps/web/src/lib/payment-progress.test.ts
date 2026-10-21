import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentCompletionDetail, paymentProgress, type PaymentProgressInput } from './payment-progress';
const state: PaymentProgressInput = { unlocked: false, prepared: false, backupSaved: false, confirmed: false, busy: false, approvalNeeded: false, uncertain: false, submitted: false };
test('payment stages follow real prerequisites', () => {
  assert.equal(paymentProgress(state).index, 0);
  assert.equal(paymentProgress({ ...state, unlocked: true }).index, 1);
  assert.equal(paymentProgress({ ...state, unlocked: true, busy: true, stage: 'proving' }).index, 2);
  assert.equal(paymentProgress({ ...state, unlocked: true, prepared: true }).index, 3);
  assert.equal(paymentProgress({ ...state, unlocked: true, prepared: true, backupSaved: true }).index, 4);
  assert.equal(paymentProgress({ ...state, confirmed: true }).index, 5);
});
test('an unknown submission is never labeled ready or successful', () => {
  const result = paymentProgress({ ...state, uncertain: true, prepared: true, backupSaved: true });
  assert.equal(result.index, 4); assert.match(result.body, /not known/); assert.doesNotMatch(result.title, /confirmed|Ready/);
});
test('a previous batch receipt cannot override the new backup or approval stage', () => {
  assert.equal(paymentProgress({ ...state, unlocked: true, submitted: true, prepared: true }).index, 3);
  assert.equal(paymentProgress({ ...state, unlocked: true, submitted: true, prepared: true, approvalNeeded: true }).index, 2);
  assert.equal(paymentProgress({ ...state, unlocked: true, submitted: true, prepared: true, busy: true, stage: 'saving-recovery' }).index, 3);
});
test('wallet confirmation and confirmed receipt remain separate', () => {
  assert.match(paymentProgress({ ...state, unlocked: true, prepared: true, busy: true, stage: 'submitting' }).title, /wallet/);
  assert.match(paymentProgress({ ...state, unlocked: true, prepared: true, busy: true, submitted: true, stage: 'confirming' }).title, /Waiting/);
  assert.equal(paymentProgress({ ...state, confirmed: true, busy: true, stage: 'saving-recovery' }).index, 5);
});
test('relay submission names the service and never requests a sending wallet approval', () => {
  const result = paymentProgress({ ...state, unlocked: true, prepared: true, busy: true, stage: 'submitting', transport: 'relay' });
  assert.match(result.title, /payment service/);
  assert.match(result.body, /pays the network fee/);
  assert.doesNotMatch(result.body, /wallet|Your approval/);
});
test('backup export and batch continuation cannot contradict confirmed receipts', () => {
  assert.match(paymentCompletionDetail(true, 0), /transaction is confirmed/);
  assert.match(paymentCompletionDetail(false, 1), /transfers remain confirmed/);
  assert.doesNotMatch(paymentCompletionDetail(true, 1), /Nothing has been sent/);
  assert.match(paymentCompletionDetail(false, 0), /before submitting/);
});
