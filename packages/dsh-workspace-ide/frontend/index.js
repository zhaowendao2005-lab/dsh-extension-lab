/**
 * Browser entry: mounts the Host Remote, then contributes one right-column tab type
 * (sidebar.right.pane.tab) and its workbench body. Every session gets its own client and
 * store bundle; no main panel and no left sidebar icon are registered any more.
 */
import { setReact, setReactDom, canCreatePortal } from './runtime.js';
import { CSS } from './styles.js';
import { remoteInfo } from '../backend/contract.js';
import { WORKBENCH_PANEL_ID } from '../shared/contract.js';
import { createClient } from './service/client.js';
import { createStores } from './stores/workbench.stores.js';
import { createStore } from './store.js';
import { WorkbenchHost } from './views/WorkbenchHost.jsx';
import { FullViewHost } from './views/FullViewHost.jsx';
import { createPreferences } from './stores/preferences.stores.js';
import { createShortcutEditor } from './stores/shortcut-editor.stores.js';
import { IdeSettingsSection } from './views/settings/IdeSettingsSection.jsx';
import { IdeSettingsIcon } from './views/settings/IdeSettingsIcon.jsx';

const ID = 'dsh-workspace-ide';
const KIND = WORKBENCH_PANEL_ID;
const STYLE_ID = 'dsh-workspace-ide/css';
const TITLE = '工作台';

window.__ModuleLoader__.load({
  id: ID,
  factory(require) {
    setReact(require('react'));
    try { setReactDom(require('react-dom')); } catch (error) {
      console.warn('[workspace-ide] isolated full view unavailable', error);
    }

    async function apply(ctx) {
      // Browser-global preferences are independent of any session, the remote contribution and
      // the right-column tab: the Host settings page must keep working even when the panel is
      // closed or the remote failed to mount.
      const preferences = createPreferences();
      ctx.effect(() => () => preferences.actions.dispose(), 'workspace-ide.preferences');

      // Shortcut state is shared between the workbench (which registers the commands) and the
      // settings page (which only displays the Host catalog), so both live at plugin scope.
      const shortcutCatalog = createStore([]);
      const shortcutStatus = createStore({ available: false, failed: [], error: null });
      // The settings page edits Host-owned bindings in place; this store owns the recording
      // state (which command is waiting for a key press, last error/notice) for that page.
      const shortcutEditor = createShortcutEditor();
      ctx.effect(() => () => shortcutEditor.actions.dispose(), 'workspace-ide.shortcut-editor');

      // IDE preferences belong to the Host settings panel (Settings → 工作台). The workbench no
      // longer owns an in-panel settings page.
      try {
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: ID,
          order: 30,
          label: () => TITLE,
          inject: () => ({ preferences, shortcutCatalog, shortcutStatus, shortcutEditor }),
        }, IdeSettingsSection)), 'workspace-ide.settings-section');
        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: ID,
        }, IdeSettingsIcon)), 'workspace-ide.settings-icon');
      } catch (error) {
        console.warn('[workspace-ide] settings section unavailable', error);
      }

      let unmount;
      try {
        unmount = await ctx.remote.$mount(remoteInfo);
      } catch (error) {
        // A Host without the contribution must degrade to "no workbench", never to a crash
        // that takes the whole client module down with it.
        console.error('[workspace-ide] remote mount failed', error);
        return;
      }
      ctx.effect(() => unmount, 'workspace-ide.remote');

      ctx.inject(['remote.workspaceIde', 'sidebarRight', 'sidebarRightTabs'], (remoteCtx) => {
        const service = remoteCtx.get('remote.workspaceIde');
        const uiWorkspace = ctx.get('uiWorkspace');

        const mountedSession = () => {
          try {
            return ctx.sidebarRight?.mounted?.getSnapshot?.() ?? null;
          } catch {
            return null;
          }
        };

        /** Full view lives outside the right column but reuses the same session runtime. */
        const fullView = createStore({ open: false, sessionId: null });

        const closeSidebarWorkbenchTab = (sessionId) => {
          try {
            const tabs = ctx.sidebarRight?.tabsIn?.(sessionId) ?? [];
            const tab = tabs.find((item) => item.kind === KIND);
            if (tab) ctx.sidebarRight.close(tab.id);
          } catch (error) {
            console.error('[workspace-ide] close sidebar tab failed', error);
          }
        };

        const closeFullView = () => {
          if (!fullView.getSnapshot().open) return false;
          fullView.set({ open: false, sessionId: null });
          return true;
        };

        const openFullView = () => {
          const sessionId = mountedSession();
          if (!sessionId) return false;
          if (!canCreatePortal()) {
            runtimeFor(sessionId).stores.actions.notify('warn', '当前宿主不支持隔离全视图，请更新 DSH 后重试');
            return false;
          }
          closeSidebarWorkbenchTab(sessionId);
          fullView.set({ open: true, sessionId });
          return true;
        };

        const toggleFullView = () => (fullView.getSnapshot().open ? closeFullView() : openFullView());

        // A full view belongs to one session; switching sessions must not show stale content.
        try {
          const offMounted = ctx.sidebarRight.mounted.subscribe(() => {
            const view = fullView.getSnapshot();
            if (view.open && view.sessionId && view.sessionId !== mountedSession()) closeFullView();
          });
          ctx.effect(() => offMounted, 'workspace-ide.fullview-session');
        } catch (error) {
          console.error('[workspace-ide] fullview session watch failed', error);
        }

        const host = {
          pickDirectory: typeof uiWorkspace?.pickDirectory === 'function' ? () => uiWorkspace.pickDirectory() : undefined,
          toggleSidebar: () => {
            try {
              ctx.layout?.toggleSidebar?.();
            } catch (error) {
              console.error('[workspace-ide] toggleSidebar failed', error);
            }
          },
          fullView,
          toggleFullView,
          closeFullView,
          shortcutCatalog,
          shortcutStatus,
          isShortcutRecording: () => Boolean(shortcutEditor.store.getSnapshot().recording),
        };

        /** One runtime per session: its own client (sessionId stamped on every request) and stores. */
        const runtimes = new Map();
        const runtimeFor = (sessionId) => {
          const key = sessionId || 'global';
          let runtime = runtimes.get(key);
          if (!runtime) {
            const client = createClient((request) => service.execute(request), () => sessionId);
            const stores = createStores({ client, sessionId, host, preferences });
            try {
              stores.actions.restoreLayout();
            } catch (error) {
              console.error('[workspace-ide] restoreLayout failed', error);
            }
            runtime = { client, stores };
            runtimes.set(key, runtime);
          }
          return runtime;
        };

        const activeFilePath = (stores) => {
          const layout = stores.layout.getSnapshot();
          const group = layout.groups[layout.activeGroup];
          const tab = group && group.active ? layout.tabs[group.active] : null;
          return tab && tab.kind === 'file' ? tab.path : null;
        };

        /** Reveal the workbench for the on-screen session (the host expands the column itself). */
        const reveal = (sessionId) => {
          const view = fullView.getSnapshot();
          // The full view already shows this session's runtime; opening the sidebar tab as
          // well would mount a second Workbench over the same stores.
          if (view.open && (!sessionId || view.sessionId === sessionId)) return true;
          try {
            ctx.sidebarRight.openTab(KIND);
            return true;
          } catch (error) {
            console.error('[workspace-ide] openTab failed', error);
            return false;
          }
        };

        const withSession = (run) => {
          const sessionId = mountedSession();
          if (!sessionId) return false;
          const runtime = runtimeFor(sessionId);
          if (!reveal(sessionId)) return false;
          try {
            run(runtime.stores, runtime.client);
            return true;
          } catch (error) {
            console.error('[workspace-ide] command failed', error);
            return false;
          }
        };

        ctx.effect(() => {
          if (document.getElementById(STYLE_ID)) return () => {};
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'workspace-ide.style');

        // Stage one: the tab type, including the guide card that is the in-column entry point.
        ctx.effect(() => remoteCtx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          priority: 'extension',
          multiple: false,
          keepMounted: true,
          title: () => TITLE,
          guide: [{
            id: 'open',
            order: 25,
            title: () => TITLE,
            description: () => '文件、编辑器、Git 与终端',
          }],
        }), 'workspace-ide.tab-type');

        // Stage two: the body, dispatched per session with that session's stores.
        ctx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: ID,
          inject: (sessionId) => ({ stores: runtimeFor(sessionId).stores }),
        }, WorkbenchHost)), 'workspace-ide.body');

        // Frame-level full view: the same session runtime, mounted in the frame's overlay seat.
        ctx.effect(() => remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-ide.fullview',
          order: 60,
          inject: () => ({ fullView, runtimeFor, close: closeFullView }),
        }, FullViewHost)), 'workspace-ide.fullview');

        // Closing the host tab keeps the runtime in memory (unsaved buffers survive a quick
        // reopen); it only releases the sidebar surface, not a visible full view.
        ctx.effect(() => {
          const controller = remoteCtx.get('sidebarRight');
          if (!controller || typeof controller.registerCloseHandler !== 'function') return () => {};
          return controller.registerCloseHandler(KIND, (sessionId) => {
            const runtime = runtimes.get(sessionId);
            if (runtime) runtime.stores.actions.setSurfaceVisible('sidebar', false);
          });
        }, 'workspace-ide.close-handler');

        ctx.effect(() => () => {
          for (const runtime of runtimes.values()) {
            try {
              runtime.stores.terminals.dispose();
            } catch (error) {
              console.error('[workspace-ide] terminal dispose failed', error);
            }
            try {
              runtime.stores.actions.dispose();
            } catch (error) {
              console.error('[workspace-ide] store dispose failed', error);
            }
          }
          runtimes.clear();
        }, 'workspace-ide.stores');

        // Shortcut commands stay unbound by default: the host's own "Keyboard shortcuts" panel
        // (Settings → General → Edit shortcuts, or Mod+/) lists every registered command, so the
        // user assigns keys there instead of in a plugin-owned recorder.
        ctx.inject(['shortcuts'], (shortcutCtx) => {
          const shortcuts = shortcutCtx.get('shortcuts');
          if (!shortcuts?.register) return;
          const shortcutDisposers = [];
          const failed = [];
          shortcutStatus.set({ available: true, failed: [], error: null });
          const commands = [
            ['workspace-ide.explorer', '工作台：文件栏', () => withSession((stores) => stores.actions.setActivity('files'))],
            ['workspace-ide.search', '工作台：工作区搜索', () => withSession((stores) => stores.actions.setActivity('search'))],
            ['workspace-ide.scm', '工作台：打开改动', () => withSession((stores) => stores.actions.openChanges())],
            ['workspace-ide.graph', '工作台：提交图谱', () => withSession((stores) => stores.actions.openGraph())],
            ['workspace-ide.panel', '工作台：显示/隐藏终端', () => withSession((stores) => stores.actions.togglePanel())],
            ['workspace-ide.quickOpen', '工作台：搜索文件', () => withSession((stores) => void stores.actions.openQuick())],
            ['workspace-ide.commandPalette', '工作台：打开命令面板', () => withSession((stores) => stores.actions.openCommandPalette())],
            ['workspace-ide.save', '工作台：保存当前文件', () => withSession((stores) => {
              const path = activeFilePath(stores);
              if (path) void stores.actions.save(path);
            })],
            ['workspace-ide.saveAll', '工作台：保存全部文件', () => withSession((stores) => {
              for (const tab of stores.editor.getSnapshot().tabs) {
                if (tab.dirty) void stores.actions.save(tab.path);
              }
            })],
            ['workspace-ide.nav', '工作台：收起/展开文件栏', () => withSession((stores) => stores.actions.toggleSidebar())],
            ['workspace-ide.closeTab', '工作台：关闭当前标签', () => withSession((stores) => {
              const layout = stores.layout.getSnapshot();
              const group = layout.groups[layout.activeGroup];
              if (group && group.active) void stores.actions.closeTabById(group.active);
            })],
            ['workspace-ide.fullview', '工作台：打开/关闭全视图', () => toggleFullView()],
          ];
          for (const [id, label, run] of commands) {
            try {
              shortcutDisposers.push(shortcuts.register({
                id,
                label: () => label,
                aliases: [],
                defaults: {},
                regions: ['page'],
                modals: [],
                resolve: () => (mountedSession()
                  ? { status: 'handled', run }
                  : { status: 'blocked', reason: '请先选择一个会话' }),
              }));
            } catch (error) {
              failed.push(id);
              console.error('[workspace-ide] shortcut register failed', id, error);
            }
          }
          const syncCatalog = () => {
            try {
              shortcutCatalog.set(shortcuts.catalog.getSnapshot());
              shortcutStatus.set({ available: true, failed: [...failed], error: null });
            } catch (error) {
              shortcutStatus.set({ available: true, failed: [...failed], error: String(error?.message ?? error) });
              console.error('[workspace-ide] shortcut catalog failed', error);
            }
          };
          syncCatalog();
          if (shortcuts.catalog?.subscribe) shortcutDisposers.push(shortcuts.catalog.subscribe(syncCatalog));
          // Hand the settings page the service it edits through: describeBinding validates a
          // candidate, edit() is revision-checked, recording() releases native accelerators.
          shortcutEditor.actions.attach({ shortcuts, catalog: () => shortcutCatalog.getSnapshot() });
          shortcutCtx.effect(() => () => {
            shortcutEditor.actions.detach();
            for (const dispose of shortcutDisposers.splice(0)) dispose();
            shortcutCatalog.set([]);
            shortcutStatus.set({ available: false, failed: [], error: null });
          }, 'workspace-ide.shortcuts');
        });
      });
    }

    return { name: ID, inject: ['slots', 'remote', 'layout', 'sidebarRight', 'sidebarRightTabs'], apply };
  },
});
