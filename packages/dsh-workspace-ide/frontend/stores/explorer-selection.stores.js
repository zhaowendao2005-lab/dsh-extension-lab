import { createStore } from '../store.js';
import { explorerDeletionPaths, explorerSelection, visibleExplorerRows } from '../service/explorer-selection.js';

const initial = () => ({ selected: [], focused: null, anchor: null, menu: null });

/** Explorer presentation state only. File mutations and cross-domain open stay in workbench. */
export function createExplorerSelectionDomain({ files, workspace, onSelectionChange = () => {} }) {
  const store = createStore(initial());
  let root = workspace.getSnapshot().root;
  const rows = () => visibleExplorerRows(files.getSnapshot());
  function commit(next) {
    const previous = store.getSnapshot();
    if (JSON.stringify(next) === JSON.stringify(previous)) return previous;
    store.set(next);
    onSelectionChange({ selected: next.selected, focused: next.focused, anchor: next.anchor });
    return next;
  }
  function reconcile() {
    const nextRoot = workspace.getSnapshot().root;
    if (nextRoot !== root) { root = nextRoot; commit(initial()); return; }
    const visible = rows().map((row) => row.path);
    const visibleSet = new Set(visible);
    const state = store.getSnapshot();
    const selected = state.selected.filter((path) => visibleSet.has(path));
    const focused = visibleSet.has(state.focused) ? state.focused : (selected[0] ?? visible[0] ?? null);
    commit({ ...state, selected, focused,
      anchor: visibleSet.has(state.anchor) ? state.anchor : focused,
      menu: state.menu && visibleSet.has(state.menu.path) ? state.menu : null });
  }
  const detachFiles = files.subscribe(reconcile);
  const detachWorkspace = workspace.subscribe(reconcile);
  const domain = {
    store,
    select(path, options) { return commit(explorerSelection(store.getSnapshot(), path, rows(), options)); },
    focus(path) {
      if (rows().some((row) => row.path === path)) commit({ ...store.getSnapshot(), focused: path, menu: null });
    },
    selectAll() {
      const visible = rows();
      const state = store.getSnapshot();
      commit({ ...state, selected: visible.map((row) => row.path), focused: state.focused ?? visible[0]?.path ?? null, anchor: state.anchor ?? visible[0]?.path ?? null, menu: null });
    },
    clear() { commit({ ...store.getSnapshot(), selected: [], anchor: null, menu: null }); },
    openMenu(path, point) {
      const next = explorerSelection(store.getSnapshot(), path, rows(), { preserve: true });
      if (!next.selected.includes(path)) return;
      commit({ ...next, menu: { path, x: point.x, y: point.y, surface: point.surface ?? null } });
    },
    closeMenu() { if (store.getSnapshot().menu) commit({ ...store.getSnapshot(), menu: null }); },
    selectedEntries() {
      const selected = new Set(store.getSnapshot().selected);
      return rows().filter((row) => selected.has(row.path));
    },
    deletionPaths() { return explorerDeletionPaths(domain.selectedEntries()); },
    reset() { root = workspace.getSnapshot().root; commit(initial()); },
    dispose() { detachFiles(); detachWorkspace(); store.dispose(); },
  };
  reconcile();
  return domain;
}
