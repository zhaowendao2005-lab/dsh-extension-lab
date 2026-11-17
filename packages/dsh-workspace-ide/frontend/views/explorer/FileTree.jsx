import { useStore, useRef } from '../../runtime.js';
import { visibleExplorerRows } from '../../service/explorer-selection.js';
import { localPoint, workbenchRoot } from '../../service/geometry.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';

let nextMenuSurface = 0;

export function openExplorerMenu(stores, element, path, clientX, clientY) {
  const root = workbenchRoot(element);
  if (!root) return;
  if (!root.dataset.explorerMenuSurface) root.dataset.explorerMenuSurface = 'explorer-' + (++nextMenuSurface);
  const point = localPoint(root, clientX, clientY, 224, 270);
  stores.explorerSelectionActions.openMenu(path, { ...point, surface: root.dataset.explorerMenuSurface });
}

/** Paginated directory DOM and selection remain separate from file mutation actions. */
export function FileTree({ stores }) {
  const files = useStore(stores.files);
  const workspace = useStore(stores.workspace);
  const selection = useStore(stores.explorerSelection);
  const tree = useRef(null);
  const domain = stores.explorerSelectionActions;
  const rows = visibleExplorerRows(files);
  const rootEntries = files.entries['']?.entries ?? null;
  const entries = domain.selectedEntries();
  const openPaths = entries.filter((entry) => entry.type === 'file').map((entry) => entry.path);

  function focusRow(path) {
    const element = [...(tree.current?.querySelectorAll('[data-explorer-path]') ?? [])]
      .find((row) => row.dataset.explorerPath === path);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(event) {
    if (event.target.closest('button')) return;
    const row = event.target.closest('[data-explorer-path]');
    if (!row) return;
    const path = row.dataset.explorerPath;
    const index = rows.findIndex((entry) => entry.path === path);
    const entry = rows[index];
    const modifier = event.metaKey || event.ctrlKey;
    let next = null;
    if (event.key === 'ArrowDown') next = rows[Math.min(rows.length - 1, index + 1)]?.path;
    if (event.key === 'ArrowUp') next = rows[Math.max(0, index - 1)]?.path;
    if (event.key === 'Home') next = rows[0]?.path;
    if (event.key === 'End') next = rows[rows.length - 1]?.path;
    if (next != null) {
      event.preventDefault(); event.stopPropagation();
      if (modifier && !event.shiftKey) domain.focus(next);
      else domain.select(next, { toggle: modifier, range: event.shiftKey });
      focusRow(next);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); domain.selectAll();
    } else if (event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      domain.select(path, { toggle: true, range: event.shiftKey });
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (!selection.selected.includes(path)) {
        domain.select(path);
        if (entry?.type === 'directory') stores.actions.toggleDir(path);
        else if (entry?.type === 'file') void stores.actions.openFile(path);
      } else if (entries.length === 1 && entries[0].type === 'directory') stores.actions.toggleDir(path);
      else if (openPaths.length) void stores.actions.openExplorerEntries(openPaths);
    } else if (event.key === 'ArrowRight' && entry?.type === 'directory') {
      event.preventDefault(); event.stopPropagation();
      if (!files.expanded.includes(path)) stores.actions.toggleDir(path);
      else if (rows[index + 1]?.depth > entry.depth) { domain.select(rows[index + 1].path); focusRow(rows[index + 1].path); }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation();
      if (entry?.type === 'directory' && files.expanded.includes(path)) stores.actions.toggleDir(path);
      else if (path.includes('/')) { const parent = path.slice(0, path.lastIndexOf('/')); domain.select(parent); focusRow(parent); }
    } else if (event.key === 'F2' && selection.selected.length === 1) {
      event.preventDefault(); event.stopPropagation(); void stores.actions.renameEntry(selection.selected[0]);
    } else if (event.key === 'Delete' && selection.selected.length) {
      event.preventDefault(); event.stopPropagation(); void stores.actions.deleteExplorerEntries(domain.deletionPaths());
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); domain.clear();
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault(); event.stopPropagation();
      const rect = row.getBoundingClientRect();
      openExplorerMenu(stores, row, path, rect.left + 20, rect.bottom);
    }
  }

  if (!workspace.root) return null;
  if (!rootEntries) return <div className="wid-empty"><span className="wid-hint">{files.loading.includes('') ? '读取目录…' : '目录为空'}</span></div>;
  return <>
    <div ref={tree} className="wid-tree" role="tree" aria-label="文件" aria-multiselectable="true" onKeyDown={onKeyDown}>
      <DirRows stores={stores} entries={rootEntries} parent="" depth={0} files={files} selection={selection} />
      {files.entries['']?.truncated && <div className="wid-tree__truncated wid-hint">目录条目超过上限，未完整显示</div>}
    </div>
  </>;
}

function DirRows({ stores, entries, parent, depth, files, selection }) {
  const visibleEntries = entries.filter((entry) => entry.name !== '.git');
  const rows = visibleEntries.slice(0, files.visible[parent] ?? 300);
  const rest = visibleEntries.length - rows.length;
  return <>
    {rows.map((entry) => <TreeRow key={entry.name} stores={stores} entry={entry}
      path={parent ? parent + '/' + entry.name : entry.name} depth={depth} files={files} selection={selection} />)}
    {rest > 0 && <button type="button" className="wid-tree__more" style={{ paddingInlineStart: (8 + 12 * depth) + 'px' }}
      onClick={() => stores.actions.showMoreEntries(parent)}>显示更多（还有 {rest} 项）</button>}
  </>;
}

function TreeRow({ stores, entry, path, depth, files, selection }) {
  const isDir = entry.type === 'directory';
  const expanded = isDir && files.expanded.includes(path);
  const selected = selection.selected.includes(path);
  const children = files.entries[path]?.entries ?? null;
  const domain = stores.explorerSelectionActions;
  function menu(event) {
    event.preventDefault(); event.stopPropagation();
    if (event.ctrlKey && event.button === 0) {
      domain.select(path, { toggle: true });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openExplorerMenu(stores, event.currentTarget, path, event.clientX || rect.left, event.clientY || rect.bottom);
  }
  return <>
    <div className="wid-tree__row" data-explorer-path={path} data-ignored={entry.ignored ? 'true' : undefined}
      role="treeitem" aria-level={depth + 1} aria-label={entry.name} aria-expanded={isDir ? expanded : undefined}
      aria-selected={selected} tabIndex={selection.focused === path ? 0 : -1}
      style={{ paddingInlineStart: (8 + 12 * depth) + 'px' }} onContextMenu={menu}
      onClick={(event) => {
        event.stopPropagation(); event.currentTarget.focus();
        const modified = event.metaKey || event.ctrlKey || event.shiftKey;
        domain.select(path, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey });
        if (isDir && !modified) stores.actions.toggleDir(path);
        else if (!isDir && !modified) void stores.actions.openFile(path);
      }}>
      <span className="wid-tree__chevron">{isDir ? <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} /> : null}</span>
      <span className="wid-tree__icon">{isDir ? <Icon name="folder" size={12} /> : <FileIcon name={entry.name} size={14} />}</span>
      <span className="wid-tree__name" title={path}>{entry.name}</span>
      <span className="wid-tree__actions">
        <button type="button" className="wid-icon-button" title={'文件与目录操作：' + entry.name} aria-label={'更多操作：' + entry.name} aria-haspopup="menu" onClick={menu}>⋯</button>
      </span>
    </div>
    {expanded && children && <DirRows stores={stores} entries={children} parent={path} depth={depth + 1} files={files} selection={selection} />}
    {expanded && !children && <div className="wid-tree__row wid-hint" style={{ paddingInlineStart: (8 + 12 * (depth + 1)) + 'px' }}>{files.loading.includes(path) ? '读取中…' : '空目录'}</div>}
  </>;
}
