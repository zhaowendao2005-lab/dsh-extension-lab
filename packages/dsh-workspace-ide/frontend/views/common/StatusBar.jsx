import { useStore } from '../../runtime.js';
import { Icon } from './Icon.jsx';
import { languageLabelForPath } from '../../service/language.js';

/** Status bar: root, branch, change counts, cursor, encoding (docs/ui-spec.md §10). */
export function StatusBar({ stores }) {
  const workspace = useStore(stores.workspace);
  const scm = useStore(stores.scm);
  const editor = useStore(stores.editor);
  const files = useStore(stores.files);

  const active = editor.tabs.find((tab) => tab.path === editor.activePath) ?? null;
  const status = scm.status;
  const changes = status
    ? status.staged.length + status.working.length + status.untracked.length + status.conflicts.length
    : null;
  const branch = workspace.git?.isRepo
    ? (workspace.git.detached ? `HEAD@${(workspace.git.sha ?? '').slice(0, 7)}` : workspace.git.branch ?? 'HEAD')
    : null;

  return (
    <footer className="wid-statusbar" aria-label="状态栏">
      <span className="wid-statusbar__item" title={workspace.root ?? '未选择工作区'}>
        <Icon name="folder" size={11} />
        {workspace.name ?? '—'}
      </span>
      <span className="wid-statusbar__item" title={branch ? `分支 ${branch}` : '当前工作区不是 Git 仓库'}>
        <Icon name="branch" size={11} />
        {branch ?? '无仓库'}
        {status && (status.branch.ahead > 0 || status.branch.behind > 0) && (
          <span className="wid-hint">
            {status.branch.ahead > 0 ? `↑${status.branch.ahead}` : ''}
            {status.branch.behind > 0 ? `↓${status.branch.behind}` : ''}
          </span>
        )}
      </span>
      {changes !== null && (
        <button type="button" className="wid-statusbar__item" onClick={() => stores.actions.setActivity('scm')} title="变更数">
          {changes} 变更
        </button>
      )}
      {workspace.root && !workspace.trust && (
        <button
          type="button"
          className="wid-statusbar__item"
          onClick={() => void stores.actions.setTrusted(true)}
          title="写入、Git 写操作与终端都需要先信任该目录"
        >
          <Icon name="warning" size={11} />
          未信任
        </button>
      )}
      {files.error && <span className="wid-statusbar__item wid-hint">{files.error}</span>}
      <span className="wid-statusbar__spacer" />
      {active ? (
        <>
          <span className="wid-statusbar__item" title="行,列">
            {editor.cursor ? `${editor.cursor.line},${editor.cursor.column}` : '—'}
          </span>
          <span className="wid-statusbar__item" title="语言">
            {languageLabelForPath(active.path)}
          </span>
          <span className="wid-statusbar__item" title="换行符">
            {(active.eol ?? 'lf').toUpperCase()}
          </span>
          <span className="wid-statusbar__item" title="编码">
            UTF-8{active.bom ? ' BOM' : ''}
          </span>
        </>
      ) : (
        <span className="wid-statusbar__item wid-hint">未打开文件</span>
      )}
    </footer>
  );
}
