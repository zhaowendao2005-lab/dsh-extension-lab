/**
 * The single dispatch point for every Remote action (AGENTS.md → backend/service.js).
 * Validates the envelope, validates the per-action payload, resolves the root,
 * applies the trust gate, then hands off to the owning module.
 */
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, principalOf, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { payloadSchemas, requestSchema } from './contract.js';
import { createStore } from './store.js';
import { createTerminals } from './terminal.js';
import { createWorkspace } from './workspace.js';
import { createFiles } from './files.js';
import { createGit } from './git/index.js';
import { ideError, toWireError } from '../shared/errors.js';

export class WorkspaceIdeService extends Service {
  constructor(ctx) {
    super(ctx, 'workspaceIde');
    this.typertRemote = bindTypertRemote(this, 'workspaceIde');
    this.store = createStore(ctx);
    this.workspace = createWorkspace(ctx, this.store);
    this.terminals = createTerminals(ctx, this.workspace);
    this.files = createFiles(ctx, this.workspace);
    this.git = createGit(ctx, this.workspace);
    this.ready = this.store.ready();
  }

  /** @param {{sessionId?: string, action: string, payload?: Record<string, unknown>}} request */
  async execute(request) {
    if (principalOf(this.ctx?.invocation)) {
      throw new RemoteError('workspace-ide/owner-required', 'Only the owner can drive the workspace panel.', {});
    }
    let parsed;
    try {
      parsed = requestSchema.parse(request);
    } catch (error) {
      return { ok: false, error: toWireError(invalidArg(error)) };
    }
    try {
      await this.ready;
      const data = await this.dispatch(parsed);
      return { ok: true, data };
    } catch (error) {
      if (error?.code === 'E_CANCELLED') return { ok: false, error: toWireError(error) };
      return { ok: false, error: toWireError(error) };
    }
  }

  async dispatch(parsed) {
    const [group] = parsed.action.split('.');
    const schema = payloadSchemas[parsed.action];
    if (!schema) throw ideError('E_UNSUPPORTED', `未知动作 ${parsed.action}`, { action: parsed.action });

    let payload;
    try {
      payload = schema.parse(parsed.payload ?? {});
    } catch (error) {
      throw invalidArg(error, parsed.action);
    }

    switch (group) {
      case 'workspace':
        return await this.workspaceAction(parsed.action, payload, parsed.sessionId);
      case 'files':
        return await this.files.dispatch(parsed.action, payload);
      case 'git':
        return await this.git.dispatch(parsed.action, payload);
      case 'terminal': {
        const handler = this.terminals[parsed.action.split('.')[1]];
        if (typeof handler !== 'function') throw ideError('E_UNSUPPORTED', `未知动作 ${parsed.action}`, {});
        return await handler.call(this.terminals, payload);
      }
      case 'watch':
        return await this.watchAction(parsed.action, payload);
      default:
        throw ideError('E_UNSUPPORTED', `未知分组 ${group}`, { action: parsed.action });
    }
  }

  async workspaceAction(action, payload, sessionId) {
    switch (action) {
      case 'workspace.resolve':
        return await this.workspace.resolve({ sessionId });
      case 'workspace.open':
        return await this.workspace.open(payload);
      case 'workspace.state':
        return await this.workspace.state();
      case 'workspace.trust':
        return await this.workspace.setTrusted(payload);
      default:
        throw ideError('E_UNSUPPORTED', `未知动作 ${action}`, {});
    }
  }

  async watchAction(action, payload) {
    if (action === 'watch.start') return await this.git.watch.start(payload);
    if (action === 'watch.poll') return await this.git.watch.poll(payload);
    if (action === 'watch.stop') return await this.git.watch.stop(payload);
    throw ideError('E_UNSUPPORTED', `未知动作 ${action}`, {});
  }

  /** Plugin teardown: no PTY, watcher or timer may survive it. */
  async dispose() {
    await Promise.allSettled([this.terminals.dispose(), this.git.dispose()]);
    this.store.close();
  }
}

function invalidArg(error, action) {
  const issue = Array.isArray(error?.issues) ? error.issues[0] : null;
  const field = issue?.path?.join('.') ?? '';
  return ideError('E_INVALID_ARG', issue ? `${field || 'payload'}: ${issue.message}` : '参数不合法', {
    field,
    ...(action ? { action } : {}),
  });
}
