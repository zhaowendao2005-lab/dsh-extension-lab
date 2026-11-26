import type { CustomErrorDetail, CustomEvent, CustomRequestView, CustomRetryTrail, CustomRunSummary } from '../types';

/**
 * Projection of one custom run into a step-structured chat flow.
 *
 * Shaped after what the Host actually persists (see `backend/custom/coordinator.js`):
 * - every Agent step is one model request; its events carry that request's id as `executionId`;
 * - each step opens with a whitespace-only assistant delta that is pure noise;
 * - tool `arguments` are JSON-stringified twice and clipped at 32 000 chars, so they may be cut mid-string;
 * - tool `content` is an MCP array `[{type:'text', text:'<json>'}]`, also clipped;
 * - `sandbox_file` results have no callId and describe a write / declare-output by path;
 * - requests may exist without events (failed before streaming, or events truncated) and vice versa.
 * Unknown values stay `null`; nothing here invents usage, cost or success.
 */

export type FlowStepStatus = 'waiting' | 'streaming' | 'tooling' | 'done' | 'failed' | 'cancelled' | 'unknown';
export type FlowToolStatus = 'running' | 'ok' | 'error' | 'unknown';

export interface FlowTextPart { kind: 'text' | 'reasoning'; id: string; text: string; streaming: boolean; at: number }
export interface FlowFileNote { type: string; path: string; size: number | null }
export interface FlowToolPart {
  kind: 'tool';
  id: string;
  callId: string;
  name: string;
  /** Tool name without the `sandbox_` prefix, used to pick a dedicated card. */
  short: string;
  status: FlowToolStatus;
  args: Record<string, unknown> | null;
  argsRaw: string | null;
  /** True when the Host clipped the arguments and only a lenient prefix could be recovered. */
  argsClipped: boolean;
  result: unknown;
  resultText: string | null;
  resultClipped: boolean;
  isError: boolean;
  file: FlowFileNote | null;
  startedAt: number;
  endedAt: number | null;
}
export interface FlowErrorPart { kind: 'error'; id: string; code: string | null; message: string; status: number | null; requestId: string | null; detail: CustomErrorDetail | null; hint: string | null; at: number }
export type FlowPart = FlowTextPart | FlowToolPart | FlowErrorPart;

export interface FlowStepMetrics {
  ttftMs: number | null;
  tokensPerSecond: number | null;
  e2eMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheRate: number | null;
  cost: number | null;
  currency: string | null;
}
export interface FlowStep {
  id: string;
  /** Host step number inside the turn; falls back to the order of appearance. */
  number: number;
  executionId: string | null;
  request: CustomRequestView | null;
  trigger: string | null;
  parts: FlowPart[];
  status: FlowStepStatus;
  at: number;
  metrics: FlowStepMetrics | null;
  /** Built from a request alone: its events were truncated or never streamed. */
  requestOnly: boolean;
}
export interface FlowUsage { requests: number; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cost: number | null; currency: string | null }
export interface FlowTurn {
  id: string;
  number: number;
  /** 0 for the first instruction; n for the n-th `continue` of the same session. */
  continuation: number;
  user: { id: string; text: string; at: number } | null;
  steps: FlowStep[];
  errors: FlowErrorPart[];
  usage: FlowUsage | null;
  ended: boolean;
}
export interface FlowRun {
  turns: FlowTurn[];
  retries: CustomRetryTrail[];
  live: boolean;
  /** The run is still active and the last step has not produced any visible output yet. */
  pending: boolean;
  empty: boolean;
}

const ACTIVE = new Set(['queued', 'preparing', 'running', 'tooling', 'validating']);
const known = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = (values: (number | null)[]): number | null => values.length && values.every(value => value !== null) ? values.reduce<number>((total, value) => total + (value as number), 0) : null;

/** Unescape a JSON string body that may be cut anywhere; stops at the first unescaped quote. */
function unescapePartial(source: string, from = 0): { value: string; closed: boolean; end: number } {
  let value = '';
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') return { value, closed: true, end: index + 1 };
    if (char !== '\\') { value += char; continue; }
    const next = source[index + 1];
    if (next === undefined) break;
    index += 1;
    switch (next) {
      case 'n': value += '\n'; break;
      case 't': value += '\t'; break;
      case 'r': value += '\r'; break;
      case 'b': value += '\b'; break;
      case 'f': value += '\f'; break;
      case 'u': {
        const hex = source.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value, closed: false, end: source.length };
        value += String.fromCharCode(parseInt(hex, 16));
        index += 4;
        break;
      }
      default: value += next;
    }
  }
  return { value, closed: false, end: source.length };
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

/** Peel JSON layers (string → string → object) until the value stops being a JSON string. */
function peel(raw: string): { value: unknown; text: string; clipped: boolean } {
  let text = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    const parsed = tryParse(text);
    if (parsed.ok) {
      if (typeof parsed.value === 'string') { text = parsed.value; continue; }
      return { value: parsed.value, text, clipped: false };
    }
    // A clipped JSON string literal: recover its prefix and keep peeling.
    if (text.startsWith('"')) { text = unescapePartial(text, 1).value; continue; }
    return { value: null, text, clipped: true };
  }
  return { value: null, text, clipped: true };
}

/** Recover top-level string/number fields from a clipped JSON object text. */
function lenientObject(text: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const pattern = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const key = match[1];
    const start = pattern.lastIndex;
    if (text[start] === '"') {
      const field = unescapePartial(text, start + 1);
      out[key] = field.value;
      pattern.lastIndex = field.end;
      if (!field.closed) break;
    } else {
      const literal = /^-?\d+(?:\.\d+)?|^true|^false|^null/.exec(text.slice(start));
      if (literal) out[key] = JSON.parse(literal[0]);
    }
  }
  return Object.keys(out).length ? out : null;
}

function decodeArgs(raw: string | null | undefined): { args: Record<string, unknown> | null; text: string | null; clipped: boolean } {
  if (typeof raw !== 'string' || !raw) return { args: null, text: null, clipped: false };
  const peeled = peel(raw);
  if (peeled.value && typeof peeled.value === 'object' && !Array.isArray(peeled.value)) return { args: peeled.value as Record<string, unknown>, text: peeled.text, clipped: false };
  return { args: lenientObject(peeled.text), text: peeled.text, clipped: peeled.clipped };
}

/** MCP content → joined text → JSON when possible. */
function decodeResult(raw: string | null | undefined, fallback: string | null | undefined): { value: unknown; text: string | null; clipped: boolean } {
  const source = typeof raw === 'string' && raw ? raw : typeof fallback === 'string' && fallback ? fallback : null;
  if (!source) return { value: null, text: null, clipped: false };
  const peeled = peel(source);
  let text: string;
  let clipped = peeled.clipped;
  if (Array.isArray(peeled.value)) {
    text = peeled.value.map(item => item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : '').join('\n');
  } else if (peeled.value !== null) {
    return { value: peeled.value, text: peeled.text, clipped };
  } else {
    // A clipped MCP array: recover the first text item's prefix.
    const marker = /"text"\s*:\s*"/.exec(peeled.text);
    text = marker ? unescapePartial(peeled.text, marker.index + marker[0].length).value : peeled.text;
    clipped = true;
  }
  const inner = tryParse(text);
  if (inner.ok) return { value: inner.value, text, clipped };
  const lenient = text.trimStart().startsWith('{') ? lenientObject(text) : null;
  return { value: lenient ?? text, text, clipped: clipped || Boolean(lenient) };
}

/** One actionable Chinese sentence for the failures the Host actually records. */
export function errorHint(code: string | null | undefined, status: number | null | undefined, message: string | null | undefined): string | null {
  const text = `${code ?? ''} ${message ?? ''}`;
  if (status === 429 || /429|限流|rate.?limit/i.test(text)) return '上游限流或容量不足：降低并发后重试；持续出现可切换固定商家。';
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid.?api.?key/i.test(text)) return 'Key 无效或无权限：检查测试令牌是否仍可用。';
  if (/model_not_available|model.?not.?found|不提供此模型/i.test(text)) return '该渠道不提供此模型：更换渠道或从可用渠道重新创建。';
  if (code === 'timeout' || /超时|timed? ?out/i.test(text)) return '超过单模型时限：可调大超时后重试。';
  if (/A6_STREAM_ERROR|流返回错误/.test(text)) return '流在中途返回错误：会话若已持久化可「继续会话」，否则「从头重试」。';
  if (status !== null && status !== undefined && status >= 500) return '上游服务异常：稍后重试或切换商家。';
  if (/pin-unverified|固定渠道未读回/.test(text)) return '固定渠道未生效，未发送请求：检查渠道固定状态后重试。';
  return null;
}

function stepMetrics(request: CustomRequestView | null): FlowStepMetrics | null {
  if (!request) return null;
  const input = known(request.usage.inputTotalTokens) ?? known(request.usage.inputTokens);
  const cacheRead = known(request.usage.cacheReadTokens);
  return {
    ttftMs: known(request.firstDeltaMs) ?? known(request.metrics.ttftMs),
    tokensPerSecond: known(request.metrics.modelTokensPerSecond) ?? known(request.metrics.endToEndTokensPerSecond),
    e2eMs: known(request.metrics.e2eMs) ?? (known(request.startedAt) !== null && known(request.finishedAt) !== null ? Math.max(0, (request.finishedAt as number) - (request.startedAt as number)) : null),
    inputTokens: input,
    outputTokens: known(request.usage.outputTokens),
    cacheRate: cacheRead !== null && input ? Math.min(1, cacheRead / input) : null,
    cost: known(request.usage.cost),
    currency: request.usage.currency,
  };
}

function requestError(request: CustomRequestView): FlowErrorPart | null {
  const error = request.error;
  if (!error) return null;
  const record = typeof error === 'string' ? { message: error } : error;
  const status = known(record.status) ?? known(request.httpStatus);
  const detail = typeof error === 'string' ? null : error.detail ?? null;
  return { kind: 'error', id: `${request.id}:error`, code: (typeof error === 'string' ? null : error.code) ?? null, message: record.message ?? '请求失败', status, requestId: request.requestId ?? (typeof detail?.requestId === 'string' ? detail.requestId : null), detail, hint: errorHint(typeof error === 'string' ? null : error.code, status, record.message), at: request.finishedAt ?? request.startedAt ?? 0 };
}

function eventError(event: CustomEvent): FlowErrorPart {
  const detail = event.detail ?? null;
  const status = known(detail?.status);
  return { kind: 'error', id: event.id, code: event.code ?? null, message: event.text ?? '执行错误', status, requestId: typeof detail?.requestId === 'string' ? detail.requestId : null, detail, hint: errorHint(event.code, status, event.text), at: event.at };
}

function stepStatus(step: FlowStep, live: boolean, last: boolean): FlowStepStatus {
  const request = step.request;
  const openTool = step.parts.some(part => part.kind === 'tool' && part.status === 'running');
  if (request) {
    if (request.status === 'running') {
      if (openTool) return 'tooling';
      return request.timing?.firstOutputAt || known(request.firstDeltaMs) !== null || step.parts.some(part => part.kind !== 'error') ? 'streaming' : 'waiting';
    }
    if (request.status === 'completed') return openTool && live && last ? 'tooling' : 'done';
    if (request.status === 'failed') return 'failed';
    return 'cancelled';
  }
  if (step.parts.some(part => part.kind === 'error')) return 'failed';
  if (live && last) return openTool ? 'tooling' : 'streaming';
  return step.parts.length ? 'done' : 'unknown';
}

function turnUsage(steps: FlowStep[]): FlowUsage | null {
  const requests = steps.map(step => step.request).filter((request): request is CustomRequestView => Boolean(request));
  if (!requests.length) return null;
  const currency = requests.every(request => request.usage.currency === requests[0].usage.currency) ? requests[0].usage.currency : null;
  const costs = requests.map(request => known(request.usage.cost));
  return {
    requests: requests.length,
    inputTokens: sum(requests.map(request => known(request.usage.inputTotalTokens) ?? known(request.usage.inputTokens))),
    outputTokens: sum(requests.map(request => known(request.usage.outputTokens))),
    cacheReadTokens: sum(requests.map(request => known(request.usage.cacheReadTokens))),
    cost: currency ? sum(costs) : null,
    currency,
  };
}

/**
 * Project persisted events and requests into turns → steps → parts.
 * @param events - bounded Host events (oldest may be truncated).
 * @param requests - bounded Host request rows, already billing-projected by the Host.
 * @param summary - the run summary; decides liveness and carries the retry trail.
 */
export function projectRun(events: CustomEvent[], requests: CustomRequestView[], summary: CustomRunSummary): FlowRun {
  const live = ACTIVE.has(summary.phase);
  const turns: FlowTurn[] = [];
  const byRequest = new Map<string, CustomRequestView>();
  for (const request of requests) {
    byRequest.set(request.id, request);
    if (request.executionId) byRequest.set(request.executionId, request);
  }
  const usedRequests = new Set<CustomRequestView>();
  const tools = new Map<string, FlowToolPart>();
  const texts = new Map<string, FlowTextPart>();
  let pendingUser: FlowTurn['user'] = null;
  let turn: FlowTurn | null = null;
  let step: FlowStep | null = null;
  let userCount = 0;

  const openTurn = (number: number, at: number): FlowTurn => {
    const next: FlowTurn = { id: `turn-${number}-${at}`, number, continuation: Math.max(0, userCount - 1), user: pendingUser, steps: [], errors: [], usage: null, ended: false };
    pendingUser = null;
    turns.push(next);
    turn = next;
    step = null;
    return next;
  };
  const ensureTurn = (at: number): FlowTurn => turn && !turn.ended ? turn : openTurn((turns.at(-1)?.number ?? 0) + 1, at);
  const openStep = (number: number | null, executionId: string | null, at: number): FlowStep => {
    const owner = ensureTurn(at);
    const request = executionId ? byRequest.get(executionId) ?? null : null;
    if (request) usedRequests.add(request);
    const next: FlowStep = { id: `step-${owner.number}-${owner.steps.length + 1}-${at}`, number: number ?? owner.steps.length + 1, executionId, request, trigger: request?.trigger ?? null, parts: [], status: 'unknown', at, metrics: null, requestOnly: false };
    owner.steps.push(next);
    step = next;
    return next;
  };
  /** The step an event belongs to: its executionId decides, the current step is the fallback. */
  const stepFor = (event: CustomEvent): FlowStep => {
    const executionId = event.executionId ?? null;
    const current = step as FlowStep | null;
    if (current && (!executionId || current.executionId === executionId)) return current;
    if (current && !current.executionId && executionId) {
      current.executionId = executionId;
      const request = byRequest.get(executionId) ?? null;
      if (request && !usedRequests.has(request)) { current.request = request; current.trigger = request.trigger ?? null; usedRequests.add(request); }
      return current;
    }
    if (executionId) {
      for (const candidate of (turn as FlowTurn | null)?.steps ?? []) if (candidate.executionId === executionId) return candidate;
    }
    return openStep(Number.isInteger(event.step) ? event.step as number : null, executionId, event.at);
  };

  for (const event of events) {
    switch (event.type) {
      case 'phase': {
        if (event.phase === 'turn-start') openTurn(Number.isInteger(event.turn) ? event.turn as number : (turns.at(-1)?.number ?? 0) + 1, event.at);
        else if (event.phase === 'step-start') openStep(Number.isInteger(event.step) ? event.step as number : null, null, event.at);
        else if (event.phase === 'turn-end' && turn) { (turn as FlowTurn).ended = true; step = null; }
        break;
      }
      case 'message': {
        if (event.role === 'user') {
          userCount += 1;
          pendingUser = { id: event.id, text: event.text ?? '', at: event.at };
          // A user message that never reaches turn-start still shows up, as its own (possibly empty) turn.
          if (turn && !(turn as FlowTurn).ended && !(turn as FlowTurn).steps.length && !(turn as FlowTurn).user) { (turn as FlowTurn).user = pendingUser; pendingUser = null; }
          else if (turn) (turn as FlowTurn).ended = true;
          break;
        }
        appendText(event, 'text');
        break;
      }
      case 'reasoning': appendText(event, 'reasoning'); break;
      case 'tool': {
        if (event.phase === 'call') {
          const owner = stepFor(event);
          const decoded = decodeArgs(event.arguments);
          const name = event.name ?? 'tool';
          const part: FlowToolPart = { kind: 'tool', id: event.id, callId: event.callId ?? event.id, name, short: name.replace(/^sandbox_/, ''), status: 'running', args: decoded.args, argsRaw: decoded.text, argsClipped: decoded.clipped, result: null, resultText: null, resultClipped: false, isError: false, file: null, startedAt: event.at, endedAt: null };
          owner.parts.push(part);
          tools.set(part.callId, part);
          break;
        }
        if (event.phase !== 'result') break;
        if (!event.callId && event.name === 'sandbox_file') {
          attachFile(event);
          break;
        }
        const part = event.callId ? tools.get(event.callId) : undefined;
        const decoded = decodeResult(event.content, event.text);
        if (part) {
          Object.assign(part, { status: event.isError ? 'error' : 'ok', result: decoded.value, resultText: decoded.text, resultClipped: decoded.clipped, isError: event.isError === true, endedAt: event.at });
        } else {
          // A result whose call was truncated away still deserves a card.
          const name = event.name ?? 'tool';
          stepFor(event).parts.push({ kind: 'tool', id: event.id, callId: event.callId ?? event.id, name, short: name.replace(/^sandbox_/, ''), status: event.isError ? 'error' : 'ok', args: null, argsRaw: null, argsClipped: false, result: decoded.value, resultText: decoded.text, resultClipped: decoded.clipped, isError: event.isError === true, file: null, startedAt: event.at, endedAt: event.at });
        }
        break;
      }
      case 'error': {
        const part = eventError(event);
        if (step) (step as FlowStep).parts.push(part);
        else ensureTurn(event.at).errors.push(part);
        break;
      }
    }
  }
  if (pendingUser) openTurn((turns.at(-1)?.number ?? 0) + 1, (pendingUser as { at: number }).at);

  // Requests without matching events: failed before streaming, or their events were truncated.
  for (const request of requests) {
    if (usedRequests.has(request)) continue;
    const at = request.startedAt ?? 0;
    let owner = turns.find(item => item.number === request.turn) ?? null;
    if (!owner) owner = [...turns].reverse().find(item => (item.steps[0]?.at ?? item.user?.at ?? Infinity) <= at) ?? turns[0] ?? null;
    if (!owner) { const created: FlowTurn = { id: `turn-req-${request.id}`, number: request.turn ?? 1, continuation: 0, user: null, steps: [], errors: [], usage: null, ended: true }; turns.push(created); owner = created; }
    const error = requestError(request);
    owner.steps.push({ id: `step-req-${request.id}`, number: request.step ?? owner.steps.length + 1, executionId: request.executionId ?? request.id, request, trigger: request.trigger ?? null, parts: error ? [error] : [], status: 'unknown', at, metrics: null, requestOnly: true });
    owner.steps.sort((left, right) => left.at - right.at);
  }

  // Finalize: drop blank text, close streaming flags, compute status and metrics.
  const lastTurn = turns.at(-1);
  const lastStep = lastTurn?.steps.at(-1);
  for (const item of turns) {
    for (const entry of item.steps) {
      entry.parts = entry.parts.filter(part => part.kind !== 'text' && part.kind !== 'reasoning' ? true : part.text.trim() !== '');
      const isLast = entry === lastStep;
      const streaming = live && isLast && (entry.request ? entry.request.status === 'running' : true);
      const lastText = [...entry.parts].reverse().find(part => part.kind === 'text' || part.kind === 'reasoning') as FlowTextPart | undefined;
      for (const part of entry.parts) {
        if (part.kind === 'text' || part.kind === 'reasoning') part.streaming = streaming && part === lastText && entry.parts.at(-1) === part;
        if (part.kind === 'tool' && part.status === 'running' && !(live && isLast)) part.status = 'unknown';
      }
      // A failed request whose error never surfaced as an event still shows why.
      if (!entry.requestOnly && entry.request?.status === 'failed' && !entry.parts.some(part => part.kind === 'error')) {
        const error = requestError(entry.request);
        if (error) entry.parts.push(error);
      }
      entry.status = stepStatus(entry, live, isLast);
      entry.metrics = stepMetrics(entry.request);
    }
    item.usage = turnUsage(item.steps);
  }
  const visible = lastStep ? lastStep.parts.length > 0 : false;
  return {
    turns,
    retries: summary.retryHistory ?? [],
    live,
    pending: live && !visible,
    empty: !turns.length && !(summary.retryHistory?.length),
  };

  function appendText(event: CustomEvent, kind: 'text' | 'reasoning'): void {
    const owner = stepFor(event);
    const key = event.executionId && Number.isInteger(event.index) ? `${kind}:${event.executionId}:${event.index}` : null;
    const text = event.text ?? '';
    const existing = key ? texts.get(key) : undefined;
    if (existing) { existing.text += text; return; }
    const previous = owner.parts.at(-1);
    if (!key && previous && previous.kind === kind) { previous.text += text; return; }
    const part: FlowTextPart = { kind, id: event.id, text, streaming: false, at: event.at };
    owner.parts.push(part);
    if (key) texts.set(key, part);
  }

  function attachFile(event: CustomEvent): void {
    const decoded = decodeResult(null, event.text);
    const value = decoded.value && typeof decoded.value === 'object' ? decoded.value as Record<string, unknown> : null;
    const path = typeof value?.path === 'string' ? value.path : null;
    if (!path) return;
    const note: FlowFileNote = { type: typeof value?.type === 'string' ? value.type : 'write', path, size: known(value?.size) };
    const wanted = note.type === 'declare-output' ? 'declareOutput' : 'writeFile';
    const owners = (turn as FlowTurn | null)?.steps ?? [];
    for (let index = owners.length - 1; index >= 0; index -= 1) {
      const match = [...owners[index].parts].reverse().find((part): part is FlowToolPart => part.kind === 'tool' && part.short === wanted && part.args?.path === path && !part.file);
      if (match) { match.file = note; return; }
    }
  }
}

/** Typed accessors for decoded tool payloads. */
export const field = (value: unknown, key: string): unknown => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
export const textField = (value: unknown, key: string): string | null => { const item = field(value, key); return typeof item === 'string' ? item : null; };
export const numberField = (value: unknown, key: string): number | null => known(field(value, key));
