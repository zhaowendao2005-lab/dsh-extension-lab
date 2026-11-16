/**
 * Tab identity for the internal workbench. File tabs are keyed by path; the views that only
 * exist once in a workspace are singletons. Ids never encode display text.
 */

export const TAB_KINDS = ['file', 'diff', 'conflict', 'graph', 'changes', 'repositories', 'commands'];

export const DIFF_TAB = 'view:diff';
export const CONFLICT_TAB = 'view:conflict';
export const GRAPH_TAB = 'view:graph';
export const CHANGES_TAB = 'view:changes';
export const REPOSITORIES_TAB = 'view:repositories';
export const COMMANDS_TAB = 'view:commands';

/** File tab id: path-keyed so two opens are one tab. */
export function fileTabId(path) {
  return 'file:' + path;
}

/** Path behind a file tab id, or null for every other kind. */
export function filePathOf(tab) {
  if (!tab || tab.kind !== 'file') return null;
  if (typeof tab.path === 'string') return tab.path;
  const id = String(tab.id ?? '');
  return id.startsWith('file:') ? id.slice('file:'.length) : null;
}

/** Every singleton view's id. */
export function isViewTab(tab) {
  return Boolean(tab) && tab.kind !== 'file' && tab.kind !== 'diff' && tab.kind !== 'conflict';
}

/** Human title for the chips: file tabs use their basename, views their fixed label. */
export function tabTitle(tab, editorTab) {
  if (!tab) return '';
  if (tab.kind === 'file') {
    if (tab.title) return tab.title;
    const path = filePathOf(tab) ?? '';
    return path.slice(path.lastIndexOf('/') + 1) || path;
  }
  if (tab.kind === 'diff') return '差异';
  if (tab.kind === 'conflict') return '冲突';
  if (tab.kind === 'graph') return '提交图谱';
  if (tab.kind === 'changes') return '改动';
  if (tab.kind === 'repositories') return '仓库';
  if (tab.kind === 'commands') return '命令';
  return tab.title || tab.id || '未命名';
}

/** Which icon name (see Icon.jsx) a tab kind uses. */
export function tabIcon(kind) {
  if (kind === 'graph') return 'graph';
  if (kind === 'changes') return 'scm';
  if (kind === 'repositories') return 'branch';
  if (kind === 'commands') return 'terminal';
  if (kind === 'diff') return 'diff';
  if (kind === 'conflict') return 'warning';
  return 'file';
}

/** Kind of a view tab id, used when restoring saved layouts. */
export function kindOfViewId(id) {
  if (id === GRAPH_TAB) return 'graph';
  if (id === CHANGES_TAB) return 'changes';
  if (id === REPOSITORIES_TAB) return 'repositories';
  if (id === COMMANDS_TAB) return 'commands';
  if (id === DIFF_TAB) return 'diff';
  if (id === CONFLICT_TAB) return 'conflict';
  return null;
}
