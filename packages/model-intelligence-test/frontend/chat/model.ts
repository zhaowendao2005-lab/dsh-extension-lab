import type { CustomEvent, CustomRunSummary } from '../types';

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

export type ChatRow = ChatUserRow | ChatAssistantRow | ChatReasoningRow | ChatToolRow | ChatErrorRow | ChatTurnRow;

const ACTIVE_PHASES = new Set(['queued', 'preparing', 'running', 'tooling', 'validating']);

function parseJsonText(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/**
 * Project the Host's bounded event log into ordered chat rows. Adjacent deltas of
 * the same block are already coalesced server-side; this only groups streaming
 * fragments that arrived in separate events and keeps tool results attached to
 * the call they answer.
 */
export function buildChatRows(events: CustomEvent[], summary?: CustomRunSummary): ChatRow[] {
  const rows: ChatRow[] = [];
  const toolIndex = new Map<string, ChatToolRow>();
  const streaming = ACTIVE_PHASES.has(summary?.phase ?? '');
  let lastTurn = 0;
  for (const event of events) {
    switch (event.type) {
      case 'phase': {
        if (event.phase === 'turn-start' && Number.isInteger(event.turn) && (event.turn ?? 0) > lastTurn) {
          lastTurn = event.turn as number;
          if (lastTurn > 1) rows.push({ kind: 'turn', id: event.id, turn: lastTurn, at: event.at });
        }
        break;
      }
      case 'message': {
        if (event.role === 'user') {
          rows.push({ kind: 'user', id: event.id, text: event.text ?? '', at: event.at });
          break;
        }
        const previous = rows.at(-1);
        if (previous?.kind === 'assistant') previous.text = `${previous.text}${event.text ?? ''}`;
        else rows.push({ kind: 'assistant', id: event.id, text: event.text ?? '', running: false, at: event.at });
        break;
      }
      case 'reasoning': {
        const previous = rows.at(-1);
        if (previous?.kind === 'reasoning') previous.text = `${previous.text}${event.text ?? ''}`;
        else rows.push({ kind: 'reasoning', id: event.id, text: event.text ?? '', running: false, at: event.at });
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
  if (streaming) {
    // Only the tail of the transcript can still be growing.
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.kind === 'assistant' || row.kind === 'reasoning') {
        row.running = true;
        break;
      }
      if (row.kind === 'tool' && row.status === 'running') break;
    }
  }
  return rows;
}
