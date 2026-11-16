import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { inspectCli, startAgyRuntime, runtimeEnvironment } from '../src/runtime/index.js';
import { createIsolation, removeIsolation } from '../src/runtime/isolation.js';

const gateway = { endpoint: 'http://127.0.0.1:9/gateway-token' };

const tick = () => new Promise((resolve) => setImmediate(resolve));
const bridge = { url: 'http://127.0.0.1:54321/mcp', token: 'x'.repeat(43), toolNames: ['dsh_echo'] };
const encode = (message) => `${JSON.stringify(message)}\n`;

async function fakeExecutable(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-acp-unit-')));
  const executable = path.join(root, 'agy-fake');
  const content = 'This is a test fixture, never an executable command.\n';
  await fs.writeFile(executable, content, { mode: 0o600 });
  t.after(async () => {
    assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('dsh-acp-unit-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { path: executable, sha256: createHash('sha256').update(content).digest('hex'), version: '1.5.9' };
}

function fakeSubprocess(cli, options = {}) {
  const calls = [];
  let processHandle;
  const service = {
    calls,
    get handle() { return processHandle; },
    async resolveExecutable(name, env, signal) {
      calls.push({ kind: 'resolve', name, env, signal });
      return cli.path;
    },
    spawn(spec) {
      calls.push({ kind: 'spawn', spec });
      if (spec.argv[1] === '--version') {
        const handle = {
          done: Promise.resolve(options.versionOutcome || { exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: options.versionText ?? '1.5.9\n', nextOffset: 6, lossy: options.versionLossy ?? false }) } },
          terminate() { calls.push({ kind: 'version-terminate' }); },
          async waitForExit() { calls.push({ kind: 'version-wait' }); return true; },
        };
        return handle;
      }
      options.onRuntimeSpawn?.(spec);
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const received = [];
      const waiting = new Set();
      const replies = new Map();
      let serverId = 0;
      let data = '';
      let empty = false;
      let directExited = false;
      let resolveDone;
      const done = new Promise((resolve) => { resolveDone = resolve; });
      const handle = {
        stdout, stderr, done, collected: {}, received,
        stdin: new Writable({
          write(chunk, _encoding, callback) {
            data += chunk.toString('utf8');
            for (;;) {
              const newline = data.indexOf('\n');
              if (newline < 0) break;
              const message = JSON.parse(data.slice(0, newline));
              data = data.slice(newline + 1);
              received.push(message);
              if (message.method === 'initialize' && options.autoInitialize !== false) queueMicrotask(() => stdout.write(encode({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: options.protocolVersion ?? 1, agentCapabilities: {} } })));
              else if (!message.method && replies.has(message.id)) { replies.get(message.id)(message); replies.delete(message.id); }
            }
            callback();
          },
          final(callback) {
            if (options.directExitOnEnd) { directExited = true; resolveDone({ exitCode: 0, signal: null }); }
            if (options.exitOnEnd !== false) handle.exit();
            callback();
          },
        }),
        exit() {
          if (empty) return;
          empty = true;
          if (!directExited) resolveDone({ exitCode: 0, signal: null });
          for (const finish of [...waiting]) finish(true);
          stdout.end();
          stderr.end();
        },
        terminate() {
          calls.push({ kind: 'runtime-terminate' });
          if (options.exitOnTerminate !== false) handle.exit();
        },
        waitForExit(signal) {
          calls.push({ kind: 'runtime-wait' });
          if (options.exitUnverified) return Promise.reject(new Error('managed owner unavailable'));
          if (empty) return Promise.resolve(true);
          if (options.firstWaitFalse && !calls.some((call) => call.kind === 'runtime-terminate')) return Promise.resolve(false);
          return new Promise((resolve, reject) => {
            const finish = (value) => { waiting.delete(finish); signal?.removeEventListener('abort', onAbort); resolve(value); };
            const onAbort = () => { waiting.delete(finish); const error = new Error('wait aborted'); error.name = 'AbortError'; reject(error); };
            waiting.add(finish);
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
          });
        },
        serverRequest(method, params = {}) {
          const id = `server-${++serverId}`;
          const result = new Promise((resolve) => replies.set(id, resolve));
          stdout.write(encode({ jsonrpc: '2.0', id, method, params }));
          return result;
        },
        update(params) { stdout.write(encode({ jsonrpc: '2.0', method: 'session/update', params })); },
      };
      processHandle = handle;
      return handle;
    },
  };
  return service;
}

test('preflight uses managed --version and returns exact version plus SHA-256', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  assert.deepEqual(await inspectCli({ subprocess }), cli);
  const spawn = subprocess.calls.find((call) => call.kind === 'spawn').spec;
  assert.deepEqual(spawn.argv, [cli.path, '--version']);
  assert.equal(spawn.stdio.stdin, 'ignore');
  assert.deepEqual(spawn.stdio.stdout, { maxBytes: 4096 });
  assert.ok(subprocess.calls.some((call) => call.kind === 'version-wait'));
});

for (const [name, options, code] of [
  ['newer version', { versionText: '1.5.10' }, 'ACP_CLI_VERSION_UNSUPPORTED'],
  ['older version', { versionText: '1.5.8' }, 'ACP_CLI_VERSION_UNSUPPORTED'],
  ['ambiguous banner', { versionText: '1.5.9\nother text' }, 'ACP_CLI_VERSION_UNSUPPORTED'],
  ['truncated output', { versionLossy: true }, 'ACP_CLI_PREFLIGHT_FAILED'],
  ['failed version command', { versionOutcome: { exitCode: 1, signal: null } }, 'ACP_CLI_PREFLIGHT_FAILED'],
]) {
  test(`preflight rejects ${name} after managed cleanup`, async (t) => {
    const cli = await fakeExecutable(t);
    const subprocess = fakeSubprocess(cli, options);
    await assert.rejects(inspectCli({ subprocess }), { code });
    assert.ok(subprocess.calls.some((call) => call.kind === 'version-wait'));
    assert.equal(subprocess.calls.filter((call) => call.kind === 'spawn').length, 1);
  });
}

test('environment preserves HOME while removing credentials and alternate routing', () => {
  const env = runtimeEnvironment({ parent: { HOME: '/test-home', PATH: '/bin', LANG: 'zh_CN.UTF-8', USER: 'test', API_KEY: 'secret', GOOGLE_APPLICATION_CREDENTIALS: '/credential', GEMINI_API_KEY: 'secret', ANTHROPIC_AUTH_TOKEN: 'secret', HTTPS_PROXY: 'https://secret@proxy', DSH_PROFILE_DIR: '/profile', GEMINI_DIR: '/production-config', NODE_OPTIONS: '--require=bad' }, temporaryDirectory: '/private-temp' });
  assert.equal(env.HOME, '/test-home');
  assert.equal(env.PATH, '/bin');
  for (const key of ['API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'HTTPS_PROXY', 'DSH_PROFILE_DIR', 'GEMINI_DIR', 'NODE_OPTIONS']) {
    assert.ok(Object.hasOwn(env, key));
    assert.equal(env[key], undefined);
  }
  assert.equal(env.TMPDIR, '/private-temp');
});

test('profile files are private and complete before spawn; initialization sends no prompt', async (t) => {
  const cli = await fakeExecutable(t);
  let observedRoot;
  const subprocess = fakeSubprocess(cli, { onRuntimeSpawn(spec) {
    const gemini = spec.argv[spec.argv.indexOf('--gemini-dir') + 1];
    observedRoot = path.dirname(gemini);
    const agent = readFileSync(path.join(gemini, 'config/agents/dsh-model/agent.md'), 'utf8');
    assert.match(agent, /excludeDefaultComponents: true/);
    assert.match(agent, /^tools: null$/m);
    assert.match(agent, /DSH system fixture/);
    const mcp = JSON.parse(readFileSync(path.join(gemini, 'config/mcp_config.json'), 'utf8'));
    assert.equal(mcp.mcpServers['dsh-bridge'].headers.Authorization, `Bearer ${bridge.token}`);
    assert.deepEqual(mcp.mcpServers['dsh-bridge'].tools, { dsh_echo: { eager: true } });
    assert.equal(mcp.mcpServers['dsh-bridge'].timeoutSeconds, 600);
    const settings = JSON.parse(readFileSync(path.join(gemini, 'dsh-acp/settings.json'), 'utf8'));
    assert.equal(settings.toolPermission, 'strict');
    for (const dir of [observedRoot, spec.cwd, gemini, path.join(gemini, 'config'), path.join(gemini, 'config/agents/dsh-model'), path.join(gemini, 'dsh-acp')]) assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const file of [path.join(observedRoot, 'owner.json'), path.join(gemini, 'config/mcp_config.json'), path.join(gemini, 'config/agents/dsh-model/agent.md'), path.join(gemini, 'dsh-acp/settings.json')]) assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(spec.argv[spec.argv.indexOf('--cloud_code_endpoint') + 1], gateway.endpoint);
    assert.ok(!spec.argv.includes('--log-file'));
    assert.ok(!spec.argv.includes('authenticate'));
    assert.equal(spec.argv[spec.argv.indexOf('--app-data-dir') + 1], 'dsh-acp');
  } });
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge, systemPrompt: 'DSH system fixture' });
  assert.equal(runtime.isolation.certificate, false);
  assert.equal(runtime.isolation.root, observedRoot);
  assert.deepEqual(await fs.readdir(runtime.isolation.cwd), []);
  assert.equal(runtime.initializeResult.protocolVersion, 1);
  assert.deepEqual(subprocess.handle.received[0].params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  assert.deepEqual(subprocess.handle.received.map((message) => message.method), ['initialize']);
  await runtime.close();
  await assert.rejects(fs.stat(observedRoot), { code: 'ENOENT' });
});

test('a missing or non-loopback sanitizing gateway is refused before spawn', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  await assert.rejects(startAgyRuntime({ subprocess, cli, bridge }), /sanitizing gateway/);
  await assert.rejects(startAgyRuntime({ gateway: { endpoint: 'https://example.com/gateway-token' }, subprocess, cli, bridge }), /sanitizing gateway/);
  await assert.rejects(startAgyRuntime({ gateway: { endpoint: 'http://127.0.0.1:9' }, subprocess, cli, bridge }), /sanitizing gateway/);
  assert.equal(subprocess.calls.filter((call) => call.kind === 'spawn').length, 0);
});

for (const [bridgeTimeoutMs, timeoutSeconds] of [[60_001, 61], [1_800_000, 1800]]) {
  test(`MCP bridge deadline ${bridgeTimeoutMs}ms is written before spawn without shortening it`, async (t) => {
    const cli = await fakeExecutable(t);
    const subprocess = fakeSubprocess(cli, { onRuntimeSpawn(spec) {
      const gemini = spec.argv[spec.argv.indexOf('--gemini-dir') + 1];
      const mcp = JSON.parse(readFileSync(path.join(gemini, 'config/mcp_config.json'), 'utf8'));
      assert.equal(mcp.mcpServers['dsh-bridge'].timeoutSeconds, timeoutSeconds);
    } });
    const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge, bridgeTimeoutMs });
    await runtime.close();
  });
}

for (const bridgeTimeoutMs of [0, -1, 1.5, Number.NaN, 1_800_001, '600000']) {
  test(`invalid MCP bridge deadline ${String(bridgeTimeoutMs)} is rejected without a runtime spawn`, async (t) => {
    const cli = await fakeExecutable(t);
    const subprocess = fakeSubprocess(cli);
    await assert.rejects(startAgyRuntime({ gateway, subprocess, cli, bridge, bridgeTimeoutMs }), /bridgeTimeoutMs/);
    assert.equal(subprocess.calls.filter((call) => call.kind === 'spawn').length, 0);
  });
}

test('permission defaults to cancelled and native callbacks are never exposed', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge });
  const options = [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }];
  const denied = await subprocess.handle.serverRequest('session/request_permission', { options, toolCall: { title: 'read_file' } });
  assert.deepEqual(denied.result, { outcome: { outcome: 'cancelled' } });
  for (const method of ['fs/read_text_file', 'fs/write_text_file', 'terminal/create', 'terminal/output', 'terminal/release']) {
    assert.equal((await subprocess.handle.serverRequest(method)).error.code, -32601);
  }
  await runtime.close();
});

test('permission callback may choose only a present once option; updates retain session identity', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  const updates = [];
  let choice = 'yes';
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge, onUpdate: (params) => updates.push(params), onPermission: () => ({ outcome: { outcome: 'selected', optionId: choice } }) });
  const params = { options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'allow_always', optionId: 'always' }], toolCall: { toolCallId: 't1' } };
  assert.deepEqual((await subprocess.handle.serverRequest('session/request_permission', params)).result, { outcome: { outcome: 'selected', optionId: 'yes' } });
  choice = 'always';
  assert.deepEqual((await subprocess.handle.serverRequest('session/request_permission', params)).result, { outcome: { outcome: 'cancelled' } });
  choice = 'foreign';
  assert.deepEqual((await subprocess.handle.serverRequest('session/request_permission', params)).result, { outcome: { outcome: 'cancelled' } });
  const update = { sessionId: 's-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'test' } } };
  subprocess.handle.update(update);
  assert.deepEqual(updates, [update]);
  await runtime.close();
});

test('default-agent fallback closes an active connection and rejects its pending prompt', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge });
  const pending = runtime.connection.request('session/prompt', {}, { timeoutMs: 1000 });
  const rejected = assert.rejects(pending, { code: 'ACP_DEFAULT_AGENT_FALLBACK' });
  subprocess.handle.stderr.write('Agent "dsh-model" not found, falling ');
  subprocess.handle.stderr.write('back to default\n');
  await rejected;
  assert.equal((await runtime.connection.closed).error.code, 'ACP_DEFAULT_AGENT_FALLBACK');
  await runtime.close();
  await assert.rejects(fs.stat(runtime.isolation.root), { code: 'ENOENT' });
});

test('CLI fingerprint replacement prevents spawning any ACP process', async (t) => {
  const cli = await fakeExecutable(t);
  await fs.writeFile(cli.path, 'replacement fixture');
  const subprocess = fakeSubprocess(cli);
  await assert.rejects(startAgyRuntime({ gateway, subprocess, cli, bridge }), { code: 'ACP_CLI_CHANGED' });
  assert.equal(subprocess.calls.length, 0);
});

test('unsupported ACP initialization is closed and its isolation removed', async (t) => {
  const cli = await fakeExecutable(t);
  let root;
  const subprocess = fakeSubprocess(cli, { protocolVersion: 2, onRuntimeSpawn: (spec) => { root = path.dirname(spec.cwd); } });
  await assert.rejects(startAgyRuntime({ gateway, subprocess, cli, bridge }), { code: 'ACP_PROTOCOL_VERSION_UNSUPPORTED' });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('a direct command exit is insufficient for deleting its managed profile', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli, { directExitOnEnd: true, exitOnEnd: false });
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge });
  const closing = runtime.close();
  await tick();
  assert.ok((await fs.stat(runtime.isolation.root)).isDirectory());
  assert.ok(!subprocess.calls.some((call) => call.kind === 'runtime-terminate'));
  subprocess.handle.exit();
  await closing;
  await assert.rejects(fs.stat(runtime.isolation.root), { code: 'ENOENT' });
});

test('managed termination is used when the graceful exit tier reports a live range', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli, { exitOnEnd: false, firstWaitFalse: true });
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge });
  await runtime.close();
  assert.ok(subprocess.calls.some((call) => call.kind === 'runtime-terminate'));
  assert.equal(subprocess.calls.filter((call) => call.kind === 'runtime-wait').length, 2);
});

test('unprovable managed exit retains the owned profile and makes close reject', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli, { exitUnverified: true });
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge });
  await assert.rejects(runtime.close(), { code: 'ACP_EXIT_UNVERIFIED' });
  assert.ok((await fs.stat(runtime.isolation.root)).isDirectory());
  // The fake handle is genuinely empty after terminate; the production API retained it.
  await removeIsolation(runtime.isolation, { exited: true });
});

test('cancellation closes the connection and cleans only after managed exit', async (t) => {
  const cli = await fakeExecutable(t);
  const subprocess = fakeSubprocess(cli);
  const controller = new AbortController();
  const runtime = await startAgyRuntime({ gateway, subprocess, cli, bridge, signal: controller.signal });
  const pending = runtime.connection.request('session/prompt', {});
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  await runtime.close();
  await assert.rejects(fs.stat(runtime.isolation.root), { code: 'ENOENT' });
});

for (const toolDeclaration of ['null', 'omitted', '[]']) {
  test(`candidate tool declaration ${toolDeclaration} remains explicit and uncertified`, async () => {
    const isolation = await createIsolation({ bridge, toolDeclaration });
    const agent = await fs.readFile(path.join(isolation.geminiDir, 'config/agents/dsh-model/agent.md'), 'utf8');
    if (toolDeclaration === 'omitted') assert.doesNotMatch(agent, /^tools:/m);
    else assert.ok(agent.includes(`tools: ${toolDeclaration}\n`));
    assert.equal(isolation.certificate, false);
    await assert.rejects(removeIsolation(isolation), /before managed process exit/);
    await removeIsolation(isolation, { exited: true });
  });
}

test('isolation cleanup rejects unowned, linked, or modified owner paths', async () => {
  await assert.rejects(removeIsolation({ root: '/tmp/foreign' }, { exited: true }), /unowned/);
  const isolation = await createIsolation({ bridge });
  const marker = path.join(isolation.root, 'owner.json');
  const original = await fs.readFile(marker, 'utf8');
  await fs.writeFile(marker, '{}');
  await assert.rejects(removeIsolation(isolation, { exited: true }), /marker changed/);
  await fs.writeFile(marker, original);
  await removeIsolation(isolation, { exited: true });
});

for (const badBridge of [
  { ...bridge, url: 'https://example.com/mcp' },
  { ...bridge, url: 'http://localhost:1234/mcp' },
  { ...bridge, token: 'short' },
  { ...bridge, toolNames: ['duplicate', 'duplicate'] },
  { ...bridge, toolNames: ['invalid.name'] },
]) {
  test('invalid bridge configuration is rejected before creating a profile', async () => {
    await assert.rejects(createIsolation({ bridge: badBridge }), TypeError);
  });
}
