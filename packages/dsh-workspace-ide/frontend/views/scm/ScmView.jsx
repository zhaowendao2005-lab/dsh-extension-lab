import { useStore, useEffect, useMemo, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

const ROW_H = 22;
const OVERSCAN = 12;

const FLAT_GROUPS = [
  { key: 'conflicts', label: '合并冲突', icon: 'warning' },
  { key: 'staged', label: '暂存的更改', icon: 'check' },
  { key: 'working', label: '更改', icon: 'dot' },
  { key: 'untracked', label: '未跟踪', icon: 'plus' },
];

/**
 * Source Control view: branch/commit header plus a two-level change tree (更改 / 暂存).
 * The tree and the legacy flat groups share one windowed row list, so a working tree with
 * tens of thousands of changes renders a bounded number of DOM rows.
 */
export function ScmView({ stores }) {
  const scm = useStore(stores.scm);
  const workspace = useStore(stores.workspace);
  const ui = useStore(stores.ui);
  const status = scm.status;
  const treeRef = useRef(null);

  useEffect(() => {
    const node = treeRef.current;
    if (!node) return undefined;
    const report = () => stores.actions.setScmTreeHeight(node.clientHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stores, scm.view]);

  useEffect(() => {
    if (!scm.contextMenu) return undefined;
    function onPointerDown(event) {
      if (!event.target.closest || !event.target.closest('.wid-scm__ctx')) stores.actions.closeScmMenu();
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') stores.actions.closeScmMenu();
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [Boolean(scm.contextMenu), stores]);

  // Rebuilding the flattened row list on every scroll/keystroke would be O(N) even though the
  // DOM is windowed; memoize it on the only three inputs that shape the tree.
  const rows = useMemo(
    () => (status ? buildRows(status, scm.view, scm.collapsed) : []),
    [status, scm.view, scm.collapsed],
  );

  if (!workspace.git?.isRepo) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">当前目录不是 Git 仓库</span>
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
  const canCommit = stagedCount > 0 && scm.message.trim().length > 0 && !busy && workspace.trust;
  const viewport = scm.treeHeight || 360;
  const start = Math.max(0, Math.floor(scm.scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, start + Math.ceil(viewport / ROW_H) + OVERSCAN * 2);
  const slice = rows.slice(start, end);

  function openMenu(event, menu) {
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('.wid-scm');
    const rect = panel ? panel.getBoundingClientRect() : { left: 0, top: 0, width: 360, height: 480 };
    const width = 210;
    const height = menu.kind === 'file' ? 250 : 160;
    const x = Math.max(4, Math.min(event.clientX - rect.left, rect.width - width));
    const y = Math.max(4, Math.min(event.clientY - rect.top, rect.height - height));
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
        <span className="wid-hint">{scm.view === 'tree' ? 'Tree' : '默认'}</span>
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
              <li key={ref.name}>
                <button
                  type="button"
                  className="wid-scm__menu-item"
                  data-active={ref.head ? 'true' : undefined}
                  onClick={() => {
                    stores.actions.toggleMenu('branches');
                    void stores.scmActions.checkout(ref.name);
                  }}
                >
                  <span className="wid-mono">{ref.name}</span>
                  {ref.upstreamGone && <span className="wid-hint">gone</span>}
                  {!ref.head && (
                    <span
                      className="wid-icon-button"
                      role="button"
                      tabIndex={0}
                      title="删除分支"
                      onClick={(event) => {
                        event.stopPropagation();
                        void stores.scmActions.deleteBranch(ref.name);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
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
      {!workspace.trust && (
        <div className="wid-scm__banner wid-scm__banner--warn">
          <span>未信任该工作区：不能暂存、提交或切换分支</span>
          <span className="wid-scm__banner-actions">
            <button type="button" className="wid-button wid-button--sm wid-button--primary" onClick={() => void stores.actions.setTrusted(true)}>
              信任此工作区
            </button>
          </span>
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
              void stores.scmActions.commit(scm.message);
              stores.actions.setCommitMessage('');
            }
          }}
          onContextMenu={(event) => openMenu(event, { kind: 'page' })}
        />
        <div className="wid-scm__commit-row">
          <span className="wid-hint" title={canCommit ? undefined : commitHint({ stagedCount, message: scm.message, busy, trust: workspace.trust })}>
            {scm.message.length > 72 ? scm.message.length + '/72' : stagedCount + ' 个已暂存'}
          </span>
          <button
            type="button"
            className="wid-button wid-button--primary"
            disabled={!canCommit}
            title={canCommit ? '提交' : commitHint({ stagedCount, message: scm.message, busy, trust: workspace.trust })}
            onClick={() => {
              void stores.scmActions.commit(scm.message);
              stores.actions.setCommitMessage('');
            }}
          >
            提交
          </button>
        </div>
        {busy && <div className="wid-scm__queue">正在执行 {scm.writes.join('、')}</div>}
      </div>

      <div
        className="wid-scm__tree"
        ref={treeRef}
        onScroll={(event) => stores.actions.setScmScroll(event.currentTarget.scrollTop)}
        onContextMenu={(event) => openMenu(event, { kind: 'page' })}
      >
        <div className="wid-scm__canvas" style={{ height: rows.length * ROW_H + 'px' }}>
          {slice.map((row, index) => {
            const position = start + index;
            const style = { transform: 'translateY(' + position * ROW_H + 'px)', height: ROW_H + 'px' };
            if (row.kind === 'group') {
              const collapsed = Boolean(scm.collapsed[row.key]);
              return (
                <div
                  key={'group:' + row.key}
                  className="wid-scm__node"
                  style={style}
                  role="treeitem"
                  aria-expanded={!collapsed}
                  onClick={() => stores.actions.toggleScmNode(row.key)}
                  onContextMenu={(event) => openMenu(event, { kind: 'group', groupKey: row.key })}
                >
                  <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                  <span className="wid-scm__node-title">{row.label}</span>
                  <span className="wid-scm__node-count">{row.count}</span>
                  <span className="wid-scm__node-spacer" />
                  {row.key === 'changes' && row.count > 0 && (
                    <button
                      type="button"
                      className="wid-icon-button"
                      title="全部暂存"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void stores.scmActions.stage(collectPaths(status, 'changes'), true);
                      }}
                    >
                      +
                    </button>
                  )}
                  {row.key === 'staged' && row.count > 0 && (
                    <button
                      type="button"
                      className="wid-icon-button"
                      title="全部取消暂存"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void stores.scmActions.unstage(collectPaths(status, 'staged'), true);
                      }}
                    >
                      −
                    </button>
                  )}
                </div>
              );
            }

            const change = row.change;
            return (
              <div
                key={row.key + ':' + row.group + ':' + change.path + ':' + (change.origPath ?? '')}
                className="wid-scm__row wid-scm__row--tree"
                style={style}
                role="treeitem"
                title={change.path}
                onClick={() => void rowDiff(row)}
                onDoubleClick={() => void stores.actions.openFile(change.path)}
                onContextMenu={(event) => openMenu(event, { kind: 'file', row })}
              >
                <span className="wid-scm__file-icon"><Icon name="file" size={12} /></span>
                <span className="wid-scm__status" data-status={change.status} aria-hidden="true">{change.status}</span>
                <span className="wid-scm__path">{basename(change.path)}</span>
                <span className="wid-scm__dir">{dirname(change.path)}</span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <div className="wid-empty"><span className="wid-hint">没有变更</span></div>}
      </div>

      {scm.contextMenu && (
        <ScmMenu
          menu={scm.contextMenu}
          stores={stores}
          scm={scm}
          status={status}
          onRun={runMenu}
        />
      )}
    </div>
  );
}

function collectPaths(status, bucket) {
  if (bucket === 'changes') {
    return [
      ...(status.working ?? []).map((item) => item.path),
      ...(status.untracked ?? []).map((item) => item.path),
      ...(status.conflicts ?? []).map((item) => item.path),
    ];
  }
  return (status.staged ?? []).map((item) => item.path);
}

function buildRows(status, view, collapsed) {
  const rows = [];
  if (view === 'flat') {
    for (const group of FLAT_GROUPS) {
      const items = status[group.key] ?? [];
      if (!items.length) continue;
      rows.push({ kind: 'group', key: group.key, label: group.label, count: items.length });
      if (collapsed[group.key]) continue;
      for (const change of items) rows.push({ kind: 'file', key: group.key, bucket: group.key, group: group.key, change });
    }
    return rows;
  }

  const changes = [
    ...(status.conflicts ?? []).map((change) => ({ group: 'conflicts', change })),
    ...(status.working ?? []).map((change) => ({ group: 'working', change })),
    ...(status.untracked ?? []).map((change) => ({ group: 'untracked', change })),
  ];
  rows.push({ kind: 'group', key: 'changes', label: '更改', count: changes.length });
  if (!collapsed.changes) {
    for (const item of changes) rows.push({ kind: 'file', key: 'changes', bucket: 'changes', group: item.group, change: item.change });
  }
  const staged = status.staged ?? [];
  rows.push({ kind: 'group', key: 'staged', label: '暂存', count: staged.length });
  if (!collapsed.staged) {
    for (const change of staged) rows.push({ kind: 'file', key: 'staged', bucket: 'staged', group: 'staged', change });
  }
  return rows;
}

function ScmMenu({ menu, stores, scm, status, onRun }) {
  const items = menuItems(menu, stores, scm, status);
  return (
    <div className="wid-scm__ctx" style={{ left: menu.x + 'px', top: menu.y + 'px' }} role="menu">
      {items.map((item, index) => (item.separator ? (
        <div key={'sep:' + index} className="wid-scm__ctx-sep" role="separator" />
      ) : (
        <button
          key={item.label + ':' + index}
          type="button"
          role="menuitem"
          className="wid-scm__ctx-item"
          disabled={item.disabled}
          onClick={() => onRun(item)}
        >
          {item.label}
        </button>
      )))}
    </div>
  );
}

function menuItems(menu, stores, scm, status) {
  const viewItems = [
    { label: (scm.view === 'tree' ? '✓ ' : '') + '使用 Tree 视图', run: () => stores.actions.setScmView('tree') },
    { label: (scm.view === 'flat' ? '✓ ' : '') + '使用默认视图', run: () => stores.actions.setScmView('flat') },
  ];

  if (menu.kind === 'page') return viewItems;

  if (menu.kind === 'group') {
    const collapsed = Boolean(scm.collapsed[menu.groupKey]);
    return [
      { label: collapsed ? '展开' : '收起', run: () => stores.actions.toggleScmNode(menu.groupKey) },
      { separator: true },
      ...viewItems,
    ];
  }

  const row = menu.row;
  const change = row.change;
  const path = change.path;
  const items = [
    { label: '打开文件', run: () => void stores.actions.openFile(path) },
    row.group === 'conflicts'
      ? { label: '解决冲突', run: () => void stores.actions.openConflict(path) }
      : { label: '查看差异', run: () => void rowDiffFrom(stores, row) },
    { separator: true },
  ];
  if (row.bucket === 'staged') {
    items.push({ label: '取消暂存', run: () => void stores.scmActions.unstage([path]) });
  } else {
    items.push({ label: '暂存', run: () => void stores.scmActions.stage([path]) });
  }
  if (row.group === 'working' || row.group === 'untracked') {
    items.push({ label: '丢弃更改', run: () => void stores.scmActions.discard([path]) });
  }
  items.push({ separator: true });
  items.push({ label: '复制相对路径', run: () => void navigator.clipboard?.writeText(path) });
  items.push({ separator: true });
  items.push(...viewItems);
  return items;
}

function rowDiffFrom(stores, row) {
  if (row.group === 'conflicts') return stores.actions.openConflict(row.change.path);
  const target = row.group === 'staged'
    ? { kind: 'index' }
    : row.group === 'untracked' ? { kind: 'untracked' } : { kind: 'working' };
  return stores.actions.openDiff(target, row.change.path);
}

function commitHint({ stagedCount, message, busy, trust }) {
  if (!trust) return '需要先信任该工作区';
  if (busy) return '上一个写操作还在执行';
  if (!stagedCount) return '没有已暂存的更改';
  if (!String(message ?? '').trim()) return '提交信息不能为空';
  return undefined;
}

function basename(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
