/**
 * Data plane: one streaming model call to a6api, normalised into DSH `StreamChunk`s.
 *
 * The plugin pins a channel server-side and then streams with the token's own key, so this module
 * speaks plain OpenAI/Responses/Messages wire protocols and nothing about routing. Emitting DSH
 * chunks keeps the fingerprint engine's assembler, timing and projection code untouched.
 */

const ENDPOINT = 'https://api.a6api.vip';

export class ChannelError extends Error {
  constructor(message, facts) {
    super(message);
    this.name = 'ChannelError';
    this.failure = facts;
  }
}

/** Wire protocol for one channel row. */
export function channelApi(channel) {
  if (/claude|anthropic/i.test(`${channel?.brand ?? ''} ${channel?.model ?? ''}`)) return 'messages';
  return 'chat';
}

function build(api, { key, model, prompt }) {
  if (api === 'messages') {
    return {
      url: `${ENDPOINT}/v1/messages`,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: 32_000, stream: true, messages: [{ role: 'user', content: prompt }] },
    };
  }
  return {
    url: `${ENDPOINT}/v1/chat/completions`,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
    body: { model, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: prompt }] },
  };
}

async function* frames(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
      const data = [];
      for (const line of block.split(/\r?\n/)) if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      if (data.length) yield data.join('\n');
    }
  }
}

/**
 * a6api answers 429 twice over: the platform's own self-test quota (refused before the merchant sees
 * the request, so it costs nothing) and a real upstream rate limit. Only the first is worth retrying
 * without backoff pressure on the merchant.
 */
function classify(status, body, response) {
  let payload = null;
  try { payload = body ? JSON.parse(body) : null; } catch { /* HTML error page */ }
  const error = payload?.error ?? payload;
  const code = typeof error?.code === 'string' ? error.code : typeof error?.type === 'string' ? error.type : `http-${status}`;
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${status}`;
  const header = Number(response?.headers?.get?.('retry-after'));
  const providerRetryAfterMs = Number.isFinite(header) && header > 0 ? Math.min(header, 300) * 1000 : undefined;
  const platformQuota = status === 429 && (code === 'specific_channel_rate_limited' || /广场自助测试|每个账号每分钟/.test(`${message} ${body ?? ''}`));
  return {
    status, code, message, providerRetryAfterMs,
    kind: status === 429 ? (platformQuota ? 'platform-quota' : 'rate-limited') : status >= 500 ? 'upstream-unavailable' : 'request-failed',
  };
}

/** Index 0 carries reasoning when the model emits it, 1 carries visible text. */
const TEXT = 1;
const REASONING = 0;

function stopReason(value) {
  if (value === 'length' || value === 'max_tokens') return 'max-tokens';
  if (value === 'tool_calls' || value === 'tool_use') return 'tool-calls';
  return 'stop';
}

function usageOf(payload, api) {
  const raw = api === 'messages' ? payload?.usage ?? payload?.message?.usage : payload?.usage;
  if (!raw) return null;
  const amount = value => value === undefined || value === null ? NaN : Number(value);
  const inputTokens = amount(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = amount(raw.output_tokens ?? raw.completion_tokens);
  const cacheReadTokens = amount(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens);
  const reasoningTokens = amount(raw.output_tokens_details?.reasoning_tokens);
  const usage = Object.fromEntries(Object.entries({ inputTokens, outputTokens, cacheReadTokens, reasoningTokens })
    .filter(([, value]) => Number.isFinite(value) && value >= 0));
  return Object.keys(usage).length ? usage : null;
}

/**
 * Stream one prompt and yield DSH chunks. HTTP and transport failures throw {@link ChannelError};
 * provider-reported stream errors arrive as a `finish` chunk with `reason.failure`.
 */
export async function* openChannelStream({ key, model, prompt, api = 'chat', signal, onDispatch, onMetadata, onUsage, fetchImpl = globalThis.fetch }) {
  const spec = build(api, { key, model, prompt });
  let response;
  try {
    signal?.throwIfAborted();
    await onDispatch?.();
    response = await fetchImpl(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChannelError('无法连接 a6api', { message: error?.message ?? 'network error', code: 'network', status: undefined });
  }
  // Persist response identity before inspecting an HTTP error or consuming the stream.
  try { await onMetadata?.({ requestId: response.headers?.get?.('X-Oneapi-Request-Id') || null, httpStatus: response.status }); }
  catch (error) {
    try { await response.body?.cancel?.(); } catch { /* drain ownership ends even if the peer has closed */ }
    throw error;
  }
  if (!response.ok || !response.body) {
    let body = '';
    try { body = (await response.text()).slice(0, 2_000); } catch { /* body unreadable */ }
    const verdict = classify(response.status, body, response);
    throw new ChannelError(verdict.message, {
      message: `${verdict.message}（HTTP ${verdict.status}）`, code: verdict.code, status: verdict.status,
      kind: verdict.kind, detail: body.slice(0, 600), providerRetryAfterMs: verdict.providerRetryAfterMs,
    });
  }
  let failure = null;
  let reason = 'stop';
  let usage = null;
  let sawText = false;
  for await (const data of frames(response.body)) {
    if (data === '[DONE]') break;
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    if (api === 'messages') {
      if (payload.type === 'content_block_delta') {
        if (payload.delta?.type === 'thinking_delta') yield { type: 'reasoning-delta', index: REASONING, text: payload.delta.thinking ?? '' };
        else if (typeof payload.delta?.text === 'string' && payload.delta.text) { sawText = true; yield { type: 'text-delta', index: TEXT, text: payload.delta.text }; }
      } else if (payload.type === 'message_delta') {
        if (payload.delta?.stop_reason) reason = stopReason(payload.delta.stop_reason);
      } else if (payload.type === 'error') {
        failure = { message: String(payload.error?.message ?? 'stream error').slice(0, 300), code: String(payload.error?.type ?? 'stream_error') };
      }
      const partial = usageOf(payload, 'messages');
      if (partial) { usage = { ...usage, ...partial }; onUsage?.(usage); }
      continue;
    }
    if (payload.error) { failure = { message: String(payload.error.message ?? 'stream error').slice(0, 300), code: String(payload.error.code ?? payload.error.type ?? 'stream_error') }; continue; }
    const choice = payload.choices?.[0];
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning-delta', index: REASONING, text: reasoning };
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) { sawText = true; yield { type: 'text-delta', index: TEXT, text: choice.delta.content }; }
    if (choice?.finish_reason) reason = stopReason(choice.finish_reason);
    const partial = usageOf(payload, 'chat');
    if (partial) { usage = { ...usage, ...partial }; onUsage?.(usage); }
  }
  if (usage) yield { type: 'usage', usage };
  yield { type: 'finish', reason: failure ? { kind: 'error', failure } : { kind: reason } };
  if (!sawText && !failure) {
    // A 200 with nothing on the wire is a dead channel, not a passing sample.
    throw new ChannelError('渠道没有返回任何内容', { message: 'stream ended without text', code: 'empty-stream', status: 200, kind: 'empty-stream' });
  }
}
