import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRpcGateway } from './rpc-gateway.mjs';
import { drpcEndpoint, validatePayload, MAX_BODY, MAX_BATCH } from './rpc-policy.mjs';

const endpoint = 'https://lb.drpc.org/ogrpc?network=ethereum&dkey=fixture-private-key';
const address = '0x1111111111111111111111111111111111111111';
const request = (method = 'eth_blockNumber', params = [], id = 1) => ({ jsonrpc: '2.0', id, method, params });

async function setup(t, options = {}) {
  const sent = [], logs = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    const answer = item => ({ jsonrpc: '2.0', id: item.id, result: item.method === 'eth_chainId' ? '0x1' : item.method === 'eth_getLogs' ? [] : '0x100' });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer).reverse() : answer(body)));
  };
  const gateway = createRpcGateway({ getEndpoint: () => endpoint, fetchImpl, writeLog: entry => logs.push(entry), ...options });
  const server = createServer((req, res) => { void gateway(req, res, () => res.writeHead(404).end()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const root = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}, target = '/rpc/mainnet') => fetch(`${root}${target}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { root, post, sent, logs };
}

test('only trusted HTTPS dRPC endpoints are accepted; diagnostic text has no input values', () => {
  assert.equal(drpcEndpoint(endpoint).hostname, 'lb.drpc.org');
  for (const value of [undefined, 'private-key-only', 'http://lb.drpc.org', 'https://localhost', 'https://drpc.org.evil.test', 'https://user:password@lb.drpc.org']) {
    assert.throws(() => drpcEndpoint(value), error => !error.message.includes('password') && error.status === 503);
  }
});
test('blocks signing, sending funds, debug calls, and malformed batches', () => {
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_sign', 'wallet_switchEthereumChain', 'debug_traceTransaction']) {
    assert.throws(() => validatePayload(request(method)), /read-only gateway/);
  }
  for (const body of [[], Array.from({ length: MAX_BATCH + 1 }, (_, id) => request(undefined, [], id)), [request(), request()], { method: 'eth_chainId' }, request('eth_call', [{}])]) {
    assert.throws(() => validatePayload(body));
  }
});
test('mainnet reads and out-of-order batches preserve IDs and never expose endpoint credentials', async t => {
  const { post, sent, logs } = await setup(t);
  const response = await post([request('eth_chainId', [], 'a'), request('eth_blockNumber', [], 'b')]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { jsonrpc: '2.0', id: 'a', result: '0x1' }, { jsonrpc: '2.0', id: 'b', result: '0x100' },
  ]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, endpoint);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  assert.ok(!JSON.stringify(logs).includes('fixture-private-key'));
});
test('missing config and a Sepolia endpoint fail closed instead of falling back', async t => {
  const missing = await setup(t, { getEndpoint: () => undefined });
  const missingResponse = await missing.post(request());
  assert.equal(missingResponse.status, 503); assert.equal(missing.sent.length, 0);
  const wrong = await setup(t, { fetchImpl: async (_url, init) => new Response(JSON.stringify({
    jsonrpc: '2.0', id: JSON.parse(init.body).id, result: '0xaa36a7',
  })) });
  assert.equal((await wrong.post(request())).status, 503);
});
test('upstream exceptions and error payloads cannot disclose secret URLs', async t => {
  const failed = await setup(t, { fetchImpl: async () => { throw new Error(endpoint); } });
  const failure = await failed.post(request()); assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('fixture-private-key'));
  const upstreamError = await setup(t, { fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(body.method === 'eth_chainId'
      ? { jsonrpc: '2.0', id: body.id, result: '0x1' }
      : { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: endpoint, data: { endpoint } } }));
  } });
  const response = await upstreamError.post(request());
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'The mainnet provider could not complete this read request.' } });
  assert.ok(!JSON.stringify(upstreamError.logs).includes('fixture-private-key'));
});
test('gateway enforces method, origin, JSON type, parse, and body size limits before contacting dRPC', async t => {
  const { post, root, sent } = await setup(t);
  assert.equal((await fetch(`${root}/rpc/mainnet`)).status, 405);
  assert.equal((await post(request(), { Origin: 'https://other.example', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(request(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post('x'.repeat(MAX_BODY + 1))).status, 413);
  assert.equal((await post(request('eth_sendRawTransaction', ['0xdead']))).status, 403);
  assert.equal(sent.length, 0);
});
test('bounded historical logs work; numeric and latest ranges cannot bypass the cap', async t => {
  const { post, sent } = await setup(t);
  const response = await post(request('eth_getLogs', [{ address, fromBlock: '0x1', toBlock: 'latest' }]));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).result, []);
  const last = sent.at(-1).body;
  assert.equal(last.params[0].toBlock, '0x100');
  assert.equal((await post(request('eth_getLogs', [{ address, fromBlock: '0x0', toBlock: '0x10000' }]))).status, 400);
  const highHead = await setup(t, { fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x1' : '0x10000' }));
  } });
  assert.equal((await highHead.post(request('eth_getLogs', [{ address, fromBlock: '0x0', toBlock: 'latest' }]))).status, 400);
});
test('upstream throttling is explicit and gateway quotas bound public usage', async t => {
  const throttled = await setup(t, { fetchImpl: async () => new Response('', { status: 429 }) });
  const response = await throttled.post(request()); assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '10');
  const gateway = await setup(t);
  const batch = Array.from({ length: 100 }, (_, id) => request('eth_blockNumber', [], id));
  for (let i = 0; i < 12; i++) assert.equal((await gateway.post(batch)).status, 200);
  assert.equal((await gateway.post(request())).status, 429);
});
test('health reports a verified mainnet connection or a sanitized dependency failure', async t => {
  const good = await setup(t);
  const response = await fetch(`${good.root}/health`);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.rpc.status, 'ready'); assert.equal(body.rpc.blockNumber, '0x100');
  assert.ok(body.rpc.checkedAt.endsWith('Z'));
  const missing = await setup(t, { getEndpoint: () => undefined });
  const failure = await fetch(`${missing.root}/health`);
  assert.equal(failure.status, 503); assert.equal((await failure.json()).rpc.status, 'unavailable');
});
test('RPC transport respects the artifact base path', async t => {
  const { post, root } = await setup(t, { base: '/sql/' });
  assert.equal((await post(request(), {}, '/sql/rpc/mainnet')).status, 200);
  assert.equal((await fetch(`${root}/rpc/mainnet`)).status, 404);
});
