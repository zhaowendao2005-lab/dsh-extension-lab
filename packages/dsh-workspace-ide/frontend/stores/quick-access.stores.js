import { createStore } from '../store.js';
import { rankPaths } from '../service/fuzzy.js';
import { FILE_EXCLUDES, SEARCH_EXCLUDES, quickMode, rankCommands, rememberCommand } from '../service/quick-access.js';
import { createQuickAccessDatasource } from './quick-access.datasource.js';

const HISTORY_KEY = 'dsh-workspace-ide/quick-command-history/v1';
const FILE_HISTORY_KEY = 'dsh-workspace-ide/quick-file-history/v1';
const FILTER_KEY = 'dsh-workspace-ide/quick-filters/v1/';
const LIMIT = 100;
const emptyFilter = () => ({ include: '', exclude: '' });
const defaults = () => ({ files: emptyFilter(), content: emptyFilter(), useIgnoreFiles: true,
  filesExclude: [...FILE_EXCLUDES], searchExclude: [...SEARCH_EXCLUDES] });
const initial = () => ({ open: false, query: '', mode: 'files', phase: 'idle', results: [], active: 0,
  error: null, include: '', exclude: '', useIgnoreFiles: true, filters: defaults(), total: 0,
  truncated: false, warnings: [], engine: null, elapsedMs: 0 });

/** Query, filters, selection and lifetime guards live here; views hold DOM handles only. */
export function createQuickAccessDomain({ client, workspace, openFile, openAt, dispatchCommand, commandEnabled = () => true }) {
  const store = createStore(initial());
  const source = createQuickAccessDatasource(client);
  let generation = 0;
  let timer = null;
  let cache = null;
  let root = workspace.getSnapshot().root;
  let disposed = false;
  let recent = readHistory();
  let recentFiles = readJson(FILE_HISTORY_KEY, []).filter((path) => typeof path === 'string').slice(0, 50);

  function readJson(key, fallback) {
    try { return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') ?? fallback; }
    catch { return fallback; } // Optional presentation persistence must not prevent opening the panel.
  }
  function saveJson(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); }
    catch { /* Storage can be unavailable or full; the in-memory selection remains usable. */ }
  }
  function readHistory() {
    const value = readJson(HISTORY_KEY, []);
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(0, 50) : [];
  }
  function readFilters() {
    const value = readJson(FILTER_KEY + encodeURIComponent(root ?? ''), {});
    const clean = (item) => ({ include: typeof item?.include === 'string' ? item.include.slice(0, 2000) : '', exclude: typeof item?.exclude === 'string' ? item.exclude.slice(0, 2000) : '' });
    const list = (item, fallback) => Array.isArray(item) ? item.filter((glob) => typeof glob === 'string').slice(0, 100) : fallback;
    return { files: clean(value.files), content: clean(value.content), useIgnoreFiles: value.useIgnoreFiles !== false,
      filesExclude: list(value.filesExclude, [...FILE_EXCLUDES]), searchExclude: list(value.searchExclude, [...SEARCH_EXCLUDES]) };
  }
  function patchFilters(filters, mode = store.getSnapshot().mode) {
    const selected = filters[mode === 'content' ? 'content' : 'files'];
    store.patch({ filters, include: selected.include, exclude: selected.exclude, useIgnoreFiles: filters.useIgnoreFiles });
  }
  function invalidate() {
    generation += 1;
    cache = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function current(epoch, requestRoot) {
    return !disposed && epoch === generation && requestRoot === workspace.getSnapshot().root && store.getSnapshot().open;
  }
  function commandResults() {
    const state = store.getSnapshot();
    store.patch({ phase: 'ready', results: rankCommands(state.query, recent, commandEnabled), active: 0,
      error: null, truncated: false, total: 10, warnings: [], engine: null });
  }
  function fileResults(paths) {
    const order = new Map(recentFiles.map((path, index) => [path, index]));
    return rankPaths(paths, store.getSnapshot().query, paths.length).map((item) => ({ ...item, id: item.path, kind: 'file', label: item.path, recentIndex: order.get(item.path) ?? Infinity }))
      .sort((a, b) => a.recentIndex - b.recentIndex || b.score - a.score).slice(0, LIMIT);
  }
  async function run(force = false) {
    invalidate();
    const state = store.getSnapshot();
    if (!state.open || disposed) return;
    if (state.mode === 'commands') { commandResults(); return; }
    if (!root) { store.patch({ phase: 'idle', results: [], error: '请先打开工作区' }); return; }
    if (state.mode === 'content' && !state.query.trim()) { store.patch({ phase: 'idle', results: [], error: null, total: 0, warnings: [] }); return; }
    const epoch = generation;
    const requestRoot = root;
    const queryId = 'quick-' + epoch + '-' + Date.now();
    const excludeGlobs = [...new Set([...state.filters.filesExclude, ...(state.mode === 'content' ? state.filters.searchExclude : [])])];
    const common = { include: state.include, exclude: state.exclude, useIgnoreFiles: state.useIgnoreFiles, excludeGlobs, queryId };
    const cacheKey = JSON.stringify([root, state.include, state.exclude, state.useIgnoreFiles, excludeGlobs]);
    if (state.mode === 'files' && !force && cache?.key === cacheKey && Date.now() - cache.at < 60_000) {
      store.patch({ ...cache.metadata, phase: 'ready', results: fileResults(cache.paths), error: null });
      return;
    }
    store.patch({ phase: 'loading', error: null, results: [], total: 0, warnings: [] });
    try {
      const result = state.mode === 'content'
        ? await source.search({ ...common, query: state.query, maxResults: LIMIT })
        : await source.index({ ...common, maxAgeMs: force ? 0 : 2000 });
      if (!current(epoch, requestRoot) || (result.queryId != null && result.queryId !== queryId)) return;
      const metadata = { total: result.total ?? result.hits?.length ?? 0, truncated: Boolean(result.truncated), warnings: result.warnings ?? [], engine: result.engine ?? null, elapsedMs: result.elapsedMs ?? 0 };
      let results;
      if (state.mode === 'files') {
        const paths = result.paths ?? [];
        cache = { key: cacheKey, at: Date.now(), paths, metadata };
        results = fileResults(paths);
      } else results = (result.hits ?? []).map((hit, index) => ({ ...hit, kind: 'content', id: hit.path + ':' + hit.line + ':' + hit.column + ':' + index, label: hit.path }));
      store.patch({ ...metadata, phase: 'ready', results, active: 0, error: null });
    } catch (error) {
      if (current(epoch, requestRoot)) store.patch({ phase: 'error', results: [], error: error?.message ?? '搜索失败' });
    }
  }
  function schedule(delay = 180) {
    invalidate();
    const state = store.getSnapshot();
    if (!state.open) return;
    if (state.mode === 'commands') { commandResults(); return; }
    store.patch({ results: [], active: 0, error: null, phase: state.mode === 'content' && !state.query.trim() ? 'idle' : 'loading' });
    timer = setTimeout(() => { timer = null; void run(); }, delay);
  }
  function close() {
    invalidate();
    store.patch({ open: false, query: '', results: [], active: 0, phase: 'idle', error: null });
  }
  function open(options = {}) {
    if (disposed) return;
    const requested = typeof options === 'string' ? { mode: options } : options;
    const query = String(requested.query ?? (requested.mode === 'commands' ? '/' : ''));
    const mode = quickMode(query, requested.mode);
    store.patch({ open: true, query, mode, active: 0, error: null, results: [] });
    patchFilters(readFilters(), mode);
    return run();
  }
  function setQuery(value) {
    const query = String(value).slice(0, 4000);
    const state = store.getSnapshot();
    const mode = quickMode(query, state.mode);
    store.patch({ query, mode, active: 0 });
    if (mode !== state.mode) patchFilters(state.filters, mode);
    schedule(mode === 'content' ? 220 : 60);
  }
  function setMode(mode) {
    if (!['files', 'content', 'commands'].includes(mode)) return;
    const state = store.getSnapshot();
    const query = mode === 'commands' ? '/' : state.query.replace(/^\s*\//, '');
    store.patch({ mode, query, active: 0 });
    patchFilters(state.filters, mode);
    void run();
  }
  function setFilter(name, value) {
    const state = store.getSnapshot();
    const filters = { ...state.filters };
    if (name === 'useIgnoreFiles') filters.useIgnoreFiles = Boolean(value);
    else if (name === 'include' || name === 'exclude') {
      const mode = state.mode === 'content' ? 'content' : 'files';
      filters[mode] = { ...filters[mode], [name]: String(value).slice(0, 2000) };
    } else return;
    patchFilters(filters);
    saveJson(FILTER_KEY + encodeURIComponent(root ?? ''), filters);
    cache = null;
    schedule();
  }
  function setExclusions({ files, search } = {}) {
    const filters = { ...store.getSnapshot().filters };
    if (Array.isArray(files)) filters.filesExclude = files.filter((item) => typeof item === 'string').slice(0, 100);
    if (Array.isArray(search)) filters.searchExclude = search.filter((item) => typeof item === 'string').slice(0, 100);
    patchFilters(filters);
    saveJson(FILTER_KEY + encodeURIComponent(root ?? ''), filters);
    cache = null;
    schedule();
  }
  function setActive(index) {
    store.patch({ active: Math.min(Math.max(0, Number(index) || 0), Math.max(0, store.getSnapshot().results.length - 1)) });
  }
  function recordFile(path) {
    const value = String(path ?? '');
    if (!value) return;
    recentFiles = [value, ...recentFiles.filter((item) => item !== value)].slice(0, 50);
    saveJson(FILE_HISTORY_KEY, recentFiles);
  }
  async function choose(index = store.getSnapshot().active) {
    const operationRoot = root;
    const operationGeneration = generation;
    const state = store.getSnapshot();
    const result = state.results[index];
    if (!result || state.phase !== 'ready' || result.disabled) return false;
    if (result.kind === 'command') {
      const capability = commandEnabled(result.id);
      if (capability === false || typeof capability === 'string') { commandResults(); return false; }
    }
    close();
    try {
      const selected = result.kind === 'command' ? await dispatchCommand(result.id)
        : result.kind === 'content' ? await openAt(result.path, result.line, result.column) : await openFile(result.path);
      if (selected === false || selected === null) return false;
      if (result.kind === 'file' || result.kind === 'content') recordFile(result.path);
      if (result.kind === 'command') {
        recent = rememberCommand(recent, result.id);
        saveJson(HISTORY_KEY, recent);
        if (store.getSnapshot().open && store.getSnapshot().mode === 'commands') commandResults();
      }
      return true;
    } catch (error) {
      if (!disposed && operationRoot === workspace.getSnapshot().root) store.patch({ open: true, query: state.query, mode: state.mode, phase: 'error', error: error?.message ?? '无法打开所选项目' });
      return false;
    }
  }
  function reset() {
    invalidate();
    cache = null;
    root = workspace.getSnapshot().root;
    store.set(initial());
    patchFilters(readFilters());
  }
  const unsubscribe = workspace.subscribe(() => { if (root !== workspace.getSnapshot().root) reset(); });
  const actions = { open, close, setQuery, setMode, setFilter, setExclusions, setActive, choose, recordFile,
    move: (delta) => setActive(store.getSnapshot().active + delta), refresh: () => run(true),
    invalidate: () => { cache = null; if (store.getSnapshot().open) schedule(); } };
  return { store, actions, reset, dispose() { disposed = true; invalidate(); unsubscribe(); store.dispose(); } };
}
