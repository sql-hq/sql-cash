import { type Hex, NullError, concatBytes, fieldFromHex, fromHex, keccak_256, toHex, utf8 } from '@null-protocol/crypto';
import { type ChainContext, type MerklePath, IncrementalMerkleTree, validateContext } from '@null-protocol/protocol';

export interface PoolReaderOptions { context: ChainContext; rpcUrl: string; timeoutMs?: number; fetch?: typeof globalThis.fetch }

/** Read-only RPC adapter. Its API accepts public roots/nullifiers only, never recipient secrets. */
export class PoolReader {
  readonly context: ChainContext;
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;
  private nextRequestId = 0;

  constructor(options: PoolReaderOptions) {
    validateContext(options.context); this.context = options.context;
    let url: URL; try { url = new URL(options.rpcUrl); } catch { throw new NullError('NULL_RPC_UNAVAILABLE', 'Configure a valid RPC URL.'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new NullError('NULL_RPC_UNAVAILABLE', 'Use an HTTPS RPC URL.');
    if (url.username || url.password) throw new NullError('NULL_RPC_UNAVAILABLE', 'RPC URLs must not contain embedded credentials.');
    this.rpcUrl = url.toString(); this.timeoutMs = options.timeoutMs ?? 15_000; this.fetcher = options.fetch ?? globalThis.fetch;
  }
  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const requestId = ++this.nextRequestId;
    try {
      const response = await this.fetcher(this.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(this.timeoutMs), credentials: 'omit' });
      if (!response.ok) throw new Error('HTTP response rejected');
      const body = await response.text();
      if (body.length > 64_000) throw new Error('RPC response too large');
      const payload = JSON.parse(body) as { id?: unknown; error?: unknown; result?: unknown };
      if (payload.id !== requestId || payload.error || payload.result === undefined) throw new Error('Invalid RPC response');
      return payload.result;
    } catch { throw new NullError('NULL_RPC_UNAVAILABLE', 'The RPC request failed. Try another provider.'); }
  }
  async assertChain(): Promise<void> {
    const chain = await this.rpc('eth_chainId', []);
    if (typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain) || BigInt(chain) !== this.context.chainId) throw new NullError('NULL_CONTEXT_MISMATCH', 'The RPC provider is connected to a different chain.');
  }
  private async call(signature: string, arguments_: readonly Hex[] = []): Promise<Hex> {
    await this.assertChain();
    const calldata = toHex(concatBytes(keccak_256(utf8(signature)).slice(0, 4), ...arguments_.map(argument => fromHex(argument, 32))));
    const result = await this.rpc('eth_call', [{ to: this.context.poolAddress, data: calldata }, 'latest']);
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new NullError('NULL_CONTEXT_MISMATCH', 'The pool did not return a valid protocol value. Check its deployment address.');
    return result.toLowerCase() as Hex;
  }
  async getLatestNoteRoot(): Promise<Hex> { const root = await this.call('noteRoot()'); fieldFromHex(root); return root; }
  async getLatestDistributionRoot(): Promise<Hex> { const root = await this.call('distributionRoot()'); fieldFromHex(root); return root; }
  async isClaimNullifierSpent(nullifier: Hex): Promise<boolean> { fieldFromHex(nullifier); return this.booleanCall('spentClaimNullifier(uint256)', nullifier); }
  async isNoteNullifierSpent(nullifier: Hex): Promise<boolean> { fieldFromHex(nullifier); return this.booleanCall('spentNoteNullifier(uint256)', nullifier); }
  async isKnownNoteRoot(root: Hex): Promise<boolean> { fieldFromHex(root); return this.booleanCall('isKnownNoteRoot(uint256)', root); }
  async isKnownDistributionRoot(root: Hex): Promise<boolean> { fieldFromHex(root); return this.booleanCall('isKnownDistributionRoot(uint256)', root); }
  private async booleanCall(signature: string, argument: Hex): Promise<boolean> {
    const result = BigInt(await this.call(signature, [argument]));
    if (result !== 0n && result !== 1n) throw new NullError('NULL_CONTEXT_MISMATCH', 'The pool returned an invalid boolean.');
    return result === 1n;
  }
}
export const getLatestNoteRoot = (reader: PoolReader): Promise<Hex> => reader.getLatestNoteRoot();
export const getLatestDistributionRoot = (reader: PoolReader): Promise<Hex> => reader.getLatestDistributionRoot();
export const isClaimNullifierSpent = (reader: PoolReader, nullifier: Hex): Promise<boolean> => reader.isClaimNullifierSpent(nullifier);

/** `leaves` must be the complete, event-ordered public history up to an accepted root. */
export async function getDistributionPath(reader: PoolReader, leaves: readonly Hex[], index: number): Promise<MerklePath> {
  const path = new IncrementalMerkleTree(20, leaves).getPath(index);
  if (!await reader.isKnownDistributionRoot(path.root)) throw new NullError('NULL_ROOT_STALE', 'Refresh distribution history before creating the proof.');
  return path;
}
export async function getNotePath(reader: PoolReader, leaves: readonly Hex[], index: number): Promise<MerklePath> {
  const path = new IncrementalMerkleTree(20, leaves).getPath(index);
  if (!await reader.isKnownNoteRoot(path.root)) throw new NullError('NULL_ROOT_STALE', 'Refresh note history before creating the proof.');
  return path;
}
