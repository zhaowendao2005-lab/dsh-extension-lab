import React, { useSnapshot } from './runtime'
import type { ConfigStore } from './configStore'
import { DEFAULT_CONFIG, type UiEnhancementsConfig } from '../shared/contract'
import { displayShortcut, formatShortcutFromEvent } from './shortcuts'

interface ToggleRowSpec {
  key: keyof Pick<
    UiEnhancementsConfig,
    | 'enableSwissSettings'
    | 'enableSwissModals'
    | 'enableSwissPopovers'
    | 'enableSwissMarket'
    | 'enableModelPicker'
  >
  title: string
  desc: string
}

const UI_FEATURE_ROWS: readonly ToggleRowSpec[] = [
  {
    key: 'enableSwissSettings',
    title: '设置弹窗主题',
    desc: '将设置弹窗改造为 80% 视口、序号导航栏、方正排版与 Swiss 配色。',
  },
  {
    key: 'enableSwissModals',
    title: '通用模态框与归档管理器',
    desc: '为确认弹窗、归档管理器及内部开关/复选框应用直角无阴影样式。',
  },
  {
    key: 'enableSwissPopovers',
    title: '菜单与浮层直角化',
    desc: '移除右键菜单与非模态弹出层的圆角。',
  },
  {
    key: 'enableSwissMarket',
    title: '插件市场主题适配',
    desc: '为插件市场列表、搜索栏与全屏模式应用 Swiss 网格风格。',
  },
]

export function SettingsIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="12" />
      <line x1="6" y1="2" x2="6" y2="14" />
      <line x1="6" y1="7" x2="14" y2="7" />
    </svg>
  )
}

export function SettingsPage({
  store,
  onRecordingChange,
}: {
  store: ConfigStore
  onRecordingChange?: (recording: boolean) => void
}): React.ReactElement {
  const snap = useSnapshot(store)
  const cfg = snap.config
  const [recording, setRecording] = React.useState(false)

  React.useEffect(() => {
    onRecordingChange?.(recording)
    return () => onRecordingChange?.(false)
  }, [recording, onRecordingChange])

  React.useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const formatted = formatShortcutFromEvent(event)
      if (!formatted) return
      setRecording(false)
      void store.setField('modelPickerShortcut', formatted)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, store])

  const flashText =
    snap.flash === 'saved'
      ? '已热更新并保存'
      : snap.flash === 'local'
        ? '已热更新（本地存储）'
        : snap.flash === 'failed'
          ? '保存失败'
          : null

  return (
    <section className="dsh-enh-settings">
      <header className="dsh-enh-settings-header">
        <div>
          <h2 className="dsh-enh-settings-title">Enhans 界面与交互增强</h2>
          <p className="dsh-enh-settings-desc">
            按功能块独立开关，所有更改即时热更新生效，无需重启或刷新页面。
          </p>
        </div>
        <div className="dsh-enh-badge" title={snap.namespace ? `Config: ${snap.namespace}` : 'Local'}>
          <span className="dsh-enh-badge-dot" aria-hidden="true" />
          <span>{flashText ?? '热更新就绪'}</span>
        </div>
      </header>

      <div className="dsh-enh-group">
        <div className="dsh-enh-group-head">01 · Swiss 界面增强功能块</div>
        {UI_FEATURE_ROWS.map((row) => {
          const checked = cfg[row.key]
          return (
            <div className="dsh-enh-row" key={row.key}>
              <div className="dsh-enh-row-copy">
                <div className="dsh-enh-row-title">{row.title}</div>
                <div className="dsh-enh-row-desc">{row.desc}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={row.title}
                className="dsh-enh-switch"
                onClick={() => void store.setField(row.key, !checked)}
              >
                <span className="dsh-enh-switch-thumb" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="dsh-enh-group">
        <div className="dsh-enh-group-head">02 · 模型选择改善</div>
        <div className="dsh-enh-row">
          <div className="dsh-enh-row-copy">
            <div className="dsh-enh-row-title">启用增强模型选择面板</div>
            <div className="dsh-enh-row-desc">
              在当前输入框上方弹出等宽选择面板，支持左侧提供商筛选与顶部模糊搜索（ds / cl / gm 等别名）。
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enableModelPicker}
            aria-label="启用增强模型选择面板"
            className="dsh-enh-switch"
            onClick={() => void store.setField('enableModelPicker', !cfg.enableModelPicker)}
          >
            <span className="dsh-enh-switch-thumb" aria-hidden="true" />
          </button>
        </div>

        <div className="dsh-enh-row">
          <div className="dsh-enh-row-copy">
            <div className="dsh-enh-row-title">打开模型选择面板快捷键</div>
            <div className="dsh-enh-row-desc">
              点击右侧按钮后按下任意组合键即可录制，按 Esc 取消录制。
            </div>
          </div>
          <div className="dsh-enh-shortcut-controls">
            <button
              type="button"
              className={`dsh-enh-shortcut-btn ${recording ? 'is-recording' : ''}`}
              onClick={() => setRecording((prev) => !prev)}
            >
              {recording ? '请按下快捷键…' : displayShortcut(cfg.modelPickerShortcut)}
            </button>
            {cfg.modelPickerShortcut !== DEFAULT_CONFIG.modelPickerShortcut && (
              <button
                type="button"
                className="dsh-enh-btn"
                onClick={() => void store.setField('modelPickerShortcut', DEFAULT_CONFIG.modelPickerShortcut)}
              >
                重置默认
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
