import path from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { createSandboxManager } from './host.js';
import { ACTIONS, hostContribution, requestSchema } from './remote.js';

export const name = 'dsh-plugin-dev-sandbox';
export const inject = ['typert', 'sessionController', 'tools', 'sandboxPolicy'];

/** Workspace authority always comes from the Host's existing session, never the wire. */
export async function sessionInput(ctx, sessionId) {
  const resolved = await ctx.sessionController.resolveAgent(sessionId);
  if (!resolved || typeof resolved !== 'object') throw new Error('Session not found');
  if ('error' in resolved) throw new Error(resolved.error?.message || 'Session not found');
  const agent = 'session' in resolved ? resolved : resolved.agent;
  if (!agent?.session) throw new Error('Session not found');
  const { session } = agent;
  if (session.id !== sessionId) throw new Error('Session identity mismatch');
  const workspaceRoot = session.header.cwd;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new Error('Session has no absolute original workspace');
  }
  return { workspaceRoot, sessionId };
}

export function assertOwnerInvocation(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== 'owner' || principalOf(invocation)) {
    throw new RemoteError('plugin-dev/owner-required', 'Only the owner can access plugin sandboxes.', {});
  }
}

export class PluginDevService extends Service {
  constructor(ctx, manager) {
    super(ctx, 'pluginDev');
    this.manager = manager;
    this.typertRemote = bindTypertRemote(this, 'pluginDev');
    for (const initialize of remoteInitializers) initialize.call(this);
  }

  // Called by both the Remote adapter and the model tool; all semantics live here.
  async dispatch(request) {
    const parsed = requestSchema.parse(request);
    const input = await sessionInput(this.ctx, parsed.sessionId);
    if (parsed.action === 'bind' && !parsed.pluginPath) throw new Error('pluginPath is required for bind');
    if (parsed.action === 'run' && !parsed.commandId) throw new Error('commandId is required for run');
    return this.manager[parsed.action]({ ...input, pluginPath: parsed.pluginPath, commandId: parsed.commandId });
  }

  async execute(request) {
    // Gateway scopes Cordis services with the current invocation. Missing context
    // is denied by default so a broken adapter cannot grant owner privileges.
    assertOwnerInvocation(this.ctx?.invocation);
    try { return await this.dispatch(request); }
    catch (error) { throw new RemoteError('plugin-dev/operation-failed', error.message, {}); }
  }
}
// Apply the public standard-decorator API in plain JavaScript (not private markers).
const remoteInitializers = [];
Remote('execute')(PluginDevService.prototype.execute, {
  kind: 'method', name: 'execute', static: false, private: false,
  addInitializer(initialize) { remoteInitializers.push(initialize); },
});

export function apply(ctx) {
  const manager = createSandboxManager();
  const service = new PluginDevService(ctx, manager);
  ctx.effect(() => ctx.typert.register(hostContribution), 'plugin-dev.typert');
  ctx.on('dispose', () => manager.dispose());
  ctx.tools.register(defineTool({
    name: 'plugin_dev',
    description: 'Bind this session to a plugin directory inside its original workspace, inspect its package scripts, start/stop its isolated DSH instance, or run a script. Binding is stored in .dsh/plugin-dev/<session>/binding.json. UI and tool share the same operations. This isolates profiles, NOT untrusted code; mutations require danger-full-access or approval. Read status to collect bounded output and exit codes. Never bind or control another session.',
    parameters: {
      action: { type: 'string', enum: ACTIONS, required: true, description: 'status, bind, launch, run, stop, or unbind.' },
      pluginPath: { type: 'string', description: 'bind only: workspace-relative plugin directory containing package.json.' },
      commandId: { type: 'string', description: 'run only: exact package.json script id returned by status.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('plugin_dev requires a session agent');
      if (args.action !== 'status') {
        const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
        await approveEscalation({
          requestedMode: 'danger-full-access', effectiveMode: policy.mode,
          subject: 'plugin development sandbox',
          justification: `plugin_dev ${JSON.stringify(args)}. Local plugin scripts and Host modules run outside the file sandbox.`,
        }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: 'plugin_dev', signal: exec.signal });
      }
      exec.signal.throwIfAborted();
      return JSON.stringify(await service.dispatch({ ...args, sessionId: exec.agent.session.id }));
    },
  }));
}
