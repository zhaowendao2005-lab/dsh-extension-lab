import type { BtwConfig, BtwSnapshot } from './types'
import type { ProvenanceView } from '../shared/frames'
import { markSideRequest } from './capture'

/**
 * Answer-only directive injected before the user's question. The captured
 * request keeps its tools (history may contain paired tool messages), so we
 * tell the model not to reach for them instead of silently dropping tools.
 */
const SIDE_ANSWER_ONLY =
  '这是一次旁路提问：只依据当前对话已有的上下文直接回答，不要调用任何工具，也不要输出或提议工具调用。'

export class BtwError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BtwError'
  }
}

function trimUnansweredAssistant(messages: any[]): any[] {
  const last = messages[messages.length - 1]
  if (last === undefined || last.role !== 'assistant' || !Array.isArray(last.content)) return messages
  const hasToolCall = last.content.some((block: any) => block?.type === 'tool-call' || block?.type === 'tool_call')
  return hasToolCall ? messages.slice(0, -1) : messages
}

/**
 * Assemble the exact provider payload: captured call config plus the CURRENT
 * surface (deriveMessages already reflects committed compression) and the
 * side question. Nothing is persisted and no session/agent is created.
 */
export function buildSideRequest(args: {
  session: any
  snapshot: BtwSnapshot | undefined
  config: BtwConfig
  question: string
  requestId: string
  signal: AbortSignal
}): { request: any; provenance: ProvenanceView; sessionId: string } {
  const { session, snapshot, config, question, requestId, signal } = args
  const sessionId = typeof session?.id === 'string' ? session.id : ''
  if (sessionId === '') throw new BtwError('unavailable', '当前会话不可用')

  let provider = snapshot?.provider ?? ''
  let model = snapshot?.model ?? ''
  let reasoningEffort = snapshot?.reasoningEffort
  let temperature = snapshot?.temperature
  let tools = snapshot?.tools
  let reason: 'captured' | 'reconstructed' = 'captured'
  let capturedAt = snapshot?.capturedAt ?? Date.now()

  if (snapshot === undefined) {
    reason = 'reconstructed'
    capturedAt = Date.now()
    let header: any
    try {
      header = session.requestHeader?.()
    } catch {
      header = undefined
    }
    const callConfig = header?.config
    if (callConfig === undefined) {
      throw new BtwError('no-context', '这条会话还没有任何真实的模型请求，先发一条消息再旁路提问')
    }
    provider = typeof callConfig.provider === 'string' ? callConfig.provider : ''
    model = typeof callConfig.model === 'string' ? callConfig.model : ''
    reasoningEffort = typeof callConfig.reasoningEffort === 'string' ? callConfig.reasoningEffort : undefined
    temperature = typeof callConfig.temperature === 'number' ? callConfig.temperature : undefined
    tools = Array.isArray(header?.tools) ? header.tools : undefined
  }

  if (provider === '' || model === '') {
    throw new BtwError('no-context', '这条会话还没有可复用的真实请求记录，先发一条消息再旁路提问')
  }

  let surface: any[]
  try {
    surface = session.deriveMessages()
  } catch {
    surface = []
  }
  if (!Array.isArray(surface)) surface = []
  if (surface.length === 0) {
    throw new BtwError('no-context', '当前请求上下文为空，先发一条消息再旁路提问')
  }
  const messages = trimUnansweredAssistant([...surface])

  const userMessage = {
    id: `btw-${requestId}`,
    role: 'user',
    content: [{ type: 'text', text: `${SIDE_ANSWER_ONLY}\n\n${question}` }],
  }

  const request: any = {
    provider,
    model,
    messages: [...messages, userMessage],
    maxTokens: config.maxTokens,
    signal,
  }
  if (reasoningEffort !== undefined) request.reasoningEffort = reasoningEffort
  if (temperature !== undefined) request.temperature = temperature
  if (Array.isArray(tools) && tools.length > 0) request.tools = tools

  const compressionSessionId =
    config.compression === 'inherit'
      ? sessionId
      : config.compression === 'isolated'
        ? `btw:${sessionId}`
        : undefined
  if (compressionSessionId !== undefined) request.sessionId = compressionSessionId

  markSideRequest(request)

  return {
    request,
    sessionId,
    provenance: {
      reason,
      model,
      messageCount: messages.length,
      capturedAt,
      ...(snapshot === undefined ? { degraded: true } : {}),
    },
  }
}
