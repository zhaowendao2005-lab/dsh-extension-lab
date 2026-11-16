import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

/** Empty editor group: the same doors as the toolbar, so a fresh session never stares at a blank box. */
export function WelcomeView({ stores }) {
  const workspace = useStore(stores.workspace);
  return (
    <div className="wid-welcome">
      <div className="wid-welcome__mark" aria-hidden="true">
        <Icon name="explorer" size={28} />
      </div>
      <div className="wid-welcome__title">{workspace.name || '工作台'}</div>
      <div className="wid-welcome__hint">
        {workspace.root ? '从左侧打开文件，或从下面开始：' : '还没有打开工作区。'}
      </div>
      <div className="wid-welcome__actions">
        {workspace.root ? (
          <button type="button" className="wid-button" onClick={() => void stores.actions.openQuick()}>
            打开文件…
          </button>
        ) : (
          <button type="button" className="wid-button wid-button--primary" onClick={() => void stores.actions.pickRoot()}>
            打开文件夹…
          </button>
        )}
        <button type="button" className="wid-button" onClick={() => stores.actions.openRepositories()}>仓库</button>
        <button type="button" className="wid-button" onClick={() => stores.actions.openCommands()}>命令</button>
        <button type="button" className="wid-button" onClick={() => stores.actions.openChanges()}>
          查看改动
        </button>
        <button type="button" className="wid-button" onClick={() => stores.actions.openGraph()}>
          提交图谱
        </button>
      </div>
      <div className="wid-hint">缩放、编辑器字号与快捷键在 DSH 设置页的「工作台」分区调整（左侧栏底部「设置」）。</div>
      {workspace.root && (
        <div className="wid-welcome__root wid-mono" title={workspace.root}>{workspace.root}</div>
      )}
    </div>
  );
}
