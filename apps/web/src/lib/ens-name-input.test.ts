import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePaymentName } from '@null-protocol/ens';
import { editablePaymentName, paymentNameInput } from './ens-name-input';

test('a short assigned label becomes the same complete name used by inbox resolution', () => {
  assert.deepEqual(paymentNameInput('demo'), { showSuffix: true, completeName: 'demo.nullpay2026.eth' });
  assert.equal(normalizePaymentName(paymentNameInput(' Demo ').completeName), 'demo.nullpay2026.eth');
  assert.equal(editablePaymentName('demo.nullpay2026.eth'), 'demo');
  assert.equal(paymentNameInput(editablePaymentName('demo.NULLPAY2026.eth')).completeName, 'demo.nullpay2026.eth');
});

test('full external names and deeper subnames are never given an extra suffix', () => {
  for (const name of ['owned.eth', 'child.demo.nullpay2026.eth']) {
    assert.equal(editablePaymentName(name), name);
    assert.deepEqual(paymentNameInput(name), { showSuffix: false, completeName: name });
  }
});

test('an empty name or wallet address cannot become a valid payment name', () => {
  const address = '0xA888d19eD7AC6AbCb59DA2122085767613bC2FCB';
  assert.equal(paymentNameInput(' ').completeName, '');
  assert.deepEqual(paymentNameInput(address), { showSuffix: false, completeName: address });
  for (const value of ['', address]) assert.throws(() => normalizePaymentName(paymentNameInput(value).completeName));
});
