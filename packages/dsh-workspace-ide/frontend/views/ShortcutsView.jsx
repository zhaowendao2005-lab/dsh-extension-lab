import { useStore, useEffect, useRef } from '../runtime.js';
import { Icon } from './common/Icon.jsx';

const EMPTY_ROWS = [];
const EMPTY_CATALOG = { getSnapshot: () => EMPTY_ROWS, subscribe: () => () => {} };
const FULL_VIEW_ID = 'workspace-ide.fullview';

/** Workbench shortcut sheet plus a recorder for the full-view toggle. */
export function ShortcutsView({ stores }) {
  const ui = useStore(stores.ui);
  const shortcuts = stores.host?.shortcuts;
  const catalog = useStore(shortcuts ? shortcuts.catalog : EMPTY_CATALOG);
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!ui.shortcutRecording || !shortcuts) return undefined;
    recordingRef.current = true;
    const onKeyDown = async (event) => {
      if (!recordingRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        recordingRef.current = false;
        stores.actions.setShortcutRecording(false);
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      recordingRef.current = false;
      const macos = shortcuts.platform === 'macos';
      const modifiers = [];
      const primary = macos ? event.metaKey : event.ctrlKey;
      if (primary) modifiers.push('primary');
      if (macos && event.ctrlKey) modifiers.push('control');
      if (!macos && event.metaKey) modifiers.push('meta');
      if (event.altKey) modifiers.push('alt');
      if (event.shiftKey) modifiers.push('shift');
      const binding = { code: event.code, modifiers };
      try {
        const described = shortcuts.describeBinding(binding);
        if (described.issue) {
          stores.actions.notify('warn', '这个组合不可用：' + described.issue, null);
          stores.actions.setShortcutRecording(false);
          return;
        }
        if (described.conflicts.length > 0) {
          stores.actions.notify('warn', '这个组合与已注册命令冲突', { conflicts: described.conflicts });
          stores.actions.setShortcutRecording(false);
          return;
        }
        const revision = shortcuts.config.getSnapshot().revision;
        const result = await shortcuts.edit({ type: 'set', id: FULL_VIEW_ID, binding }, revision);
        if (result?.status !== 'saved') {
          const reason = result?.status === 'conflict' ? '与其它命令冲突' : result?.status === 'stale' ? '配置已变化，请重试' : '快捷键保存失败';
          stores.actions.notify('error', reason, { status: result?.status });
        } else {
          stores.actions.notify('info', '全视图快捷键已更新', null);
        }
      } catch (error) {
        stores.actions.notify('error', error?.message ?? '快捷键保存失败', null);
      }
      stores.actions.setShortcutRecording(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      recordingRef.current = false;
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [ui.shortcutRecording, shortcuts, stores]);

  if (!shortcuts) {
    return (
      <div className="wid-empty"><span className="wid-hint">当前环境没有快捷键服务</span></div>
    );
  }

  const rows = catalog.filter((row) => row.id.startsWith('workspace-ide.'));
  const fullView = catalog.find((row) => row.id === FULL_VIEW_ID) ?? null;

  return (
    <div className="wid-settings wid-shortcuts">
      <section className="wid-settings__section">
        <h3 className="wid-settings__title">全视图</h3>
        <p className="wid-hint">
          打开后隐藏右栏工作台标签，把同一个工作台显示为占满 frame 80% 的对话框；再按一次或点外部/Esc 关闭。
        </p>
        <div className="wid-shortcuts__row">
          <span className="wid-settings__label">打开/关闭全视图</span>
          <span className="wid-shortcuts__keys wid-mono">{fullView?.keys?.length ? fullView.keys.join(' + ') : '未绑定'}</span>
          <button
            type="button"
            className="wid-button"
            onClick={() => stores.actions.setShortcutRecording(!ui.shortcutRecording)}
          >
            {ui.shortcutRecording ? '请按下组合键…（Esc 取消）' : '录制'}
          </button>
          <button
            type="button"
            className="wid-button"
            onClick={async () => {
              try {
                const revision = shortcuts.config.getSnapshot().revision;
                const result = await shortcuts.edit({ type: 'reset', id: FULL_VIEW_ID }, revision);
                if (result?.status !== 'saved') stores.actions.notify('error', '恢复默认失败', { status: result?.status });
              } catch (error) {
                stores.actions.notify('error', error?.message ?? '恢复默认失败', null);
              }
            }}
          >
            恢复默认
          </button>
        </div>
        {fullView?.issue && <p className="wid-hint">当前键位不可用：{fullView.issue}</p>}
        {fullView?.conflicts?.length > 0 && <p className="wid-hint">与其它命令冲突：{fullView.conflicts.join(', ')}</p>}
      </section>

      <section className="wid-settings__section">
        <h3 className="wid-settings__title">工作台命令</h3>
        <ul className="wid-shortcuts__list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>{row.label}</span>
              <span className="wid-shortcuts__keys wid-mono">{row.keys?.length ? row.keys.join(' + ') : '未绑定'}</span>
            </li>
          ))}
        </ul>
        <p className="wid-hint">完整快捷键速查由 DSH 提供：按 ⌘/ 或在通用设置里打开。</p>
      </section>
    </div>
  );
}
