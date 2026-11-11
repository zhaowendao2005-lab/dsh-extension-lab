import { remoteInfo } from './remote.js';
import { createSandboxStore } from './client-state.js';

window.__ModuleLoader__.load({
  id: 'dsh-plugin-dev-sandbox',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-plugin-dev-sandbox';
    const KIND = 'plugin-sandbox';
    const TITLE = '插件沙箱';
    const STYLE_ID = 'dsh-plugin-dev-sandbox-style';

    // VS Code light theme. The page paints its own surface: the right column is a
    // page of the window, not a raised card over the host's theme.
    const CSS = `
.pds{--pds-bg:#fff;--pds-fg:#3b3b3b;--pds-dim:#6b6b6b;--pds-faint:#8a8a8a;--pds-border:#e5e5e5;--pds-soft:#f0f0f0;--pds-strong:#cecece;--pds-hover:#f3f3f3;--pds-accent:#007acc;--pds-accent-hover:#0062a3;--pds-danger:#b5202c;--pds-ok:#388a34;--pds-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;--pds-sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;height:100%;overflow:auto;background:var(--pds-bg);color:var(--pds-fg);font:13px var(--pds-sans);display:flex;flex-direction:column}
.pds *{box-sizing:border-box}
.pds-header{padding:12px 14px;border-bottom:1px solid var(--pds-border);display:flex;flex-direction:column;gap:3px}
.pds-title{font-weight:600;font-size:13px}
.pds-path{font:11px var(--pds-mono);color:var(--pds-dim);overflow-wrap:anywhere}
.pds-meta{font:11px var(--pds-sans);color:var(--pds-faint)}
.pds-body{padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.pds-status{display:flex;align-items:center;gap:8px;font-size:12px}
.pds-dot{width:8px;height:8px;border-radius:4px;flex:none;background:var(--pds-faint)}
.pds-dot[data-state=running]{background:var(--pds-ok)}
.pds-dot[data-state=starting]{background:#d18616}
.pds-dot[data-state=error]{background:var(--pds-danger)}
.pds-pid{font:11px var(--pds-mono);color:var(--pds-faint)}
.pds-actions{display:flex;flex-wrap:wrap;gap:6px}
.pds-btn{height:26px;padding:0 10px;border:1px solid var(--pds-strong);border-radius:2px;background:var(--pds-hover);color:var(--pds-fg);font:12px var(--pds-sans);cursor:pointer}
.pds-btn:hover:not(:disabled){background:#e8e8e8}
.pds-btn:focus-visible{outline:1px solid var(--pds-accent);outline-offset:1px}
.pds-btn:disabled{opacity:.55;cursor:default}
.pds-btn[data-primary]{border-color:var(--pds-accent);background:var(--pds-accent);color:#fff}
.pds-btn[data-primary]:hover:not(:disabled){background:var(--pds-accent-hover)}
.pds-anchor{color:var(--pds-accent);font-size:12px;text-decoration:none}
.pds-anchor:hover{text-decoration:underline}
.pds-alert{margin:0;padding:8px 10px;background:#fdf3f4;border:1px solid #f0c9cd;border-radius:2px;color:var(--pds-danger);font-size:12px;overflow-wrap:anywhere}
.pds-section{border-top:1px solid var(--pds-border);padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.pds-section>h4{margin:0;font:600 12px var(--pds-sans);color:var(--pds-dim)}
.pds-list{margin:0;padding:0;list-style:none}
.pds-row{display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--pds-soft)}
.pds-row:hover{background:var(--pds-hover)}
.pds-row-name{font:12px var(--pds-mono);overflow-wrap:anywhere}
.pds-row-cmd{font:11px var(--pds-mono);color:var(--pds-faint);white-space:pre-wrap;overflow-wrap:anywhere}
.pds-note{margin:0;font-size:11px;color:var(--pds-faint);line-height:1.6}
.pds-hint{margin:0;font-size:12px;color:var(--pds-dim);line-height:1.6}
.pds-details{border-top:1px solid var(--pds-border);padding:10px 14px}
.pds-details>summary{cursor:pointer;font:600 12px var(--pds-sans);color:var(--pds-dim)}
.pds-details[open]>summary{margin-bottom:8px}
.pds-code{font:11px var(--pds-mono);color:var(--pds-dim);overflow-wrap:anywhere}
.pds-log{margin:0;padding:8px 10px;background:#f8f8f8;border:1px solid var(--pds-border);border-radius:2px;color:#333;font:11.5px/1.6 var(--pds-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto}
.pds-footer{margin-top:auto;border-top:1px solid var(--pds-border);padding:10px 14px;display:flex;gap:6px;align-items:center}
.pds-footer-note{font-size:12px;color:var(--pds-dim)}
`;

    const labels = { stopped: '已停止', starting: '启动中', running: '运行中', exited: '已退出', error: '失败', idle: '空闲' };
    const useStore = store => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    function Btn({ children, onClick, disabled, primary }) {
      return h('button', {
        type: 'button', className: 'pds-btn', onClick: disabled ? undefined : onClick, disabled: disabled || undefined,
        'data-primary': primary ? '' : undefined,
      }, children);
    }

    function DebugPanel({ sessionId, store, useTabInfo }) {
      const state = useStore(store);
      const { tab } = useTabInfo();
      const snapshot = state.snapshot;
      const [confirmUnbind, setConfirmUnbind] = React.useState(false);
      const action = (name, fields) => () => { void store.action(name, fields); };
      const error = state.error && h('p', { role: 'alert', className: 'pds-alert' }, state.error);

      if (!snapshot?.binding) return h('div', { className: 'pds' },
        h('div', { className: 'pds-header' }, h('span', { className: 'pds-title' }, TITLE)),
        h('div', { className: 'pds-body' }, error,
          h('p', { className: 'pds-hint' }, state.loading ? '正在读取当前会话绑定…'
            : '当前会话还没有绑定插件。绑定在会话激活时由 agent 写入插件身份与本地目录（plugin_dev / action=bind），写入后这里会直接显示该插件；若模型侧没有 plugin_dev 工具，重启一次 DSH 让 Host 插件生效。'),
          h('div', { className: 'pds-actions' }, h(Btn, { onClick: () => { void store.refresh(); } }, '刷新'), h(Btn, { onClick: () => tab.actions.close() }, '关闭'))));

      const { binding, runtime, command, commands, logs } = snapshot;
      const running = runtime.state === 'running' || runtime.state === 'starting';
      return h('div', { className: 'pds' },
        h('header', { className: 'pds-header' },
          h('span', { className: 'pds-title' }, binding.name),
          h('span', { className: 'pds-path' }, binding.pluginPath),
          h('span', { className: 'pds-meta' }, '会话 ', sessionId)),
        h('div', { className: 'pds-body' }, error,
          h('div', { role: 'status', className: 'pds-status' },
            h('span', { className: 'pds-dot', 'data-state': runtime.state }),
            h('span', null, labels[runtime.state] || runtime.state),
            runtime.pid ? h('span', { className: 'pds-pid' }, `PID ${runtime.pid}`) : null,
            runtime.exitCode !== null ? h('span', { className: 'pds-pid' }, `退出码 ${runtime.exitCode}`) : null),
          runtime.error && h('p', { role: 'alert', className: 'pds-alert' }, runtime.error),
          h('div', { className: 'pds-actions' },
            h(Btn, { onClick: action('launch'), disabled: running, primary: !running }, running ? '已启动' : '启动沙箱'),
            h(Btn, { onClick: action('stop'), disabled: !running && command.state !== 'running' }, '停止进程'),
            h(Btn, { onClick: () => { void store.refresh(); } }, '刷新'),
            h(Btn, { onClick: () => tab.actions.openTab('terminal') }, '官方终端')),
          runtime.url && h('a', { className: 'pds-anchor', href: runtime.url, target: '_blank', rel: 'noopener noreferrer' }, '打开独立 DSH ↗')),
        h('details', { className: 'pds-details' }, h('summary', null, '隔离目录与边界'),
          h('code', { className: 'pds-code' }, runtime.dshHome),
          h('p', { className: 'pds-note' }, '独立 DSH_HOME，不复制主 profile 或凭据。插件代码仍拥有当前用户权限，不是 OS 安全沙箱。官方终端属于当前会话，不会自动注入此 DSH_HOME。')),
        h('section', { className: 'pds-section', 'aria-label': '调试命令树' },
          h('h4', null, '调试命令 · package.json scripts'),
          commands.length
            ? h('ul', { className: 'pds-list' }, commands.map(item => h('li', { key: item.id, className: 'pds-row' },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { className: 'pds-row-name' }, item.title),
                  h('div', { className: 'pds-row-cmd' }, item.command)),
                h(Btn, { onClick: action('run', { commandId: item.id }), disabled: command.state === 'running' }, '运行'))))
            : h('p', { className: 'pds-hint' }, '该插件没有 scripts。'),
          h('p', { role: 'status', className: 'pds-note' },
            `命令：${labels[command.state] || command.state}${command.id ? ` · ${command.id}` : ''}${command.exitCode !== null ? ` · 退出码 ${command.exitCode}` : ''}`),
          command.error && h('p', { role: 'alert', className: 'pds-alert' }, command.error)),
        h('details', { className: 'pds-details', open: true }, h('summary', null, '进程输出（有界缓存）'),
          h('pre', { tabIndex: 0, 'aria-label': '沙箱与命令输出', className: 'pds-log' },
            logs.length ? logs.map(line => `[${line.source}/${line.stream}] ${line.text}`).join('') : '尚无输出')),
        h('footer', { className: 'pds-footer' }, confirmUnbind
          ? [h('span', { key: 'q', className: 'pds-footer-note' }, '停止所有进程并解除当前会话绑定？'),
             h(Btn, { key: 'ok', onClick: action('unbind'), primary: true }, '确认解除'),
             h(Btn, { key: 'no', onClick: () => setConfirmUnbind(false) }, '取消')]
          : h(Btn, { onClick: () => setConfirmUnbind(true) }, '解除当前会话绑定')));
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
          remoteCtx.effect(() => {
            if (document.getElementById(STYLE_ID)) return () => {};
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
            return () => { style.remove(); };
          }, 'plugin-sandbox.style');
          remoteCtx.effect(() => () => { for (const store of stores.values()) store.dispose(); stores.clear(); }, 'plugin-sandbox.stores');
          // The guide's entry box is the door into this page, like the terminal's
          // "new terminal" card: the type itself stays hidden until picked.
          remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
            id: ID, kind: KIND, priority: 'extension', title: () => TITLE,
            guide: [{ id: 'open', order: 30, title: () => TITLE, description: () => '启动并调试当前会话绑定的插件' }],
          }), 'plugin-sandbox.type');
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
