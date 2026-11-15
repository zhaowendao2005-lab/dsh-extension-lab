import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { FingerprintEngine } from '../backend/fingerprint/engine.js';
import { A6Bridge } from '../backend/a6/bridge.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('condition was not reached');
}
const meta = { accountId: '42', siteOrigin: 'https://a6api.vip', connectionId: 'page', slots: Array.from({ length: 4 }, (_, i) => ({ tokenId: i + 1, provider: `test-${i + 1}` })) };
const models = count => Array.from({ length: count }, (_, i) => ({ provider: `a6api:${i + 1}:1`, id: 'same-model', a6api: { listingId: i + 1, channelId: i + 1, supplierId: 1, model: 'same-model' }, relay: { siteId: 'a6api', model: 'same-model', channelId: i + 1, api: 'chat' } }));
function harness({ cancelCleanup } = {}) {
  const pins = new Map(), batches = new Map(), events = [];
  let requests = 0;
  const bridge = {
    assertReady() {},
    async execute(_meta, command) {
      events.push({ operation: command.operation, tokenId: command.tokenId, channelId: command.channelId });
      if (command.operation === 'pin') { assert.equal(pins.has(command.tokenId), false); pins.set(command.tokenId, command.channelId); return { verified: true }; }
      assert.equal(batches.get(command.channelId)?.active ?? 0, 0, 'restore must wait for all stream cleanups');
      pins.delete(command.tokenId); return { restored: true };
    },
  };
  const llm = {
    listProviders: () => meta.slots.map(slot => ({ id: slot.provider, name: slot.provider })),
    async prepareCall(config) {
      return { config, stream: async function* ({ provider, signal }) {
        const tokenId = Number(provider.split('-')[1]), channelId = pins.get(tokenId);
        assert.ok(channelId, 'sampling is allowed only after pin acknowledgement');
        let batch = batches.get(channelId);
        if (!batch) { batch = { gate: deferred(), active: 0, started: 0 }; batches.set(channelId, batch); }
        requests++; batch.started++; batch.active++;
        try {
          const aborted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
          await Promise.race([batch.gate.promise, aborted]);
          if (signal.aborted && cancelCleanup) await cancelCleanup.promise;
          if (signal.aborted) return;
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: '1, 2, 3' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '1, 2, 3' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        } finally { batch.active--; }
      } };
    },
  };
  const engine = new FingerprintEngine({ get: name => name === 'llm' ? llm : undefined }, { bridge });
  // A deterministic detector stub isolates orchestration; this test does not verify lmfpd scoring.
  engine.detector = async () => ({ builtAt: 'test-only', detector: { analyze: () => ({ decision: 'unscorable', used_outputs: 0, results: [], diagnostics: [], method: 'scheduler-fixture' }) } });
  return { engine, pins, batches, events, requests: () => requests };
}

test('20 targets use 4 tokens; one completed triple refills immediately while other triples stay active', async () => {
  const h = harness();
  const view = await h.engine.start(models(20), {}, meta);
  const job = h.engine.jobs.get(view.id);
  await until(() => h.requests() === 12);
  assert.equal(h.pins.size, 4);
  assert.deepEqual([...h.batches.values()].map(batch => batch.started), [3, 3, 3, 3]);
  h.batches.get(1).gate.resolve();
  await until(() => h.batches.has(5));
  assert.equal(h.batches.get(2).active, 3, 'worker 1 must not wait for worker 2');
  assert.equal(h.batches.get(5).started, 3);
  for (let i = 0; i < 20; i++) {
    for (const batch of h.batches.values()) batch.gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }
  await job.loop;
  assert.equal(h.requests(), 60);
  assert.equal(h.pins.size, 0);
  assert.equal(h.events.filter(event => event.operation === 'pin').length, 20);
  assert.equal(h.engine.status(view.id).status, 'done');
  h.engine.dispose();
});

test('cancelled worker keeps token locked until all three iterator cleanups finish and restore is acknowledged', async () => {
  const cleanup = deferred(), h = harness({ cancelCleanup: cleanup });
  const one = { ...meta, slots: [meta.slots[0]] };
  const first = await h.engine.start(models(2), {}, one);
  await until(() => h.requests() === 3);
  h.engine.cancel(first.id);
  const second = await h.engine.start(models(1), {}, one);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.filter(event => event.operation === 'pin').length, 1, 'cancel must not prematurely free the token');
  cleanup.resolve();
  await until(() => h.requests() === 6);
  assert.equal(h.events[1].operation, 'restore');
  h.batches.get(1).gate.resolve();
  await h.engine.jobs.get(first.id).loop;
  await h.engine.jobs.get(second.id).loop;
  assert.equal(h.pins.size, 0);
  h.engine.dispose();
});

test('failed pin acknowledgement sends zero inference requests', async () => {
  const h = harness();
  const execute = h.engine.hooks.bridge.execute;
  h.engine.hooks.bridge.execute = async (scope, command) => {
    if (command.operation === 'pin') throw new Error('pin refused');
    return execute(scope, command);
  };
  const started = await h.engine.start(models(2), {}, { ...meta, slots: [meta.slots[0]] });
  await h.engine.jobs.get(started.id).loop;
  assert.equal(h.requests(), 0);
  assert.equal(h.engine.status(started.id).runs.every(run => run.stage === 'failed'), true);
  h.engine.dispose();
});

test('persisted pin leases recover only on the same account, even if the test token was deselected', async () => {
  const rows = new Map();
  const table = { entries: () => rows.entries(), get: id => rows.get(id), async put(id, value) { rows.set(id, structuredClone(value)); }, async delete(id) { rows.delete(id); } };
  const storage = { async managed() { return { table: () => table }; } };
  const before = new A6Bridge(); before.attachStorage(storage); await before.ready;
  const connected = before.connect({ accountId: '42', siteOrigin: meta.siteOrigin, pageId: 'old', tokens: [{ id: 1, name: 'test' }] });
  const scope = { ...meta, connectionId: connected.connectionId };
  const pin = before.execute(scope, { operation: 'pin', tokenId: 1, model: 'same-model', channelId: 1, leaseId: 'durable' });
  await until(() => before.commands.size === 1);
  before.ack(before.connections.get(connected.connectionId), { commandId: [...before.commands.keys()][0], ok: true, result: { verified: true } });
  await pin;
  assert.ok(rows.has('lease:durable'));
  before.dispose();
  const after = new A6Bridge(); after.attachStorage(storage); await after.ready;
  after.connect({ accountId: '43', siteOrigin: meta.siteOrigin, pageId: 'other', tokens: [] });
  assert.equal(after.commands.size, 0, 'must never restore a pin into a different account');
  const same = after.connect({ accountId: '42', siteOrigin: meta.siteOrigin, pageId: 'new', tokens: [] });
  await until(() => after.commands.size === 1);
  const command = [...after.commands.values()][0].command;
  assert.equal(command.operation, 'restore');
  assert.equal(command.leaseId, 'durable');
  after.ack(after.connections.get(same.connectionId), { commandId: command.id, ok: true, result: { restored: true, verified: true } });
  await until(() => after.recovered.size === 0);
  assert.equal(rows.has('lease:durable'), false);
  after.dispose();
});

test('confirmed pre-write pin rejection drops the recovery intent instead of blocking the account', async () => {
  const rows = new Map();
  const table = { entries: () => rows.entries(), get: id => rows.get(id), async put(id, value) { rows.set(id, structuredClone(value)); }, async delete(id) { rows.delete(id); } };
  const bridge = new A6Bridge();
  bridge.attachStorage({ async managed() { return { table: () => table }; } }); await bridge.ready;
  const paired = bridge.connect({ accountId: '42', siteOrigin: meta.siteOrigin, pageId: 'pre-write', tokens: [{ id: 1, name: 'test' }] });
  const scope = { ...meta, connectionId: paired.connectionId };
  const target = { tokenId: 1, model: 'same-model', channelId: 1, leaseId: 'never-written' };
  const pending = bridge.execute(scope, { ...target, operation: 'pin' });
  const rejection = assert.rejects(pending, /没有执行写入/);
  await until(() => bridge.commands.size === 1);
  await bridge.ack(bridge.connections.get(paired.connectionId), { commandId: [...bridge.commands.keys()][0], ok: false, error: '没有执行写入', result: { notApplied: true } });
  await rejection;
  assert.equal(rows.size, 0);
  assert.deepEqual(await bridge.execute(scope, { ...target, operation: 'restore' }), { skipped: true, restored: true });
  assert.doesNotThrow(() => bridge.assertReady(scope, [{ tokenId: 1 }]));
  bridge.dispose();
});

test('loopback bridge denies unpaired traffic, keeps account scope, and hands off data without starting inference', async () => {
  const bridge = new A6Bridge();
  const server = createServer((req, res) => bridge.handle(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  bridge.origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${bridge.origin}/mit-a6/bridge/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const connectionInput = { accountId: '42', siteOrigin: 'https://a6api.vip', pageId: 'test-page', tokens: [{ id: 1, name: 'dedicated test' }] };
    assert.equal((await post('connect', connectionInput)).status, 403);
    const connection = await (await post('connect', connectionInput, { 'X-MIT-Capability': bridge.capability })).json();
    const headers = { 'X-MIT-Session': connection.sessionToken };
    const scope = { accountId: '42', connectionId: connection.connectionId };
    const request = { ...scope, models: [models(1)[0].a6api], tokens: connectionInput.tokens };
    const selection = await (await post('selection', request, headers)).json();
    assert.ok(selection.selectionId);
    assert.equal(selection.launch.nativeUrl, 'dsh://open');
    assert.equal(bridge.commands.size, 0, 'import must never implicitly pin or run inference');
    assert.equal((await post('poll', { ...scope, accountId: '43' }, headers)).status, 403);
    const selected = bridge.selection(selection.selectionId);
    const pending = bridge.execute(selected, { tokenId: 1, channelId: 1, model: 'same-model', operation: 'pin', leaseId: 'lease' });
    await until(() => bridge.commands.size === 1);
    const polled = await (await post('poll', scope, headers)).json();
    assert.equal(polled.commands.length, 1);
    await post('ack', { ...scope, commandId: polled.commands[0].id, ok: true, result: { verified: true, arbitrarySecret: 'not admitted' } }, headers);
    assert.deepEqual(await pending, { verified: true, restored: false, skipped: false, conflict: false });
  } finally { bridge.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
