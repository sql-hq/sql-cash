import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildPartialWithdrawalWitness, privateNoteBody, treasuryNoteBody, finalNoteCommitment, IncrementalMerkleTree, fieldHex } from './index';

const context = { chainId: 31337n, poolAddress: '0x1111111111111111111111111111111111111111' as const };
const recipient = '0x2222222222222222222222222222222222222222' as const;
function fixture() {
  const note = { ownerNullifierKey: 7n, noteSecret: 8n, amountAtomic: 1_000_000n };
  const tree = new IncrementalMerkleTree(20, [finalNoteCommitment(privateNoteBody(note.ownerNullifierKey, note.amountAtomic, note.noteSecret), 0)]);
  return { context, note: { ...note, path: tree.getPath(0) }, recipient, authRoot: fieldHex(9n), amountAtomic: 250_000n, changeOwnerNullifierKey: 10n, changeNoteSecret: 11n, nonce: 12n, validUntil: 9999999999n };
}
test('partial exit exposes only withdrawn amount and commits the exact private change', () => {
  const base = fixture(); const built = buildPartialWithdrawalWitness(base);
  assert.equal(built.publicInputs.length, 11);
  assert.equal(BigInt(built.publicInputs[7]!), 250_000n);
  assert.equal(built.changeAmountAtomic, 750_000n);
  assert.equal(built.publicInputs[8], privateNoteBody(10n, 750_000n, 11n));
  assert.ok(!built.publicInputs.includes(fieldHex(base.note.amountAtomic)));
  for (const amountAtomic of [0n, -1n, 1_000_000n, 1_000_001n, 1n << 64n]) assert.throws(() => buildPartialWithdrawalWitness({ ...base, amountAtomic }));
  for (const recipient of ['0x' + '00'.repeat(20), context.poolAddress]) assert.throws(() => buildPartialWithdrawalWitness({ ...base, recipient: recipient as `0x${string}` }));
});
test('real partial-withdrawal circuit rejects inflation, substitution and treasury-policy bypass', async () => {
  const require = createRequire(new URL('../../prover/package.json', import.meta.url));
  const { Noir } = require('@noir-lang/noir_js');
  const circuit = JSON.parse(await readFile(new URL('../../../circuits/target/withdraw_partial.json', import.meta.url), 'utf8'));
  const base = fixture(); const built = buildPartialWithdrawalWitness(base);
  (await new Noir(circuit).execute(built.witness)).witness.fill(0);
  for (const [key, value] of [['note_amount', '1000001'], ['owner_nullifier_key', '99'], ['change_note_secret', '99']] as const) {
    await assert.rejects(new Noir(circuit).execute({ ...built.witness, [key]: value }));
  }
  for (const [index, value] of [[7, fieldHex(1_000_001n)], [8, privateNoteBody(10n, 999_999n, 11n)], [6, fieldHex(0n)]] as const) {
    const inputs = [...built.publicInputs]; inputs[index] = value;
    await assert.rejects(new Noir(circuit).execute({ ...built.witness, inputs }));
  }
  const treasuryTree = new IncrementalMerkleTree(20, [finalNoteCommitment(treasuryNoteBody(7n, fieldHex(33n), 1_000_000n, 8n), 0)]);
  const inputs = [...built.publicInputs]; inputs[3] = treasuryTree.root;
  await assert.rejects(new Noir(circuit).execute({ ...built.witness, inputs, note_siblings: treasuryTree.getPath(0).siblings }));
});
