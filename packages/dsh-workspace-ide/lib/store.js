/**
 * Plugin-private persisted state: last workspace root + per-session roots.
 * Backed by `ctx.storageDomain` when the host has it, otherwise in-memory only
 * (the panel stays usable, it just forgets across restarts).
 */
import { z } from 'zod';

const recordSchema = z.object({
  lastRoot: z.string().max(4096).nullable(),
  // A manual folder choice per session; absent means "use the session's own cwd".
  sessionRoots: z.record(z.string(), z.string().max(4096)).default({}),
  updatedAt: z.number().int().min(0),
});

const EMPTY = Object.freeze({ lastRoot: null, sessionRoots: {}, updatedAt: 0 });

export function createStore(ctx) {
  let state = { ...EMPTY, sessionRoots: {} };
  let domain = null;
  let ready = null;
  let rewriteQueued = false;

  const table = () => (domain ? domain.table('state') : null);

  async function open() {
    const facility = ctx.get('storageDomain');
    if (!facility || typeof facility.open !== 'function') return;
    try {
      // A plain DomainSpec: the facility validates it against the routed backend, so this
      // plugin never has to resolve the storage-domain package itself (it is not a
      // dependency of a plugin — the Host owns the mounted facility).
      const spec = {
        name: 'workspace_ide',
        version: 1,
        layout: 'single',
        tables: { state: { valueSchema: recordSchema } },
      };
      domain = await facility.open(spec);
      const stored = table().get('main');
      if (stored) {
        state = {
          lastRoot: stored.lastRoot ?? null,
          sessionRoots: { ...(stored.sessionRoots ?? {}) },
          updatedAt: stored.updatedAt ?? 0,
        };
      }
    } catch (error) {
      console.warn('[workspace-ide] storage domain unavailable, using memory only:', error?.message ?? error);
      domain = null;
    }
  }

  function snapshot() {
    return {
      lastRoot: state.lastRoot,
      sessionRoots: { ...state.sessionRoots },
    };
  }

  async function persist() {
    if (!table()) return;
    const record = { ...snapshot(), updatedAt: Date.now() };
    state.updatedAt = record.updatedAt;
    try {
      table().put('main', record);
    } catch (error) {
      console.warn('[workspace-ide] storage write failed:', error?.message ?? error);
    }
  }

  return {
    async ready() {
      if (!ready) ready = open();
      return ready;
    },
    get lastRoot() {
      return state.lastRoot;
    },
    /** The folder this session explicitly opened, or null for "follow the session cwd". */
    sessionRoot(sessionId) {
      if (!sessionId) return null;
      return state.sessionRoots[sessionId] ?? null;
    },
    setSessionRoot(sessionId, root) {
      if (!sessionId) return;
      state.sessionRoots = { ...state.sessionRoots, [sessionId]: root };
      void persist();
    },
    clearSessionRoot(sessionId) {
      if (!sessionId || !(sessionId in state.sessionRoots)) return;
      const next = { ...state.sessionRoots };
      delete next[sessionId];
      state.sessionRoots = next;
      void persist();
    },
    snapshot,
    setLastRoot(root) {
      state.lastRoot = root;
      if (!rewriteQueued) {
        rewriteQueued = true;
        queueMicrotask(() => {
          rewriteQueued = false;
          void persist();
        });
      }
    },
    close() {
      if (domain && typeof domain.close === 'function') domain.close();
      domain = null;
    },
  };
}
