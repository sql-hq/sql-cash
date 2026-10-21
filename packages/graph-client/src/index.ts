import { createPublicClient, decodeEventLog, fallback, http, numberToHex, type Address, type Hex } from 'viem';
import { nullPoolAbi } from '@null-protocol/contracts';

export interface DiscoveryConfig {
  chainId: number;
  pool: Address;
  fromBlock: bigint;
  rpcUrls: readonly string[];
  graphUrl?: string;
  confirmations?: number;
  blockRange?: bigint;
}
export interface PublicEvent {
  id: string;
  chainId: number;
  emitter: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  confirmed: boolean;
}
export interface PublicEnvelope extends PublicEvent {
  protocol: 'NULL';
  version: 1;
  transportTag: Hex;
  slot: number;
  ephemeralPubKey: Hex;
  viewTag: Hex;
  ciphertext: Hex;
}
export interface PublicDistribution extends PublicEvent {
  commitment: Hex;
  envelopeRoot: Hex;
  transportTag: Hex;
  leafIndex: number;
  postDistributionRoot: Hex;
  version: number;
  expiry: '0';
}
export interface PublicConsumption extends PublicEvent {
  nullifier: Hex;
  outputCommitment: Hex;
  noteIndex: number;
  postNoteRoot: Hex;
  version: number;
}
export interface PublicNote extends PublicEvent {
  commitment: Hex;
  noteIndex: number;
  postNoteRoot: Hex;
  noteType: number;
}
export interface ScanCheckpoint { blockNumber: bigint; blockHash: Hex }
export interface DiscoveryPage {
  source: 'graph' | 'rpc';
  envelopes: PublicEnvelope[];
  distributions: PublicDistribution[];
  consumptions: PublicConsumption[];
  notes: PublicNote[];
  checkpoint: ScanCheckpoint;
  confirmedToBlock: bigint;
  /** Discard all cached events at or above this block before merging this page. */
  replaceFromBlock: bigint;
  reorgDetected: boolean;
  graphStatus: 'healthy' | 'not-configured' | 'unavailable' | 'lagging';
}

type GraphRow = Record<string, string | number>;
const field = (value: unknown): Hex => numberToHex(BigInt(String(value)), { size: 32 });
const assertHex = (value: unknown, bytes?: number): Hex => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (bytes !== undefined && value.length !== 2 + bytes * 2)) throw new Error('NULL_CONTEXT_MISMATCH');
  return value as Hex;
};
const query = `query PublicEvents($from: BigInt!, $to: BigInt!, $cursor: String!, $pool: Bytes!, $chain: BigInt!, $at: Int!) {
  privatePaymentEnvelopes(first: 500, orderBy: id, orderDirection: asc, block: {number: $at}, where: {blockNumber_gte: $from, blockNumber_lte: $to, emitter: $pool, chainId: $chain, id_gt: $cursor, protocol: "NULL"}) { id blockNumber blockHash transactionHash logIndex emitter chainId version transportTag slot ephemeralPubKey viewTag ciphertext }
  privateDistributions(first: 500, orderBy: id, orderDirection: asc, block: {number: $at}, where: {blockNumber_gte: $from, blockNumber_lte: $to, emitter: $pool, chainId: $chain, id_gt: $cursor}) { id blockNumber blockHash transactionHash logIndex emitter chainId version commitment envelopeRoot transportTag leafIndex postDistributionRoot }
  privateConsumptions(first: 500, orderBy: id, orderDirection: asc, block: {number: $at}, where: {blockNumber_gte: $from, blockNumber_lte: $to, emitter: $pool, chainId: $chain, id_gt: $cursor}) { id blockNumber blockHash transactionHash logIndex emitter chainId version nullifier outputCommitment noteIndex postNoteRoot }
  privateNotes(first: 500, orderBy: id, orderDirection: asc, block: {number: $at}, where: {blockNumber_gte: $from, blockNumber_lte: $to, emitter: $pool, chainId: $chain, id_gt: $cursor}) { id blockNumber blockHash transactionHash logIndex emitter chainId commitment noteIndex postNoteRoot noteType }
}`;

/** Only public context is accepted. Viewing keys and payroll filters have no API surface here. */
export function createDiscoveryClient(config: DiscoveryConfig) {
  if (!config.rpcUrls.length || !Number.isSafeInteger(config.chainId) || config.chainId <= 0 || config.fromBlock < 0n) throw new Error('NULL_RPC_UNAVAILABLE');
  assertHex(config.pool, 20);
  const confirmations = config.confirmations ?? 12;
  const blockRange = config.blockRange ?? 2_000n;
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || blockRange < 1n) throw new Error('NULL_CONTEXT_MISMATCH');
  const rpc = createPublicClient({ transport: fallback(config.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 1 }))) });
  const base = (row: GraphRow, confirmedToBlock: bigint): PublicEvent => {
    if (String(row.emitter).toLowerCase() !== config.pool.toLowerCase() || Number(row.chainId) !== config.chainId) throw new Error('NULL_CONTEXT_MISMATCH');
    return { id: String(row.id), chainId: config.chainId, emitter: config.pool, blockNumber: BigInt(row.blockNumber), blockHash: assertHex(row.blockHash, 32), transactionHash: assertHex(row.transactionHash, 32), logIndex: Number(row.logIndex), confirmed: BigInt(row.blockNumber) <= confirmedToBlock };
  };
  async function graphRequest(document: string, variables: object = {}): Promise<Record<string, unknown>> {
    const response = await fetch(config.graphUrl!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('NULL_GRAPH_UNAVAILABLE');
    const result = await response.json() as { data?: Record<string, unknown>; errors?: unknown[] };
    if (result.errors?.length || !result.data) throw new Error('NULL_GRAPH_UNAVAILABLE');
    return result.data;
  }
  return {
    async scan(options: { checkpoint?: ScanCheckpoint; toBlock?: bigint; forceRpc?: boolean } = {}): Promise<DiscoveryPage> {
      if (await rpc.getChainId() !== config.chainId) throw new Error('NULL_CONTEXT_MISMATCH');
      const latest = await rpc.getBlockNumber();
      const confirmedToBlock = latest >= BigInt(confirmations) ? latest - BigInt(confirmations) + 1n : 0n;
      // A confirmed default window lets a healthy indexer keep pace without hiding
      // an RPC fallback. Callers may explicitly request latest for a seen-only tail.
      const preferredEnd = options.toBlock ?? (confirmedToBlock >= config.fromBlock ? confirmedToBlock : latest);
      const toBlock = preferredEnd > latest ? latest : preferredEnd;
      let fromBlock = config.fromBlock;
      let reorgDetected = false;
      if (options.checkpoint) {
        try {
          const prior = await rpc.getBlock({ blockNumber: options.checkpoint.blockNumber });
          reorgDetected = prior.hash !== options.checkpoint.blockHash;
        } catch { reorgDetected = true; }
        // Rescan the unconfirmed tail each time. On a mismatch replay from deployment;
        // bounded rewinds cannot guarantee recovery from a deeper reorganization.
        if (!reorgDetected) fromBlock = options.checkpoint.blockNumber > BigInt(confirmations) ? options.checkpoint.blockNumber - BigInt(confirmations) : config.fromBlock;
        if (fromBlock < config.fromBlock) fromBlock = config.fromBlock;
      }
      if (toBlock < fromBlock) throw new Error('NULL_CONTEXT_MISMATCH');
      const head = await rpc.getBlock({ blockNumber: toBlock });
      if (!head.hash) throw new Error('NULL_RPC_UNAVAILABLE');
      const page: DiscoveryPage = { source: 'rpc', envelopes: [], distributions: [], consumptions: [], notes: [], checkpoint: { blockNumber: toBlock, blockHash: head.hash }, confirmedToBlock, replaceFromBlock: fromBlock, reorgDetected, graphStatus: config.graphUrl ? 'unavailable' : 'not-configured' };
      if (config.graphUrl && !options.forceRpc) {
        try {
          const metaResult = await graphRequest('{ _meta { block { number hash } hasIndexingErrors } }');
          const meta = metaResult._meta as { block: { number: number; hash: Hex }; hasIndexingErrors: boolean };
          if (!meta || meta.hasIndexingErrors) throw new Error('NULL_GRAPH_UNAVAILABLE');
          const indexed = BigInt(meta.block.number);
          if (indexed < toBlock) { page.graphStatus = 'lagging'; throw new Error('NULL_GRAPH_UNAVAILABLE'); }
          const indexedBlock = await rpc.getBlock({ blockNumber: indexed });
          if (indexedBlock.hash !== meta.block.hash) throw new Error('NULL_CONTEXT_MISMATCH');
          let cursor = '';
          for (let iteration = 0; ; iteration++) {
            if (iteration >= 10_000) throw new Error('NULL_GRAPH_UNAVAILABLE');
            const data = await graphRequest(query, { from: fromBlock.toString(), to: toBlock.toString(), cursor, pool: config.pool.toLowerCase(), chain: String(config.chainId), at: Number(toBlock) });
            const collections = ['privatePaymentEnvelopes', 'privateDistributions', 'privateConsumptions', 'privateNotes'] as const;
            const rows = collections.map(key => { if (!Array.isArray(data[key])) throw new Error('NULL_GRAPH_UNAVAILABLE'); return data[key] as GraphRow[]; });
            for (const r of rows[0]) page.envelopes.push({ ...base(r, confirmedToBlock), protocol: 'NULL', version: Number(r.version) as 1, transportTag: assertHex(r.transportTag, 32), slot: Number(r.slot), ephemeralPubKey: assertHex(r.ephemeralPubKey, 33), viewTag: assertHex(r.viewTag, 1), ciphertext: assertHex(r.ciphertext, 540) });
            for (const r of rows[1]) page.distributions.push({ ...base(r, confirmedToBlock), version: Number(r.version), commitment: field(r.commitment), envelopeRoot: assertHex(r.envelopeRoot, 32), transportTag: assertHex(r.transportTag, 32), leafIndex: Number(r.leafIndex), postDistributionRoot: field(r.postDistributionRoot), expiry: '0' });
            for (const r of rows[2]) page.consumptions.push({ ...base(r, confirmedToBlock), version: Number(r.version), nullifier: field(r.nullifier), outputCommitment: field(r.outputCommitment), noteIndex: Number(r.noteIndex), postNoteRoot: field(r.postNoteRoot) });
            for (const r of rows[3]) page.notes.push({ ...base(r, confirmedToBlock), commitment: field(r.commitment), noteIndex: Number(r.noteIndex), postNoteRoot: field(r.postNoteRoot), noteType: Number(r.noteType) });
            if (rows.every(collection => collection.length < 500)) break;
            // A shared cursor advances only to the smallest full-page tail. Dedup below
            // handles overlaps in sparse collections without skipping a dense one.
            const tails = rows.filter(collection => collection.length === 500).map(collection => String(collection.at(-1)!.id)).sort();
            const next = tails[0];
            if (!next || next <= cursor) throw new Error('NULL_GRAPH_UNAVAILABLE');
            cursor = next;
          }
          page.source = 'graph'; page.graphStatus = 'healthy';
        } catch {
          page.envelopes = []; page.distributions = []; page.consumptions = []; page.notes = [];
        }
      }
      if (page.source === 'rpc') {
        for (let start = fromBlock; start <= toBlock; start += blockRange) {
          const end = start + blockRange - 1n < toBlock ? start + blockRange - 1n : toBlock;
          const logs = await rpc.getLogs({ address: config.pool, events: nullPoolAbi.filter(item => item.type === 'event'), fromBlock: start, toBlock: end, strict: true });
          for (const log of logs) {
            if (log.removed || log.blockNumber === null || !log.blockHash || !log.transactionHash || log.logIndex === null) continue;
            let event: { eventName: string; args: Record<string, unknown> };
            try { event = decodeEventLog({ abi: nullPoolAbi, data: log.data, topics: log.topics }) as typeof event; } catch { continue; }
            const a = event.args;
            const common: PublicEvent = { id: `${log.transactionHash}-${log.logIndex}`, chainId: config.chainId, emitter: config.pool, blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex, confirmed: log.blockNumber <= confirmedToBlock };
            if (event.eventName === 'EnvelopePublished') page.envelopes.push({ ...common, protocol: 'NULL', version: Number(a.version) as 1, transportTag: assertHex(a.transportTag, 32), slot: Number(a.slot), ephemeralPubKey: assertHex(a.ephemeralPubKey, 33), viewTag: assertHex(a.viewTag, 1), ciphertext: assertHex(a.ciphertext, 540) });
            if (event.eventName === 'DistributionInserted') page.distributions.push({ ...common, version: Number(a.version), commitment: field(a.distributionCommitment), envelopeRoot: assertHex(a.envelopeRoot, 32), transportTag: assertHex(a.transportTag, 32), leafIndex: Number(a.distributionIndex), postDistributionRoot: field(a.postDistributionRoot), expiry: '0' });
            if (event.eventName === 'AllocationConsumed') page.consumptions.push({ ...common, version: Number(a.version), nullifier: field(a.claimNullifier), outputCommitment: field(a.noteCommitment), noteIndex: Number(a.noteIndex), postNoteRoot: field(a.postNoteRoot) });
            if (event.eventName === 'NoteInserted') page.notes.push({ ...common, commitment: field(a.noteCommitment), noteIndex: Number(a.noteIndex), postNoteRoot: field(a.postNoteRoot), noteType: Number(a.noteType) });
          }
        }
      }
      for (const list of [page.envelopes, page.distributions, page.consumptions, page.notes]) {
        const unique = [...new Map(list.map(event => [event.id, event])).values()];
        unique.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
        list.splice(0, list.length, ...unique as never[]);
      }
      const after = await rpc.getBlock({ blockNumber: toBlock });
      if (after.hash !== head.hash) throw new Error('NULL_ROOT_STALE');
      return page;
    },
  };
}
