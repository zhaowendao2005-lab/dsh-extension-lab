/**
 * The single dispatch point for every Remote action (AGENTS.md → backend/service.js).
 * Validates the envelope, validates the per-action payload, resolves the root,
 * binds the request-local workspace/repository context, then hands off to its owner.
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
    this.watchOwners = new Map();
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

    if (parsed.repositoryPath !== undefined && group !== 'git' && group !== 'watch') {
      throw ideError('E_INVALID_ARG', 'repositoryPath 仅适用于 git/watch', { field: 'repositoryPath' });
    }
    if (group === 'workspace') {
      return await this.workspaceAction(parsed.action, payload, parsed.sessionId);
    }

    // Stop owns an existing resource, not the session's current root. It must also
    // release a token whose start completed after a root switch or root deletion.
    if (parsed.action === 'watch.stop') {
      const known = this.watchOwners.get(payload.token);
      if (!known) return { stopped: true };
      if (known.sessionId !== (parsed.sessionId ?? null) || known.repositoryPath !== (parsed.repositoryPath ?? null)) {
        throw ideError('E_INVALID_ARG', '监听令牌不属于原会话或仓库', { field: 'token' });
      }
      const result = await this.workspace.run(known, () => this.watchAction(parsed.action, payload));
      this.watchOwners.delete(payload.token);
      return result;
    }

    // Every resource action runs inside the session's immutable root context. Without this,
    // two sessions interleaving awaits would read/write through one shared `current` root.
    const context = await this.workspace.contextFor(parsed.sessionId);
    return await this.workspace.run(context, async () => {
      const owner = group === 'watch' ? { root: this.workspace.requireRoot(), sessionId: parsed.sessionId ?? null, repositoryPath: parsed.repositoryPath ?? null } : null;
      if (parsed.action === 'watch.poll') {
        const known = this.watchOwners.get(payload.token);
        if (!known) throw ideError('E_LIMIT', '监听令牌已失效', { field: 'token' });
        if (known.root !== owner.root || known.sessionId !== owner.sessionId || known.repositoryPath !== owner.repositoryPath) {
          throw ideError('E_INVALID_ARG', '监听令牌不属于当前工作区或仓库', { field: 'token' });
        }
      }
      const dispatch = () => this.dispatchResource(group, parsed.action, payload);
      const result = parsed.repositoryPath === undefined ? await dispatch()
        : await this.workspace.run(await this.workspace.repositoryContext(context, parsed.repositoryPath), dispatch);
      if (group === 'watch' && parsed.action === 'watch.start' && result.token) {
        this.watchOwners.set(result.token, owner);
        // createWatcher retains four tokens and evicts the oldest in the same order.
        while (this.watchOwners.size > 4) this.watchOwners.delete(this.watchOwners.keys().next().value);
      }
      return result;
    });
  }

  async dispatchResource(group, action, payload) {
    switch (group) {
      case 'files':
        return await this.files.dispatch(action, payload);
      case 'git':
        return await this.git.dispatch(action, payload);
      case 'terminal': {
        const handler = this.terminals[action.split('.')[1]];
        if (typeof handler !== 'function') throw ideError('E_UNSUPPORTED', `未知动作 ${action}`, {});
        return await handler.call(this.terminals, payload);
      }
      case 'watch':
        return await this.watchAction(action, payload);
      default:
        throw ideError('E_UNSUPPORTED', `未知分组 ${group}`, { action });
    }
  }

  async workspaceAction(action, payload, sessionId) {
    switch (action) {
      case 'workspace.resolve':
        return await this.workspace.resolve({ sessionId });
      case 'workspace.open':
        return await this.workspace.open({ ...payload, sessionId });
      case 'workspace.state': {
        const context = await this.workspace.contextFor(sessionId);
        return await this.workspace.run(context, () => this.workspace.state(sessionId));
      }
      case 'workspace.scan':
      case 'workspace.packageScripts': {
        const context = await this.workspace.contextFor(sessionId);
        return await this.workspace.run(context, () => action === 'workspace.scan'
          ? this.workspace.scan() : this.workspace.packageScripts(payload));
      }
      case 'workspace.useSessionRoot':
        return await this.workspace.useSessionRoot({ sessionId });
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
    this.watchOwners.clear();
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
