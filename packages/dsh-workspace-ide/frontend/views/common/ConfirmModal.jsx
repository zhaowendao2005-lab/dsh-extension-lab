import { useStore, useEffect } from '../../runtime.js';

/**
 * Panel-internal modal (docs/ui-spec.md §5): the host never sees our confirmations, and
 * the destructive button is never the default focus.
 */
export function ConfirmModal({ stores }) {
  const ui = useStore(stores.ui);
  const modal = ui.modal;

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stores.actions.resolveModal(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [modal, stores]);

  if (!modal) return null;

  return (
    <div
      className="wid-modal__backdrop"
      role="presentation"
      onClick={() => stores.actions.resolveModal(false)}
    >
      <div
        className="wid-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modal.title ?? '确认'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wid-modal__title">{modal.title ?? '确认'}</div>
        {modal.body && <div className="wid-modal__body">{modal.body}</div>}
        {modal.detail && <div className="wid-modal__detail wid-mono">{modal.detail}</div>}
        {modal.input && (
          <label className="wid-modal__field">
            {modal.input.label && <span className="wid-hint">{modal.input.label}</span>}
            <input
              type="text"
              className="wid-modal__input"
              defaultValue={modal.input.value ?? ''}
              placeholder={modal.input.placeholder ?? ''}
              ref={(node) => {
                if (node && document.activeElement !== node) setTimeout(() => node.focus(), 0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  stores.actions.resolveModal(event.currentTarget.value);
                }
              }}
            />
          </label>
        )}
        {modal.irreversible && <div className="wid-modal__warning">此操作不可撤销。</div>}
        <div className="wid-modal__actions">
          <button type="button" className="wid-button" onClick={() => stores.actions.resolveModal(false)}>
            {modal.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={modal.danger ? 'wid-button wid-button--danger' : 'wid-button wid-button--primary'}
            onClick={() => {
              if (!modal.input) {
                stores.actions.resolveModal(true);
                return;
              }
              const node = document.querySelector('.wid-modal__input');
              stores.actions.resolveModal(node?.value ?? '');
            }}
          >
            {modal.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
