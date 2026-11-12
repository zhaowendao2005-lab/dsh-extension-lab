import { Service } from '@deepseek-ai/cordis'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { FrameBus, RunManager } from './run'
import type { BtwFrame, CloseRequest, ClearRequest, StateRequest, WatchRequest } from '../shared/frames'

interface ServiceDeps {
  runs: RunManager
  bus: FrameBus
}

const remoteInitializers: any[] = []

/**
 * Host-side service exposed to the browser as `remote.btwSide`.
 * `watch` is a streaming Remote; state/close/clear are plain direct methods.
 */
export class BtwSideService extends Service {
  typertRemote: any
  private readonly deps: ServiceDeps

  constructor(ctx: any, deps: ServiceDeps) {
    super(ctx, 'btwSide')
    this.deps = deps
    this.typertRemote = bindTypertRemote(this, 'btwSide')
    for (const init of remoteInitializers) init.call(this)
  }

  async *watch(request: WatchRequest, signal?: AbortSignal): AsyncGenerator<BtwFrame> {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    if (sessionId === '') return
    const subscription = this.deps.bus.subscribe(sessionId)
    const onAbort = () => subscription.close()
    signal?.addEventListener?.('abort', onAbort)
    try {
      const questions = this.deps.runs.views(sessionId)
      const cursor = this.deps.bus.cursor(sessionId)
      yield {
        type: 'baseline',
        sessionId,
        commandName: this.deps.runs.commandName,
        questions,
        cursor,
      }
      for await (const frame of subscription.iterate()) {
        yield frame
      }
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
      subscription.close()
    }
  }

  async state(request: StateRequest) {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    return {
      commandName: this.deps.runs.commandName,
      questions: this.deps.runs.views(sessionId),
      cursor: this.deps.bus.cursor(sessionId),
    }
  }

  async close(request: CloseRequest) {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    const requestId = typeof request?.requestId === 'string' ? request.requestId : ''
    this.deps.runs.abort(sessionId, requestId)
    return { ok: true }
  }

  async clear(request: ClearRequest) {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    this.deps.runs.clear(sessionId)
    return { ok: true }
  }
}

function markRemoteMethod(name: string, fn: any): void {
  ;(Remote as any)(name)(fn, {
    kind: 'method',
    name,
    static: false,
    private: false,
    addInitializer(init: any) {
      remoteInitializers.push(init)
    },
  })
}

markRemoteMethod('watch', BtwSideService.prototype.watch)
markRemoteMethod('state', BtwSideService.prototype.state)
markRemoteMethod('close', BtwSideService.prototype.close)
markRemoteMethod('clear', BtwSideService.prototype.clear)
