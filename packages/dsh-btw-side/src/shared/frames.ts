/** Wire protocol shared by the BTW host service and the browser bar. */

export const PACKAGE_ID = 'dsh-btw-side'
export const SERVICE_KEY = 'btwSide'
export const WIRE_NAMESPACE = 'btwSide'

export interface WatchRequest {
  sessionId: string
  afterSeq?: number
}

export interface StateRequest {
  sessionId: string
}

export interface CloseRequest {
  sessionId: string
  requestId: string
}

export interface ClearRequest {
  sessionId: string
}

export interface ProvenanceView {
  reason: 'captured' | 'reconstructed'
  model: string
  messageCount: number
  capturedAt: number
  degraded?: boolean
}

export type BtwPhase = 'queued' | 'calling' | 'streaming' | 'done' | 'error' | 'cancelled'

export interface BtwQuestionView {
  requestId: string
  question: string
  phase: BtwPhase
  answer: string
  error?: { code: string; message: string }
  startedAt: number
  finishedAt?: number
  provenance?: ProvenanceView
  usage?: { totalTokens?: number }
}

export interface StateResult {
  commandName: string
  questions: BtwQuestionView[]
  cursor: number
}

export type BtwFrame =
  | { type: 'baseline'; sessionId: string; commandName: string; questions: BtwQuestionView[]; cursor: number }
  | { type: 'accepted'; view: BtwQuestionView; seq: number }
  | { type: 'delta'; requestId: string; seq: number; text: string }
  | { type: 'status'; requestId: string; phase: 'calling' | 'streaming' | 'thinking'; seq: number }
  | { type: 'done'; requestId: string; answer: string; usage?: { totalTokens?: number }; finishedAt: number; seq: number }
  | { type: 'error'; requestId: string; code: string; message: string; seq: number }
  | { type: 'cancelled'; requestId: string; seq: number }

export type BtwErrorCode =
  | 'no-context'
  | 'empty-question'
  | 'too-long'
  | 'busy'
  | 'model'
  | 'overflow'
  | 'tools-attempted'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'internal'
