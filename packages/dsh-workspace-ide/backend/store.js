/**
 * Plugin-private persisted state: last workspace root + trusted roots.
 * Backed by `ctx.storageDomain` when the host has it, otherwise in-memory only
 * (the panel stays usable, it just forgets across restarts).
 */
import { z } from 'zod';

const recordSchema = z.object({
  lastRoot: z.string().max(4096).nullable(),
  trustedRoots: z.array(z.string().max(4096)).max(200),
  updatedAt: z.number().int().min(0),
});

const EMPTY = Object.freeze({ lastRoot: null, trustedRoots: [], updatedAt: 0 });

export function createStore(ctx) {
  let state = { ...EMPTY, trustedRoots: [] };
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
      if (stored) state = { lastRoot: stored.lastRoot ?? null, trustedRoots: [...(stored.trustedRoots ?? [])], updatedAt: stored.updatedAt ?? 0 };
    } catch (error) {
      console.warn('[workspace-ide] storage domain unavailable, using memory only:', error?.message ?? error);
      domain = null;
    }
  }

  function snapshot() {
    return { lastRoot: state.lastRoot, trustedRoots: [...state.trustedRoots] };
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
    get trustedRoots() {
      return [...state.trustedRoots];
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
    trust(root) {
      if (!state.trustedRoots.includes(root)) state.trustedRoots.push(root);
      void persist();
    },
    untrust(root) {
      state.trustedRoots = state.trustedRoots.filter((item) => item !== root);
      void persist();
    },
    isTrusted(root) {
      return state.trustedRoots.includes(root);
    },
    close() {
      if (domain && typeof domain.close === 'function') domain.close();
      domain = null;
    },
  };
}
