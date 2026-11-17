/**
 * Full-conversation a6 data plane for custom tests. The key stays in this
 * closure; it never enters GenerateOptions, Agent options, events, or records.
 * This deliberately does not change the fingerprint-only a6 transport.
 */
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';

const ENDPOINT = 'https://api.a6api.vip';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_USAGE_FRAMES = 32;
const USAGE_FRAME_FIELDS = new Set([
  'input_tokens', 'output_tokens', 'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cache_read_input_tokens', 'cache_creation_input_tokens', 'cache_write_input_tokens', 'prompt_cache_hit_tokens',
]);
const USAGE_DETAIL_FIELDS = new Set(['cached_tokens', 'reasoning_tokens']);
const count = value => Number.isFinite(value) && value >= 0 ? value : undefined;
function usageFrame(raw) {
  const frame = {};
  for (const [key, value] of Object.entries(raw)) {
    if (USAGE_FRAME_FIELDS.has(key) && count(value) !== undefined) frame[key] = value;
    else if (['prompt_tokens_details', 'completion_tokens_details', 'output_tokens_details'].includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const details = Object.fromEntries(Object.entries(value).filter(([name, amount]) => USAGE_DETAIL_FIELDS.has(name) && count(amount) !== undefined));
      if (Object.keys(details).length) frame[key] = details;
    }
  }
  return frame;
}
const toolArguments = value => {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new LlmError('a6api returned invalid tool arguments', 'A6_INVALID_TOOL_ARGUMENTS'); }
};
function textOf(content) {
  if (!Array.isArray(content) || content.some(block => block.type !== 'text')) throw new LlmError('Unsupported a6 text content', 'A6_UNSUPPORTED_CONTENT');
  return content.map(block => block.text).join('\n');
}
function finishReason(value) {
  if (value === 'length' || value === 'max_tokens' || value === 'model_context_window_exceeded') return 'max-tokens';
  if (value === 'tool_calls' || value === 'tool_use' || value === 'function_call') return 'tool-calls';
  if (['stop', 'end_turn', 'stop_sequence', 'pause_turn'].includes(value)) return 'stop';
  if (value === 'content_filter' || value === 'refusal') throw new LlmError('a6api refused the response', 'A6_REFUSED');
  throw new LlmError('a6api returned an unsupported finish reason', 'A6_INVALID_STREAM');
}
function toolsOf(tools = [], api) {
  return tools.map(tool => api === 'messages'
    ? { name: tool.name, description: tool.description, input_schema: tool.parameters }
    : { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } });
}

/** Lossless projection for the text/reasoning/tool vocabulary exposed by the test tools. */
export function buildA6Request(options, api = 'chat') {
  if (!['chat', 'messages'].includes(api)) throw new TypeError('Unsupported a6 protocol');
  const messages = [];
  const system = options.system ? [options.system] : [];
  for (const message of options.messages ?? []) {
    const content = message.content ?? [];
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(content);
      if (api === 'messages') { if (text) system.push(text); }
      else messages.push({ role: message.role, content: text });
    } else if (message.role === 'user') {
      messages.push({ role: 'user', content: api === 'messages' ? content.map(block => {
        if (block.type !== 'text') throw new LlmError('Attachments are unavailable in custom a6 tests', 'A6_UNSUPPORTED_CONTENT');
        return { type: 'text', text: block.text };
      }) : textOf(content) });
    } else if (message.role === 'tool') {
      const text = textOf(content);
      if (api === 'messages') messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: text, ...(message.isError ? { is_error: true } : {}) }] });
      else messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: text });
    } else if (message.role === 'assistant') {
      if (api === 'messages') {
        const replay = message.source?.replayState;
        const projected = [];
        for (let index = 0; index < content.length; index++) {
          const block = content[index];
          if (block.type === 'text') projected.push({ type: 'text', text: block.text });
          else if (block.type === 'tool-call') projected.push({ type: 'tool_use', id: block.id, name: block.name, input: toolArguments(block.arguments) });
          else if (block.type === 'reasoning') {
            const native = replay?.response?.protocol === 'mit-a6/messages' ? replay.blocks?.[index] : null;
            if (native?.type === 'thinking' && typeof native.signature === 'string' && native.signature) projected.push({ type: 'thinking', thinking: block.text, signature: native.signature });
            else if (native?.type === 'redacted_thinking' && typeof native.data === 'string') projected.push({ type: 'redacted_thinking', data: native.data });
            // Unsigned thinking cannot legally be replayed as Anthropic thinking.
            else if (block.text) throw new LlmError('a6api reasoning lacked a replay signature', 'A6_MISSING_REASONING_SIGNATURE');
          } else throw new LlmError('Unsupported a6 assistant content', 'A6_UNSUPPORTED_CONTENT');
        }
        if (projected.length) messages.push({ role: 'assistant', content: projected });
      } else {
        const text = [];
        const reasoning = [];
        const calls = [];
        for (const block of content) {
          if (block.type === 'text') text.push(block.text);
          else if (block.type === 'reasoning') reasoning.push(block.text);
          else if (block.type === 'tool-call') calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } });
          else throw new LlmError('Unsupported a6 assistant content', 'A6_UNSUPPORTED_CONTENT');
        }
        messages.push({ role: 'assistant', content: text.length ? text.join('') : null, ...(reasoning.length ? { reasoning_content: reasoning.join('') } : {}), ...(calls.length ? { tool_calls: calls } : {}) });
      }
    } else throw new LlmError('Unsupported a6 message role', 'A6_UNSUPPORTED_CONTENT');
  }
  // Anthropic accepts alternating roles; parallel results belong to the same user message.
  if (api === 'messages') {
    for (let index = messages.length - 1; index > 0; index--) if (messages[index].role === messages[index - 1].role) {
      messages[index - 1].content.push(...messages[index].content);
      messages.splice(index, 1);
    }
  } else if (system.length) messages.unshift({ role: 'system', content: system.join('\n\n') });
  const body = { model: options.model, messages, stream: true };
  if (options.tools?.length) body.tools = toolsOf(options.tools, api);
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (api === 'messages') {
    body.max_tokens = options.maxTokens ?? 8192;
    if (system.length) body.system = system.join('\n\n');
    if (options.stop?.length) body.stop_sequences = options.stop;
    // No speculative mapping of opaque DSH efforts to Anthropic token budgets.
    if (options.reasoningEffort !== undefined) throw new LlmError('a6 Messages reasoning effort requires an explicit provider mapping', 'A6_UNSUPPORTED_REASONING_EFFORT');
  } else {
    body.stream_options = { include_usage: true };
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.stop?.length) body.stop = options.stop;
    if (options.reasoningEffort !== undefined) body.reasoning_effort = options.reasoningEffort;
  }
  return body;
}

async function* frames(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedBytes = 0;
  const parse = function* (block) {
    const data = [];
    for (const line of block.split('\n')) if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    if (data.length) yield data.join('\n');
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) throw new LlmError('a6api response exceeded the limit', 'A6_RESPONSE_LIMIT');
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) throw new LlmError('a6api SSE frame exceeded the limit', 'A6_FRAME_LIMIT');
      let separator;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        yield* parse(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* parse(buffer);
  } finally {
    try { await reader.cancel(); } catch { /* abort or a closed peer is already settled */ }
    reader.releaseLock();
  }
}
function mergeUsage(previous, raw, api) {
  if (!raw || typeof raw !== 'object') return previous;
  const next = { ...previous, streamUsageFrames: [...(previous.streamUsageFrames ?? []), usageFrame(raw)].slice(-MAX_USAGE_FRAMES) };
  const input = count(api === 'messages' ? raw.input_tokens : raw.prompt_tokens ?? raw.input_tokens);
  const output = count(api === 'messages' ? raw.output_tokens : raw.completion_tokens ?? raw.output_tokens);
  const read = count(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens);
  const write = count(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens);
  if (read !== undefined) next.cacheReadTokens = read;
  if (write !== undefined) next.cacheWriteTokens = write;
  if (input !== undefined) {
    // DSH counts uncached input separately; OpenAI's prompt_tokens includes cache hits.
    next.promptTokens = input;
  }
  if (api === 'messages' && next.promptTokens !== undefined && (next.cacheReadTokens !== undefined || next.cacheWriteTokens !== undefined)) {
    next.inputTotalTokens = next.promptTokens + (next.cacheReadTokens ?? 0) + (next.cacheWriteTokens ?? 0);
    next.inputTokens = Math.max(0, next.inputTotalTokens - (next.cacheReadTokens ?? 0) - (next.cacheWriteTokens ?? 0));
  } else if (api === 'messages' && next.promptTokens !== undefined) {
    next.inputTokens = next.promptTokens;
  }
  if (api !== 'messages' && next.promptTokens !== undefined) {
    next.inputTotalTokens = next.promptTokens;
    next.inputTokens = Math.max(0, next.promptTokens - (next.cacheReadTokens ?? 0) - (next.cacheWriteTokens ?? 0));
  }
  if (output !== undefined) next.outputTokens = output;
  const reasoning = count(raw.completion_tokens_details?.reasoning_tokens ?? raw.output_tokens_details?.reasoning_tokens);
  if (reasoning !== undefined) next.reasoningTokens = reasoning;
  const total = count(raw.total_tokens);
  if (total !== undefined) next.totalTokens = total;
  else if (next.inputTokens !== undefined && next.outputTokens !== undefined) next.totalTokens = next.inputTokens + next.outputTokens + (next.cacheReadTokens ?? 0) + (next.cacheWriteTokens ?? 0);
  return next;
}
function exposedUsage(value) {
  const { promptTokens: _aggregate, ...usage } = value;
  return usage;
}
function llmUsage(value) {
  return Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
    .filter(field => Number.isFinite(value[field]) && value[field] >= 0).map(field => [field, value[field]]));
}
function terminalFailure(payload, status = 200) {
  const code = payload?.error?.code ?? payload?.error?.type;
  // Provider error bodies can echo request headers; never retain them.
  return { code: code === 'specific_channel_rate_limited' ? 'A6_PLATFORM_QUOTA' : 'A6_STREAM_ERROR', message: 'a6api 流返回错误。', status };
}

/** @returns {(options: object, callbacks?: object) => AsyncIterable<object>} */
export function createA6Stream({ key, api = 'chat', fetchImpl = globalThis.fetch }) {
  if (typeof key !== 'string' || !key.trim() || /[^\x21-\x7e]/.test(key.trim())) throw new TypeError('Invalid a6 key');
  if (!['chat', 'messages'].includes(api)) throw new TypeError('Unsupported a6 protocol');
  if (typeof fetchImpl !== 'function') throw new TypeError('a6 fetch is unavailable');
  const credential = key.trim();
  return async function* stream(options, callbacks = {}) {
    const body = JSON.stringify(buildA6Request(options, api));
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new LlmError('a6api request exceeded the limit', 'A6_REQUEST_LIMIT');
    options.signal?.throwIfAborted();
    const headers = {
      ...attributionHeaders(),
      'content-type': 'application/json', accept: 'text/event-stream',
      ...(api === 'messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${credential}` }),
    };
    let response;
    try {
      response = await fetchImpl(`${ENDPOINT}${api === 'messages' ? '/v1/messages' : '/v1/chat/completions'}`, { method: 'POST', headers, body, signal: options.signal, redirect: 'error' });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new LlmError('Unable to connect to a6api', 'A6_NETWORK');
    }
    let consumed = false;
    try {
      const receivedId = response.headers?.get?.('X-Oneapi-Request-Id') || response.headers?.get?.('x-request-id') || '';
      const requestId = /^[a-zA-Z0-9._:/-]{1,256}$/.test(receivedId) && !receivedId.includes(credential) ? receivedId : null;
      await callbacks.metadata?.({ requestId, httpStatus: response.status });
      if (!response.ok || !response.body) {
        const retry = Number(response.headers?.get?.('retry-after'));
        throw new LlmError(`a6api HTTP ${response.status}`, 'A6_HTTP_ERROR', {
          status: response.status,
          ...(requestId ? { requestId } : {}),
          ...(Number.isFinite(retry) && retry > 0 ? { providerRetryAfterMs: Math.min(retry, 300) * 1000 } : {}),
        });
      }
      let usage = {};
      let reason = null;
      let failure = null;
      let terminal = false;
      let sawContent = false;
      const blocks = new Map();
      const order = [];
      const started = (index, type) => {
        if (!blocks.has(index)) { blocks.set(index, { type, text: '', arguments: '', name: '', id: '', signature: '' }); order.push(index); return true; }
        return false;
      };
      for await (const data of frames(response.body, options.signal)) {
        if (data === '[DONE]') { terminal = true; break; }
        let payload;
        try { payload = JSON.parse(data); } catch { throw new LlmError('a6api sent invalid SSE JSON', 'A6_INVALID_STREAM'); }
        if (payload.error || payload.type === 'error') { failure = terminalFailure(payload, response.status); terminal = true; break; }
        const rawUsage = api === 'messages' ? payload.usage ?? payload.message?.usage : payload.usage;
        if (rawUsage) {
          usage = mergeUsage(usage, rawUsage, api);
          await callbacks.usage?.(exposedUsage(usage));
        }
        if (api === 'messages') {
          const index = payload.index;
          if (payload.type === 'content_block_start') {
            const native = payload.content_block;
            const type = ['thinking', 'redacted_thinking'].includes(native?.type) ? 'reasoning' : native?.type === 'tool_use' ? 'tool-call' : native?.type === 'text' ? 'text' : null;
            if (!type || !Number.isSafeInteger(index) || index < 0 || index > 1024 || blocks.has(index)) throw new LlmError('a6api returned unsupported Messages content', 'A6_UNSUPPORTED_CONTENT');
            if (started(index, type)) yield { type: 'block-start', index, blockType: type };
            const block = blocks.get(index);
            if (native.type === 'redacted_thinking') {
              if (typeof native.data !== 'string') throw new LlmError('Invalid redacted a6api reasoning', 'A6_INVALID_STREAM');
              block.redacted = native.data;
              sawContent = true;
            }
            if (type === 'tool-call') {
              block.id = native.id;
              block.name = native.name;
              block.initialInput = native.input ?? {};
              if (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
              yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' };
              sawContent = true;
            } else {
              const initial = type === 'text' ? native.text : native.thinking;
              if (initial) { block.text += initial; sawContent = true; yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: initial }; }
              if (native.signature) block.signature = native.signature;
            }
          } else if (payload.type === 'content_block_delta') {
            const block = blocks.get(index);
            if (!block) throw new LlmError('a6api delta has no content block', 'A6_INVALID_STREAM');
            const delta = payload.delta;
            if (delta?.type === 'signature_delta') block.signature += delta.signature ?? '';
            else if (delta?.type === 'input_json_delta' && block.type === 'tool-call') {
              const value = delta.partial_json ?? '';
              block.arguments += value;
              yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: value };
            } else if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') {
              const value = delta.type === 'text_delta' ? delta.text : delta.thinking;
              if (typeof value !== 'string') throw new LlmError('Invalid a6api text delta', 'A6_INVALID_STREAM');
              block.text += value;
              sawContent ||= Boolean(value);
              yield { type: delta.type === 'text_delta' ? 'text-delta' : 'reasoning-delta', index, text: value };
            } else throw new LlmError('Unsupported a6api content delta', 'A6_INVALID_STREAM');
          } else if (payload.type === 'message_delta' && payload.delta?.stop_reason) reason = finishReason(payload.delta.stop_reason);
          else if (payload.type === 'message_stop') { terminal = true; break; }
        } else {
          const choice = payload.choices?.[0];
          const delta = choice?.delta;
          const reasoning = delta?.reasoning_content ?? delta?.reasoning;
          if (typeof reasoning === 'string' && reasoning) {
            if (started(0, 'reasoning')) yield { type: 'block-start', index: 0, blockType: 'reasoning' };
            blocks.get(0).text += reasoning;
            sawContent = true;
            yield { type: 'reasoning-delta', index: 0, text: reasoning };
          }
          if (typeof delta?.content === 'string' && delta.content) {
            if (started(1, 'text')) yield { type: 'block-start', index: 1, blockType: 'text' };
            blocks.get(1).text += delta.content;
            sawContent = true;
            yield { type: 'text-delta', index: 1, text: delta.content };
          }
          if (delta?.function_call) throw new LlmError('Legacy a6api function_call is unsupported', 'A6_UNSUPPORTED_CONTENT');
          for (const call of delta?.tool_calls ?? []) {
            if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index > 1024) throw new LlmError('Invalid a6api tool index', 'A6_INVALID_STREAM');
            const index = call.index + 2;
            if (started(index, 'tool-call')) yield { type: 'block-start', index, blockType: 'tool-call' };
            const block = blocks.get(index);
            if (call.id) block.id += call.id;
            if (call.function?.name) block.name += call.function.name;
            if (call.function?.arguments) block.arguments += call.function.arguments;
            sawContent = true;
            // Emit from the accumulated prefix once an identity arrives, retaining buffered arguments.
            if (block.id) {
              const argumentsDelta = block.arguments.slice(block.emittedArguments ?? 0);
              block.emittedArguments = block.arguments.length;
              yield { type: 'tool-call-delta', index, id: block.id, ...(block.name ? { name: block.name } : {}), argumentsDelta };
            }
          }
          if (choice?.finish_reason) { reason = finishReason(choice.finish_reason); terminal = true; }
        }
      }
      consumed = true;
      if (!terminal || (!reason && !failure)) throw new LlmError('a6api stream ended without a complete response', 'A6_TRUNCATED_STREAM');
      if (!sawContent && !failure) throw new LlmError('a6api returned no content', 'A6_EMPTY_STREAM');
      for (const index of order) {
        const block = blocks.get(index);
        if (block.type === 'tool-call') {
          if (!block.id || !block.name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
          const args = block.arguments || JSON.stringify(block.initialInput ?? {});
          if (reason !== 'max-tokens') toolArguments(args);
          yield { type: 'block-end', index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: args } };
        } else yield { type: 'block-end', index, block: { type: block.type, text: block.text } };
      }
      const nativeUsage = llmUsage(usage);
      if (nativeUsage.inputTokens !== undefined && nativeUsage.outputTokens !== undefined) yield { type: 'usage', usage: nativeUsage };
      yield {
        type: 'finish', reason: failure ? { kind: 'error', failure } : { kind: reason },
        ...(api === 'messages' && !failure ? { replayState: { response: { protocol: 'mit-a6/messages' }, blocks: order.map(index => {
          const block = blocks.get(index);
          return block.type === 'reasoning' ? block.redacted !== undefined ? { type: 'redacted_thinking', data: block.redacted } : { type: 'thinking', signature: block.signature } : null;
        }) } } : {}),
      };
    } finally {
      // frames() drains/cancels its reader; pre-consumption failures still own the response body.
      if (!consumed) try { await response.body?.cancel?.(); } catch { /* already closed or reader-owned */ }
    }
  };
}
