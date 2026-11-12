import type { BtwSnapshot } from './types'

const SIDE_REQUESTS = new WeakSet<object>()

/** Mark a request as ours so the capture hook never stores side-ask payloads. */
export function markSideRequest<T extends object>(request: T): T {
  SIDE_REQUESTS.add(request)
  return request
}

export function isSideRequest(request: object): boolean {
  return SIDE_REQUESTS.has(request)
}

/**
 * Latest real agent-loop request per session. The request object is frozen by
 * the loop, so only the outer message array is copied and config is snapshotted.
 */
export class CaptureStore {
  private snapshots = new Map<string, BtwSnapshot>()
  private order: string[] = []

  constructor(private readonly capacity = 8) {}

  get(sessionId: string): BtwSnapshot | undefined {
    return this.snapshots.get(sessionId)
  }

  set(snapshot: BtwSnapshot): void {
    this.snapshots.set(snapshot.sessionId, snapshot)
    this.order = this.order.filter((id) => id !== snapshot.sessionId)
    this.order.push(snapshot.sessionId)
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift()
      if (evicted !== undefined) this.snapshots.delete(evicted)
    }
  }

  drop(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    this.snapshots.delete(sessionId)
    this.order = this.order.filter((id) => id !== sessionId)
  }
}

/** Agent-loop requests are the only requests carrying toolHistory (see buildRequest). */
function isAgentLoopRequestShape(options: any): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    typeof options.sessionId === 'string' &&
    Array.isArray(options.messages) &&
    Object.prototype.hasOwnProperty.call(options, 'toolHistory')
  )
}

export function installCapture(ctx: any, store: CaptureStore): void {
  ctx.on(
    'llm/stream',
    (options: any, next: () => any) => {
      try {
        if (
          !isSideRequest(options) &&
          isAgentLoopRequestShape(options) &&
          options.purpose === undefined
        ) {
          const provider = typeof options.provider === 'string' ? options.provider : ''
          const model = typeof options.model === 'string' ? options.model : ''
          if (provider !== '' && model !== '') {
            store.set({
              sessionId: options.sessionId,
              capturedAt: Date.now(),
              provider,
              model,
              ...(typeof options.reasoningEffort === 'string' ? { reasoningEffort: options.reasoningEffort } : {}),
              ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
              ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
              ...(Array.isArray(options.tools) ? { tools: options.tools } : {}),
              messageCount: options.messages.length,
            })
          }
        }
      } catch {
        // Capture must never disturb the main request path.
      }
      return next()
    },
    { global: true, prepend: true },
  )

  try {
    ctx.on('session/disposed', (session: any) => {
      store.drop(typeof session?.id === 'string' ? session.id : undefined)
    })
  } catch {
    // Older hosts may not expose session/disposed; stale snapshots stay bounded by LRU.
  }
}
