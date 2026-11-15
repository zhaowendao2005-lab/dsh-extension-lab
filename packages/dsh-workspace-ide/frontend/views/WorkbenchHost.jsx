import { useEffect } from '../runtime.js';
import { Workbench } from './Workbench.jsx';

/**
 * The right-column tab body. The host tells us whether this session's workbench is on screen;
 * hidden bodies stop polling and keyboard takeover, mounted bodies keep unsaved editor state
 * (keepMounted is set on the tab type).
 */
export function WorkbenchHost({ stores, sessionId, useTabInfo }) {
  const info = typeof useTabInfo === 'function' ? useTabInfo() : null;
  const tab = info && info.tab ? info.tab : null;
  const visible = tab ? tab.visible !== false : true;
  const tabId = tab ? tab.id : null;

  useEffect(() => {
    if (visible) void stores.actions.activate();
    else stores.actions.deactivate();
  }, [visible, stores]);

  useEffect(() => {
    const actions = tab ? tab.actions : null;
    if (!actions || typeof actions.bindCommands !== 'function') return undefined;
    return actions.bindCommands({ refresh: () => stores.actions.refreshWorkspace() });
  }, [tabId, stores]);

  return <Workbench stores={stores} visible={visible} />;
}
