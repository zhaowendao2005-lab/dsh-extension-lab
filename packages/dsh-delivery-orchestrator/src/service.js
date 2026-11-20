import { Service } from '@deepseek-ai/cordis'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { hostContribution } from './contract.js'

const initializers = []
const idOf = request => {
  const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
  if (!sessionId) throw new Error('sessionId 必须由 Client 明确提供')
  return sessionId
}
export class DeliveryOrchestratorService extends Service {
  constructor(ctx, orchestrator) {
    super(ctx, 'deliveryOrchestrator')
    this.orchestrator = orchestrator
    this.typertRemote = bindTypertRemote(this, 'deliveryOrchestrator')
    for (const initializer of initializers) initializer.call(this)
  }
  async status(request) { return this.orchestrator.status(idOf(request), request?.runId) }
  async *watch(request, signal) {
    const owner = idOf(request)
    const queue = []
    let wake
    let closed = false
    const dispose = this.orchestrator.subscribe(owner, frame => { if (!closed) { queue.push(frame); wake?.(); wake = undefined } })
    const onAbort = () => { closed = true; dispose?.(); wake?.(); wake = undefined }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    try {
      while (!closed) {
        if (!queue.length) await new Promise(resolve => { wake = resolve })
        while (queue.length) yield queue.shift()
      }
    } finally {
      closed = true
      dispose?.()
      signal?.removeEventListener?.('abort', onAbort)
    }
  }
}
function mark(name, options = {}) {
  Remote({ name, ...options })(DeliveryOrchestratorService.prototype[name], { kind: 'method', name, static: false, private: false, addInitializer(initializer) { initializers.push(initializer) } })
}
mark('status', { resources: { session: request => request.sessionId } })
mark('watch', { mode: 'stream', resources: { session: request => request.sessionId } })
export { hostContribution }
