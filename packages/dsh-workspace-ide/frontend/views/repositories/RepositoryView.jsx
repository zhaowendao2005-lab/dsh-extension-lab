import { useMemo, useStore } from '../../runtime.js';
import { buildPathTree } from '../../service/path-tree.js';
import { Icon } from '../common/Icon.jsx';

/** Native lists, disclosure buttons and checkboxes retain normal Tab/Space/Enter behavior. */
export function RepositoryView({ stores }) {
  const state = useStore(stores.repositories);
  const workspace = useStore(stores.workspace);
  // Re-evaluate the shared restriction whenever any input to it changes.
  useStore(stores.scm);
  useStore(stores.ui);
  useStore(stores.diff);
  useStore(stores.conflict);
  const actions = stores.repositoryActions;
  const changeReason = actions.getChangeReason();
  const rootName = workspace.name || workspace.root?.split(/[\\/]/).filter(Boolean).pop() || '工作区';
  const tree = useMemo(() => buildPathTree(state.repositories, { rootName }), [state.repositories, rootName]);
  const tracked = useMemo(() => new Set(state.tracked), [state.tracked]);
  const busy = state.phase === 'loading';
  return (
    <section className="wid-repositories" aria-label="Git 仓库">
      <header className="wid-repositories__header">
        <strong>仓库</strong>
        <span className="wid-repositories__count">{state.tracked.length} / {state.repositories.length} 已跟踪</span>
        <button type="button" className="wid-repositories__refresh" onClick={() => actions.scan()}
          disabled={!workspace.root || busy} title="重新扫描工作区中的 Git 仓库" aria-label="刷新仓库列表">
          <Icon name="refresh" size={14} />
        </button>
      </header>
      <p className="wid-repositories__hint">勾选仓库以跟踪更改，点击已跟踪的仓库切换源代码管理。</p>
      {state.error && <p className="wid-repositories__error" role="alert">{state.error}</p>}
      {state.truncated && <p className="wid-repositories__warning" role="status">扫描达到上限，结果可能不完整；已保存的跟踪选项会保留。</p>}
      {state.warnings.length > 0 && <ul className="wid-repositories__warnings" aria-label="扫描提示">
        {state.warnings.map((warning, index) => <li key={index}>{typeof warning === 'string' ? warning : warning.message ?? '部分目录无法扫描'}</li>)}
      </ul>}
      {busy && <p className="wid-repositories__hint" role="status">正在扫描仓库…</p>}
      {!workspace.root ? <p className="wid-repositories__empty">先打开工作区目录</p>
        : !state.repositories.length ? (!busy && <p className="wid-repositories__empty">
          {state.phase === 'error' ? '扫描未完成，请刷新重试' : state.phase === 'idle' ? '刷新以扫描 Git 仓库' : '当前工作区未发现 Git 仓库'}
        </p>) : <nav className="wid-repositories__tree" aria-label="仓库目录" aria-busy={busy}>
          <ul className="wid-repositories__nodes">
            <RepositoryNode node={tree} state={state} tracked={tracked} actions={actions} changeReason={changeReason} />
          </ul>
        </nav>}
      {state.repositories.length > 0 && state.tracked.length === 0 && <p className="wid-repositories__hint" role="status">尚未跟踪任何仓库</p>}
      {state.active !== null && !state.repositories.some((entry) => entry.path === state.active)
        && <p className="wid-repositories__warning" role="status">活动仓库 {state.active} 未包含在本次扫描中</p>}
    </section>
  );
}

function RepositoryNode({ node, state, tracked, actions, changeReason }) {
  const repository = node.entry;
  const hasChildren = node.children.length > 0;
  const expanded = !state.collapsed[node.path];
  const checked = tracked.has(node.path);
  const active = repository && state.active === node.path;
  const label = node.path === '.' ? node.name : repository?.name || node.name;
  return (
    <li className="wid-repositories__node">
      <div className="wid-repositories__row" data-active={Boolean(active)}>
        {hasChildren ? <button type="button" className="wid-repositories__disclosure"
          onClick={() => actions.toggle(node.path)} aria-expanded={expanded}
          aria-label={(expanded ? '折叠 ' : '展开 ') + label} title={(expanded ? '折叠 ' : '展开 ') + node.path}>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
        </button> : <span className="wid-repositories__spacer" />}
        {repository ? <>
          <input type="checkbox" className="wid-repositories__checkbox" checked={checked} disabled={Boolean(changeReason)}
            aria-label={'跟踪仓库 ' + label + '（' + node.path + '）'} title={changeReason || '跟踪 ' + node.path}
            onChange={(event) => actions.setTracked(node.path, event.target.checked)} />
          <span className="wid-repositories__icon"><Icon name="scm" size={14} /></span>
          <button type="button" className="wid-repositories__select" disabled={!checked || Boolean(changeReason)}
            onClick={() => actions.select(node.path)} aria-pressed={Boolean(active)}
            title={changeReason || (checked ? '切换到仓库 ' + node.path : '先勾选以跟踪此仓库：' + node.path)}>
            <span className="wid-repositories__name">{label}</span>
            {active && <span className="wid-repositories__active">当前</span>}
          </button>
        </> : <>
          <span className="wid-repositories__icon"><Icon name="folder" size={14} /></span>
          {hasChildren ? <button type="button" className="wid-repositories__folder"
            aria-expanded={expanded} onClick={() => actions.toggle(node.path)} title={node.path}>
            <span className="wid-repositories__name">{label}</span>
          </button> : <span className="wid-repositories__name">{label}</span>}
        </>}
      </div>
      {hasChildren && expanded && <ul className="wid-repositories__children">
        {node.children.map((child) => <RepositoryNode key={child.id} node={child} state={state} tracked={tracked} actions={actions} changeReason={changeReason} />)}
      </ul>}
    </li>
  );
}
