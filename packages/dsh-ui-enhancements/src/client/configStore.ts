import {
  DEFAULT_CONFIG,
  normalizeConfig,
  PACKAGE_ID,
  type UiEnhancementsConfig,
} from '../shared/contract'

const STORAGE_KEY = 'dsh.ui-enhancements.config.v1'
const ALT_NAMESPACE = 'ui-enhancements'
const SANDBOX_PREFIX = 'plugin-dev-'

export interface ConfigSnapshot {
  config: UiEnhancementsConfig
  status: 'loading' | 'ready' | 'local-only'
  writable: boolean
  overlay: boolean
  namespace?: string
  saving: boolean
  flash?: 'saved' | 'local' | 'failed'
  error?: string
}

function readLocalOverrides(): Partial<UiEnhancementsConfig> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalOverrides(config: UiEnhancementsConfig): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* ignore storage quota or private mode errors */
  }
}

/**
 * Reactive config store backed by DSH `ctx.configForms` (for `.volatile()` hot
 * updates and persistence in cordis.yml) with `localStorage` fallback for
 * read-only / sandboxed environments.
 */
export class ConfigStore {
  private snapshot: ConfigSnapshot
  private readonly listeners = new Set<() => void>()
  private forms?: any
  private mirror?: any
  private controller?: any
  private readonly disposers: Array<() => void> = []
  private retryTimer?: ReturnType<typeof setTimeout>
  private flashTimer?: ReturnType<typeof setTimeout>
  private retries = 0
  private disposed = false

  constructor() {
    this.snapshot = {
      config: normalizeConfig({ ...DEFAULT_CONFIG, ...readLocalOverrides() }),
      status: 'local-only',
      writable: true,
      overlay: false,
      saving: false,
    }
  }

  getSnapshot = (): ConfigSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  connect(forms: any): void {
    if (this.disposed || this.forms === forms || !forms) return
    this.forms = forms
    try {
      const mirror = forms.describe()
      this.mirror = mirror
      this.disposers.push(mirror.subscribe(() => this.sync()))
      void mirror.ensure?.()
      this.sync()
    } catch {
      this.patch({ status: 'local-only', writable: true })
    }
  }

  async setField<K extends keyof UiEnhancementsConfig>(
    key: K,
    value: UiEnhancementsConfig[K],
  ): Promise<void> {
    const nextConfig = normalizeConfig({ ...this.snapshot.config, [key]: value })
    writeLocalOverrides(nextConfig)
    // Apply immediately in client memory for zero-latency hot update.
    this.patch({ config: nextConfig, saving: true, flash: undefined, error: undefined })

    const controller = this.controller
    const canPersistToHost =
      controller !== undefined && this.snapshot.status === 'ready' && this.snapshot.writable

    if (!canPersistToHost) {
      this.patch({ saving: false, flash: 'local' })
      this.clearFlashLater()
      return
    }

    try {
      const accepted = await controller.mutate([{ op: 'set', path: [key], value }])
      if (accepted === false) {
        this.patch({ saving: false, flash: 'local' })
      } else {
        this.patch({ saving: false, flash: 'saved' })
      }
    } catch (error) {
      this.patch({
        saving: false,
        flash: 'local',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    this.clearFlashLater()
  }

  async resetAll(): Promise<void> {
    for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof UiEnhancementsConfig>) {
      await this.setField(key, DEFAULT_CONFIG[key])
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer)
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    try {
      this.controller?.dispose?.()
    } catch {
      /* ignore */
    }
    this.controller = undefined
    this.listeners.clear()
  }

  private sync(): void {
    if (this.disposed || !this.mirror) return
    let view: any
    try {
      view = this.mirror.getSnapshot?.().view
    } catch {
      view = undefined
    }
    if (view === undefined) {
      this.scheduleRetry()
      return
    }

    const namespaces: any[] = Array.isArray(view.namespaces) ? view.namespaces : []
    const entry =
      namespaces.find((c) => c.ns === PACKAGE_ID) ??
      namespaces.find((c) => c.ns === ALT_NAMESPACE) ??
      namespaces.find((c) => String(c.ns).startsWith(SANDBOX_PREFIX))

    if (entry === undefined) {
      if (this.retries < 6) this.scheduleRetry()
      return
    }

    if (this.controller === undefined || this.snapshot.namespace !== entry.ns) {
      if (!this.bind(entry.ns)) return
    }

    const snap = this.controller?.getSnapshot?.() ?? {}
    if (snap.status !== 'ready') {
      this.scheduleRetry()
      return
    }

    const overlay = String(entry.ns).startsWith(SANDBOX_PREFIX)
    const writable = view.writable === true && snap.writable !== false && !overlay
    const hostVal = snap.value && typeof snap.value === 'object' ? snap.value : {}
    // When host config is writable, it is the source of truth; in overlay/readonly, merge local overrides.
    const merged = writable
      ? normalizeConfig(hostVal)
      : normalizeConfig({ ...hostVal, ...readLocalOverrides() })

    this.patch({
      status: 'ready',
      writable,
      overlay,
      namespace: entry.ns,
      config: merged,
    })
  }

  private bind(namespace: string): boolean {
    try {
      this.controller?.dispose?.()
    } catch {
      /* ignore */
    }
    this.controller = undefined
    try {
      const controller = this.forms?.get?.(namespace)
      if (!controller) return false
      this.controller = controller
      this.disposers.push(controller.subscribe(() => this.sync()))
      this.snapshot = { ...this.snapshot, namespace }
      return true
    } catch {
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
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flashTimer = undefined
      if (this.snapshot.flash !== undefined) {
        this.patch({ flash: undefined })
      }
    }, 1800)
  }

  private patch(next: Partial<ConfigSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* ignore subscriber error */
      }
    }
  }
}
