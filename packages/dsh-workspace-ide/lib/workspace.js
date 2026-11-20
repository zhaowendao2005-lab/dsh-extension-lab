/**
 * Workspace root resolution and request-local repository probing.
 *
 * The root is decided Host-side and is **per request**: the Service binds a session's
 * context before dispatch and runs the action inside AsyncLocalStorage. Files/git/terminal
 * read the active context through these getters, so two sessions can never interleave
 * their roots on one long-lived `current` variable.
 */
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpath, stat } from 'node:fs/promises';
import { LIMITS } from '../shared/contract.js';
import { ideError } from '../shared/errors.js';
import { gitOrThrow, runGit } from './git/exec.js';
import { readPackageScripts, repositoryRoot, scanWorkspace } from './inventory.js';
import { pathInside } from './platform.js';

/** @returns {Promise<{root: string, name: string}>} */
async function canonical(root) {
  const absolute = path.resolve(root);
  let real;
  try {
    real = await realpath(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') throw ideError('E_NOT_DIR', '目录不存在', { path: absolute });
    throw ideError('E_PERMISSION', '目录不可访问', { syscall: error?.code ?? 'realpath' });
  }
  const info = await stat(real);
  if (!info.isDirectory()) throw ideError('E_NOT_DIR', '不是目录', { path: real });
  return { root: real, name: path.basename(real) || real };
}

function nullState(recents) {
  return {
    root: null,
    name: null,
    source: null,
    git: { available: true, isRepo: false },
    recents,
    limits: LIMITS,
  };
}

export function createWorkspace(ctx, store) {
  const storage = new AsyncLocalStorage();
  /** session key -> immutable-ish context {root, name, source, sessionId} */
  const contexts = new Map();
  /** Context used only when a request carries no session (legacy/no-session paths). */
  let fallback = null;
  /** One probe result per root; the previous global cache leaked git data across roots. */
  const probeCache = new Map();

  const keyOf = (sessionId) => (sessionId ? String(sessionId) : '__last__');

  function active() {
    const context = storage.getStore();
    return context === undefined ? fallback : context;
  }

  async function sessionRoot(sessionId) {
    if (!sessionId) return null;
    const resolved = await ctx.sessionController.resolveAgent(sessionId);
    if (!resolved || typeof resolved !== 'object' || 'error' in resolved) return null;
    const agent = 'session' in resolved ? resolved : resolved.agent;
    const root = agent?.session?.header?.cwd;
    return typeof root === 'string' && path.isAbsolute(root) ? root : null;
  }

  async function probeGit(root) {
    const now = Date.now();
    const cached = probeCache.get(root);
    if (cached && now - cached.at < 2000) return cached.value;
    let value = { available: true, isRepo: false, bare: false, branch: null, head: null, version: null, shallow: false, repoEpoch: '' };
    try {
      const top = await runGit(root, ['rev-parse', '--is-inside-work-tree', '--show-toplevel'], { timeoutMs: LIMITS.statusTimeoutMs });
      if (top.code !== 0) {
        value = { ...value, available: true, isRepo: false };
      } else {
        const isRepo = top.stdout.split('\n')[0]?.trim() === 'true';
        if (isRepo) {
          const head = await runGit(root, ['rev-parse', 'HEAD'], { timeoutMs: LIMITS.statusTimeoutMs });
          const branch = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: LIMITS.statusTimeoutMs });
          const shallow = await runGit(root, ['rev-parse', '--is-shallow-repository'], { timeoutMs: LIMITS.statusTimeoutMs });
          value = {
            available: true,
            isRepo: true,
            bare: false,
            branch: branch.code === 0 ? branch.stdout.trim() : null,
            head: head.code === 0 ? head.stdout.trim() : null,
            shallow: shallow.code === 0 && shallow.stdout.trim() === 'true',
            version: null,
            repoEpoch: head.code === 0 ? head.stdout.trim() : '',
          };
        }
      }
    } catch (error) {
      if (error?.code === 'E_GIT_MISSING') value = { ...value, available: false, isRepo: false };
      else throw error;
    }
    probeCache.set(root, { at: now, value });
    if (probeCache.size > 32) {
      const oldest = probeCache.keys().next().value;
      if (oldest) probeCache.delete(oldest);
    }
    return value;
  }

  function recents() {
    const list = [];
    if (store.lastRoot && !list.includes(store.lastRoot)) list.unshift(store.lastRoot);
    for (const root of Object.values(store.snapshot().sessionRoots ?? {})) {
      if (typeof root === 'string' && !list.includes(root)) list.push(root);
    }
    return list.slice(0, 8);
  }

  async function stateOf(context) {
    return {
      root: context.root,
      name: context.name,
      source: context.source,
      git: await probeGit(context.root),
      recents: recents(),
      limits: LIMITS,
    };
  }

  /** Build the preferred context for one session without mutating shared state. */
  async function build(sessionId) {
    const candidates = [
      { root: sessionId ? store.sessionRoot(sessionId) : null, source: 'override' },
      { root: await sessionRoot(sessionId), source: 'session' },
      { root: store.lastRoot, source: 'last' },
    ];
    for (const candidate of candidates) {
      if (!candidate.root) continue;
      try {
        const next = await canonical(candidate.root);
        return { ...next, source: candidate.source, sessionId: sessionId ?? null };
      } catch {
        // A stale candidate must not block the next one (e.g. a deleted cwd).
      }
    }
    return null;
  }

  function remember(sessionId, context) {
    if (!context) {
      contexts.delete(keyOf(sessionId));
      return null;
    }
    contexts.set(keyOf(sessionId), context);
    fallback = context;
    store.setLastRoot(context.root);
    return context;
  }

  /** Bind a session context for dispatch; cached until open/useSessionRoot replaces it. */
  async function contextFor(sessionId) {
    await store.ready();
    const cached = contexts.get(keyOf(sessionId));
    if (cached) return cached;
    return remember(sessionId, await build(sessionId));
  }

  const api = {
    get root() {
      return active()?.root ?? null;
    },
    get name() {
      return active()?.name ?? null;
    },

    contextFor,

    /** A nested ALS scope only for git/watch; workspace contexts remain unchanged. */
    async repositoryContext(context, relative) {
      if (!context) throw ideError('E_NO_ROOT', '还没有打开工作区', {});
      const workspaceRoot = context.workspaceRoot ?? context.root;
      const root = await repositoryRoot(workspaceRoot, relative);
      return { ...context, workspaceRoot, root, name: path.basename(root), repositoryPath: relative };
    },

    async scan() { return await scanWorkspace(api); },
    async packageScripts(input) { return await readPackageScripts(api, input); },

    /** Run a dispatch inside the session's immutable root context. */
    run(context, task) {
      return storage.run(context ?? null, task);
    },

    async resolve(input = {}) {
      await store.ready();
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      const context = remember(sessionId, await build(sessionId));
      if (!context) return nullState(recents());
      return await stateOf(context);
    },

    async open(input) {
      await store.ready();
      const next = await canonical(input.root);
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      const context = { ...next, source: sessionId ? 'override' : 'last', sessionId: sessionId ?? null };
      probeCache.delete(next.root);
      if (sessionId) store.setSessionRoot(sessionId, next.root);
      remember(sessionId, context);
      return await stateOf(context);
    },

    /** Drop this session's override and re-resolve to its own cwd. */
    async useSessionRoot(input = {}) {
      await store.ready();
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      store.clearSessionRoot(sessionId);
      contexts.delete(keyOf(sessionId));
      return await api.resolve({ sessionId });
    },

    async state(sessionId) {
      await store.ready();
      const bound = storage.getStore();
      const context = bound === undefined ? (sessionId ? contexts.get(keyOf(sessionId)) : fallback) : bound;
      if (!context) return nullState(recents());
      return await stateOf(context);
    },

    requireRoot() {
      const context = active();
      if (!context) throw ideError('E_NO_ROOT', '还没有打开工作区', { recents: recents() });
      return context.root;
    },

    /** Resolve a workspace-relative path and prove it stays inside the active root. */
    async resolvePath(rel) {
      const root = api.requireRoot();
      const target = path.resolve(root, rel ?? '');
      let real, ancestor = target;
      const missing = [];
      while (real === undefined) {
        try { real = path.resolve(await realpath(ancestor), ...missing); } catch (error) {
          if (error?.code !== 'ENOENT') throw ideError('E_PERMISSION', '无法解析路径', { syscall: error?.code ?? 'realpath' });
          const parent = path.dirname(ancestor);
          if (parent === ancestor) throw ideError('E_NOT_FOUND', '路径不存在', { path: rel });
          missing.unshift(path.basename(ancestor));
          ancestor = parent;
        }
      }
      if (!pathInside(root, real)) {
        throw ideError('E_OUTSIDE_ROOT', '路径在工作区之外', { path: rel });
      }
      return { root, absolute: real, relative: path.relative(root, real).split(path.sep).join('/') };
    },

    reset() {
      contexts.clear();
      fallback = null;
      probeCache.clear();
    },
  };

  return api;
}

/** Kept for tests/documentation: the exact probe git uses when a root is opened. */
export async function assertRepo(root) {
  const result = await gitOrThrow(root, ['rev-parse', '--is-inside-work-tree'], { timeoutMs: LIMITS.statusTimeoutMs });
  if (result.stdout.trim() !== 'true') throw ideError('E_NOT_A_REPO', '不是 git 仓库', {});
}
