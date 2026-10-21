import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DOMAIN_LABELS, domainField } from './index.js';

test('SDK hash domains match every generated circuit and Solidity constant', () => {
  const root = new URL('../../../', import.meta.url);
  const domains = JSON.parse(readFileSync(new URL('circuits/domains.json', root), 'utf8')) as Record<string, string>;
  const noir = readFileSync(new URL('circuits/lib/src/domains.nr', root), 'utf8');
  const solidity = readFileSync(new URL('contracts/src/libraries/Domains.sol', root), 'utf8');
  const expected = Object.fromEntries(DOMAIN_LABELS.map(label => [
    label.replace('null.v1.', '').replaceAll('-', '_').toUpperCase(), domainField(label).toString(),
  ]));
  assert.deepEqual(domains, expected);
  for (const [name, value] of Object.entries(expected)) {
    assert.ok(noir.includes(`pub global ${name}: Field = ${value};`), `Noir domain ${name}`);
    assert.ok(solidity.includes(`uint256 internal constant ${name} = ${value};`), `Solidity domain ${name}`);
  }
});
