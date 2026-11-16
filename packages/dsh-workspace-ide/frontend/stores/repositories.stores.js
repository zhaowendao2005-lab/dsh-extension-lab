import { createStore } from '../store.js';
import { normalizeTreePath } from '../service/path-tree.js';

const initialState = () => ({
  phase: 'idle', repositories: [], packages: [], tracked: [], active: null,
  collapsed: {}, error: null, truncated: false, warnings: [],
});
const storageKey = (root) => 'dsh-workspace-ide:repositories:' + encodeURIComponent(root);
const uniquePaths = (paths) => [...new Set((Array.isArray(paths) ? paths : [])
  .map(normalizeTreePath).filter((path) => path !== null))];

/** Workspace inventory and user-owned repository selection. Git state stays in the SCM domain. */
export function createRepositoriesDomain({ client, workspace, notify, onSelectionChange, changeReason, canChange = () => true }) {
  const store = createStore(initialState());
  let epoch = 0;
  let stateRoot = null;
  let persistenceRoot = null;
  let hydrated = false;

  function getChangeReason() {
    return changeReason?.() || (canChange() ? null : '当前操作进行中，暂不能切换仓库');
  }

  function selectionBlocked() {
    const reason = getChangeReason();
    if (reason) notify?.('warn', reason);
    return Boolean(reason);
  }

  function report(error, message) {
    notify?.('warn', message, error?.message ?? null, error?.code ?? 'E_LIMIT');
  }

  function readSelection(root) {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey(root));
      if (!raw) return { tracked: [], active: null };
      const saved = JSON.parse(raw);
      const tracked = uniquePaths(saved?.tracked);
      const active = normalizeTreePath(saved?.active);
      return { tracked, active: tracked.includes(active) ? active : null };
    } catch (error) {
      report(error, '无法恢复仓库跟踪选项');
      return { tracked: [], active: null };
    }
  }

  function persist() {
    if (!persistenceRoot) return;
    const { tracked, active } = store.getSnapshot();
    try {
      globalThis.localStorage?.setItem(storageKey(persistenceRoot), JSON.stringify({ version: 1, tracked, active }));
    } catch (error) {
      report(error, '无法保存仓库跟踪选项，重新打开后可能丢失');
    }
  }

  function selectionChanged(previous, active) {
    if (previous === active) return;
    try {
      Promise.resolve(onSelectionChange?.({ previous, active })).catch((error) => report(error, '切换活动仓库失败'));
    } catch (error) {
      report(error, '切换活动仓库失败');
    }
  }

  function reset() {
    epoch += 1;
    const previous = store.getSnapshot().active;
    stateRoot = null;
    persistenceRoot = null;
    hydrated = false;
    store.set(initialState());
    selectionChanged(previous, null);
  }

  async function scan() {
    const root = workspace.getSnapshot().root;
    if (!root) { reset(); return null; }
    if (stateRoot !== root) {
      reset();
      stateRoot = root;
    }
    const request = ++epoch;
    store.patch({ phase: 'loading', error: null });
    const current = () => request === epoch && workspace.getSnapshot().root === root && stateRoot === root;
    try {
      const result = await client.call('workspace.scan', {});
      if (!current()) return null;
      persistenceRoot = result.root || root;
      const repositories = result.repositories ?? [];
      const available = new Set(repositories.map((entry) => entry.path));
      const saved = hydrated ? store.getSnapshot() : readSelection(persistenceRoot);
      // A limited scan cannot prove that a previously selected repository disappeared.
      const before = store.getSnapshot();
      const selectionAllowed = !getChangeReason();
      const tracked = selectionAllowed
        ? uniquePaths(saved.tracked).filter((path) => result.truncated || available.has(path))
        : before.tracked;
      const active = selectionAllowed ? (tracked.includes(saved.active) ? saved.active : null) : before.active;
      const previous = before.active;
      hydrated = hydrated || selectionAllowed;
      store.patch({
        phase: 'ready', repositories, packages: result.packages ?? [], tracked, active,
        error: null, truncated: Boolean(result.truncated), warnings: result.warnings ?? [],
      });
      if (selectionAllowed) persist();
      selectionChanged(previous, active);
      return result;
    } catch (error) {
      if (!current()) return null;
      store.patch({ phase: 'error', error: error?.message ?? '扫描仓库失败' });
      report(error, '扫描仓库失败');
      return null;
    }
  }

  function setTracked(path, tracked = !store.getSnapshot().tracked.includes(path)) {
    const state = store.getSnapshot();
    if (selectionBlocked() || stateRoot !== workspace.getSnapshot().root || !state.repositories.some((entry) => entry.path === path)) return false;
    const next = tracked ? uniquePaths([...state.tracked, path]) : state.tracked.filter((item) => item !== path);
    const active = tracked ? (state.active ?? path) : (state.active === path ? next[0] ?? null : state.active);
    hydrated = true;
    store.patch({ tracked: next, active });
    persist();
    selectionChanged(state.active, active);
    return true;
  }

  function select(path) {
    const state = store.getSnapshot();
    if (selectionBlocked() || stateRoot !== workspace.getSnapshot().root) return false;
    if (path !== null && (!state.tracked.includes(path) || !state.repositories.some((entry) => entry.path === path))) return false;
    hydrated = true;
    store.patch({ active: path });
    persist();
    selectionChanged(state.active, path);
    return true;
  }

  function toggle(path) {
    const state = store.getSnapshot();
    store.patch({ collapsed: { ...state.collapsed, [path]: !state.collapsed[path] } });
  }

  return { store, scan, setTracked, select, reset, toggle, getChangeReason };
}
