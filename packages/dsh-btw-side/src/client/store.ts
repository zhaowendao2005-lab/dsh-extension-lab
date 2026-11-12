/**
 * Per-session client store for the BTW bar.
 *
 * One store = one session = one `btwSide/watch` stream consumer. React only
 * reads immutable snapshots; every mutation happens here after a host frame
 * arrives, so re-renders never own the wire state. Carrier failures are
 * retried at most twice inside a five second window, then surfaced as a
 * non-blocking notice instead of throwing into the host React tree.
 */
import type { BtwFrame, BtwPhase, BtwQuestionView } from '../shared/frames'

export type ClientPhase = BtwPhase | 'thinking'

export interface ClientQuestionView extends Omit<BtwQuestionView, 'phase'> {
  phase: ClientPhase
}

export interface BtwNotice {
  code: string
  message: string
}

export interface BtwSnapshot {
  status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed'
  questions: readonly ClientQuestionView[]
  /** Last applied frame sequence; the watch cursor on reconnect. */
  cursor: number
  /** Registered slash-command name, used by the retry action. */
  commandName: string
  expanded: boolean
  notice?: BtwNotice
}

const STORAGE_PREFIX = 'dsh.btw-side.expanded.'
const RETRY_LIMIT = 2
const RETRY_WINDOW_MS = 5000

const RUNNING: ReadonlySet<ClientPhase> = new Set<ClientPhase>([
  'queued',
  'calling',
  'thinking',
  'streaming',
])

export function isRunning(phase: ClientPhase): boolean {
  return RUNNING.has(phase)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return 'unknown error'
}

/**
 * Unwrap the gateway `RemoteResult` envelope (`{ok,value}` / `{ok,error}`)
 * and tolerate bare values from older gateways.
 */
export function unwrapRemote<T>(result: unknown): T {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown; error?: BtwNotice }
    if (envelope.ok === false) {
      throw new Error(envelope.error?.message ?? envelope.error?.code ?? 'remote call failed')
    }
    return envelope.value as T
  }
  return result as T
}

function readExpanded(sessionId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${sessionId}`) === '1'
  } catch {
    return false
  }
}

function writeExpanded(sessionId: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${sessionId}`, value ? '1' : '0')
  } catch {
    /* localStorage unavailable: the in-memory state still drives this mount */
  }
}

function cloneView(view: BtwQuestionView | ClientQuestionView): ClientQuestionView {
  return {
    ...view,
    question: typeof view.question === 'string' ? view.question : '',
    answer: typeof view.answer === 'string' ? view.answer : '',
    phase: (view.phase ?? 'queued') as ClientPhase,
  }
}

function seqOf(frame: BtwFrame): number | undefined {
  return 'seq' in frame && typeof frame.seq === 'number' && Number.isFinite(frame.seq) ? frame.seq : undefined
}

function toIterable(value: unknown): AsyncIterable<BtwFrame> {
  if (value !== null && value !== undefined) {
    const candidate = value as { [Symbol.asyncIterator]?: unknown; iterate?: unknown; next?: unknown }
    if (typeof candidate[Symbol.asyncIterator] === 'function') return value as AsyncIterable<BtwFrame>
    if (typeof candidate.iterate === 'function') {
      return (value as { iterate(): AsyncIterable<BtwFrame> }).iterate()
    }
    if (typeof candidate.next === 'function') {
      return { [Symbol.asyncIterator]: () => value as AsyncIterator<BtwFrame> }
    }
  }
  throw new Error('watch method returned no stream')
}

/** Copy text with an `execCommand` fallback; returns whether it landed. */
export async function copyText(text: string): Promise<boolean> {
  if (text === '') return false
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

export class BtwSessionStore {
  private snapshot: BtwSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly hidden = new Set<string>()
  private controller?: AbortController
  private retryTimer?: ReturnType<typeof setTimeout>
  private retryCount = 0
  private firstFailureAt?: number
  private disposed = false

  constructor(
    private readonly ctx: any,
    readonly sessionId: string,
    private readonly refs: { remote?: any; commands?: any } = {},
  ) {
    this.snapshot = {
      status: 'idle',
      questions: [],
      cursor: 0,
      commandName: 'btw',
      expanded: readExpanded(sessionId),
    }
  }

  /**
   * The Remote namespace must be resolved inside `ctx.inject(['remote.btwSide'])`;
   * touching `ctx.remote.*` outside an injected context throws in cordis, so the
   * registry hands the resolved references over here (and after a late inject).
   */
  attachRemotes(remote: any, commands: any): void {
    this.refs.remote = remote
    this.refs.commands = commands
    if (this.listeners.size > 0) this.restart()
  }

  getSnapshot = (): BtwSnapshot => this.snapshot

  /** Starts the single watch consumer; React's subscription is the mount signal. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.ensureConnected()
    return () => {
      this.listeners.delete(listener)
    }
  }

  isHidden(requestId: string): boolean {
    return this.hidden.has(requestId)
  }

  visibleQuestions(): readonly ClientQuestionView[] {
    return this.snapshot.questions.filter((question) => !this.hidden.has(question.requestId))
  }

  setExpanded(expanded: boolean): void {
    if (this.snapshot.expanded === expanded) return
    writeExpanded(this.sessionId, expanded)
    this.patch({ expanded })
  }

  hide(requestId: string): void {
    this.hidden.add(requestId)
    this.emit()
  }

  async cancel(requestId: string): Promise<void> {
    try {
      unwrapRemote(await this.remote().close({ sessionId: this.sessionId, requestId }))
    } catch (error) {
      this.patch({ notice: { code: 'watch', message: errorMessage(error) } })
    }
  }

  async clear(): Promise<void> {
    try {
      unwrapRemote(await this.remote().clear({ sessionId: this.sessionId }))
      this.hidden.clear()
      this.snapshot = { ...this.snapshot, questions: [], cursor: 0, notice: undefined }
      this.emit()
      this.restart()
    } catch (error) {
      this.patch({ notice: { code: 'watch', message: errorMessage(error) } })
    }
  }

  async retry(question: string): Promise<void> {
    const commandName = this.snapshot.commandName
    if (commandName === '') {
      this.patch({ notice: { code: 'unavailable', message: 'command name is not known yet' } })
      return
    }
    try {
      const commands = this.refs.commands
      if (commands === undefined) throw new Error('remote.commands is not ready')
      const signal = new AbortController().signal
      const result = unwrapRemote<{ kind?: string; text?: string } | undefined>(
        await commands.execute(this.sessionId, `/${commandName} ${question}`, [], signal),
      )
      if (result !== undefined && result.kind === 'error') {
        throw new Error(result.text !== undefined && result.text !== '' ? result.text : 'command failed')
      }
      // A dead stream would never surface the new run; reattach it.
      if (this.snapshot.status === 'failed' || this.snapshot.status === 'reconnecting') this.restart()
    } catch (error) {
      this.patch({ notice: { code: 'retry', message: errorMessage(error) } })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.controller?.abort()
    this.controller = undefined
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.listeners.clear()
  }

  // -------------------------------------------------------------------------

  private remote(): any {
    return this.refs.remote
  }

  private ensureConnected(): void {
    if (this.disposed || this.controller !== undefined || this.retryTimer !== undefined) return
    void this.connect()
  }

  private restart(): void {
    const previous = this.controller
    this.controller = undefined
    previous?.abort()
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.retryCount = 0
    this.firstFailureAt = undefined
    this.ensureConnected()
  }

  private async connect(): Promise<void> {
    if (this.disposed || this.controller !== undefined) return
    const controller = new AbortController()
    this.controller = controller
    const reconnecting = this.snapshot.status === 'reconnecting' || this.snapshot.status === 'live'
    this.patch({ status: reconnecting ? 'reconnecting' : 'connecting' })
    try {
      const watch = this.remote()?.watch
      if (typeof watch !== 'function') {
        await this.refreshFromState()
        return
      }
      const request = { sessionId: this.sessionId, afterSeq: this.snapshot.cursor }
      const opened: unknown = watch.call(this.remote(), request, controller.signal)
      const stream = opened !== null && typeof (opened as { then?: unknown }).then === 'function'
        ? await (opened as Promise<unknown>)
        : opened
      for await (const frame of toIterable(stream)) {
        if (controller.signal.aborted || this.disposed) return
        this.apply(frame)
      }
      if (!controller.signal.aborted && !this.disposed) throw new Error('watch stream closed')
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      this.scheduleReconnect(error)
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  /** `remote.state` fallback for gateways that cannot open the stream. */
  private async refreshFromState(): Promise<void> {
    const state = this.remote()?.state
    if (typeof state !== 'function') throw new Error('watch is unavailable')
    const result = unwrapRemote<{ commandName: string; questions: BtwQuestionView[]; cursor: number }>(
      await state.call(this.remote(), { sessionId: this.sessionId }),
    )
    this.applyBaseline(result)
  }

  private scheduleReconnect(error: unknown): void {
    const now = Date.now()
    if (this.firstFailureAt === undefined || now - this.firstFailureAt > RETRY_WINDOW_MS) {
      this.firstFailureAt = now
      this.retryCount = 0
    }
    if (this.retryCount >= RETRY_LIMIT) {
      this.patch({
        status: 'failed',
        notice: { code: 'watch', message: errorMessage(error) },
      })
      return
    }
    const delay = 300 * 2 ** this.retryCount
    this.retryCount += 1
    this.patch({ status: 'reconnecting' })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.ensureConnected()
    }, delay)
  }

  private applyBaseline(state: { commandName: string; questions: BtwQuestionView[]; cursor: number }): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'live',
      commandName:
        typeof state.commandName === 'string' && state.commandName !== ''
          ? state.commandName
          : this.snapshot.commandName,
      questions: Array.isArray(state.questions) ? state.questions.map(cloneView) : [],
      cursor: typeof state.cursor === 'number' && Number.isFinite(state.cursor) ? state.cursor : this.snapshot.cursor,
      notice: undefined,
    }
    this.emit()
  }

  private apply(frame: BtwFrame): void {
    if (frame === null || typeof frame !== 'object') return
    if (frame.type === 'baseline') {
      this.applyBaseline(frame)
      return
    }
    const seq = seqOf(frame)
    if (seq !== undefined && seq <= this.snapshot.cursor) return

    switch (frame.type) {
      case 'accepted': {
        const view = cloneView(frame.view)
        this.upsert(view)
        this.patch({
          status: 'live',
          cursor: seq ?? this.snapshot.cursor,
          expanded: true,
        })
        writeExpanded(this.sessionId, true)
        return
      }
      case 'delta': {
        this.mutate(frame.requestId, (view) => {
          view.answer = `${view.answer}${frame.text}`
          view.phase = 'streaming'
        })
        this.patch({ cursor: seq ?? this.snapshot.cursor })
        return
      }
      case 'status': {
        this.mutate(frame.requestId, (view) => {
          view.phase = frame.phase
        })
        this.patch({ cursor: seq ?? this.snapshot.cursor })
        return
      }
      case 'done': {
        this.mutate(frame.requestId, (view) => {
          view.answer = frame.answer
          view.phase = 'done'
          view.finishedAt = frame.finishedAt
          if (frame.usage !== undefined) view.usage = frame.usage
        })
        this.patch({ cursor: seq ?? this.snapshot.cursor })
        return
      }
      case 'error': {
        this.mutate(frame.requestId, (view) => {
          view.phase = 'error'
          view.error = { code: frame.code, message: frame.message }
        })
        this.patch({ cursor: seq ?? this.snapshot.cursor })
        return
      }
      case 'cancelled': {
        this.mutate(frame.requestId, (view) => {
          view.phase = 'cancelled'
        })
        this.patch({ cursor: seq ?? this.snapshot.cursor })
        return
      }
      default:
        return
    }
  }

  private upsert(view: ClientQuestionView): void {
    const questions = this.snapshot.questions.slice()
    const index = questions.findIndex((candidate) => candidate.requestId === view.requestId)
    if (index >= 0) questions[index] = view
    else questions.push(view)
    this.snapshot = { ...this.snapshot, questions }
    this.emit()
  }

  private mutate(requestId: string, mutate: (view: ClientQuestionView) => void): void {
    const index = this.snapshot.questions.findIndex((candidate) => candidate.requestId === requestId)
    if (index < 0) return
    const next = { ...this.snapshot.questions[index] }
    mutate(next)
    const questions = this.snapshot.questions.slice()
    questions[index] = next
    this.snapshot = { ...this.snapshot, questions }
    this.emit()
  }

  private patch(patch: Partial<BtwSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* never let a subscriber break the stream consumer */
      }
    }
  }
}

/** One store per session; disposed with the plugin effect. */
export class BtwStoreRegistry {
  private readonly stores = new Map<string, BtwSessionStore>()
  private readonly refs: { remote?: any; commands?: any } = {}

  constructor(private readonly ctx: any) {}

  /** Called from `ctx.inject(['remote.btwSide', 'remote.commands'])`. */
  attachRemotes(remote: any, commands: any): void {
    this.refs.remote = remote
    this.refs.commands = commands
    for (const store of this.stores.values()) store.attachRemotes(remote, commands)
  }

  storeFor(sessionId: string): BtwSessionStore {
    let store = this.stores.get(sessionId)
    if (store === undefined) {
      store = new BtwSessionStore(this.ctx, sessionId, this.refs)
      this.stores.set(sessionId, store)
    }
    return store
  }

  dispose(): void {
    for (const store of this.stores.values()) store.dispose()
    this.stores.clear()
  }
}
