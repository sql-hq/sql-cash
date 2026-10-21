import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zeroAddress } from 'viem';
import { PaymentNameError } from '@null-protocol/ens';
import { findAssignedNames, findNameWallet, type NameWallet } from './ens-wallet';

const organization: NameWallet = { address: '0x6567226D425c423b1A5765384Ae343aE5FDeB1d1', label: 'Privy' };
const recipient: NameWallet = { address: '0x7fD5B5B80E9F7a811b1d27Ec20879185fB987433', label: 'Privy' };

test('chooses the permitted owner instead of the first Privy wallet', async () => {
  const checked: string[] = [];
  const found = await findNameWallet([organization, recipient], recipient.address, async address => { checked.push(address); return address === recipient.address; });
  assert.equal(found, recipient);
  assert.deepEqual(checked, [recipient.address]);
});
test('ownership alone is insufficient; an authorized editor can be selected', async () => {
  assert.equal(await findNameWallet([recipient, organization], recipient.address, async address => address === organization.address), organization);
});
test('never falls back to an unauthorized wallet or treats failed reads as denial', async () => {
  assert.equal(await findNameWallet([organization], recipient.address, async () => false), undefined);
  await assert.rejects(findNameWallet([recipient], recipient.address, async () => { throw new Error('RPC unavailable'); }), /could not be checked/);
  assert.equal(await findNameWallet([organization, recipient], recipient.address, async address => { if (address === recipient.address) throw new Error('Transient read error'); return true; }), organization);
});

test('assigned-name hints require current ownership and permission, including transferred names', async () => {
  const inspected: string[] = [], permissions: string[] = [];
  const names = ['inbox.nullpay2026.eth', 'inbox.nullpay2026.eth', 'transferred.nullpay2026.eth', 'unassigned.nullpay2026.eth', 'denied.nullpay2026.eth'];
  const found = await findAssignedNames(names, [recipient], async name => {
    inspected.push(name);
    return { name, owner: name.startsWith('unassigned') ? zeroAddress : name.startsWith('transferred') ? organization.address : recipient.address };
  }, async name => { permissions.push(name); return !name.startsWith('denied'); });
  assert.deepEqual(found, ['inbox.nullpay2026.eth']);
  assert.equal(inspected.length, 4, 'duplicate hints are checked once');
  assert.deepEqual(permissions, ['inbox.nullpay2026.eth', 'denied.nullpay2026.eth']);
});

test('assigned-name discovery skips expired hints but never reports network failures as no assignment', async () => {
  const names = await findAssignedNames(['expired.eth', 'inbox.eth'], [recipient], async name => {
    if (name === 'expired.eth') throw new PaymentNameError('missing', 'Expired name');
    return { name, owner: recipient.address };
  }, async () => true);
  assert.deepEqual(names, ['inbox.eth']);
  await assert.rejects(findAssignedNames(['inbox.eth'], [recipient], async () => { throw new PaymentNameError('network', 'RPC unavailable'); }, async () => true), /RPC unavailable/);
  await assert.rejects(findAssignedNames(['inbox.eth'], [recipient], async name => ({ name, owner: recipient.address }), async () => { throw new Error('RPC unavailable'); }), /could not be checked/);
  assert.deepEqual(await findAssignedNames(['inbox.eth'], [], async () => { throw new Error('No wallet should cause no read'); }, async () => true), []);
});
