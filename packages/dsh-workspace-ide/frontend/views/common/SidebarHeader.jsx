import { useStore } from '../../runtime.js';
import { Icon } from './Icon.jsx';

const TITLES = {
  explorer: '资源管理器',
  search: '搜索',
  scm: '源代码管理',
  graph: '提交图谱',
  settings: '设置',
};

/** Sidebar title row plus the actions that make sense for the current view. */
export function SidebarHeader({ stores, view }) {
  const files = useStore(stores.files);
  const workspace = useStore(stores.workspace);

  return (
    <div className="wid-sidebar__head">
      <span className="wid-sidebar__head-title">{TITLES[view] ?? '侧栏'}</span>
      {view === 'explorer' && (
        <>
          <button
            type="button"
            className="wid-icon-button"
            title="新建文件"
            onClick={() => void stores.actions.createEntry('', 'file')}
          >
            <Icon name="newFile" size={14} />
          </button>
          <button
            type="button"
            className="wid-icon-button"
            title="新建文件夹"
            onClick={() => void stores.actions.createEntry('', 'directory')}
          >
            <Icon name="folder" size={14} />
          </button>
          <button
            type="button"
            className="wid-icon-button"
            title="刷新"
            onClick={() => {
              for (const path of ['', ...files.expanded]) void stores.actions.listDir(path, { refresh: true });
            }}
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            type="button"
            className="wid-icon-button"
            title="折叠全部"
            onClick={() => stores.actions.collapseAll()}
          >
            <Icon name="collapse" size={14} />
          </button>
        </>
      )}
      {view === 'scm' && (
        <button
          type="button"
          className="wid-icon-button"
          title="刷新状态"
          onClick={() => void stores.actions.refreshScm()}
        >
          <Icon name="refresh" size={14} />
        </button>
      )}
      {view === 'settings' && (
        <button type="button" className="wid-icon-button" title="关闭设置" onClick={() => stores.actions.toggleSettings()}>
          <Icon name="close" size={12} />
        </button>
      )}
      {view === 'graph' && (
        <button
          type="button"
          className="wid-icon-button"
          title="重新加载图谱"
          onClick={() => void stores.graphActions.load({ reset: true })}
        >
          <Icon name="refresh" size={14} />
        </button>
      )}
      {workspace.root && view === 'explorer' && (
        <span className="wid-hint" title={workspace.root}>…</span>
      )}
    </div>
  );
}
