import { useEffect, useRef, useStore } from '../../runtime.js';

/** Mounted under .wid-root so the menu is never clipped by the scrolling tree. */
export function ExplorerContextMenu({ stores }) {
  const state = useStore(stores.explorerSelection);
  const files = useStore(stores.files);
  const host = useRef(null);
  const node = useRef(null);
  const domain = stores.explorerSelectionActions;
  const menu = state.menu?.surface === host.current?.closest('.wid-root')?.dataset.explorerMenuSurface ? state.menu : null;
  const entries = domain.selectedEntries();
  const paths = entries.map((entry) => entry.path);
  const openPaths = entries.filter((entry) => entry.type === 'file').map((entry) => entry.path);
  const isRootMenu = menu?.path === '';
  const single = entries.length === 1 ? entries[0] : null;
  const directory = isRootMenu ? '' : (single?.type === 'directory' ? single.path : null);

  useEffect(() => {
    if (!menu) return undefined;
    const root = node.current?.closest('.wid-root');
    function restoreFocus() {
      const path = domain.store.getSnapshot().focused;
      const row = [...(root?.querySelectorAll('[data-explorer-path]') ?? [])]
        .find((element) => element.dataset.explorerPath === path);
      row?.focus();
    }
    function outside(event) {
      if (node.current && !event.composedPath().includes(node.current)) domain.closeMenu();
    }
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); domain.closeMenu(); restoreFocus();
      } else if (event.key === 'Tab') domain.closeMenu();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const buttons = [...(node.current?.querySelectorAll('button:not(:disabled)') ?? [])];
        const index = buttons.indexOf(node.current?.getRootNode().activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }
    node.current?.querySelector('button:not(:disabled)')?.focus();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keydown, true);
    };
  }, [domain, menu]);

  function run(action) { domain.closeMenu(); void action(); }
  return <div ref={host} className="wid-explorer-menu-host">{menu && <div ref={node} className="wid-contextmenu wid-explorer-menu" role="menu" aria-label="文件操作"
    style={{ left: menu.x + 'px', top: menu.y + 'px' }}
    onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <div className="wid-explorer-menu__summary">{isRootMenu ? '工作区根目录' : '已选 ' + paths.length + ' 项'}</div>
    {!isRootMenu && <>
      <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!openPaths.length}
        title={!openPaths.length ? '所选项中没有可打开的文件' : '打开所选文件'}
        onClick={() => run(() => stores.actions.openExplorerEntries(openPaths))}>打开所选文件{openPaths.length > 1 ? '（' + openPaths.length + '）' : ''}</button>
      <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!paths.length}
        onClick={() => run(() => stores.actions.copyText(paths.join('\n')))}>复制相对路径</button>
      <div className="wid-contextmenu__separator" role="separator" />
      <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={!single} title={!single ? '重命名仅支持单选' : undefined}
        onClick={() => run(() => stores.actions.renameEntry(single.path))}>重命名</button>
    </>}
    <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={directory == null} title={directory == null ? '请选择一个文件夹' : undefined}
      onClick={() => run(() => stores.actions.createEntry(directory, 'file'))}>新建文件</button>
    <button type="button" role="menuitem" className="wid-contextmenu__item" disabled={directory == null} title={directory == null ? '请选择一个文件夹' : undefined}
      onClick={() => run(() => stores.actions.createEntry(directory, 'directory'))}>新建文件夹</button>
    {!isRootMenu && <>
      <div className="wid-contextmenu__separator" role="separator" />
      <button type="button" role="menuitem" className="wid-contextmenu__item wid-explorer-menu__delete" disabled={!paths.length || files.batchBusy} title={files.batchBusy ? "正在删除所选项…" : "删除所选项"}
        onClick={() => { const targets = domain.deletionPaths(); run(() => stores.actions.deleteExplorerEntries(targets)); }}>删除所选项</button>
    </>}
  </div>}</div>;
}
