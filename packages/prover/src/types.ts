import type { InputMap } from '@noir-lang/noir_js';

export type CircuitKind = 'shield' | 'create_distribution' | 'claim' | 'withdraw' | 'withdraw_partial';
export type Hex = `0x${string}`;
export interface ArtifactReference {
  url: string;
  sha256: Hex;
  verificationKeySha256: Hex;
  noirVersion: '1.0.0-beta.22';
  backendVersion: '5.0.0-nightly.20260522';
  verifierTarget: 'evm';
}
export interface ProofRequest {
  kind: CircuitKind;
  artifact: ArtifactReference;
  witness: InputMap;
  expectedPublicInputs: Hex[];
}
export interface ProofResult {
  kind: CircuitKind;
  proof: Hex;
  publicInputs: Hex[];
  artifactSha256: Hex;
}
export type ProofStage = 'loading' | 'witness' | 'proving' | 'complete';
export type WorkerRequest = { id: string; request: ProofRequest };
export type WorkerResponse = { id: string; stage: ProofStage } |
  { id: string; result: ProofResult } | { id: string; error: string };

