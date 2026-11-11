/**
 * Host entry point: wires the plugin-dev service, its Typert Remote contribution,
 * and the `plugin_dev` model tool. All sandbox behaviour lives in ./service.js and
 * ./manager.js; this file only registers them with the DSH runtime.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { ACTIONS, hostContribution } from './contract.js';
import { createSandboxManager } from './manager.js';
import { PluginDevService } from './service.js';
import { registerDerivedPreset } from './preset.js';

export { PluginDevService, assertOwnerInvocation, sessionInput } from './service.js';

export const name = 'dsh-plugin-dev-sandbox';
export const inject = ['typert', 'sessionController', 'tools', 'sandboxPolicy'];

export function apply(ctx) {
  const manager = createSandboxManager({ subprocess: ctx.get('subprocess') });
  const service = new PluginDevService(ctx, manager);
  ctx.effect(() => ctx.typert.register(hostContribution), 'plugin-dev.typert');
  registerDerivedPreset(ctx);
  ctx.on('dispose', () => manager.dispose());
  ctx.tools.register(defineTool({
    name: 'plugin_dev',
    description: 'Bind this session to a plugin directory inside its original workspace, inspect its package scripts, start/stop its isolated DSH instance, or run a script. Binding is stored in .dsh/plugin-dev/<session>/binding.json. UI and tool share the same operations. This isolates profiles, NOT untrusted code; mutations require danger-full-access or approval. Read status to collect bounded output and exit codes. Never bind or control another session.',
    parameters: {
      action: { type: 'string', enum: ACTIONS, required: true, description: 'status, bind, launch, run, stop, unbind, terminal*, or models.' },
      pluginPath: { type: 'string', description: 'bind only: workspace-relative plugin directory containing package.json.' },
      commandId: { type: 'string', description: 'run only: exact package.json script id returned by status.' },
      terminalId: { type: 'string', description: 'terminal operations: id from snapshot.terminals.' },
      data: { type: 'string', description: 'terminalWrite: text to send to the PTY.' },
      selectedModels: { type: 'string', description: 'saveModels only: JSON array of {provider, model} to make available in the sandbox.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('plugin_dev requires a session agent');
      if (!['status', 'models'].includes(args.action)) {
        const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
        await approveEscalation({
          requestedMode: 'danger-full-access', effectiveMode: policy.mode,
          subject: 'plugin development sandbox',
          justification: `plugin_dev ${JSON.stringify(args)}. Local plugin scripts and Host modules run outside the file sandbox.`,
        }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: 'plugin_dev', signal: exec.signal });
      }
      exec.signal.throwIfAborted();
      const request = { ...args, sessionId: exec.agent.session.id };
      if (typeof request.selectedModels === 'string') {
        try { request.selectedModels = JSON.parse(request.selectedModels); }
        catch { throw new Error('selectedModels must be a JSON array of {provider, model}'); }
      }
      return JSON.stringify(await service.dispatch(request));
    },
  }));
}
