import { Icon } from './Icon.jsx';

/**
 * The panel has no workspace root yet (docs/ui-spec.md §13 → 空态).
 * Never invent a root: offer the picker and the recent list instead.
 */
export function EmptyState({ stores, message }) {
  const workspace = stores.workspace.getSnapshot();
  const recents = workspace.recents ?? [];
  return (
    <div className="wid-empty">
      <Icon name="folder" size={22} />
      <div className="wid-empty__title">还没有工作区</div>
      <div>{message ?? '选择一个目录作为根目录，面板会以它为根展示文件、Git 状态与终端。'}</div>
      <div className="wid-empty__actions">
        <button type="button" className="wid-button" data-variant="primary" onClick={() => void stores.actions.pickRoot()}>
          选择目录…
        </button>
      </div>
      {recents.length > 0 && (
        <div className="wid-empty__actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
          {recents.slice(0, 5).map((item) => (
            <button
              key={item}
              type="button"
              className="wid-button"
              title={item}
              onClick={() => void stores.actions.openRoot(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      {workspace.error && <div className="wid-hint">{workspace.error}</div>}
    </div>
  );
}
