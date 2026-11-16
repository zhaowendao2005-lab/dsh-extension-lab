/**
 * Every store the panel needs, plus the cross-domain actions that wire them to
 * each other (ARCHITECTURE.md → 状态所有权). Views read stores and call actions;
 * they never hold their own state and never call the datasource directly.
 */
import { createStore } from '../store.js';
import { LIMITS } from '../../shared/contract.js';
import { IdeError } from '../service/client.js';
import {
  DEFAULT_EDITOR_PREFS, loadLayout, loadWorkbench, readEditorPrefs, saveLayout, saveWorkbench,
} from '../service/layout.js';
import { normalizeUiScale } from './preferences.stores.js';
import { createLayoutStore } from './layout.stores.js';
import {
  CHANGES_TAB, CONFLICT_TAB, DIFF_TAB, GRAPH_TAB, REPOSITORIES_TAB, COMMANDS_TAB, fileTabId,
} from '../service/tabs.js';
import { createTerminalController } from './terminal.stores.js';
import { createEditorDomain } from './editor.stores.js';
import { createScmDomain } from './scm.stores.js';
import { createConflictDomain, createConflictStore } from './conflict.stores.js';
import { createGraphDomain } from './graph.stores.js';
import { createDiffDomain } from './diff.stores.js';
import { createRepositoriesDomain } from './repositories.stores.js';
import { createCommandsDomain } from './commands.stores.js';

const EMPTY_LIMITS = LIMITS;

/**
 * `preferences` (from stores/preferences.stores.js) is the single owner of the browser-global
 * editor preferences and the whole-surface scale, because the Host settings page edits them
 * while no workbench is mounted. Without it (unit tests, older entry) the store keeps a local
 * copy in `ui` and persists it itself.
 */
export function createStores({ client, sessionId, host, preferences = null }) {
  let repositoryEpoch = 0;
  const transport = client;
  client = { async call(action, payload, scope) {
    const scoped = action.startsWith('git.') || action.startsWith('watch.');
    const epoch = repositoryEpoch;
    const repositoryPath = scoped ? (scope?.repositoryPath ?? repositoriesDomain.store.getSnapshot().active) : null;
    if (scoped && repositoryPath == null) throw new IdeError('E_NOT_A_REPO', '请先在仓库视图中勾选并选择一个仓库');
    let result;
    try {
      result = await transport.call(action, payload, scoped ? { repositoryPath } : undefined);
    } catch (error) {
      if (scoped && epoch !== repositoryEpoch && !action.startsWith('watch.')) {
        throw new IdeError('E_INVALID_ARG', '仓库已切换，忽略旧响应', { staleRepository: true });
      }
      throw error;
    }
    if (scoped && epoch !== repositoryEpoch && !action.startsWith('watch.')) {
      throw new IdeError('E_INVALID_ARG', '仓库已切换，忽略旧响应', { staleRepository: true });
    }
    return result;
  } };
  const preferenceSnapshot = preferences?.store?.getSnapshot?.() ?? null;
  const ui = createStore({
    activityView: 'files',
    sidebarWidth: 260,
    uiScale: preferenceSnapshot?.uiScale ?? 100,
    panelHeight: 220,
    sidebarCollapsed: false,
    navManual: false,
    compact: false,
    panelCollapsed: false,
    menu: null,
    tabMenu: null,
    diffRatio: 0.5,
    editor: { ...(preferenceSnapshot?.editor ?? DEFAULT_EDITOR_PREFS) },
    modal: null,
    quickOpen: false,
    quickQuery: '',
    quickActive: 0,
  });

  // The preferences store is global: every session runtime mirrors it rather than owning a copy,
  // so a change made in the Host settings page reaches an already mounted workbench immediately.
  const detachPreferences = preferences?.store?.subscribe
    ? preferences.store.subscribe(() => {
      const next = preferences.store.getSnapshot();
      ui.patch({ uiScale: next.uiScale, editor: { ...next.editor } });
    })
    : null;

  // Internal tabs, groups and the split tree. Its onChange feeds the per-session
  // localStorage snapshot; the store itself stays free of browser APIs.
  const layoutModel = createLayoutStore({ onChange: () => scheduleWorkbenchPersist() });

  const workspace = createStore({
    phase: 'idle',
    root: null,
    name: null,
    git: { available: false, isRepo: false, branch: null, detached: false },
    recents: [],
    limits: EMPTY_LIMITS,
    error: null,
  });

  const notices = createStore({ items: [] });

  const DIR_PAGE = 300;

  const files = createStore({
    entries: {},
    expanded: [],
    selected: null,
    loading: [],
    error: null,
    // Rendered rows per directory; a 20k-entry directory renders one page at a time so the
    // row components stay cheap (docs/ui-spec.md §4.3).
    visible: {},
  });

  const editor = createStore({
    tabs: [],
    activePath: null,
    conflicts: [],
    /** Last "go to line" request; `seq` makes a repeated reveal of the same line fire again. */
    reveal: null,
    /** Per-path Markdown preview flags (docs/editor.md §7). */
    previews: {},
  });

  /** Conflict resolution (M4-2): three index stages of one path, one at a time. */
  const conflict = createConflictStore();

  /** Quick-open (M4-5): the path index is cached on the Host, so opening it twice is free. */
  const quick = createStore({
    phase: 'idle',
    error: null,
    paths: [],
    engine: null,
    total: 0,
    truncated: false,
    loadedAt: 0,
  });

  const search = createStore({
    query: '',
    phase: 'idle',
    hits: [],
    truncated: false,
    engine: null,
    elapsedMs: 0,
    error: null,
  });
  let searchTimer = null;
  let searchEpoch = 0;

  const scm = createStore({
    status: null,
    phase: 'idle',
    error: null,
    writes: [],
    message: '',
    refs: null,
    stashes: [],
    /** Path tree (default) or grouped flat list; state here is presentation only. */
    view: 'tree',
    collapsed: { changes: false, staged: false },
    scrollTop: 0,
    treeHeight: 0,
    focusedKey: null,
    contextMenu: null,
  });

  const graph = createStore({
    phase: 'idle',
    error: null,
    rows: [],
    commits: [],
    maxLane: 0,
    hasMore: false,
    loadingMore: false,
    selected: null,
    filter: '',
    filterRef: null,
    refs: null,
    layoutMs: 0,
  });

  const diff = createStore({
    mode: 'split',
    phase: 'idle',
    error: null,
    files: [],
    sides: null,
    selected: null,
    path: null,
    target: null,
    truncated: false,
    binary: false,
  });

  const terminal = createStore({
    tabs: [],
    activeId: null,
    phase: 'idle',
    error: null,
  });

  let noticeId = 0;

  function notify(level, message, detail, code) {
    noticeId += 1;
    const item = { id: noticeId, level, message, detail: detail ?? null, code: code ?? null, at: Date.now() };
    notices.set((current) => ({ items: [...current.items, item].slice(-6) }));
    return item.id;
  }

  function dismissNotice(id) {
    notices.set((current) => ({ items: current.items.filter((item) => item.id !== id) }));
  }

  /** Uniform failure handling: an error bar line, and the code kept for the view. */
  function fail(scope, error, fallback) {
    if (error?.detail?.staleRepository) return error;
    const message = error instanceof IdeError ? error.message : (error?.message ?? fallback ?? '操作失败');
    notify('error', message, error instanceof IdeError ? error.detail : null, error instanceof IdeError ? error.code : null);
    scope?.patch?.({ error: message });
    return error;
  }

  function restoreLayout(state = ui.getSnapshot()) {
    const persisted = loadLayout();
    const patch = {
      sidebarWidth: clamp(persisted.sidebarWidth ?? state.sidebarWidth, 160, 360),
      panelHeight: clamp(persisted.panelHeight ?? state.panelHeight, 120, 600),
      sidebarCollapsed: Boolean(persisted.sidebarCollapsed),
      panelCollapsed: Boolean(persisted.panelCollapsed),
      activityView: persisted.activityView === 'search' ? 'search' : 'files',
    };
    // With a preferences store the editor settings and the scale were restored when it was
    // created; re-applying them here would race a settings-page edit made before mount.
    if (!preferences) {
      patch.editor = readEditorPrefs(persisted);
      patch.uiScale = normalizeUiScale(persisted.uiScale);
    }
    ui.patch(patch);
  }

  function persistLayout() {
    const state = ui.getSnapshot();
    const global = preferences?.store?.getSnapshot?.() ?? state;
    saveLayout({
      sidebarWidth: state.sidebarWidth,
      panelHeight: state.panelHeight,
      sidebarCollapsed: state.sidebarCollapsed,
      panelCollapsed: state.panelCollapsed,
      activityView: state.activityView,
      editor: global.editor,
      uiScale: global.uiScale,
    });
  }

  // --- internal workbench layout (tabs / groups / split tree) -----------------
  let workbenchTimer = null;
  let workbenchRestored = false;
  let scmPollTimer = null;
  let scmInFlight = null;
  let refsLoadedAt = 0;
  let booted = false;
  let disposed = false;
  /** Visible surfaces owning this runtime: 'sidebar' and/or 'overlay'. */
  const surfaces = new Set();
  let runtimeActive = false;

  function scheduleWorkbenchPersist() {
    if (!sessionId) return;
    if (workbenchTimer) clearTimeout(workbenchTimer);
    workbenchTimer = setTimeout(() => {
      workbenchTimer = null;
      persistWorkbench();
    }, 200);
  }

  function persistWorkbench() {
    if (!sessionId) return;
    saveWorkbench(sessionId, layoutModel.actions.serialize());
  }

  /** Runs once per session, after the root is known; a broken snapshot falls back to welcome. */
  function restoreWorkbench() {
    if (workbenchRestored) return;
    workbenchRestored = true;
    const saved = loadWorkbench(sessionId);
    if (!saved) return;
    layoutModel.actions.restore(saved);
    const state = layoutModel.store.getSnapshot();
    for (const tab of Object.values(state.tabs)) {
      if (tab.kind === 'file' && tab.path) void editorDomain.openPath(tab.path);
    }
    const group = state.groups[state.activeGroup];
    const active = group && group.active ? state.tabs[group.active] : null;
    if (active && active.kind === 'file' && active.path) editor.patch({ activePath: active.path });
  }

  function findTab(tabId) {
    return layoutModel.store.getSnapshot().tabs[tabId] ?? null;
  }

  function tabsOfGroup(groupId) {
    const group = layoutModel.store.getSnapshot().groups[groupId];
    return group ? [...group.tabs] : [];
  }

  function fileTabsOf(ids) {
    const tabs = layoutModel.store.getSnapshot().tabs;
    return ids.filter((id) => tabs[id]?.kind === 'file');
  }

  /**
   * The Host keeps one root at a time. When it moves, every path we still hold belongs to the
   * old tree, so file tabs/editor buffers/diff/conflict must be dropped before the next save.
   */
  function resetRootScopedState() {
    repositoriesDomain.reset();
    commandsDomain.reset();
    refsLoadedAt = 0;
    diffDomain.close();
    conflictDomain.close();
    const snapshot = layoutModel.store.getSnapshot();
    for (const tab of Object.values(snapshot.tabs)) {
      if (tab.kind === 'file') layoutModel.actions.close(tab.id);
    }
    ui.patch({ menu: null, tabMenu: null });
    quick.patch({ phase: 'idle', paths: [], total: 0, truncated: false, loadedAt: 0, error: null });
    files.patch({ entries: {}, expanded: [], selected: null, loading: [], error: null, visible: {} });
    editor.patch({ tabs: [], activePath: null, conflicts: [], reveal: null });
    graph.patch({
      rows: [], commits: [], maxLane: 0, hasMore: false, loadingMore: false, selected: null,
      phase: 'idle', error: null, layoutMs: 0, refs: null, filter: '', filterRef: null,
    });
  }

  const actions = {
    restoreLayout,

    setActivity(view) {
      ui.patch({
        activityView: view === 'search' ? 'search' : 'files',
        sidebarCollapsed: false,
        navManual: true,
        menu: null,
      });
      persistLayout();
    },

    toggleSidebar() {
      ui.patch({ sidebarCollapsed: !ui.getSnapshot().sidebarCollapsed, navManual: true });
      persistLayout();
    },

    /** Width comes from the right column, not the window; the narrow state owns the drawer. */
    setColumnWidth(width) {
      const state = ui.getSnapshot();
      const compact = Number(width) > 0 && width < 520;
      if (compact === state.compact) return;
      const patch = { compact };
      if (!state.navManual) patch.sidebarCollapsed = compact;
      ui.patch(patch);
      persistLayout();
    },

    togglePanel() {
      ui.patch({ panelCollapsed: !ui.getSnapshot().panelCollapsed });
      persistLayout();
    },

    setSidebarWidth(width) {
      ui.patch({ sidebarWidth: clamp(width, 180, 600) });
      persistLayout();
    },

    setPanelHeight(height) {
      ui.patch({ panelHeight: clamp(height, 120, 600) });
      persistLayout();
    },

    setDiffRatio(ratio) {
      ui.patch({ diffRatio: Math.min(0.8, Math.max(0.2, ratio)) });
    },

    setUiScale(value) {
      if (preferences) {
        preferences.actions.setUiScale(value);
        return;
      }
      ui.patch({ uiScale: normalizeUiScale(value) });
      persistLayout();
    },

    /** Apply one workspace.resolve/state payload without inventing fields. */
    applyWorkspace(next) {
      workspace.patch({
        phase: 'ready',
        root: next?.root ?? null,
        name: next?.name ?? null,
        git: next?.git ?? { available: false, isRepo: false },
        recents: next?.recents ?? [],
        limits: next?.limits ?? EMPTY_LIMITS,
        error: null,
      });
    },

    async boot() {
      workspace.patch({ phase: 'loading' });
      try {
        const resolved = await client.call('workspace.resolve', {});
        actions.applyWorkspace(resolved);
        if (resolved.root) await actions.refreshWorkspace();
        // Restore after the root is known so file tabs can be filtered by it later.
        restoreWorkbench();
        // A browser refresh leaves the Host owning live PTYs; adopt them instead of showing
        // an empty panel and leaking processes until the idle reaper fires.
        void terminals.reconcile();
      } catch (error) {
        console.error('[workspace-ide] boot failed', error);
        workspace.patch({ phase: 'error', error: error?.message ?? '无法确定工作区' });
        fail(workspace, error, '无法确定工作区');
      }
    },

    /**
     * The Host right sidebar keeps one workbench body per session. Visible means "this is the
     * session on screen": boot once, then re-resolve because another session's workbench may
     * have moved the Host's single root in the meantime.
     */
    /** Sidebar body and full-view overlay share one runtime; only 0→1 / 1→0 act. */
    setSurfaceVisible(name, visible) {
      if (visible) surfaces.add(name);
      else surfaces.delete(name);
      if (surfaces.size > 0) void actions.activate();
      else actions.deactivate();
    },

    async activate() {
      if (disposed || runtimeActive) return;
      runtimeActive = true;
      if (!booted) {
        booted = true;
        await actions.boot();
      } else if (workspace.getSnapshot().root) {
        await actions.ensureRoot();
      } else {
        await actions.boot();
      }
      if (workspace.getSnapshot().root) {
        void actions.startWatch();
        actions.startScmPoll();
      }
    },

    deactivate() {
      if (!runtimeActive) return;
      runtimeActive = false;
      const modal = ui.getSnapshot().modal;
      if (modal) {
        ui.patch({ modal: null });
        modal.resolve?.(false);
      }
      ui.patch({ menu: null, tabMenu: null, quickOpen: false });
      layoutModel.actions.endDrag();
      persistWorkbench();
      actions.stopScmPoll();
      void actions.stopWatch();
    },

    async ensureRoot() {
      try {
        const resolved = await client.call('workspace.resolve', {});
        const previous = workspace.getSnapshot();
        const changed = (resolved?.root ?? null) !== previous.root;
        actions.applyWorkspace(resolved);
        if (!resolved?.root) return;
        if (changed) {
          resetRootScopedState();
          await actions.listDir('');
          await repositoriesDomain.scan();
        }
        await actions.refreshScm();
      } catch (error) {
        fail(workspace, error, '无法确认工作区');
      }
    },

    /** `workspace.state` + first listing; used on boot and on panel reopen. */
    async refreshWorkspace() {
      const state = workspace.getSnapshot();
      if (!state.root) return;
      try {
        const next = await client.call('workspace.state', {});
        workspace.patch({
          root: next.root ?? state.root,
          name: next.name ?? state.name,
          git: next.git ?? state.git,
        });
        await actions.listDir('');
        await repositoriesDomain.scan();
        await actions.refreshScm();
      } catch (error) {
        fail(workspace, error, '无法读取工作区状态');
      }
    },

    /** Prefer a real host picker; otherwise ask for a Host path in our dialog. */
    async pickRoot() {
      try {
        const picked = typeof host?.pickDirectory === 'function'
          ? await host.pickDirectory()
          : await actions.prompt({
            title: '切换工作区',
            body: '输入运行 DSH 的主机上的文件夹绝对路径。',
            input: { label: '文件夹路径', value: workspace.getSnapshot().root ?? '', placeholder: '/path/to/workspace' },
            confirmLabel: '打开文件夹',
          });
        const root = typeof picked === 'string' ? picked.trim() : picked?.path;
        if (root) await actions.openRoot(root);
      } catch (error) {
        fail(workspace, error, '选择目录失败');
      }
    },

    async openRoot(root) {
      try {
        const opened = await client.call('workspace.open', { root });
        resetRootScopedState();
        workspace.patch({ root: opened.root, name: opened.name, git: opened.git, phase: 'ready', error: null });
        diffDomain.close();
        conflictDomain.close();
        ui.patch({ menu: null, tabMenu: null });
        refsLoadedAt = 0;
        layoutModel.actions.restore({});
        files.patch({ entries: {}, expanded: [], selected: null, loading: [], error: null, visible: {} });
        editor.patch({ tabs: [], activePath: null, conflicts: [], reveal: null });
        graph.patch({
          rows: [], commits: [], maxLane: 0, hasMore: false, loadingMore: false, selected: null,
          phase: 'idle', error: null, layoutMs: 0, refs: null, filter: '', filterRef: null,
        });
        await actions.listDir('');
        await repositoriesDomain.scan();
        await actions.refreshScm();
        // The old watcher token belongs to the previous root; rebind it after the switch.
        void actions.startWatch();
      } catch (error) {
        fail(workspace, error, '无法打开该目录');
      }
    },

    /** Forget this session's manual folder choice and go back to the session's own cwd. */
    async useSessionRoot() {
      try {
        const previous = workspace.getSnapshot().root;
        const resolved = await client.call('workspace.useSessionRoot', {});
        actions.applyWorkspace(resolved);
        if (!resolved?.root) return;
        if (resolved.root !== previous) {
          resetRootScopedState();
          await actions.listDir('');
          await repositoriesDomain.scan();
          await actions.refreshScm();
          void actions.startWatch();
        } else {
          await actions.refreshWorkspace();
        }
      } catch (error) {
        fail(workspace, error, '无法恢复会话默认工作区');
      }
    },

    /** Groups report their content size so drag/split can respect the minimum pane size. */
    measureGroup(groupId, width, height) {
      layoutModel.actions.measure(groupId, width, height);
    },

    async listDir(path, { refresh } = {}) {
      const state = files.getSnapshot();
      files.patch({ loading: [...state.loading, path] });
      try {
        const listing = await client.call('files.list', { path, refresh });
        const current = files.getSnapshot();
        files.patch({
          entries: { ...current.entries, [path]: listing },
          loading: current.loading.filter((item) => item !== path),
          error: null,
        });
        return listing;
      } catch (error) {
        const current = files.getSnapshot();
        files.patch({ loading: current.loading.filter((item) => item !== path) });
        fail(files, error, '无法读取目录');
        return null;
      }
    },

    toggleDir(path) {
      const state = files.getSnapshot();
      const expanded = state.expanded.includes(path)
        ? state.expanded.filter((item) => item !== path)
        : [...state.expanded, path];
      files.patch({ expanded });
      if (!state.entries[path] && expanded.includes(path)) void actions.listDir(path);
    },

    showMoreEntries(path = '') {
      const current = files.getSnapshot().visible[path] ?? DIR_PAGE;
      files.patch({ visible: { ...files.getSnapshot().visible, [path]: current + DIR_PAGE } });
    },

    collapseAll() {
      files.patch({ expanded: [] });
    },

    selectFile(path) {
      files.patch({ selected: path });
    },

    async copyText(text) {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板');
        await navigator.clipboard.writeText(text);
      } catch (error) {
        fail(null, error, '复制失败');
      }
    },

    setScmFocus(key) {
      if (scm.getSnapshot().focusedKey !== key) scm.patch({ focusedKey: key });
    },

    setScmView(view) {
      scm.patch({ view: view === 'flat' ? 'flat' : 'tree', contextMenu: null });
    },

    toggleScmNode(key) {
      const current = scm.getSnapshot().collapsed;
      scm.patch({ collapsed: { ...current, [key]: !current[key] } });
    },

    setScmScroll(top) {
      scm.patch({ scrollTop: top });
    },

    setScmTreeHeight(height) {
      const next = Math.max(80, Math.round(height));
      if (scm.getSnapshot().treeHeight === next) return;
      scm.patch({ treeHeight: next });
    },

    openScmMenu(menu) {
      scm.patch({ contextMenu: menu });
    },

    closeScmMenu() {
      if (scm.getSnapshot().contextMenu) scm.patch({ contextMenu: null });
    },

    /** One status request at a time; refs/stash are refreshed on a slower cadence. */
    async refreshScm() {
      if (scmInFlight) return scmInFlight;
      const refreshEpoch = repositoryEpoch;
      const state = workspace.getSnapshot();
      if (!state.root || repositoriesDomain.store.getSnapshot().active == null) {
        scm.patch({ status: null, phase: 'idle', error: null, writes: [], refs: null, stashes: [] });
        return null;
      }
      scm.patch({ phase: 'loading' });
      scmInFlight = (async () => {
        try {
          const status = await client.call('git.status', { untrackedMode: 'all' });
          if (refreshEpoch !== repositoryEpoch) return null;
          scm.patch({ status, phase: 'ready', error: null });
          if (Date.now() - refsLoadedAt > 15000) {
            refsLoadedAt = Date.now();
            void scmDomain.loadRefs();
            void scmDomain.loadStashes();
          }
          return status;
        } catch (error) {
          if (refreshEpoch !== repositoryEpoch) return null;
          scm.patch({ phase: 'error' });
          fail(scm, error, '无法读取 Git 状态');
          return null;
        } finally {
          if (refreshEpoch === repositoryEpoch) scmInFlight = null;
        }
      })();
      return await scmInFlight;
    },

    /** Correctness fallback independent of the filesystem watcher (docs/git-model.md §7). */
    startScmPoll() {
      if (scmPollTimer) return;
      scmPollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void actions.refreshScm();
      }, LIMITS.statusPollMs);
      scmPollTimer.unref?.();
    },

    stopScmPoll() {
      if (!scmPollTimer) return;
      clearInterval(scmPollTimer);
      scmPollTimer = null;
    },

    /** File operations live here because they need the prompt/confirm plumbing. */
    async createEntry(dirPath, kind = 'file') {
      const label = kind === 'directory' ? '新建文件夹' : '新建文件';
      const name = await actions.prompt({
        title: label,
        input: { label: `在 ${dirPath || '根目录'} 下`, placeholder: kind === 'directory' ? 'dirname' : 'file.ts', value: '' },
        confirmLabel: '创建',
      });
      if (!name) return null;
      try {
        const result = await client.call('files.create', {
          path: joinPath(dirPath, name),
          kind,
          ...(kind === 'file' ? { text: '' } : {}),
        });
        quick.patch({ loadedAt: 0 });
        await actions.listDir(dirPath, { refresh: true });
        return result;
      } catch (error) {
        fail(files, error, `${label}失败`);
        return null;
      }
    },

    async renameEntry(path) {
      const current = path.split('/').pop() ?? path;
      const name = await actions.prompt({
        title: '重命名',
        detail: path,
        input: { label: '新名称', value: current },
        confirmLabel: '重命名',
      });
      if (!name || name === current) return null;
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try {
        const result = await client.call('files.rename', { from: path, to: joinPath(parent, name) });
        quick.patch({ loadedAt: 0 });
        await actions.listDir(parent, { refresh: true });
        return result;
      } catch (error) {
        fail(files, error, '重命名失败');
        return null;
      }
    },

    async deleteEntry(path) {
      const accepted = await actions.confirm({
        title: '删除？',
        body: `将永久删除 ${path}，不会进入回收站。`,
        confirmLabel: '删除',
        danger: true,
        irreversible: true,
      });
      if (!accepted) return null;
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try {
        const result = await client.call('files.delete', { path, recursive: true });
        quick.patch({ loadedAt: 0 });
        await actions.listDir(parent, { refresh: true });
        return result;
      } catch (error) {
        if (error?.code === 'E_INVALID_ARG') {
          notify('warn', '目录非空，需要确认递归删除', error.detail ?? null);
        } else {
          fail(files, error, '删除失败');
        }
        return null;
      }
    },

    /** Every "open" goes through the internal tab model; content stores stay domain-owned. */
    openDiff(target, path) {
      const opened = layoutModel.actions.open({ id: DIFF_TAB, kind: 'diff' });
      if (opened) void diffDomain.open(target, path);
      return opened;
    },

    openConflict(path) {
      const opened = layoutModel.actions.open({ id: CONFLICT_TAB, kind: 'conflict' });
      if (opened) void conflictDomain.open(path);
      return opened;
    },

    openGraph() {
      return layoutModel.actions.open({ id: GRAPH_TAB, kind: 'graph' });
    },

    openChanges() {
      const opened = layoutModel.actions.open({ id: CHANGES_TAB, kind: 'changes' });
      const state = workspace.getSnapshot();
      if (state.root && repositoriesDomain.store.getSnapshot().active != null) void actions.refreshScm();
      return opened;
    },

    openRepositories() {
      return layoutModel.actions.open({ id: REPOSITORIES_TAB, kind: 'repositories' });
    },

    openCommands() {
      void commandsDomain.load(repositoriesDomain.store.getSnapshot());
      return layoutModel.actions.open({ id: COMMANDS_TAB, kind: 'commands' });
    },

    openRepositoryFile(path) {
      const repository = repositoriesDomain.store.getSnapshot().active;
      if (repository == null) return Promise.resolve(null);
      return actions.openFile(repository === '.' ? path : joinPath(repository, path));
    },

    toggleFullView() {
      return host?.toggleFullView?.() ?? false;
    },

    openFile(path) {
      if (!path) return null;
      ui.patch({ quickOpen: false, menu: null });
      // In the narrow column the file list is a drawer: opening a file must reveal the editor.
      if (ui.getSnapshot().compact) ui.patch({ sidebarCollapsed: true, navManual: true });
      layoutModel.actions.open({ id: fileTabId(path), kind: 'file', path, title: basename(path) });
      files.patch({ selected: path });
      editor.patch({ activePath: path });
      return editorDomain.openPath(path);
    },

    activateLayoutTab(groupId, tabId) {
      layoutModel.actions.activate(groupId, tabId);
      const tab = findTab(tabId);
      if (tab?.kind === 'file' && tab.path) {
        files.patch({ selected: tab.path });
        editor.patch({ activePath: tab.path });
        void editorDomain.openPath(tab.path);
      }
    },

    setActiveGroup(groupId) {
      layoutModel.actions.setActiveGroup(groupId);
    },

    splitTab(tabId, groupId, zone) {
      return layoutModel.actions.split(tabId, groupId, zone);
    },

    moveTab(tabId, groupId, index) {
      return layoutModel.actions.move(tabId, groupId, index);
    },

    resizeSplit(path, ratio) {
      layoutModel.actions.resize(path, ratio);
    },

    beginTabDrag(tabId, groupId, x, y) {
      layoutModel.actions.beginDrag(tabId, groupId, x, y);
    },

    updateTabDrag(x, y, target) {
      layoutModel.actions.moveDrag(x, y, target);
    },

    endTabDrag() {
      layoutModel.actions.endDrag();
    },

    canDrop(groupId, zone) {
      return layoutModel.actions.canDrop(groupId, zone);
    },

    openTabMenu(groupId, tabId, x, y) {
      ui.patch({ tabMenu: { groupId, tabId, x, y }, menu: null });
    },

    closeTabMenu() {
      if (ui.getSnapshot().tabMenu) ui.patch({ tabMenu: null });
    },

    /** Close one tab. File tabs keep their dirty-buffer confirmation. */
    async closeTabById(tabId, { force = false } = {}) {
      const tab = findTab(tabId);
      if (!tab) return false;
      if (tab.kind === 'file' && tab.path) {
        const editorTab = editor.getSnapshot().tabs.find((item) => item.path === tab.path);
        if (editorTab?.dirty && !force) {
          const accepted = await actions.confirm({
            title: '放弃未保存的更改？',
            body: (editorTab.title || basename(tab.path)) + ' 有未保存的修改。',
            detail: tab.path,
            confirmLabel: '放弃并关闭',
            danger: true,
            irreversible: true,
          });
          if (!accepted) return false;
        }
        editorDomain.closeTab(tab.path, { force: true });
      } else if (tab.kind === 'diff') {
        diffDomain.close();
      } else if (tab.kind === 'conflict') {
        conflictDomain.close();
      }
      layoutModel.actions.close(tabId);
      return true;
    },

    /** Batch close with one confirmation for every unsaved file involved. */
    async closeTabs(ids) {
      const snapshot = layoutModel.store.getSnapshot();
      const dirty = ids
        .map((id) => snapshot.tabs[id])
        .filter((tab) => tab?.kind === 'file' && tab.path)
        .map((tab) => editor.getSnapshot().tabs.find((item) => item.path === tab.path))
        .filter((item) => item?.dirty);
      if (dirty.length > 0) {
        const accepted = await actions.confirm({
          title: '放弃 ' + dirty.length + ' 个未保存的文件？',
          body: '以下标签有关闭后不会保留的修改：',
          detail: dirty.slice(0, 5).map((item) => item.path).join('\n') + (dirty.length > 5 ? '\n…' : ''),
          confirmLabel: '放弃并关闭',
          danger: true,
          irreversible: true,
        });
        if (!accepted) return false;
      }
      for (const id of ids) await actions.closeTabById(id, { force: true });
      return true;
    },

    closeOthers(groupId, tabId) {
      return actions.closeTabs(tabsOfGroup(groupId).filter((id) => id !== tabId));
    },

    closeGroupTabs(groupId) {
      return actions.closeTabs(tabsOfGroup(groupId));
    },

    closeAllTabs() {
      return actions.closeTabs(Object.keys(layoutModel.store.getSnapshot().tabs));
    },

    setEditorPref(key, value) {
      if (preferences) {
        preferences.actions.setEditorPref(key, value);
        return;
      }
      ui.patch({ editor: normalizeEditorPrefs({ [key]: value }, ui.getSnapshot().editor) });
      persistLayout();
    },

    toggleMenu(menu) {
      ui.patch({ menu: ui.getSnapshot().menu === menu ? null : menu });
    },

    /** Quick-open: index once per workspace visit, then just filter in the view. */
    async openQuick() {
      ui.patch({ quickOpen: true, menu: null, quickQuery: '', quickActive: 0 });
      const state = quick.getSnapshot();
      const stale = !state.paths.length || Date.now() - state.loadedAt > 60_000;
      if (!stale || state.phase === 'loading') return;
      quick.patch({ phase: 'loading', error: null });
      try {
        const listing = await client.call('files.index', { maxAgeMs: 2000 });
        quick.patch({
          phase: 'ready',
          paths: listing.paths ?? [],
          engine: listing.engine ?? null,
          total: listing.total ?? 0,
          truncated: Boolean(listing.truncated),
          loadedAt: Date.now(),
          error: null,
        });
      } catch (error) {
        quick.patch({ phase: 'error', error: error?.message ?? '无法读取文件索引' });
        fail(quick, error, '无法读取文件索引');
      }
    },

    closeQuick() {
      ui.patch({ quickOpen: false, quickQuery: '', quickActive: 0 });
    },

    setQuickQuery(query) {
      ui.patch({ quickQuery: query });
    },

    setQuickActive(index) {
      ui.patch({ quickActive: index });
    },

    /** Called after a write/delete/create so the next open re-reads the index. */
    invalidateQuickIndex() {
      quick.patch({ loadedAt: 0 });
    },

    closeDiff() {
      return actions.closeTabById(DIFF_TAB);
    },

    closeConflict() {
      return actions.closeTabById(CONFLICT_TAB);
    },

    /** Saving changes the working tree, so the SCM view has to re-read status. */
    startWatch,
    stopWatch,

    async save(path) {
      const result = await editorDomain.save(path);
      if (result) {
        quick.patch({ loadedAt: 0 });
        void actions.refreshScm();
      }
      return result;
    },

    activateTab(path) {
      return editorDomain.activateTab(path);
    },

    closeTab(path) {
      return editorDomain.closeTab(path);
    },

    setSearchQuery(query) {
      search.patch({ query });
    },

    clearSearch() {
      search.patch({ query: '', phase: 'idle', hits: [], truncated: false, engine: null, elapsedMs: 0, error: null });
    },

    async runSearch(query) {
      const needle = String(query ?? '').trim();
      if (needle.length < 2) {
        search.patch({ phase: 'idle', hits: [], error: null });
        return;
      }
      search.patch({ phase: 'loading', error: null });
      try {
        const result = await client.call('files.search', { query: needle });
        search.patch({
          phase: 'ready',
          hits: result?.hits ?? [],
          truncated: Boolean(result?.truncated),
          engine: result?.engine ?? null,
          elapsedMs: result?.elapsedMs ?? 0,
          error: null,
        });
      } catch (error) {
        search.patch({ phase: 'error', error: error?.message ?? '搜索失败' });
        fail(search, error, '搜索失败');
      }
    },

    openAt(path, line, column) {
      void actions.openFile(path).then(() => {
        editor.patch({ reveal: { path, line, column: column ?? 1, seq: Date.now() } });
      });
    },

    notify,

    dismissNotice,

    /** Panel-internal confirmation (never `window.confirm`); resolves with a boolean. */
    confirm(spec) {
      return new Promise((resolve) => {
        ui.patch({ modal: { ...spec, resolve } });
      });
    },

    /** Prompt for a single line of text; resolves with `null` when cancelled. */
    prompt(spec) {
      return new Promise((resolve) => {
        ui.patch({
          modal: {
            ...spec,
            input: spec.input ?? { label: null, value: '' },
            resolve: (value) => resolve(typeof value === 'string' && value.length ? value : null),
          },
        });
      });
    },

    resolveModal(accepted) {
      const modal = ui.getSnapshot().modal;
      if (!modal) return;
      ui.patch({ modal: null });
      if (modal.input && typeof accepted === 'string') modal.resolve?.(accepted);
      else modal.resolve?.(accepted === true);
    },

    notify,
  };

  const terminals = createTerminalController({ client, store: terminal, notify });
  const editorDomain = createEditorDomain({ client, editor, files, notify, fail });
  const graphDomain = createGraphDomain({ client, graph, fail });
  const diffDomain = createDiffDomain({ client, diff, fail, notify });
  const conflictDomain = createConflictDomain({
    client,
    conflict,
    notify,
    fail,
    refreshScm: actions.refreshScm,
    closePanel: () => { layoutModel.actions.close(CONFLICT_TAB); },
  });
  const scmDomain = createScmDomain({
    client,
    scm,
    workspace,
    notify,
    fail,
    confirm: actions.confirm,
    prompt: actions.prompt,
    refreshScm: actions.refreshScm,
    openFile: (path) => actions.openRepositoryFile(path),
  });

  const repositoriesDomain = createRepositoriesDomain({
    client, workspace, notify,
    changeReason: () => {
      if (scm.getSnapshot().writes.length) return 'Git 操作进行中，暂不能切换仓库';
      if (ui.getSnapshot().modal) return '请先完成当前确认，再切换仓库';
      if (diff.getSnapshot().phase === 'loading') return '差异正在加载，暂不能切换仓库';
      if (conflict.getSnapshot().phase === 'loading') return '冲突内容正在加载，暂不能切换仓库';
      return null;
    },
    onSelectionChange() {
      repositoryEpoch += 1;
      scmInFlight = null;
      refsLoadedAt = 0;
      scm.patch({ status: null, phase: 'idle', error: null, refs: null, stashes: [], message: '', contextMenu: null, scrollTop: 0, focusedKey: null });
      graphDomain.reset();
      diffDomain.close();
      conflictDomain.close();
      const epoch = repositoryEpoch;
      void stopWatch().then(() => {
        if (!runtimeActive || epoch !== repositoryEpoch) return;
        void actions.refreshScm();
        void startWatch();
        if (layoutModel.store.getSnapshot().tabs[GRAPH_TAB]) void graphDomain.load();
      });
    },
  });
  const commandsDomain = createCommandsDomain({ client, workspace, notify, terminals, onRun() {
    ui.patch({ panelCollapsed: false });
    persistLayout();
  } });

  // --- watcher -------------------------------------------------------------------------
  // `git.status` polling is the correctness path; the watcher only shortens the delay
  // between "file changed" and "panel shows it" (docs/git-model.md §7).
  let watchSession = null;
  let watchEpoch = 0;

  async function startWatch() {
    const epoch = ++watchEpoch;
    const previous = watchSession;
    watchSession = null;
    await releaseWatch(previous);
    if (epoch !== watchEpoch || disposed) return null;
    const repositoryPath = repositoriesDomain.store.getSnapshot().active;
    if (repositoryPath == null) return null;
    try {
      const started = await client.call('watch.start', {}, { repositoryPath });
      if (!started?.token) return null;
      const session = { token: started.token, repositoryPath, offset: 0, timer: null, pending: false };
      if (epoch !== watchEpoch || disposed || repositoriesDomain.store.getSnapshot().active !== repositoryPath) {
        await releaseWatch(session);
        return null;
      }
      watchSession = session;
      session.timer = setInterval(() => void pollWatch(), 2000);
      return started;
    } catch (error) {
      if (epoch === watchEpoch && error?.code !== 'E_UNSUPPORTED') fail(workspace, error, '无法监听文件变化');
      return null;
    }
  }

  async function pollWatch() {
    const session = watchSession;
    if (!session || session.pending) return;
    session.pending = true;
    try {
      const frame = await client.call('watch.poll', { token: session.token, offset: session.offset }, { repositoryPath: session.repositoryPath });
      if (session !== watchSession) return;
      session.offset = frame.offset;
      if (frame.dropped) {
        // Missed events mean the local view may be stale in ways we cannot enumerate.
        await actions.refreshWorkspace();
        if (session !== watchSession) return;
      }
      if ((frame.events ?? []).length > 0) {
        await actions.refreshScm();
        if (session !== watchSession) return;
        const hasGraph = Boolean(layoutModel.store.getSnapshot().tabs[GRAPH_TAB]);
        if (hasGraph && graph.getSnapshot().phase === 'ready') void graphDomain.load({ reset: true });
      }
      if (frame.stopped) {
        notify('warn', '文件监听已停止，改为手动刷新', frame.reason ? { reason: frame.reason } : null);
        await stopWatch();
      }
    } catch (error) {
      if (session === watchSession && (error?.code === 'E_LIMIT' || error?.code === 'E_UNSUPPORTED')) await stopWatch();
    } finally {
      session.pending = false;
    }
  }

  async function stopWatch() {
    watchEpoch += 1;
    const session = watchSession;
    watchSession = null;
    await releaseWatch(session);
  }

  async function releaseWatch(session) {
    if (!session) return;
    if (session.timer) clearInterval(session.timer);
    try {
      await client.call('watch.stop', { token: session.token }, { repositoryPath: session.repositoryPath });
    } catch {
      // The token may already be gone; nothing to clean up then.
    }
  }


  return {
    ui, layout: layoutModel.store, workspace, notices, files, editor, search, quick, scm, graph, diff, conflict,
    terminal, terminals,
    repositories: repositoriesDomain.store, repositoryActions: repositoriesDomain,
    commands: commandsDomain.store, commandActions: commandsDomain,
    actions: {
      ...actions,
      ...editorDomain,
      ...actions,
      setCommitMessage: (text) => scm.patch({ message: text }),
      dispose() {
        disposed = true;
        detachPreferences?.();
        if (workbenchTimer) clearTimeout(workbenchTimer);
        workbenchTimer = null;
        actions.stopScmPoll();
        void actions.stopWatch();
      },
    },

    layoutActions: layoutModel.actions,
    host,
    scmActions: scmDomain,
    diffActions: diffDomain,
    conflictActions: conflictDomain,
    graphActions: graphDomain,
    client,
    sessionId,
  };
}

function joinPath(dir, name) {
  return dir ? `${dir.replace(/\/+$/, '')}/${name}` : name;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

function basename(path) {
  const index = String(path ?? '').lastIndexOf('/');
  return index === -1 ? String(path ?? '') : String(path ?? '').slice(index + 1);
}
