import type { QuotaGroupSummary, QuotaSnapshotSummary } from '../shared/types.ts';
import type { AntigravityHttpClient } from './client.ts';
import type { AntigravityPluginConfig } from './config.ts';
import { resolveOfficialFingerprint } from './identity.ts';

export interface CodeAssistTierInfo {
  projectId?: string;
  tierId?: string;
  tierLabel?: string;
}

export interface UpstreamModelDescriptor {
  id: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  maxTokens?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  supportsImages?: boolean;
  isInternal?: boolean;
  remainingFraction?: number;
  resetTime?: string;
}

export interface FetchedAccountQuotaResult {
  snapshot: QuotaSnapshotSummary;
  models: UpstreamModelDescriptor[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(obj: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim() !== '') return val.trim();
  }
  return undefined;
}

function readNumber(obj: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return undefined;
}

function extractProjectId(data: Record<string, unknown>): string | undefined {
  const raw = data.cloudaicompanionProject ?? data.projectId ?? data.project;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  const obj = asRecord(raw);
  return readString(obj, 'id', 'projectId');
}

function normalizeTierLabel(tierId: string | undefined, tierName: string | undefined): string | undefined {
  const combined = `${tierId ?? ''} ${tierName ?? ''}`.toLowerCase();
  if (combined.includes('ultra')) return 'Ultra';
  if (combined.includes('pro')) return 'Pro';
  if (combined.includes('enterprise')) return 'Enterprise';
  if (combined.includes('standard')) return 'Standard';
  if (combined.includes('free')) return 'Free';
  return tierName || tierId;
}

export function extractTierInfo(data: Record<string, unknown>): CodeAssistTierInfo {
  const projectId = extractProjectId(data);
  const paidTier = asRecord(data.paidTier);
  const currentTier = asRecord(data.currentTier);
  const allowed = Array.isArray(data.allowedTiers) ? data.allowedTiers : [];
  const defaultAllowed = allowed
    .map(asRecord)
    .find((item) => item && item.isDefault === true) ?? asRecord(allowed[0]);

  const tierObj = paidTier ?? currentTier ?? defaultAllowed;
  const tierId = readString(tierObj, 'id', 'tierId');
  const tierName = readString(tierObj, 'name', 'displayName');
  return {
    projectId,
    tierId,
    tierLabel: normalizeTierLabel(tierId, tierName),
  };
}

export async function loadCodeAssist(params: {
  client: AntigravityHttpClient;
  accessToken: string;
  email?: string;
  projectIdHint?: string;
  signal?: AbortSignal;
}): Promise<CodeAssistTierInfo> {
  const { ideType } = resolveOfficialFingerprint(params.email);
  const body = {
    ...(params.projectIdHint ? { cloudaicompanionProject: params.projectIdHint } : {}),
    metadata: { ideType },
  };
  const { response } = await params.client.post({
    method: 'loadCodeAssist',
    body,
    accessToken: params.accessToken,
    projectId: params.projectIdHint,
    isContentRequest: false,
    signal: params.signal,
  });
  const json = (await response.json()) as Record<string, unknown>;
  return extractTierInfo(json);
}

export function classifyPool(
  modelId: string,
  labelOrProvider?: string,
): QuotaGroupSummary['pool'] {
  const lower = `${modelId} ${labelOrProvider ?? ''}`.toLowerCase();
  if (lower.includes('flash') && lower.includes('gemini')) return 'gemini-flash';
  if (lower.includes('gemini') || lower.includes('bison')) return 'gemini-pro';
  if (
    lower.includes('claude') ||
    lower.includes('anthropic') ||
    lower.includes('gpt') ||
    lower.includes('openai') ||
    lower.includes('3p')
  ) {
    return 'claude-3p';
  }
  return 'other';
}

function poolDisplayLabel(pool: QuotaGroupSummary['pool']): string {
  switch (pool) {
    case 'gemini-pro':
      return 'Gemini Pro';
    case 'gemini-flash':
      return 'Gemini Flash';
    case 'claude-3p':
      return 'Claude / 3P';
    default:
      return 'Other Models';
  }
}

function isPlaceholderModelId(value: string): boolean {
  return /^MODEL_PLACEHOLDER_/i.test(value.trim());
}

function normalizeUpstreamModelId(rawId: string): string {
  const trimmed = rawId.trim();
  const enumMap: Record<string, string> = {
    MODEL_GOOGLE_GEMINI_2_5_PRO: 'gemini-2.5-pro',
    MODEL_GOOGLE_GEMINI_2_5_FLASH: 'gemini-2.5-flash',
    MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING: 'gemini-2.5-flash',
    MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE: 'gemini-2.5-flash-lite',
  };
  if (enumMap[trimmed]) return enumMap[trimmed];
  if (trimmed.startsWith('MODEL_GOOGLE_')) {
    return trimmed
      .slice('MODEL_GOOGLE_'.length)
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/(\d)-(\d)/g, '$1.$2');
  }
  return trimmed;
}

export function parseAvailableModelsResponse(
  raw: Record<string, unknown>,
): UpstreamModelDescriptor[] {
  const results: UpstreamModelDescriptor[] = [];
  const seen = new Set<string>();
  const modelsField =
    raw.models ??
    raw.availableModels ??
    raw.available_models ??
    raw.clientModelConfigs ??
    raw.client_model_configs;

  const pushEntry = (key: string, val: unknown) => {
    const obj = asRecord(val);
    if (!obj) return;
    const modelOrAlias = asRecord(obj.modelOrAlias ?? obj.model_or_alias);
    const candidates = [
      readString(obj, 'id', 'alias'),
      key.trim() || undefined,
      readString(modelOrAlias, 'alias'),
      readString(obj, 'model', 'modelId', 'model_id', 'name'),
      readString(modelOrAlias, 'model'),
    ].filter((c): c is string => typeof c === 'string' && c.trim() !== '');
    const rawId = candidates.find((c) => !isPlaceholderModelId(c)) ?? candidates[0];
    if (!rawId) return;
    const id = normalizeUpstreamModelId(rawId);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const quotaInfo = asRecord(obj.quotaInfo ?? obj.quota_info);
    const remainingFraction = readNumber(
      quotaInfo,
      'remainingFraction',
      'remaining_fraction',
    );
    const resetTime = readString(quotaInfo, 'resetTime', 'reset_time');
    const supportsThinking =
      typeof obj.supportsThinking === 'boolean'
        ? obj.supportsThinking
        : typeof obj.supports_thinking === 'boolean'
          ? obj.supports_thinking
          : undefined;
    const supportsImages =
      typeof obj.supportsImages === 'boolean'
        ? obj.supportsImages
        : typeof obj.supports_images === 'boolean'
          ? obj.supports_images
          : undefined;
    const isInternal = obj.isInternal === true || obj.is_internal === true;

    results.push({
      id,
      displayName: readString(obj, 'displayName', 'display_name', 'label'),
      model: readString(obj, 'model') ?? readString(modelOrAlias, 'model'),
      modelProvider: readString(obj, 'modelProvider', 'model_provider'),
      maxTokens: readNumber(
        obj,
        'maxTokens',
        'max_tokens',
        'inputTokenLimit',
        'input_token_limit',
      ),
      maxOutputTokens: readNumber(
        obj,
        'maxOutputTokens',
        'max_output_tokens',
        'outputTokenLimit',
        'output_token_limit',
      ),
      supportsThinking,
      supportsImages,
      isInternal,
      ...(remainingFraction !== undefined
        ? { remainingFraction: Math.max(0, Math.min(1, remainingFraction)) }
        : {}),
      ...(resetTime ? { resetTime } : {}),
    });
  };

  if (Array.isArray(modelsField)) {
    for (const item of modelsField) {
      const obj = asRecord(item);
      const modelOrAlias = asRecord(obj?.modelOrAlias ?? obj?.model_or_alias);
      const key =
        readString(obj, 'id', 'model', 'modelId', 'model_id', 'name') ??
        readString(modelOrAlias, 'model', 'alias') ??
        '';
      pushEntry(key, item);
    }
  } else {
    const mapObj = asRecord(modelsField);
    if (mapObj) {
      for (const [key, val] of Object.entries(mapObj)) {
        pushEntry(key, val);
      }
    }
  }
  return results;
}

export function classifyQuotaWindow(
  label?: string,
  bucketId?: string,
  resetTime?: string,
): 'daily' | 'weekly' {
  const text = `${label ?? ''} ${bucketId ?? ''}`.toLowerCase();
  if (/week|每周|周限|7d|168h/.test(text)) return 'weekly';
  if (/5h|小时|day|daily|日限|24h/.test(text)) return 'daily';
  if (resetTime) {
    const target = Date.parse(resetTime);
    if (Number.isFinite(target) && target - Date.now() > 24 * 60 * 60 * 1000) {
      return 'weekly';
    }
  }
  return 'daily';
}

export function buildQuotaGroups(params: {
  models: UpstreamModelDescriptor[];
  summaryRaw?: Record<string, unknown>;
  config: AntigravityPluginConfig;
}): QuotaGroupSummary[] {
  const summaryGroups: QuotaGroupSummary[] = [];

  const pushBucket = (
    item: Record<string, unknown>,
    parentLabel?: string,
    index = 0,
  ) => {
    const fraction = readNumber(item, 'remainingFraction', 'remaining_fraction');
    if (fraction === undefined) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    const resetTime = readString(item, 'resetTime', 'reset_time');
    const modelId = readString(item, 'modelId', 'model_id', 'model', 'tokenType', 'token_type') ?? '';
    const bucketId = readString(item, 'bucketId', 'bucket_id', 'id');
    const bucketLabel = readString(item, 'displayName', 'display_name', 'label', 'title', 'name', 'groupName', 'modelGroup');
    const windowLabel = readString(item, 'window', 'period', 'duration');

    let combinedLabel = bucketLabel ?? '';
    if (parentLabel && bucketLabel) {
      combinedLabel = bucketLabel.toLowerCase().includes(parentLabel.toLowerCase())
        ? bucketLabel
        : `${parentLabel} ${bucketLabel}`;
    } else if (parentLabel && !bucketLabel) {
      combinedLabel = windowLabel || bucketId ? `${parentLabel} ${windowLabel ?? bucketId}` : parentLabel;
    } else if (!combinedLabel && (windowLabel || bucketId)) {
      combinedLabel = windowLabel ?? bucketId ?? '';
    }

    const pool = classifyPool(modelId, `${combinedLabel} ${parentLabel ?? ''}`);
    const finalLabel = combinedLabel || poolDisplayLabel(pool);
    const idBase = bucketId ?? `${pool}-${index}`;
    const uniqueId = summaryGroups.some((g) => g.id === idBase)
      ? `${idBase}-${index}`
      : idBase;
    const windowType = classifyQuotaWindow(
      `${finalLabel} ${windowLabel ?? ''}`,
      bucketId,
      resetTime,
    );

    summaryGroups.push({
      id: uniqueId,
      label: finalLabel,
      pool,
      windowType,
      remainingFraction: clamped,
      ...(resetTime ? { resetTime } : {}),
      isLow: clamped < params.config.quotaWarnThreshold,
      isExhausted: clamped <= params.config.quotaExhaustedThreshold,
      modelIds: modelId ? [modelId] : [],
    });
  };

  // 1. Prefer individual buckets from retrieveUserQuotaSummary (groups[].buckets[] or top-level buckets[]).
  if (Array.isArray(params.summaryRaw?.groups)) {
    let idx = 0;
    for (const grp of params.summaryRaw.groups) {
      const grpObj = asRecord(grp);
      if (!grpObj) continue;
      const grpLabel = readString(grpObj, 'displayName', 'display_name', 'label', 'title', 'groupName', 'name');
      const grpBuckets = Array.isArray(grpObj.buckets) ? grpObj.buckets : [];
      if (grpBuckets.length > 0) {
        for (const b of grpBuckets) {
          const bObj = asRecord(b);
          if (bObj) pushBucket(bObj, grpLabel, idx++);
        }
      } else if (readNumber(grpObj, 'remainingFraction', 'remaining_fraction') !== undefined) {
        pushBucket(grpObj, undefined, idx++);
      }
    }
  }

  const topLevelBuckets =
    (Array.isArray(params.summaryRaw?.buckets) ? params.summaryRaw.buckets : undefined) ??
    (Array.isArray(params.summaryRaw?.userQuotaSummary) ? params.summaryRaw.userQuotaSummary : undefined) ??
    (Array.isArray(params.summaryRaw?.quotaBuckets) ? params.summaryRaw.quotaBuckets : undefined) ??
    [];
  for (let i = 0; i < topLevelBuckets.length; i++) {
    const obj = asRecord(topLevelBuckets[i]);
    if (obj) pushBucket(obj, undefined, summaryGroups.length + i);
  }

  if (summaryGroups.length > 0) {
    return summaryGroups;
  }

  // 2. Fallback: aggregate per-model quotaInfo from fetchAvailableModels by pool.
  const byPool = new Map<
    QuotaGroupSummary['pool'],
    {
      minFraction?: number;
      resetTime?: string;
      modelIds: Set<string>;
    }
  >();

  for (const m of params.models) {
    if (m.remainingFraction === undefined && !m.resetTime) continue;
    const pool = classifyPool(m.id, `${m.displayName ?? ''} ${m.modelProvider ?? ''}`);
    let entry = byPool.get(pool);
    if (!entry) {
      entry = { modelIds: new Set() };
      byPool.set(pool, entry);
    }
    entry.modelIds.add(m.id);
    if (m.remainingFraction !== undefined) {
      entry.minFraction =
        entry.minFraction === undefined
          ? m.remainingFraction
          : Math.min(entry.minFraction, m.remainingFraction);
    }
    if (m.resetTime && !entry.resetTime) entry.resetTime = m.resetTime;
  }

  const order: QuotaGroupSummary['pool'][] = [
    'gemini-pro',
    'gemini-flash',
    'claude-3p',
    'other',
  ];
  const groups: QuotaGroupSummary[] = [];

  for (const pool of order) {
    const entry = byPool.get(pool);
    if (!entry || entry.minFraction === undefined) continue;
    const remainingFraction = entry.minFraction;
    groups.push({
      id: pool,
      label: poolDisplayLabel(pool),
      pool,
      remainingFraction,
      ...(entry.resetTime ? { resetTime: entry.resetTime } : {}),
      isLow: remainingFraction < params.config.quotaWarnThreshold,
      isExhausted: remainingFraction <= params.config.quotaExhaustedThreshold,
      modelIds: [...entry.modelIds].sort(),
    });
  }

  return groups;
}

/**
 * Fetch tier/project + available models + pooled quota summary.
 * Fail-open: individual endpoint errors produce `degraded: true` without throwing,
 * so temporary quota lookup failures never block chat completion.
 */
export async function fetchAccountQuotaAndModels(params: {
  client: AntigravityHttpClient;
  config: AntigravityPluginConfig;
  accountId: string;
  email: string;
  accessToken: string;
  projectIdHint?: string;
  signal?: AbortSignal;
}): Promise<FetchedAccountQuotaResult> {
  const errors: string[] = [];
  let projectId = params.projectIdHint;
  let tierLabel: string | undefined;
  let tierId: string | undefined;

  try {
    const assist = await loadCodeAssist({
      client: params.client,
      accessToken: params.accessToken,
      email: params.email,
      projectIdHint: projectId,
      signal: params.signal,
    });
    if (assist.projectId) projectId = assist.projectId;
    tierLabel = assist.tierLabel;
    tierId = assist.tierId;
  } catch (error) {
    errors.push(`loadCodeAssist: ${error instanceof Error ? error.message : String(error)}`);
  }

  let models: UpstreamModelDescriptor[] = [];
  const { ideType } = resolveOfficialFingerprint(params.email);
  try {
    const { response } = await params.client.post({
      method: 'fetchAvailableModels',
      body: projectId ? { project: projectId } : { metadata: { ideType } },
      accessToken: params.accessToken,
      projectId,
      isContentRequest: false,
      signal: params.signal,
    });
    const rawModels = (await response.json()) as Record<string, unknown>;
    models = parseAvailableModelsResponse(rawModels);
  } catch (error) {
    errors.push(
      `fetchAvailableModels: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let summaryRaw: Record<string, unknown> | undefined;
  if (projectId) {
    try {
      const { response } = await params.client.post({
        method: 'retrieveUserQuotaSummary',
        body: { project: projectId },
        accessToken: params.accessToken,
        projectId,
        isContentRequest: false,
        signal: params.signal,
      });
      summaryRaw = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      errors.push(
        `retrieveUserQuotaSummary: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const groups = buildQuotaGroups({
    models,
    summaryRaw,
    config: params.config,
  });

  return {
    snapshot: {
      accountId: params.accountId,
      email: params.email,
      ...(projectId ? { projectId } : {}),
      ...(tierLabel ? { tierLabel } : {}),
      ...(tierId ? { tierId } : {}),
      fetchedAt: Date.now(),
      degraded: errors.length > 0 && groups.length === 0,
      ...(errors.length > 0 && groups.length === 0 ? { error: errors.join('; ') } : {}),
      groups,
    },
    models,
  };
}
