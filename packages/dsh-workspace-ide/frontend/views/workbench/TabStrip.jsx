import { useStore, useEffect, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { tabIcon, tabTitle } from '../../service/tabs.js';
import { zoneAt } from '../../service/split.js';

const DRAG_THRESHOLD = 4;

function rootRect() {
  const node = document.querySelector('.wid-root');
  return node ? node.getBoundingClientRect() : { left: 0, top: 0, width: 1200, height: 800 };
}

function rootPoint(clientX, clientY, width, height) {
  const rect = rootRect();
  return {
    x: Math.max(4, Math.min(clientX - rect.left, rect.width - width)),
    y: Math.max(4, Math.min(clientY - rect.top, rect.height - height)),
  };
}

function bodyRectOf(groupId) {
  const group = document.querySelector('[data-wid-group="' + groupId + '"]');
  const body = group ? group.querySelector('.wid-group__body') : null;
  return body ? body.getBoundingClientRect() : null;
}

function groupAt(x, y) {
  const node = document.elementFromPoint(x, y);
  const group = node && node.closest ? node.closest('[data-wid-group]') : null;
  return group ? group.getAttribute('data-wid-group') : null;
}

function changesOf(status) {
  if (!status) return 0;
  return (status.staged?.length ?? 0) + (status.working?.length ?? 0)
    + (status.untracked?.length ?? 0) + (status.conflicts?.length ?? 0);
}

/** One group's tab row: activation, close, middle-click, context menu and drag-to-split. */
export function TabStrip({ stores, groupId }) {
  const layout = useStore(stores.layout);
  const editor = useStore(stores.editor);
  const scm = useStore(stores.scm);
  const scrollRef = useRef(null);
  const group = layout.groups[groupId];
  const activeId = group ? group.active : null;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !activeId) return;
    const active = node.querySelector('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  if (!group) return null;

  const dirty = new Map(editor.tabs.map((tab) => [tab.path, tab.dirty]));
  const changes = changesOf(scm.status);

  function openMenu(event, tabId) {
    event.preventDefault();
    event.stopPropagation();
    const point = rootPoint(event.clientX, event.clientY, 210, 210);
    stores.actions.openTabMenu(groupId, tabId, point.x, point.y);
  }

  function openGroupMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    const point = rootPoint(rect.left, rect.bottom + 2, 210, 160);
    stores.actions.openTabMenu(groupId, null, point.x, point.y);
  }

  function beginPointerDrag(event, tabId) {
    if (event.button !== 0) return;
    stores.actions.activateLayoutTab(groupId, tabId);
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let finished = false;

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
      delete document.body.dataset.widDragging;
    }

    function onMove(moveEvent) {
      if (finished) return;
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        document.body.dataset.widDragging = 'true';
        stores.actions.beginTabDrag(tabId, groupId, moveEvent.clientX, moveEvent.clientY);
      }
      const targetGroup = groupAt(moveEvent.clientX, moveEvent.clientY);
      let target = null;
      if (targetGroup) {
        const rect = bodyRectOf(targetGroup);
        const zone = rect ? zoneAt(rect, moveEvent.clientX, moveEvent.clientY) : null;
        if (zone && stores.actions.canDrop(targetGroup, zone)) target = { groupId: targetGroup, zone };
      }
      stores.actions.updateTabDrag(moveEvent.clientX, moveEvent.clientY, target);
    }

    function onUp() {
      if (finished) return;
      finished = true;
      cleanup();
      if (!dragging) return;
      const drag = stores.layout.getSnapshot().drag;
      const target = drag && drag.target;
      if (target) {
        if (target.zone === 'center') stores.actions.moveTab(tabId, target.groupId);
        else stores.actions.splitTab(tabId, target.groupId, target.zone);
      }
      stores.actions.endTabDrag();
    }

    function onKey(keyEvent) {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      if (finished) return;
      finished = true;
      cleanup();
      stores.actions.endTabDrag();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  return (
    <div
      className="wid-tabs"
      role="tablist"
      aria-label="编辑器标签"
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return;
        openMenu(event, null);
      }}
    >
      <div className="wid-tabs__scroll" ref={scrollRef}>
        {group.tabs.map((tabId) => {
          const tab = layout.tabs[tabId];
          if (!tab) return null;
          const active = group.active === tabId;
          const title = tabTitle(tab);
          const isDirty = tab.kind === 'file' && Boolean(dirty.get(tab.path));
          return (
            <div
              key={tabId}
              className="wid-tab"
              role="tab"
              aria-selected={active ? 'true' : 'false'}
              data-active={active ? 'true' : 'false'}
              title={tab.kind === 'file' ? tab.path : title}
              tabIndex={active ? 0 : -1}
              onPointerDown={(event) => beginPointerDrag(event, tabId)}
              onContextMenu={(event) => openMenu(event, tabId)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  const index = group.tabs.indexOf(tabId);
                  const next = group.tabs[index + (event.key === 'ArrowRight' ? 1 : -1)];
                  if (next) stores.actions.activateLayoutTab(groupId, next);
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  stores.actions.activateLayoutTab(groupId, tabId);
                  return;
                }
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const point = rootPoint(rect.left, rect.bottom + 2, 210, 210);
                  stores.actions.openTabMenu(groupId, tabId, point.x, point.y);
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void stores.actions.closeTabById(tabId);
                }
              }}
            >
              <Icon name={tabIcon(tab.kind)} size={12} />
              <span className="wid-tab__title">{title}</span>
              {tab.kind === 'changes' && changes > 0 && (
                <span className="wid-tab__badge">{changes > 99 ? '99+' : changes}</span>
              )}
              {isDirty && <span className="wid-tab__dot" aria-label="未保存" />}
              <button
                type="button"
                className="wid-tab__close"
                title="关闭（也可中键）"
                aria-label={'关闭 ' + title}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void stores.actions.closeTabById(tabId);
                }}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="wid-tabs__more" title="标签页操作" aria-label="标签页操作" onClick={openGroupMenu}>
        <Icon name="collapse" size={12} />
      </button>
    </div>
  );
}
