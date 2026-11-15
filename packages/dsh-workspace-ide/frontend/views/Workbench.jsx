import { useStore, useEffect, useRef } from '../runtime.js';
import { Toolbar } from './shell/Toolbar.jsx';
import { NavHeader } from './nav/NavHeader.jsx';
import { FileTree } from './explorer/FileTree.jsx';
import { SearchView } from './search/SearchView.jsx';
import { SplitTree } from './workbench/SplitTree.jsx';
import { TabContextMenu } from './workbench/TabContextMenu.jsx';
import { TerminalPanel } from './panel/TerminalPanel.jsx';
import { StatusBar } from './common/StatusBar.jsx';
import { Notices } from './common/Notices.jsx';
import { Splitter } from './common/Splitter.jsx';
import { QuickOpen } from './common/QuickOpen.jsx';
import { ConfirmModal } from './common/ConfirmModal.jsx';
import { EmptyState } from './common/EmptyState.jsx';

/**
 * The workbench shell: toolbar, collapsible file/search column, the split editor area and
 * the terminal/status bar. All overlays are children of .wid-root, so nothing escapes the
 * right column.
 */
export function Workbench({ stores, visible }) {
  const ui = useStore(stores.ui);
  const layout = useStore(stores.layout);
  const workspace = useStore(stores.workspace);
  const rootRef = useRef(null);
  const frameRef = useRef(null);

  const navOpen = !ui.sidebarCollapsed;
  const panelOpen = !ui.panelCollapsed;
  const drag = layout.drag;

  // The right column's width (not the window's) decides compact vs regular.
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const report = () => stores.actions.setColumnWidth(node.getBoundingClientRect().width);
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stores]);

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

  let ghost = null;
  if (drag && rootRef.current) {
    const rect = rootRef.current.getBoundingClientRect();
    const title = layout.tabs[drag.tabId] ? layout.tabs[drag.tabId].title || layout.tabs[drag.tabId].path : '标签';
    ghost = (
      <div
        className="wid-dragghost"
        style={{ left: drag.x - rect.left + 12 + 'px', top: drag.y - rect.top + 10 + 'px' }}
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
      data-nav={navOpen ? 'open' : 'collapsed'}
      data-panel={panelOpen ? 'open' : 'collapsed'}
      data-visible={visible ? 'true' : 'false'}
    >
      <Toolbar stores={stores} />
      <div className="wid-nav" aria-label="文件与搜索">
        <NavHeader stores={stores} />
        <div className="wid-nav__body">
          {!workspace.root && ui.activityView !== 'search' ? (
            <EmptyState stores={stores} />
          ) : ui.activityView === 'search' ? (
            <SearchView stores={stores} />
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
        max={Math.max(200, (window.innerHeight || 800) - 240)}
        label="调整终端面板高度"
        onChange={(height) => stores.ui.patch({ panelHeight: height })}
        onCommit={() => stores.actions.setPanelHeight(stores.ui.getSnapshot().panelHeight)}
      />
      <section className="wid-panel" aria-label="终端">
        {visible && panelOpen ? <TerminalPanel stores={stores} /> : null}
      </section>
      <StatusBar stores={stores} />
      {visible && <QuickOpen stores={stores} />}
      <Notices stores={stores} />
      {visible && <ConfirmModal stores={stores} />}
        {visible && ui.tabMenu && <TabContextMenu stores={stores} menu={ui.tabMenu} />}
        {ghost}
      </div>
    </div>
  );
}
