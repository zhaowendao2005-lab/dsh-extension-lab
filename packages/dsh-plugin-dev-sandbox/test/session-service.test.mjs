import test from 'node:test';
import assert from 'node:assert/strict';
import { symbols } from '@deepseek-ai/cordis';
import { assertOwnerInvocation, apply, PluginDevService, sessionInput } from '../src/index.js';
import { hostContribution } from '../src/remote.js';

const sessionId = 'session-123';
const agent = { session: { id: sessionId, header: { cwd: '/workspace/project' } } };

for (const [name, result] of [['live Agent', agent], ['resumed wrapper', { agent }]]) {
  test(`sessionInput accepts ${name} from resolveAgent`, async () => {
    const ctx = { sessionController: { resolveAgent: async () => result } };
    assert.deepEqual(await sessionInput(ctx, sessionId), { workspaceRoot: '/workspace/project', sessionId });
  });
}

test('sessionInput rejects resolver errors, mismatched identity, and invalid workspace paths', async () => {
  const resolver = (result) => ({ sessionController: { resolveAgent: async () => result } });
  await assert.rejects(sessionInput(resolver({ error: new Error('session unavailable') }), sessionId), /session unavailable/);
  await assert.rejects(sessionInput(resolver({ ...agent, session: { ...agent.session, id: 'another-session' } }), sessionId), /identity mismatch/);
  await assert.rejects(sessionInput(resolver({ ...agent, session: { ...agent.session, header: { cwd: 'relative' } } }), sessionId), /absolute original workspace/);
});

test('Remote owner checks use the Cordis-scoped invocation and fail closed', () => {
  const service = Object.create(PluginDevService.prototype);
  const invocation = { peer: { principal: { kind: 'owner' } } };
  // Cordis resolves `this.ctx` through the traceable receiver, so the Gateway's
  // `extend({ invocation }).get(service)` makes the invocation reachable there.
  const receiver = service[symbols.extend]({ ctx: { invocation } });
  assert.equal(receiver.ctx.invocation, invocation);
  assert.doesNotThrow(() => assertOwnerInvocation(receiver.ctx.invocation));
  assert.throws(() => assertOwnerInvocation(undefined), /Only the owner/);
  assert.throws(() => assertOwnerInvocation({ peer: { principal: { kind: 'shared' } } }), /Only the owner/);
});

test('Remote execute dispatches only through an owner-scoped Cordis receiver', async () => {
  const calls = [];
  const ctx = {
    reflect: { provide() {} },
    sessionController: { resolveAgent: async () => agent },
  };
  const manager = { status: async (input) => { calls.push(input); return { binding: null }; } };
  const service = new PluginDevService(ctx, manager);
  const owner = service[symbols.extend]({ ctx: { ...ctx, invocation: { peer: { principal: { kind: 'owner' } } } } });
  assert.deepEqual(await owner.execute({ sessionId, action: 'status' }), { binding: null });
  assert.deepEqual(calls, [{ workspaceRoot: '/workspace/project', sessionId, pluginPath: undefined, commandId: undefined }]);
  const nonOwner = service[symbols.extend]({ ctx: { ...ctx, invocation: { peer: { principal: { kind: 'shared' } } } } });
  await assert.rejects(nonOwner.execute({ sessionId, action: 'status' }), /Only the owner/);
  assert.equal(calls.length, 1);
});

test('Host apply registers its Service, Typert contribution, tool, and disposer', async () => {
  const provided = new Map();
  const effects = [];
  const handlers = [];
  const contributions = [];
  const tools = [];
  const ctx = {
    reflect: { provide: (name, service) => provided.set(name, service) },
    typert: { register: (contribution) => { contributions.push(contribution); return () => effects.push('typert disposed'); } },
    tools: { register: (tool) => tools.push(tool) },
    sandboxPolicy: {},
    effect: (effect) => { const cleanup = effect(); if (cleanup) handlers.push(cleanup); },
    on: (event, callback) => { if (event === 'dispose') handlers.push(callback); },
  };
  apply(ctx);
  assert.ok(provided.get('pluginDev') instanceof PluginDevService);
  assert.deepEqual(contributions, [hostContribution]);
  assert.equal(tools[0].name, 'plugin_dev');
  assert.ok(handlers.length >= 2);
  for (const dispose of handlers) await dispose();
  assert.ok(effects.includes('typert disposed'));
});
