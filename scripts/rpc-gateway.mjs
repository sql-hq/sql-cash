import { randomUUID, createHash } from 'node:crypto';
import { RPC_PATH, MAX_BODY, MAX_RESPONSE, MAX_BATCH, RpcFault, drpcEndpoint, validatePayload, rpcError } from './rpc-policy.mjs';

const RATE_WINDOW = 60_000;
const TIMEOUT = 25_000;
const EMPTY = Symbol('empty');
const log = event => console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const timer = setTimeout(() => reject(new RpcFault(-32600, 'The RPC request timed out.', 408)), 10_000);
    timer.unref();
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { clearTimeout(timer); chunks.length = 0; reject(new RpcFault(-32600, 'The RPC request is too large.', 413)); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timer);
      if (size > MAX_BODY) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new RpcFault(-32700, 'The request must contain valid JSON.')); }
    });
    req.on('error', () => { clearTimeout(timer); reject(new RpcFault(-32600, 'The RPC request was interrupted.')); });
  });
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new RpcFault(-32002, 'The mainnet provider returned an empty response.', 502);
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE) throw new RpcFault(-32002, 'The provider response is too large. Request a smaller range.', 502);
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function createRpcGateway({ base = '/', fetchImpl = fetch, getEndpoint = () => process.env.DRPC_RPC_URL, writeLog = log } = {}) {
  const prefix = `/${base.split('/').filter(Boolean).join('/')}${base === '/' ? '' : '/'}`;
  const rpcPath = `${prefix}${RPC_PATH}`;
  const healthPath = `${prefix}health`;
  const clients = new Map();
  let globalWindow = { start: 0, used: 0 };
  let active = 0, verifiedUntil = 0, verification, headUntil = 0, headBlock;
  let health = { checkedAt: null, status: 'not_checked' };
  const json = (res, status, body, requestId) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId });
    res.end(JSON.stringify(body));
  };
  const forward = async payload => {
    const response = await fetchImpl(drpcEndpoint(getEndpoint()), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT), redirect: 'error',
    });
    if (!response.ok) throw new RpcFault(-32002, response.status === 429 ? 'The mainnet provider is rate limiting requests. Try again shortly.' : 'The mainnet provider is temporarily unavailable.', response.status === 429 ? 429 : 502);
    return readResponse(response);
  };
  const verifyMainnet = async () => {
    if (Date.now() < verifiedUntil) return;
    if (!verification) verification = (async () => {
      const result = await forward({ jsonrpc: '2.0', id: 'network-check', method: 'eth_chainId', params: [] });
      if (result?.result !== '0x1') throw new RpcFault(-32003, 'The configured provider did not confirm Ethereum mainnet.', 503);
      verifiedUntil = Date.now() + 60_000;
    })().finally(() => { verification = undefined; });
    await verification;
  };
  const normalizeLogBounds = async requests => {
    const needsHead = requests.some(item => item.method === 'eth_getLogs' && !item.params[0].blockHash &&
      [item.params[0].fromBlock, item.params[0].toBlock].some(bound => bound === undefined || bound === 'latest'));
    if (!needsHead) return requests;
    if (Date.now() >= headUntil) {
      const result = await forward({ jsonrpc: '2.0', id: 'log-head', method: 'eth_blockNumber', params: [] });
      if (result.error || typeof result.result !== 'string' || !/^0x[0-9a-f]+$/i.test(result.result)) throw new RpcFault(-32002, 'The latest Ethereum block could not be read.', 502);
      headBlock = result.result; headUntil = Date.now() + 4000;
    }
    // Revalidate after substituting latest: a numeric-to-latest query must also
    // obey the range cap, not become an unbounded provider query.
    return validatePayload(requests.map(item => {
      if (item.method !== 'eth_getLogs' || item.params[0].blockHash) return item;
      const filter = { ...item.params[0] };
      for (const key of ['fromBlock', 'toBlock']) if (filter[key] === undefined || filter[key] === 'latest') filter[key] = headBlock;
      return { ...item, params: [filter] };
    }));
  };
  const rateLimit = (req, count) => {
    const now = Date.now();
    // Store only an ephemeral hash, never client IPs, addresses, or request data.
    const key = createHash('sha256').update(String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress)).digest('hex');
    if (now - globalWindow.start >= RATE_WINDOW) {
      globalWindow = { start: now, used: 0 };
      for (const [id, entry] of clients) if (now - entry.start >= RATE_WINDOW) clients.delete(id);
    }
    const entry = clients.get(key) ?? { start: now, used: 0 };
    if (now - entry.start >= RATE_WINDOW) { entry.start = now; entry.used = 0; }
    if (globalWindow.used + count > 3600 || entry.used + count > 1200 || active >= 12 || clients.size > 5000) {
      throw new RpcFault(-32005, 'The mainnet gateway is busy. Try again shortly.', 429);
    }
    entry.used += count; globalWindow.used += count; clients.set(key, entry);
  };
  const sameOrigin = req => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true; // SDK/server clients may not send Origin.
    try {
      const host = new URL(req.headers.origin).host;
      return host === req.headers.host || host === String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
    } catch { return false; }
  };
  const sanitize = (response, expected) => {
    if (!response || response.jsonrpc !== '2.0' || response.id !== expected.id) throw new RpcFault(-32002, 'The mainnet provider returned an invalid response.', 502);
    if (response.error) {
      // Provider error text/data can contain authenticated URLs: never relay it.
      const code = Number.isInteger(response.error.code) ? response.error.code : -32002;
      return rpcError(expected.id, code, 'The mainnet provider could not complete this read request.');
    }
    if (!Object.hasOwn(response, 'result')) throw new RpcFault(-32002, 'The mainnet provider returned an invalid response.', 502);
    if ((expected.method === 'eth_chainId' && response.result !== '0x1') || (expected.method === 'net_version' && response.result !== '1')) {
      throw new RpcFault(-32003, 'The mainnet provider returned a different network.', 503);
    }
    return { jsonrpc: '2.0', id: expected.id, result: response.result };
  };
  return async (req, res, next = () => {}) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== rpcPath && pathname !== healthPath) return next();
    const requestId = randomUUID(), start = Date.now();
    let payload = EMPTY, counted = false, status = 200, count = 0;
    try {
      if (!sameOrigin(req)) throw new RpcFault(-32600, 'Cross-origin access is not allowed.', 403);
      if (req.method !== (pathname === healthPath ? 'GET' : 'POST')) throw new RpcFault(-32600, 'This HTTP method is not allowed.', 405);
      if (pathname === healthPath) {
        rateLimit(req, 1); active++; counted = true;
        try {
          await verifyMainnet();
          if (!health.checkedAt || Date.now() - Date.parse(health.checkedAt) > 15_000) {
            const head = await forward({ jsonrpc: '2.0', id: 'health', method: 'eth_blockNumber', params: [] });
            if (head.error || typeof head.result !== 'string' || !/^0x[0-9a-f]+$/i.test(head.result)) throw Error();
            health = { checkedAt: new Date().toISOString(), status: 'ready', blockNumber: head.result };
          }
          json(res, 200, { status: 'ok', network: 'ethereum-mainnet', rpc: health }, requestId);
        } catch {
          verifiedUntil = 0; status = 503; health = { checkedAt: new Date().toISOString(), status: 'unavailable' };
          json(res, 503, { status: 'degraded', network: 'ethereum-mainnet', rpc: health }, requestId);
        }
        return;
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new RpcFault(-32600, 'Use application/json for RPC requests.', 415);
      if (Number(req.headers['content-length']) > MAX_BODY) throw new RpcFault(-32600, 'The RPC request is too large.', 413);
      rateLimit(req, 1);
      payload = await readBody(req);
      let requests = validatePayload(payload); count = requests.length;
      rateLimit(req, Math.max(0, count - 1));
      active++; counted = true;
      await verifyMainnet();
      requests = await normalizeLogBounds(requests);
      const raw = await forward(Array.isArray(payload) ? requests : requests[0]);
      const responses = Array.isArray(raw) ? raw : [raw];
      if (responses.length !== requests.length) throw new RpcFault(-32002, 'The mainnet provider returned an incomplete response.', 502);
      const clean = requests.map(expected => sanitize(responses.find(item => item.id === expected.id), expected));
      if (clean.some(item => item.error)) status = 200; // JSON-RPC method errors use HTTP 200.
      json(res, 200, Array.isArray(payload) ? clean : clean[0], requestId);
    } catch (error) {
      const fault = error instanceof RpcFault ? error : new RpcFault(-32002, 'The mainnet connection could not complete this request. Try again shortly.', 502);
      status = fault.status;
      if (status >= 500) verifiedUntil = 0;
      if (status === 429) res.setHeader('Retry-After', '10');
      const items = payload !== EMPTY && Array.isArray(payload) && payload.length > 0 && payload.length <= MAX_BATCH ? payload : [payload === EMPTY ? {} : payload];
      const errors = items.map(item => rpcError(item?.id, fault.code, fault.message));
      json(res, status, Array.isArray(payload) && payload.length > 0 && payload.length <= MAX_BATCH ? errors : errors[0], requestId);
    } finally {
      if (counted) active--;
      writeLog({ event: pathname === healthPath ? 'mainnet_health' : 'mainnet_rpc', requestId, status, calls: count, durationMs: Date.now() - start });
    }
  };
}
