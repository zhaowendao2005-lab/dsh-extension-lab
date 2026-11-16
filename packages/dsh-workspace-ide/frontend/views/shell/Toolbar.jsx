import { useStore, useEffect, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

const EMPTY_ROWS = [];
const EMPTY_CATALOG = { getSnapshot: () => EMPTY_ROWS, subscribe: () => () => {} };
const FULL_VIEW_ID = 'workspace-ide.fullview';

function changesOf(status) {
  if (!status) return 0;
  return (status.staged?.length ?? 0) + (status.working?.length ?? 0)
    + (status.untracked?.length ?? 0) + (status.conflicts?.length ?? 0);
}

/** Workbench toolbar: workspace chip, quick doors and the overflow menu. */
export function Toolbar({ stores }) {
  const ui = useStore(stores.ui);
  const workspace = useStore(stores.workspace);
  const scm = useStore(stores.scm);
  const fullView = useStore(stores.host.fullView);
  const catalog = useStore(stores.host.shortcuts ? stores.host.shortcuts.catalog : EMPTY_CATALOG);
  const changes = changesOf(scm.status);
  const keysOf = (id) => catalog.find((row) => row.id === id)?.keys ?? [];
  const hintOf = (id) => {
    const keys = keysOf(id);
    return keys.length ? '（' + keys.join(' + ') + '）' : '';
  };
  const fullViewKeys = keysOf(FULL_VIEW_ID);
  const branch = workspace.git?.isRepo
    ? (workspace.git.detached ? 'HEAD@' + String(workspace.git.sha ?? '').slice(0, 7) : workspace.git.branch || 'HEAD')
    : null;

  const workspaceItems = [
    { label: '打开文件夹…', run: () => void stores.actions.pickRoot() },
    { label: '恢复会话默认工作区', run: () => void stores.actions.useSessionRoot() },
    { separator: true },
    {
      label: workspace.trust ? '取消信任此工作区' : '信任此工作区',
      run: () => void stores.actions.setTrusted(!workspace.trust),
    },
    { label: '刷新', run: () => void stores.actions.refreshWorkspace() },
    { separator: true },
    { label: '收起左侧会话栏', hint: '⌘B', run: () => stores.host?.toggleSidebar?.() },
    { label: '设置', run: () => stores.actions.openSettings() },
  ];

  const moreItems = [
    { label: '设置', run: () => stores.actions.openSettings() },
    { label: '关闭所有分栏', run: () => void stores.actions.closeAllTabs() },
    { label: ui.sidebarCollapsed ? '展开文件栏' : '收起文件栏', hint: hintOf('workspace-ide.nav'), run: () => stores.actions.toggleSidebar() },
    { separator: true },
    { label: '刷新工作区', run: () => void stores.actions.refreshWorkspace() },
  ];

  return (
    <header className="wid-toolbar">
      {ui.sidebarCollapsed && (
        <button
          type="button"
          className="wid-icon-button"
          title="展开文件栏"
          aria-label="展开文件栏"
          onClick={() => stores.actions.toggleSidebar()}
        >
          <Icon name="explorer" size={14} />
        </button>
      )}
      <button
        type="button"
        className="wid-toolbar__root"
        title={workspace.root ?? '未选择工作区'}
        onClick={() => stores.actions.toggleMenu('workspace')}
      >
        <Icon name="folder" size={12} />
        <span className="wid-toolbar__name">{workspace.name ?? '工作区'}</span>
      </button>
      {branch && (
        <button
          type="button"
          className="wid-toolbar__branch"
          title="打开提交图谱"
          onClick={() => stores.actions.openGraph()}
        >
          <Icon name="branch" size={12} />
          <span>{branch}</span>
        </button>
      )}
      <span className="wid-toolbar__spacer" />
      <button type="button" className="wid-icon-button" title={'快速打开' + hintOf('workspace-ide.quickOpen')} aria-label="快速打开" onClick={() => void stores.actions.openQuick()}>
        <Icon name="search" size={14} />
      </button>
      <button type="button" className="wid-icon-button" title="打开改动" aria-label="打开改动" onClick={() => stores.actions.openChanges()}>
        <Icon name="scm" size={14} />
        {changes > 0 && <span className="wid-toolbar__badge">{changes > 99 ? '99+' : changes}</span>}
      </button>
      <button type="button" className="wid-icon-button" title="打开提交图谱" aria-label="打开提交图谱" onClick={() => stores.actions.openGraph()}>
        <Icon name="graph" size={14} />
      </button>
      <button type="button" className="wid-icon-button" title={'终端' + hintOf('workspace-ide.panel')} aria-label="终端" onClick={() => stores.actions.togglePanel()}>
        <Icon name="terminal" size={14} />
      </button>
      <button
        type="button"
        className="wid-icon-button"
        title={fullView.open ? '关闭全视图（Esc）' : '打开全视图' + (fullViewKeys.length ? '（' + fullViewKeys.join(' + ') + '）' : '')}
        aria-label={fullView.open ? '关闭全视图' : '打开全视图'}
        aria-pressed={fullView.open}
        onClick={() => stores.actions.toggleFullView()}
      >
        <Icon name={fullView.open ? 'collapseFull' : 'expand'} size={14} />
      </button>
      <button type="button" className="wid-icon-button wid-toolbar__optional" title="设置" aria-label="设置" onClick={() => stores.actions.openSettings()}>
        <Icon name="settings" size={14} />
      </button>
      <button type="button" className="wid-icon-button" title="更多" aria-label="更多" onClick={() => stores.actions.toggleMenu('more')}>
        <Icon name="collapse" size={14} />
      </button>
      {ui.menu === 'workspace' && (
        <ToolbarMenu items={workspaceItems} align="start" onClose={() => stores.actions.toggleMenu(null)} />
      )}
      {ui.menu === 'more' && (
        <ToolbarMenu items={moreItems} align="end" onClose={() => stores.actions.toggleMenu(null)} />
      )}
    </header>
  );
}

function ToolbarMenu({ items, align, onClose }) {
  const node = useRef(null);
  useEffect(() => {
    function onPointerDown(event) {
      if (node.current && !node.current.contains(event.target)) onClose();
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div ref={node} className="wid-toolbar__menu" data-align={align} role="menu">
      {items.map((item, index) => (item.separator ? (
        <div key={'sep:' + index} className="wid-toolbar__separator" role="separator" />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="wid-toolbar__item"
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="wid-toolbar__hint">{item.hint}</span>}
        </button>
      )))}
    </div>
  );
}
