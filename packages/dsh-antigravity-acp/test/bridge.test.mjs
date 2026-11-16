import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createToolBridge } from '../src/bridge/server.js';

const tools = [{ name: 'dsh.echo/value', description: 'Echo a constrained value', parameters: {
  type: 'object', properties: { value: { type: 'string', minLength: 1 } }, required: ['value'], additionalProperties: false,
} }];
const text = (value) => ({ content: [{ type: 'text', text: value }] });

function callsQueue() {
  const buffered = [];
  const waiting = [];
  return {
    calls: [],
    push(call) { this.calls.push(call); if (waiting.length) waiting.shift()(call); else buffered.push(call); },
    take() { return buffered.length ? Promise.resolve(buffered.shift()) : new Promise((resolve) => waiting.push(resolve)); },
  };
}

async function fixture(t, options = {}) {
  const queue = callsQueue();
  const bridge = await createToolBridge({ tools, onCall: (call) => queue.push(call), ...options });
  const client = new Client({ name: 'bridge-tests', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(bridge.url), {
    requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
    reconnectionOptions: { maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
  });
  t.after(async () => { await client.close(); await bridge.close(); });
  await client.connect(transport);
  return { bridge, client, transport, queue };
}

function raw(bridge, { method = 'POST', path = '/mcp', headers = {}, headerPairs, body = { jsonrpc: '2.0', id: 'raw', method: 'tools/list' }, chunks } = {}) {
  const url = new URL(bridge.url);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, method, path, headers: headerPairs ?? {
      Authorization: `Bearer ${bridge.token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers,
    } }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts).toString() }));
    });
    request.on('error', reject);
    if (method === 'POST') {
      if (chunks) for (const part of chunks) request.write(part);
      else request.write(payload);
    }
    request.end();
  });
}

function sessionHeaders(transport) { return { 'mcp-session-id': transport.sessionId, 'mcp-protocol-version': '2025-11-25' }; }

test('official SDK client lists exact schemas; tools/call parks and fills once with original DSH identity', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 1);
  assert.equal(JSON.stringify(listed.tools[0].inputSchema), JSON.stringify(tools[0].parameters));
  assert.deepEqual(bridge.toolNames, listed.tools.map((tool) => tool.name));
  assert.equal(bridge.mappedName(tools[0].name), listed.tools[0].name);
  let settled = false;
  const result = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'hello' } }).then((value) => { settled = true; return value; });
  const call = await queue.take();
  await tick();
  assert.equal(settled, false);
  assert.equal(bridge.pendingCount, 1);
  assert.match(call.id, /^dsh_[a-f0-9]{32}_[a-f0-9]{32}$/);
  assert.equal(call.name, tools[0].name);
  assert.equal(call.arguments, '{"value":"hello"}');
  assert.equal(bridge.resolve(call.id, text('receipt')), true);
  assert.equal((await result).content[0].text, 'receipt');
  assert.equal(bridge.pendingCount, 0);
  assert.equal(bridge.resolve(call.id, text('duplicate')), false);
  assert.equal(bridge.resolve('stale-generation', text('stale')), false);
});

test('multiple calls resolve out of order without crossing IDs', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  const first = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'first' } });
  const call1 = await queue.take();
  const second = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'second' } });
  const call2 = await queue.take();
  assert.notEqual(call1.id, call2.id);
  bridge.resolve(call2.id, { ...text('second-error'), isError: true });
  bridge.resolve(call1.id, text('first-result'));
  assert.equal((await first).content[0].text, 'first-result');
  assert.equal((await second).content[0].text, 'second-error');
  assert.equal((await second).isError, true);
});

test('unknown tools and schema-invalid arguments never enter DSH', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  await assert.rejects(client.callTool({ name: 'unknown', arguments: { value: 'x' } }), /Unknown bridge tool/);
  for (const args of [{}, { value: 4 }, { value: '' }, { value: 'x', extra: true }]) {
    await assert.rejects(client.callTool({ name: bridge.toolNames[0], arguments: args }), /published schema/);
  }
  assert.equal(queue.calls.length, 0);
  assert.equal(bridge.pendingCount, 0);
});

test('pending capacity is bounded without enqueuing excess calls', async (t) => {
  const { bridge, client, queue } = await fixture(t, { maxPending: 1 });
  const first = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'one' } });
  const call = await queue.take();
  await assert.rejects(client.callTool({ name: bridge.toolNames[0], arguments: { value: 'two' } }), /pending-call limit/);
  assert.equal(queue.calls.length, 1);
  bridge.resolve(call.id, text('ok'));
  await first;
});

test('pending timeout removes call and rejects late results', async (t) => {
  const { bridge, client, queue } = await fixture(t, { timeoutMs: 40 });
  const result = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'wait' } });
  const call = await queue.take();
  const value = await result;
  assert.equal(value.isError, true);
  assert.match(value.content[0].text, /timed out/);
  assert.equal(bridge.pendingCount, 0);
  assert.equal(bridge.resolve(call.id, text('late')), false);
});

test('MCP cancellation drains pending without accepting a late result', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  const controller = new AbortController();
  const result = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'cancel' } }, undefined, { signal: controller.signal });
  const rejection = assert.rejects(result);
  const call = await queue.take();
  controller.abort();
  await rejection;
  // Notification processing is asynchronous: use a subsequent SDK request as
  // a protocol barrier, rather than arbitrary sleep to infer call completion.
  await client.listTools();
  assert.equal(bridge.pendingCount, 0);
  assert.equal(bridge.resolve(call.id, text('late')), false);
});

test('closing bridge is idempotent, revokes generation and drains pending', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  const result = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'close' } });
  const outcome = result.catch(() => undefined);
  const call = await queue.take();
  const closing = bridge.close();
  assert.equal(bridge.close(), closing);
  await closing;
  await outcome;
  assert.equal(bridge.pendingCount, 0);
  assert.equal(bridge.resolve(call.id, text('late')), false);
});

test('invalid result content fails without silently dropping the pending call', async (t) => {
  const { bridge, client, queue } = await fixture(t);
  const result = client.callTool({ name: bridge.toolNames[0], arguments: { value: 'x' } });
  const call = await queue.take();
  for (const payload of [{ content: 'text' }, { content: [{ type: 'unknown', value: 1 }] }, { content: [], isError: 'false' }, text('x'.repeat(4 * 1024 * 1024))]) assert.throws(() => bridge.resolve(call.id, payload));
  assert.equal(bridge.pendingCount, 1);
  bridge.resolve(call.id, text('valid'));
  await result;
});

test('exact authorization, Host, Origin, endpoint and body limits reject before dispatch', async (t) => {
  const { bridge, transport, queue } = await fixture(t);
  const base = sessionHeaders(transport);
  const scenarios = [
    { headers: { ...base, Authorization: 'Bearer wrong' }, status: 401 },
    { headers: { ...base, Authorization: `bearer ${bridge.token}` }, status: 401 },
    { headers: { ...base, Authorization: `Bearer ${bridge.token}junk` }, status: 401 },
    { headers: { ...base, Host: 'evil.example' }, status: 403 },
    { headers: { ...base, Origin: 'http://evil.example' }, status: 403 },
    { headers: base, path: '/mcp?token=anything', status: 404 },
    { headers: base, path: '/mcp/', status: 404 },
    { headers: { ...base, 'Content-Type': 'text/plain' }, status: 415 },
    { headers: { ...base, 'Content-Encoding': 'gzip' }, status: 415 },
    { headers: { ...base, 'Last-Event-ID': 'old' }, status: 400 },
    { headers: base, body: 'broken JSON', status: 400 },
    { headers: base, body: [], status: 400 },
    { headers: base, body: 'x'.repeat(1024 * 1024 + 1), status: 413 },
    { headers: base, method: 'PUT', status: 405 },
  ];
  for (const scenario of scenarios) {
    const response = await raw(bridge, scenario);
    assert.equal(response.status, scenario.status);
    assert.equal(response.body.includes(bridge.token), false);
  }
  assert.equal(queue.calls.length, 0);
});

test('missing, stale and second initialization session identities reject', async (t) => {
  const { bridge, transport, queue } = await fixture(t);
  assert.equal((await raw(bridge)).status, 404);
  assert.equal((await raw(bridge, { headers: { 'mcp-session-id': 'wrong' } })).status, 404);
  assert.equal((await raw(bridge, { headers: sessionHeaders(transport), body: { jsonrpc: '2.0', id: 'init-again', method: 'initialize', params: {} } })).status, 409);
  assert.equal(queue.calls.length, 0);
});

test('duplicate JSON-RPC IDs cannot cause duplicate DSH side effects, pending or completed', async (t) => {
  const { bridge, transport, queue } = await fixture(t);
  const options = { headers: sessionHeaders(transport), body: { jsonrpc: '2.0', id: 'same-request', method: 'tools/call', params: { name: bridge.toolNames[0], arguments: { value: 'one' } } } };
  const result = raw(bridge, options);
  const call = await queue.take();
  assert.equal((await raw(bridge, options)).status, 409);
  bridge.resolve(call.id, text('ok'));
  assert.equal((await result).status, 200);
  assert.equal((await raw(bridge, options)).status, 409);
  assert.equal(queue.calls.length, 1);
});

test('tools/list, ACP-like progress notifications and resources requests never dispatch a DSH tool', async (t) => {
  const { bridge, client, transport, queue } = await fixture(t);
  await client.listTools();
  const response = await raw(bridge, { headers: sessionHeaders(transport), body: { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'native-title-dsh.echo/value', progress: 1 } } });
  assert.equal(response.status, 202);
  await assert.rejects(client.listResources());
  await assert.rejects(client.readResource({ uri: 'file:///etc/passwd' }));
  assert.equal(queue.calls.length, 0);
});

test('duplicate sensitive headers fail even when Node would normalize their values', async (t) => {
  const { bridge, transport, queue } = await fixture(t);
  const host = new URL(bridge.url).host;
  const pairs = ['Host', host, 'Authorization', `Bearer ${bridge.token}`, 'Accept', 'application/json, text/event-stream', 'Content-Type', 'application/json', 'mcp-session-id', transport.sessionId];
  for (const [name, value, status] of [['Authorization', `Bearer ${bridge.token}`, 401], ['Host', host, 403], ['Origin', `http://${host}`, 403], ['mcp-session-id', transport.sessionId, 404]]) {
    const before = name === 'Origin' ? [...pairs, name, value] : pairs;
    const response = await raw(bridge, { headerPairs: [...before, name, value] });
    assert.equal(response.status, status);
  }
  assert.equal(queue.calls.length, 0);
});

test('onCall failures return generic errors and do not retain pending', async (t) => {
  const { bridge, client } = await fixture(t, { onCall() { throw new Error('private details must not cross the boundary'); } });
  const result = await client.callTool({ name: bridge.toolNames[0], arguments: { value: 'fail' } });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text.includes('private'), false);
  assert.equal(bridge.pendingCount, 0);
});

test('a second bridge generation rejects first-generation result IDs', async (t) => {
  const one = await fixture(t);
  const two = await fixture(t);
  const result = one.client.callTool({ name: one.bridge.toolNames[0], arguments: { value: 'generation-one' } });
  const call = await one.queue.take();
  assert.notEqual(one.bridge.token, two.bridge.token);
  assert.equal(two.bridge.resolve(call.id, text('wrong-generation')), false);
  one.bridge.resolve(call.id, text('right-generation'));
  await result;
});
