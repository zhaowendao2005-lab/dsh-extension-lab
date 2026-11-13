/**
 * Shared Host <-> Client contract types for dsh-antigravity.
 * Must stay dependency-free so both host ESM and browser client bundles share it.
 */

export type ReasoningEffortValue = 'low' | 'medium' | 'high' | 'xhigh';

export type SwitchReason = 'manual' | 'quota' | 'streak' | 'unavailable';

export interface AccountPublicSummary {
  id: string;
  email: string;
  name?: string;
  projectId?: string;
  tierLabel?: string;
  tierId?: string;
  isActive: boolean;
  needsReauth: boolean;
  lastError?: string;
  cooldownUntil?: number;
  lowestQuotaFraction?: number;
  addedAt: number;
  lastUsedAt?: number;
}

export interface PendingLoginStatus {
  state: 'idle' | 'pending' | 'completed' | 'failed';
  authUrl?: string;
  redirectUri?: string;
  startedAt?: number;
  error?: string;
  email?: string;
}

export interface QuotaGroupSummary {
  id: string;
  label: string;
  pool: 'gemini-pro' | 'gemini-flash' | 'claude-3p' | 'other';
  windowType?: 'daily' | 'weekly';
  remainingFraction: number;
  resetTime?: string;
  isLow: boolean;
  isExhausted: boolean;
  modelIds: string[];
}

export interface QuotaSnapshotSummary {
  accountId: string;
  email: string;
  projectId?: string;
  tierLabel?: string;
  tierId?: string;
  fetchedAt: number;
  degraded: boolean;
  error?: string;
  groups: QuotaGroupSummary[];
}

export interface SwitchEventRecord {
  sessionId?: string;
  fromAccountId?: string;
  fromEmail?: string;
  toAccountId: string;
  toEmail: string;
  reason: SwitchReason;
  detail?: string;
  at: number;
}

export interface CacheTelemetrySummary {
  turnCount: number;
  totalUncachedInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  aggregateCacheHitRate: number;
  recentTurns: Array<{
    at: number;
    model: string;
    accountEmail?: string;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheHitRate: number;
  }>;
}

export type ModelTierAccess = 'all' | 'pro' | 'ultra';

export interface CatalogModelOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  contextWindow: number;
  defaultMaxTokens: number;
  supportsReasoning: boolean;
  supportedEfforts?: ReasoningEffortValue[];
  defaultEffort?: ReasoningEffortValue;
  variantIds?: Partial<Record<ReasoningEffortValue, string>>;
  supportsImages: boolean;
  pool: QuotaGroupSummary['pool'];
  tierAccess?: ModelTierAccess;
  isUpstreamAvailable?: boolean;
  remainingFraction?: number;
  resetTime?: string;
  isDynamic?: boolean;
}

export interface DoctorCheckItem {
  name: string;
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: number;
  userAgent: string;
  checks: DoctorCheckItem[];
}

export interface AntigravityStatusPayload {
  providerId: 'antigravity';
  providerName: string;
  unofficialChannel: true;
  accounts: AccountPublicSummary[];
  activeAccountId?: string;
  login: PendingLoginStatus;
  quota?: QuotaSnapshotSummary;
  coldNotice?: SwitchEventRecord;
  recentSwitches: SwitchEventRecord[];
  telemetry: CacheTelemetrySummary;
  models: {
    enabledModelIds: string[];
    options: CatalogModelOption[];
    source?: 'upstream' | 'cache' | 'static';
  };
}

export interface ApiEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: string;
}
