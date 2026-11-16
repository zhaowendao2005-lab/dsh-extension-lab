import { useStore, useEffect, useRef, useCallback, canCreatePortal, createPortal } from '../runtime.js';
import { CSS } from '../styles.js';
import { Workbench } from './Workbench.jsx';

function activeElement(root = document) {
  const node = root.activeElement;
  return node?.shadowRoot?.activeElement ? activeElement(node.shadowRoot) : node;
}

/** A DOM handle only: business state remains in the shared session stores. */
function IsolatedFullView({ stores, close }) {
  const hostRef = useRef(null);
  const dialogRef = useRef(null);
  if (!hostRef.current) {
    const host = document.createElement('div');
    host.className = 'wid-fullview-shadow';
    host.attachShadow({ mode: 'open' });
    hostRef.current = host;
  }
  const mountHost = useCallback((node) => {
    if (node) node.appendChild(hostRef.current);
    else hostRef.current.remove();
  }, []);

  useEffect(() => {
    const previous = activeElement();
    const initialFocus = dialogRef.current?.querySelector('.wid-modal__input, .wid-quick__input') ?? dialogRef.current;
    initialFocus?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === 'Tab') {
        const container = dialogRef.current;
        const dialog = container?.querySelector('.wid-modal') ?? container?.querySelector('.wid-quick') ?? container;
        const nodes = [...(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [contenteditable="true"], [tabindex]') ?? [])]
          .filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
        const focused = activeElement(hostRef.current.shadowRoot);
        const index = nodes.indexOf(focused);
        if (!nodes.length || (event.shiftKey ? index <= 0 : index < 0 || index === nodes.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? nodes[nodes.length - 1] : nodes[0])?.focus();
          if (!nodes.length) dialog?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      // Nested handlers cancel their own interaction and restore its focus.
      if (stores.layout.getSnapshot().drag || hostRef.current.shadowRoot.querySelector('.wid-explorer-menu, .wid-quick')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const ui = stores.ui.getSnapshot();
      if (ui.modal) stores.actions.resolveModal(false);
      else if (stores.scm.getSnapshot().contextMenu) stores.actions.closeScmMenu();
      else if (ui.tabMenu) stores.actions.closeTabMenu();
      else if (ui.menu) stores.actions.toggleMenu(ui.menu);
      else if (ui.quickOpen) stores.actions.closeQuick();
      else close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [stores, close]);

  return (
    <div ref={mountHost} className="wid-fullview-mount">
      {createPortal(<>
        <style>{CSS}</style>
        <div className="wid-fullview-backdrop" role="presentation" onClick={close}>
          <div ref={dialogRef} className="wid-fullview" role="dialog" aria-modal="true" aria-label="工作台全视图" tabIndex={-1}
            onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="wid-fullview__close" title="关闭全视图（Esc）" aria-label="关闭全视图" onClick={close}>×</button>
            <Workbench stores={stores} visible surface="overlay" />
          </div>
        </div>
      </>, hostRef.current.shadowRoot)}
    </div>
  );
}

/** 92% of the application frame; the sidebar and overlay share session state. */
export function FullViewHost({ fullView, runtimeFor, close }) {
  const state = useStore(fullView);
  const stores = state.open && state.sessionId && canCreatePortal() ? runtimeFor(state.sessionId).stores : null;
  useEffect(() => {
    if (!stores) return undefined;
    stores.actions.setSurfaceVisible('overlay', true);
    return () => stores.actions.setSurfaceVisible('overlay', false);
  }, [stores]);
  return stores ? <IsolatedFullView stores={stores} close={close} /> : null;
}
