import { useStore, useRef } from '../../runtime.js';
import { visibleExplorerRows } from '../../service/explorer-selection.js';
import { localPoint, workbenchRoot } from '../../service/geometry.js';
import {
  baseNameOf, canMoveToDir, createDragOverlayController, findChatDropTarget,
  formatDropPathsForChat, insertTextIntoChatComposer, normalizeMoveTargets, parentDirOf,
} from '../../service/explorer-drag.js';
import { zoneAt } from '../../service/split.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';

let nextMenuSurface = 0;
let suppressNextRowClickAt = 0;

function beginExplorerDrag(event, stores, path, entry) {
  if (event.button !== 0) return;
  if (event.target?.closest?.('button')) return;
  const domain = stores.explorerSelectionActions;
  const selection = domain.store.getSnapshot();
  const selectedEntries = selection.selected.includes(path)
    ? domain.selectedEntries()
    : [{ path, type: entry.type }];
  const sources = normalizeMoveTargets(selectedEntries.length ? selectedEntries : [{ path, type: entry.type }]);
  if (!sources.length) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const root = workbenchRoot(event.currentTarget);
  const scopeRoot = root?.getRootNode?.() ?? document;
  const overlay = createDragOverlayController(event.currentTarget);

  let dragging = false;
  let finished = false;
  let raf = 0;
  let pending = null;
  let highlightedEl = null;
  let expandTimer = 0;
  let expandPath = null;
  let dropState = null;

  function setDropHighlight(el, status) {
    if (highlightedEl && highlightedEl !== el) {
      highlightedEl.removeAttribute('data-wid-drop-target');
    }
    highlightedEl = el ?? null;
    if (highlightedEl && status) {
      highlightedEl.setAttribute('data-wid-drop-target', status);
    }
  }

  function clearExpandTimer() {
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = 0;
    expandPath = null;
  }

  function scheduleExpand(dirPath) {
    if (expandPath === dirPath) return;
    clearExpandTimer();
    if (!dirPath) return;
    if (stores.files.getSnapshot().expanded.includes(dirPath)) return;
    expandPath = dirPath;
    expandTimer = setTimeout(() => {
      expandTimer = 0;
      if (!finished && dragging && !stores.files.getSnapshot().expanded.includes(dirPath)) {
        stores.actions.toggleDir(dirPath);
      }
    }, 500);
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
    window.removeEventListener('keydown', onKey, true);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pending = null;
    clearExpandTimer();
    setDropHighlight(null, null);
    stores.actions.setExplorerDrop(null);
    overlay.dispose();
    if (root) delete root.dataset.widDragging;
  }

  function sourceSummary() {
    if (sources.length === 1) return baseNameOf(sources[0].path);
    return sources.length + ' 项';
  }

  function applyMove(moveEvent) {
    const x = moveEvent.clientX;
    const y = moveEvent.clientY;
    if (!dragging) {
      if (Math.hypot(x - startX, y - startY) < 4) return;
      dragging = true;
      suppressNextRowClickAt = Date.now();
      if (root) root.dataset.widDragging = 'true';
    }

    const peeking = overlay.isFullView ? overlay.updatePeeking(x, y) : false;
    const hit = !peeking && typeof scopeRoot?.elementFromPoint === 'function'
      ? scopeRoot.elementFromPoint(x, y)
      : null;
    const insideWorkbench = Boolean(hit && root && workbenchRoot(hit) === root);

    if (insideWorkbench) {
      overlay.setChatTarget(null, '');
      const row = hit.closest?.('[data-explorer-path]');
      if (row) {
        stores.actions.setExplorerDrop(null);
        const rowPath = row.dataset.explorerPath;
        const rowType = row.dataset.explorerType;
        const targetDir = rowType === 'directory' ? rowPath : parentDirOf(rowPath);
        if (rowType === 'directory') scheduleExpand(rowPath);
        else clearExpandTimer();
        const check = canMoveToDir(sources, targetDir);
        const highlightNode = rowType === 'directory' ? row : row.closest('.wid-nav__body');
        setDropHighlight(highlightNode, check.valid ? 'true' : 'invalid');
        dropState = check.valid ? { kind: 'move', targetDir } : null;
        overlay.updatePosition(
          x,
          y,
          check.valid
            ? '移动 ' + sourceSummary() + ' → ' + (targetDir || '根目录')
            : (check.reason ?? '无法移动到此处'),
          check.valid ? 'move' : 'invalid',
        );
        return;
      }

      clearExpandTimer();
      const navBody = hit.closest?.('.wid-nav__body');
      if (navBody) {
        stores.actions.setExplorerDrop(null);
        const check = canMoveToDir(sources, '');
        setDropHighlight(navBody, check.valid ? 'true' : 'invalid');
        dropState = check.valid ? { kind: 'move', targetDir: '' } : null;
        overlay.updatePosition(
          x,
          y,
          check.valid ? '移动 ' + sourceSummary() + ' → 根目录' : (check.reason ?? '已在根目录'),
          check.valid ? 'move' : 'invalid',
        );
        return;
      }

      setDropHighlight(null, null);
      const groupEl = hit.closest?.('[data-wid-group]');
      const firstFile = sources.find((item) => item.type === 'file');
      if (groupEl && firstFile) {
        const groupId = groupEl.getAttribute('data-wid-group');
        const body = groupEl.querySelector('.wid-group__body');
        const rect = body?.getBoundingClientRect?.();
        const zone = rect ? zoneAt(rect, x, y) : 'center';
        const effectiveZone = zone && stores.actions.canDrop(groupId, zone) ? zone : 'center';
        stores.actions.setExplorerDrop({ groupId, zone: effectiveZone });
        dropState = { kind: 'open', groupId, zone: effectiveZone, files: sources.filter((item) => item.type === 'file').map((item) => item.path) };
        overlay.updatePosition(x, y, '打开 ' + sourceSummary(), 'open');
        return;
      }

      stores.actions.setExplorerDrop(null);
      dropState = null;
      overlay.updatePosition(x, y, sourceSummary(), 'neutral');
      return;
    }

    // Outside workbench (or peeking outside FullView dialog): check Host chat / conversation area.
    clearExpandTimer();
    setDropHighlight(null, null);
    stores.actions.setExplorerDrop(null);

    const chatTarget = findChatDropTarget(x, y);
    if (chatTarget) {
      const hint = sources.length === 1 ? '@' + sources[0].path : '引用 ' + sources.length + ' 项';
      overlay.setChatTarget(chatTarget, '松手添加到对话：' + hint);
      dropState = { kind: 'chat', paths: sources.map((item) => item.path) };
      overlay.updatePosition(x, y, '添加到对话：' + hint, 'chat');
    } else {
      overlay.setChatTarget(null, '');
      dropState = null;
      overlay.updatePosition(
        x,
        y,
        peeking ? '拖到聊天输入区松手引用' : sourceSummary(),
        'neutral',
      );
    }
  }

  function onMove(moveEvent) {
    if (finished || moveEvent.pointerId !== pointerId) return;
    pending = moveEvent;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!finished && pending) applyMove(pending);
    });
  }

  function onUp(upEvent) {
    if (finished || (upEvent && upEvent.pointerId !== pointerId)) return;
    finished = true;
    const action = dropState;
    const wasFullView = overlay.isFullView;
    cleanup();
    if (!dragging || !action) return;
    suppressNextRowClickAt = Date.now();
    if (action.kind === 'move') {
      void stores.actions.moveExplorerEntries(sources, action.targetDir);
    } else if (action.kind === 'open') {
      for (let i = 0; i < action.files.length; i += 1) {
        void stores.actions.openFileInGroup(action.files[i], action.groupId, i === 0 ? action.zone : 'center');
      }
    } else if (action.kind === 'chat') {
      const ok = insertTextIntoChatComposer(formatDropPathsForChat(action.paths));
      if (ok && wasFullView) stores.host?.closeFullView?.();
      if (!ok) stores.actions.notify('warn', '未找到可插入引用的对话输入框');
    }
  }

  function onCancel(cancelEvent) {
    if (finished || (cancelEvent && cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId)) return;
    finished = true;
    cleanup();
  }

  function onKey(keyEvent) {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    if (finished) return;
    finished = true;
    cleanup();
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
  window.addEventListener('keydown', onKey, true);
}

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
    <div className="wid-tree__row" data-explorer-path={path} data-explorer-type={entry.type} data-ignored={entry.ignored ? 'true' : undefined}
      role="treeitem" aria-level={depth + 1} aria-label={entry.name} aria-expanded={isDir ? expanded : undefined}
      aria-selected={selected} tabIndex={selection.focused === path ? 0 : -1}
      style={{ paddingInlineStart: (8 + 12 * depth) + 'px' }} onContextMenu={menu}
      onPointerDown={(event) => beginExplorerDrag(event, stores, path, entry)}
      onClick={(event) => {
        event.stopPropagation(); event.currentTarget.focus();
        if (Date.now() - suppressNextRowClickAt < 250) return;
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
