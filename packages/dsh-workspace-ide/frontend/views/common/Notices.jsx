import { useStore } from '../../runtime.js';
import { Icon } from './Icon.jsx';

/** Error/warn lines. Nothing is swallowed: every failed call lands here. */
export function Notices({ stores }) {
  const state = useStore(stores.notices);
  if (state.items.length === 0) return null;
  return (
    <div className="wid-notices" role="log" aria-live="polite">
      {state.items.map((item) => (
        <div key={item.id} className="wid-notice" data-level={item.level}>
          <Icon name={item.level === 'error' ? 'warning' : 'dot'} />
          <span className="wid-notice__text">{item.message}</span>
          <button
            type="button"
            className="wid-icon-button"
            title="关闭"
            onClick={() => stores.actions.dismissNotice(item.id)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
