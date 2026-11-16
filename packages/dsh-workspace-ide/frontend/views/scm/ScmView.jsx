import { useStore, useEffect, useLayoutEffect, useMemo, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';
import { localPoint } from '../../service/geometry.js';
import {
  buildScmTree, flattenScmTree, resolveScmFocus, scmTreeNavigation,
  scmVirtualWindow, scmRevealScroll, scmWriteReason, scmOpenReason, scmDiscardReason,
  SCM_ROW_HEIGHT, isScmCollapsed,
} from '../../service/scm-tree.js';

const ROW_H = SCM_ROW_HEIGHT;

/** Windowed SCM renderer. The pure service owns grouping, sorting and hierarchy. */
export function ScmView({ stores }) {
  const scm = useStore(stores.scm);
  const repositories = useStore(stores.repositories);
  const ui = useStore(stores.ui);
  const status = scm.status;
  const treeRef = useRef(null);
  const focusRequestRef = useRef(null);

  useEffect(() => {
    const node = treeRef.current;
    if (!node) return undefined;
    const report = () => stores.actions.setScmTreeHeight(node.clientHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stores, scm.view, Boolean(status), repositories.active]);

  useEffect(() => {
    if (!scm.contextMenu) return undefined;
    function onPointerDown(event) {
      const inside = event.composedPath().some((node) => node?.classList?.contains('wid-scm__ctx'));
      if (!inside) stores.actions.closeScmMenu();
    }
    function onKeyDown(event) {
      if (event.key === 'Escape' && stores.scm.getSnapshot().contextMenu) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stores.actions.closeScmMenu();
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [Boolean(scm.contextMenu), stores]);

  const model = useMemo(() => buildScmTree(status, scm.view), [status, scm.view]);
  const rows = useMemo(() => flattenScmTree(model, scm.collapsed), [model, scm.collapsed]);
  const focusedKey = useMemo(() => resolveScmFocus(model, rows, scm.focusedKey), [model, rows, scm.focusedKey]);
  const virtual = scmVirtualWindow(rows.length, scm.scrollTop, scm.treeHeight);

  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    // The browser clamps its scroll position after a collapse; mirror that in the store.
    if (tree.scrollTop !== virtual.scrollTop) tree.scrollTop = virtual.scrollTop;
    if (scm.scrollTop !== virtual.scrollTop) stores.actions.setScmScroll(virtual.scrollTop);
    if (scm.focusedKey !== focusedKey) stores.actions.setScmFocus(focusedKey);
    if (focusRequestRef.current) {
      const index = rows.findIndex((row) => row.key === focusRequestRef.current);
      const target = tree.querySelector('[data-scm-index="' + index + '"]');
      if (target) {
        target.focus({ preventScroll: true });
        focusRequestRef.current = null;
      }
    }
  }, [stores, rows, scm.scrollTop, scm.focusedKey, focusedKey, virtual.scrollTop, virtual.start, virtual.end]);

  if (repositories.active == null) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">请先选择要跟踪的 Git 仓库</span>
        <button type="button" className="wid-button" onClick={() => stores.actions.openRepositories()}>打开仓库</button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">{scm.phase === 'loading' ? '正在读取状态…' : '还没有状态'}</span>
      </div>
    );
  }

  const branch = status.branch ?? {};
  const stagedCount = (status.staged ?? []).length;
  const busy = scm.writes.length > 0;
  const canCommit = stagedCount > 0 && scm.message.trim().length > 0 && !busy;
  const slice = rows.slice(virtual.start, virtual.end);
  const writeReason = scmWriteReason({ busy });

  function focusRow(row, index) {
    if (!row) return;
    focusRequestRef.current = row.key;
    stores.actions.setScmFocus(row.key);
    const top = scmRevealScroll(index, virtual.scrollTop, virtual.viewport);
    if (treeRef.current) {
      treeRef.current.scrollTop = top;
      const target = treeRef.current.querySelector('[data-scm-index="' + index + '"]');
      if (target) {
        target.focus({ preventScroll: true });
        focusRequestRef.current = null;
      }
    }
    stores.actions.setScmScroll(top);
  }

  function onRowKey(event, row, index) {
    if (event.target.closest('button')) return;
    const navigation = scmTreeNavigation(rows, row.key, event.key);
    if (navigation) {
      event.preventDefault();
      if (navigation.toggleKey) stores.actions.toggleScmNode(navigation.toggleKey);
      else focusRow(rows[navigation.index], navigation.index);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (row.kind === 'file') void rowDiff(row);
      else stores.actions.toggleScmNode(row.key);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      openMenu(event, { kind: row.kind, row });
    }
  }

  function openMenu(event, menu) {
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('.wid-scm');
    const width = 210;
    const height = menu.kind === 'file' ? 290 : 190;
    const anchor = event.currentTarget.getBoundingClientRect();
    const keyboard = !Number.isFinite(event.clientX) || (event.clientX === 0 && event.clientY === 0);
    const clientX = keyboard ? anchor.left + 16 : event.clientX;
    const clientY = keyboard ? anchor.bottom : event.clientY;
    const { x, y } = localPoint(panel, clientX, clientY, width, height);
    stores.actions.openScmMenu({ ...menu, x, y });
  }

  function rowDiff(row) {
    if (row.group === 'conflicts') return stores.actions.openConflict(row.change.path);
    const target = row.group === 'staged'
      ? { kind: 'index' }
      : row.group === 'untracked' ? { kind: 'untracked' } : { kind: 'working' };
    return stores.actions.openDiff(target, row.change.path);
  }

  function runMenu(item) {
    stores.actions.closeScmMenu();
    void item.run();
  }

  return (
    <div className="wid-scm" onContextMenu={(event) => openMenu(event, { kind: 'page' })}>
      <div className="wid-scm__branch">
        <button
          type="button"
          className="wid-scm__branch-button"
          title="切换/新建分支"
          onClick={() => stores.actions.toggleMenu('branches')}
        >
          <Icon name="branch" size={14} />
          <span className="wid-mono">
            {branch.detached ? 'HEAD @ ' + String(branch.sha ?? '').slice(0, 7) : branch.name ?? 'HEAD'}
          </span>
        </button>
        {branch.unborn && <span className="wid-hint">尚无提交</span>}
        {branch.ahead > 0 && <span className="wid-hint">↑{branch.ahead}</span>}
        {branch.behind > 0 && <span className="wid-hint">↓{branch.behind}</span>}
        <span className="wid-scm__branch-spacer" />
        <span className="wid-hint">{scm.view === 'tree' ? '路径树' : '列表'}</span>
        <button
          type="button"
          className="wid-icon-button"
          title="贮藏"
          onClick={() => stores.actions.toggleMenu('stash')}
          disabled={busy}
        >
          <Icon name="collapse" size={12} />
        </button>
        <button
          type="button"
          className="wid-icon-button"
          title="刷新状态"
          onClick={() => void stores.actions.refreshScm()}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {ui.menu === 'branches' && (
        <div className="wid-scm__menu" role="menu">
          <div className="wid-scm__menu-head">
            <span>分支</span>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.createBranch()}>
              新建
            </button>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.createTag()}>
              打标签
            </button>
          </div>
          <ul className="wid-scm__menu-list">
            {(scm.refs?.local ?? []).map((ref) => (
              <li key={ref.name} className="wid-scm__branch-item">
                <button type="button" className="wid-scm__menu-item" data-active={ref.head ? 'true' : undefined}
                  onClick={() => {
                    stores.actions.toggleMenu('branches');
                    void stores.scmActions.checkout(ref.name);
                  }}>
                  <span className="wid-mono">{ref.name}</span>
                  {ref.upstreamGone && <span className="wid-hint">gone</span>}
                </button>
                {!ref.head && <button type="button" className="wid-icon-button" title="删除分支" aria-label={'删除分支 ' + ref.name}
                  disabled={Boolean(writeReason)} onClick={() => void stores.scmActions.deleteBranch(ref.name)}>×</button>}
              </li>
            ))}
            {!(scm.refs?.local ?? []).length && <li className="wid-hint">还没有分支</li>}
          </ul>
          {(scm.refs?.tags ?? []).length > 0 && (
            <div className="wid-scm__menu-tags">
              {(scm.refs.tags ?? []).slice(0, 12).map((tag) => (
                <span key={tag.name} className="wid-graph__badge" data-kind="tag">
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {ui.menu === 'stash' && (
        <div className="wid-scm__menu" role="menu">
          <div className="wid-scm__menu-head">
            <span>贮藏</span>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.stashPush()}>
              贮藏当前修改
            </button>
          </div>
          <ul className="wid-scm__menu-list">
            {(scm.stashes ?? []).map((entry, index) => (
              <li key={entry.ref ?? index}>
                <button
                  type="button"
                  className="wid-scm__menu-item"
                  title={entry.subject ?? entry.ref ?? ''}
                  onClick={() => void stores.scmActions.stashPop(index)}
                >
                  <span className="wid-mono">{'stash@{' + index + '}'}</span>
                  <span className="wid-scm__menu-msg">{entry.subject ?? ''}</span>
                </button>
              </li>
            ))}
            {!(scm.stashes ?? []).length && <li className="wid-hint">没有贮藏</li>}
          </ul>
        </div>
      )}

      {status.operation && <div className="wid-scm__banner">进行中：{status.operation}</div>}
      {status.isHuge && (
        <div className="wid-scm__banner">
          未跟踪 {status.counts?.untracked ?? 0} 项，自动刷新已降级为手动
        </div>
      )}

      <div className="wid-scm__commit">
        <textarea
          className="wid-scm__message"
          rows={2}
          placeholder="提交信息（Cmd/Ctrl+Enter 提交）"
          value={scm.message}
          onChange={(event) => stores.actions.setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              if (canCommit) void stores.scmActions.commit(scm.message);
            }
          }}
          onContextMenu={(event) => openMenu(event, { kind: 'page' })}
        />
        <div className="wid-scm__commit-row">
          <span className="wid-hint" title={canCommit ? undefined : commitHint({ stagedCount, message: scm.message, busy })}>
            {scm.message.length > 72 ? scm.message.length + '/72' : stagedCount + ' 个已暂存'}
          </span>
          <button
            type="button"
            className="wid-button wid-button--primary"
            disabled={!canCommit}
            title={canCommit ? '提交' : commitHint({ stagedCount, message: scm.message, busy })}
            onClick={() => {
              if (canCommit) void stores.scmActions.commit(scm.message);
            }}
          >
            提交
          </button>
        </div>
        {busy && <div className="wid-scm__queue">正在执行 {scm.writes.join('、')}</div>}
      </div>

      <div
        className="wid-scm__tree" ref={treeRef} role="tree" aria-label="源代码管理更改"
        tabIndex={0}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          const index = rows.findIndex((row) => row.key === focusedKey);
          focusRow(rows[index], index);
        }}
        onScroll={(event) => stores.actions.setScmScroll(event.currentTarget.scrollTop)}
        onContextMenu={(event) => openMenu(event, { kind: 'page' })}
      >
        <div className="wid-scm__canvas" role="presentation" style={{ height: virtual.totalHeight + 'px' }}>
          {slice.map((row, index) => {
            const position = virtual.start + index;
            const isFile = row.kind === 'file';
            const active = row.key === focusedKey;
            const stageReason = scmWriteReason({ busy }, row.paths.length);
            const openReason = scmOpenReason(row);
            const discardReason = writeReason || scmDiscardReason(row);
            const stageLabel = row.bucket === 'staged' ? '取消暂存' : '暂存';
            return (
              <div
                key={row.key}
                className={isFile ? 'wid-scm__item wid-scm__row wid-scm__row--tree' : 'wid-scm__item wid-scm__node'}
                style={{ transform: 'translateY(' + position * ROW_H + 'px)', height: ROW_H + 'px',
                  paddingInlineStart: 4 + (row.level - 1) * 14 + 'px' }}
                data-scm-index={position} data-focused={active ? 'true' : undefined}
                role="treeitem" tabIndex={-1}
                aria-level={row.level} aria-posinset={row.posInSet} aria-setsize={row.setSize}
                aria-expanded={row.expanded}
                aria-label={isFile ? row.path + '，' + row.change.status : row.label + '，' + row.count + ' 个更改'}
                title={isFile && row.change.origPath ? row.change.origPath + ' → ' + row.path : row.path || row.label}
                onFocus={() => stores.actions.setScmFocus(row.key)}
                onKeyDown={(event) => onRowKey(event, row, position)}
                onClick={(event) => {
                  if (event.target.closest('button')) return;
                  focusRow(row, position);
                  if (isFile) void rowDiff(row);
                  else stores.actions.toggleScmNode(row.key);
                }}
                onDoubleClick={(event) => { if (!event.target.closest('button') && isFile && !openReason) void stores.actions.openRepositoryFile(row.path); }}
                onContextMenu={(event) => {
                  focusRow(row, position);
                  openMenu(event, { kind: row.kind, row });
                }}
              >
                {!isFile && <Icon name={row.expanded ? 'chevronDown' : 'chevronRight'} size={12} />}
                {isFile ? <FileIcon name={row.path} size={14} /> : row.kind === 'directory' && <Icon name="folder" size={14} />}
                <span className={isFile ? 'wid-scm__path' : 'wid-scm__node-title'}>{row.label}</span>
                {isFile && scm.view === 'flat' && <span className="wid-scm__dir">{row.directory}</span>}
                {isFile && row.change.status === 'R' && <span className="wid-scm__rename" title={row.change.origPath}>← {row.change.origPath}</span>}
                {!isFile && <span className="wid-scm__node-count">{row.count}</span>}
                <span className="wid-scm__node-spacer" />
                {isFile && <span className="wid-scm__status" data-status={row.change.status} aria-hidden="true">{row.change.status}</span>}
                <span className="wid-scm__row-actions">
                  {isFile && <ScmAction label="打开文件" reason={openReason} icon="file" active={active}
                    onRun={() => stores.actions.openRepositoryFile(row.path)} />}
                  <ScmAction label={stageLabel} reason={stageReason} icon={row.bucket === 'staged' ? 'diff' : 'plus'} active={active}
                    onRun={() => row.bucket === 'staged' ? stores.scmActions.unstage(row.paths) : stores.scmActions.stage(row.paths)} />
                  {isFile && (row.group === 'working' || row.group === 'untracked') && <ScmAction
                    label="丢弃更改" reason={discardReason} icon="trash" active={active}
                    onRun={() => stores.scmActions.discard([row.path])} />}
                </span>
                <button type="button" className="wid-icon-button wid-scm__more" title="更多操作" aria-label={row.label + '，更多操作'}
                  aria-haspopup="menu" tabIndex={active ? 0 : -1}
                  onClick={(event) => { event.stopPropagation(); openMenu(event, { kind: row.kind, row }); }}>⋯</button>
              </div>
            );
          })}
        </div>
        {rows.every((row) => row.kind === 'group' && !row.count) && <div className="wid-empty"><span className="wid-hint">没有变更</span></div>}
      </div>

      {scm.contextMenu && (
        <ScmMenu
          menu={scm.contextMenu}
          stores={stores}
          scm={scm}
          model={model}
          writeReason={writeReason}
          onRun={runMenu}
        />
      )}
    </div>
  );
}

function ScmAction({ label, reason, icon, active, onRun }) {
  return (
    <button type="button" className="wid-icon-button" title={reason || label} aria-label={label}
      disabled={Boolean(reason)} tabIndex={active ? 0 : -1}
      onClick={(event) => { event.stopPropagation(); if (!reason) void onRun(); }}>
      <Icon name={icon} size={12} />
    </button>
  );
}

function ScmMenu({ menu, stores, scm, model, writeReason, onRun }) {
  const menuRef = useRef(null);
  const items = menuItems(menu, stores, scm, model, writeReason);
  useLayoutEffect(() => {
    const node = menuRef.current;
    const root = node?.getRootNode() ?? document;
    const previous = root.activeElement;
    node?.querySelector('button:not(:disabled)')?.focus();
    return () => {
      if (node?.contains(root.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [menu]);
  return (
    <div ref={menuRef} className="wid-scm__ctx" style={{ left: menu.x + 'px', top: menu.y + 'px' }} role="menu"
      aria-label="源代码管理操作"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); stores.actions.closeScmMenu(); }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(event.currentTarget.getRootNode().activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {items.map((item, index) => item.separator ? (
        <div key={'sep:' + index} className="wid-scm__ctx-sep" role="separator" />
      ) : (
        <button key={item.label + ':' + index} type="button" role="menuitem" className="wid-scm__ctx-item"
          disabled={Boolean(item.reason)} title={item.reason || item.label} onClick={() => { if (!item.reason) onRun(item); }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function menuItems(menu, stores, scm, model, writeReason) {
  const viewItems = [
    { label: (scm.view === 'tree' ? '✓ ' : '') + '路径树', run: () => stores.actions.setScmView('tree') },
    { label: (scm.view === 'flat' ? '✓ ' : '') + '列表', run: () => stores.actions.setScmView('flat') },
  ];
  if (menu.kind === 'page') return viewItems;
  // Re-resolve against the latest status: never operate on stale context-menu snapshots.
  const row = model.byKey.get(menu.row?.key);
  if (!row) return [{ label: '更改已更新，请重新选择', reason: '此节点已不在当前状态中' }, { separator: true }, ...viewItems];
  const actionReason = writeReason || (!row.paths.length ? '没有可操作的更改' : undefined);
  const stageItem = row.bucket === 'staged'
    ? { label: '取消暂存', reason: actionReason, run: () => stores.scmActions.unstage(row.paths) }
    : { label: '暂存', reason: actionReason, run: () => stores.scmActions.stage(row.paths) };
  if (row.kind !== 'file') return [
    { label: isScmCollapsed(scm.collapsed, row.key) ? '展开' : '收起', run: () => stores.actions.toggleScmNode(row.key) },
    stageItem, { separator: true }, ...viewItems,
  ];
  const items = [
    { label: '打开文件', reason: scmOpenReason(row), run: () => stores.actions.openRepositoryFile(row.path) },
    { label: row.group === 'conflicts' ? '解决冲突' : '查看差异', run: () => rowDiffFrom(stores, row) },
    { separator: true }, stageItem,
  ];
  if (row.group === 'working' || row.group === 'untracked') items.push({ label: '丢弃更改',
    reason: writeReason || scmDiscardReason(row), run: () => stores.scmActions.discard([row.path]) });
  items.push({ separator: true }, { label: '复制相对路径',
    reason: navigator.clipboard?.writeText ? undefined : '当前环境不支持剪贴板',
    run: () => stores.actions.copyText(row.path) }, { separator: true }, ...viewItems);
  return items;
}

function rowDiffFrom(stores, row) {
  if (row.group === 'conflicts') return stores.actions.openConflict(row.change.path);
  const target = row.group === 'staged'
    ? { kind: 'index' }
    : row.group === 'untracked' ? { kind: 'untracked' } : { kind: 'working' };
  return stores.actions.openDiff(target, row.change.path);
}

function commitHint({ stagedCount, message, busy }) {
  if (busy) return '上一个写操作还在执行';
  if (!stagedCount) return '没有已暂存的更改';
  if (!String(message ?? '').trim()) return '提交信息不能为空';
  return undefined;
}
