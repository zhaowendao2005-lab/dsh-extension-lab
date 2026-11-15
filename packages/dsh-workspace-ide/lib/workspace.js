/**
 * Workspace root resolution, trust gate and repository probing.
 * The root is always decided Host-side (AGENTS.md → 根目录只能由 Host 解析).
 */
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { LIMITS } from '../shared/contract.js';
import { ideError } from '../shared/errors.js';
import { gitOrThrow, runGit } from './git/exec.js';

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

export function createWorkspace(ctx, store) {
  /** @type {{root: string, name: string}|null} */
  let current = null;
  /** How the current root was chosen; surfaced to the client so the chip can say why. */
  let currentSource = null;
  let probeCache = { at: 0, value: null };

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
    if (probeCache.value && now - probeCache.at < 2000) return probeCache.value;
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
    probeCache = { at: now, value };
    return value;
  }

  function recents() {
    const list = [...store.trustedRoots];
    if (store.lastRoot && !list.includes(store.lastRoot)) list.unshift(store.lastRoot);
    for (const root of Object.values(store.snapshot().sessionRoots ?? {})) {
      if (typeof root === 'string' && !list.includes(root)) list.push(root);
    }
    return list.slice(0, 8);
  }

  /** One resolved workspace payload; git/trust/recents are always fresh enough to render. */
  async function stateOf(root, source) {
    return {
      root,
      name: path.basename(root) || root,
      source,
      git: await probeGit(root),
      trusted: store.isTrusted(root),
      recents: recents(),
      limits: LIMITS,
    };
  }

  /** The wire shape is a plain boolean; the root is already a sibling field. */
  function trustState(root) {
    return store.isTrusted(root);
  }

  const api = {
    get root() {
      return current?.root ?? null;
    },
    get name() {
      return current?.name ?? null;
    },

    /**
     * Resolve the root for one session. Precedence is the promise of the right-column
     * workbench: this session's manual folder choice, then the session's own cwd, then the
     * last root this browser used. "Nothing chosen" returns an empty state, never throws.
     */
    async resolve(input = {}) {
      await store.ready();
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      const candidates = [
        { root: store.sessionRoot(sessionId), source: 'override' },
        { root: await sessionRoot(sessionId), source: 'session' },
        { root: store.lastRoot, source: 'last' },
      ];
      for (const candidate of candidates) {
        if (!candidate.root) continue;
        if (current && current.root === candidate.root) {
          currentSource = candidate.source;
          return await stateOf(current.root, currentSource);
        }
        try {
          current = await canonical(candidate.root);
          currentSource = candidate.source;
          store.setLastRoot(current.root);
          return await stateOf(current.root, currentSource);
        } catch {
          // A stale candidate must not block the next one (e.g. a deleted cwd).
        }
      }
      if (current) return await stateOf(current.root, currentSource);
      return {
        root: null,
        name: null,
        source: null,
        git: { available: true, isRepo: false },
        trusted: false,
        recents: recents(),
        limits: LIMITS,
      };
    },

    async open(input) {
      await store.ready();
      const next = await canonical(input.root);
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      current = next;
      currentSource = sessionId ? 'override' : 'last';
      probeCache = { at: 0, value: null };
      store.setLastRoot(next.root);
      if (sessionId) store.setSessionRoot(sessionId, next.root);
      return await stateOf(next.root, currentSource);
    },

    /** Drop this session's override and re-resolve to its own cwd. */
    async useSessionRoot(input = {}) {
      await store.ready();
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
      store.clearSessionRoot(sessionId);
      return await api.resolve({ sessionId });
    },

    async state() {
      if (!current) return await api.resolve({});
      return await stateOf(current.root, currentSource);
    },

    async setTrusted(input) {
      const root = api.requireRoot();
      if (input.trusted) store.trust(root);
      else store.untrust(root);
      return { root, trusted: store.isTrusted(root) };
    },

    requireRoot() {
      if (!current) throw ideError('E_NO_ROOT', '还没有打开工作区', { recents: recents() });
      return current.root;
    },

    isTrusted() {
      return current ? store.isTrusted(current.root) : false;
    },

    /** Trust gate for write / terminal / network / watch (docs/security.md §2). */
    assertTrusted(reason) {
      const root = api.requireRoot();
      if (store.isTrusted(root)) return root;
      throw ideError('E_TRUST_REQUIRED', '此工作区尚未被信任', { reason, root });
    },

    /** Resolve a workspace-relative path and prove it stays inside the root. */
    async resolvePath(rel) {
      const root = api.requireRoot();
      const target = path.resolve(root, rel ?? '');
      const real = await realpath(target).catch(() => target);
      const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
      if (real !== root && !real.startsWith(normalizedRoot)) {
        throw ideError('E_OUTSIDE_ROOT', '路径在工作区之外', { path: rel });
      }
      return { root, absolute: real, relative: path.relative(root, real).split(path.sep).join('/') };
    },

    reset() {
      current = null;
      currentSource = null;
      probeCache = { at: 0, value: null };
    },
  };

  return api;
}

/** Kept for tests/documentation: the exact probe git uses when a root is opened. */
export async function assertRepo(root) {
  const result = await gitOrThrow(root, ['rev-parse', '--is-inside-work-tree'], { timeoutMs: LIMITS.statusTimeoutMs });
  if (result.stdout.trim() !== 'true') throw ideError('E_NOT_A_REPO', '不是 git 仓库', {});
}
