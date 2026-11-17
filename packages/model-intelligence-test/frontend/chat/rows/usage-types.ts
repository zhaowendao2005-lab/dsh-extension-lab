/** Provider-reported token accounting for one completed turn. */
export interface TurnTokenUsageRoute {
  readonly provider: string;
  readonly model: string;
}

/**
 * Exact provider-reported token accounting for every attempt in one completed
 * turn. Optional buckets are present only when every attempt reported them, so a
 * missing bucket stays unknown instead of becoming a zero.
 */
export interface TurnTokenUsage {
  /** Sum of uncached prompt input across all attempts. */
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  /** Exact aggregate prompt plus output total across all attempts. */
  readonly totalTokens: number;
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number;
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number;
  /** Output subset, present only when every attempt reported it. */
  readonly reasoningTokens?: number;
  /** Present only when every billed attempt has provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[];
}
