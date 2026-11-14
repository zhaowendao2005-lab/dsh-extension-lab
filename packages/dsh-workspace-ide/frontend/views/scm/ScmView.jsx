import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

const GROUPS = [
  { key: 'conflicts', label: '合并冲突', icon: 'warning', stageable: true },
  { key: 'staged', label: '暂存的更改', icon: 'check', unstageable: true },
  { key: 'working', label: '更改', icon: 'dot', stageable: true, discardable: true },
  { key: 'untracked', label: '未跟踪', icon: 'plus', stageable: true, discardable: true },
];

/**
 * Source Control view: the four porcelain-v2 groups, a commit box and per-row stage /
 * unstage / discard. Shapes come from `git.status` (docs/git-model.md §3).
 */
export function ScmView({ stores }) {
  const scm = useStore(stores.scm);
  const workspace = useStore(stores.workspace);
  const ui = useStore(stores.ui);
  const status = scm.status;

  if (!workspace.git?.isRepo) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">当前目录不是 Git 仓库</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">{scm.phase === 'loading' ? '正在读取状态…' : '还没有状态'}</span>
      </div>
    );
  }

  const branch = status.branch ?? {};
  const stagedCount = (status.staged ?? []).length;
  const busy = scm.writes.length > 0;
  const canCommit = stagedCount > 0 && scm.message.trim().length > 0 && !busy && workspace.trust;

  return (
    <div className="wid-scm">
      <div className="wid-scm__branch">
        <button
          type="button"
          className="wid-scm__branch-button"
          title="切换/新建分支"
          onClick={() => stores.actions.toggleMenu('branches')}
        >
          <Icon name="branch" size={14} />
          <span className="wid-mono">
            {branch.detached ? `HEAD @ ${(branch.sha ?? '').slice(0, 7)}` : branch.name ?? 'HEAD'}
          </span>
        </button>
        {branch.unborn && <span className="wid-hint">尚无提交</span>}
        {branch.ahead > 0 && <span className="wid-hint">↑{branch.ahead}</span>}
        {branch.behind > 0 && <span className="wid-hint">↓{branch.behind}</span>}
        <span className="wid-scm__branch-spacer" />
        <button
          type="button"
          className="wid-icon-button"
          title="贮藏"
          onClick={() => stores.actions.toggleMenu('stash')}
          disabled={busy}
        >
          <Icon name="collapse" size={12} />
        </button>
        <button
          type="button"
          className="wid-icon-button"
          title="刷新状态"
          onClick={() => void stores.actions.refreshScm()}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {ui.menu === 'branches' && (
        <div className="wid-scm__menu" role="menu">
          <div className="wid-scm__menu-head">
            <span>分支</span>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.createBranch()}>
              新建
            </button>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.createTag()}>
              打标签
            </button>
          </div>
          <ul className="wid-scm__menu-list">
            {(scm.refs?.local ?? []).map((ref) => (
              <li key={ref.name}>
                <button
                  type="button"
                  className="wid-scm__menu-item"
                  data-active={ref.head ? 'true' : undefined}
                  onClick={() => {
                    stores.actions.toggleMenu('branches');
                    void stores.scmActions.checkout(ref.name);
                  }}
                >
                  <span className="wid-mono">{ref.name}</span>
                  {ref.upstreamGone && <span className="wid-hint">gone</span>}
                  {!ref.head && (
                    <span
                      className="wid-icon-button"
                      role="button"
                      tabIndex={0}
                      title="删除分支"
                      onClick={(event) => {
                        event.stopPropagation();
                        void stores.scmActions.deleteBranch(ref.name);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              </li>
            ))}
            {!(scm.refs?.local ?? []).length && <li className="wid-hint">还没有分支</li>}
          </ul>
          {(scm.refs?.tags ?? []).length > 0 && (
            <div className="wid-scm__menu-tags">
              {(scm.refs.tags ?? []).slice(0, 12).map((tag) => (
                <span key={tag.name} className="wid-graph__badge" data-kind="tag">
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {ui.menu === 'stash' && (
        <div className="wid-scm__menu" role="menu">
          <div className="wid-scm__menu-head">
            <span>贮藏</span>
            <button type="button" className="wid-button" onClick={() => void stores.scmActions.stashPush()}>
              贮藏当前修改
            </button>
          </div>
          <ul className="wid-scm__menu-list">
            {(scm.stashes ?? []).map((entry, index) => (
              <li key={`${entry.ref ?? index}`}>
                <button
                  type="button"
                  className="wid-scm__menu-item"
                  title={entry.subject ?? entry.ref ?? ''}
                  onClick={() => void stores.scmActions.stashPop(index)}
                >
                  <span className="wid-mono">stash@{`{${index}}`}</span>
                  <span className="wid-scm__menu-msg">{entry.subject ?? ''}</span>
                </button>
              </li>
            ))}
            {!(scm.stashes ?? []).length && <li className="wid-hint">没有贮藏</li>}
          </ul>
        </div>
      )}

      {status.operation && <div className="wid-scm__banner">进行中：{status.operation}</div>}
      {status.isHuge && (
        <div className="wid-scm__banner">
          未跟踪 {status.counts?.untracked ?? 0} 项，自动刷新已降级为手动
        </div>
      )}
      {!workspace.trust && (
        <div className="wid-scm__banner wid-scm__banner--warn">未信任该工作区：不能暂存、提交或切换分支</div>
      )}

      <div className="wid-scm__commit">
        <textarea
          className="wid-scm__message"
          rows={2}
          placeholder="提交信息（Cmd/Ctrl+Enter 提交）"
          value={scm.message}
          onChange={(event) => stores.actions.setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void stores.scmActions.commit(scm.message);
              stores.actions.setCommitMessage('');
            }
          }}
        />
        <div className="wid-scm__commit-row">
          <span className="wid-hint" title={canCommit ? undefined : commitHint({ stagedCount, message: scm.message, busy, trust: workspace.trust })}>
            {scm.message.length > 72 ? `${scm.message.length}/72` : `${stagedCount} 个已暂存`}
          </span>
          <button
            type="button"
            className="wid-button wid-button--primary"
            disabled={!canCommit}
            title={canCommit ? '提交' : commitHint({ stagedCount, message: scm.message, busy, trust: workspace.trust })}
            onClick={() => {
              void stores.scmActions.commit(scm.message);
              stores.actions.setCommitMessage('');
            }}
          >
            提交
          </button>
        </div>
        {busy && <div className="wid-scm__queue">正在执行 {scm.writes.join('、')}</div>}
      </div>

      {GROUPS.map((group) => {
        const items = status[group.key] ?? [];
        if (!items.length) return null;
        return (
          <section key={group.key} className="wid-scm__group" data-group={group.key}>
            <div className="wid-scm__group-head">
              <Icon name={group.icon} size={12} />
              <span className="wid-scm__group-title">{group.label}</span>
              <span className="wid-hint">{items.length}</span>
              <span className="wid-scm__group-spacer" />
              {group.unstageable && (
                <button
                  type="button"
                  className="wid-icon-button"
                  title="全部取消暂存"
                  disabled={busy}
                  onClick={() => void stores.scmActions.unstage(items.map((item) => item.path), true)}
                >
                  −
                </button>
              )}
              {group.stageable && (
                <button
                  type="button"
                  className="wid-icon-button"
                  title="全部暂存"
                  disabled={busy}
                  onClick={() => void stores.scmActions.stage(items.map((item) => item.path), true)}
                >
                  +
                </button>
              )}
            </div>
            <ul className="wid-scm__list">
              {items.map((change) => (
                <li key={`${group.key}:${change.path}:${change.origPath ?? ''}`} className="wid-scm__item">
                  <button
                    type="button"
                    className="wid-scm__row"
                    title={change.path}
                    onClick={() => void openRow(stores, group.key, change.path)}
                    onDoubleClick={() => void stores.actions.openFile(change.path)}
                  >
                    <span className="wid-scm__status" data-status={change.status} aria-hidden="true">
                      {change.status}
                    </span>
                    <span className="wid-scm__path">{basename(change.path)}</span>
                    <span className="wid-scm__dir">{dirname(change.path)}</span>
                  </button>
                  <span className="wid-scm__row-actions">
                    {group.stageable && (
                      <button
                        type="button"
                        className="wid-icon-button"
                        title="暂存"
                        disabled={busy}
                        onClick={() => void stores.scmActions.stage([change.path])}
                      >
                        +
                      </button>
                    )}
                    {group.unstageable && (
                      <button
                        type="button"
                        className="wid-icon-button"
                        title="取消暂存"
                        disabled={busy}
                        onClick={() => void stores.scmActions.unstage([change.path])}
                      >
                        −
                      </button>
                    )}
                    {group.discardable && (
                      <button
                        type="button"
                        className="wid-icon-button wid-icon-button--danger"
                        title="丢弃更改"
                        disabled={busy}
                        onClick={() => void stores.scmActions.discard([change.path])}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {!stagedCount && !(status.working ?? []).length && !(status.untracked ?? []).length && !(status.conflicts ?? []).length && (
        <div className="wid-empty">
          <span className="wid-hint">没有变更</span>
        </div>
      )}
    </div>
  );
}

/** Working tree changes diff against the index; staged changes diff against HEAD. */
function diffTargetFor(group) {
  return group === 'staged' ? { kind: 'index' } : { kind: 'working' };
}

function commitHint({ stagedCount, message, busy, trust }) {
  if (!trust) return '需要先信任该工作区';
  if (busy) return '上一个写操作还在执行';
  if (!stagedCount) return '没有已暂存的更改';
  if (!String(message ?? '').trim()) return '提交信息不能为空';
  return undefined;
}

/** Conflicts open in the three-way view; everything else opens a diff against its side. */
function openRow(stores, group, path) {
  if (group === 'conflicts') return stores.actions.openConflict(path);
  return stores.actions.openDiff(diffTargetFor(group), path);
}

function basename(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
