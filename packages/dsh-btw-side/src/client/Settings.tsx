/**
 * Settings page for the BTW plugin.
 *
 * Reads/writes through the settings service's shared config forms
 * (`ctx.configForms`): the namespace is resolved from the live describe mirror
 * because the sandbox installs this plugin under a `plugin-dev-…` row id while
 * a normal install uses the package/entry id. A missing form service degrades
 * to a read-only notice instead of breaking the page.
 */
import React from './runtime'
import { useSnapshot } from './runtime'
import type { Translate } from './i18n'

export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  bound: boolean
  loaded: boolean
  writable: boolean
  overlay: boolean
  namespace?: string
  value: Record<string, unknown>
  saving: boolean
  flash?: 'saved' | 'failed'
  conflict: boolean
  error?: string
}

const PACKAGE_NAME = 'dsh-btw-side'
const SANDBOX_PREFIX = 'plugin-dev-'
const ALT_NAMESPACE = 'btw-side'

interface FieldDef {
  key: string
  kind: 'text' | 'number' | 'boolean' | 'select'
  options?: readonly string[]
  min?: number
  max?: number
  step?: number
}

const FIELDS: readonly FieldDef[] = [
  { key: 'commandName', kind: 'text' },
  { key: 'onConflict', kind: 'select', options: ['rename', 'disable'] },
  { key: 'barForm', kind: 'select', options: ['dock', 'right-tab'] },
  { key: 'compression', kind: 'select', options: ['inherit', 'isolated', 'direct'] },
  { key: 'maxTokens', kind: 'number', min: 64, max: 8192, step: 1 },
  { key: 'timeoutMs', kind: 'number', min: 1000, max: 300000, step: 1000 },
  { key: 'maxConcurrent', kind: 'number', min: 1, max: 16, step: 1 },
  { key: 'maxPerSession', kind: 'number', min: 1, max: 20, step: 1 },
  { key: 'showProvenance', kind: 'boolean' },
]

const FALLBACK: Record<string, unknown> = {
  commandName: 'btw',
  onConflict: 'rename',
  barForm: 'dock',
  compression: 'inherit',
  maxTokens: 8192,
  timeoutMs: 120000,
  maxConcurrent: 3,
  maxPerSession: 20,
  showProvenance: true,
}

const OPTION_LABEL: Record<string, string> = {
  rename: 'option.rename',
  disable: 'option.disable',
  dock: 'option.dock',
  'right-tab': 'option.rightTab',
  inherit: 'option.inherit',
  isolated: 'option.isolated',
  direct: 'option.direct',
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return 'unknown error'
}

function isConflict(message: string): boolean {
  return /conflict|revision|stale/i.test(message)
}

/**
 * Live form store over one `ConfigFormController`. Mirrors the controller's
 * snapshot into an immutable view and serializes field writes through
 * `mutate([{op:'set', …}])`.
 */
export class SettingsStore {
  private snapshot: SettingsSnapshot = {
    status: 'loading',
    bound: false,
    loaded: false,
    writable: false,
    overlay: false,
    value: {},
    saving: false,
    conflict: false,
  }
  private readonly listeners = new Set<() => void>()
  private forms?: any
  private mirror?: any
  private controller?: any
  private readonly disposers: Array<() => void> = []
  private retryTimer?: ReturnType<typeof setTimeout>
  private retries = 0
  private disposed = false

  constructor(private readonly ctx: any) {}

  getSnapshot = (): SettingsSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  connect(forms: any): void {
    if (this.disposed || this.forms === forms) return
    this.forms = forms
    try {
      const mirror = forms.describe()
      this.mirror = mirror
      this.disposers.push(mirror.subscribe(() => this.sync()))
      void mirror.ensure?.()
      this.sync()
    } catch (error) {
      this.patch({ status: 'unavailable', error: messageOf(error) })
    }
  }

  async save(field: string, value: unknown): Promise<void> {
    const controller = this.controller
    if (controller === undefined || this.snapshot.loaded !== true || this.snapshot.writable !== true) return
    this.patch({ saving: true, flash: undefined })
    try {
      const accepted = await controller.mutate([{ op: 'set', path: [field], value }])
      if (accepted === false) {
        this.patch({ saving: false, flash: 'failed', conflict: true, error: 'conflict' })
        return
      }
      this.patch({ saving: false, flash: 'saved', conflict: false, error: undefined })
    } catch (error) {
      const message = messageOf(error)
      this.patch({ saving: false, flash: 'failed', error: message, conflict: isConflict(message) })
    }
    this.clearFlashLater()
  }

  /** Retry the describe mirror after a conflict or a missing namespace. */
  async reload(): Promise<void> {
    this.retries = 0
    try {
      await this.mirror?.load?.()
    } catch (error) {
      this.patch({ status: 'unavailable', error: messageOf(error) })
    }
    this.sync()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* ignore teardown failures */
      }
    }
    try {
      this.controller?.dispose?.()
    } catch {
      /* ignore teardown failures */
    }
    this.controller = undefined
    this.listeners.clear()
  }

  // ---------------------------------------------------------------------------

  private sync(): void {
    if (this.disposed) return
    const mirror = this.mirror
    if (mirror === undefined) return
    let view: any
    try {
      view = mirror.getSnapshot?.().view
    } catch {
      view = undefined
    }
    if (view === undefined) {
      this.patch({ status: 'loading', bound: false })
      this.scheduleRetry()
      return
    }
    const namespaces: any[] = Array.isArray(view.namespaces) ? view.namespaces : []
    const entry =
      namespaces.find((candidate) => candidate.ns === PACKAGE_NAME) ??
      namespaces.find((candidate) => candidate.ns === ALT_NAMESPACE) ??
      namespaces.find((candidate) => String(candidate.ns).startsWith(SANDBOX_PREFIX))
    if (entry === undefined) {
      this.patch({
        status: this.retries >= 6 ? 'unavailable' : 'loading',
        bound: false,
        writable: false,
      })
      this.scheduleRetry()
      return
    }
    if (this.controller === undefined || this.snapshot.namespace !== entry.ns) {
      if (!this.bind(entry.ns)) {
        this.patch({ status: 'unavailable', bound: false, writable: false })
        return
      }
    }
    const snapshot = this.controller?.getSnapshot?.() ?? {}
    const controllerStatus = snapshot.status
    if (controllerStatus === 'unavailable') {
      this.patch({ status: 'unavailable', bound: false, loaded: false, writable: false })
      return
    }
    if (controllerStatus !== 'ready') {
      this.patch({ status: 'loading', bound: true, loaded: false, writable: false, namespace: entry.ns })
      this.scheduleRetry()
      return
    }
    const overlay = String(entry.ns).startsWith(SANDBOX_PREFIX)
    const writable = view.writable === true && snapshot.writable !== false && !overlay
    this.patch({
      status: 'ready',
      bound: true,
      loaded: true,
      writable,
      overlay,
      namespace: entry.ns,
      value: snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {},
    })
  }

  private bind(namespace: string): boolean {
    try {
      this.controller?.dispose?.()
    } catch {
      /* the previous controller may already be disposed */
    }
    this.controller = undefined
    try {
      const controller = this.forms?.get?.(namespace)
      if (controller === undefined || controller === null) return false
      this.controller = controller
      this.disposers.push(controller.subscribe(() => this.sync()))
      this.snapshot = { ...this.snapshot, namespace }
      return true
    } catch (error) {
      this.patch({ status: 'unavailable', bound: false, error: messageOf(error) })
      return false
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== undefined || this.retries >= 6) return
    this.retries += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.mirror?.load?.()
    }, 300)
  }

  private clearFlashLater(): void {
    setTimeout(() => {
      if (this.snapshot.flash === undefined) return
      this.patch({ flash: undefined })
    }, 1600)
  }

  private patch(patch: Partial<SettingsSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* settings subscribers must not break the page */
      }
    }
  }
}

export interface SettingsPageProps {
  store: SettingsStore
  t: Translate
}

export function SettingsPage(props: SettingsPageProps): React.ReactElement {
  const snapshot = useSnapshot(props.store)
  const t = props.t

  if (snapshot.status === 'loading' || !snapshot.loaded) {
    return (
      <section className="btw-side-settings">
        <h2 className="btw-side-settings-title">{t('settings.title')}</h2>
        <p className="btw-side-muted">{t('settings.loading')}</p>
      </section>
    )
  }

  if (snapshot.status === 'unavailable' || !snapshot.bound) {
    return (
      <section className="btw-side-settings">
        <h2 className="btw-side-settings-title">{t('settings.title')}</h2>
        <p className="btw-side-warning">{t('settings.unavailable')}</p>
      </section>
    )
  }

  const readonly = !snapshot.writable
  return (
    <section className="btw-side-settings">
      <h2 className="btw-side-settings-title">{t('settings.title')}</h2>
      <p className="btw-side-muted">{t('settings.desc')}</p>
      <p className="btw-side-namespace">{t('settings.namespace', { ns: snapshot.namespace ?? PACKAGE_NAME })}</p>
      {readonly ? (
        <p className="btw-side-warning">{snapshot.overlay ? t('settings.overlay') : t('settings.readonly')}</p>
      ) : null}
      {snapshot.conflict ? (
        <div className="btw-side-conflict" role="alert">
          <span>{t('settings.conflict')}</span>
          <button
            type="button"
            className="btw-side-link"
            onClick={() => {
              void props.store.reload()
            }}
          >
            {t('settings.retry')}
          </button>
        </div>
      ) : null}
      <div className="btw-side-form">
        {FIELDS.map((field) => (
          <SettingsRow
            key={field.key}
            field={field}
            current={snapshot.value[field.key] ?? FALLBACK[field.key]}
            readonly={readonly}
            busy={snapshot.saving}
            t={t}
            onCommit={(value) => {
              void props.store.save(field.key, value)
            }}
          />
        ))}
      </div>
      {snapshot.flash !== undefined ? (
        <p className="btw-side-flash" role="status">
          {snapshot.flash === 'saved' ? t('settings.saved') : t('settings.savefailed')}
        </p>
      ) : null}
    </section>
  )
}

interface SettingsRowProps {
  field: FieldDef
  current: unknown
  readonly: boolean
  busy: boolean
  t: Translate
  onCommit(value: unknown): void
}

function SettingsRow(props: SettingsRowProps): React.ReactElement {
  const { field, current, readonly, busy, t } = props
  const disabled = readonly || busy
  let control: React.ReactElement

  if (field.kind === 'select') {
    control = (
      <select
        className="btw-side-input"
        value={String(current ?? '')}
        disabled={disabled}
        onChange={(event) => {
          props.onCommit(event.target.value)
        }}
      >
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {t(OPTION_LABEL[option] ?? option)}
          </option>
        ))}
      </select>
    )
  } else if (field.kind === 'boolean') {
    control = (
      <input
        type="checkbox"
        className="btw-side-checkbox"
        checked={current === true}
        disabled={disabled}
        onChange={(event) => {
          props.onCommit(event.target.checked === true)
        }}
      />
    )
  } else if (field.kind === 'number') {
    control = (
      <NumberInput
        value={typeof current === 'number' ? current : Number(current ?? 0)}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onCommit={props.onCommit}
      />
    )
  } else {
    control = (
      <TextInput
        value={current === undefined || current === null ? '' : String(current)}
        disabled={disabled}
        onCommit={props.onCommit}
      />
    )
  }

  return (
    <label className="btw-side-field">
      <span className="btw-side-field-label">{t(`field.${field.key}`)}</span>
      {control}
    </label>
  )
}

function TextInput(props: {
  value: string
  disabled: boolean
  onCommit(value: string): void
}): React.ReactElement {
  const [draft, setDraft] = React.useState(props.value)
  React.useEffect(() => {
    setDraft(props.value)
  }, [props.value])
  const commit = (): void => {
    if (draft !== props.value && draft.trim() !== '') props.onCommit(draft.trim())
  }
  return (
    <input
      className="btw-side-input"
      type="text"
      value={draft}
      disabled={props.disabled}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

function NumberInput(props: {
  value: number
  min?: number
  max?: number
  step?: number
  disabled: boolean
  onCommit(value: number): void
}): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.value))
  React.useEffect(() => {
    setDraft(String(props.value))
  }, [props.value])
  const commit = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(props.value))
      return
    }
    const rounded = Math.round(parsed)
    const clamped = Math.min(props.max ?? rounded, Math.max(props.min ?? rounded, rounded))
    if (clamped !== props.value) props.onCommit(clamped)
    else setDraft(String(clamped))
  }
  return (
    <input
      className="btw-side-input btw-side-input-number"
      type="number"
      value={draft}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={props.disabled}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

/** Navigation glyph: a speech bubble with a question mark. */
export function SettingsIcon(props: { size?: number; active?: boolean }): React.ReactElement {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 4.2c0-.9.7-1.6 1.6-1.6h7.8c.9 0 1.6.7 1.6 1.6v5.1c0 .9-.7 1.6-1.6 1.6H6.6L3.6 13.3v-2.4c-.7-.2-1.1-.8-1.1-1.6V4.2Z" />
      <path d="M6.4 5.4c.1-.6.6-1 1.2-1 .7 0 1.2.4 1.2 1 0 .5-.3.8-.7 1-.3.2-.4.4-.4.7" />
      <path d="M7.7 9.2h.01" />
    </svg>
  )
}
