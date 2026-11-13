import type { ContentBlock, ReplayEnvelope } from '@deepseek-ai/dsh-llm';

/**
 * Base64-encoded "skip_thought_signature_validator" sentinel used ONLY when
 * replaying Gemini turns containing unsigned function calls (AGM thinking_store.rs).
 */
export const GEMINI_SENTINEL_THOUGHT_SIGNATURE =
  'c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=';

export const LEGACY_SENTINEL_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

export const ANTIGRAVITY_REPLAY_FORMAT = 'antigravity-gemini-v1' as const;

export interface AntigravityReplayBlockState {
  kind: 'text' | 'reasoning' | 'tool-call';
  thoughtSignature?: string;
  thought?: boolean;
  toolCallId?: string;
  toolName?: string;
}

export interface AntigravityReplayResponseMeta {
  format: typeof ANTIGRAVITY_REPLAY_FORMAT;
  model: string;
  accountId?: string;
  responseId?: string;
}

export function isSentinelSignature(sig: string | undefined): boolean {
  if (!sig) return false;
  const trimmed = sig.trim();
  return (
    trimmed === GEMINI_SENTINEL_THOUGHT_SIGNATURE ||
    trimmed === LEGACY_SENTINEL_THOUGHT_SIGNATURE
  );
}

export function isUsableSignature(sig: unknown): sig is string {
  return typeof sig === 'string' && sig.trim().length > 0;
}

export function buildReplayEnvelope(params: {
  model: string;
  accountId?: string;
  responseId?: string;
  blockStates: AntigravityReplayBlockState[];
}): ReplayEnvelope {
  const response: AntigravityReplayResponseMeta = {
    format: ANTIGRAVITY_REPLAY_FORMAT,
    model: params.model,
    ...(params.accountId ? { accountId: params.accountId } : {}),
    ...(params.responseId ? { responseId: params.responseId } : {}),
  };
  return {
    response,
    blocks: params.blockStates.map((b) => ({ ...b })),
  };
}

function isAntigravityReplayResponse(value: unknown): value is AntigravityReplayResponseMeta {
  if (value === null || typeof value !== 'object') return false;
  return (value as { format?: unknown }).format === ANTIGRAVITY_REPLAY_FORMAT;
}

function parseReplayBlockState(value: unknown): AntigravityReplayBlockState | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind !== 'text' && kind !== 'reasoning' && kind !== 'tool-call') {
    return undefined;
  }
  const sig = isUsableSignature(candidate.thoughtSignature)
    ? candidate.thoughtSignature.trim()
    : undefined;
  return {
    kind,
    ...(sig !== undefined ? { thoughtSignature: sig } : {}),
    ...(typeof candidate.thought === 'boolean' ? { thought: candidate.thought } : {}),
    ...(typeof candidate.toolCallId === 'string' ? { toolCallId: candidate.toolCallId } : {}),
    ...(typeof candidate.toolName === 'string' ? { toolName: candidate.toolName } : {}),
  };
}

/**
 * Read replay states aligned 1:1 with `message.content`.
 * DSH's `LlmRuntime.forAdapter` already clears foreign provider `replayState`,
 * and we also verify shape & block count before trusting signatures.
 */
export function extractAlignedReplayBlocks(
  content: readonly ContentBlock[],
  replayState: unknown,
): Array<AntigravityReplayBlockState | undefined> {
  if (replayState === null || typeof replayState !== 'object') {
    return content.map(() => undefined);
  }
  const envelope = replayState as Partial<ReplayEnvelope>;
  if (!isAntigravityReplayResponse(envelope.response)) {
    return content.map(() => undefined);
  }
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length !== content.length) {
    return content.map(() => undefined);
  }
  return envelope.blocks.map(parseReplayBlockState);
}
