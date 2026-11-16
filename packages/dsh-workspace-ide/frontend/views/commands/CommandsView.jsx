import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';

/**
 * Command view: the same density and affordances as the VS Code explorer and the npm-scripts
 * tree in VS Code — one 22px row per entry, an always visible chevron for expandable nodes, a
 * full-row hover highlight, a quiet secondary column and a play action that only appears on
 * hover/focus (always visible on touch). There are no per-row borders or card chrome.
 */

const ROW_BASE = 6;
const ROW_STEP = 10;
const rowStyle = (depth) => ({ '--wid-depth': String(depth), '--wid-row-base': ROW_BASE + 'px', '--wid-row-step': ROW_STEP + 'px' });

function Chevron({ collapsed }) {
  return <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />;
}

function PackageNode({ node, depth, state, actions }) {
  const isPackage = Boolean(node.entry);
  const collapsed = Boolean(state.collapsed[node.id]);
  const current = isPackage && state.selected === node.path;
  const children = !isPackage && !collapsed && node.children.length ? node.children : null;
  return (
    <li role="treeitem" aria-level={depth} aria-expanded={isPackage ? undefined : !collapsed}
      aria-selected={isPackage ? current : undefined}>
      <button
        type="button"
        data-wid-row=""
        className={'wid-commands__row' + (current ? ' wid-commands__row--selected' : '')}
        style={rowStyle(depth)}
        title={isPackage ? node.path + (node.entry.name ? ' · ' + node.entry.name : '') : node.path}
        aria-current={current ? 'true' : undefined}
        onClick={() => (isPackage ? actions.selectPackage(node.path) : actions.toggle(node.id))}
      >
        <span className="wid-commands__chev" aria-hidden="true">{!isPackage && <Chevron collapsed={collapsed} />}</span>
        {isPackage ? <FileIcon name={node.name} /> : <Icon name="folder" size={14} />}
        <span className="wid-commands__label">{node.name}</span>
        {isPackage && node.entry.name ? <span className="wid-commands__meta">{node.entry.name}</span> : null}
      </button>
      {children ? (
        <ul role="group">
          {children.map((child) => (
            <PackageNode key={child.id} node={child} depth={depth + 1} state={state} actions={actions} />
          ))}
        </ul>
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
    const row = event.target.closest('[data-wid-row]');
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
    const rows = [...event.currentTarget.querySelectorAll('[data-wid-row]')];
    const index = rows.indexOf(row);
    if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    event.preventDefault();
    rows[next]?.focus();
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
          <button type="button" data-wid-row="" className="wid-commands__row" style={rowStyle(0)}
            onClick={() => actions.toggle('root:packages')}>
            <span className="wid-commands__chev"><Chevron collapsed={packagesCollapsed} /></span>
            <span className="wid-commands__label">package.json</span>
            <span className="wid-commands__count">{state.packages.length}</span>
          </button>
          {!packagesCollapsed ? (
            <ul role="group">
              {state.packageTree?.children.map((node) => (
                <PackageNode key={node.id} node={node} depth={1} state={state} actions={actions} />
              ))}
              {!state.packages.length ? (
                <li role="none" className="wid-commands__hint">
                  {!workspace.root ? '打开工作区后扫描包' : state.phase === 'loading' ? '正在扫描…' : '未找到 package.json'}
                </li>
              ) : null}
            </ul>
          ) : null}
        </li>
        <li role="treeitem" aria-expanded={!scriptsCollapsed}>
          <button type="button" data-wid-row="" className="wid-commands__row" style={rowStyle(0)}
            onClick={() => actions.toggle('root:scripts')}>
            <span className="wid-commands__chev"><Chevron collapsed={scriptsCollapsed} /></span>
            <span className="wid-commands__label">Scripts</span>
            <span className="wid-commands__count">{state.scripts.length}</span>
          </button>
          {!scriptsCollapsed ? (
            <ul role="group">
              {state.selected ? (
                <li role="none" className="wid-commands__context" title={state.selected}>{state.selected}</li>
              ) : null}
              {state.scriptError ? <li role="none" className="wid-commands__error" aria-live="polite">{state.scriptError}</li> : null}
              {state.scripts.map((script) => {
                const busy = state.running.includes(JSON.stringify([state.selected, script.name]));
                return (
                  <li role="treeitem" aria-level={2} key={script.name} className="wid-commands__script">
                    <div
                      data-wid-row=""
                      className="wid-commands__row wid-commands__row--script"
                      style={rowStyle(1)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        if (event.target !== event.currentTarget) return;
                        event.preventDefault();
                        if (!busy && workspace.root) actions.run(script.name);
                      }}
                    >
                      <span className="wid-commands__chev" aria-hidden="true" />
                      <Icon name="terminal" size={14} />
                      <span className="wid-commands__label">{script.name}</span>
                      <span className="wid-commands__meta wid-commands__meta--command" title={script.command}>{script.command}</span>
                      <button
                        type="button"
                        className="wid-commands__play"
                        disabled={busy || !workspace.root}
                        onClick={() => actions.run(script.name)}
                        aria-label={'在新终端运行 ' + script.name}
                        title={busy ? '正在创建终端…'
                          : '在 ' + (state.packageInfo?.cwd ?? '.') + ' 的新终端运行 '
                            + (state.packageInfo?.runner?.command ?? 'npm') + ' run ' + script.name}
                      >
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d="M6 3.5 16 10 6 16.5Z" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
              {!state.scripts.length && !state.scriptError ? (
                <li role="none" className="wid-commands__hint">
                  {state.scriptsPhase === 'loading' ? '正在读取 scripts…' : state.selected ? '此包没有 scripts' : '先选择一个 package.json'}
                </li>
              ) : null}
            </ul>
          ) : null}
        </li>
      </ul>
    </section>
  );
}
