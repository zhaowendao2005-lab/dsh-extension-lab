/**
 * One real DSH Agent per custom model run. This is a capability boundary, not
 * an operating-system container: only the supplied rooted tools are mounted.
 * No configured provider or deployment-wide tool registration is mutated.
 */
import { randomUUID } from 'node:crypto';
import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm';
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';

const DEFAULT_LIMITS = Object.freeze({ maxRequests: 24, maxSteps: 24, maxToolCalls: 96, maxTokens: 8192, maxDurationMs: 180_000 });
const SAFETY_PROMPT = [
  'Complete the supplied task using only the tools provided for this isolated test.',
  'All file paths are relative to the test directory. Only the test directory is available.',
  'Network, shell commands, external files, credentials, other sessions, and other agents are unavailable.',
  'Create the requested result as files in the test directory and describe the result when finished.',
].join('\n');
const USAGE_FIELDS = ['inputTokens', 'inputTotalTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];

function usageSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const field of USAGE_FIELDS) if (Number.isFinite(value[field]) && value[field] >= 0) result[field] = value[field];
  if (Array.isArray(value.streamUsageFrames)) result.streamUsageFrames = value.streamUsageFrames.slice(-32);
  return Object.keys(result).length ? result : null;
}
function sumUsage(values) {
  const result = {};
  for (const usage of values) if (usage) for (const field of USAGE_FIELDS) {
    if (usage[field] !== undefined) result[field] = (result[field] ?? 0) + usage[field];
  }
  return Object.keys(result).length ? result : null;
}
function publicFailure(error) {
  const raw = error?.failure ?? error;
  const code = typeof raw?.code === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(raw.code) ? raw.code : 'CUSTOM_SESSION_FAILED';
  return {
    code,
    // Do not publish raw adapter error bodies, stack traces, or credential-bearing URLs.
    message: code === 'CUSTOM_BOUNDARY' ? '隔离会话拒绝了额外上下文或工具，未发送该请求。' : `模型会话未完成（${code}）。`,
    ...(Number.isInteger(raw?.status) && raw.status >= 100 && raw.status <= 599 ? { status: raw.status } : {}),
  };
}
function limitSnapshot(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([name, fallback]) => {
    const selected = value[name] ?? fallback;
    if (!Number.isSafeInteger(selected) || selected < 1) throw new TypeError(`Invalid custom session limit: ${name}`);
    return [name, selected];
  }));
}
function boundaryError() { return new LlmError('Custom test request violated its context or tool boundary', 'CUSTOM_BOUNDARY'); }

/**
 * Do not rewrite loop-built GenerateOptions (DSH deliberately freezes them).
 * Instead fail before dispatch if a trusted Host plugin injected anything not
 * owned by this run. This also catches newly introduced required runtime
 * context that suppressRuntimeContext() is not allowed to remove.
 */
function checkRequest(request, { route, model, promptText, userMessage, toolSchemas, toolCallNames, maxTokens }) {
  if (request.provider !== route || request.model !== model || request.system !== undefined
    || !Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > maxTokens) throw boundaryError();
  const checkTools = tools => {
    for (const tool of tools ?? []) if (JSON.stringify(tool) !== toolSchemas.get(tool.name)) throw boundaryError();
  };
  checkTools(request.tools);
  checkTools(request.toolHistory?.tools);
  for (const update of request.toolHistory?.updates ?? []) checkTools(update.additions);
  let users = 0;
  let systems = 0;
  for (const message of request.messages ?? []) {
    if (message.role === 'system') {
      if (++systems !== 1 || message.content.some(block => block.type !== 'text') || message.content.map(block => block.text).join('') !== promptText) throw boundaryError();
      continue;
    }
    if (message.role === 'user') {
      if (++users !== 1 || message.id !== userMessage.id || message.content.some(block => block.type !== 'text')
        || message.content.map(block => block.text).join('') !== userMessage.content[0].text) throw boundaryError();
      continue;
    }
    if (message.role === 'assistant') {
      if (message.source?.provider !== route || message.source?.model !== model) throw boundaryError();
      for (const block of message.content) {
        if (!['text', 'reasoning', 'tool-call'].includes(block.type)) throw boundaryError();
        if (block.type === 'tool-call') {
          if (!toolSchemas.has(block.name)) throw boundaryError();
          toolCallNames.set(block.id, block.name);
        }
      }
      continue;
    }
    if (message.role === 'tool') {
      if (!toolSchemas.has(toolCallNames.get(message.toolCallId)) || message.content.some(block => block.type !== 'text')) throw boundaryError();
      continue;
    }
    throw boundaryError();
  }
  if (users !== 1 || systems !== 1) throw boundaryError();
}

/**
 * @param {object} ctx plugin-owned Cordis context with agents, tools, llm and systemPrompt.
 * @param {object} options sandbox.tools must be complete DSH ToolDefinition objects.
 * onRequest.start(meta) is awaited before entering any actual stream and may
 * return a durable execution id. metadata/usage/finish receive that same id.
 * Usage callbacks are cumulative snapshots for ONE request, never deltas.
 * stream(options,{metadata,usage}) is optional and normally an a6 closure.
 */
export async function executeSession(ctx, { sessionId, provider, model, prompt, systemPrompt = '', sandbox, signal, limits: proposedLimits, onEvent, onRequest = {}, stream }) {
  if (!sessionId || typeof sessionId !== 'string' || !provider || !model || typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('Invalid custom Agent request');
  if (!sandbox?.root || !Array.isArray(sandbox.tools) || sandbox.tools.length === 0) throw new TypeError('Custom Agent requires rooted tools');
  const limits = limitSnapshot(proposedLimits);
  const toolNames = new Set(sandbox.tools.map(tool => tool.name));
  if (toolNames.size !== sandbox.tools.length || toolNames.has('run_code')) throw new TypeError('Invalid custom tool set');
  const toolSchemas = new Map(sandbox.tools.map(({ name, description, parameters, deferLoading }) => [name, JSON.stringify({ name, description, parameters, ...(deferLoading === true ? { deferLoading } : {}) })]));
  const promptText = [SAFETY_PROMPT, systemPrompt].filter(Boolean).join('\n\n');
  const userMessage = createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
  // A custom stream must never resolve a configured provider's credentials or defaults.
  const route = stream ? `mit-custom-${randomUUID()}` : provider;
  const toolCallNames = new Map();
  const completedRequests = [];
  let handle;
  let agent;
  let timeout;
  let requestCount = 0;
  let toolCount = 0;
  let turns = 0;
  let steps = 0;
  let lastReason = null;
  let limited = null;
  let observerError = null;
  let runtimeError = null;
  let pendingEvents = Promise.resolve();
  const scopeDisposers = [];
  const markLimited = reason => { limited ??= reason; agent?.cancel({ kind: 'hook', reason: 'Custom test limit reached' }); };
  const stopForObserver = error => { observerError ??= error; agent?.cancel({ kind: 'hook', reason: 'Custom test recording failed' }); };
  const emit = event => {
    const next = pendingEvents.then(() => onEvent?.({ ...event, sessionId, at: event.at ?? Date.now() }));
    pendingEvents = next.catch(stopForObserver);
    return next;
  };
  const observe = event => { void emit(event).catch(() => {}); };
  const cancel = () => agent?.cancel({ kind: 'parent' });

  async function* observeRequest(request, next) {
    signal?.throwIfAborted();
    request.signal?.throwIfAborted();
    if (observerError) throw observerError;
    checkRequest(request, { route, model, promptText, userMessage, toolSchemas, toolCallNames, maxTokens: limits.maxTokens });
    if (requestCount >= limits.maxRequests) { markLimited('maxRequests'); throw new LlmError('Custom test request limit reached', 'CUSTOM_LIMIT'); }
    const startedAt = Date.now();
    const ordinal = ++requestCount;
    const localId = randomUUID();
    const allocatedId = await onRequest.start?.({ id: localId, sessionId, provider, model, ordinal, startedAt, turn: turns, step: steps, boundary: stream ? 'http-attempt' : 'dsh-attempt' });
    const id = typeof allocatedId === 'string' && allocatedId ? allocatedId : localId;
    let usage = null;
    let firstDeltaAt = null;
    let lastDeltaAt = null;
    const streamedBlocks = new Set();
    let finishReason = null;
    let failure = null;
    let ended = false;
    const identity = { requestId: null, httpStatus: null };
    const metadata = async facts => {
      if (typeof facts?.requestId === 'string' && facts.requestId) identity.requestId = facts.requestId;
      if (Number.isInteger(facts?.httpStatus) && facts.httpStatus >= 100 && facts.httpStatus <= 599) identity.httpStatus = facts.httpStatus;
      await onRequest.metadata?.(id, { ...identity });
    };
    const acceptUsage = async value => {
      const snapshot = usageSnapshot(value);
      if (!snapshot) return;
      const merged = { ...usage, ...snapshot };
      if (JSON.stringify(merged) === JSON.stringify(usage)) return;
      usage = merged;
      await onRequest.usage?.(id, usage);
    };
    try {
      // Keep an explicit unknown identity for native adapters. Never invent a provider request id.
      await metadata({ requestId: null, httpStatus: null });
      signal?.throwIfAborted();
      request.signal?.throwIfAborted();
      const source = stream ? stream(request, { metadata, usage: acceptUsage }) : next();
      for await (const chunk of source) {
        const now = Date.now();
        if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && chunk.text) {
          firstDeltaAt ??= now;
          lastDeltaAt = now;
          streamedBlocks.add(chunk.index);
          await emit({ type: chunk.type === 'text-delta' ? 'message' : 'reasoning', role: 'assistant', text: chunk.text, delta: true, index: chunk.index, executionId: id, at: now });
        } else if (chunk.type === 'block-end' && !streamedBlocks.has(chunk.index) && ['text', 'reasoning'].includes(chunk.block?.type) && chunk.block.text) {
          // Some adapters expose only a final block. Do not duplicate blocks already streamed.
          await emit({ type: chunk.block.type === 'text' ? 'message' : 'reasoning', role: 'assistant', text: chunk.block.text, delta: false, index: chunk.index, executionId: id, at: now });
        } else if (chunk.type === 'usage') await acceptUsage(chunk.usage);
        else if (chunk.type === 'finish') {
          finishReason = chunk.reason?.kind ?? null;
          if (finishReason === 'error' || finishReason === 'aborted') {
            failure = publicFailure({ failure: chunk.reason.failure });
            const providerFailure = chunk.reason.failure;
            if (providerFailure?.requestId || providerFailure?.status) await metadata({ requestId: providerFailure.requestId, httpStatus: providerFailure.status });
          }
          ended = true;
        }
        yield chunk;
      }
      if (!ended) throw new LlmError('Custom test stream ended without a terminal chunk', 'CUSTOM_TRUNCATED_STREAM');
    } catch (error) {
      failure = publicFailure(error);
      const providerFailure = error?.failure;
      if (providerFailure?.requestId || providerFailure?.status) await metadata({ requestId: providerFailure.requestId, httpStatus: providerFailure.status });
      throw error;
    } finally {
      const finishedAt = Date.now();
      const cancelled = signal?.aborted || request.signal?.aborted || finishReason === 'aborted';
      if (!ended && !failure && !cancelled) failure = publicFailure(new LlmError('Stream consumer ended before completion', 'CUSTOM_STREAM_INTERRUPTED'));
      completedRequests.push(usage);
      await onRequest.finish?.(id, {
        finishedAt,
        status: cancelled ? 'cancelled' : failure ? 'failed' : 'completed',
        finishReason,
        durationMs: Math.max(0, finishedAt - startedAt),
        firstTokenMs: firstDeltaAt === null ? null : Math.max(0, firstDeltaAt - startedAt),
        generationMs: firstDeltaAt === null ? null : Math.max(0, lastDeltaAt - firstDeltaAt),
        usage,
        ...(failure ? { error: failure } : {}),
      });
    }
  }

  try {
    signal?.throwIfAborted();
    timeout = setTimeout(() => markLimited('maxDurationMs'), limits.maxDurationMs);
    timeout.unref?.();
    await emit({ type: 'phase', phase: 'creating' });
    // Cordis hides services the plugin did not inject; read it explicitly instead of ctx.agents.
    const agents = ctx.get('agents');
    if (!agents) throw new TypeError('Agent service is unavailable in the plugin context');
    handle = await agents.create({
      sessionId,
      meta: { cwd: sandbox.root },
      agentOptions: { provider: route, model, maxTokens: limits.maxTokens },
      signal,
      setup(agentCtx, createdAgent) {
        agent = createdAgent;
        // Empty allow is valid DSH API: inherited/global tools disappear; scoped definitions remain.
        scopeDisposers.push(agentCtx.tools.restrict({ allow: [] }));
        scopeDisposers.push(agentCtx.tools.setExecutor(new NativeToolExecutor(agentCtx, () => 1)));
        for (const definition of sandbox.tools) scopeDisposers.push(agentCtx.tools.register(definition));
        scopeDisposers.push(agentCtx.tools.guard(execution => {
          if (execution.agent !== agent || !toolNames.has(execution.name)) return 'Tool is outside this custom test';
          if (++toolCount > limits.maxToolCalls) { markLimited('maxToolCalls'); return 'Custom test tool limit reached'; }
          return undefined;
        }));
        scopeDisposers.push(agentCtx.systemPrompt.section({ name: 'mit:custom-complete', order: 0, text: promptText, interpolate: false, complete: true }));
        scopeDisposers.push(agentCtx.systemPrompt.suppressRuntimeContext());
        // Remove assembly-only contexts. New required registrations are checked again at dispatch.
        scopeDisposers.push(agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
          const assembly = await next();
          return { ...assembly, contexts: [] };
        }));
        scopeDisposers.push(agentCtx.on('agent/pre-step', async (payload, next) => {
          if (payload.agent !== agent) return next();
          if (payload.modelSelection.provider !== route || payload.modelSelection.model !== model) throw boundaryError();
          if (payload.step > limits.maxSteps) { markLimited('maxSteps'); return { kind: 'reject' }; }
          const decision = await next();
          if (decision.kind !== 'enter') return decision;
          // Do not admit AGENTS, skill catalog, parent history, or a global plugin's injected files.
          if (decision.messages.some(message => message.id !== userMessage.id)) throw boundaryError();
          return decision;
        }));
        // llm/stream itself is not scope-filtered: explicit identity match is mandatory.
        scopeDisposers.push(agentCtx.on('llm/stream', (request, next) => request.sessionId === sessionId ? observeRequest(request, next) : next()));
        scopeDisposers.push(agentCtx.on('session/event', (session, event) => {
          if (session !== agent.session) return;
          const data = event.data;
          if (event.type === 'turn/start') { turns = data.turn; observe({ type: 'phase', phase: 'turn-start', turn: data.turn, seq: event.seq }); }
          else if (event.type === 'step/start') { steps = data.step; observe({ type: 'phase', phase: 'step-start', turn: data.turn, step: data.step, seq: event.seq }); }
          else if (event.type === 'turn/end') { lastReason = data.reason; observe({ type: 'phase', phase: 'turn-end', turn: data.turn, reason: data.reason.kind, seq: event.seq }); }
          else if (event.type === 'tool/call') {
            toolCallNames.set(data.callId, data.name);
            observe({ type: 'tool', phase: 'call', callId: data.callId, name: data.name, arguments: data.arguments, turn: data.turn, step: data.step, seq: event.seq });
          } else if (event.type === 'tool/result') {
            observe({ type: 'tool', phase: 'result', callId: data.message.toolCallId, name: toolCallNames.get(data.message.toolCallId) ?? '', content: data.message.content, isError: data.message.isError === true, turn: data.turn, step: data.step, seq: event.seq });
          }
        }));
        scopeDisposers.push(agentCtx.on('agent/error', payload => { if (payload.agent === agent) runtimeError ??= payload.error; }));
      },
    });
    agent = handle.agent;
    signal?.addEventListener('abort', cancel, { once: true });
    signal?.throwIfAborted();
    if (limited) agent.cancel({ kind: 'hook', reason: 'Custom test duration limit reached during creation' });
    else {
      await emit({ type: 'message', role: 'user', text: prompt, delta: false });
      await emit({ type: 'phase', phase: 'running' });
      if (limited || observerError) agent.cancel({ kind: 'hook', reason: 'Custom test could not continue' });
      else agent.followup(userMessage);
    }
    await agent.whenIdle();
    await pendingEvents;
    if (observerError) throw observerError;
  } catch (error) {
    runtimeError ??= error;
    agent?.cancel({ kind: 'hook', reason: 'Custom test execution ended' });
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    // Never release a6 token ownership until this await drains streams/tools and persistence.
    if (handle) {
      try { await handle.dispose(); } catch (error) { runtimeError ??= error; }
    }
    for (const dispose of scopeDisposers.reverse()) {
      try { dispose(); } catch (error) { runtimeError ??= error; }
    }
    await pendingEvents;
  }
  let outcome;
  if (signal?.aborted) outcome = 'cancelled';
  else if (limited || lastReason?.kind === 'max-tokens') outcome = 'limited';
  else if (runtimeError || observerError || lastReason?.kind !== 'completed') outcome = 'failed';
  else outcome = 'completed';
  const failure = runtimeError || observerError || lastReason?.error;
  if (outcome === 'failed') await emit({ type: 'error', ...publicFailure(failure) });
  await emit({ type: 'phase', phase: 'finished', outcome });
  return { sessionId, outcome, reason: limited ?? lastReason?.kind ?? (signal?.aborted ? 'aborted' : 'error'), usage: sumUsage(completedRequests), requestCount, turns, steps, ...(outcome === 'failed' ? { error: publicFailure(failure) } : {}) };
}
