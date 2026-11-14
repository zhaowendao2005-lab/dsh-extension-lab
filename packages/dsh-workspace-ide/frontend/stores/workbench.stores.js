/**
 * Every store the panel needs, plus the cross-domain actions that wire them to
 * each other (ARCHITECTURE.md → 状态所有权). Views read stores and call actions;
 * they never hold their own state and never call the datasource directly.
 */
import { createStore } from '../store.js';
import { LIMITS } from '../../shared/contract.js';
import { IdeError, isTrustError } from '../service/client.js';
import { DEFAULT_EDITOR_PREFS, loadLayout, readEditorPrefs, saveLayout } from '../service/layout.js';
import { createTerminalController } from './terminal.stores.js';
import { createEditorDomain } from './editor.stores.js';
import { createScmDomain } from './scm.stores.js';
import { createConflictDomain, createConflictStore } from './conflict.stores.js';
import { createGraphDomain } from './graph.stores.js';
import { createDiffDomain } from './diff.stores.js';

const EMPTY_LIMITS = LIMITS;

export function createStores({ client, sessionId, host }) {
  const ui = createStore({
    activityView: 'explorer',
    sidebarWidth: 260,
    panelHeight: 220,
    sidebarCollapsed: false,
    panelCollapsed: false,
    settingsOpen: false,
    menu: null,
    diffOpen: false,
    diffRatio: 0.5,
    editor: { ...DEFAULT_EDITOR_PREFS },
    modal: null,
    conflictOpen: false,
    quickOpen: false,
    quickQuery: '',
    quickActive: 0,
  });

  const workspace = createStore({
    phase: 'idle',
    root: null,
    name: null,
    git: { available: false, isRepo: false, branch: null, detached: false },
    trust: false,
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
    phase: 'idle',
    error: null,
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

  function notify(level, message, detail) {
    noticeId += 1;
    const item = { id: noticeId, level, message, detail: detail ?? null, at: Date.now() };
    notices.set((current) => ({ items: [...current.items, item].slice(-6) }));
    return item.id;
  }

  function dismissNotice(id) {
    notices.set((current) => ({ items: current.items.filter((item) => item.id !== id) }));
  }

  /** Uniform failure handling: an error bar line, and the code kept for the view. */
  function fail(scope, error, fallback) {
    const message = error instanceof IdeError ? error.message : (error?.message ?? fallback ?? '操作失败');
    notify('error', message, error instanceof IdeError ? error.detail : null);
    scope?.patch?.({ error: message });
    return error;
  }

  function restoreLayout(state = ui.getSnapshot()) {
    const persisted = loadLayout();
    ui.patch({
      sidebarWidth: clamp(persisted.sidebarWidth ?? state.sidebarWidth, 180, 600),
      panelHeight: clamp(persisted.panelHeight ?? state.panelHeight, 120, 600),
      sidebarCollapsed: Boolean(persisted.sidebarCollapsed),
      panelCollapsed: Boolean(persisted.panelCollapsed),
      activityView: persisted.activityView ?? state.activityView,
      editor: readEditorPrefs(persisted),
    });
  }

  function persistLayout() {
    const state = ui.getSnapshot();
    saveLayout({
      sidebarWidth: state.sidebarWidth,
      panelHeight: state.panelHeight,
      sidebarCollapsed: state.sidebarCollapsed,
      panelCollapsed: state.panelCollapsed,
      activityView: state.activityView,
      editor: state.editor,
    });
  }

  const actions = {
    restoreLayout,

    setActivity(view) {
      ui.patch({ activityView: view, sidebarCollapsed: ui.getSnapshot().sidebarCollapsed && view !== 'terminal' ? false : ui.getSnapshot().sidebarCollapsed });
      persistLayout();
    },

    toggleSidebar() {
      ui.patch({ sidebarCollapsed: !ui.getSnapshot().sidebarCollapsed });
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

    toggleSettings() {
      ui.patch({ settingsOpen: !ui.getSnapshot().settingsOpen });
    },

    async boot() {
      workspace.patch({ phase: 'loading' });
      try {
        const resolved = await client.call('workspace.resolve', {});
        workspace.patch({
          phase: 'ready',
          root: resolved.root ?? null,
          name: resolved.name ?? null,
          git: resolved.git ?? { available: false, isRepo: false },
          trust: Boolean(resolved.trusted),
          recents: resolved.recents ?? [],
          limits: resolved.limits ?? EMPTY_LIMITS,
          error: null,
        });
        if (resolved.root) {
          await actions.refreshWorkspace();
          void actions.startWatch();
        }
        // A browser refresh leaves the Host owning live PTYs; adopt them instead of showing
        // an empty panel and leaking processes until the idle reaper fires.
        void terminals.reconcile();
      } catch (error) {
        console.error('[workspace-ide] boot failed', error);
        workspace.patch({ phase: 'error', error: error?.message ?? '无法确定工作区' });
        fail(workspace, error, '无法确定工作区');
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
          trust: Boolean(next.trusted),
        });
        await actions.listDir('');
        await actions.refreshScm();
      } catch (error) {
        fail(workspace, error, '无法读取工作区状态');
      }
    },

    /** Ask the host for a directory, then open it. No silent fallbacks. */
    async pickRoot() {
      if (typeof host?.pickDirectory !== 'function') {
        notify('error', '宿主没有提供目录选择器', null);
        return;
      }
      try {
        const picked = await host.pickDirectory();
        const root = typeof picked === 'string' ? picked : picked?.path;
        if (root) await actions.openRoot(root);
      } catch (error) {
        fail(workspace, error, '选择目录失败');
      }
    },

    async openRoot(root) {
      try {
        const opened = await client.call('workspace.open', { root });
        workspace.patch({ root: opened.root, name: opened.name, git: opened.git, trust: Boolean(opened.trusted), phase: 'ready', error: null });
        diffDomain.close();
        ui.patch({ diffOpen: false, menu: null });
        files.patch({ entries: {}, expanded: [], selected: null, loading: [], error: null, visible: {} });
        editor.patch({ tabs: [], activePath: null, conflicts: [], reveal: null });
        graph.patch({
          rows: [], commits: [], maxLane: 0, hasMore: false, loadingMore: false, selected: null,
          phase: 'idle', error: null, layoutMs: 0, refs: null, filter: '', filterRef: null,
        });
        await actions.listDir('');
        await actions.refreshScm();
        // The old watcher token belongs to the previous root; rebind it after the switch.
        void actions.startWatch();
      } catch (error) {
        fail(workspace, error, '无法打开该目录');
      }
    },

    async setTrusted(trusted) {
      const state = workspace.getSnapshot();
      if (!state.root) return;
      try {
        const next = await client.call('workspace.trust', { trusted });
        workspace.patch({ trust: Boolean(next.trusted) });
        if (next.trusted) await actions.refreshWorkspace();
      } catch (error) {
        fail(workspace, error, '无法更新信任设置');
      }
    },

    /** Called by any view that gets E_TRUST_REQUIRED: show the trust gate once. */
    handleTrustError(error) {
      if (!isTrustError(error)) return false;
      notify('warn', '此操作需要先信任当前工作区', error.detail ?? null);
      return true;
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

    async refreshScm() {
      const state = workspace.getSnapshot();
      if (!state.root || !state.git?.isRepo) {
        scm.patch({ status: null, phase: 'idle', error: null, writes: [], refs: null, stashes: [] });
        return;
      }
      scm.patch({ phase: 'loading' });
      try {
        const status = await client.call('git.status', { untrackedMode: 'all' });
        scm.patch({ status, phase: 'ready', error: null });
        // Branch/stash lists are cheap (`for-each-ref` + `stash list`) and only needed once the
        // repository is known to be valid, so they ride along with every status refresh.
        void scmDomain.loadRefs();
        void scmDomain.loadStashes();
      } catch (error) {
        scm.patch({ phase: 'error' });
        fail(scm, error, '无法读取 Git 状态');
      }
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

    /** Kept as the single entry point for views: delegates to the editor domain. */
    openDiff(target, path) {
      ui.patch({ diffOpen: true });
      return diffDomain.open(target, path);
    },

    setEditorPref(key, value) {
      ui.patch({ editor: { ...ui.getSnapshot().editor, [key]: value } });
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
      diffDomain.close();
      ui.patch({ diffOpen: false });
    },

    async openConflict(path) {
      ui.patch({ conflictOpen: true, diffOpen: false });
      return await conflictDomain.open(path);
    },

    closeConflict() {
      conflictDomain.close();
      ui.patch({ conflictOpen: false });
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

    openFile(path) {
      ui.patch({ quickOpen: false });
      // Opening a real file leaves the read-only diff surface.
      if (ui.getSnapshot().diffOpen) ui.patch({ diffOpen: false });
      return editorDomain.openPath(path);
    },

    activateTab(path) {
      return editorDomain.activateTab(path);
    },

    closeTab(path) {
      return editorDomain.closeTab(path);
    },

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
    closePanel: () => ui.patch({ conflictOpen: false }),
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
    openFile: (path) => editorDomain.openPath(path),
  });

  // --- watcher -------------------------------------------------------------------------
  // `git.status` polling is the correctness path; the watcher only shortens the delay
  // between "file changed" and "panel shows it" (docs/git-model.md §7).
  let watchSession = null;

  async function startWatch() {
    await stopWatch();
    try {
      const started = await client.call('watch.start', {});
      if (!started?.token) return null;
      watchSession = { token: started.token, offset: 0, timer: null, pending: false };
      watchSession.timer = setInterval(() => void pollWatch(), 2000);
      return started;
    } catch (error) {
      if (error?.code !== 'E_UNSUPPORTED') fail(workspace, error, '无法监听文件变化');
      return null;
    }
  }

  async function pollWatch() {
    const session = watchSession;
    if (!session || session.pending) return;
    session.pending = true;
    try {
      const frame = await client.call('watch.poll', { token: session.token, offset: session.offset });
      session.offset = frame.offset;
      if (frame.dropped) {
        // Missed events mean the local view may be stale in ways we cannot enumerate.
        await actions.refreshWorkspace();
      }
      if ((frame.events ?? []).length > 0) {
        await actions.refreshScm();
        const view = ui.getSnapshot().activityView;
        if (view === 'graph' && graph.getSnapshot().phase === 'ready') void graphDomain.load({ reset: true });
      }
      if (frame.stopped) {
        notify('warn', '文件监听已停止，改为手动刷新', frame.reason ? { reason: frame.reason } : null);
        await stopWatch();
      }
    } catch (error) {
      if (error?.code === 'E_LIMIT' || error?.code === 'E_UNSUPPORTED') await stopWatch();
    } finally {
      session.pending = false;
    }
  }

  async function stopWatch() {
    const session = watchSession;
    watchSession = null;
    if (!session) return;
    if (session.timer) clearInterval(session.timer);
    try {
      await client.call('watch.stop', { token: session.token });
    } catch {
      // The token may already be gone; nothing to clean up then.
    }
  }


  return {
    ui, workspace, notices, files, editor, search, quick, scm, graph, diff, conflict, terminal, terminals,
    actions: { ...actions, ...editorDomain, setCommitMessage: (text) => scm.patch({ message: text }) },

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
