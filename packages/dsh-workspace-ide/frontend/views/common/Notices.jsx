import { useStore } from '../../runtime.js';
import { Icon } from './Icon.jsx';

/** Error/warn lines. Nothing is swallowed: every failed call lands here. */
export function Notices({ stores }) {
  const state = useStore(stores.notices);
  const workspace = useStore(stores.workspace);
  if (state.items.length === 0) return null;
  return (
    <div className="wid-notices" role="log" aria-live="polite">
      {state.items.map((item) => {
        const untrusted = item.code === 'E_TRUST_REQUIRED';
        return (
          <div key={item.id} className="wid-notice" data-level={item.level}>
            <Icon name={item.level === 'error' ? 'warning' : 'dot'} />
            <span className="wid-notice__text">
              {item.message}
              {untrusted && workspace.root && (
                <span className="wid-notice__path wid-mono" title={workspace.root}>{workspace.root}</span>
              )}
            </span>
            {untrusted && workspace.root && (
              <span className="wid-notice__actions">
                <button
                  type="button"
                  className="wid-button wid-button--primary wid-button--sm"
                  onClick={() => {
                    stores.actions.dismissNotice(item.id);
                    void stores.actions.setTrusted(true);
                  }}
                >
                  信任此工作区
                </button>
                <button
                  type="button"
                  className="wid-button wid-button--sm"
                  title="保持未信任：浏览和查看 diff 可用，写入 / Git 写操作 / 终端仍被禁用"
                  onClick={() => stores.actions.dismissNotice(item.id)}
                >
                  暂不
                </button>
              </span>
            )}
            <button
              type="button"
              className="wid-icon-button"
              title="关闭"
              onClick={() => stores.actions.dismissNotice(item.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
