import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';

function Disclosure({ collapsed }) {
  return <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />;
}

function PackageNode({ node, state, actions }) {
  const isPackage = Boolean(node.entry);
  const collapsed = Boolean(state.collapsed[node.id]);
  return (
    <li role="treeitem" aria-expanded={isPackage ? undefined : !collapsed}
      aria-selected={isPackage ? state.selected === node.path : undefined}>
      <button type="button" className="wid-commands__path" title={isPackage ? node.path + (node.entry.name ? ' · ' + node.entry.name : '') : node.path}
        aria-current={isPackage && state.selected === node.path ? 'true' : undefined}
        onClick={() => isPackage ? actions.selectPackage(node.path) : actions.toggle(node.id)}>
        {isPackage ? <span className="wid-commands__indent" /> : <Disclosure collapsed={collapsed} />}
        {isPackage ? <FileIcon name={node.name} /> : <Icon name="folder" size={14} />}
        <span className="wid-commands__label">{node.name}</span>
        {isPackage && node.entry.name ? <span className="wid-commands__meta">{node.entry.name}</span> : null}
      </button>
      {!isPackage && !collapsed && node.children.length ? (
        <ul role="group">{node.children.map((child) => <PackageNode key={child.id} node={child} state={state} actions={actions} />)}</ul>
      ) : null}
    </li>
  );
}

/** Two fixed tree roots: manifest paths, then scripts from the selected manifest. */
export function CommandsView({ stores }) {
  const state = useStore(stores.commands);
  const workspace = useStore(stores.workspace);
  const actions = stores.commandActions;
  const packagesCollapsed = Boolean(state.collapsed['root:packages']);
  const scriptsCollapsed = Boolean(state.collapsed['root:scripts']);

  function navigate(event) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const row = event.target.closest('button');
    if (!row || !event.currentTarget.contains(row)) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const item = row.closest('[role="treeitem"]');
      const expanded = item?.getAttribute('aria-expanded');
      if (expanded === null) return;
      if ((event.key === 'ArrowLeft' && expanded === 'true') || (event.key === 'ArrowRight' && expanded === 'false')) {
        event.preventDefault();
        row.click();
      }
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(row);
    if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <section className="wid-commands" aria-label="包脚本命令">
      <header className="wid-commands__toolbar">
        <span>命令</span>
        <button type="button" className="wid-commands__refresh" onClick={() => actions.load()}
          disabled={!workspace.root || state.phase === 'loading'} title="重新扫描 package.json" aria-label="重新扫描 package.json">
          <Icon name="refresh" size={14} />
        </button>
      </header>
      {state.error ? <div className="wid-commands__error" role="alert">{state.error}</div> : null}
      {state.truncated ? <p className="wid-commands__hint">扫描达到上限，部分包未列出。</p> : null}
      {state.warnings.map((warning, index) => <p className="wid-commands__hint" key={index}>{warning}</p>)}
      <ul className="wid-commands__tree" role="tree" aria-label="命令树" onKeyDown={navigate}>
        <li role="treeitem" aria-expanded={!packagesCollapsed}>
          <button type="button" className="wid-commands__root" onClick={() => actions.toggle('root:packages')}>
            <Disclosure collapsed={packagesCollapsed} />
            <span className="wid-commands__label">package.json</span>
            <span className="wid-commands__count">{state.packages.length}</span>
          </button>
          {!packagesCollapsed ? <ul role="group">
            {state.packageTree?.children.map((node) => <PackageNode key={node.id} node={node} state={state} actions={actions} />)}
            {!state.packages.length ? <li role="none" className="wid-commands__hint">{!workspace.root ? '打开工作区后扫描包' : state.phase === 'loading' ? '正在扫描…' : '未找到 package.json'}</li> : null}
          </ul> : null}
        </li>
        <li role="treeitem" aria-expanded={!scriptsCollapsed}>
          <button type="button" className="wid-commands__root" onClick={() => actions.toggle('root:scripts')}>
            <Disclosure collapsed={scriptsCollapsed} />
            <span className="wid-commands__label">Scripts</span>
            <span className="wid-commands__count">{state.scripts.length}</span>
          </button>
          {!scriptsCollapsed ? <ul role="group">
            {state.selected ? <li role="none" className="wid-commands__selected" title={state.selected}>{state.selected}</li> : null}
            {state.scriptError ? <li role="none" className="wid-commands__error" aria-live="polite">{state.scriptError}</li> : null}
            {state.scripts.map((script) => {
              const busy = state.running.includes(JSON.stringify([state.selected, script.name]));
              return <li role="treeitem" key={script.name} className="wid-commands__script">
                <div className="wid-commands__script-line">
                  <Icon name="terminal" size={14} />
                  <span className="wid-commands__label">{script.name}</span>
                  <button type="button" className="wid-commands__play" disabled={busy || !workspace.root}
                    onClick={() => actions.run(script.name)} aria-label={'在新终端运行 ' + script.name}
                    title={busy ? '正在创建终端…' : '在 ' + (state.packageInfo?.cwd ?? '.') + ' 的新终端运行 ' + (state.packageInfo?.runner?.command ?? 'npm') + ' run ' + script.name}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3.5 16 10 6 16.5Z" /></svg>
                  </button>
                </div>
                <pre className="wid-commands__preview" title={script.command}>{script.command}</pre>
              </li>;
            })}
            {!state.scripts.length && !state.scriptError ? <li role="none" className="wid-commands__hint">{state.scriptsPhase === 'loading' ? '正在读取 scripts…' : state.selected ? '此包没有 scripts' : '先选择一个 package.json'}</li> : null}
          </ul> : null}
        </li>
      </ul>
    </section>
  );
}
