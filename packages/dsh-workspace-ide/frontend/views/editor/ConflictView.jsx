import { useStore } from '../../runtime.js';

const SIDES = [
  { key: 'ours', label: '我方（HEAD）', hint: '当前分支上的版本' },
  { key: 'base', label: '共同祖先', hint: '两边分叉前的版本' },
  { key: 'theirs', label: '对方', hint: '正在合并进来的版本' },
];

/**
 * Three-way conflict view (M4-2). Read-only panes on purpose: content edits belong in the
 * editor with the conflict markers, and "pick a side" is a git operation, not a text edit.
 */
export function ConflictView({ stores }) {
  const conflict = useStore(stores.conflict);
  const busy = conflict.phase === 'loading';

  if (conflict.phase === 'error') {
    return (
      <div className="wid-empty">
        <span className="wid-hint">{conflict.error}</span>
        <button type="button" className="wid-button" onClick={() => void stores.conflictActions.open(conflict.path)}>
          重试
        </button>
      </div>
    );
  }

  if (!conflict.path) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">选择一个冲突文件</span>
      </div>
    );
  }

  return (
    <div className="wid-conflict">
      <div className="wid-conflict__bar">
        <span className="wid-conflict__path wid-mono" title={conflict.path}>{conflict.path}</span>
        <span className="wid-conflict__spacer" />
        <button type="button" className="wid-button wid-button--primary" disabled={busy} onClick={() => void stores.conflictActions.resolve('ours')}>
          采用我方
        </button>
        <button type="button" className="wid-button wid-button--primary" disabled={busy} onClick={() => void stores.conflictActions.resolve('theirs')}>
          采用对方
        </button>
        <button type="button" className="wid-button" disabled={busy} onClick={() => void stores.conflictActions.resolve('both')}>
          两者都保留
        </button>
        <button type="button" className="wid-button" disabled={busy} onClick={() => void stores.conflictActions.markResolved()} title="文件已手工改好后，标记为已解决（等价 git add）">
          标记已解决
        </button>
        <button type="button" className="wid-button wid-button--danger" disabled={busy} onClick={() => void stores.conflictActions.resolve('delete')}>
          删除文件
        </button>
      </div>
      {conflict.binary && <div className="wid-conflict__note wid-hint">二进制文件：只能选择一侧或删除</div>}
      {conflict.truncated && <div className="wid-conflict__note wid-hint">内容超过上限，仅显示前一部分</div>}
      <div className="wid-conflict__panes" data-sides={SIDES.length}>
        {SIDES.map((side) => (
          <section className="wid-conflict__pane" key={side.key} aria-label={side.label}>
            <header className="wid-conflict__pane-head" title={side.hint}>
              {side.label}
              <span className="wid-conflict__pane-meta">
                {conflict[side.key] === null ? '该侧不存在' : `${countLines(conflict[side.key])} 行`}
              </span>
            </header>
            <pre className="wid-conflict__text wid-mono">
              {conflict[side.key] ?? ''}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}

function countLines(text) {
  if (!text) return 0;
  let lines = 1;
  for (const char of text) if (char === '\n') lines += 1;
  return lines;
}
