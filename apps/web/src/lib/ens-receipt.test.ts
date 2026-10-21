import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex } from 'viem';
import { namehash } from 'viem/ens';
import { profileFromKeys } from '@null-protocol/sdk';
import { profileFingerprint, PAYMENT_RECORD } from '@null-protocol/ens';
import { matchesNameUpdate } from './ens-receipt';
import type { PendingNameUpdate } from './ens-pending';

const scalar = (n: number) => Uint8Array.from([...Array(31).fill(0), n]);
const profile = profileFromKeys({ spendPrivateKey: scalar(31), viewPrivateKey: scalar(32) }).stealthMetaAddress;
const account: Address = '0x1111111111111111111111111111111111111111';
const resolver: Address = '0x2222222222222222222222222222222222222222';
const router: Address = '0x3333333333333333333333333333333333333333';
const update: PendingNameUpdate = { version: 1, hash: `0x${'44'.repeat(32)}`, data: '0x12345678', name: 'demo.eth', resolver, account, kind: 'profile', fingerprint: profileFingerprint(profile) };
const events = parseAbi(['event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value)']);
const log = (name = update.name, key = PAYMENT_RECORD, value = profile, address = resolver) => ({ address, topics: encodeEventTopics({ abi: events, eventName: 'TextChanged', args: { node: namehash(name), indexedKey: key } }) as Hex[], data: encodeAbiParameters([{ type: 'string' }, { type: 'string' }], [key, value]) });
const wrapped = { from: account, to: router, input: '0xabcdef01' as Hex };

test('direct updates and wrapped wallet calls confirm the same intended name write', () => {
  assert.equal(matchesNameUpdate(update, { from: account, to: resolver, input: update.data }, { status: 'success', logs: [] }), true);
  assert.equal(matchesNameUpdate(update, wrapped, { status: 'success', logs: [log()] }), true);
});

test('wrapped confirmation rejects wrong sender, resolver, name, record, profile and failed receipts', () => {
  for (const bad of [log('other.eth'), log(update.name, 'url'), log(update.name, PAYMENT_RECORD, 'invalid'), log(update.name, PAYMENT_RECORD, profile, router)]) {
    assert.equal(matchesNameUpdate(update, wrapped, { status: 'success', logs: [bad] }), false);
  }
  assert.equal(matchesNameUpdate(update, { ...wrapped, from: router }, { status: 'success', logs: [log()] }), false);
  assert.equal(matchesNameUpdate(update, wrapped, { status: 'reverted', logs: [log()] }), false);
  assert.equal(matchesNameUpdate(update, wrapped, { status: 'success', logs: [] }), false);
  assert.equal(matchesNameUpdate({ ...update, fingerprint: `0x${'55'.repeat(32)}` }, wrapped, { status: 'success', logs: [log()] }), false);
  assert.equal(matchesNameUpdate({ ...update, kind: 'grant', editor: router }, wrapped, { status: 'success', logs: [log()] }), false);
});
