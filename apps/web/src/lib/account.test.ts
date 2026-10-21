import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProfile, profileStorageKey, resolveRoute, type AccountType } from './account-profile';

test('invalid or missing saved preferences require onboarding again', () => {
  for (const raw of [null, '', '{', 'null', 'true', '42', '[]', '{}', '{"type":"admin"}', '{"type":null}']) {
    assert.equal(parseProfile(raw), null, `Expected rejection for ${String(raw)}`);
  }
});

test('recognized profiles restore the selected experience', () => {
  assert.deepEqual(parseProfile('{"type":"individual"}'), { type: 'individual' });
  assert.deepEqual(parseProfile('{"type":"organization","organizationName":"Acme Studio"}'), {
    type: 'organization', organizationName: 'Acme Studio',
  });
});

test('organization preferences retain normalized ENS identity without importing permissions', () => {
  const profile = parseProfile(JSON.stringify({ type: 'organization', organizationName: 'Acme', ensName: ' ACME.ETH ', organizationAddress: '0x1111111111111111111111111111111111111111', verified: true, permissions: ['sign'] }));
  assert.deepEqual(profile, { type: 'organization', organizationName: 'Acme', ensName: 'acme.eth', organizationAddress: '0x1111111111111111111111111111111111111111' });
  assert.deepEqual(parseProfile(JSON.stringify({ ...profile, organizationName: 'Renamed' })), { ...profile, organizationName: 'Renamed' });
  assert.equal(parseProfile(JSON.stringify({ ...profile, organizationAddress: 'not-an-address' }))?.organizationAddress, undefined);
});

test('organization profiles need a usable name and normalize surrounding whitespace', () => {
  for (const organizationName of [undefined, null, 42, '', '   ', 'a'.repeat(51)]) {
    assert.equal(parseProfile(JSON.stringify({ type: 'organization', organizationName })), null);
  }
  assert.deepEqual(parseProfile('{"type":"organization","organizationName":"  Acme Studio  "}'), {
    type: 'organization', organizationName: 'Acme Studio',
  });
});

test('restored preferences never import claimed permissions or membership', () => {
  assert.deepEqual(parseProfile(JSON.stringify({ type: 'individual', isAdmin: true, memberId: 'someone-else', organizationName: 'Acme' })), {
    type: 'individual',
  });
  assert.deepEqual(parseProfile(JSON.stringify({ type: 'organization', organizationName: 'Acme', membershipVerified: true, permissions: ['sign'] })), {
    type: 'organization', organizationName: 'Acme',
  });
});

test('saved preferences are scoped to the authenticated account', () => {
  const first = profileStorageKey('did:privy:alice');
  const second = profileStorageKey('did:privy:bob');
  assert.equal(first, profileStorageKey('did:privy:alice'));
  assert.notEqual(first, second);
  assert.notEqual(profileStorageKey('did:privy:alice2'), first);
});

test('each experience opens its own home for empty or unknown routes', () => {
  for (const hash of ['', '#', '#/', '#/missing', '#/new/subpage']) {
    assert.equal(resolveRoute(hash, 'individual'), 'inbox', `Individual route ${hash}`);
    assert.equal(resolveRoute(hash, 'organization'), 'overview', `Organization route ${hash}`);
  }
});

test('each experience can navigate to its supported routes', () => {
  const routesByType = {
    individual: ['inbox', 'balance', 'settings', 'about', 'inspector', 'protocol'],
    organization: ['overview', 'treasury', 'distributions', 'new', 'settings', 'about', 'inspector', 'protocol'],
  } as const;
  for (const type of Object.keys(routesByType) as AccountType[]) {
    for (const route of routesByType[type]) assert.equal(resolveRoute(`#/${route}`, type), route);
  }
});

test('direct hashes cannot open pages from the other experience', () => {
  for (const route of ['overview', 'treasury', 'distributions', 'new']) {
    assert.equal(resolveRoute(`#/${route}`, 'individual'), 'inbox', `Individual route ${route}`);
  }
  for (const route of ['inbox', 'balance']) {
    assert.equal(resolveRoute(`#/${route}`, 'organization'), 'overview', `Organization route ${route}`);
  }
});
