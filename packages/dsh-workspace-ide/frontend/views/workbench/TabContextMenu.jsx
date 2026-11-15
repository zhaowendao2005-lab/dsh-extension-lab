import { useStore, useEffect, useRef } from '../../runtime.js';

/**
 * Tab / tab-strip context menu. Rendered inside .wid-root (absolute), never a native menu:
 * the host never sees our confirmations, and the menu must not leave the right column.
 */
export function TabContextMenu({ stores, menu }) {
  const layout = useStore(stores.layout);
  const node = useRef(null);
  const tab = menu.tabId ? layout.tabs[menu.tabId] : null;
  const zoneAvailable = (zone) => Boolean(menu.tabId)
    && Object.keys(layout.groups).length < 4
    && stores.actions.canDrop(menu.groupId, zone);

  useEffect(() => {
    function onPointerDown(event) {
      if (node.current && !node.current.contains(event.target)) stores.actions.closeTabMenu();
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        stores.actions.closeTabMenu();
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [stores]);

  function run(action) {
    stores.actions.closeTabMenu();
    void action();
  }

  function split(zone) {
    stores.actions.closeTabMenu();
    stores.actions.splitTab(menu.tabId, menu.groupId, zone);
  }



  return (
    <div
      ref={node}
      className="wid-contextmenu"
      style={{ left: menu.x + 'px', top: menu.y + 'px' }}
      role="menu"
      aria-label="标签页操作"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.tabId ? (
        <>
          <button type="button" role="menuitem" className="wid-contextmenu__item" onClick={() => run(() => stores.actions.closeTabById(menu.tabId))}>
            <span>关闭当前</span>
            <span className="wid-contextmenu__hint">⌥⌘⇧W</span>
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" onClick={() => run(() => stores.actions.closeOthers(menu.groupId, menu.tabId))}>
            关闭其他
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" onClick={() => run(() => stores.actions.closeGroupTabs(menu.groupId))}>
            关闭所有
          </button>
          <div className="wid-contextmenu__separator" role="separator" />
          <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!zoneAvailable('right')} onClick={() => split('right')}>
            拆分到右侧
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!zoneAvailable('left')} onClick={() => split('left')}>
            拆分到左侧
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!zoneAvailable('bottom')} onClick={() => split('bottom')}>
            拆分到下方
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!zoneAvailable('top')} onClick={() => split('top')}>
            拆分到上方
          </button>
          {tab && tab.kind === 'file' && tab.path && (
            <>
              <div className="wid-contextmenu__separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="wid-contextmenu__item"
                onClick={() => {
                  stores.actions.closeTabMenu();
                  void navigator.clipboard?.writeText(tab.path);
                }}
              >
                复制相对路径
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="wid-contextmenu__item" onClick={() => run(() => stores.actions.closeGroupTabs(menu.groupId))}>
            关闭该组所有标签
          </button>
          <button type="button" role="menuitem" className="wid-contextmenu__item" onClick={() => run(() => stores.actions.closeAllTabs())}>
            关闭所有分栏
          </button>
        </>
      )}
    </div>
  );
}
