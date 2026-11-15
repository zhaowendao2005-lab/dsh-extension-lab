/**
 * Browser entry: mounts the Host Remote, then contributes one right-column tab type
 * (sidebar.right.pane.tab) and its workbench body. Every session gets its own client and
 * store bundle; no main panel and no left sidebar icon are registered any more.
 */
import { setReact } from './runtime.js';
import { CSS } from './styles.js';
import { remoteInfo } from '../backend/contract.js';
import { WORKBENCH_PANEL_ID } from '../shared/contract.js';
import { createClient } from './service/client.js';
import { createStores } from './stores/workbench.stores.js';
import { WorkbenchHost } from './views/WorkbenchHost.jsx';

const ID = 'dsh-workspace-ide';
const KIND = WORKBENCH_PANEL_ID;
const STYLE_ID = 'dsh-workspace-ide/css';
const TITLE = '工作台';

window.__ModuleLoader__.load({
  id: ID,
  factory(require) {
    setReact(require('react'));

    async function apply(ctx) {
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
        const host = {
          pickDirectory: async () => (typeof uiWorkspace?.pickDirectory === 'function' ? await uiWorkspace.pickDirectory() : null),
          toggleSidebar: () => {
            try {
              ctx.layout?.toggleSidebar?.();
            } catch (error) {
              console.error('[workspace-ide] toggleSidebar failed', error);
            }
          },
        };

        /** One runtime per session: its own client (sessionId stamped on every request) and stores. */
        const runtimes = new Map();
        const runtimeFor = (sessionId) => {
          const key = sessionId || 'global';
          let runtime = runtimes.get(key);
          if (!runtime) {
            const client = createClient((request) => service.execute(request), () => sessionId);
            const stores = createStores({ client, sessionId, host });
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

        const mountedSession = () => {
          try {
            return ctx.sidebarRight?.mounted?.getSnapshot?.() ?? null;
          } catch {
            return null;
          }
        };

        const activeFilePath = (stores) => {
          const layout = stores.layout.getSnapshot();
          const group = layout.groups[layout.activeGroup];
          const tab = group && group.active ? layout.tabs[group.active] : null;
          return tab && tab.kind === 'file' ? tab.path : null;
        };

        /** Reveal the workbench for the on-screen session (the host expands the column itself). */
        const reveal = (sessionId) => {
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

        // Closing the host tab keeps the runtime in memory (unsaved buffers survive a quick
        // reopen); it only stops background work.
        ctx.effect(() => {
          const controller = remoteCtx.get('sidebarRight');
          if (!controller || typeof controller.registerCloseHandler !== 'function') return () => {};
          return controller.registerCloseHandler(KIND, (sessionId) => {
            const runtime = runtimes.get(sessionId);
            if (runtime) runtime.stores.actions.deactivate();
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

        // Shortcut commands: same ids/keys as before, now "reveal the workbench and open this
        // view" instead of "select a main panel". Registration stays deferred and defencive:
        // a conflicting default would strip the *other* package's command and break boot.
        const shortcutDisposers = [];
        const shortcutTimers = [];
        ctx.inject(['shortcuts'], (shortcutCtx) => {
          const shortcuts = shortcutCtx.get('shortcuts');
          if (!shortcuts?.register) return;
          const claim = (binding) => {
            if (!binding) return false;
            try {
              const info = shortcuts.describeBinding(binding);
              return info.issue === null && info.conflicts.length === 0;
            } catch {
              return false;
            }
          };
          const bind = (id, label, run, desktop, web) => {
            const defaults = {};
            if (claim(desktop)) for (const platform of ['macos', 'windows', 'linux']) defaults['desktop:' + platform] = desktop;
            if (claim(web)) for (const platform of ['macos', 'windows']) defaults['web:' + platform] = web;
            if (Object.keys(defaults).length === 0) return false;
            try {
              shortcutDisposers.push(shortcuts.register({
                id,
                label: () => label,
                aliases: [],
                defaults,
                regions: ['page'],
                modals: [],
                resolve: () => (mountedSession()
                  ? { status: 'handled', run }
                  : { status: 'blocked', reason: '请先选择一个会话' }),
              }));
              return true;
            } catch {
              return false;
            }
          };

          const shortcutsTable = [
            ['workspace-ide.explorer', '工作台：文件栏', () => withSession((stores) => stores.actions.setActivity('files')),
              { code: 'KeyE', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyE', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.search', '工作台：工作区搜索', () => withSession((stores) => stores.actions.setActivity('search')),
              { code: 'KeyF', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyF', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.scm', '工作台：打开改动', () => withSession((stores) => stores.actions.openChanges()),
              { code: 'KeyG', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyG', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.graph', '工作台：提交图谱', () => withSession((stores) => stores.actions.openGraph()),
              { code: 'KeyR', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyR', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.panel', '工作台：显示/隐藏终端', () => withSession((stores) => stores.actions.togglePanel()),
              { code: 'KeyJ', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyJ', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.quickOpen', '工作台：快速打开文件', () => withSession((stores) => void stores.actions.openQuick()),
              { code: 'KeyO', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyO', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.save', '工作台：保存当前文件', () => withSession((stores) => {
              const path = activeFilePath(stores);
              if (path) void stores.actions.save(path);
            }), { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.saveAll', '工作台：保存全部文件', () => withSession((stores) => {
              for (const tab of stores.editor.getSnapshot().tabs) {
                if (tab.dirty) void stores.actions.save(tab.path);
              }
            }), { code: 'KeyA', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyA', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.nav', '工作台：收起/展开文件栏', () => withSession((stores) => stores.actions.toggleSidebar()),
              { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.closeTab', '工作台：关闭当前标签', () => withSession((stores) => {
              const layout = stores.layout.getSnapshot();
              const group = layout.groups[layout.activeGroup];
              if (group && group.active) void stores.actions.closeTabById(group.active);
            }), { code: 'KeyW', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyW', modifiers: ['primary', 'alt', 'shift'] }],
          ];

          let pending = shortcutsTable.slice();
          const attempt = () => {
            if (!pending.length) return;
            pending = pending.filter(([id, label, run, desktop, web]) => !bind(id, label, run, desktop, web));
          };
          attempt();
          for (const delay of [400, 1200, 2500]) shortcutTimers.push(setTimeout(attempt, delay));
        });

        ctx.effect(() => () => {
          for (const timer of shortcutTimers.splice(0)) clearTimeout(timer);
          for (const dispose of shortcutDisposers.splice(0)) dispose();
        }, 'workspace-ide.shortcuts');
      });
    }

    return { name: ID, inject: ['slots', 'remote', 'layout', 'sidebarRight', 'sidebarRightTabs'], apply };
  },
});
