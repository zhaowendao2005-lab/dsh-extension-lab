import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

const ITEMS = [
  { id: 'explorer', icon: 'explorer', label: '资源管理器（Shift+Cmd+E）' },
  { id: 'search', icon: 'search', label: '在工作区中搜索' },
  { id: 'scm', icon: 'scm', label: '源代码管理（Shift+Cmd+G）' },
  { id: 'graph', icon: 'graph', label: '提交图谱' },
  { id: 'terminal', icon: 'terminal', label: '终端（Cmd+J 切换显隐）' },
];

/** Activity bar: view switching plus the panel toggle (docs/ui-spec.md §3). */
export function ActivityBar({ stores }) {
  const ui = useStore(stores.ui);
  const scm = useStore(stores.scm);
  const status = scm.status;
  const changes = status
    ? status.staged.length + status.working.length + status.untracked.length + status.conflicts.length
    : 0;

  return (
    <nav className="wid-activity" aria-label="工作区">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="wid-activity__button"
          title={item.label}
          aria-label={item.label}
          aria-pressed={item.id === 'terminal' ? !ui.panelCollapsed : ui.activityView === item.id && !ui.sidebarCollapsed}
          onClick={() => {
            if (item.id === 'terminal') stores.actions.togglePanel();
            else stores.actions.setActivity(item.id);
          }}
        >
          <Icon name={item.icon} size={20} />
          {item.id === 'scm' && changes > 0 && (
            <span className="wid-activity__badge">{changes > 99 ? '99+' : changes}</span>
          )}
        </button>
      ))}
      <div className="wid-activity__footer">
        <button
          type="button"
          className="wid-activity__button"
          title="设置"
          aria-label="设置"
          aria-pressed={ui.settingsOpen}
          onClick={() => stores.actions.toggleSettings()}
        >
          <Icon name="settings" size={20} />
        </button>
      </div>
    </nav>
  );
}
