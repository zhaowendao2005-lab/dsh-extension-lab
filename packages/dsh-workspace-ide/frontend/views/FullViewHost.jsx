import { useStore, useEffect } from '../runtime.js';
import { Workbench } from './Workbench.jsx';

/**
 * Frame-level full view: 80% of the app frame, same session runtime as the right-column tab.
 * Opening the view closes the host tab; both surfaces share one workbench store so tabs,
 * splits and unsaved buffers survive the hand-off.
 */
export function FullViewHost({ fullView, runtimeFor, close }) {
  const state = useStore(fullView);
  const stores = state.open && state.sessionId ? runtimeFor(state.sessionId).stores : null;

  useEffect(() => {
    if (!stores) return undefined;
    stores.actions.setSurfaceVisible('overlay', true);
    return () => stores.actions.setSurfaceVisible('overlay', false);
  }, [stores]);

  useEffect(() => {
    if (!state.open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const ui = stores?.ui.getSnapshot();
      if (ui?.modal) stores.actions.resolveModal(false);
      else if (stores?.scm.getSnapshot().contextMenu) stores.actions.closeScmMenu();
      else if (ui?.tabMenu) stores.actions.closeTabMenu();
      else if (ui?.menu) stores.actions.toggleMenu(ui.menu);
      else if (ui?.quickOpen) stores.actions.closeQuick();
      else close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.open, stores, close]);

  if (!state.open || !stores) return null;

  return (
    <div className="wid-fullview-backdrop" role="presentation" onClick={close}>
      <div
        className="wid-fullview"
        role="dialog"
        aria-modal="true"
        aria-label="工作台全视图"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="wid-fullview__close" title="关闭全视图（Esc）" aria-label="关闭全视图" onClick={close}>
          ×
        </button>
        <Workbench stores={stores} visible />
      </div>
    </div>
  );
}
