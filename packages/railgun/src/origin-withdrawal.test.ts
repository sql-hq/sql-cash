import test from 'node:test';
import assert from 'node:assert/strict';
import { USDC } from './network';
import { assertOriginQuoteUnchanged, originQuoteFromRecipients, validateShieldTransactionHash } from './origin-withdrawal';
const hash = `0x${'a'.repeat(64)}`, to = `0x${'1'.repeat(40)}`;
const recipient = { tokenAddress: USDC.address, recipientAddress: to, amount: 9_975n };
test('a return quote uses only the original USDC owner and unspent amount', () => {
  assert.deepEqual(originQuoteFromRecipients(hash, [recipient], []), { shieldTxid: hash, to, amount: 9_975n });
});
test('malformed deposit hashes are rejected before an SDK lookup', () => {
  for (const value of ['', '0x1234', 'a'.repeat(64), `0x${'g'.repeat(64)}`]) assert.throws(() => validateShieldTransactionHash(value));
});
test('mixed assets, NFTs, and multiple return destinations cannot be silently included', () => {
  assert.throws(() => originQuoteFromRecipients(hash, [], []));
  assert.throws(() => originQuoteFromRecipients(hash, [recipient, recipient], []));
  assert.throws(() => originQuoteFromRecipients(hash, [recipient], [{}]));
  assert.throws(() => originQuoteFromRecipients(hash, [{ ...recipient, tokenAddress: to }], []));
});
test('zero amounts, overflows and invalid original owners cannot be returned', () => {
  for (const amount of [0n, -1n, 2n ** 256n]) assert.throws(() => originQuoteFromRecipients(hash, [{ ...recipient, amount }], []));
  for (const recipientAddress of ['0x0', `0x${'0'.repeat(40)}`]) assert.throws(() => originQuoteFromRecipients(hash, [{ ...recipient, recipientAddress }], []));
});
test('a stale review cannot authorize another amount, recipient or deposit', () => {
  const quote = originQuoteFromRecipients(hash, [recipient], []);
  assert.doesNotThrow(() => assertOriginQuoteUnchanged(quote, { ...quote }));
  for (const current of [{ ...quote, amount: 1n }, { ...quote, to: `0x${'2'.repeat(40)}` as `0x${string}` }, { ...quote, shieldTxid: `0x${'b'.repeat(64)}` as `0x${string}` }]) {
    assert.throws(() => assertOriginQuoteUnchanged(quote, current));
  }
});
