/**
 * The relay LLM adapter: relay channels become ordinary DSH provider routes.
 *
 * DSH's `llm` service owns the whole request pipeline (history, retries, watchdog, metering,
 * compaction, session storage). An adapter only maps a normalised request onto one upstream
 * protocol and maps the upstream stream back onto the harness chunk vocabulary, so this file is
 * deliberately just that mapping for the three protocols a6api speaks.
 *
 * It is a plain object rather than an `LlmAdapter` subclass: `LlmRuntime.registerAdapter` is
 * duck-typed (it only needs `providerInfo`, `providerRetryPolicy`, `resolveModel`, `prepareCall`
 * and `stream`), so the plugin does not depend on any adaptive private constructor. If a future
 * DSH changes that contract the registration fails loudly and the settings page still hands the
 * user a config snippet, which keeps the plugin usable instead of breaking the runtime.
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { sse } from './stream.js';
import { reasoningInfo, thinkingParams } from './traits.js';

const FORMAT_LABELS = { chat: 'Chat Completions', responses: 'Responses', messages: 'Messages' };
const MAX_TOKENS = 32_000;
const DEFAULT_CONTEXT = 128_000;

/** A route failure delivered in-band, exactly like a provider error. */
function* failure(message, code, status) {
  yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
  yield {
    type: 'finish',
    reason: { kind: 'error', failure: { message, code, ...(status === undefined ? {} : { status }) } },
  };
}

function* aborted(message) {
  yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
  yield { type: 'finish', reason: { kind: 'aborted', failure: { message, code: 'ABORTED' } } };
}

/* ── outgoing protocol mapping ─────────────────────────────────────────────── */

const textOf = content => content.filter(block => block.type === 'text').map(block => block.text).join('');

function systemPrompt(options) {
  const parts = [];
  if (typeof options.system === 'string' && options.system.trim()) parts.push(options.system);
  for (const message of options.messages) {
    if (message.role === 'system') {
      const text = textOf(message.content);
      if (text.trim()) parts.push(text);
    }
  }
  return parts.join('\n\n');
}

/** Split non-system messages into the shape each protocol expects. */
function conversation(options) {
  return options.messages.filter(message => {
    if (message.role === 'system' || message.role === 'developer') return false;
    return Boolean(message.content.length);
  });
}

function chatMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = textOf(message.content);
      if (text) out.push({ role: 'user', content: text });
      continue;
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content);
      const calls = message.content.filter(block => block.type === 'tool-call');
      out.push({
        role: 'assistant',
        content: text || null,
        ...calls.length ? {
          tool_calls: calls.map(call => ({
            id: String(call.id),
            type: 'function',
            function: { name: call.name, arguments: call.arguments || '{}' },
          })),
        } : {},
      });
      continue;
    }
    if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: String(message.toolCallId), content: textOf(message.content) || '(empty)' });
    }
  }
  return out;
}

function responsesInput(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = textOf(message.content);
      if (text) out.push({ role: 'user', content: [{ type: 'input_text', text }] });
      continue;
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content);
      if (text) out.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const call of message.content.filter(block => block.type === 'tool-call')) {
        out.push({ type: 'function_call', call_id: String(call.id), name: call.name, arguments: call.arguments || '{}' });
      }
      continue;
    }
    if (message.role === 'tool') {
      out.push({ type: 'function_call_output', call_id: String(message.toolCallId), output: textOf(message.content) || '(empty)' });
    }
  }
  return out;
}

function parseArguments(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function messagesTurns(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const blocks = [];
      const text = textOf(message.content);
      if (text) blocks.push({ type: 'text', text });
      if (blocks.length) out.push({ role: 'user', content: blocks });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks = [];
      const text = textOf(message.content);
      if (text) blocks.push({ type: 'text', text });
      for (const call of message.content.filter(block => block.type === 'tool-call')) {
        blocks.push({ type: 'tool_use', id: String(call.id), name: call.name, input: parseArguments(call.arguments) });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (message.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: String(message.toolCallId), content: textOf(message.content) || '(empty)' }],
      });
    }
  }
  return mergeTurns(out);
}

/** A provider rejects two consecutive same-role turns, so fold adjacent ones together. */
function mergeTurns(turns) {
  const out = [];
  for (const turn of turns) {
    const previous = out[out.length - 1];
    if (previous && previous.role === turn.role) previous.content.push(...turn.content);
    else out.push({ role: turn.role, content: [...turn.content] });
  }
  return out;
}

function toolsOf(options, api) {
  const tools = options.tools ?? [];
  if (!tools.length) return {};
  if (api === 'messages') {
    return { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) };
  }
  if (api === 'responses') {
    return { tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) };
  }
  return { tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };
}

/**
 * Build one upstream request for a route.
 * @param route - route spec: `{format, apiUrl, key, model, channelId}`
 * @param options - harness `GenerateOptions`
 */
function buildRequest(route, options) {
  const base = route.apiUrl.replace(/\/+$/, '');
  const key = route.channelId === undefined ? route.key : `${route.key}-${route.channelId}`;
  const common = { 'content-type': 'application/json', accept: 'text/event-stream', ...attributionHeaders() };
  const messages = conversation(options);
  const thinking = thinkingParams(route.format, options.reasoningEffort);
  const maxTokens = options.maxTokens ?? MAX_TOKENS;
  const stop = Array.isArray(options.stop) && options.stop.length ? { stop: options.stop } : {};

  if (route.format === 'messages') {
    const system = systemPrompt(options);
    return {
      url: `${base}/v1/messages`,
      headers: { ...common, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: {
        model: route.model,
        max_tokens: maxTokens,
        stream: true,
        ...(system ? { system } : {}),
        messages: messagesTurns(messages),
        ...toolsOf(options, 'messages'),
        ...thinking,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...stop,
      },
    };
  }
  if (route.format === 'responses') {
    const system = systemPrompt(options);
    return {
      url: `${base}/v1/responses`,
      headers: { ...common, authorization: `Bearer ${key}` },
      body: {
        model: route.model,
        stream: true,
        input: responsesInput(messages),
        ...(system ? { instructions: system } : {}),
        max_output_tokens: maxTokens,
        ...toolsOf(options, 'responses'),
        ...thinking,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...stop,
      },
    };
  }
  const system = systemPrompt(options);
  return {
    url: `${base}/v1/chat/completions`,
    headers: { ...common, authorization: `Bearer ${key}` },
    body: {
      model: route.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...chatMessages(messages)],
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...toolsOf(options, 'chat'),
      ...thinking,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...stop,
    },
  };
}

/* ── incoming stream mapping ───────────────────────────────────────────────── */

/**
 * Chunk emission state. Blocks are opened lazily on their first delta and closed in creation
 * order once the upstream stream ends, which is what `BlockAssembler` needs: each index is
 * opened once, every delta carries its own index, and `block-end` carries the complete block.
 */
class Emission {
  constructor() { this.index = 0; this.blocks = new Map(); }

  * open(kind, extras = {}) {
    const index = this.index++;
    const block = { kind, index, text: '', ...extras };
    this.blocks.set(index, block);
    yield { type: 'block-start', index, blockType: kind };
  }

  * text(text) {
    if (!text) return;
    let block = this.find('text');
    if (!block) {
      for (const chunk of this.open('text')) yield chunk;
      block = this.find('text');
    }
    block.text += text;
    yield { type: 'text-delta', index: block.index, text };
  }

  * reasoning(text) {
    if (!text) return;
    let block = this.find('reasoning');
    if (!block) {
      for (const chunk of this.open('reasoning')) yield chunk;
      block = this.find('reasoning');
    }
    block.text += text;
    yield { type: 'reasoning-delta', index: block.index, text };
  }

  /** One tool call identified by its provider-side key (index or id). */
  * tool(key, { id, name }) {
    let block = this.find('tool-call', key);
    if (!block) {
      for (const chunk of this.open('tool-call', { toolKey: key, id: String(id ?? ''), name: String(name ?? ''), args: '' })) yield chunk;
      block = this.find('tool-call', key);
    }
    if (id && !block.id) block.id = String(id);
    if (name && !block.name) block.name = String(name);
    return block;
  }

  * arguments(block, delta) {
    if (!delta) return;
    block.args += delta;
    yield { type: 'tool-call-delta', index: block.index, id: block.id || `call-${block.index}`, ...(block.name ? { name: block.name } : {}), argumentsDelta: delta };
  }

  find(kind, key) {
    for (const block of this.blocks.values()) {
      if (block.kind !== kind) continue;
      if (kind === 'tool-call' && block.toolKey !== key) continue;
      if (!block.closed) return block;
      if (kind !== 'tool-call') return undefined;
    }
    return undefined;
  }

  * closeAll() {
    for (const block of [...this.blocks.values()]) {
      if (block.closed) continue;
      block.closed = true;
      if (block.kind === 'text') yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } };
      else if (block.kind === 'reasoning') yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } };
      else yield { type: 'block-end', index: block.index, block: { type: 'tool-call', id: block.id || `call-${block.index}`, name: block.name, arguments: block.args || '{}' } };
    }
  }
}

const num = value => (Number.isFinite(value) && value >= 0 ? value : 0);

function usageOf({ input, output, cacheRead, cacheWrite, total }) {
  return {
    inputTokens: num(input),
    outputTokens: num(output),
    ...(total === undefined ? {} : { totalTokens: num(total) }),
    ...(cacheRead ? { cacheReadTokens: num(cacheRead) } : {}),
    ...(cacheWrite ? { cacheWriteTokens: num(cacheWrite) } : {}),
  };
}

/** Stop reasons shared by all three protocols. */
function stopOf(reason) {
  if (reason === 'length' || reason === 'max_tokens' || reason === 'incomplete') return 'max-tokens';
  if (reason === 'tool_calls' || reason === 'tool_use' || reason === 'function_call') return 'tool-calls';
  return 'stop';
}

async function* chatStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stop: null, error: null };
  for await (const { data } of sse(body)) {
    if (data === '[DONE]') break;
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    if (payload.error) {
      state.error = { message: payload.error.message ?? '上游返回错误', code: payload.error.type ?? payload.error.code };
      break;
    }
    if (payload.usage) {
      state.input = payload.usage.prompt_tokens ?? state.input;
      state.output = payload.usage.completion_tokens ?? state.output;
      state.cacheRead = payload.usage.prompt_tokens_details?.cached_tokens ?? state.cacheRead;
    }
    const choice = payload.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (delta.reasoning_content) yield* emit.reasoning(String(delta.reasoning_content));
    if (delta.reasoning) yield* emit.reasoning(String(delta.reasoning));
    if (typeof delta.content === 'string') yield* emit.text(delta.content);
    for (const call of delta.tool_calls ?? []) {
      const key = call.index ?? 0;
      const block = yield* emit.tool(key, { id: call.id, name: call.function?.name });
      yield* emit.arguments(block, call.function?.arguments ?? '');
    }
    if (choice.finish_reason) state.stop = stopOf(choice.finish_reason);
  }
  yield* emit.closeAll();
  yield { type: 'usage', usage: usageOf(state) };
  yield* terminal(state);
}

async function* responsesStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, stop: null, error: null };
  const open = new Map();
  for await (const { event, data } of sse(body)) {
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    const kind = payload.type ?? event;
    if (kind === 'response.output_text.delta') { yield* emit.text(payload.delta ?? ''); continue; }
    if (kind === 'response.reasoning_summary_text.delta' || kind === 'response.reasoning_text.delta') { yield* emit.reasoning(payload.delta ?? ''); continue; }
    if (kind === 'response.output_item.added' && payload.item?.type === 'function_call') {
      const block = yield* emit.tool(payload.item.id ?? payload.output_index ?? 0, { id: payload.item.call_id ?? payload.item.id, name: payload.item.name });
      open.set(payload.item.id ?? String(payload.output_index), block);
      yield* emit.arguments(block, payload.item.arguments ?? '');
      continue;
    }
    if (kind === 'response.function_call_arguments.delta') {
      let block = open.get(payload.item_id);
      if (!block) {
        block = yield* emit.tool(payload.item_id ?? payload.output_index ?? 0, { id: payload.item_id, name: undefined });
        open.set(payload.item_id ?? String(payload.output_index), block);
      }
      yield* emit.arguments(block, payload.delta ?? '');
      continue;
    }
    if (kind === 'response.completed' || kind === 'response.incomplete') {
      const usage = payload.response?.usage ?? {};
      state.input = usage.input_tokens ?? state.input;
      state.output = usage.output_tokens ?? state.output;
      state.cacheRead = usage.input_tokens_details?.cached_tokens ?? state.cacheRead;
      state.stop = kind === 'response.incomplete' ? 'max-tokens' : stopOf(payload.response?.status === 'incomplete' ? 'incomplete' : 'stop');
      continue;
    }
    if (kind === 'response.failed' || kind === 'error') {
      state.error = {
        message: payload.response?.error?.message ?? payload.message ?? '上游返回错误',
        code: payload.response?.error?.code ?? payload.code,
      };
      break;
    }
  }
  yield* emit.closeAll();
  yield { type: 'usage', usage: usageOf(state) };
  yield* terminal(state);
}

async function* messagesStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stop: null, error: null };
  const blocks = new Map();
  for await (const { data } of sse(body)) {
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    const kind = payload.type;
    if (kind === 'message_start') {
      state.input = payload.message?.usage?.input_tokens ?? state.input;
      state.output = payload.message?.usage?.output_tokens ?? state.output;
      state.cacheRead = payload.message?.usage?.cache_read_input_tokens ?? 0;
      state.cacheWrite = payload.message?.usage?.cache_creation_input_tokens ?? 0;
      continue;
    }
    if (kind === 'content_block_start') {
      const block = payload.content_block ?? {};
      const key = payload.index ?? 0;
      if (block.type === 'tool_use') {
        const target = yield* emit.tool(key, { id: block.id, name: block.name });
        blocks.set(key, target);
      } else if (block.type === 'thinking') blocks.set(key, 'reasoning');
      else blocks.set(key, 'text');
      continue;
    }
    if (kind === 'content_block_delta') {
      const delta = payload.delta ?? {};
      if (delta.type === 'text_delta') yield* emit.text(delta.text ?? '');
      else if (delta.type === 'thinking_delta') yield* emit.reasoning(delta.thinking ?? '');
      else if (delta.type === 'input_json_delta') {
        const block = blocks.get(payload.index);
        if (block) yield* emit.arguments(block, delta.partial_json ?? '');
      }
      continue;
    }
    if (kind === 'message_delta') {
      if (payload.usage) state.output = payload.usage.output_tokens ?? state.output;
      if (payload.delta?.stop_reason) state.stop = stopOf(payload.delta.stop_reason);
      continue;
    }
    if (kind === 'error') {
      state.error = { message: payload.error?.message ?? '上游返回错误', code: payload.error?.type };
      break;
    }
  }
  yield* emit.closeAll();
  yield { type: 'usage', usage: usageOf(state) };
  yield* terminal(state);
}

function* terminal(state) {
  if (state.error) {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: state.error.message, code: state.error.code ?? 'PROVIDER_ERROR' } } };
    return;
  }
  yield { type: 'finish', reason: { kind: state.stop ?? 'stop' } };
}

/* ── the adapter ───────────────────────────────────────────────────────────── */

export class RelayAdapter {
  /**
   * @param options - `{auth}`: relay credential resolver (`auth.resolve(siteId,'apiKey')`)
   */
  constructor({ auth }) {
    this.auth = auth;
    this.routes = new Map();
  }

  /** Replace the owned route set (called whenever the registry changes). */
  setRoutes(routes) {
    this.routes = routes;
  }

  /** Snapshot for one route, or null when this adapter does not own it. */
  routeOf(provider) {
    return this.routes.get(provider) ?? null;
  }

  providerInfo(provider) {
    const route = this.routeOf(provider);
    return { id: provider, name: route?.label ?? provider };
  }

  // Relay routes share one upstream: the provider default policy is the right one.
  providerRetryPolicy() {
    return undefined;
  }

  listModels(provider) {
    return Promise.resolve().then(() => {
      const route = this.routeOf(provider);
      if (!route) return [];
      return route.models.map(model => ({
        provider,
        id: model.id,
        name: model.name || model.id,
        inputModalities: ['text'],
      }));
    });
  }

  resolveModel(provider, model) {
    return Promise.resolve().then(() => {
      const route = this.routeOf(provider);
      if (!route) throw new Error(`中转站适配器不拥有提供商 "${provider}"`);
      const entry = route.models.find(item => item.id === model);
      const description = entry?.channelId === undefined ? undefined : `a6api 渠道 #${entry.channelId}`;
      return {
        provider,
        id: model,
        name: entry?.name || model,
        ...(description ? { description } : {}),
        inputModalities: ['text'],
        context: { contextWindow: entry?.contextWindow ?? DEFAULT_CONTEXT },
        ...(reasoningInfo(model, entry?.reasoning) ? { reasoning: reasoningInfo(model, entry?.reasoning) } : {}),
      };
    });
  }

  prepareCall(provider, model) {
    return this.resolveModel(provider, model).then(info => ({
      model: info,
      stream: options => this.stream(options),
    }));
  }

  /**
   * One model turn: map the request, stream it upstream, and translate the upstream events back
   * into harness chunks. Nothing here throws mid-stream — every failure ends as an error/aborted
   * `finish` chunk, which is the protocol's in-band error delivery.
   */
  async *stream(options) {
    const route = this.routeOf(options.provider);
    if (!route) { yield* failure(`中转站适配器不拥有提供商 "${options.provider}"`, 'NO_ADAPTER'); return; }
    const entry = route.models.find(item => item.id === options.model);
    if (!entry) { yield* failure(`中转站路由 "${route.label}" 没有模型 "${options.model}"`, 'UNKNOWN_MODEL'); return; }
    if (options.signal?.aborted) { yield* aborted('请求已被调用方取消'); return; }

    let key;
    try {
      key = await this.auth.resolve(route.siteId, 'apiKey');
    } catch (error) {
      yield* failure(`无法读取中转站 API Key：${error?.message ?? error}`, 'INVALID_CREDENTIAL');
      return;
    }
    if (!key) { yield* failure('未配置中转站 API Key，请先在「API 适配站点」中填写', 'MISSING_CREDENTIAL'); return; }

    const spec = buildRequest(
      { format: route.format, apiUrl: route.apiUrl, key, model: options.model, channelId: entry.channelId },
      options,
    );

    let response;
    try {
      response = await fetch(spec.url, {
        method: 'POST',
        headers: spec.headers,
        body: JSON.stringify(spec.body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) { yield* aborted('请求已被调用方取消'); return; }
      yield* failure(`无法连接中转站：${error?.message ?? error}`, 'TRANSPORT');
      return;
    }

    if (!response.ok || !response.body) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 600); } catch { /* body unreadable */ }
      const code = response.status === 401 || response.status === 403 ? 'AUTH'
        : response.status === 429 ? 'RATE_LIMIT'
          : response.status === 400 || response.status === 422 ? 'INVALID_REQUEST'
            : response.status >= 500 ? 'SERVER' : 'PROVIDER_ERROR';
      yield* failure(`上游 HTTP ${response.status}：${detail || '无响应体'}`, code, response.status);
      return;
    }

    try {
      if (route.format === 'messages') yield* messagesStream(response.body);
      else if (route.format === 'responses') yield* responsesStream(response.body);
      else yield* chatStream(response.body);
    } catch (error) {
      if (options.signal?.aborted) { yield* aborted('请求已被调用方取消'); return; }
      yield* failure(`读取上游流失败：${error?.message ?? error}`, 'TRANSPORT');
    }
  }
}

/** Display label for one (site, format) route. */
export function routeLabel(siteName, format) {
  return `${siteName} · ${FORMAT_LABELS[format] ?? format}`;
}
