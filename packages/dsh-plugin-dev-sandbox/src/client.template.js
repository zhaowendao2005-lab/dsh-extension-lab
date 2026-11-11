import { remoteInfo } from './remote.js';
import { createSandboxStore } from './client-state.js';

window.__ModuleLoader__.load({
  id: 'dsh-plugin-dev-sandbox',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-plugin-dev-sandbox';
    const KIND = 'plugin-sandbox';
    const buttonStyle = { minHeight: 32, border: '1px solid var(--border-color, #666)', borderRadius: 6, padding: '5px 10px', background: 'transparent', color: 'inherit', cursor: 'pointer' };
    const muted = { opacity: .75, fontSize: 12 };
    const labels = { stopped: '已停止', starting: '启动中', running: '运行中', exited: '已退出', error: '失败', idle: '空闲' };
    const useStore = store => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    function Entry({ store, open }) {
      const state = useStore(store);
      if (!state.snapshot?.binding) return null;
      return h('button', { type: 'button', style: buttonStyle, onClick: open, title: '打开当前会话的插件沙箱', 'aria-label': '打开插件沙箱' }, '插件沙箱');
    }

    function DebugPanel({ sessionId, store, useTabInfo }) {
      const state = useStore(store);
      const { tab } = useTabInfo();
      const snapshot = state.snapshot;
      const [confirmUnbind, setConfirmUnbind] = React.useState(false);
      const action = (name, fields) => () => { void store.action(name, fields); };
      const button = (text, onClick, disabled = false) => h('button', { type: 'button', style: buttonStyle, onClick, disabled: disabled || state.busy }, text);
      const error = state.error && h('p', { role: 'alert', style: { color: 'var(--color-danger, #d74949)', overflowWrap: 'anywhere' } }, state.error);
      if (!snapshot?.binding) return h('section', { style: { padding: 16 } },
        h('h3', null, '插件沙箱'), error,
        h('p', null, state.loading ? '正在读取当前会话绑定…' : '当前会话未绑定插件。请让模型调用 plugin_dev，action=bind，并指定插件目录。'),
        button('刷新', () => { void store.refresh(); }), button('关闭', () => tab.actions.close()));
      const { binding, runtime, command, commands, logs } = snapshot;
      const running = runtime.state === 'running' || runtime.state === 'starting';
      return h('section', { 'aria-label': '当前会话插件沙箱', 'aria-busy': state.busy, style: { padding: 16, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, color: 'inherit' } },
        h('header', null, h('h3', { style: { margin: '0 0 6px' } }, binding.name),
          h('div', { style: { ...muted, overflowWrap: 'anywhere' } }, binding.pluginPath),
          h('div', { style: muted }, '会话 ', sessionId)),
        error,
        h('div', { role: 'status' }, 'DSH：', labels[runtime.state] || runtime.state,
          runtime.pid ? ` · PID ${runtime.pid}` : '', runtime.exitCode !== null ? ` · 退出码 ${runtime.exitCode}` : ''),
        runtime.error && h('p', { role: 'alert' }, runtime.error),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          button(running ? '已启动' : '启动沙箱', action('launch'), running),
          button('停止进程', action('stop'), !running && command.state !== 'running'),
          button('刷新', () => { void store.refresh(); }),
          button('官方终端', () => tab.actions.openTab('terminal'))),
        runtime.url && h('a', { href: runtime.url, target: '_blank', rel: 'noopener noreferrer' }, '打开独立 DSH ↗'),
        h('details', null, h('summary', { style: { cursor: 'pointer' } }, '隔离目录与边界'),
          h('code', { style: { display: 'block', overflowWrap: 'anywhere', marginTop: 6 } }, runtime.dshHome),
          h('p', { style: muted }, '独立 DSH_HOME，不复制主 profile 或凭据。插件代码仍拥有当前用户权限，不是 OS 安全沙箱。官方终端属于当前会话，不会自动注入此 DSH_HOME。')),
        h('section', { 'aria-label': '调试命令树' }, h('h4', { style: { margin: '8px 0' } }, '调试命令 · package.json scripts'),
          commands.length ? h('ul', { style: { margin: 0, padding: 0, listStyle: 'none' } }, commands.map(item => h('li', { key: item.id, style: { padding: '6px 0', borderTop: '1px solid var(--border-color, #666)' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' } }, h('strong', null, item.title), button('运行', action('run', { commandId: item.id }), command.state === 'running')),
            h('code', { style: { ...muted, display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 4 } }, item.command)))) : h('p', { style: muted }, '该插件没有 scripts。'),
          h('p', { role: 'status', style: muted }, `命令：${labels[command.state] || command.state}${command.id ? ` · ${command.id}` : ''}${command.exitCode !== null ? ` · 退出码 ${command.exitCode}` : ''}`),
          command.error && h('p', { role: 'alert' }, command.error)),
        h('details', { open: true }, h('summary', { style: { cursor: 'pointer' } }, '进程输出（有界缓存）'),
          h('pre', { tabIndex: 0, 'aria-label': '沙箱与命令输出', style: { fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '40vh', overflow: 'auto', padding: 10, border: '1px solid var(--border-color, #666)', borderRadius: 6 } },
            logs.length ? logs.map(line => `[${line.source}/${line.stream}] ${line.text}`).join('') : '尚无输出')),
        h('footer', { style: { marginTop: 'auto' } }, confirmUnbind
          ? h('div', null, h('p', null, '停止所有进程并解除当前会话绑定？隔离目录会保留。'), button('确认解除', action('unbind')), ' ', button('取消', () => setConfirmUnbind(false)))
          : button('解除当前会话绑定', () => setConfirmUnbind(true))));
    }

    async function apply(ctx) {
      try {
      // $mount installs a traced Cordis service named `remote.<namespace>`;
      // it does not hang methods off ctx.remote itself. Register the UI only
      // once that service is available so every handler closes over it.
      const unmount = await ctx.remote.$mount(remoteInfo);
      ctx.effect(() => unmount, 'plugin-sandbox.remote');
      ctx.inject(['remote.pluginDev'], remoteCtx => {
        const service = remoteCtx.get('remote.pluginDev');
        const stores = new Map();
        const storeFor = sessionId => {
          if (!stores.has(sessionId)) stores.set(sessionId, createSandboxStore(request => service.execute(request), sessionId));
          return stores.get(sessionId);
        };
        remoteCtx.effect(() => () => { for (const store of stores.values()) store.dispose(); stores.clear(); }, 'plugin-sandbox.stores');
        remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({ id: ID, kind: KIND, priority: 'extension', title: () => '插件沙箱' }), 'plugin-sandbox.type');
        // No global guide metadata: unbound sessions must not inherit a static card.
        // The session's right-side utilities entry opens the actual right pane.
        remoteCtx.effect(() => remoteCtx.slots.inject('conversation.session.header.utilities', () => remoteCtx.slots.register({
          name: 'conversation.session.header.utilities', id: ID,
          inject: sessionId => ({ store: storeFor(sessionId), open: () => remoteCtx.sidebarRight.openTab(KIND) }),
        }, Entry)), 'plugin-sandbox.entry');
        remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, inject: sessionId => ({ store: storeFor(sessionId) }),
        }, DebugPanel)), 'plugin-sandbox.body');
      });
      } catch (error) {
        console.error('[sandbox] apply error: ' + ((error && error.stack) || error));
        throw error;
      }
    }
    return { name: ID, inject: ['slots', 'remote', 'sidebarRight', 'sidebarRightTabs'], apply };
  },
});
