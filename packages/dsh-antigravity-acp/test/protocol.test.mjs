import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createConnection, RpcError } from '../src/protocol/index.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const frame = (message) => `${JSON.stringify(message)}\n`;

function harness(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let text = '';
  output.on('data', (chunk) => {
    text += chunk.toString('utf8');
    for (;;) {
      const end = text.indexOf('\n');
      if (end < 0) break;
      messages.push(JSON.parse(text.slice(0, end)));
      text = text.slice(end + 1);
    }
  });
  const connection = createConnection({ input, output, ...options });
  return { input, output, messages, connection };
}

test('newline JSON-RPC preserves split multibyte frames and notifications', async () => {
  const { connection, input, messages } = harness();
  const updates = [];
  const unsubscribe = connection.onNotification((method, params) => updates.push({ method, params }));
  const result = connection.request('session/new', { cwd: '/empty' });
  await tick();
  assert.equal(messages[0].method, 'session/new');
  const reply = Buffer.from(frame({ jsonrpc: '2.0', id: messages[0].id, result: { title: '中文' } }));
  const split = reply.indexOf(Buffer.from('中')) + 1;
  input.write(reply.subarray(0, split));
  input.write(reply.subarray(split));
  assert.deepEqual(await result, { title: '中文' });
  input.write(frame({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk' } } }));
  assert.deepEqual(updates, [{ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk' } } }]);
  unsubscribe();
  await connection.notify('session/cancel', { sessionId: 's1' });
  assert.equal(messages[1].method, 'session/cancel');
  connection.close();
});

test('server requests have independent IDs and structured errors', async () => {
  const { connection, input, messages } = harness();
  connection.setRequestHandler((method, params) => {
    if (method === 'allowed') return { value: params.value };
    throw new RpcError(-32601, 'Disabled');
  });
  input.write(frame({ jsonrpc: '2.0', id: 'dsh-1', method: 'allowed', params: { value: 7 } }));
  const outgoing = connection.request('initialize');
  await tick();
  assert.deepEqual(messages.find((message) => !message.method)?.result, { value: 7 });
  const request = messages.find((message) => message.method === 'initialize');
  input.write(frame({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1 } }));
  await outgoing;
  input.write(frame({ jsonrpc: '2.0', id: 2, method: 'native/fs', params: {} }));
  await tick();
  assert.deepEqual(messages.find((message) => message.id === 2)?.error, { code: -32601, message: 'Disabled' });
  connection.close();
});

test('RPC error responses retain code and data without replacing the connection', async () => {
  const { connection, input, messages } = harness();
  const rejected = connection.request('unsupported');
  await tick();
  input.write(frame({ jsonrpc: '2.0', id: messages[0].id, error: { code: -32001, message: 'No entitlement', data: { retryable: false } } }));
  await assert.rejects(rejected, (error) => error instanceof RpcError && error.code === -32001 && error.data.retryable === false);
  assert.equal(connection.isClosed, false);
  connection.close();
});

test('abort and timeout reject once and harmless late responses do not corrupt IDs', async () => {
  const { connection, input, messages } = harness();
  const controller = new AbortController();
  const aborted = connection.request('session/prompt', {}, { signal: controller.signal, timeoutMs: 1000 });
  await tick();
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  const timed = connection.request('slow', {}, { timeoutMs: 10 });
  await assert.rejects(timed, { code: 'ACP_TIMEOUT' });
  for (const message of messages) input.write(frame({ jsonrpc: '2.0', id: message.id, result: {} }));
  assert.equal(connection.isClosed, false);
  const next = connection.request('next');
  await tick();
  const request = messages.find((message) => message.method === 'next');
  input.write(frame({ jsonrpc: '2.0', id: request.id, result: 'ok' }));
  assert.equal(await next, 'ok');
  connection.close();
});

test('a pre-aborted request never emits an outbound frame', async () => {
  const { connection, messages } = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(connection.request('session/prompt', {}, { signal: controller.signal }), { name: 'AbortError' });
  await tick();
  assert.equal(messages.length, 0);
  connection.close();
});

for (const [name, bytes, code] of [
  ['malformed JSON', Buffer.from('{bad}\n'), 'ACP_PROTOCOL_ERROR'],
  ['invalid UTF-8', Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10]), 'ACP_PROTOCOL_ERROR'],
  ['non-JSON-RPC object', Buffer.from('{}\n'), 'ACP_PROTOCOL_ERROR'],
  ['oversized unterminated frame', Buffer.alloc(129, 32), 'ACP_FRAME_LIMIT'],
  ['unknown response ID', Buffer.from(frame({ jsonrpc: '2.0', id: 'foreign', result: {} })), 'ACP_PROTOCOL_ERROR'],
  ['result and error together', Buffer.from(frame({ jsonrpc: '2.0', id: 'dsh-1', result: {}, error: { code: 1, message: 'x' } })), 'ACP_PROTOCOL_ERROR'],
]) {
  test(`${name} closes the connection and rejects all pending work`, async () => {
    const { connection, input } = harness({ maxFrameBytes: 128 });
    const request = connection.request('pending');
    const rejected = assert.rejects(request, { code });
    input.write(bytes);
    await rejected;
    assert.equal((await connection.closed).error.code, code);
    await assert.rejects(connection.request('after-failure'), { code });
  });
}

test('EOF inside a partial frame rejects pending work instead of parsing a fragment', async () => {
  const { connection, input } = harness();
  const request = connection.request('pending');
  const rejected = assert.rejects(request, { code: 'ACP_EOF' });
  input.end('{"jsonrpc":');
  await rejected;
  assert.match((await connection.closed).error.message, /inside a JSON frame/);
});

test('duplicate active server request IDs fail closed', async () => {
  const { connection, input } = harness();
  connection.setRequestHandler(() => new Promise(() => {}));
  const message = frame({ jsonrpc: '2.0', id: 'server-1', method: 'park', params: {} });
  input.write(message + message);
  assert.match((await connection.closed).error.message, /Duplicate active/);
});

test('pending and incoming request counts are bounded', async () => {
  const { connection, input } = harness({ maxPendingRequests: 1, maxInboundRequests: 1 });
  const first = connection.request('first');
  const rejectedFirst = assert.rejects(first, { code: 'ACP_REQUEST_LIMIT' });
  await assert.rejects(connection.request('second'), { code: 'ACP_REQUEST_LIMIT' });
  connection.setRequestHandler(() => new Promise(() => {}));
  input.write(frame({ jsonrpc: '2.0', id: 1, method: 'park' }) + frame({ jsonrpc: '2.0', id: 2, method: 'park' }));
  await rejectedFirst;
});

test('stalled writes and their queue are rejected promptly on close', async () => {
  const input = new PassThrough();
  let release;
  const output = new Writable({ write(_chunk, _encoding, callback) { release = callback; } });
  const connection = createConnection({ input, output, maxFrameBytes: 128 });
  const first = connection.notify('n', { text: 'x'.repeat(30) });
  const second = connection.notify('n', { text: 'x'.repeat(30) });
  await tick();
  connection.close(new Error('shutdown'));
  const settled = await Promise.allSettled([first, second]);
  assert.ok(settled.every((item) => item.status === 'rejected' && item.reason.message === 'shutdown'));
  release();
});

test('the outgoing queue has a byte limit even if its transport never drains', async () => {
  const input = new PassThrough();
  let release;
  const output = new Writable({ write(_chunk, _encoding, callback) { release = callback; } });
  const connection = createConnection({ input, output, maxFrameBytes: 128 });
  const notices = [];
  for (let index = 0; index < 10; index++) notices.push(connection.notify('n', { text: 'x'.repeat(30) }));
  const settled = await Promise.allSettled(notices);
  assert.equal((await connection.closed).error.code, 'ACP_QUEUE_LIMIT');
  assert.ok(settled.every((item) => item.status === 'rejected'));
  release?.();
});

test('handler failure returns only a generic error and late pipe errors stay handled', async () => {
  const { connection, input, output, messages } = harness();
  connection.setRequestHandler(() => { throw new Error('secret detail'); });
  input.write(frame({ jsonrpc: '2.0', id: 1, method: 'failure' }));
  await tick();
  assert.deepEqual(messages[0].error, { code: -32603, message: 'ACP request handler failed' });
  connection.close();
  assert.doesNotThrow(() => { input.emit('error', new Error('late input')); output.emit('error', new Error('late output')); });
});
