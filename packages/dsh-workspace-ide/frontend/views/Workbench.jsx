import { useStore, useEffect, useRef } from '../runtime.js';
import { Toolbar } from './shell/Toolbar.jsx';
import { FileTree, openExplorerMenu } from './explorer/FileTree.jsx';
import { ExplorerContextMenu } from './explorer/ExplorerContextMenu.jsx';
import { SplitTree } from './workbench/SplitTree.jsx';
import { TabContextMenu } from './workbench/TabContextMenu.jsx';
import { TerminalPanel } from './panel/TerminalPanel.jsx';
import { StatusBar } from './common/StatusBar.jsx';
import { Notices } from './common/Notices.jsx';
import { Splitter } from './common/Splitter.jsx';
import { QuickOpen } from './common/QuickOpen.jsx';
import { ConfirmModal } from './common/ConfirmModal.jsx';
import { EmptyState } from './common/EmptyState.jsx';
import { workbenchScale } from '../service/geometry.js';
import { handleWorkbenchKeyDown } from '../service/shortcuts.js';

/**
 * The workbench shell: toolbar, collapsible file/search column, the split editor area and
 * the terminal/status bar. All overlays are children of .wid-root, so nothing escapes the
 * right column.
 */
export function Workbench({ stores, visible, surface = 'sidebar', scopeRef = null }) {
  const ui = useStore(stores.ui);
  const layout = useStore(stores.layout);
  const workspace = useStore(stores.workspace);
  const rootRef = useRef(null);
  const frameRef = useRef(null);

  const ownsOverlays = visible && (surface === 'overlay' || !ui.overlayVisible);
  const navOpen = !ui.sidebarCollapsed;
  const panelOpen = !ui.panelCollapsed;
  const drag = layout.drag;
  // The scale is a free 50–200 percentage now; the preferences store already normalised it,
  // but a stale snapshot must never reach CSS as NaN or 0.
  const scalePercent = Number.isFinite(Number(ui.uiScale)) && Number(ui.uiScale) > 0 ? Number(ui.uiScale) : 100;
  const scale = scalePercent / 100;

  // The right column's width (not the window's) decides compact vs regular.
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const report = () => {
      const width = Math.round(node.getBoundingClientRect().width / scale * 100) / 100;
      if (width <= 0 || !rootRef.current) return;
      // Each surface has its own geometry even when sidebar and full view share stores.
      rootRef.current.dataset.width = width < 520 ? 'compact' : width < 720 ? 'medium' : 'wide';
      rootRef.current.style.setProperty('--wid-logical-width', width + 'px');
      stores.actions.setColumnWidth(width);
    };
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stores, scale]);

  useEffect(() => {
    if (!drag) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stores.actions.endTabDrag();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [Boolean(drag), stores]);

  useEffect(() => {
    if (!ownsOverlays) return undefined;
    const scopeEl = scopeRef?.current ?? rootRef.current;
    if (!scopeEl) return undefined;
    const onKeyDown = (event) => {
      handleWorkbenchKeyDown(event, {
        actions: stores.actions,
        isRecording: () => Boolean(stores.host?.isShortcutRecording?.()),
      });
    };
    scopeEl.addEventListener('keydown', onKeyDown, true);
    return () => scopeEl.removeEventListener('keydown', onKeyDown, true);
  }, [ownsOverlays, stores, scopeRef]);

  let ghost = null;
  if (drag && rootRef.current) {
    const rect = rootRef.current.getBoundingClientRect();
    const title = layout.tabs[drag.tabId] ? layout.tabs[drag.tabId].title || layout.tabs[drag.tabId].path : '标签';
    ghost = (
      <div
        className="wid-dragghost"
        style={{
          left: (drag.x - rect.left) / workbenchScale(rootRef.current) + 12 + 'px',
          top: (drag.y - rect.top) / workbenchScale(rootRef.current) + 10 + 'px',
        }}
        aria-hidden="true"
      >
        {title || '标签'}
      </div>
    );
  }

  return (
    <div className="wid-frame" ref={frameRef}>
      <div
        ref={rootRef}
        className="wid-root"
        tabIndex={-1}
        data-ui-scale={scalePercent}
        style={{ '--wid-ui-scale': scale, '--wid-panel-h': panelOpen ? ui.panelHeight + 'px' : '0px' }}
        data-nav={navOpen ? 'open' : 'collapsed'}
        data-panel={panelOpen ? 'open' : 'collapsed'}
        data-visible={visible ? 'true' : 'false'}
        data-dsh-workbench-scope={surface}
        data-dsh-workbench-active={ownsOverlays ? 'true' : 'false'}
      >
      <Toolbar stores={stores} />
      <div className="wid-nav" aria-label="文件与搜索">
        <div
          className="wid-nav__body"
          onContextMenu={(event) => {
            if (!workspace.root) return;
            event.preventDefault();
            event.stopPropagation();
            openExplorerMenu(stores, event.currentTarget, '', event.clientX, event.clientY);
          }}
        >
          {!workspace.root ? (
            <EmptyState stores={stores} />
          ) : (
            <FileTree stores={stores} />
          )}
        </div>
      </div>
      {navOpen && <div className="wid-nav__scrim" aria-hidden="true" onClick={() => stores.actions.toggleSidebar()} />}
      <div className="wid-work">
        <SplitTree stores={stores} node={layout.tree} />
      </div>
      <Splitter
        value={ui.panelHeight}
        min={120}
        max={Math.max(120, (frameRef.current?.clientHeight || window.innerHeight || 800) / scale - 120)}
        label="调整终端面板高度"
        onChange={(height) => stores.ui.patch({ panelHeight: height })}
        onCommit={() => stores.actions.setPanelHeight(stores.ui.getSnapshot().panelHeight)}
      />
      <section className="wid-panel" aria-label="终端">
        {visible && panelOpen ? <TerminalPanel stores={stores} /> : null}
      </section>
      <StatusBar stores={stores} />
      {ownsOverlays && <ExplorerContextMenu stores={stores} />}
      {ownsOverlays && <QuickOpen stores={stores} />}
      <Notices stores={stores} />
      {ownsOverlays && <ConfirmModal stores={stores} />}
        {ownsOverlays && ui.tabMenu && <TabContextMenu stores={stores} menu={ui.tabMenu} />}
        {ghost}
      </div>
    </div>
  );
}
