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
    const cleanTerminal = text => String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\u001b[@-Z\\-_]/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

    const CSS = `
.pds{--bg:#fff;--fg:#333;--muted:#6b6b6b;--faint:#8a8a8a;--line:#dedede;--soft:#f5f5f5;--hover:#eaf3fb;--blue:#007acc;--green:#388a34;--red:#b5202c;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;height:100%;min-height:0;background:var(--bg);color:var(--fg);font:12px var(--sans);display:flex;flex-direction:column;overflow:hidden}
.pds *{box-sizing:border-box}.pds button{font:inherit;color:inherit}.pds-head{height:34px;flex:none;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;padding:0 10px}.pds-head-title{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-head-meta{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%}.pds-head-button{border:0;background:transparent;width:24px;height:24px;cursor:pointer;color:var(--muted)}.pds-head-button:hover,.pds-icon-button:hover{background:var(--hover);color:var(--fg)}
.pds-toolbar{height:32px;flex:none;display:flex;align-items:center;gap:5px;padding:0 8px;border-bottom:1px solid var(--line)}.pds-button{height:23px;padding:0 8px;border:1px solid #c8c8c8;border-radius:2px;background:#f7f7f7;cursor:pointer;white-space:nowrap}.pds-button:hover:not(:disabled){background:var(--hover)}.pds-button:focus-visible,.pds-icon-button:focus-visible,.pds-tree-row:focus-visible,.pds-terminal-tab:focus-visible,.pds-section-head:focus-visible{outline:1px solid var(--blue);outline-offset:-2px}.pds-button:disabled{opacity:.45;cursor:default}.pds-button.primary{background:var(--blue);border-color:var(--blue);color:white}.pds-button.danger{color:var(--red)}
.pds-main{display:flex;flex:1;min-height:0}.pds-side{width:232px;min-width:180px;max-width:46%;border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;background:#fafafa}.pds-side-scroll{flex:1;min-height:0;overflow:auto;padding:4px 0 8px}.pds-section{border-bottom:1px solid var(--line)}.pds-section-head{width:100%;height:26px;border:0;background:transparent;display:flex;align-items:center;gap:6px;padding:0 8px;cursor:pointer;font-weight:600;color:#3c3c3c;text-align:left}.pds-section-head:hover{background:#eee}.pds-section-caret{width:10px;color:#777;flex:none}.pds-section-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-section-count{font:10px var(--mono);color:var(--muted)}
.pds-tree{padding:2px 0 4px}.pds-tree-row{width:100%;min-height:25px;padding:3px 8px 3px calc(9px + var(--depth,0)*14px);display:flex;align-items:center;gap:6px;text-align:left;border:0;background:transparent;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pds-tree-row:hover:not(:disabled){background:#eee}.pds-tree-row:disabled{opacity:.45;cursor:default}.pds-tree-row[aria-selected=true]{background:#cce8ff;color:#111}.pds-tree-caret{width:10px;color:#777;flex:none}.pds-tree-glyph{width:14px;text-align:center;color:#687782;flex:none}.pds-tree-label{overflow:hidden;text-overflow:ellipsis;flex:1}.pds-tree-state{font:10px var(--mono);color:var(--muted)}
.pds-models{padding:2px 0 6px}.pds-model-provider{width:100%;min-height:25px;border:0;background:transparent;display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;text-align:left}.pds-model-provider:hover{background:#eee}.pds-model-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-model-count{font:10px var(--mono);color:var(--muted)}.pds-model-list{padding:1px 0 3px}.pds-model-item{display:flex;align-items:flex-start;gap:6px;padding:3px 8px 3px 26px;cursor:pointer}.pds-model-item:hover{background:#eee}.pds-model-item input{margin:1px 0 0;flex:none;accent-color:var(--blue)}.pds-model-label{display:flex;flex-direction:column;min-width:0}.pds-model-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-model-desc{color:var(--muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-model-hint{padding:4px 10px 6px;color:var(--muted);font-size:10px;line-height:1.5}.pds-model-error{padding:4px 10px;color:var(--red);font-size:11px}
.pds-work{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}.pds-status{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pds-status[data-state=running]{color:var(--blue)}.pds-status[data-state=error]{color:var(--red)}.pds-empty{color:#888;font:12px var(--sans);padding:18px}.pds-alert{padding:7px 10px;margin:6px;background:#fff2f2;border:1px solid #edc5c8;color:var(--red)}
.pds-terminal{flex:1;min-height:0;display:flex;flex-direction:column}.pds-termbar{height:30px;flex:none;background:#f6f6f6;border-bottom:1px solid var(--line);display:flex;align-items:stretch;overflow-x:auto}.pds-terminal-tab{border:0;border-right:1px solid var(--line);background:transparent;min-width:110px;max-width:190px;padding:0 6px 0 9px;display:flex;align-items:center;gap:6px;cursor:pointer}.pds-terminal-tab[aria-selected=true]{background:#fff;border-top:2px solid var(--blue)}.pds-terminal-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}.pds-term-state{font:9px var(--mono);color:var(--muted);flex:none}.pds-icon-button{width:21px;height:21px;border:0;background:transparent;border-radius:2px;cursor:pointer;color:#777;flex:none}.pds-term-add{margin:auto 4px}.pds-terminal-content{flex:1;min-height:0;display:flex;flex-direction:column;background:#fff}.pds-term-output{flex:1;min-height:0;overflow:auto;margin:0;padding:7px 10px;color:#333;font:11px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;caret-color:#111}.pds-term-caret{display:inline-block;width:6px;height:12px;background:#333;vertical-align:-1px;animation:pds-blink 1.06s step-end infinite}@keyframes pds-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.pds-term-input{height:27px;flex:none;display:flex;border-top:1px solid #eee}.pds-term-prompt{padding:5px 8px;color:var(--blue);font:11px var(--mono)}.pds-term-input input{flex:1;min-width:0;border:0;outline:0;background:white;font:11px var(--mono);color:var(--fg);caret-color:#111}.pds-term-input input:focus{caret-color:#111}.pds-term-empty{padding:12px;color:var(--muted);font-size:11px;line-height:1.6}
`;

    const useStore = store => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const runtimeLabel = state => state === 'running' ? '运行中' : state === 'starting' ? '启动中' : state === 'exited' ? '已退出' : state === 'error' ? '启动失败' : '已停止';
    const terminalLabel = state => state === 'running' ? '●' : state === 'starting' ? '◌' : state === 'error' ? '✕' : '';

    function Section({ id, title, count, expanded, onToggle, children }) {
      return h('section', { className: 'pds-section' },
        h('button', { type: 'button', className: 'pds-section-head', 'aria-expanded': expanded, 'aria-controls': `${ID}-${id}`, onClick: onToggle },
          h('span', { className: 'pds-section-caret' }, expanded ? '⌄' : '›'),
          h('span', { className: 'pds-section-title' }, title),
          count === undefined ? null : h('span', { className: 'pds-section-count' }, count)),
        expanded ? h('div', { id: `${ID}-${id}` }, children) : null);
    }

    function ModelSettings({ store, selected, credentials, disabled }) {
      const [catalog, setCatalog] = React.useState({ loading: true, error: null, providers: [] });
      const [open, setOpen] = React.useState({});
      React.useEffect(() => {
        let cancelled = false;
        store.request('models').then(
          value => { if (!cancelled) setCatalog({ loading: false, error: null, providers: value?.providers || [] }); },
          error => { if (!cancelled) setCatalog({ loading: false, error: error.message, providers: [] }); },
        );
        return () => { cancelled = true; };
      }, [store]);
      const chosen = new Set(selected.map(item => `${item.provider}\u0000${item.model}`));
      const toggle = (provider, model, checked) => {
        const next = checked
          ? [...selected.filter(item => !(item.provider === provider && item.model === model)), { provider, model }]
          : selected.filter(item => !(item.provider === provider && item.model === model));
        void store.action('saveModels', { selectedModels: next });
      };
      if (catalog.loading) return h('div', { className: 'pds-model-hint' }, '正在读取模型目录…');
      if (catalog.error) return h('div', { className: 'pds-model-error' }, catalog.error);
      return h('div', { className: 'pds-models' },
        catalog.providers.map(provider => {
          const isOpen = open[provider.id] === true;
          const count = provider.models.filter(model => chosen.has(`${provider.id}\u0000${model.id}`)).length;
          return h('div', { key: provider.id },
            h('button', { type: 'button', className: 'pds-model-provider', 'aria-expanded': isOpen, onClick: () => setOpen(value => ({ ...value, [provider.id]: !isOpen })) },
              h('span', { className: 'pds-tree-caret' }, isOpen ? '⌄' : '›'),
              h('span', { className: 'pds-model-name' }, provider.name || provider.id),
              h('span', { className: 'pds-model-count' }, count ? `${count}/${provider.models.length}` : String(provider.models.length))),
            provider.error ? h('div', { className: 'pds-model-error' }, provider.error) : null,
            isOpen ? h('div', { className: 'pds-model-list' }, provider.models.map(model => {
              const key = `${provider.id}\u0000${model.id}`;
              return h('label', { key: model.id, className: 'pds-model-item' },
                h('input', { type: 'checkbox', checked: chosen.has(key), disabled, onChange: event => toggle(provider.id, model.id, event.target.checked) }),
                h('span', { className: 'pds-model-label' },
                  h('span', { className: 'pds-model-id' }, model.name || model.id),
                  model.description ? h('span', { className: 'pds-model-desc' }, model.description) : null));
            })) : null);
        }),
        h('div', { className: 'pds-model-hint' },
          '勾选的模型与参数会写入沙箱 profile；启动时把对应凭据复制到沙箱 .credentials.yaml（权限 0600），沙箱停止即删除。',
          credentials.length ? ` 已复制 ${credentials.length} 个凭据。` : ''),
      );
    }

    function DebugPanel({ store }) {
      const state = useStore(store);
      const snapshot = state.snapshot;
      const [expanded, setExpanded] = React.useState({ debug: true, models: false });
      const [openGroups, setOpenGroups] = React.useState({ runtime: true, builds: true, tests: true, checks: true });
      const [selected, setSelected] = React.useState(null);
      const [activeTerminal, setActiveTerminal] = React.useState(null);
      const [terminalInput, setTerminalInput] = React.useState('');
      const inputRef = React.useRef(null);
      const binding = snapshot?.binding;
      const runtime = snapshot?.runtime;
      const runtimeState = runtime?.state || 'stopped';
      const commands = snapshot?.commands || [];
      const terminals = snapshot?.terminals || [];
      const terminalLogs = snapshot?.logs || [];
      const selectedModels = snapshot?.models || [];
      const active = terminals.find(item => item.id === activeTerminal) || terminals[0];
      const groupOf = item => /test|spec/i.test(item.id) ? 'tests' : /check|lint|type|contrast|selector/i.test(item.id) ? 'checks' : 'builds';
      const groups = [
        { id: 'runtime', label: '插件运行', glyph: '▾', items: [
          { id: 'launch', label: '启动独立 DSH', glyph: '▶', action: 'launch', disabled: !binding || runtimeState === 'running' || runtimeState === 'starting' },
          { id: 'stop', label: '停止沙箱', glyph: '■', action: 'stop', disabled: runtimeState !== 'running' && snapshot?.command?.state !== 'running' && terminals.length === 0 },
        ] },
        ...['builds', 'tests', 'checks'].map(id => ({ id, label: id === 'builds' ? '构建' : id === 'tests' ? '测试' : '检查', glyph: '▾',
          items: commands.filter(item => groupOf(item) === id).map(item => ({ id: `script:${item.id}`, label: item.id, commandId: item.id, glyph: id === 'tests' ? '✓' : id === 'checks' ? '◇' : '◆', disabled: !binding })) })),
      ];
      const run = fields => { void store.action(fields.action || 'run', fields); };
      const chooseNode = node => {
        setSelected(node.id);
        if (node.action) { void store.action(node.action); return; }
        if (node.commandId) { createTerminal(node.commandId); }
      };
      const createTerminal = commandId => {
        const request = { rows: 24, cols: 80, ...(commandId ? { commandId } : {}) };
        void store.action('terminalCreate', request).then(value => {
          const list = value?.terminals;
          if (!Array.isArray(list)) return;
          const created = commandId ? [...list].reverse().find(item => item.commandId === commandId) : list.at(-1);
          setActiveTerminal(created?.id || null);
        });
      };
      const closeTerminal = id => { void store.action('terminalClose', { terminalId: id }); };
      React.useEffect(() => {
        if (active?.state === 'running') inputRef.current?.focus();
      }, [active?.id, active?.state]);
      const sendTerminal = event => {
        event.preventDefault();
        if (!active || active.state !== 'running') return;
        const data = `${terminalInput}\n`;
        setTerminalInput('');
        void store.action('terminalWrite', { terminalId: active.id, data });
      };
      const rawOutput = active ? terminalLogs.filter(line => line.source === 'terminal' && line.terminalId === active.id).map(line => line.text).join('') : '';
      const output = cleanTerminal(rawOutput);
      const renderRows = (items, depth) => items.map(node => h('button', {
        key: node.id, type: 'button', className: 'pds-tree-row', style: { '--depth': depth },
        'aria-selected': selected === node.id, disabled: node.disabled, onClick: () => chooseNode(node),
      },
        h('span', { className: 'pds-tree-caret' }, ''),
        h('span', { className: 'pds-tree-glyph' }, node.glyph || ''),
        h('span', { className: 'pds-tree-label' }, node.label),
        node.commandId && snapshot?.command?.id === node.commandId && snapshot.command.state === 'running' ? h('span', { className: 'pds-tree-state' }, '●') : null));
      return h('div', { className: 'pds' },
        h('header', { className: 'pds-head' },
          h('span', { className: 'pds-head-title' }, binding?.name || TITLE),
          h('span', { className: 'pds-head-meta' }, binding?.pluginPath || '未绑定插件'),
          h('button', { type: 'button', className: 'pds-head-button', title: '刷新状态', onClick: () => { void store.refresh(); } }, '↻')),
        h('div', { className: 'pds-toolbar' },
          h('button', { type: 'button', className: 'pds-button primary', disabled: !binding || state.busy || runtimeState === 'running' || runtimeState === 'starting', onClick: () => run({ action: 'launch' }) }, '▶ 启动'),
          h('button', { type: 'button', className: 'pds-button', disabled: state.busy || (runtimeState !== 'running' && snapshot?.command?.state !== 'running' && terminals.length === 0), onClick: () => run({ action: 'stop' }) }, '■ 停止'),
          runtime?.pid ? h('span', { className: 'pds-status', 'data-state': runtimeState }, `${runtimeLabel(runtimeState)} · PID ${runtime.pid}`) : h('span', { className: 'pds-status', 'data-state': runtimeState }, runtimeLabel(runtimeState)),
          runtime?.url ? h('a', { className: 'pds-status', href: runtime.url, target: '_blank', rel: 'noreferrer' }, '打开实例 ↗') : null),
        !binding ? h('div', { className: 'pds-empty' }, state.loading ? '正在读取绑定…' : '当前会话尚未绑定插件。让 Agent 调用 plugin_dev 的 bind 绑定工作区内的插件目录。') : null,
        state.error ? h('div', { className: 'pds-alert', role: 'alert' }, state.error) : null,
        runtime?.error ? h('div', { className: 'pds-alert', role: 'alert' }, runtime.error) : null,
        h('div', { className: 'pds-main' },
          h('div', { className: 'pds-side' }, h('div', { className: 'pds-side-scroll' },
            h(Section, { id: 'debug', title: '调试', count: commands.length || undefined, expanded: expanded.debug !== false, onToggle: () => setExpanded(value => ({ ...value, debug: value.debug === false })) },
              h('div', { className: 'pds-tree' }, groups.map(group => h('div', { key: group.id },
                h('button', { type: 'button', className: 'pds-tree-row', style: { '--depth': 0 }, 'aria-expanded': openGroups[group.id] !== false, onClick: () => setOpenGroups(value => ({ ...value, [group.id]: value[group.id] === false })) },
                  h('span', { className: 'pds-tree-caret' }, openGroups[group.id] === false ? '›' : '⌄'),
                  h('span', { className: 'pds-tree-glyph' }, group.glyph),
                  h('span', { className: 'pds-tree-label' }, group.label),
                  group.id !== 'runtime' && group.items.length ? h('span', { className: 'pds-tree-state' }, group.items.length) : null),
                openGroups[group.id] === false ? null : renderRows(group.items, 1),
                group.id !== 'runtime' && openGroups[group.id] !== false && group.items.length === 0 ? h('div', { className: 'pds-model-hint' }, '没有匹配的脚本') : null)))),
            h(Section, { id: 'models', title: '提供商与模型', count: selectedModels.length || undefined, expanded: expanded.models === true, onToggle: () => setExpanded(value => ({ ...value, models: value.models !== true })) },
              h(ModelSettings, { store, selected: selectedModels, credentials: snapshot?.credentials || [], disabled: state.busy })))),
          h('section', { className: 'pds-work', 'aria-label': '终端' },
            h('div', { className: 'pds-termbar' },
              terminals.map((terminal, index) => h('div', {
                key: terminal.id, role: 'tab', tabIndex: 0, className: 'pds-terminal-tab',
                'aria-selected': (active && active.id === terminal.id) === true,
                onClick: () => setActiveTerminal(terminal.id),
                onKeyDown: event => { if (event.key === 'Enter') setActiveTerminal(terminal.id); },
              },
                h('span', null, '›_'),
                h('span', { className: 'pds-terminal-tab-label' }, terminal.commandId || `终端 ${index + 1}`),
                h('span', { className: 'pds-term-state' }, terminalLabel(terminal.state)),
                h('button', { type: 'button', className: 'pds-icon-button', title: '关闭并终止终端', 'aria-label': `关闭终端 ${index + 1}`, onClick: event => { event.stopPropagation(); closeTerminal(terminal.id); } }, '×'))),
              h('button', { type: 'button', className: 'pds-icon-button pds-term-add', title: '新建终端', 'aria-label': '新建终端', disabled: !binding || state.busy, onClick: () => createTerminal() }, '+')),
            active ? h('div', { className: 'pds-terminal-content' },
              h('pre', { className: 'pds-term-output', 'aria-live': 'polite', onClick: () => inputRef.current?.focus() }, output || (active.state === 'error' ? active.error : ''), active.state === 'running' ? h('span', { className: 'pds-term-caret', 'aria-hidden': 'true' }) : null),
              h('form', { className: 'pds-term-input', onSubmit: sendTerminal },
                h('span', { className: 'pds-term-prompt' }, '>'),
                h('input', { ref: inputRef, value: terminalInput, onChange: event => setTerminalInput(event.target.value), 'aria-label': '终端输入', placeholder: active.state === 'running' ? '输入命令后回车' : '终端已结束' , disabled: active.state !== 'running' || state.busy })))
              : h('div', { className: 'pds-term-empty' }, '还没有打开终端。点击 + 在当前插件目录启动一个独立 PTY；关闭标签会终止进程。'))));
    }

    async function apply(ctx) {
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
          return () => style.remove();
        }, 'plugin-sandbox.style');
        remoteCtx.effect(() => () => { for (const store of stores.values()) store.dispose(); stores.clear(); }, 'plugin-sandbox.stores');
        remoteCtx.effect(() => remoteCtx.sidebarRightTabs.register({
          id: ID, kind: KIND, multiple: false, priority: 'extension', title: () => TITLE,
          guide: [{ id: 'open', order: 30, title: () => TITLE, description: () => '在独立实例中运行并调试当前会话的插件' }],
        }), 'plugin-sandbox.type');
        remoteCtx.effect(() => remoteCtx.slots.inject('sidebar.right.pane.tab', () => remoteCtx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, inject: sessionId => ({ store: storeFor(sessionId) }),
        }, DebugPanel)), 'plugin-sandbox.body');
      });
    }
    return { name: ID, inject: ['slots', 'remote', 'sidebarRight', 'sidebarRightTabs'], apply };
  },
});
