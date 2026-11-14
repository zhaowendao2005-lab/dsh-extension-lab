import { useStore } from '../runtime.js';
import { Icon } from './common/Icon.jsx';
import { ActivityBar } from './activity/ActivityBar.jsx';
import { FileTree } from './explorer/FileTree.jsx';
import { SearchView } from './search/SearchView.jsx';
import { TerminalPanel } from './panel/TerminalPanel.jsx';
import { StatusBar } from './common/StatusBar.jsx';
import { Notices } from './common/Notices.jsx';
import { Splitter } from './common/Splitter.jsx';
import { EmptyState } from './common/EmptyState.jsx';
import { ScmView } from './scm/ScmView.jsx';
import { GraphView } from './graph/GraphView.jsx';
import { EditorArea } from './editor/EditorArea.jsx';
import { SettingsView } from './common/SettingsView.jsx';
import { SidebarHeader } from './common/SidebarHeader.jsx';
import { ConfirmModal } from './common/ConfirmModal.jsx';
import { QuickOpen } from './common/QuickOpen.jsx';

const SIDEBAR_TITLES = {
  explorer: '资源管理器',
  search: '搜索',
  scm: '源代码管理',
  graph: '提交图谱',
};

/**
 * The panel's only layout owner: every region reads from the same stores bundle.
 * `store` is the slot store handle's instance (see frontend/index.js).
 */
export function Workbench({ stores }) {
  const ui = useStore(stores.ui);
  const workspace = useStore(stores.workspace);
  const sidebarView = ui.settingsOpen ? 'settings' : ui.activityView;

  return (
    <div
      className="wid-root"
      data-sidebar={ui.sidebarCollapsed ? 'collapsed' : 'expanded'}
      data-panel={ui.panelCollapsed ? 'collapsed' : 'expanded'}
    >
      <header className="wid-titlebar">
        <span className="wid-titlebar__root" title={workspace.root ?? '未选择工作区'}>
          <span>{workspace.name ?? '工作区'}</span>
        </span>
        {workspace.git?.isRepo && (
          <span className="wid-titlebar__branch">
            {workspace.git.detached ? `HEAD@${(workspace.git.sha ?? '').slice(0, 7)}` : workspace.git.branch ?? 'HEAD'}
          </span>
        )}
        <span className="wid-titlebar__spacer" />
        <button
          type="button"
          className="wid-titlebar__quick"
          title="快速打开文件（⌥⌘⇧O）"
          aria-label="快速打开文件"
          onClick={() => void stores.actions.openQuick()}
        >
          <Icon name="search" />
          <span>快速打开</span>
        </button>
        <button
          type="button"
          className="wid-icon-button"
          title="刷新（文件树与 Git 状态）"
          onClick={() => void stores.actions.refreshWorkspace()}
        >
          ⟳
        </button>
      </header>

      <ActivityBar stores={stores} />

      <aside className="wid-sidebar" aria-label={SIDEBAR_TITLES[sidebarView] ?? '侧栏'}>
        <SidebarHeader stores={stores} view={sidebarView} />
        <div className="wid-sidebar__body">
          {!workspace.root && sidebarView !== 'settings'
            ? <EmptyState stores={stores} />
            : sidebarView === 'explorer'
              ? <FileTree stores={stores} />
              : sidebarView === 'search'
                ? <SearchView stores={stores} />
              : sidebarView === 'scm'
                ? <ScmView stores={stores} />
                : sidebarView === 'graph'
                  ? <GraphView stores={stores} />
                  : <SettingsView stores={stores} />}
        </div>
      </aside>

      <EditorArea stores={stores} />

      <Splitter
        value={ui.panelHeight}
        min={120}
        max={Math.max(200, Math.floor((window.innerHeight || 800) - 200))}
        label="调整终端面板高度"
        onChange={(height) => stores.ui.patch({ panelHeight: height })}
        onCommit={() => stores.actions.setPanelHeight(stores.ui.getSnapshot().panelHeight)}
      />

      <section className="wid-panel" aria-label="终端">
        {ui.panelCollapsed ? null : <TerminalPanel stores={stores} />}
      </section>

      <StatusBar stores={stores} />
      <QuickOpen stores={stores} />
      <Notices stores={stores} />
      <ConfirmModal stores={stores} />
    </div>
  );
}
