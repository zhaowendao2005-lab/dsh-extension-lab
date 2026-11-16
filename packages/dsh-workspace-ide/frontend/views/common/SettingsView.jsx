import { useStore } from '../../runtime.js';

import { SHORTCUT_COMMANDS, shortcutBindingLabel } from '../../service/shortcuts.js';

/** Settings page: workspace, presentation, editor preferences and effective limits. */
export function SettingsView({ stores }) {
  const workspace = useStore(stores.workspace);
  const ui = useStore(stores.ui);
  const files = useStore(stores.files);
  const catalog = useStore(stores.host.shortcutCatalog);
  const shortcutStatus = useStore(stores.host.shortcutStatus);
  const limits = workspace.limits ?? {};

  return (
    <div className="wid-settings">
      <section className="wid-settings__section">
        <h3 className="wid-settings__title">工作区</h3>
        <div className="wid-settings__row">
          <span className="wid-settings__label">根目录</span>
          <span className="wid-mono wid-settings__root" title={workspace.root ?? ''}>
            {workspace.root ?? '未选择'}
          </span>
        </div>
        <div className="wid-settings__actions">
          <button type="button" className="wid-button" onClick={() => void stores.actions.pickRoot()}>
            切换工作区…
          </button>
          <button type="button" className="wid-button" onClick={() => void stores.actions.refreshWorkspace()}>
            重新读取
          </button>
        </div>
      </section>


      <section className="wid-settings__section">
        <h3 className="wid-settings__title">最近打开</h3>
        {workspace.recents?.length ? (
          <ul className="wid-settings__list">
            {workspace.recents.map((item) => {
              const root = typeof item === 'string' ? item : (item?.root ?? item?.path ?? '');
              return (
                <li key={root}>
                  <button
                    type="button"
                    className="wid-settings__link wid-mono"
                    title={root}
                    onClick={() => void stores.actions.openRoot(root)}
                  >
                    {root}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="wid-hint">还没有记录</span>
        )}
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">工作台尺寸</h3>
        <label className="wid-settings__row">
          <span className="wid-settings__label">整体缩放</span>
          <select className="wid-settings__input" value={ui.uiScale} onChange={(event) => stores.actions.setUiScale(Number(event.target.value))}>
            {[80, 90, 100, 110, 125, 150].map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        <p className="wid-hint">立即调整工作台内的标签、按钮、文件树、编辑器和终端，并记住设置。右栏和全视图共用此尺寸。</p>
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">编辑器</h3>
        {[
          { key: 'fontSize', label: '字号', min: 10, max: 20 },
          { key: 'tabSize', label: 'Tab 显示宽度', min: 1, max: 8 },
          { key: 'indentSize', label: '缩进空格数', min: 1, max: 8 },
        ].map(({ key, label, min, max }) => (
          <label className="wid-settings__row" key={key}>
            <span className="wid-settings__label">{label}</span>
            <select className="wid-settings__input" value={ui.editor[key]}
              onChange={(event) => stores.actions.setEditorPref(key, Number(event.target.value))}>
              {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        ))}
        <label className="wid-settings__row">
          <input
            type="checkbox"
            checked={Boolean(ui.editor.wrap)}
            onChange={(event) => stores.actions.setEditorPref('wrap', event.target.checked)}
          />
          <span className="wid-settings__label">自动换行</span>
        </label>
        <p className="wid-hint">修改后立即应用到当前编辑器和差异视图，切回其他文件时沿用。Tab 显示宽度只控制已有制表符的显示；缩进空格数用于新的缩进操作，不会重写已有空格。</p>
        <p className="wid-hint">自动换行仅用于不超过 2000 行、最长行不超过 500 字符的内容，超出时视图会说明原因。这些偏好保存在本机浏览器，不写入工作区。</p>
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">快捷键</h3>
        <p className="wid-hint">
          从 DSH 主左侧栏底部的「设置」（或账号 / 更多菜单）进入「通用 → 编辑快捷键」，搜索“工作台：”后分配按键。
          <span className="wid-mono">Mod + /</span> 可直接打开宿主快捷键弹窗（Mod 在 macOS 为 ⌘，其他平台为 Ctrl）。工作台默认不绑定按键。
        </p>
        {(!shortcutStatus.available || shortcutStatus.error || shortcutStatus.failed.length > 0) && (
          <p className="wid-hint" role="status">宿主快捷键尚未就绪或部分命令注册失败。请重载插件后查看；此状态不代表“未绑定”。</p>
        )}
        <ul className="wid-settings__list">
          {SHORTCUT_COMMANDS.map((item) => (
            <li key={item.id} className="wid-settings__row">
              <span className="wid-settings__label">{item.label}</span>
              <span className="wid-mono wid-settings__value wid-settings__keys">{shortcutBindingLabel(catalog, shortcutStatus, item.id)}</span>
            </li>
          ))}
        </ul>
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
