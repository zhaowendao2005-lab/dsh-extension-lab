/**
 * Browser entry: registers the DSH client module, mounts the Typert Remote
 * contribution once, then binds a per-session store to the right-pane tab.
 * Layout lives in ./views, view state in ./stores, Host-facing rules in ./service.
 */
import { setReact } from './runtime.js';
import xtermCss from '@xterm/xterm/css/xterm.css';
import { CSS } from './styles.js';
import { remoteInfo } from '../backend/contract.js';
import { createSandboxStore } from './stores/sandbox.store.js';
import { Panel } from './views/Panel.js';

const ID = 'dsh-plugin-dev-sandbox';
const KIND = 'plugin-sandbox';
const TITLE = '插件沙箱';
const STYLE_ID = 'dsh-plugin-dev-sandbox-style';

window.__ModuleLoader__.load({
  id: ID,
  factory(require) {
    setReact(require('react'));

    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(remoteInfo);
      ctx.effect(() => unmount, 'plugin-sandbox.remote');
      ctx.inject(['remote.pluginDev'], (remoteCtx) => {
        const service = remoteCtx.get('remote.pluginDev');
        const stores = new Map();
        const storeFor = (sessionId) => {
          if (!stores.has(sessionId)) {
            stores.set(sessionId, createSandboxStore({ execute: (request) => service.execute(request), sessionId }));
          }
          return stores.get(sessionId);
        };
        remoteCtx.effect(() => {
          if (document.getElementById(STYLE_ID)) return () => {};
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = `${CSS}${xtermCss}`;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'plugin-sandbox.style');
        remoteCtx.effect(() => () => {
          for (const store of stores.values()) store.dispose();
          stores.clear();
        }, 'plugin-sandbox.stores');
        remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
          id: ID, kind: KIND, multiple: false, priority: 'extension', title: () => TITLE,
          guide: [{ id: 'open', order: 30, title: () => TITLE, description: () => '在独立实例中运行并调试当前会话的插件' }],
        }), 'plugin-sandbox.type');
        remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, inject: (sessionId) => ({ store: storeFor(sessionId) }),
        }, Panel)), 'plugin-sandbox.body');
      });
    }

    return { name: ID, inject: ['slots', 'remote', 'sidebarRight', 'sidebarRightTabs'], apply };
  },
});
