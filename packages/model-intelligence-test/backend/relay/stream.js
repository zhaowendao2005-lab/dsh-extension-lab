/**
 * Direct streaming call to one relay channel, used for relay-sourced fingerprint samples. The
 * channel is targeted by appending `-<channel_id>` to the API key (a6api convention). Events are
 * normalised to {text|reasoning|usage|finish} so the fingerprint engine stays protocol-agnostic.
 * Credentials never leave this module except inside the outgoing request headers.
 */

export const RELAY_APIS = ['chat', 'responses', 'messages'];

/** Default protocol for a channel: Claude models speak Messages, `responses` endpoints Responses. */
export function defaultApi(row) {
  if (/claude|anthropic/i.test(`${row?.brand ?? ''} ${row?.model ?? row?.modelName ?? ''}`)) return 'messages';
  if (row?.testEndpoint === 'responses') return 'responses';
  return 'chat';
}

function request(api, { apiUrl, key, model, prompt }) {
  const base = apiUrl.replace(/\/+$/, '');
  if (api === 'messages') {
    return {
      url: `${base}/v1/messages`,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: 32_000, stream: true, messages: [{ role: 'user', content: prompt }] },
    };
  }
  if (api === 'responses') {
    return {
      url: `${base}/v1/responses`,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
      body: { model, stream: true, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] },
    };
  }
  return {
    url: `${base}/v1/chat/completions`,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
    body: { model, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: prompt }] },
  };
}

export async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
      let event = '';
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) yield { event, data: data.join('\n') };
    }
  }
}

const num = value => Number.isFinite(value) && value >= 0 ? value : null;

/** Map one parsed SSE payload to normalised events. */
function* normalise(api, payload, state) {
  if (api === 'messages') {
    if (payload.type === 'message_start') {
      state.input = num(payload.message?.usage?.input_tokens);
      state.output = num(payload.message?.usage?.output_tokens);
    } else if (payload.type === 'content_block_delta') {
      if (payload.delta?.type === 'text_delta') yield { type: 'text', text: payload.delta.text ?? '' };
      else if (payload.delta?.type === 'thinking_delta') yield { type: 'reasoning', text: payload.delta.thinking ?? '' };
    } else if (payload.type === 'message_delta') {
      if (payload.usage) state.output = num(payload.usage.output_tokens) ?? state.output;
      if (payload.delta?.stop_reason) state.stop = payload.delta.stop_reason === 'max_tokens' ? 'max-tokens' : payload.delta.stop_reason === 'tool_use' ? 'tool-calls' : 'stop';
    } else if (payload.type === 'error') {
      state.error = { message: payload.error?.message ?? 'stream error', code: payload.error?.type ?? null };
    }
    return;
  }
  if (api === 'responses') {
    if (payload.type === 'response.output_text.delta') yield { type: 'text', text: payload.delta ?? '' };
    else if (payload.type === 'response.reasoning_summary_text.delta' || payload.type === 'response.reasoning_text.delta') yield { type: 'reasoning', text: payload.delta ?? '' };
    else if (payload.type === 'response.completed' || payload.type === 'response.incomplete') {
      const usage = payload.response?.usage;
      state.input = num(usage?.input_tokens); state.output = num(usage?.output_tokens);
      state.stop = payload.type === 'response.incomplete' ? 'max-tokens' : 'stop';
    } else if (payload.type === 'response.failed' || payload.type === 'error') {
      state.error = { message: payload.response?.error?.message ?? payload.message ?? 'stream error', code: payload.response?.error?.code ?? payload.code ?? null };
    }
    return;
  }
  if (payload.error) { state.error = { message: payload.error.message ?? 'stream error', code: payload.error.type ?? payload.error.code ?? null }; return; }
  const choice = payload.choices?.[0];
  const delta = choice?.delta;
  if (delta?.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
  else if (delta?.reasoning) yield { type: 'reasoning', text: delta.reasoning };
  if (typeof delta?.content === 'string' && delta.content) yield { type: 'text', text: delta.content };
  if (choice?.finish_reason) state.stop = choice.finish_reason === 'length' ? 'max-tokens' : choice.finish_reason === 'tool_calls' ? 'tool-calls' : 'stop';
  if (payload.usage) { state.input = num(payload.usage.prompt_tokens); state.output = num(payload.usage.completion_tokens); }
}

export class RelayStreamError extends Error {
  constructor(message, facts) { super(message); this.failure = facts; }
}

/**
 * Stream one prompt to a relay channel. Yields `{type:'text'|'reasoning', text}` deltas and a final
 * `{type:'finish', kind, failure, usage}`; network and HTTP failures throw RelayStreamError.
 */
export async function* relayStream({ apiUrl, apiKey, channelId, model, api, prompt, signal }) {
  const key = `${apiKey}-${channelId}`;
  const spec = request(api, { apiUrl, key, model, prompt });
  let response;
  try {
    response = await fetch(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RelayStreamError('无法连接中转站', { message: error?.message ?? 'network error', code: 'network', status: null });
  }
  if (!response.ok || !response.body) {
    let text = '';
    try { text = (await response.text()).slice(0, 4000); } catch { /* body unreadable */ }
    throw new RelayStreamError(`HTTP ${response.status}`, { message: `${response.status} ${text}`.trim(), code: 'http', status: response.status, detail: text });
  }
  const state = { input: null, output: null, stop: null, error: null };
  for await (const { data } of sse(response.body)) {
    if (data === '[DONE]') break;
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    for (const event of normalise(api, payload, state)) yield event;
    if (state.error) break;
  }
  yield {
    type: 'finish',
    kind: state.error ? 'error' : state.stop ?? 'stop',
    failure: state.error ? { message: state.error.message, code: state.error.code, status: null } : null,
    usage: { inputTokens: state.input, outputTokens: state.output },
  };
}
