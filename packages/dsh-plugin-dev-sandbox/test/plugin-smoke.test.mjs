import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { createSandboxManager } from '../src/host.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sessionId = `smoke-${process.pid}-${Date.now().toString(36)}`;
const workspaceRoot = packageRoot;
const manager = createSandboxManager({ stopTimeoutMs: 1500 });
const input = { workspaceRoot, sessionId };
const sessionRoot = path.join(workspaceRoot, '.dsh', 'plugin-dev', sessionId);

async function until(read, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  assert.fail(`condition not reached within ${timeoutMs}ms: ${JSON.stringify(value)}`);
}

function makeClientContext() {
  const cleanup = [];
  const seats = [];
  const mounted = [];
  const typeDefinitions = [];
  const opened = [];
  const requests = [];
  const snapshot = {
    binding: { sessionId, pluginPath: packageRoot, name: 'dsh-plugin-dev-sandbox' },
    commands: [],
    runtime: { state: 'stopped', pid: null, url: null, error: null, exitCode: null, dshHome: path.join(sessionRoot, 'runtime') },
    command: { state: 'idle', id: null, pid: null, exitCode: null, error: null },
    logs: [],
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState: (initial) => [initial, () => {}],
  };
  const ctx = {
    remote: {
      $mount: async (info) => { mounted.push(info); return () => {}; },
      pluginDev: { execute: async (request) => { requests.push(request); return { ok: true, value: snapshot }; } },
    },
    effect: (effect) => { const disposer = effect(); if (typeof disposer === 'function') cleanup.push(disposer); },
    sidebarRightTabs: { register: (definition) => { typeDefinitions.push(definition); return () => {}; } },
    sidebarRight: { openTab: (...args) => opened.push(args) },
    slots: {
      inject: (_name, register) => register(),
      register: (definition, component) => { seats.push({ definition, component }); return () => {}; },
    },
  };
  return { ctx, cleanup, seats, mounted, typeDefinitions, opened, requests, snapshot, React };
}

const enabled = process.env.DSH_SANDBOX_PLUGIN_SMOKE === '1';
test('real package DSH smoke loads Host/client and mounts the session Remote UI', { skip: !enabled }, async (t) => {
  t.after(async () => {
    await manager.dispose();
    await rm(sessionRoot, { recursive: true, force: true });
  });

  await manager.bind({ ...input, pluginPath: packageRoot });
  await manager.launch(input);
  const ready = await until(() => manager.status(input), (state) => state.runtime.url || ['error', 'exited'].includes(state.runtime.state));
  const logs = ready.logs.map((line) => line.text).join('');
  assert.equal(ready.runtime.state, 'running', logs);
  assert.ok(ready.runtime.url, logs);
  assert.doesNotMatch(logs, /entry did not activate|failed to activate/i);

  const login = await fetch(ready.runtime.url, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const page = await fetch(new URL(login.headers.get('location') || '/', ready.runtime.url), { headers: { cookie } });
  const html = await page.text();
  assert.equal(page.status, 200, html);
  const bootJson = html.match(/globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootJson, 'real DSH must inject its boot payload');
  const boot = JSON.parse(bootJson);
  const entry = boot.entries.find((item) => item.id === 'dsh-plugin-dev-sandbox');
  assert.ok(entry, 'the current package must expose its client entry in the real boot manifest');
  const clientResponse = await fetch(new URL(entry.url, ready.runtime.url), { headers: { cookie } });
  assert.equal(clientResponse.status, 200);
  const registrations = [];
  runInNewContext(await clientResponse.text(), {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
    setInterval: () => 1,
    clearInterval: () => {},
  }, { timeout: 1000 });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'dsh-plugin-dev-sandbox');

  const harness = makeClientContext();
  const plugin = registrations[0].factory((name) => {
    assert.equal(name, 'react');
    return harness.React;
  });
  await plugin.apply(harness.ctx);
  assert.equal(harness.mounted.length, 1);
  assert.equal(harness.mounted[0].package, 'dsh-plugin-dev-sandbox');
  assert.ok(harness.mounted[0].descriptors.some((descriptor) => descriptor.id.endsWith('#pluginDev/execute')));
  assert.deepEqual(harness.typeDefinitions.map(({ kind }) => kind), ['plugin-sandbox']);
  assert.deepEqual(harness.seats.map(({ definition }) => definition.name), [
    'conversation.session.header.utilities', 'sidebar.right.pane.tab',
  ]);

  const entrySeat = harness.seats[0];
  const entryProps = entrySeat.definition.inject(sessionId);
  const unsubscribe = entryProps.store.subscribe(() => {});
  await until(async () => entryProps.store.getSnapshot().snapshot?.binding, Boolean, 1000);
  assert.equal(harness.requests[0].sessionId, sessionId);
  assert.equal(harness.requests[0].action, 'status');
  const entryElement = entrySeat.component(entryProps);
  assert.equal(entryElement.type, 'button');
  entryElement.props.onClick();
  assert.deepEqual(harness.opened, [['plugin-sandbox']]);
  unsubscribe();
  entryProps.store.dispose();

  for (const dispose of harness.cleanup.reverse()) dispose();
  const hostLog = ready.logs.filter((line) => /dsh-plugin-dev-sandbox|pluginDev|Typert/i.test(line.text)).map((line) => line.text.slice(0, 500)).join(' | ');
  t.diagnostic(`Host startup log: ${hostLog || '(no matching application log emitted)'}; page HTTP ${page.status}; client HTTP ${clientResponse.status}; Remote mount, descriptor, and session-scoped UI seats verified`);
});
