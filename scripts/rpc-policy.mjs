// The gateway is a read-only Ethereum transport, not a signer or generic proxy.
export const RPC_PATH = 'rpc/mainnet';
export const MAX_BODY = 256 * 1024;
export const MAX_RESPONSE = 8 * 1024 * 1024;
export const MAX_BATCH = 100;
export const MAX_LOG_BLOCKS = 10_000n;
const address = /^0x[0-9a-f]{40}$/i;
const hash = /^0x[0-9a-f]{64}$/i;
const hex = /^0x(?:[0-9a-f]{2})*$/i;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const tags = new Set(['latest', 'pending', 'safe', 'finalized', 'earliest']);
const block = value => typeof value === 'string' && (quantity.test(value) || tags.has(value));
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hexNumber = value => typeof value === 'string' && quantity.test(value);
const atMost = (value, max) => hexNumber(value) && BigInt(value) <= max;

export const METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBalance', 'eth_getTransactionCount',
  'eth_getCode', 'eth_getStorageAt', 'eth_call', 'eth_estimateGas', 'eth_feeHistory', 'eth_getLogs',
]);

export class RpcFault extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const invalid = () => { throw new RpcFault(-32602, 'Invalid or unsupported RPC parameters.'); };

function callParameters(params) {
  const tx = params[0];
  if (!plain(tx) || !address.test(tx.to) || params.length > 2 || (params.length === 2 && !block(params[1]))) invalid();
  const allowed = new Set(['to', 'from', 'data', 'input', 'value', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'type', 'nonce', 'accessList']);
  if (Object.keys(tx).some(key => !allowed.has(key))) invalid();
  if (tx.from !== undefined && !address.test(tx.from)) invalid();
  for (const key of ['data', 'input']) if (tx[key] !== undefined && (typeof tx[key] !== 'string' || !hex.test(tx[key]) || tx[key].length > 131_074)) invalid();
  for (const key of ['value', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'type', 'nonce']) if (tx[key] !== undefined && !hexNumber(tx[key])) invalid();
  if (tx.accessList !== undefined && (!Array.isArray(tx.accessList) || tx.accessList.length > 50 ||
    tx.accessList.some(item => !plain(item) || !address.test(item.address) || !Array.isArray(item.storageKeys) || item.storageKeys.length > 50 || item.storageKeys.some(key => !hash.test(key))))) invalid();
}

export function validateRequest(input) {
  if (!plain(input) || input.jsonrpc !== '2.0' || !((typeof input.id === 'string' && input.id.length <= 128) || (typeof input.id === 'number' && Number.isSafeInteger(input.id)))) {
    throw new RpcFault(-32600, 'A JSON-RPC 2.0 request with an ID is required.');
  }
  if (!METHODS.has(input.method)) throw new RpcFault(-32601, 'This read-only gateway does not allow that RPC method.', 403);
  const p = input.params ?? [];
  if (!Array.isArray(p)) invalid();
  switch (input.method) {
    case 'eth_chainId': case 'net_version': case 'eth_blockNumber': case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas':
      if (p.length) invalid(); break;
    case 'eth_getBlockByNumber':
      if (p.length !== 2 || !block(p[0]) || typeof p[1] !== 'boolean') invalid(); break;
    case 'eth_getBlockByHash':
      if (p.length !== 2 || !hash.test(p[0]) || typeof p[1] !== 'boolean') invalid(); break;
    case 'eth_getTransactionByHash': case 'eth_getTransactionReceipt':
      if (p.length !== 1 || !hash.test(p[0])) invalid(); break;
    case 'eth_getBalance': case 'eth_getTransactionCount': case 'eth_getCode':
      if (p.length !== 2 || !address.test(p[0]) || !block(p[1])) invalid(); break;
    case 'eth_getStorageAt':
      if (p.length !== 3 || !address.test(p[0]) || !hexNumber(p[1]) || !block(p[2])) invalid(); break;
    case 'eth_call': case 'eth_estimateGas':
      if (p.length < 1) invalid(); callParameters(p); break;
    case 'eth_feeHistory':
      if (p.length !== 3 || !atMost(p[0], 1024n) || !block(p[1]) || !Array.isArray(p[2]) || p[2].length > 100 ||
        p[2].some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)) invalid(); break;
    case 'eth_getLogs': {
      const filter = p[0];
      if (p.length !== 1 || !plain(filter) || Object.keys(filter).some(key => !['address', 'topics', 'fromBlock', 'toBlock', 'blockHash'].includes(key))) invalid();
      const addresses = Array.isArray(filter.address) ? filter.address : [filter.address];
      if (!addresses.length || addresses.length > 10 || addresses.some(value => !address.test(value))) invalid();
      if (filter.topics !== undefined && (!Array.isArray(filter.topics) || filter.topics.length > 4 ||
        filter.topics.some(topic => topic !== null && !(typeof topic === 'string' && hash.test(topic)) &&
          !(Array.isArray(topic) && topic.length <= 20 && topic.every(value => value === null || (typeof value === 'string' && hash.test(value))))))) invalid();
      if (filter.blockHash !== undefined) {
        if (!hash.test(filter.blockHash) || filter.fromBlock !== undefined || filter.toBlock !== undefined) invalid();
      } else {
        // Do not relay an unbounded historical scan paid for by the application.
        if (![filter.fromBlock, filter.toBlock].every(value => value === undefined || value === 'latest' || hexNumber(value))) {
          throw new RpcFault(-32602, 'Log queries require hexadecimal block bounds, latest, or a block hash.');
        }
        if (hexNumber(filter.fromBlock) && hexNumber(filter.toBlock) && (BigInt(filter.toBlock) < BigInt(filter.fromBlock) || BigInt(filter.toBlock) - BigInt(filter.fromBlock) >= MAX_LOG_BLOCKS)) {
          throw new RpcFault(-32602, 'Request logs in ranges of at most 10,000 blocks.');
        }
      }
      break;
    }
  }
  return { jsonrpc: '2.0', id: input.id, method: input.method, params: p };
}

export function validatePayload(payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  if (!items.length || items.length > MAX_BATCH) throw new RpcFault(-32600, `Use between 1 and ${MAX_BATCH} RPC calls per request.`);
  const requests = items.map(validateRequest);
  if (new Set(requests.map(item => `${typeof item.id}:${item.id}`)).size !== requests.length) throw new RpcFault(-32600, 'Batch request IDs must be unique.');
  return requests;
}

export function drpcEndpoint(value) {
  if (!value) throw new RpcFault(-32001, 'The mainnet connection is not configured.', 503);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !/(^|\.)(drpc\.org|drpc\.live|drpc\.network)$/.test(url.hostname)) throw Error();
    return url;
  } catch { throw new RpcFault(-32001, 'The server requires a valid dRPC HTTPS endpoint.', 503); }
}

export function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)) ? id : null, error: { code, message } };
}
