/**
 * Global view state for one session panel. Views never hold local state: every
 * expansion, selection, draft and checkbox lives here and is read through
 * `useStore` (useSyncExternalStore). State that belongs to the sandbox itself is
 * only ever the Host snapshot, fetched through sandbox.datasource.js.
 */
import { createSandboxDatasource } from './sandbox.datasource.js';
import { createSandboxDatasourceMock, mockRequested } from './sandbox.mock.js';

const initialUi = () => ({
  sections: { debug: true, models: false },
  groups: { runtime: true, builds: true, tests: true, checks: true },
  providers: {},
  selectedNode: null,
  activeTerminal: null,
});

export function createSandboxStore({ execute, sessionId, delay = 2000, datasource } = {}) {
  const source = datasource ?? (mockRequested() ? createSandboxDatasourceMock() : createSandboxDatasource({ execute, sessionId }));

  let state = {
    sessionId,
    loading: true,
    busy: false,
    error: null,
    snapshot: null,
    catalog: { loading: false, loaded: false, error: null, providers: [] },
    ui: initialUi(),
  };
  let disposed = false;
  let timer;
  let inFlight = false;
  let revision = 0;
  const listeners = new Set();

  const publish = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const publishUi = (update) => publish({ ui: { ...state.ui, ...update(state.ui) } });

  /** The Host snapshot is the only authority for sandbox fields, including terminals. */
  const applySnapshot = (snapshot) => {
    const terminals = snapshot?.terminals ?? [];
    const current = state.ui.activeTerminal;
    const stillOpen = terminals.some((terminal) => terminal.id === current);
    publish({
      snapshot,
      loading: false,
      error: null,
      ui: { ...state.ui, activeTerminal: stillOpen ? current : terminals[0]?.id ?? null },
    });
  };

  async function refresh() {
    if (disposed || inFlight || state.busy) return;
    inFlight = true;
    const started = revision;
    try {
      const snapshot = await source.status();
      if (started === revision) applySnapshot(snapshot);
    } catch (error) {
      if (started === revision) publish({ error: error.message, loading: false });
    } finally {
      inFlight = false;
    }
  }

  async function perform(run) {
    if (state.busy || disposed) return undefined;
    revision++;
    publish({ busy: true, error: null });
    try {
      const value = await run();
      if (value && typeof value === 'object' && 'runtime' in value) applySnapshot(value);
      else publish({ loading: false });
      return value;
    } catch (error) {
      publish({ error: error.message, loading: false });
      return undefined;
    } finally {
      publish({ busy: false });
    }
  }

  async function loadCatalog() {
    if (state.catalog.loading || state.catalog.loaded) return;
    publish({ catalog: { ...state.catalog, loading: true, error: null } });
    try {
      const value = await source.catalog();
      publish({ catalog: { loading: false, loaded: true, error: null, providers: value?.providers ?? [] } });
    } catch (error) {
      publish({ catalog: { loading: false, loaded: false, error: error.message, providers: [] } });
    }
  }

  const selectedModels = () => state.snapshot?.models ?? [];

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) {
        void refresh();
        timer = setInterval(refresh, delay);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) clearInterval(timer);
      };
    },

    refresh,
    launch: () => perform(() => source.launch()),
    stop: () => perform(() => source.stop()),
    bind: (pluginPath) => perform(() => source.bind(pluginPath)),
    unbind: () => perform(() => source.unbind()),
    runScript: (commandId) => perform(() => source.run(commandId)),

    toggleSection(id) {
      const next = state.ui.sections[id] !== true;
      publishUi((ui) => ({ sections: { ...ui.sections, [id]: next } }));
      if (id === 'models' && next) void loadCatalog();
    },
    toggleGroup(id) {
      publishUi((ui) => ({ groups: { ...ui.groups, [id]: ui.groups[id] !== true } }));
    },
    toggleProvider(id) {
      publishUi((ui) => ({ providers: { ...ui.providers, [id]: ui.providers[id] !== true } }));
    },
    selectNode(id) {
      publishUi(() => ({ selectedNode: id }));
    },
    selectTerminal(id) {
      publishUi(() => ({ activeTerminal: id }));
    },

    async createTerminal(commandId) {
      const value = await perform(() => source.terminalCreate({ rows: 24, cols: 80, ...(commandId ? { commandId } : {}) }));
      const terminals = value?.terminals ?? state.snapshot?.terminals ?? [];
      const created = commandId
        ? [...terminals].reverse().find((terminal) => terminal.commandId === commandId)
        : terminals.at(-1);
      if (created?.id) publishUi(() => ({ activeTerminal: created.id }));
    },
    closeTerminal(id) {
      return perform(() => source.terminalClose(id));
    },
    // Terminal I/O bypasses `perform`: keystrokes must not flip the panel into a
    // busy state or race the polling snapshot. The PTY is the source of truth.
    writeTerminal: (terminalId, data) => source.terminalWrite(terminalId, data).catch(() => {}),
    pollTerminal: (terminalId, offset) => source.terminalPoll(terminalId, offset),
    resizeTerminal: (terminalId, cols, rows) => source.terminalResize(terminalId, cols, rows).catch(() => {}),
    async toggleModel(provider, model, checked) {
      const key = (item) => `${item.provider}\u0000${item.model}`;
      const target = `${provider}\u0000${model}`;
      const next = checked
        ? [...selectedModels().filter((item) => key(item) !== target), { provider, model }]
        : selectedModels().filter((item) => key(item) !== target);
      return perform(() => source.saveModels(next));
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
