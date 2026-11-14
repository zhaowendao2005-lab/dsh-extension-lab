import { useStore, useRef, useEffect } from '../../runtime.js';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { Icon } from '../common/Icon.jsx';
import { languageForPath } from '../../service/language.js';
import { languageSupport } from '../../editor/languages.js';
import { editorThemeExtension } from '../../editor/theme.js';

/** Read-only side-by-side diff for the file selected in the Source Control view. */
export function DiffView({ stores }) {
  const diff = useStore(stores.diff);
  const hostRef = useRef(null);
  const mergeRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !diff.sides || diff.phase !== 'ready') return undefined;
    const language = languageForPath(diff.path ?? '');
    // `editorThemeExtension()` already wraps the highlight style in `syntaxHighlighting`; passing the
    // bare HighlightStyle here throws "Unrecognized extension value in extension set".
    const extensions = [EditorView.editable.of(false), EditorState.readOnly.of(true), editorThemeExtension()];
    const support = languageSupport(language);
    if (support) extensions.push(support);

    if (diff.mode === 'unified') {
      // One editable=false view over the *new* text, with the old text as the merge base.
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: diff.sides.newText,
          extensions: [
            ...extensions,
            unifiedMergeView({
              original: diff.sides.oldText,
              highlightChanges: true,
              gutter: true,
              mergeControls: false,
              collapseUnchanged: { margin: 3, minSize: 4 },
            }),
          ],
        }),
      });
      mergeRef.current = view;
      return () => {
        view.destroy();
        mergeRef.current = null;
      };
    }

    const merge = new MergeView({
      parent: host,
      a: { doc: diff.sides.oldText, extensions },
      b: { doc: diff.sides.newText, extensions },
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
      renderRevertControl: () => null,
    });
    mergeRef.current = merge;
    return () => {
      merge.destroy();
      mergeRef.current = null;
    };
  }, [diff.sides, diff.phase, diff.path, diff.mode]);

  if (diff.phase === 'idle') {
    return (
      <div className="wid-diff wid-diff--empty">
        <span className="wid-hint">从源代码管理里选择一个文件查看差异</span>
      </div>
    );
  }

  const file = (diff.files ?? []).find((entry) => entry.path === diff.selected) ?? diff.files?.[0] ?? null;

  return (
    <div className="wid-diff">
      <div className="wid-diff__header">
        <span className="wid-diff__title wid-mono">{diff.path ?? file?.path ?? ''}</span>
        {file && (
          <span className="wid-diff__stats">
            <span data-kind="add">+{file.additions ?? 0}</span>
            <span data-kind="del">−{file.deletions ?? 0}</span>
          </span>
        )}
        {diff.truncated && <span className="wid-hint">差异过大，已截断</span>}
        {diff.binary && <span className="wid-hint">二进制文件</span>}
        <span className="wid-spacer" />
        <span className="wid-diff__modes" role="group" aria-label="差异布局">
          <button
            type="button"
            className="wid-button"
            aria-pressed={diff.mode !== 'unified'}
            onClick={() => stores.diffActions.setMode('split')}
          >
            并排
          </button>
          <button
            type="button"
            className="wid-button"
            aria-pressed={diff.mode === 'unified'}
            onClick={() => stores.diffActions.setMode('unified')}
          >
            统一
          </button>
        </span>
        {diff.target?.kind === 'working' && (
          <button type="button" className="wid-button" onClick={() => void stores.diffActions.stageFile()}>
            暂存文件
          </button>
        )}
        <button type="button" className="wid-icon-button" title="关闭差异" onClick={() => stores.diffActions.close()}>
          <Icon name="close" size={12} />
        </button>
      </div>
      {diff.phase === 'loading' && (
        <div className="wid-empty">
          <span className="wid-hint">正在读取差异…</span>
        </div>
      )}
      {diff.phase === 'error' && (
        <div className="wid-empty">
          <span className="wid-hint">{diff.error ?? '读取差异失败'}</span>
          <button type="button" className="wid-button" onClick={() => void stores.diffActions.open(diff.target, diff.path)}>
            重试
          </button>
        </div>
      )}
      {(diff.files?.length ?? 0) > 1 && (
        <div className="wid-diff__files">
          {diff.files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="wid-diff__file"
              data-active={entry.path === diff.selected ? 'true' : undefined}
              onClick={() => stores.diffActions.select(entry.path)}
              title={entry.path}
            >
              {entry.path}
            </button>
          ))}
        </div>
      )}
      {(diff.hunks?.length ?? 0) > 0 && (
        <div className="wid-diff__hunks" aria-label="代码块">
          {diff.hunks.map((hunk, index) => (
            <span className="wid-diff__hunk" key={`${hunk.oldStart}:${hunk.newStart}:${index}`}>
              <span className="wid-mono">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </span>
              {diff.target?.kind === 'working' && (
                <button
                  type="button"
                  className="wid-icon-button"
                  title="暂存此代码块"
                  onClick={() => void stores.diffActions.stageHunk(index)}
                >
                  +
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="wid-diff__panes" ref={hostRef} />
    </div>
  );
}
