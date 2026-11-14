/**
 * Host entry point: registers the Typert Remote contribution and the service that
 * owns every workspace/files/git/terminal subsystem. No model tool is registered —
 * this plugin is UI-only and must never widen the agent's own capabilities.
 */
import { hostContribution } from './contract.js';
import { WorkspaceIdeService } from './service.js';

export { WorkspaceIdeService } from './service.js';

export const name = 'dsh-workspace-ide';
export const inject = ['typert', 'sessionController'];

export function apply(ctx) {
  const service = new WorkspaceIdeService(ctx);
  ctx.effect(() => ctx.typert.register(hostContribution), 'workspace-ide.typert');
  ctx.on('dispose', () => {
    void service.dispose().catch(() => {});
  });
}
