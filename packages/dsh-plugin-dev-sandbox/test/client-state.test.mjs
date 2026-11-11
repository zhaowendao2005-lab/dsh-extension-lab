import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxStore } from '../frontend/stores/sandbox.store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('store polls the same session, exposes snapshots, and stops when unsubscribed', async () => {
  const calls = [];
  const store = createSandboxStore({
    sessionId: 'session-A',
    delay: 60_000,
    execute: async request => {
      calls.push(request);
      return { ok: true, value: { binding: { sessionId: request.sessionId }, logs: [] } };
    },
  });
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  await tick();
  assert.deepEqual(calls, [{ sessionId: 'session-A', action: 'status' }]);
  assert.equal(store.getSnapshot().snapshot.binding.sessionId, 'session-A');
  assert.ok(changes > 0);
  unsubscribe();
  store.dispose();
});

test('an action invalidates an older in-flight status response', async () => {
  let finishStatus;
  const store = createSandboxStore({
    sessionId: 'session-B',
    delay: 60_000,
    execute: request => {
      if (request.action === 'status') return new Promise(resolve => { finishStatus = resolve; });
      return Promise.resolve({ ok: true, value: { binding: { name: 'new' }, runtime: { state: 'running' } } });
    },
  });
  const unsubscribe = store.subscribe(() => {});
  await store.launch();
  finishStatus({ ok: true, value: { binding: { name: 'old' }, runtime: { state: 'stopped' } } });
  await tick();
  assert.equal(store.getSnapshot().snapshot.binding.name, 'new');
  unsubscribe();
  store.dispose();
});

test('RemoteResult failures become visible and do not poison the next action', async () => {
  let fail = true;
  const store = createSandboxStore({
    sessionId: 'session-C',
    delay: 60_000,
    execute: async () => (fail
      ? { ok: false, error: { message: 'access denied' } }
      : { ok: true, value: { binding: null, commands: [] } }),
  });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  assert.equal(store.getSnapshot().error, 'access denied');
  fail = false;
  await store.refresh();
  assert.equal(store.getSnapshot().error, null);
  assert.deepEqual(store.getSnapshot().snapshot.commands, []);
  unsubscribe();
  store.dispose();
});
