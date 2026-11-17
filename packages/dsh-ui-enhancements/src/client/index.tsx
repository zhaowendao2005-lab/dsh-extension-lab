import type * as ReactTypes from 'react'
import React, { createRoot, setReact, useSnapshot, type ReactDOMClientLike } from './runtime'
import {
  PACKAGE_ID,
  remoteInfo,
  type CatalogProvider,
  type CatalogReasoningResult,
  type CatalogResult,
} from '../shared/contract'
import { ConfigStore } from './configStore'
import { FeatureStyleManager } from './features'
import { SettingsIcon, SettingsPage } from './Settings'
import { ModelPickerPanel, type ModelOption } from './ModelPickerPanel'
import { restoreComposerFocus } from './composerFocus'
import {
  isEventInWorkbenchScope,
  isFocusInWorkbenchScope,
  matchesShortcut,
  toDshBinding,
} from './shortcuts'
import { loadModelUsage, recordModelUsage, type ModelUsageHistory } from './modelUsage'

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

interface ProjectedSelection {
  key: string
  effort?: string
}

function readProjectedSelection(
  sessions: any,
  sessionId: string,
): ProjectedSelection | undefined {
  if (!sessions?.binding || !sessionId) return undefined
  try {
    const binding = sessions.binding(sessionId)
    const snap = binding?.session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.()
    const sel = snap?.next ?? snap?.lastUsed
    if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
      return {
        key: `${sel.provider}:${sel.model}`,
        ...(typeof sel.reasoningEffort === 'string' ? { effort: sel.reasoningEffort } : {}),
      }
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
  effortId?: string,
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
            ...(effortId ? { reasoningEffort: effortId } : {}),
          }),
        ).catch((error: unknown) => console.error('[ui-enhancements] model switch failed', error))
        return
      }
      if (typeof sessions.selectModel === 'function' && sessionId) {
        void sessions.selectModel({
          sessionId,
          provider: option.providerId,
          model: option.modelId,
          ...(effortId ? { reasoningEffort: effortId } : {}),
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
        ...(effortId ? { reasoningEffort: effortId } : {}),
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
  /** Shared across conversations and restored from local storage. */
  usageHistory: ModelUsageHistory
  /** Last thinking level chosen per `provider:model`. */
  effortByModel: Record<string, string>
  /** Lazily resolved thinking levels per `provider:model`. */
  reasoningByModel: Record<string, CatalogReasoningResult | 'loading'>
}

class PickerController {
  private state: PickerState = {
    open: false,
    providers: [],
    loading: false,
    usageHistory: loadModelUsage(),
    effortByModel: {},
    reasoningByModel: {},
  }
  private readonly listeners = new Set<() => void>()
  private remote: any = null
  private activeSessionId = ''
  private sessions: any = null
  private rootCtx: any = null
  /** Element focused before the panel opened, so closing can hand it back. */
  private lastFocused: HTMLElement | null = null

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
      this.close(true)
    } else {
      this.open()
    }
  }

  open(): void {
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sessionId = resolveActiveSessionId(this.sessions, this.activeSessionId)
    const projected = readProjectedSelection(this.sessions, sessionId)
    this.patch({
      open: true,
      usageHistory: loadModelUsage(this.state.usageHistory),
      ...(projected?.key ? { selectedKey: projected.key } : {}),
      ...(projected?.key && projected.effort
        ? { effortByModel: { ...this.state.effortByModel, [projected.key]: projected.effort } }
        : {}),
    })
    if (this.state.providers.length === 0 && !this.state.loading) {
      void this.refresh()
    }
  }

  /**
   * Close the panel. Focus only comes back when the close was the panel's own
   * doing (selection, Escape, shortcut toggle): an outside click already put
   * focus where the user wanted it.
   */
  close(restoreFocus = false): void {
    if (!this.state.open) return
    this.patch({ open: false })
    if (restoreFocus) this.refocus()
  }

  select(_ctx: any, option: ModelOption, effortId?: string): void {
    this.patch({
      selectedKey: option.value,
      usageHistory: recordModelUsage(this.state.usageHistory, option),
      open: false,
      ...(effortId
        ? { effortByModel: { ...this.state.effortByModel, [option.value]: effortId } }
        : {}),
    })
    trySwitchHostModel(this.sessions, option, this.activeSessionId, this.rootCtx, effortId)
    // Hand focus back to the composer: choosing a model is a step towards
    // typing, not away from it.
    this.refocus()
  }

  /** Remember the level under the cursor so reopening keeps it. */
  setEffort(modelValue: string, effortId: string): void {
    if (!modelValue || !effortId) return
    if (this.state.effortByModel[modelValue] === effortId) return
    this.patch({ effortByModel: { ...this.state.effortByModel, [modelValue]: effortId } })
  }

  /**
   * Resolve one model's thinking levels on first expand. The adapter reports
   * them from `resolveModelInfo`, which is too heavy to run for every model in
   * the list, so it happens lazily and is cached for the rest of the session.
   */
  ensureReasoning(option: ModelOption): void {
    const key = option.value
    const known = this.state.reasoningByModel[key]
    // Known results stick; failures are retried on the next expand.
    if (known !== undefined && known !== 'loading' && !known.error) return
    if (known === 'loading') return
    const remember = (result: CatalogReasoningResult | 'loading'): void => {
      this.patch({ reasoningByModel: { ...this.state.reasoningByModel, [key]: result } })
    }
    if (!this.remote || typeof this.remote.reasoning !== 'function') {
      remember({ efforts: [], error: '思考级别服务未连接' })
      return
    }
    remember('loading')
    void Promise.resolve(this.remote.reasoning({ provider: option.providerId, model: option.modelId }))
      .then((raw: unknown) => unwrapRemote<CatalogReasoningResult>(raw))
      .then((result: CatalogReasoningResult) => {
        remember({
          efforts: Array.isArray(result?.efforts) ? result.efforts : [],
          ...(typeof result?.defaultEffort === 'string' ? { defaultEffort: result.defaultEffort } : {}),
          ...(typeof result?.error === 'string' ? { error: result.error } : {}),
        })
      })
      .catch((error: unknown) => {
        remember({
          efforts: [],
          error: error instanceof Error ? error.message : '无法读取思考级别',
        })
      })
  }

  private refocus(): void {
    const preferred = this.lastFocused
    this.lastFocused = null
    restoreComposerFocus({ preferred })
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
      usageHistory={pickerSnap.usageHistory}
      effortByModel={pickerSnap.effortByModel}
      reasoningByModel={pickerSnap.reasoningByModel}
      onClose={(reason) => picker.close(reason === 'escape')}
      onRefresh={() => void picker.refresh()}
      onEffortChange={(modelValue, effortId) => picker.setEffort(modelValue, effortId)}
      onNeedReasoning={(option) => picker.ensureReasoning(option)}
      onSelect={(option, effortId) => picker.select(ctx, option, effortId)}
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

        // Fallback window keydown listener is only active when DSH's shortcuts service is unavailable.
        // Even then, it yields whenever keyboard focus is inside an active workbench scope.
        let shortcutServiceActive = false
        let teardownFallback: (() => void) | null = null

        ctx.effect(() => {
          if (shortcutServiceActive) return () => {}
          const onKeyDown = (event: KeyboardEvent): void => {
            if (shortcutServiceActive) return
            if (isRecordingShortcut || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return
            const cfg = configStore.getSnapshot().config
            if (!cfg.enableModelPicker) return
            if (!matchesShortcut(event, cfg.modelPickerShortcut)) return
            if (isEventInWorkbenchScope(event)) return
            event.preventDefault()
            event.stopPropagation()
            picker.toggle()
          }
          window.addEventListener('keydown', onKeyDown, true)
          const remove = () => window.removeEventListener('keydown', onKeyDown, true)
          teardownFallback = remove
          return () => {
            if (teardownFallback === remove) teardownFallback = null
            remove()
          }
        }, `${PACKAGE_ID}.model-picker-keydown`)

        // Register in DSH's shortcut catalog; if Host rejects/conflicts, do NOT bypass via fallback.
        ctx.inject(['shortcuts'], (shortcutCtx: any) => {
          const shortcuts = shortcutCtx.get?.('shortcuts')
          if (!shortcuts?.register || !shortcuts?.describeBinding) return
          shortcutServiceActive = true
          teardownFallback?.()
          teardownFallback = null
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
              if (info?.issue !== null || (Array.isArray(info?.conflicts) && info.conflicts.length > 0)) {
                console.warn('[dsh-ui-enhancements] shortcut rejected by host', cfg.modelPickerShortcut, info)
                return
              }
              disposeShortcut = shortcuts.register({
                id: `${PACKAGE_ID}.modelPicker`,
                label: () => 'Enhans：打开/关闭模型选择面板',
                aliases: ['model picker', '模型选择'],
                defaults: {
                  'desktop:macos': binding,
                  'desktop:windows': binding,
                  'desktop:linux': binding,
                  'web:macos': binding,
                  'web:windows': binding,
                },
                regions: ['page', 'editable'],
                modals: [],
                resolve: () => {
                  if (isRecordingShortcut || isFocusInWorkbenchScope()) {
                    return { status: 'blocked', reason: '工作台内由工作台快捷键处理' }
                  }
                  return {
                    status: 'handled',
                    run: () => picker.toggle(),
                  }
                },
              })
            } catch (error) {
              console.warn('[dsh-ui-enhancements] shortcut registration failed', error)
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
