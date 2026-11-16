import { useEffect, useStore } from '../../runtime.js';
import {
  UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN,
} from '../../stores/preferences.stores.js';
import { SHORTCUT_COMMANDS, shortcutBindingLabel } from '../../service/shortcuts.js';

const FONT_SIZES = Array.from({ length: 11 }, (_, index) => 10 + index);
const TAB_STEPS = Array.from({ length: 8 }, (_, index) => 1 + index);

/**
 * The workbench page inside the Host settings panel (DSH 设置 → 工作台).
 *
 * It owns browser-global preferences: whole-surface scale, editor preferences and the
 * inline shortcut recorder for the workbench commands. Workspace/session state (root
 * folder, recent folders, protocol limits) stays in the workbench toolbar because it
 * differs per session and per workspace.
 *
 * No React state lives here: the percentage draft and the shortcut recording state are
 * store fields, so they survive re-renders and can be committed or rolled back explicitly.
 */
export function IdeSettingsSection({
  preferences, shortcutCatalog, shortcutStatus, shortcutEditor,
}) {
  const prefs = useStore(preferences.store);
  const draft = useStore(preferences.draft);
  const catalog = useStore(shortcutCatalog);
  const status = useStore(shortcutStatus);
  const recorder = useStore(shortcutEditor.store);
  const scaleText = draft.scaleText ?? String(prefs.uiScale);
  const shortcutsUnavailable = !status.available || Boolean(status.error) || status.failed.length > 0;
  const recording = recorder.recording;

  // The capture listener sits on window before the Host dispatcher's bubble listener, so a
  // recorded combination neither runs its old action nor triggers a Host shortcut.
  useEffect(() => {
    if (!recording) return undefined;
    const onKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      void shortcutEditor.actions.keydown(recording, event);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, shortcutEditor]);

  // Closing the settings page mid-recording must release the Host's native-key suppression.
  useEffect(() => () => shortcutEditor.actions.cancel(), [shortcutEditor]);

  const commitScale = () => preferences.actions.commitScaleDraft();
  const onScaleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitScale();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      preferences.actions.cancelScaleDraft();
    }
  };

  return (
    <div className="wid-ide-settings">
      <header className="wid-ide-settings__head">
        <h2 className="wid-ide-settings__heading">工作台</h2>
        <p className="wid-ide-settings__intro">
          右栏工作台与全视图共用这里的偏好。修改立即生效，只保存在本机浏览器，不写入工作区。
        </p>
      </header>

      <section className="wid-ide-settings__section" aria-labelledby="wid-ide-settings-scale">
        <h3 className="wid-ide-settings__title" id="wid-ide-settings-scale">界面尺寸</h3>
        <div className="wid-ide-settings__row">
          <label className="wid-ide-settings__label" htmlFor="wid-ide-settings-scale-input">整体缩放</label>
          <div className="wid-ide-settings__control">
            <span className={'wid-ide-settings__unit' + (draft.error ? ' wid-ide-settings__unit--invalid' : '')}>
              <input
                id="wid-ide-settings-scale-input"
                className="wid-ide-settings__number"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={draft.error ? 'true' : undefined}
                aria-describedby={draft.error ? 'wid-ide-settings-scale-error' : 'wid-ide-settings-scale-hint'}
                value={scaleText}
                onChange={(event) => preferences.actions.setScaleDraft(event.target.value)}
                onBlur={commitScale}
                onKeyDown={onScaleKeyDown}
              />
              <span className="wid-ide-settings__unit-suffix" aria-hidden="true">%</span>
            </span>
            <button
              type="button"
              className="wid-ide-settings__button"
              onClick={() => preferences.actions.setUiScale(UI_SCALE_DEFAULT)}
              title={'恢复 ' + UI_SCALE_DEFAULT + '%'}
            >
              默认
            </button>
          </div>
        </div>
        {draft.error ? (
          <p className="wid-ide-settings__error" id="wid-ide-settings-scale-error" role="alert">{draft.error}</p>
        ) : (
          <p className="wid-ide-settings__hint" id="wid-ide-settings-scale-hint">
            可输入 {UI_SCALE_MIN}–{UI_SCALE_MAX} 之间的任意整数，回车或离开输入框后生效；内容不合规时保留原值并提示。
          </p>
        )}
        <p className="wid-ide-settings__hint">缩放作用于标签、按钮、文件树、编辑器与终端，右栏和全视图保持一致。</p>
      </section>

      <section className="wid-ide-settings__section" aria-labelledby="wid-ide-settings-editor">
        <h3 className="wid-ide-settings__title" id="wid-ide-settings-editor">编辑器</h3>
        <div className="wid-ide-settings__row">
          <label className="wid-ide-settings__label" htmlFor="wid-ide-settings-font">字号</label>
          <select
            id="wid-ide-settings-font"
            className="wid-ide-settings__select"
            value={prefs.editor.fontSize}
            onChange={(event) => preferences.actions.setEditorPref('fontSize', Number(event.target.value))}
          >
            {FONT_SIZES.map((value) => <option key={value} value={value}>{value} px</option>)}
          </select>
        </div>
        <div className="wid-ide-settings__row">
          <label className="wid-ide-settings__label" htmlFor="wid-ide-settings-tab">Tab 显示宽度</label>
          <select
            id="wid-ide-settings-tab"
            className="wid-ide-settings__select"
            value={prefs.editor.tabSize}
            onChange={(event) => preferences.actions.setEditorPref('tabSize', Number(event.target.value))}
          >
            {TAB_STEPS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="wid-ide-settings__row">
          <label className="wid-ide-settings__label" htmlFor="wid-ide-settings-indent">缩进空格数</label>
          <select
            id="wid-ide-settings-indent"
            className="wid-ide-settings__select"
            value={prefs.editor.indentSize}
            onChange={(event) => preferences.actions.setEditorPref('indentSize', Number(event.target.value))}
          >
            {TAB_STEPS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="wid-ide-settings__row">
          <label className="wid-ide-settings__label" htmlFor="wid-ide-settings-wrap">自动换行</label>
          <input
            id="wid-ide-settings-wrap"
            className="wid-ide-settings__checkbox"
            type="checkbox"
            checked={Boolean(prefs.editor.wrap)}
            onChange={(event) => preferences.actions.setEditorPref('wrap', event.target.checked)}
          />
        </div>
        <p className="wid-ide-settings__hint">
          Tab 显示宽度只影响已有制表符的显示宽度；缩进空格数用于新的缩进操作，不会重写已有空格。
        </p>
        <p className="wid-ide-settings__hint">
          自动换行仅用于不超过 2000 行、最长行不超过 500 字符的内容，超出时编辑器会说明暂停原因并保留偏好。
        </p>
      </section>

      <section className="wid-ide-settings__section" aria-labelledby="wid-ide-settings-keys">
        <h3 className="wid-ide-settings__title" id="wid-ide-settings-keys">快捷键</h3>
        <p className="wid-ide-settings__hint">
          在这里直接为工作台命令设置按键：点「设置」或「修改」后按下组合键，Esc 取消录制。工作台默认不占用任何按键，绑定只作用于工作台命令，不影响其他功能。
        </p>
        {shortcutsUnavailable && (
          <p className="wid-ide-settings__warning" role="status">
            宿主快捷键服务尚未就绪或部分命令注册失败，下面的状态可能不准确；这不等于命令已绑定按键。
          </p>
        )}
        <ul className="wid-ide-settings__keys">
          {SHORTCUT_COMMANDS.map((item) => {
            const row = catalog.find((entry) => entry.id === item.id);
            const isRecording = recording === item.id;
            const isSaving = recorder.saving === item.id;
            const keys = Array.isArray(row?.keys) ? row.keys : [];
            const bound = keys.length > 0;
            return (
              <li className="wid-ide-settings__key-row" key={item.id} data-recording={isRecording ? 'true' : undefined}>
                <span className="wid-ide-settings__key-label">
                  {item.label}
                  {row?.modified ? <span className="wid-ide-settings__key-tag">已修改</span> : null}
                </span>
                <span className="wid-ide-settings__key-state">
                  {isRecording ? (
                    <span className="wid-ide-settings__recording" role="status">请按下按键…（Esc 取消）</span>
                  ) : bound ? (
                    <span className="wid-ide-settings__chips">
                      {keys.map((key) => <kbd className="wid-ide-settings__chip" key={key}>{key}</kbd>)}
                    </span>
                  ) : (
                    <span className="wid-ide-settings__key-value">{shortcutBindingLabel(catalog, status, item.id)}</span>
                  )}
                </span>
                <span className="wid-ide-settings__key-actions">
                  {isRecording ? (
                    <button
                      type="button"
                      className="wid-ide-settings__button wid-ide-settings__button--sm"
                      onClick={() => shortcutEditor.actions.cancel()}
                    >
                      取消
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="wid-ide-settings__button wid-ide-settings__button--sm"
                        disabled={isSaving || shortcutsUnavailable}
                        onClick={() => shortcutEditor.actions.begin(item.id)}
                      >
                        {isSaving ? '保存中…' : bound ? '修改' : '设置'}
                      </button>
                      {bound ? (
                        <button
                          type="button"
                          className="wid-ide-settings__button wid-ide-settings__button--sm"
                          disabled={isSaving}
                          onClick={() => shortcutEditor.actions.clear(item.id)}
                        >
                          清除
                        </button>
                      ) : null}
                      {row?.modified ? (
                        <button
                          type="button"
                          className="wid-ide-settings__button wid-ide-settings__button--sm"
                          disabled={isSaving}
                          onClick={() => shortcutEditor.actions.reset(item.id)}
                        >
                          默认
                        </button>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {recorder.error ? <p className="wid-ide-settings__error" role="alert">{recorder.error}</p> : null}
        {recorder.notice ? <p className="wid-ide-settings__hint" role="status">{recorder.notice}</p> : null}
      </section>

      <section className="wid-ide-settings__section">
        <div className="wid-ide-settings__row">
          <span className="wid-ide-settings__label">恢复默认</span>
          <button type="button" className="wid-ide-settings__button" onClick={() => preferences.actions.reset()}>
            恢复全部默认值
          </button>
        </div>
        <p className="wid-ide-settings__hint">把缩放与编辑器偏好恢复为初始值；工作区和会话状态不受影响。</p>
      </section>
    </div>
  );
}
