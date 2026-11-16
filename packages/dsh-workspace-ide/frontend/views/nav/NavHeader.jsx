import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

/** Left column header: files/search switch, file actions and the collapse control. */
export function NavHeader({ stores }) {
  const ui = useStore(stores.ui);
  const files = useStore(stores.files);
  const catalog = useStore(stores.host.shortcutCatalog);
  const navKeys = catalog.find((row) => row.id === 'workspace-ide.nav')?.keys ?? [];
  const view = ui.activityView === 'search' ? 'search' : 'files';

  return (
    <div className="wid-nav__head">
      <div className="wid-nav__switch" role="tablist" aria-label="左侧视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'files' ? 'true' : 'false'}
          className="wid-nav__tab"
          data-active={view === 'files' ? 'true' : 'false'}
          title="文件"
          onClick={() => stores.actions.setActivity('files')}
        >
          <Icon name="explorer" size={14} />
          <span>文件</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'search' ? 'true' : 'false'}
          className="wid-nav__tab"
          data-active={view === 'search' ? 'true' : 'false'}
          title="搜索"
          onClick={() => stores.actions.setActivity('search')}
        >
          <Icon name="search" size={14} />
          <span>搜索</span>
        </button>
      </div>
      <div className="wid-nav__actions">
        {view === 'files' && (
          <>
            <button
              type="button"
              className="wid-icon-button"
              title="新建文件"
              onClick={() => void stores.actions.createEntry('', 'file')}
            >
              <Icon name="newFile" size={13} />
            </button>
            <button
              type="button"
              className="wid-icon-button"
              title="新建文件夹"
              onClick={() => void stores.actions.createEntry('', 'directory')}
            >
              <Icon name="folder" size={13} />
            </button>
            <button
              type="button"
              className="wid-icon-button"
              title="刷新"
              onClick={() => {
                for (const path of ['', ...files.expanded]) void stores.actions.listDir(path, { refresh: true });
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
          </>
        )}
        <button
          type="button"
          className="wid-icon-button"
          title={'收起文件栏' + (navKeys.length ? '（' + navKeys.join(' + ') + '）' : '')}
          aria-label="收起文件栏"
          onClick={() => stores.actions.toggleSidebar()}
        >
          <Icon name="chevronLeft" size={12} />
        </button>
      </div>
    </div>
  );
}
