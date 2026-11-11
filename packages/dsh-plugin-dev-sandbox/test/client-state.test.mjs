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

const openTerminals = () => ({
  binding: { sessionId: 'session-D' },
  runtime: { state: 'stopped', pid: null, url: null, error: null },
  terminals: [{ id: 't1', state: 'running' }, { id: 't2', state: 'running' }],
  logs: [],
});

test('closing a terminal is optimistic, keeps the panel idle, and settles on the snapshot', async () => {
  let snapshot = openTerminals();
  let release;
  const datasource = {
    status: async () => structuredClone(snapshot),
    terminalClose: (terminalId) => new Promise((resolve) => {
      release = () => {
        snapshot = { ...snapshot, terminals: snapshot.terminals.filter((terminal) => terminal.id !== terminalId) };
        resolve(structuredClone(snapshot));
      };
    }),
  };
  const store = createSandboxStore({ sessionId: 'session-D', delay: 60_000, datasource });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  store.selectTerminal('t2');

  const pending = store.closeTerminal('t2');
  const immediate = store.getSnapshot();
  assert.deepEqual(immediate.ui.closing, ['t2'], 'the tab is hidden before the Host answers');
  assert.equal(immediate.ui.activeTerminal, 't1', 'the neighbour becomes active');
  assert.equal(immediate.busy, false, 'one close must not disable the panel');
  assert.equal(immediate.snapshot.terminals.length, 2, 'the snapshot is still the Host truth');

  assert.equal(await store.closeTerminal('t2'), undefined, 'a second click on the same tab is ignored');
  assert.deepEqual(store.getSnapshot().ui.closing, ['t2']);

  release();
  await pending;
  const settled = store.getSnapshot();
  assert.deepEqual(settled.ui.closing, []);
  assert.equal(settled.snapshot.terminals.length, 1);
  assert.equal(settled.ui.activeTerminal, 't1');
  unsubscribe();
  store.dispose();
});

test('a failed close restores the tab, the selection, and the error', async () => {
  const datasource = {
    status: async () => structuredClone(openTerminals()),
    terminalClose: async () => { throw new Error('terminal is not running'); },
  };
  const store = createSandboxStore({ sessionId: 'session-E', delay: 60_000, datasource });
  const unsubscribe = store.subscribe(() => {});
  await tick();
  store.selectTerminal('t2');
  await store.closeTerminal('t2');
  const state = store.getSnapshot();
  assert.deepEqual(state.ui.closing, []);
  assert.equal(state.ui.activeTerminal, 't2');
  assert.equal(state.error, 'terminal is not running');
  assert.equal(state.busy, false);
  assert.equal(state.snapshot.terminals.length, 2);
  unsubscribe();
  store.dispose();
});
