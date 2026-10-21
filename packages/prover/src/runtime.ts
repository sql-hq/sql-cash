import { Noir, type CompiledCircuit } from '@noir-lang/noir_js';
import { Barretenberg, BackendType, UltraHonkBackend } from '@aztec/bb.js';
import type { Hex, ProofRequest, ProofResult, ProofStage } from './types';

const COUNTS = { shield: 6, create_distribution: 15, claim: 8, withdraw: 10, withdraw_partial: 11 } as const;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const evm = { verifierTarget: 'evm' as const }; // ZK-enabled Keccak UltraHonk. Never evm-no-zk.
function hex(bytes: Uint8Array): Hex { return `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`; }
async function digest(bytes: Uint8Array): Promise<Hex> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)));
}
function canonical(value: string): Hex {
  const integer = BigInt(value);
  if (integer < 0n || integer >= FIELD) throw new Error('NULL_CONTEXT_MISMATCH');
  return `0x${integer.toString(16).padStart(64, '0')}`;
}

/** Local-only proving. Call through the worker client so UI remains responsive.
 * Artifact hashes must come from the reviewed deployment manifest. This function
 * downloads only public artifacts/SRS; it never uploads a witness or secret. */
export async function proveLocally(request: ProofRequest, progress: (stage: ProofStage) => void = () => {}): Promise<ProofResult> {
  const { artifact } = request;
  if (artifact.noirVersion !== '1.0.0-beta.22' || artifact.backendVersion !== '5.0.0-nightly.20260522' ||
      artifact.verifierTarget !== 'evm' || !/^0x[0-9a-fA-F]{64}$/.test(artifact.sha256) ||
      !/^0x[0-9a-fA-F]{64}$/.test(artifact.verificationKeySha256)) throw new Error('NULL_ARTIFACT_UNAVAILABLE');
  if (request.expectedPublicInputs.length !== COUNTS[request.kind]) throw new Error('NULL_CONTEXT_MISMATCH');
  const expected = request.expectedPublicInputs.map(canonical);
  if (expected[0] !== canonical('1')) throw new Error('NULL_CONTEXT_MISMATCH');
  progress('loading');
  const response = await fetch(artifact.url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('NULL_ARTIFACT_UNAVAILABLE');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 64 * 1024 * 1024 || await digest(bytes) !== artifact.sha256.toLowerCase())
    throw new Error('NULL_ARTIFACT_MISMATCH');
  const circuit = JSON.parse(new TextDecoder().decode(bytes)) as CompiledCircuit;
  if (!circuit.bytecode || !circuit.abi) throw new Error('NULL_ARTIFACT_MISMATCH');
  let api: Barretenberg | undefined;
  let witnessBytes: Uint8Array | undefined;
  try {
    progress('witness');
    const noir = new Noir(circuit);
    const execution = await noir.execute(request.witness);
    witnessBytes = execution.witness;
    progress('proving');
    api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1, logger: () => {} });
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const key = await backend.getVerificationKey(evm);
    if (await digest(key) !== artifact.verificationKeySha256.toLowerCase()) throw new Error('NULL_ARTIFACT_MISMATCH');
    const generated = await backend.generateProof(witnessBytes, evm);
    const publicInputs = generated.publicInputs.map(canonical);
    if (publicInputs.length !== expected.length || publicInputs.some((input, index) => input !== expected[index]))
      throw new Error('NULL_CONTEXT_MISMATCH');
    progress('complete');
    return { kind: request.kind, proof: hex(generated.proof), publicInputs, artifactSha256: artifact.sha256 };
  } finally {
    witnessBytes?.fill(0);
    await api?.destroy();
    // JS copies/garbage collection do not permit guaranteed memory zeroization.
  }
}

