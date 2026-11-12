import { buildSideRequest, BtwError } from './payload'
import { markSideRequest } from './capture'
import type { CaptureStore } from './capture'
import type { BtwConfig } from './types'
import type { BtwFrame, BtwQuestionView, BtwPhase } from '../shared/frames'

const RING_LIMIT = 512
const MAX_QUESTION_LENGTH = 4000
const MAX_ANSWER_LENGTH = 64 * 1024

class Subscription {
  private buffer: BtwFrame[] = []
  private waiter: (() => void) | undefined
  private closed = false

  push(frame: BtwFrame): void {
    if (this.closed) return
    this.buffer.push(frame)
    this.wake()
  }

  close(): void {
    this.closed = true
    this.wake()
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  async *iterate(): AsyncGenerator<BtwFrame> {
    while (!this.closed) {
      const frame = this.buffer.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }
}

/** Per-session frame ring + live subscriptions for `btwSide/watch`. */
export class FrameBus {
  private counters = new Map<string, number>()
  private rings = new Map<string, BtwFrame[]>()
  private subscribers = new Map<string, Set<Subscription>>()

  emit(sessionId: string, frame: Record<string, unknown>): number {
    const seq = (this.counters.get(sessionId) ?? 0) + 1
    this.counters.set(sessionId, seq)
    const full = { ...frame, seq } as BtwFrame
    const ring = this.rings.get(sessionId) ?? []
    ring.push(full)
    if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT)
    this.rings.set(sessionId, ring)
    for (const subscriber of this.subscribers.get(sessionId) ?? []) subscriber.push(full)
    return seq
  }

  cursor(sessionId: string): number {
    return this.counters.get(sessionId) ?? 0
  }

  replay(sessionId: string, after: number | undefined): BtwFrame[] {
    if (after === undefined) return []
    return (this.rings.get(sessionId) ?? []).filter((frame) => (frame as any).seq > after)
  }

  subscribe(sessionId: string): Subscription {
    let set = this.subscribers.get(sessionId)
    if (set === undefined) {
      set = new Set()
      this.subscribers.set(sessionId, set)
    }
    const subscription = new Subscription()
    set.add(subscription)
    return {
      push: (frame: BtwFrame) => subscription.push(frame),
      close: () => {
        subscription.close()
        set?.delete(subscription)
      },
      iterate: () => subscription.iterate(),
    } as any
  }

  reset(sessionId: string): void {
    this.counters.delete(sessionId)
    this.rings.delete(sessionId)
  }
}

interface RunRecord {
  controller: AbortController
  view: BtwQuestionView
  request: any
  timedOut: boolean
  timeout: ReturnType<typeof setTimeout>
}

export class RunManager {
  commandName = 'btw'
  private runs = new Map<string, Map<string, RunRecord>>()
  private active = 0

  constructor(
    private readonly ctx: any,
    private readonly config: BtwConfig,
    private readonly capture: CaptureStore,
    private readonly bus: FrameBus,
  ) {}

  private records(sessionId: string): Map<string, RunRecord> {
    let map = this.runs.get(sessionId)
    if (map === undefined) {
      map = new Map()
      this.runs.set(sessionId, map)
    }
    return map
  }

  views(sessionId: string): BtwQuestionView[] {
    return [...this.records(sessionId).values()].map((record) => this.viewOf(record))
  }

  private viewOf(record: RunRecord): BtwQuestionView {
    const view = record.view
    return {
      requestId: view.requestId,
      question: view.question,
      phase: view.phase,
      answer: view.answer,
      ...(view.error === undefined ? {} : { error: { ...view.error } }),
      startedAt: view.startedAt,
      ...(view.finishedAt === undefined ? {} : { finishedAt: view.finishedAt }),
      ...(view.provenance === undefined ? {} : { provenance: { ...view.provenance } }),
      ...(view.usage === undefined ? {} : { usage: { ...view.usage } }),
    }
  }

  hasContext(session: any): boolean {
    if (typeof session?.id !== 'string') return false
    if (this.capture.get(session.id) !== undefined) return true
    try {
      return typeof session.requestHeader?.()?.config?.provider === 'string'
    } catch {
      return false
    }
  }

  start(session: any, question: string): string {
    const trimmed = question.trim()
    if (trimmed === '') throw new BtwError('empty-question', '旁路提问内容为空')
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw new BtwError('too-long', `旁路提问内容过长（上限 ${MAX_QUESTION_LENGTH} 字）`)
    }
    const sessionId = session?.id
    if (typeof sessionId !== 'string') throw new BtwError('unavailable', '当前会话不可用')
    if (!this.hasContext(session)) {
      throw new BtwError('no-context', '这条会话还没有任何真实的模型请求，先发一条消息再旁路提问')
    }
    if (this.active >= this.config.maxConcurrent) {
      throw new BtwError('busy', `同时进行的旁路提问已达上限（${this.config.maxConcurrent} 个），稍后再试`)
    }

    const requestId = `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    let payload: ReturnType<typeof buildSideRequest>
    try {
      payload = buildSideRequest({
        session,
        snapshot: this.capture.get(sessionId),
        config: this.config,
        question: trimmed,
        requestId,
        signal: controller.signal,
      })
    } catch (error) {
      controller.abort()
      if (error instanceof BtwError) throw error
      throw new BtwError('no-context', '当前请求上下文不可用，先发一条消息再旁路提问')
    }
    const provenance = payload.provenance
    const view: BtwQuestionView = {
      requestId,
      question: trimmed,
      phase: 'calling',
      answer: '',
      startedAt: Date.now(),
      provenance,
    }
    this.bus.emit(sessionId, { type: 'accepted', view: { ...view } })

    const record: RunRecord = {
      controller,
      view,
      request: payload.request,
      timedOut: false,
      timeout: setTimeout(() => {
        record.timedOut = true
        controller.abort()
      }, this.config.timeoutMs),
    }
    const map = this.records(sessionId)
    map.set(requestId, record)
    this.trimHistory(sessionId)
    this.active += 1
    void this.execute(session, sessionId, record)
    return requestId
  }

  private provenanceOf(session: any): BtwQuestionView['provenance'] {
    const snapshot = this.capture.get(session?.id)
    if (snapshot !== undefined) {
      return {
        reason: 'captured',
        model: snapshot.model,
        messageCount: snapshot.messageCount,
        capturedAt: snapshot.capturedAt,
      }
    }
    return { reason: 'reconstructed', model: '未知', messageCount: 0, capturedAt: Date.now(), degraded: true }
  }

  private trimHistory(sessionId: string): void {
    const map = this.records(sessionId)
    if (map.size <= this.config.maxPerSession) return
    for (const [requestId, record] of map) {
      if (record.view.phase === 'done' || record.view.phase === 'error' || record.view.phase === 'cancelled') {
        map.delete(requestId)
        if (map.size <= this.config.maxPerSession) return
      }
    }
  }

  private setPhase(sessionId: string, record: RunRecord, phase: BtwPhase): void {
    record.view.phase = phase
    if (phase === 'calling' || phase === 'streaming') {
      this.bus.emit(sessionId, { type: 'status', requestId: record.view.requestId, phase })
    }
  }

  private async execute(session: any, sessionId: string, record: RunRecord): Promise<void> {
    const view = record.view
    try {
      const llm = this.ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') {
        throw new BtwError('unavailable', '当前宿主没有可用的 LLM 服务')
      }
      let reasoningStarted = false
      let streaming = false
      let usage: { totalTokens?: number } | undefined
      let answer = ''
      let aborted = false

      const stream = llm.stream({ ...record.request, signal: record.controller.signal })
      for await (const chunk of stream) {
        if (record.controller.signal.aborted) {
          aborted = true
          break
        }
        switch (chunk?.type) {
          case 'text-delta': {
            if (typeof chunk.text !== 'string' || chunk.text === '') break
            if (!streaming) {
              streaming = true
              this.setPhase(sessionId, record, 'streaming')
            }
            answer += chunk.text
            if (answer.length > MAX_ANSWER_LENGTH) answer = answer.slice(0, MAX_ANSWER_LENGTH)
            this.bus.emit(sessionId, { type: 'delta', requestId: view.requestId, text: chunk.text })
            break
          }
          case 'reasoning-delta': {
            if (!reasoningStarted) {
              reasoningStarted = true
              this.bus.emit(sessionId, { type: 'status', requestId: view.requestId, phase: 'thinking' })
            }
            break
          }
          case 'usage': {
            const total = chunk?.usage?.totalTokens
            if (typeof total === 'number') usage = { totalTokens: total }
            break
          }
          case 'finish': {
            const reason = chunk?.reason
            if (reason?.kind === 'aborted') {
              aborted = true
            } else if (reason?.kind === 'tool-calls') {
              throw new BtwError('tools-attempted', '模型想调用工具来完成这个问题，但旁路提问只基于已有上下文作答；换个问法（例如「根据当前上下文总结…」）再试')
            } else if (reason?.kind === 'error') {
              const message = reason?.failure?.message ?? reason?.message ?? '模型请求失败'
              throw new BtwError('model', String(message))
            }
            break
          }
          default:
            break
        }
      }

      if (aborted) {
        this.finishCancelled(sessionId, record)
        return
      }
      view.answer = answer
      view.phase = 'done'
      view.finishedAt = Date.now()
      if (usage !== undefined) view.usage = usage
      this.bus.emit(sessionId, {
        type: 'done',
        requestId: view.requestId,
        answer,
        ...(usage === undefined ? {} : { usage }),
        finishedAt: view.finishedAt,
      })
    } catch (error) {
      if (record.timedOut) {
        this.finishError(sessionId, record, 'timeout', `旁路提问超时（${Math.round(this.config.timeoutMs / 1000)} 秒），请重试`)
      } else if (record.controller.signal.aborted) {
        this.finishCancelled(sessionId, record)
      } else if (error instanceof BtwError) {
        this.finishError(sessionId, record, error.code, error.message)
      } else {
        const message = error instanceof Error && error.message !== '' ? error.message : '旁路提问失败'
        this.finishError(sessionId, record, 'model', message)
      }
    } finally {
      clearTimeout(record.timeout)
      this.active = Math.max(0, this.active - 1)
    }
  }

  private finishCancelled(sessionId: string, record: RunRecord): void {
    record.view.phase = 'cancelled'
    record.view.finishedAt = Date.now()
    this.bus.emit(sessionId, { type: 'cancelled', requestId: record.view.requestId })
  }

  private finishError(sessionId: string, record: RunRecord, code: string, message: string): void {
    record.view.phase = 'error'
    record.view.finishedAt = Date.now()
    record.view.error = { code, message }
    this.bus.emit(sessionId, { type: 'error', requestId: record.view.requestId, code, message })
  }

  abort(sessionId: string, requestId: string): boolean {
    const record = this.runs.get(sessionId)?.get(requestId)
    if (record === undefined) return false
    if (record.view.phase === 'done' || record.view.phase === 'error' || record.view.phase === 'cancelled') return false
    record.controller.abort()
    return true
  }

  clear(sessionId: string): void {
    for (const record of this.runs.get(sessionId)?.values() ?? []) {
      if (record.view.phase !== 'done' && record.view.phase !== 'error' && record.view.phase !== 'cancelled') {
        record.controller.abort()
      }
    }
    this.runs.delete(sessionId)
    this.bus.reset(sessionId)
  }

  abortAll(): void {
    for (const [sessionId, map] of this.runs) {
      for (const record of map.values()) {
        if (record.view.phase !== 'done' && record.view.phase !== 'error' && record.view.phase !== 'cancelled') {
          record.controller.abort()
        }
      }
      this.bus.reset(sessionId)
    }
    this.runs.clear()
  }
}
