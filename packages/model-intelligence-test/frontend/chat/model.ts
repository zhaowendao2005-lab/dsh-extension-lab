import type { CustomEvent, CustomRequestView, CustomRunSummary } from '../types';
import { reasoningText } from './rows/reasoning-text';

/**
 * Chat rows the Host events project into. The shape mirrors DSH's own chat
 * rows closely enough that the vendored renderers below can draw them without
 * inventing a new visual language: one row per user message, assistant text
 * block, reasoning block, tool call, or failure.
 */
export interface ChatUserRow {
  kind: 'user';
  id: string;
  text: string;
  at: number;
}

export interface ChatAssistantRow {
  kind: 'assistant';
  id: string;
  text: string;
  running: boolean;
  at: number;
}

export interface ChatReasoningRow {
  kind: 'reasoning';
  id: string;
  text: string;
  running: boolean;
  at: number;
}

export interface ChatToolRow {
  kind: 'tool';
  id: string;
  callId: string;
  name: string;
  status: 'running' | 'ok' | 'error';
  arguments: string | null;
  content: string | null;
  at: number;
}

export interface ChatErrorRow {
  kind: 'error';
  id: string;
  code: string | null;
  text: string;
  at: number;
}

export interface ChatTurnRow {
  kind: 'turn';
  id: string;
  turn: number;
  at: number;
}

/**
 * Token accounting for one turn, aggregated from the Host requests that started
 * inside it. Mirrors DSH `TurnTokenUsage`: a bucket is present only when every
 * request in the turn reported it, so an unknown bucket stays `undefined`
 * instead of becoming 0.
 */
export interface ChatTurnUsage {
  /** Prompt input per request (`inputTotalTokens ?? inputTokens`), summed. */
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  /** Output subset from `streamUsage.reasoningTokens`. */
  reasoningTokens: number | undefined;
  /** Number of requests attributed to the turn. */
  requests: number;
}

export interface ChatTurnUsageRow {
  kind: 'turnUsage';
  id: string;
  turn: number;
  usage: ChatTurnUsage;
}

export type ChatRow =
  | ChatUserRow
  | ChatAssistantRow
  | ChatReasoningRow
  | ChatToolRow
  | ChatErrorRow
  | ChatTurnRow
  | ChatTurnUsageRow;

const ACTIVE_PHASES = new Set(['queued', 'preparing', 'running', 'tooling', 'validating']);

function parseJsonText(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** Finite number, or `undefined` for null/missing/non-numeric values. */
function known(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Sum a bucket only when every request reported it (DSH TurnTokenUsage rule). */
function sumAll(values: (number | undefined)[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

/** Aggregate one turn's requests; missing buckets stay undefined. */
function turnUsage(requests: CustomRequestView[]): ChatTurnUsage {
  return {
    inputTokens: sumAll(requests.map(request => known(request.usage.inputTotalTokens) ?? known(request.usage.inputTokens))),
    outputTokens: sumAll(requests.map(request => known(request.usage.outputTokens))),
    cacheReadTokens: sumAll(requests.map(request => known(request.usage.cacheReadTokens))),
    reasoningTokens: sumAll(requests.map(request => known(request.streamUsage?.reasoningTokens))),
    requests: requests.length,
  };
}

/** Whitespace-only reasoning (after the signature envelope is stripped) renders no row. */
function blankReasoning(text: string): boolean {
  return reasoningText(text).trim() === '';
}

/** Text-block identity: one DSH content block is `executionId + index`. */
function blockKey(event: CustomEvent): string | null {
  if (typeof event.executionId !== 'string' || event.executionId === '' || !Number.isInteger(event.index)) return null;
  return `${event.type}\u0000${event.executionId}\u0000${event.index as number}`;
}

/**
 * Project the Host's bounded event log into ordered chat rows.
 *
 * - Assistant text and reasoning group by content block (`executionId +
 *   index`): fragments of one block append to that block's row, and different
 *   blocks never merge, even when adjacent. Events without a block identity
 *   fall back to merging with an immediately preceding keyless row of the same
 *   kind.
 * - Reasoning rows whose text is whitespace-only are dropped (DSH
 *   conversation-nodes README: only non-blank reasoning blocks produce rows),
 *   and a blank streaming tail never hands its running state to an earlier row.
 * - With `requests`, a `turnUsage` row closes every turn (at its `turn-end`
 *   event, or at the end of the log for a still-open turn). A request belongs to
 *   the turn whose `turn-start.at` is the latest one not after its `startedAt`;
 *   requests before the first turn-start count toward the first turn, requests
 *   without `startedAt` are not attributed, and a turn without requests gets no
 *   usage row.
 */
export function buildChatRows(
  events: CustomEvent[],
  summary?: CustomRunSummary,
  requests?: CustomRequestView[],
): ChatRow[] {
  const rows: ChatRow[] = [];
  const toolIndex = new Map<string, ChatToolRow>();
  const blocks = new Map<string, ChatAssistantRow | ChatReasoningRow>();
  const keyless = new WeakSet<ChatRow>();
  const streaming = ACTIVE_PHASES.has(summary?.phase ?? '');

  // Turn boundaries for request attribution: first turn-start per turn number.
  const turnStarts: { turn: number; at: number }[] = [];
  for (const event of events) {
    if (event.type !== 'phase' || event.phase !== 'turn-start' || !Number.isInteger(event.turn)) continue;
    const turn = event.turn as number;
    if (turnStarts.every(start => start.turn !== turn)) turnStarts.push({ turn, at: event.at });
  }
  turnStarts.sort((left, right) => left.at - right.at);
  const requestsByTurn = new Map<number, CustomRequestView[]>();
  if (requests) {
    for (const request of requests) {
      if (request.startedAt === null || !Number.isFinite(request.startedAt)) continue;
      let turn = turnStarts[0]?.turn ?? 1;
      for (const start of turnStarts) {
        if (start.at <= request.startedAt) turn = start.turn;
        else break;
      }
      const list = requestsByTurn.get(turn);
      if (list) list.push(request);
      else requestsByTurn.set(turn, [request]);
    }
  }
  const closedTurns = new Set<number>();
  const closeTurn = (turn: number, id: string): void => {
    if (closedTurns.has(turn)) return;
    closedTurns.add(turn);
    const turnRequests = requestsByTurn.get(turn);
    if (!turnRequests || turnRequests.length === 0) return;
    rows.push({ kind: 'turnUsage', id: `${id}:usage`, turn, usage: turnUsage(turnRequests) });
  };

  const appendText = (event: CustomEvent, kind: 'assistant' | 'reasoning'): void => {
    const key = blockKey(event);
    const text = event.text ?? '';
    if (key !== null) {
      const existing = blocks.get(key);
      if (existing) {
        existing.text = `${existing.text}${text}`;
        return;
      }
      const row = { kind, id: event.id, text, running: false, at: event.at };
      blocks.set(key, row);
      rows.push(row);
      return;
    }
    const previous = rows.at(-1);
    if (previous?.kind === kind && keyless.has(previous)) {
      previous.text = `${previous.text}${text}`;
      return;
    }
    const row = { kind, id: event.id, text, running: false, at: event.at };
    keyless.add(row);
    rows.push(row);
  };

  let lastTurn = 0;
  for (const event of events) {
    switch (event.type) {
      case 'phase': {
        if (event.phase === 'turn-start' && Number.isInteger(event.turn) && (event.turn ?? 0) > lastTurn) {
          // A turn that never reported turn-end still closes before the next one.
          if (lastTurn > 0) closeTurn(lastTurn, `${event.id}:prev`);
          lastTurn = event.turn as number;
          if (lastTurn > 1) rows.push({ kind: 'turn', id: event.id, turn: lastTurn, at: event.at });
        } else if (event.phase === 'turn-end') {
          const turn = Number.isInteger(event.turn) ? event.turn as number : lastTurn;
          if (turn > 0) closeTurn(turn, event.id);
        }
        break;
      }
      case 'message': {
        if (event.role === 'user') {
          rows.push({ kind: 'user', id: event.id, text: event.text ?? '', at: event.at });
          break;
        }
        appendText(event, 'assistant');
        break;
      }
      case 'reasoning': {
        appendText(event, 'reasoning');
        break;
      }
      case 'tool': {
        if (event.phase === 'call') {
          const row: ChatToolRow = {
            kind: 'tool',
            id: event.id,
            callId: event.callId ?? event.id,
            name: event.name ?? 'tool',
            status: 'running',
            arguments: parseJsonText(event.arguments),
            content: null,
            at: event.at,
          };
          toolIndex.set(row.callId, row);
          rows.push(row);
          break;
        }
        const callId = event.callId ?? event.id;
        const row = toolIndex.get(callId);
        if (row) {
          row.status = event.isError ? 'error' : 'ok';
          row.content = parseJsonText(event.content);
        } else {
          rows.push({
            kind: 'tool',
            id: event.id,
            callId,
            name: event.name || 'tool',
            status: event.isError ? 'error' : 'ok',
            arguments: null,
            content: parseJsonText(event.content),
            at: event.at,
          });
        }
        break;
      }
      case 'error': {
        rows.push({ kind: 'error', id: event.id, code: event.code ?? null, text: event.text ?? '会话执行失败', at: event.at });
        break;
      }
      default:
        break;
    }
  }
  // Session end closes the still-open turn (or the whole log when the Host
  // reported no turn-start at all).
  closeTurn(lastTurn > 0 ? lastTurn : turnStarts[0]?.turn ?? 1, 'session-end');

  if (streaming) {
    // Only the tail of the transcript can still be growing. A blank reasoning
    // tail produces no row and must not pass its running state to an earlier
    // block, so the search stops at it.
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.kind === 'turnUsage') continue;
      if (row.kind === 'reasoning' && blankReasoning(row.text)) break;
      if (row.kind === 'assistant' || row.kind === 'reasoning') {
        row.running = true;
        break;
      }
      if (row.kind === 'tool' && row.status === 'running') break;
    }
  }
  // Only reasoning blocks with non-whitespace text produce rows.
  return rows.filter(row => row.kind !== 'reasoning' || !blankReasoning(row.text));
}
