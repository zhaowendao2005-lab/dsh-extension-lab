import { useStore } from '../../runtime.js';

/** Settings page: workspace root, trust gate, recents and the effective limits. */
export function SettingsView({ stores }) {
  const workspace = useStore(stores.workspace);
  const ui = useStore(stores.ui);
  const files = useStore(stores.files);
  const limits = workspace.limits ?? {};

  return (
    <div className="wid-settings">
      <section className="wid-settings__section">
        <h3 className="wid-settings__title">工作区</h3>
        <div className="wid-settings__row">
          <span className="wid-settings__label">根目录</span>
          <span className="wid-mono wid-settings__value" title={workspace.root ?? ''}>
            {workspace.root ?? '未选择'}
          </span>
        </div>
        <div className="wid-settings__actions">
          <button type="button" className="wid-button" onClick={() => void stores.actions.pickRoot()}>
            选择目录…
          </button>
          <button type="button" className="wid-button" onClick={() => void stores.actions.refreshWorkspace()}>
            重新读取
          </button>
        </div>
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">信任</h3>
        <p className="wid-hint">
          未信任的工作区不能写入文件、执行 Git 写操作或启动终端。信任按精确路径记录，子目录需要各自信任。
        </p>
        <label className="wid-settings__row">
          <input
            type="checkbox"
            checked={Boolean(workspace.trust)}
            disabled={!workspace.root}
            onChange={(event) => void stores.actions.setTrusted(event.target.checked)}
          />
          <span className="wid-settings__label">信任此目录</span>
        </label>
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">最近打开</h3>
        {workspace.recents?.length ? (
          <ul className="wid-settings__list">
            {workspace.recents.map((item) => (
              <li key={item.root ?? item.path ?? String(item)}>
                <button
                  type="button"
                  className="wid-settings__link wid-mono"
                  title={item.root ?? item.path ?? ''}
                  onClick={() => void stores.actions.openRoot(item.root ?? item.path)}
                >
                  {item.name ?? item.root ?? item.path}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="wid-hint">还没有记录</span>
        )}
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">编辑器</h3>
        <label className="wid-settings__row">
          <span className="wid-settings__label">字号</span>
          <input
            className="wid-settings__input"
            type="number"
            min="10"
            max="20"
            step="1"
            value={ui.editor.fontSize}
            onChange={(event) => stores.actions.setEditorPref('fontSize', Number(event.target.value))}
          />
        </label>
        <label className="wid-settings__row">
          <span className="wid-settings__label">制表宽度</span>
          <input
            className="wid-settings__input"
            type="number"
            min="1"
            max="8"
            step="1"
            value={ui.editor.tabSize}
            onChange={(event) => stores.actions.setEditorPref('tabSize', Number(event.target.value))}
          />
        </label>
        <label className="wid-settings__row">
          <input
            type="checkbox"
            checked={Boolean(ui.editor.wrap)}
            onChange={(event) => stores.actions.setEditorPref('wrap', event.target.checked)}
          />
          <span className="wid-settings__label">自动换行</span>
        </label>
        <p className="wid-hint">这些偏好只存在本机浏览器，不写入工作区。</p>
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">生效上限</h3>
        <dl className="wid-settings__limits">
          <dt>单次读取行数</dt>
          <dd className="wid-mono">{limits.readLinesDefault ?? '-'}</dd>
          <dt>写入上限</dt>
          <dd className="wid-mono">{formatBytes(limits.writeBytesMax)}</dd>
          <dt>终端缓冲</dt>
          <dd className="wid-mono">{formatBytes(limits.terminalBufferBytes)}</dd>
          <dt>状态轮询</dt>
          <dd className="wid-mono">{limits.statusPollMs ? `${limits.statusPollMs} ms` : '-'}</dd>
        </dl>
        {files.error && <p className="wid-hint">{files.error}</p>}
      </section>
    </div>
  );
}

function formatBytes(value) {
  if (!value) return '-';
  if (value >= 1024 * 1024) return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
