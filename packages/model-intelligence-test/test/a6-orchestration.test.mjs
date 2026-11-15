// Scheduling invariants for a6api channel tests, plus the only public web entry point.
// Nothing here touches the network: pin/unpin and the channel stream are injected hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { FingerprintEngine } from '../backend/fingerprint/engine.js';
import { A6Intake } from '../backend/a6/intake.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('condition was not reached');
}

const meta = { accountId: '42', siteOrigin: 'https://a6api.vip', slots: Array.from({ length: 4 }, (_, i) => ({ tokenId: i + 1, name: `token-${i + 1}` })) };
const channel = id => ({ listingId: id * 10, channelId: id, supplierId: 1, model: 'same-model' });
const models = count => Array.from({ length: count }, (_, i) => ({
  provider: `a6api:${i + 1}:1`, id: 'same-model', a6api: channel(i + 1),
  relay: { siteId: 'a6api', model: 'same-model', channelId: i + 1, api: 'chat', listingId: (i + 1) * 10, supplierId: 1 },
}));

/** Fake a6api control plane plus a channel stream that only runs while its channel is pinned. */
function harness({ pinFails = false, keyFails = false, cleanup } = {}) {
  const pins = new Map(), batches = new Map(), events = [];
  let requests = 0;
  const plane = {
    async key(tokenId) { if (keyFails) throw new Error('key unavailable'); return `sk-test-${tokenId}`; },
    async pin(target) {
      events.push({ operation: 'pin', ...target });
      assert.equal(pins.has(target.tokenId), false, 'a token must not be pinned twice at once');
      if (pinFails) return { routeEffective: false };
      pins.set(target.tokenId, target.channelId);
      return { routeEffective: true, supplierId: 1 };
    },
    async unpin(target) {
      assert.equal(batches.get(target.channelId)?.active ?? 0, 0, 'restore must wait for all stream cleanups');
      events.push({ operation: 'unpin', ...target });
      pins.delete(target.tokenId);
      return { restored: true };
    },
    openStream({ signal, model, key }) {
      const tokenId = Number(key.split('-').pop());
      const channelId = pins.get(tokenId);
      return (async function* () {
        assert.ok(channelId, 'sampling is only allowed after the channel is pinned');
        let batch = batches.get(channelId);
        if (!batch) { batch = { gate: deferred(), active: 0, started: 0 }; batches.set(channelId, batch); }
        requests += 1; batch.started += 1; batch.active += 1;
        try {
          const aborted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
          await Promise.race([batch.gate.promise, aborted]);
          if (signal.aborted && cleanup) await cleanup.promise;
          if (signal.aborted) return;
          yield { type: 'text-delta', index: 1, text: `answer for ${model}` };
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        } finally { batch.active -= 1; }
      })();
    },
  };
  const engine = new FingerprintEngine({ get: name => (name === 'llm' ? { listProviders: () => [], listModels: () => [] } : undefined) },
    { a6: { key: plane.key, pin: plane.pin, unpin: plane.unpin }, openStream: plane.openStream });
  return { engine, plane, pins, batches, events, requests: () => requests };
}

test('20 targets over 4 tokens: a finished triple refills at once, and each token holds one channel', async () => {
  const h = harness();
  const view = await h.engine.start(models(20), {}, meta);
  const job = h.engine.jobs.get(view.id);
  await until(() => h.requests() === 12);
  assert.equal(h.pins.size, 4, 'one pinned channel per token');
  assert.deepEqual([...h.batches.values()].map(batch => batch.started), [3, 3, 3, 3], 'three challenges per channel at once');
  h.batches.get(1).gate.resolve();
  await until(() => h.batches.has(5));
  assert.equal(h.batches.get(2).active, 3, 'worker 1 must not wait for worker 2');
  assert.equal(h.batches.get(5).started, 3, 'the freed token claims the next item immediately');
  for (let i = 0; i < 40; i++) {
    for (const batch of h.batches.values()) batch.gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }
  await job.loop;
  assert.equal(h.requests(), 60, '20 items x 3 challenges');
  assert.equal(h.pins.size, 0, 'every pin is restored');
  assert.equal(h.events.filter(event => event.operation === 'pin').length, 20);
  assert.equal(h.events.filter(event => event.operation === 'unpin').length, 20);
  assert.equal(h.engine.status(view.id).status, 'done');
  h.engine.dispose();
});

test('cancel keeps the token locked until all three streams finish cleanup and the restore is acknowledged', async () => {
  const cleanup = deferred();
  const h = harness({ cleanup });
  const one = { ...meta, slots: [meta.slots[0]] };
  const first = await h.engine.start(models(2), {}, one);
  await until(() => h.requests() === 3);
  h.engine.cancel(first.id);
  const second = await h.engine.start(models(1), {}, one);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.filter(event => event.operation === 'pin').length, 1, 'cancel must not free the token early');
  cleanup.resolve();
  await until(() => h.requests() === 6);
  assert.equal(h.events[1].operation, 'unpin');
  h.batches.get(1).gate.resolve();
  await h.engine.jobs.get(first.id).loop;
  await h.engine.jobs.get(second.id).loop;
  assert.equal(h.pins.size, 0);
  h.engine.dispose();
});

test('a pin that does not take effect sends zero sampling requests', async () => {
  const h = harness({ pinFails: true });
  const started = await h.engine.start(models(2), {}, { ...meta, slots: [meta.slots[0]] });
  await h.engine.jobs.get(started.id).loop;
  assert.equal(h.requests(), 0, 'the channel was never confirmed, so nothing may be billed');
  const view = h.engine.status(started.id);
  assert.equal(view.runs.every(run => run.stage === 'failed'), true);
  assert.equal(view.status, 'failed');
  assert.equal(h.events.filter(event => event.operation === 'unpin').length, 2, 'a failed attempt still tries to undo the pin');
  h.engine.dispose();
});

test('an unavailable test key fails the run without spending requests', async () => {
  const h = harness({ keyFails: true });
  const started = await h.engine.start(models(2), {}, { ...meta, slots: [meta.slots[0]] });
  await h.engine.jobs.get(started.id).loop;
  assert.equal(h.requests(), 0);
  assert.equal(h.engine.status(started.id).runs.every(run => run.stage === 'failed'), true);
  h.engine.dispose();
});

test('the intake endpoint rejects unpaired callers, ignores other sites, and de-duplicates selections', async () => {
  const rows = new Map();
  const storage = { async managed() { return { table: () => ({ get: id => rows.get(id), async put(id, value) { rows.set(id, structuredClone(value)); } }) }; } };
  const intake = new A6Intake();
  intake.attachStorage(storage);
  await intake.ready;
  const server = createServer((req, res) => intake.handle(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  intake.origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${intake.origin}/mit-a6/select`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mit-intake': intake.token, ...headers }, body: JSON.stringify(body),
  });
  try {
    const payload = { siteOrigin: 'https://a6api.vip', accountId: '2744', pageId: 'p1', models: models(2).map(model => model.a6api), tokens: [{ id: 7, name: 'dsh-diy' }, { id: 7, name: 'dup' }, { id: 9, name: 'spare' }] };
    assert.equal((await post(payload, { 'x-mit-intake': 'wrong' })).status, 403, 'a copied token from another site must fail');
    assert.equal((await post({ ...payload, siteOrigin: 'https://evil.example' })).status, 403, 'only a6api may submit');
    assert.equal((await post({ ...payload, models: [] })).status, 400);
    const ok = await (await post(payload)).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.models, 2);
    assert.equal(ok.tokens, 2, 'duplicate token ids collapse');
    // A repeated revision is a no-op so the userscript can poll cheaply.
    assert.equal((await intake.list(ok.revision)).unchanged, true);
    assert.equal(intake.selection(ok.selectionId).accountId, '2744');
    assert.throws(() => intake.selection('missing'), /选择/);
  } finally { server.close(); }
});
