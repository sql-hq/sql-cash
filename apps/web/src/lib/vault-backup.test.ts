import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptVaultBackup, encryptVaultBackup, parseVaultBackup } from './vault-backup';
const address = `0zk1${'q'.repeat(100)}`;
const fixture = 'public test fixture, not a user recovery phrase';
test('encrypted backup round-trips locally, with randomized encryption and no plaintext phrase', async () => {
  const a = await encryptVaultBackup(fixture, 'test backup password', address);
  const b = await encryptVaultBackup(fixture, 'test backup password', address);
  assert.ok(!JSON.stringify(a).includes(fixture)); assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(await decryptVaultBackup(parseVaultBackup(JSON.stringify(a)), 'test backup password'), fixture);
  await assert.rejects(decryptVaultBackup(a, 'incorrect password'), /incorrect|changed/);
});
test('tampering with the encrypted phrase or authenticated address is rejected', async () => {
  const file = await encryptVaultBackup(fixture, 'test backup password', address);
  await assert.rejects(decryptVaultBackup({ ...file, address: `0zk1${'p'.repeat(100)}` }, 'test backup password'), /incorrect|changed/);
  await assert.rejects(decryptVaultBackup({ ...file, ciphertext: `${file.ciphertext[0] === 'A' ? 'B' : 'A'}${file.ciphertext.slice(1)}` }, 'test backup password'), /incorrect|changed/);
});
test('backup input limits reject huge files, costly KDF values, wrong network and weak passwords', async () => {
  assert.throws(() => parseVaultBackup('x'.repeat(32_769)), /large/);
  assert.throws(() => parseVaultBackup('{}'), /invalid/);
  const file = await encryptVaultBackup(fixture, 'test backup password', address);
  assert.throws(() => parseVaultBackup(JSON.stringify({ ...file, iterations: 100_000_000 })), /unsupported/);
  assert.throws(() => parseVaultBackup(JSON.stringify({ ...file, network: 11155111 })), /unsupported/);
  await assert.rejects(encryptVaultBackup(fixture, 'short', address), /at least 10/);
});
