import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import type { CacheTelemetrySummary } from '../shared/types.ts';

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

function nonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}

/**
 * Accumulate cumulative Gemini SSE usageMetadata objects safely across chunks.
 */
export function mergeUsageMetadata(
  prev: GeminiUsageMetadata | undefined,
  next: GeminiUsageMetadata | undefined,
): GeminiUsageMetadata | undefined {
  if (!next) return prev;
  if (!prev) return { ...next };
  return {
    promptTokenCount:
      typeof next.promptTokenCount === 'number' && Number.isFinite(next.promptTokenCount)
        ? next.promptTokenCount
        : prev.promptTokenCount,
    candidatesTokenCount:
      typeof next.candidatesTokenCount === 'number' && Number.isFinite(next.candidatesTokenCount)
        ? next.candidatesTokenCount
        : prev.candidatesTokenCount,
    thoughtsTokenCount:
      typeof next.thoughtsTokenCount === 'number' && Number.isFinite(next.thoughtsTokenCount)
        ? next.thoughtsTokenCount
        : prev.thoughtsTokenCount,
    cachedContentTokenCount:
      typeof next.cachedContentTokenCount === 'number' &&
      Number.isFinite(next.cachedContentTokenCount)
        ? next.cachedContentTokenCount
        : prev.cachedContentTokenCount,
    totalTokenCount:
      typeof next.totalTokenCount === 'number' && Number.isFinite(next.totalTokenCount)
        ? next.totalTokenCount
        : prev.totalTokenCount,
    toolUsePromptTokenCount:
      typeof next.toolUsePromptTokenCount === 'number' &&
      Number.isFinite(next.toolUsePromptTokenCount)
        ? next.toolUsePromptTokenCount
        : prev.toolUsePromptTokenCount,
  };
}

/**
 * Map Gemini `usageMetadata` to DSH `TokenUsage` with disjoint token buckets
 * matching `dsh-token-meter` & `turn-usage` invariants:
 * - `inputTokens` excludes `cachedContentTokenCount` (non-cached tokens only)
 * - `cacheReadTokens` is explicitly reported (even when 0) so UI shows 0% vs blank
 * - `outputTokens` includes `candidatesTokenCount` + `thoughtsTokenCount`
 * - `cacheWriteTokens` is never fabricated
 * - `totalTokens` is self-computed (`inputTokens + cacheReadTokens + outputTokens`)
 */
export function mapUsage(usage: GeminiUsageMetadata | undefined): TokenUsage {
  const prompt = nonNegInt(usage?.promptTokenCount) + nonNegInt(usage?.toolUsePromptTokenCount);
  const cached = Math.min(prompt, nonNegInt(usage?.cachedContentTokenCount));
  const candidates = nonNegInt(usage?.candidatesTokenCount);
  const thoughts = nonNegInt(usage?.thoughtsTokenCount);

  const inputTokens = Math.max(0, prompt - cached);
  const reasoningTokens = thoughts;
  const outputTokens = candidates + reasoningTokens;
  const cacheReadTokens = cached;
  const totalTokens = inputTokens + cacheReadTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    reasoningTokens,
  };
}

const MAX_RECENT_TURNS = 50;

/**
 * In-process ring buffer recording recent Antigravity turns for Settings UI telemetry.
 */
export class CacheTelemetryTracker {
  private turnCount = 0;
  private totalUncachedInputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalOutputTokens = 0;
  private totalReasoningTokens = 0;
  private recent: CacheTelemetrySummary['recentTurns'] = [];

  record(entry: {
    model: string;
    accountEmail?: string;
    usage: TokenUsage;
    at?: number;
  }): void {
    const inputTokens = nonNegInt(entry.usage.inputTokens);
    const cacheReadTokens = nonNegInt(entry.usage.cacheReadTokens);
    const outputTokens = nonNegInt(entry.usage.outputTokens);
    const reasoningTokens = nonNegInt(entry.usage.reasoningTokens);
    const promptDenom = inputTokens + cacheReadTokens;
    const cacheHitRate = promptDenom > 0 ? cacheReadTokens / promptDenom : 0;

    this.turnCount += 1;
    this.totalUncachedInputTokens += inputTokens;
    this.totalCacheReadTokens += cacheReadTokens;
    this.totalOutputTokens += outputTokens;
    this.totalReasoningTokens += reasoningTokens;

    this.recent.unshift({
      at: entry.at ?? Date.now(),
      model: entry.model,
      accountEmail: entry.accountEmail,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      reasoningTokens,
      cacheHitRate,
    });
    if (this.recent.length > MAX_RECENT_TURNS) {
      this.recent.length = MAX_RECENT_TURNS;
    }
  }

  summary(): CacheTelemetrySummary {
    const totalPrompt = this.totalUncachedInputTokens + this.totalCacheReadTokens;
    return {
      turnCount: this.turnCount,
      totalUncachedInputTokens: this.totalUncachedInputTokens,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalReasoningTokens: this.totalReasoningTokens,
      aggregateCacheHitRate: totalPrompt > 0 ? this.totalCacheReadTokens / totalPrompt : 0,
      recentTurns: [...this.recent],
    };
  }
}
