/**
 * Browser entry: registers the client module, mounts the Typert Remote
 * contribution once, then contributes the global panel plus its sidebar icon.
 * Layout lives in ./views, view state in ./stores, Host rules in ../backend.
 */
import { setReact } from './runtime.js';
import { CSS } from './styles.js';
import { remoteInfo } from '../backend/contract.js';
import { WORKBENCH_PANEL_ID } from '../shared/contract.js';
import { createClient } from './service/client.js';
import { createStores } from './stores/workbench.stores.js';
import { Workbench } from './views/Workbench.jsx';
import { PanelIcon } from './views/common/PanelIcon.jsx';

const ID = 'dsh-workspace-ide';
const STYLE_ID = 'dsh-workspace-ide/css';
const TITLE = '工作区';

window.__ModuleLoader__.load({
  id: ID,
  factory(require) {
    setReact(require('react'));

    async function apply(ctx) {
      let unmount;
      try {
        unmount = await ctx.remote.$mount(remoteInfo);
      } catch (error) {
        // A Host without the contribution must degrade to "no panel", never to a crash that
        // takes the whole client module down with it.
        console.error('[workspace-ide] remote mount failed', error);
        return;
      }
      ctx.effect(() => unmount, 'workspace-ide.remote');

      ctx.inject(['remote.workspaceIde'], (remoteCtx) => {
        const service = remoteCtx.get('remote.workspaceIde');
        const client = createClient((request) => service.execute(request));
        const uiWorkspace = ctx.get('uiWorkspace');
        const host = {
          pickDirectory: async () => (typeof uiWorkspace?.pickDirectory === 'function' ? await uiWorkspace.pickDirectory() : null),
        };
        const stores = createStores({ client, host });

        ctx.effect(() => {
          if (document.getElementById(STYLE_ID)) return () => {};
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'workspace-ide.style');

        // Shortcut commands must be registered once the service exists, and only after the host
        // packages have claimed their own combinations: `register` validates against the live
        // catalog and throws on overlap, which would strip the *other* package of its command and
        // can leave the boot graph "required entries did not activate". So registration is deferred
        // and every candidate is checked with `describeBinding` before it is taken.
        const shortcutDisposers = [];
        const shortcutTimers = [];
        ctx.inject(['shortcuts'], (shortcutCtx) => {
          const shortcuts = shortcutCtx.get('shortcuts');
          if (!shortcuts?.register) return;
          const layout = ctx.layout ?? ctx.get('layout');
          const openPanel = () => layout?.selectPanel?.(WORKBENCH_PANEL_ID);
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
            if (claim(desktop)) for (const platform of ['macos', 'windows', 'linux']) defaults[`desktop:${platform}`] = desktop;
            if (claim(web)) for (const platform of ['macos', 'windows']) defaults[`web:${platform}`] = web;
            if (Object.keys(defaults).length === 0) return false;
            try {
              shortcutDisposers.push(shortcuts.register({
                id,
                label: () => label,
                aliases: [],
                defaults,
                regions: ['page'],
                modals: [],
                resolve: () => ({ status: 'handled', run }),
              }));
              return true;
            } catch {
              // Taken between the check and the call, or rejected by a rule we cannot read;
              // the command stays reachable from the activity bar / buttons.
              return false;
            }
          };
          // Web profiles admit only three-or-more modifiers, or primary+alt/shift; web:linux is
          // restricted to a tiny allowlist, so it is never declared.
          const commands = [
            ['workspace-ide.explorer', '工作区：资源管理器', () => { openPanel(); stores.actions.setActivity('explorer'); },
              { code: 'KeyE', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyE', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.search', '工作区：在工作区中搜索', () => { openPanel(); stores.actions.setActivity('search'); },
              { code: 'KeyF', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyF', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.scm', '工作区：源代码管理', () => { openPanel(); stores.actions.setActivity('scm'); },
              { code: 'KeyG', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyG', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.graph', '工作区：提交图谱', () => { openPanel(); stores.actions.setActivity('graph'); },
              { code: 'KeyR', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyR', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.panel', '工作区：显示/隐藏终端面板', () => { openPanel(); stores.actions.togglePanel(); },
              { code: 'KeyJ', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyJ', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.quickOpen', '工作区：快速打开文件', () => { openPanel(); void stores.actions.openQuick(); },
              { code: 'KeyO', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyO', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.save', '工作区：保存当前文件', () => {
              openPanel();
              const active = stores.editor.getSnapshot().activePath;
              if (active) void stores.actions.save(active);
            }, { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }],
            ['workspace-ide.saveAll', '工作区：保存全部文件', () => {
              openPanel();
              const tabs = stores.editor.getSnapshot().tabs.filter((tab) => tab.dirty).map((tab) => tab.path);
              for (const path of tabs) void stores.actions.save(path);
            }, { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }, { code: 'KeyS', modifiers: ['primary', 'alt', 'shift'] }],
          ];
          // No close-tab shortcut: Cmd+W belongs to the host (`page.close`) on Desktop and to the
          // browser on Web. The tab strip offers a close button and middle-click instead.
          let pending = commands.slice();
          const attempt = () => {
            if (!pending.length) return;
            pending = pending.filter(([id, label, run, desktop, web]) => !bind(id, label, run, desktop, web));
          };
          attempt();
          // Host packages activate after us; retry a few times so their own claims win.
          for (const delay of [400, 1200, 2500]) shortcutTimers.push(setTimeout(attempt, delay));
        });
        ctx.effect(() => () => {
          for (const timer of shortcutTimers.splice(0)) clearTimeout(timer);
          for (const dispose of shortcutDisposers.splice(0)) dispose();
        }, 'workspace-ide.shortcuts');

        ctx.effect(() => {
          try {
            stores.actions.restoreLayout();
          } catch (error) {
            console.error('[workspace-ide] restoreLayout failed', error);
          }
          void stores.actions.boot();
          return () => {
            stores.terminals.dispose();
            void stores.actions.stopWatch();
          };
        }, 'workspace-ide.boot');

        // The panel stays registered even when the Host side throws: an empty workbench with an
        // error notice is recoverable, an unregistered panel is not.
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: WORKBENCH_PANEL_ID,
          // The renderer resolves `store` through `create()` and turns the instance into the
          // `useStore(selector)` prop. Our panels do not subscribe through that hook — every
          // domain owns its own store — so the handle is a stable placeholder and the real
          // bundle reaches the view through `inject`.
          store: { create: () => ({}) },
          inject: () => ({ stores }),
        }, Workbench)), 'workspace-ide.panel');

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: WORKBENCH_PANEL_ID,
          order: 1,
          label: () => TITLE,
        }, PanelIcon)), 'workspace-ide.icon');
      });
    }

    return { name: ID, inject: ['slots', 'remote', 'layout'], apply };
  },
});
