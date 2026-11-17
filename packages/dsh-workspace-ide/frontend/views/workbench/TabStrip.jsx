import { useStore, useEffect, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';
import { workbenchRoot, localPoint } from '../../service/geometry.js';
import { tabIcon, tabTitle } from '../../service/tabs.js';
import { isToggleablePreviewPath } from '../../service/preview.js';
import {
  createDragOverlayController, findChatDropTarget, formatDropPathsForChat, insertTextIntoChatComposer,
} from '../../service/explorer-drag.js';
import { zoneAt } from '../../service/split.js';

const DRAG_THRESHOLD = 4;

function rootPoint(element, clientX, clientY, width, height) {
  return localPoint(workbenchRoot(element), clientX, clientY, width, height);
}

/** Resolve the group element the pointer is over; never query another workbench instance's DOM. */
function groupAt(x, y, root) {
  const scope = root?.getRootNode() ?? document;
  const node = scope.elementFromPoint(x, y);
  return node?.closest && workbenchRoot(node) === root ? node.closest('[data-wid-group]') : null;
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
    if (!node || !activeId || layout.drag) return;
    const active = node.querySelector('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId, Boolean(layout.drag)]);

  if (!group) return null;

  const dirty = new Map(editor.tabs.map((tab) => [tab.path, tab.dirty]));
  const changes = changesOf(scm.status);

  function openMenu(event, tabId) {
    event.preventDefault();
    event.stopPropagation();
    const point = rootPoint(event.currentTarget, event.clientX, event.clientY, 220, 260);
    stores.actions.openTabMenu(groupId, tabId, point.x, point.y);
  }

  function openGroupMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    const point = rootPoint(node, rect.left, rect.bottom + 2, 220, 170);
    stores.actions.openTabMenu(groupId, null, point.x, point.y);
  }

  function beginPointerDrag(event, tabId) {
    if (event.button !== 0) return;
    stores.actions.activateLayoutTab(groupId, tabId);
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const root = workbenchRoot(event.currentTarget);
    const draggedTab = stores.layout.getSnapshot().tabs[tabId];
    const dragFilePath = draggedTab?.kind === 'file' ? draggedTab.path : null;
    const overlay = dragFilePath ? createDragOverlayController(event.currentTarget) : null;
    let dragging = false;
    let finished = false;
    let raf = 0;
    let pending = null;
    let chatDropTarget = null;

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pending = null;
      overlay?.dispose();
      if (root) delete root.dataset.widDragging;
    }

    /** One geometry + store update per animation frame, not per pointer event. */
    function onMove(moveEvent) {
      if (finished || moveEvent.pointerId !== pointerId) return;
      pending = moveEvent;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!finished && pending) applyMove(pending);
      });
    }

    function applyMove(moveEvent) {
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        if (root) root.dataset.widDragging = 'true';
        stores.actions.beginTabDrag(tabId, groupId, moveEvent.clientX, moveEvent.clientY);
      }
      const x = moveEvent.clientX;
      const y = moveEvent.clientY;
      const peeking = overlay?.isFullView ? overlay.updatePeeking(x, y) : false;
      const groupElement = !peeking ? groupAt(x, y, root) : null;
      let target = null;
      if (groupElement) {
        const targetGroupId = groupElement.getAttribute('data-wid-group');
        const body = groupElement.querySelector('.wid-group__body');
        const rect = body ? body.getBoundingClientRect() : null;
        const zone = rect ? zoneAt(rect, x, y) : null;
        if (targetGroupId && zone && stores.actions.canDrop(targetGroupId, zone)) {
          target = { groupId: targetGroupId, zone };
        }
      }
      stores.actions.updateTabDrag(x, y, target);

      if (dragFilePath && overlay) {
        const scopeRoot = root?.getRootNode?.() ?? document;
        const hit = !peeking && typeof scopeRoot?.elementFromPoint === 'function' ? scopeRoot.elementFromPoint(x, y) : null;
        const insideWorkbench = Boolean(hit && root && workbenchRoot(hit) === root);
        if (!insideWorkbench) {
          chatDropTarget = findChatDropTarget(x, y);
          if (chatDropTarget) {
            overlay.setChatTarget(chatDropTarget, '松手添加到对话：@' + dragFilePath);
            overlay.updatePosition(x, y, '添加到对话：@' + dragFilePath, 'chat');
          } else {
            overlay.setChatTarget(null, '');
            overlay.updatePosition(x, y, peeking ? '拖到聊天输入区松手引用' : dragFilePath.split('/').pop(), 'neutral');
          }
        } else {
          chatDropTarget = null;
          overlay.setChatTarget(null, '');
          overlay.hideGhost();
        }
      }
    }

    function onUp(upEvent) {
      if (finished || (upEvent && upEvent.pointerId !== pointerId)) return;
      finished = true;
      const droppedChat = chatDropTarget;
      const wasFullView = overlay?.isFullView;
      cleanup();
      if (!dragging) return;
      const drag = stores.layout.getSnapshot().drag;
      const target = drag && drag.target;
      if (target) {
        if (target.zone === 'center') stores.actions.moveTab(tabId, target.groupId);
        else stores.actions.splitTab(tabId, target.groupId, target.zone);
      } else if (droppedChat && dragFilePath) {
        const ok = insertTextIntoChatComposer(formatDropPathsForChat([dragFilePath]));
        if (ok && wasFullView) stores.host?.closeFullView?.();
        if (!ok) stores.actions.notify('warn', '未找到可插入引用的对话输入框');
      }
      stores.actions.endTabDrag();
    }

    /** A cancelled pointer must never commit the pending split as if it were a drop. */
    function onCancel(cancelEvent) {
      if (finished || (cancelEvent && cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId)) return;
      finished = true;
      cleanup();
      if (dragging) stores.actions.endTabDrag();
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
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
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
                  const point = rootPoint(event.currentTarget, rect.left, rect.bottom + 2, 220, 260);
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
              {tab.kind === 'file' ? <FileIcon name={tab.path} size={14} /> : <Icon name={tabIcon(tab.kind)} size={12} />}
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
      {(() => {
        const activeTab = activeId ? layout.tabs[activeId] : null;
        const canToggle = activeTab?.kind === 'file' && isToggleablePreviewPath(activeTab.path);
        if (!canToggle) return null;
        const isPreview = Boolean((editor.previews ?? {})[activeTab.path]);
        return (
          <button
            type="button"
            className="wid-tabs__action"
            title={isPreview ? '切换为源码 (Raw)' : '切换为预览'}
            aria-label={isPreview ? '切换为源码' : '切换为预览'}
            aria-pressed={isPreview}
            onClick={() => stores.actions.togglePreview(activeTab.path)}
          >
            <Icon name={isPreview ? 'script' : 'preview'} size={13} />
          </button>
        );
      })()}
      <button type="button" className="wid-tabs__more" title="标签页操作" aria-label="标签页操作" onClick={openGroupMenu}>
        <Icon name="collapse" size={12} />
      </button>
    </div>
  );
}
