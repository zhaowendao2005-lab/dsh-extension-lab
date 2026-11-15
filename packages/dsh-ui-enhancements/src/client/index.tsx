import type * as ReactTypes from 'react'
import React, { createRoot, setReact, useSnapshot, type ReactDOMClientLike } from './runtime'
import {
  PACKAGE_ID,
  remoteInfo,
  type CatalogProvider,
  type CatalogResult,
} from '../shared/contract'
import { ConfigStore } from './configStore'
import { FeatureStyleManager } from './features'
import { SettingsIcon, SettingsPage } from './Settings'
import { ModelPickerPanel, type ModelOption } from './ModelPickerPanel'
import { matchesShortcut, toDshBinding } from './shortcuts'

const ENTRY_ID = 'ui-enhancements'

function unwrapRemote<T>(result: unknown): T {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown; error?: { message?: string; code?: string } }
    if (envelope.ok === false) {
      throw new Error(envelope.error?.message ?? envelope.error?.code ?? 'remote call failed')
    }
    return envelope.value as T
  }
  return result as T
}

function sessionIdOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const owner = value as { sessionId?: unknown; session?: { sessionId?: unknown } }
    if (typeof owner.sessionId === 'string') return owner.sessionId
    if (typeof owner.session?.sessionId === 'string') return owner.session.sessionId
  }
  return ''
}

function resolveActiveSessionId(sessions: any, trackedSessionId: string): string {
  if (trackedSessionId) return trackedSessionId
  try {
    const listState = sessions?.list?.getSnapshot?.()
    const fromList =
      listState?.activeId ??
      listState?.currentId ??
      listState?.selectedId ??
      sessions?.activeSessionId ??
      sessions?.currentSessionId
    if (typeof fromList === 'string' && fromList) return fromList
  } catch {
    /* ignore */
  }
  try {
    const match = window.location.pathname.match(/\/sessions?\/([^/?#]+)/)
    if (match?.[1]) return decodeURIComponent(match[1])
  } catch {
    /* ignore */
  }
  return ''
}

function readProjectedModelKey(sessions: any, sessionId: string): string | undefined {
  if (!sessions?.binding || !sessionId) return undefined
  try {
    const binding = sessions.binding(sessionId)
    const snap = binding?.session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.()
    const sel = snap?.next ?? snap?.lastUsed
    if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
      return `${sel.provider}:${sel.model}`
    }
  } catch {
    /* ignore */
  }
  return undefined
}

function trySwitchHostModel(
  sessions: any,
  option: ModelOption,
  trackedSessionId: string,
  rootCtx?: any,
): void {
  if (sessions) {
    try {
      const sessionId = resolveActiveSessionId(sessions, trackedSessionId)
      const directories = rootCtx?.get?.('modelDirectories') ?? rootCtx?.modelDirectories
      if (directories && sessionId) {
        void Promise.resolve(
          directories.directoryFor(sessionId).select({
            provider: option.providerId,
            model: option.modelId,
          }),
        ).catch((error: unknown) => console.error('[ui-enhancements] model switch failed', error))
        return
      }
      if (typeof sessions.selectModel === 'function' && sessionId) {
        void sessions.selectModel({
          sessionId,
          provider: option.providerId,
          model: option.modelId,
        })
        return
      }
      if (typeof sessions.setModel === 'function' && sessionId) {
        void sessions.setModel(sessionId, { providerId: option.providerId, modelId: option.modelId })
        return
      }
    } catch {
      /* fall through to custom event */
    }
  }

  window.dispatchEvent(
    new CustomEvent('dsh-ui-enhancements:model-selected', {
      detail: {
        providerId: option.providerId,
        providerName: option.providerName,
        modelId: option.modelId,
        modelName: option.label,
      },
    }),
  )
}

interface PickerState {
  open: boolean
  providers: CatalogProvider[]
  loading: boolean
  error?: string
  selectedKey?: string
}

class PickerController {
  private state: PickerState = {
    open: false,
    providers: [],
    loading: false,
  }
  private readonly listeners = new Set<() => void>()
  private remote: any = null
  private activeSessionId = ''
  private sessions: any = null
  private rootCtx: any = null

  attachRootCtx(ctx: any): void {
    this.rootCtx = ctx
  }

  getSnapshot = (): PickerState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attachSessions(sessions: any): void {
    this.sessions = sessions
  }

  setActiveSessionId(sessionId: string): void {
    if (sessionId) this.activeSessionId = sessionId
  }

  attachRemote(remote: any): void {
    this.remote = remote
  }

  toggle(): void {
    if (this.state.open) {
      this.close()
    } else {
      this.open()
    }
  }

  open(): void {
    const sessionId = resolveActiveSessionId(this.sessions, this.activeSessionId)
    const projectedKey = readProjectedModelKey(this.sessions, sessionId)
    this.patch({
      open: true,
      ...(projectedKey ? { selectedKey: projectedKey } : {}),
    })
    if (this.state.providers.length === 0 && !this.state.loading) {
      void this.refresh()
    }
  }

  close(): void {
    if (!this.state.open) return
    this.patch({ open: false })
  }

  select(_ctx: any, option: ModelOption): void {
    this.patch({ selectedKey: option.value, open: false })
    trySwitchHostModel(this.sessions, option, this.activeSessionId, this.rootCtx)
  }

  async refresh(): Promise<void> {
    if (!this.remote || typeof this.remote.catalog !== 'function') {
      this.patch({ loading: false, error: '模型目录服务未连接，请稍后重试。' })
      return
    }
    this.patch({ loading: true, error: undefined })
    try {
      const raw = await this.remote.catalog()
      const result = unwrapRemote<CatalogResult>(raw)
      this.patch({
        loading: false,
        providers: Array.isArray(result?.providers) ? result.providers : [],
        error: undefined,
      })
    } catch (error) {
      this.patch({
        loading: false,
        error: error instanceof Error ? error.message : '无法读取模型目录',
      })
    }
  }

  private patch(next: Partial<PickerState>): void {
    this.state = { ...this.state, ...next }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  }
}

function ModelPickerRoot({
  ctx,
  configStore,
  picker,
}: {
  ctx: any
  configStore: ConfigStore
  picker: PickerController
}): React.ReactElement | null {
  const cfgSnap = useSnapshot(configStore)
  const pickerSnap = useSnapshot(picker)

  if (!cfgSnap.config.enableModelPicker) return null

  return (
    <ModelPickerPanel
      open={pickerSnap.open}
      providers={pickerSnap.providers}
      loading={pickerSnap.loading}
      error={pickerSnap.error}
      selectedKey={pickerSnap.selectedKey}
      onClose={() => picker.close()}
      onRefresh={() => void picker.refresh()}
      onSelect={(option) => picker.select(ctx, option)}
    />
  )
}

window.__ModuleLoader__?.load({
  id: PACKAGE_ID,
  factory(require) {
    setReact(
      require('react') as typeof ReactTypes,
      require('react-dom/client') as ReactDOMClientLike,
    )

    return {
      name: PACKAGE_ID,
      inject: ['slots'],
      async apply(ctx: any) {
        const configStore = new ConfigStore()
        const styleManager = new FeatureStyleManager()
        const picker = new PickerController()

        ctx.inject(['sessions'], (sessionCtx: any) => {
          const sessions = sessionCtx.get?.('sessions')
          if (sessions) picker.attachSessions(sessions)
          picker.attachRootCtx(sessionCtx)
        })

        const SessionTracker = ({ sessionId }: { sessionId: string }): null => {
          React.useEffect(() => {
            picker.setActiveSessionId(sessionId)
          }, [sessionId])
          return null
        }

        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.dock', () =>
              ctx.slots.register(
                {
                  name: 'conversation.input.dock',
                  id: `${ENTRY_ID}.session-tracker`,
                  order: 99,
                  label: () => 'Enhans 会话跟踪',
                  inject: (session: unknown) => {
                    const sessionId = sessionIdOf(session)
                    picker.setActiveSessionId(sessionId)
                    return { sessionId }
                  },
                },
                SessionTracker,
              ),
            ),
          `${PACKAGE_ID}.session-tracker`,
        )

        // Initial style mount & reactive hot update on any config change.
        styleManager.apply(configStore.getSnapshot().config)
        ctx.effect(
          () =>
            configStore.subscribe(() => {
              const cfg = configStore.getSnapshot().config
              styleManager.apply(cfg)
              if (!cfg.enableModelPicker) picker.close()
            }),
          `${PACKAGE_ID}.styles-hot-update`,
        )
        ctx.effect(() => () => styleManager.dispose(), `${PACKAGE_ID}.styles-cleanup`)
        ctx.effect(() => () => configStore.dispose(), `${PACKAGE_ID}.config-cleanup`)

        // Connect to host configForms for persistent + volatile hot updates.
        ctx.inject(['configForms'], (configCtx: any) => {
          const forms = configCtx.get?.('configForms')
          if (forms) configStore.connect(forms)
        })

        // Mount Typert Remote for live model catalog.
        const remoteSvc = ctx.get?.('remote') ?? ctx.remote
        if (remoteSvc && typeof remoteSvc.$mount === 'function') {
          try {
            const unmount = await remoteSvc.$mount(remoteInfo)
            ctx.effect(() => unmount, `${PACKAGE_ID}.remote-mount`)
          } catch {
            /* ignore if remote already mounted or unavailable */
          }
        }
        ctx.inject(['remote.uiEnhancements'], (remoteCtx: any) => {
          picker.attachRemote(remoteCtx.get('remote.uiEnhancements'))
        })

        // Track whether Settings shortcut recorder is active to avoid triggering while recording.
        let isRecordingShortcut = false

        // Register Settings section & nav icon.
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: ENTRY_ID,
                  order: 45,
                  label: () => 'Enhans 增强',
                  inject: () => ({
                    store: configStore,
                    onRecordingChange: (recording: boolean) => {
                      isRecordingShortcut = recording
                    },
                  }),
                },
                SettingsPage,
              ),
            ),
          `${PACKAGE_ID}.settings-section`,
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register(
                {
                  name: 'settings.section.icon',
                  id: ENTRY_ID,
                  order: 45,
                },
                SettingsIcon,
              ),
            ),
          `${PACKAGE_ID}.settings-icon`,
        )

        // Global keydown listener for the configurable Model Picker shortcut (hot-updated).
        ctx.effect(() => {
          const onKeyDown = (event: KeyboardEvent): void => {
            if (isRecordingShortcut) return
            const cfg = configStore.getSnapshot().config
            if (!cfg.enableModelPicker) return
            if (!matchesShortcut(event, cfg.modelPickerShortcut)) return
            event.preventDefault()
            event.stopPropagation()
            picker.toggle()
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, `${PACKAGE_ID}.model-picker-keydown`)

        // Also register in DSH's shortcut catalog if non-conflicting.
        ctx.inject(['shortcuts'], (shortcutCtx: any) => {
          const shortcuts = shortcutCtx.get?.('shortcuts')
          if (!shortcuts?.register || !shortcuts?.describeBinding) return
          let disposeShortcut: (() => void) | null = null

          const syncShortcut = () => {
            if (disposeShortcut) {
              try {
                disposeShortcut()
              } catch {
                /* ignore */
              }
              disposeShortcut = null
            }
            const cfg = configStore.getSnapshot().config
            if (!cfg.enableModelPicker) return
            const binding = toDshBinding(cfg.modelPickerShortcut)
            if (!binding) return
            try {
              const info = shortcuts.describeBinding(binding)
              if (info.issue !== null || info.conflicts.length > 0) return
              disposeShortcut = shortcuts.register({
                id: `${PACKAGE_ID}.modelPicker`,
                label: () => 'Enhans：打开/关闭模型选择面板',
                aliases: ['model picker', '模型选择'],
                defaults: {
                  'desktop:macos': binding,
                  'desktop:windows': binding,
                  'desktop:linux': binding,
                },
                regions: ['page', 'editable'],
                modals: [],
                resolve: () => ({
                  status: 'handled',
                  run: () => picker.toggle(),
                }),
              })
            } catch {
              /* fallback window keydown listener remains active */
            }
          }

          syncShortcut()
          const unsub = configStore.subscribe(syncShortcut)
          shortcutCtx.effect(
            () => () => {
              unsub()
              disposeShortcut?.()
            },
            `${PACKAGE_ID}.dsh-shortcut`,
          )
        })

        // Mount floating ModelPickerRoot into document.body.
        ctx.effect(() => {
          const hostEl = document.createElement('div')
          hostEl.dataset.plugin = PACKAGE_ID
          hostEl.dataset.role = 'model-picker-root'
          document.body.appendChild(hostEl)
          const root = createRoot(hostEl)
          root?.render(
            <ModelPickerRoot ctx={ctx} configStore={configStore} picker={picker} />,
          )
          return () => {
            root?.unmount()
            hostEl.remove()
          }
        }, `${PACKAGE_ID}.model-picker-root`)
      },
    }
  },
})
