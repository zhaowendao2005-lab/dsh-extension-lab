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
const MAX_ERROR_BODY_BYTES = 4096;
const ERROR_BODY_TIMEOUT_MS = 2000;
const MAX_BLOCK_INDEX = 1024;
const USAGE_FRAME_FIELDS = new Set([
  'input_tokens', 'output_tokens', 'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cache_read_input_tokens', 'cache_creation_input_tokens', 'cache_write_input_tokens', 'prompt_cache_hit_tokens',
  // Gemini usageMetadata
  'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount',
]);
const USAGE_DETAIL_OBJECTS = ['prompt_tokens_details', 'completion_tokens_details', 'input_tokens_details', 'output_tokens_details'];
const USAGE_DETAIL_FIELDS = new Set(['cached_tokens', 'reasoning_tokens']);

/** DSH-native protocol ids accepted by the custom a6 data plane. */
export const A6_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];
const LEGACY_PROTOCOLS = { chat: 'openai-completions', messages: 'anthropic-messages' };
/** Map stored/legacy relay api values onto a DSH-native protocol id; unknown values fall back to Chat Completions. */
export function normalizeA6Api(value) {
  if (typeof value !== 'string') return 'openai-completions';
  const id = value.trim();
  if (A6_PROTOCOLS.includes(id)) return id;
  return LEGACY_PROTOCOLS[id] ?? 'openai-completions';
}
const PROTOCOL_PATHS = {
  'openai-completions': () => '/v1/chat/completions',
  'openai-responses': () => '/v1/responses',
  'anthropic-messages': () => '/v1/messages',
  'google-generative-ai': model => `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
};
// Stable replay-state tags; 'mit-a6/messages' predates the protocol rename and must keep its value.
const REPLAY_MESSAGES = 'mit-a6/messages';
const REPLAY_GOOGLE = 'mit-a6/google';

const count = value => Number.isFinite(value) && value >= 0 ? value : undefined;
function usageFrame(raw) {
  const frame = {};
  for (const [key, value] of Object.entries(raw)) {
    if (USAGE_FRAME_FIELDS.has(key) && count(value) !== undefined) frame[key] = value;
    else if (USAGE_DETAIL_OBJECTS.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
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
function userTextBlocks(content) {
  return content.map(block => {
    if (block.type !== 'text') throw new LlmError('Attachments are unavailable in custom a6 tests', 'A6_UNSUPPORTED_CONTENT');
    return block.text;
  });
}
function finishReason(value) {
  if (value === 'length' || value === 'max_tokens' || value === 'max_output_tokens' || value === 'model_context_window_exceeded') return 'max-tokens';
  if (value === 'tool_calls' || value === 'tool_use' || value === 'function_call') return 'tool-calls';
  if (['stop', 'end_turn', 'stop_sequence', 'pause_turn'].includes(value)) return 'stop';
  if (value === 'content_filter' || value === 'refusal') throw new LlmError('a6api refused the response', 'A6_REFUSED');
  throw new LlmError('a6api returned an unsupported finish reason', 'A6_INVALID_STREAM');
}
function toolsOf(tools = [], api) {
  if (api === 'anthropic-messages') return tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  if (api === 'openai-responses') return tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }));
  if (api === 'google-generative-ai') return [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }];
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}
/** Merge adjacent same-role turns (parallel tool results belong to one turn). */
function mergeAdjacent(turns, field) {
  for (let index = turns.length - 1; index > 0; index--) if (turns[index].role === turns[index - 1].role) {
    turns[index - 1][field].push(...turns[index][field]);
    turns.splice(index, 1);
  }
  return turns;
}

function buildChatOrMessages(options, api) {
  const messages = [];
  const system = options.system ? [options.system] : [];
  const anthropic = api === 'anthropic-messages';
  for (const message of options.messages ?? []) {
    const content = message.content ?? [];
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(content);
      if (anthropic) { if (text) system.push(text); }
      else messages.push({ role: message.role, content: text });
    } else if (message.role === 'user') {
      messages.push({ role: 'user', content: anthropic ? userTextBlocks(content).map(text => ({ type: 'text', text })) : textOf(content) });
    } else if (message.role === 'tool') {
      const text = textOf(content);
      if (anthropic) messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: text, ...(message.isError ? { is_error: true } : {}) }] });
      else messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: text });
    } else if (message.role === 'assistant') {
      if (anthropic) {
        const replay = message.source?.replayState;
        const projected = [];
        for (let index = 0; index < content.length; index++) {
          const block = content[index];
          if (block.type === 'text') projected.push({ type: 'text', text: block.text });
          else if (block.type === 'tool-call') projected.push({ type: 'tool_use', id: block.id, name: block.name, input: toolArguments(block.arguments) });
          else if (block.type === 'reasoning') {
            const native = replay?.response?.protocol === REPLAY_MESSAGES ? replay.blocks?.[index] : null;
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
  if (anthropic) mergeAdjacent(messages, 'content');
  else if (system.length) messages.unshift({ role: 'system', content: system.join('\n\n') });
  const body = { model: options.model, messages, stream: true };
  if (options.tools?.length) body.tools = toolsOf(options.tools, api);
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (anthropic) {
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

function buildResponses(options) {
  const input = [];
  const instructions = options.system ? [options.system] : [];
  for (const message of options.messages ?? []) {
    const content = message.content ?? [];
    if (message.role === 'system' || message.role === 'developer') {
      // Keep in-history instructions at their position instead of hoisting them.
      const text = textOf(content);
      if (text) input.push({ role: message.role, content: [{ type: 'input_text', text }] });
    } else if (message.role === 'user') {
      input.push({ role: 'user', content: userTextBlocks(content).map(text => ({ type: 'input_text', text })) });
    } else if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: textOf(content) });
    } else if (message.role === 'assistant') {
      let run = null;
      for (const block of content) {
        if (block.type === 'text') {
          if (!block.text) continue;
          if (!run) { run = { role: 'assistant', content: [] }; input.push(run); }
          run.content.push({ type: 'output_text', text: block.text });
        } else if (block.type === 'tool-call') {
          run = null;
          input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments || '{}' });
        } else if (block.type === 'reasoning') {
          // Unsigned/unencrypted reasoning is not replayable as a Responses reasoning item.
        } else throw new LlmError('Unsupported a6 assistant content', 'A6_UNSUPPORTED_CONTENT');
      }
    } else throw new LlmError('Unsupported a6 message role', 'A6_UNSUPPORTED_CONTENT');
  }
  const body = { model: options.model, input, stream: true, reasoning: { summary: 'auto' } };
  if (instructions.length) body.instructions = instructions.join('\n\n');
  if (options.tools?.length) body.tools = toolsOf(options.tools, 'openai-responses');
  if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.reasoningEffort !== undefined) body.reasoning.effort = options.reasoningEffort;
  if (options.stop?.length) throw new LlmError('a6 Responses does not support stop sequences', 'A6_UNSUPPORTED_STOP');
  return body;
}

function buildGoogle(options) {
  const contents = [];
  const system = options.system ? [options.system] : [];
  // Gemini tool results are keyed by function name; recover it from the nearest preceding call.
  const callNames = new Map();
  for (const message of options.messages ?? []) {
    const content = message.content ?? [];
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(content);
      if (text) system.push(text);
    } else if (message.role === 'user') {
      contents.push({ role: 'user', parts: userTextBlocks(content).map(text => ({ text })) });
    } else if (message.role === 'tool') {
      const name = callNames.get(message.toolCallId);
      if (!name) throw new LlmError('a6 Gemini tool result has no matching call', 'A6_UNSUPPORTED_CONTENT');
      contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { content: textOf(content) } } }] });
    } else if (message.role === 'assistant') {
      const replay = message.source?.replayState;
      const native = replay?.response?.protocol === REPLAY_GOOGLE && Array.isArray(replay.blocks) ? replay.blocks : [];
      const parts = [];
      let pendingSignature = null;
      for (let index = 0; index < content.length; index++) {
        const block = content[index];
        const own = typeof native[index]?.signature === 'string' && native[index].signature ? native[index].signature : null;
        const signature = own ?? pendingSignature;
        const signed = part => { if (signature) { part.thoughtSignature = signature; pendingSignature = null; } return part; };
        if (block.type === 'text') { if (block.text) parts.push(signed({ text: block.text })); else if (own) pendingSignature = own; }
        else if (block.type === 'tool-call') {
          callNames.set(block.id, block.name);
          parts.push(signed({ functionCall: { name: block.name, args: toolArguments(block.arguments) } }));
        } else if (block.type === 'reasoning') {
          // Thought text is not replayed; a signature carried on it moves to the next replayed part.
          if (own) pendingSignature = own;
        } else throw new LlmError('Unsupported a6 assistant content', 'A6_UNSUPPORTED_CONTENT');
      }
      if (parts.length) contents.push({ role: 'model', parts });
    } else throw new LlmError('Unsupported a6 message role', 'A6_UNSUPPORTED_CONTENT');
  }
  mergeAdjacent(contents, 'parts');
  const generationConfig = { thinkingConfig: { includeThoughts: true } };
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options.stop?.length) generationConfig.stopSequences = options.stop;
  if (options.reasoningEffort !== undefined) throw new LlmError('a6 Gemini reasoning effort requires an explicit provider mapping', 'A6_UNSUPPORTED_REASONING_EFFORT');
  const body = { contents };
  if (system.length) body.systemInstruction = { parts: [{ text: system.join('\n\n') }] };
  if (options.tools?.length) body.tools = toolsOf(options.tools, 'google-generative-ai');
  body.generationConfig = generationConfig;
  return body;
}

/** Lossless projection for the text/reasoning/tool vocabulary exposed by the test tools. */
export function buildA6Request(options, api = 'openai-completions') {
  const protocol = normalizeA6Api(api);
  if (protocol === 'openai-responses') return buildResponses(options);
  if (protocol === 'google-generative-ai') return buildGoogle(options);
  return buildChatOrMessages(options, protocol);
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
  const anthropic = api === 'anthropic-messages';
  let input, output, read, write, reasoning, total;
  if (api === 'google-generative-ai') {
    // promptTokenCount includes cached content; candidatesTokenCount excludes thoughts, which are billed as output.
    input = count(raw.promptTokenCount);
    const candidates = count(raw.candidatesTokenCount);
    const thoughts = count(raw.thoughtsTokenCount);
    output = candidates === undefined && thoughts === undefined ? undefined : (candidates ?? 0) + (thoughts ?? 0);
    read = count(raw.cachedContentTokenCount);
    reasoning = thoughts;
    total = count(raw.totalTokenCount);
  } else {
    input = count(anthropic ? raw.input_tokens : raw.prompt_tokens ?? raw.input_tokens);
    output = count(anthropic ? raw.output_tokens : raw.completion_tokens ?? raw.output_tokens);
    read = count(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens);
    write = count(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens);
    reasoning = count(raw.completion_tokens_details?.reasoning_tokens ?? raw.output_tokens_details?.reasoning_tokens);
    total = count(raw.total_tokens);
  }
  if (read !== undefined) next.cacheReadTokens = read;
  if (write !== undefined) next.cacheWriteTokens = write;
  if (input !== undefined) {
    // DSH counts uncached input separately; OpenAI/Responses/Gemini prompt totals include cache hits.
    next.promptTokens = input;
  }
  if (anthropic && next.promptTokens !== undefined && (next.cacheReadTokens !== undefined || next.cacheWriteTokens !== undefined)) {
    next.inputTotalTokens = next.promptTokens + (next.cacheReadTokens ?? 0) + (next.cacheWriteTokens ?? 0);
    next.inputTokens = Math.max(0, next.inputTotalTokens - (next.cacheReadTokens ?? 0) - (next.cacheWriteTokens ?? 0));
  } else if (anthropic && next.promptTokens !== undefined) {
    next.inputTokens = next.promptTokens;
  }
  if (!anthropic && next.promptTokens !== undefined) {
    next.inputTotalTokens = next.promptTokens;
    next.inputTokens = Math.max(0, next.promptTokens - (next.cacheReadTokens ?? 0) - (next.cacheWriteTokens ?? 0));
  }
  if (output !== undefined) next.outputTokens = output;
  if (reasoning !== undefined) next.reasoningTokens = reasoning;
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

/** Redact the credential and cap an upstream error body at MAX_ERROR_BODY_BYTES (UTF-8). */
function redactBody(text, credential) {
  if (typeof text !== 'string') return '';
  let safe = credential ? text.split(credential).join('***') : text;
  const bytes = Buffer.from(safe, 'utf8');
  if (bytes.byteLength > MAX_ERROR_BODY_BYTES) safe = bytes.subarray(0, MAX_ERROR_BODY_BYTES).toString('utf8').replace(/\uFFFD+$/, '');
  return safe;
}
/** Read at most MAX_ERROR_BODY_BYTES of a failed response; timeouts and read failures yield null. */
async function readErrorBody(response, credential) {
  const stream = response?.body;
  let reader = null;
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), ERROR_BODY_TIMEOUT_MS); });
  try {
    if (stream && typeof stream.getReader === 'function') {
      reader = stream.getReader();
      const chunks = [];
      let size = 0;
      // Read past the cap by the key length so a key straddling the cut is redacted before truncation.
      const limit = MAX_ERROR_BODY_BYTES + credential.length;
      while (size < limit) {
        const next = await Promise.race([reader.read(), deadline]);
        if (!next || next.done) break;
        const value = next.value instanceof Uint8Array ? next.value : new Uint8Array(0);
        chunks.push(value.subarray(0, limit - size));
        size += value.byteLength;
      }
      if (!chunks.length) return '';
      return redactBody(Buffer.concat(chunks).toString('utf8'), credential);
    }
    if (typeof response?.text === 'function') {
      const text = await Promise.race([response.text(), deadline]);
      return text === null ? null : redactBody(String(text), credential);
    }
    return null;
  } catch { return null; } finally {
    clearTimeout(timer);
    if (reader) {
      // Do not await: a stalled peer must not hold the error path open.
      reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* a pending read keeps the lock; cancel settles it */ }
    }
  }
}
function httpError(status, requestId, body, extra = {}) {
  const excerpt = body ? body.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const error = new LlmError(`a6api HTTP ${status}${excerpt ? `: ${excerpt}` : ''}`, 'A6_HTTP_ERROR', {
    status,
    ...(requestId ? { requestId } : {}),
    ...(body !== null && body !== undefined ? { body } : {}),
    ...extra,
  });
  // LlmError.failure is frozen to known fields; expose the redacted body beside it.
  if (body !== null && body !== undefined) error.body = body;
  return error;
}
function terminalFailure(payload, status, raw, credential) {
  const code = payload?.error?.code ?? payload?.error?.type;
  // Provider error bodies can echo request headers; only a credential-redacted, capped copy is retained.
  return { code: code === 'specific_channel_rate_limited' ? 'A6_PLATFORM_QUOTA' : 'A6_STREAM_ERROR', message: 'a6api 流返回错误。', status, body: redactBody(raw, credential) };
}
function streamError(payload, raw, status, requestId, credential) {
  const failure = terminalFailure(payload, status, raw, credential);
  const error = new LlmError(failure.message, failure.code, { status, ...(requestId ? { requestId } : {}), body: failure.body });
  error.body = failure.body;
  return error;
}

/** @returns {(options: object, callbacks?: object) => AsyncIterable<object>} */
export function createA6Stream({ key, api = 'openai-completions', fetchImpl = globalThis.fetch }) {
  if (typeof key !== 'string' || !key.trim() || /[^\x21-\x7e]/.test(key.trim())) throw new TypeError('Invalid a6 key');
  const protocol = normalizeA6Api(api);
  if (typeof fetchImpl !== 'function') throw new TypeError('a6 fetch is unavailable');
  const credential = key.trim();
  return async function* stream(options, callbacks = {}) {
    if (protocol === 'google-generative-ai' && (typeof options.model !== 'string' || !options.model)) throw new LlmError('a6 Gemini request requires a model id', 'A6_UNSUPPORTED_CONTENT');
    const body = JSON.stringify(buildA6Request(options, protocol));
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new LlmError('a6api request exceeded the limit', 'A6_REQUEST_LIMIT');
    options.signal?.throwIfAborted();
    const auth = protocol === 'anthropic-messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' }
      : protocol === 'google-generative-ai' ? { 'x-goog-api-key': credential }
        : { authorization: `Bearer ${credential}` };
    const headers = { ...attributionHeaders(), 'content-type': 'application/json', accept: 'text/event-stream', ...auth };
    let response;
    try {
      response = await fetchImpl(`${ENDPOINT}${PROTOCOL_PATHS[protocol](options.model)}`, { method: 'POST', headers, body, signal: options.signal, redirect: 'error' });
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
        const errorBody = response.ok ? null : await readErrorBody(response, credential);
        consumed = errorBody !== null;
        throw httpError(response.status, requestId, errorBody, Number.isFinite(retry) && retry > 0 ? { providerRetryAfterMs: Math.min(retry, 300) * 1000 } : {});
      }
      const s = { usage: {}, reason: null, failure: null, terminal: false, sawContent: false, hasToolCall: false, blocks: new Map(), order: [], current: null, nextIndex: 0, callSeq: 0 };
      const { blocks } = s;
      const started = (index, type) => {
        if (!blocks.has(index)) { blocks.set(index, { type, text: '', arguments: '', name: '', id: '', signature: '' }); s.order.push(index); return true; }
        return false;
      };
      const checkIndex = index => {
        if (!Number.isSafeInteger(index) || index < 0 || index > MAX_BLOCK_INDEX) throw new LlmError('Invalid a6api output index', 'A6_INVALID_STREAM');
        return index;
      };
      const endBlock = (index, block) => {
        block.ended = true;
        if (block.type === 'tool-call') {
          if (!block.id || !block.name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
          const args = block.arguments || JSON.stringify(block.initialInput ?? {});
          if (s.reason !== 'max-tokens' && !block.incomplete) toolArguments(args);
          return { type: 'block-end', index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: args } };
        }
        return { type: 'block-end', index, block: { type: block.type, text: block.text } };
      };

      /* ---- Chat Completions ---- */
      function* onCompletions(payload) {
        const choice = payload.choices?.[0];
        const delta = choice?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning) {
          if (started(0, 'reasoning')) yield { type: 'block-start', index: 0, blockType: 'reasoning' };
          blocks.get(0).text += reasoning;
          s.sawContent = true;
          yield { type: 'reasoning-delta', index: 0, text: reasoning };
        }
        if (typeof delta?.content === 'string' && delta.content) {
          if (started(1, 'text')) yield { type: 'block-start', index: 1, blockType: 'text' };
          blocks.get(1).text += delta.content;
          s.sawContent = true;
          yield { type: 'text-delta', index: 1, text: delta.content };
        }
        if (delta?.function_call) throw new LlmError('Legacy a6api function_call is unsupported', 'A6_UNSUPPORTED_CONTENT');
        for (const call of delta?.tool_calls ?? []) {
          if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index > MAX_BLOCK_INDEX) throw new LlmError('Invalid a6api tool index', 'A6_INVALID_STREAM');
          const index = call.index + 2;
          if (started(index, 'tool-call')) yield { type: 'block-start', index, blockType: 'tool-call' };
          const block = blocks.get(index);
          if (call.id) block.id += call.id;
          if (call.function?.name) block.name += call.function.name;
          if (call.function?.arguments) block.arguments += call.function.arguments;
          s.sawContent = true;
          // Emit from the accumulated prefix once an identity arrives, retaining buffered arguments.
          if (block.id) {
            const argumentsDelta = block.arguments.slice(block.emittedArguments ?? 0);
            block.emittedArguments = block.arguments.length;
            yield { type: 'tool-call-delta', index, id: block.id, ...(block.name ? { name: block.name } : {}), argumentsDelta };
          }
        }
        if (choice?.finish_reason) { s.reason = finishReason(choice.finish_reason); s.terminal = true; }
      }

      /* ---- Anthropic Messages ---- */
      function* onMessages(payload) {
        const index = payload.index;
        if (payload.type === 'content_block_start') {
          const native = payload.content_block;
          const type = ['thinking', 'redacted_thinking'].includes(native?.type) ? 'reasoning' : native?.type === 'tool_use' ? 'tool-call' : native?.type === 'text' ? 'text' : null;
          if (!type || !Number.isSafeInteger(index) || index < 0 || index > MAX_BLOCK_INDEX || blocks.has(index)) throw new LlmError('a6api returned unsupported Messages content', 'A6_UNSUPPORTED_CONTENT');
          if (started(index, type)) yield { type: 'block-start', index, blockType: type };
          const block = blocks.get(index);
          if (native.type === 'redacted_thinking') {
            if (typeof native.data !== 'string') throw new LlmError('Invalid redacted a6api reasoning', 'A6_INVALID_STREAM');
            block.redacted = native.data;
            s.sawContent = true;
          }
          if (type === 'tool-call') {
            block.id = native.id;
            block.name = native.name;
            block.initialInput = native.input ?? {};
            if (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
            yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' };
            s.sawContent = true;
          } else {
            const initial = type === 'text' ? native.text : native.thinking;
            if (initial) { block.text += initial; s.sawContent = true; yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: initial }; }
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
            s.sawContent ||= Boolean(value);
            yield { type: delta.type === 'text_delta' ? 'text-delta' : 'reasoning-delta', index, text: value };
          } else throw new LlmError('Unsupported a6api content delta', 'A6_INVALID_STREAM');
        } else if (payload.type === 'message_delta' && payload.delta?.stop_reason) s.reason = finishReason(payload.delta.stop_reason);
        else if (payload.type === 'message_stop') { s.terminal = true; s.stop = true; }
      }

      /* ---- OpenAI Responses ---- */
      function* responsesText(index, type, value, part) {
        if (typeof value !== 'string') throw new LlmError('Invalid a6api text delta', 'A6_INVALID_STREAM');
        checkIndex(index);
        if (started(index, type)) yield { type: 'block-start', index, blockType: type };
        const block = blocks.get(index);
        if (block.type !== type || block.ended) throw new LlmError('a6api delta does not match its output item', 'A6_INVALID_STREAM');
        // Separate distinct reasoning summary parts within one reasoning item.
        if (part !== undefined && block.part !== undefined && part !== block.part && block.text) { block.text += '\n\n'; yield { type: 'reasoning-delta', index, text: '\n\n' }; }
        if (part !== undefined) block.part = part;
        if (!value) return;
        block.text += value;
        s.sawContent = true;
        yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: value };
      }
      function* responsesToolStart(index, item) {
        checkIndex(index);
        if (!started(index, 'tool-call')) throw new LlmError('a6api reused a Responses output index', 'A6_INVALID_STREAM');
        yield { type: 'block-start', index, blockType: 'tool-call' };
        const block = blocks.get(index);
        block.id = item.call_id;
        block.name = item.name;
        if (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
        s.sawContent = true;
        s.hasToolCall = true;
        yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' };
      }
      function* responsesToolArguments(index, full) {
        const block = blocks.get(index);
        if (typeof full !== 'string' || !full || full === block.arguments) return;
        // A final arguments string is authoritative; stream only the unseen suffix of a matching prefix.
        if (!full.startsWith(block.arguments)) throw new LlmError('a6api tool arguments diverged from their deltas', 'A6_INVALID_STREAM');
        const argumentsDelta = full.slice(block.arguments.length);
        block.arguments = full;
        yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta };
      }
      function* onResponses(payload, raw) {
        const index = payload.output_index;
        switch (payload.type) {
          case 'error':
          case 'response.failed':
            throw streamError(payload.type === 'error' ? payload : { error: payload.response?.error }, raw, response.status, requestId, credential);
          case 'response.output_text.delta':
            yield* responsesText(index, 'text', payload.delta);
            break;
          case 'response.reasoning_summary_text.delta':
            yield* responsesText(index, 'reasoning', payload.delta, `s${payload.summary_index ?? 0}`);
            break;
          case 'response.reasoning_text.delta':
            yield* responsesText(index, 'reasoning', payload.delta, `c${payload.content_index ?? 0}`);
            break;
          case 'response.output_item.added':
            if (payload.item?.type === 'function_call') {
              yield* responsesToolStart(index, payload.item);
              yield* responsesToolArguments(index, payload.item.arguments);
            }
            break;
          case 'response.function_call_arguments.delta': {
            const block = blocks.get(index);
            if (!block || block.type !== 'tool-call' || block.ended) throw new LlmError('a6api arguments delta has no tool call', 'A6_INVALID_STREAM');
            const value = payload.delta ?? '';
            if (typeof value !== 'string') throw new LlmError('Invalid a6api arguments delta', 'A6_INVALID_STREAM');
            block.arguments += value;
            yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: value };
            break;
          }
          case 'response.function_call_arguments.done':
            if (blocks.get(index)?.type === 'tool-call') yield* responsesToolArguments(index, payload.arguments);
            break;
          case 'response.output_item.done': {
            const item = payload.item ?? {};
            if (item.type === 'function_call') {
              if (!blocks.has(index)) yield* responsesToolStart(index, item);
              const block = blocks.get(index);
              if (block.type !== 'tool-call' || block.ended) throw new LlmError('a6api output item does not match its block', 'A6_INVALID_STREAM');
              yield* responsesToolArguments(index, item.arguments);
              block.incomplete = item.status === 'incomplete';
              yield endBlock(index, block);
            } else if (item.type === 'message' || item.type === 'reasoning') {
              // Fallback for relays that only send the finished item without deltas.
              if (!blocks.has(index)) {
                const type = item.type === 'message' ? 'text' : 'reasoning';
                const texts = item.type === 'message'
                  ? (item.content ?? []).filter(part => part?.type === 'output_text').map(part => part.text)
                  : [...(item.summary ?? []), ...(item.content ?? [])].filter(part => typeof part?.text === 'string').map(part => part.text);
                const text = texts.filter(value => typeof value === 'string' && value).join(type === 'text' ? '' : '\n\n');
                if (text) yield* responsesText(index, type, text);
              }
              const block = blocks.get(index);
              if (block && !block.ended) yield endBlock(index, block);
            }
            break;
          }
          case 'response.completed':
          case 'response.incomplete': {
            const result = payload.response ?? {};
            if (result.status === 'incomplete') {
              const why = result.incomplete_details?.reason;
              s.reason = why === 'max_output_tokens' ? 'max-tokens' : finishReason(why);
            } else if (result.status === undefined || result.status === 'completed') {
              s.reason = s.hasToolCall || (result.output ?? []).some(item => item?.type === 'function_call') ? 'tool-calls' : 'stop';
            } else throw streamError({ error: result.error }, raw, response.status, requestId, credential);
            s.terminal = true;
            s.stop = true;
            break;
          }
          default:
            // Some relays emit a bare `{error:{...}}` frame without a Responses event type.
            if (payload.error && payload.type === undefined) throw streamError(payload, raw, response.status, requestId, credential);
            break;
        }
      }

      /* ---- Google Generative AI ---- */
      const nextGoogleIndex = () => {
        if (s.nextIndex > MAX_BLOCK_INDEX) throw new LlmError('a6api returned too many Gemini parts', 'A6_INVALID_STREAM');
        return s.nextIndex++;
      };
      function* onGoogle(payload, raw) {
        const candidate = payload.candidates?.[0];
        if (!candidate && payload.promptFeedback?.blockReason) throw new LlmError('a6api refused the response', 'A6_REFUSED');
        for (const part of candidate?.content?.parts ?? []) {
          const signature = typeof part?.thoughtSignature === 'string' && part.thoughtSignature ? part.thoughtSignature : null;
          if (part?.functionCall) {
            const name = part.functionCall.name;
            const args = part.functionCall.args ?? {};
            if (typeof name !== 'string' || !name) throw new LlmError('a6api tool identity is missing', 'A6_INVALID_STREAM');
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new LlmError('a6api returned invalid tool arguments', 'A6_INVALID_TOOL_ARGUMENTS');
            const index = nextGoogleIndex();
            started(index, 'tool-call');
            const block = blocks.get(index);
            block.id = `gemini-call-${++s.callSeq}`;
            block.name = name;
            block.arguments = JSON.stringify(args);
            if (signature) block.signature = signature;
            s.current = null;
            s.sawContent = true;
            s.hasToolCall = true;
            yield { type: 'block-start', index, blockType: 'tool-call' };
            yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
          } else if (typeof part?.text === 'string') {
            const type = part.thought === true ? 'reasoning' : 'text';
            if (s.current === null || blocks.get(s.current).type !== type) {
              s.current = nextGoogleIndex();
              started(s.current, type);
              yield { type: 'block-start', index: s.current, blockType: type };
            }
            const block = blocks.get(s.current);
            if (signature) block.signature = signature;
            if (part.text) {
              block.text += part.text;
              s.sawContent = true;
              yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: s.current, text: part.text };
            }
          } else if (signature && s.current !== null) blocks.get(s.current).signature = signature;
          else if (!signature) throw new LlmError('a6api returned unsupported Gemini content', 'A6_UNSUPPORTED_CONTENT');
        }
        const why = candidate?.finishReason;
        if (why) {
          if (why === 'STOP') s.reason = s.hasToolCall ? 'tool-calls' : 'stop';
          else if (why === 'MAX_TOKENS') s.reason = 'max-tokens';
          else s.failure = { code: 'A6_STREAM_ERROR', message: `a6api Gemini 结束原因 ${String(why).slice(0, 64)}。`, status: response.status, body: redactBody(raw, credential) };
          s.terminal = true;
        }
      }

      const handlers = { 'openai-completions': onCompletions, 'anthropic-messages': onMessages, 'openai-responses': onResponses, 'google-generative-ai': onGoogle };
      const handle = handlers[protocol];
      for await (const data of frames(response.body, options.signal)) {
        if (data === '[DONE]') { s.terminal = true; break; }
        let payload;
        try { payload = JSON.parse(data); } catch { throw new LlmError('a6api sent invalid SSE JSON', 'A6_INVALID_STREAM'); }
        if (!payload || typeof payload !== 'object') throw new LlmError('a6api sent invalid SSE JSON', 'A6_INVALID_STREAM');
        if (protocol !== 'openai-responses' && (payload.error || payload.type === 'error')) { s.failure = terminalFailure(payload, response.status, data, credential); s.terminal = true; break; }
        const rawUsage = protocol === 'anthropic-messages' ? payload.usage ?? payload.message?.usage
          : protocol === 'openai-responses' ? (['response.completed', 'response.incomplete'].includes(payload.type) ? payload.response?.usage : undefined)
            : protocol === 'google-generative-ai' ? payload.usageMetadata
              : payload.usage;
        if (rawUsage) {
          s.usage = mergeUsage(s.usage, rawUsage, protocol);
          await callbacks.usage?.(exposedUsage(s.usage));
        }
        yield* handle(payload, data);
        if (s.stop) break;
      }
      consumed = true;
      if (!s.terminal || (!s.reason && !s.failure)) throw new LlmError('a6api stream ended without a complete response', 'A6_TRUNCATED_STREAM');
      if (!s.sawContent && !s.failure) throw new LlmError('a6api returned no content', 'A6_EMPTY_STREAM');
      for (const index of s.order) {
        const block = blocks.get(index);
        if (!block.ended) yield endBlock(index, block);
      }
      const nativeUsage = llmUsage(s.usage);
      if (nativeUsage.inputTokens !== undefined && nativeUsage.outputTokens !== undefined) yield { type: 'usage', usage: nativeUsage };
      const replayState = s.failure ? null
        : protocol === 'anthropic-messages' ? { response: { protocol: REPLAY_MESSAGES }, blocks: s.order.map(index => {
          const block = blocks.get(index);
          return block.type === 'reasoning' ? block.redacted !== undefined ? { type: 'redacted_thinking', data: block.redacted } : { type: 'thinking', signature: block.signature } : null;
        }) }
          : protocol === 'google-generative-ai' && s.order.some(index => blocks.get(index).signature) ? { response: { protocol: REPLAY_GOOGLE }, blocks: s.order.map(index => {
            const signature = blocks.get(index).signature;
            return signature ? { signature } : null;
          }) }
            : null;
      yield { type: 'finish', reason: s.failure ? { kind: 'error', failure: s.failure } : { kind: s.reason }, ...(replayState ? { replayState } : {}) };
    } finally {
      // frames() drains/cancels its reader; pre-consumption failures still own the response body.
      if (!consumed) try { await response.body?.cancel?.(); } catch { /* already closed or reader-owned */ }
    }
  };
}
