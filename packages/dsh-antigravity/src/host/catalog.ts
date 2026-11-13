import {
  ReasoningEffortId,
  type LlmModelBadge,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm';
import path from 'node:path';
import type {
  CatalogModelOption,
  ModelTierAccess,
  QuotaGroupSummary,
  QuotaSnapshotSummary,
  ReasoningEffortValue,
} from '../shared/types.ts';
import { PROVIDER_ID, type AntigravityPluginConfig } from './config.ts';
import { classifyPool, type UpstreamModelDescriptor } from './quota.ts';
import { readJsonFile, resolveAntigravityStorageDir, writePrivateJsonFile } from './storage.ts';

export const EFFORT_ORDER: readonly ReasoningEffortValue[] = [
  'low',
  'medium',
  'high',
  'xhigh',
];

export function isReasoningEffortValue(value: unknown): value is ReasoningEffortValue {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

export function clampEffortToSupported(
  effort: ReasoningEffortValue,
  supported?: readonly ReasoningEffortValue[],
): ReasoningEffortValue {
  if (!supported || supported.length === 0) return effort;
  if (supported.includes(effort)) return effort;
  const targetIdx = EFFORT_ORDER.indexOf(effort);
  // Prefer the closest lower supported effort first, then the closest higher one.
  for (let i = targetIdx - 1; i >= 0; i -= 1) {
    if (supported.includes(EFFORT_ORDER[i]!)) {
      return EFFORT_ORDER[i]!;
    }
  }
  for (let i = targetIdx + 1; i < EFFORT_ORDER.length; i += 1) {
    if (supported.includes(EFFORT_ORDER[i]!)) {
      return EFFORT_ORDER[i]!;
    }
  }
  return supported[0]!;
}

export function extractEffortSuffix(modelId: string): {
  baseId: string;
  effort?: ReasoningEffortValue;
} {
  const trimmed = modelId.trim();
  const match = /^(.+)-(low|medium|high|xhigh)$/i.exec(trimmed);
  if (!match) return { baseId: trimmed };
  const effort = match[2]!.toLowerCase();
  return {
    baseId: match[1]!,
    effort: isReasoningEffortValue(effort) ? effort : undefined,
  };
}

export function stripEffortDisplaySuffix(displayName: string): string {
  return displayName
    .trim()
    .replace(/\s*\((?:Low|Medium|High|XHigh|Minimal)\)\s*$/i, '')
    .replace(/\s+(?:Low|Medium|High|XHigh|Minimal)\s*$/i, '')
    .trim();
}

function isPlaceholderModelId(value: string): boolean {
  return /^MODEL_PLACEHOLDER_/i.test(value.trim());
}

function displayNameToSlug(displayName: string): string {
  return stripEffortDisplaySuffix(displayName)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const KNOWN_VARIANT_FAMILIES = new Set([
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-3.8-flash',
  'gemini-3.1-pro',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
]);

export function isKnownVariantFamily(baseId: string): boolean {
  const lower = baseId.toLowerCase();
  return (
    KNOWN_VARIANT_FAMILIES.has(lower) ||
    /^(?:gemini-4-|gemini-3\.\d+-|claude-(?:opus|sonnet)-)/.test(lower)
  );
}

export interface StaticModelEntry {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  contextWindow: number;
  defaultMaxTokens: number;
  supportsReasoning: boolean;
  supportedEfforts?: readonly ReasoningEffortValue[];
  defaultEffort?: ReasoningEffortValue;
  variantIds?: Partial<Record<ReasoningEffortValue, string>>;
  supportsImages: boolean;
  pool: QuotaGroupSummary['pool'];
  tierAccess: ModelTierAccess;
  isGemini3Series?: boolean;
}

export const STATIC_GEMINI_MODELS: readonly StaticModelEntry[] = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    description: 'Antigravity Gemini 4 Hydrogen flagship model',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    variantIds: {
      low: 'gemini-4-hydrogen-low',
      medium: 'gemini-4-hydrogen-medium',
      high: 'gemini-4-hydrogen-high',
      xhigh: 'gemini-4-hydrogen-xhigh',
    },
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    description: 'Antigravity Gemini 4 Argon model for Pro & Ultra plans',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    variantIds: {
      low: 'gemini-4-argon-low',
      medium: 'gemini-4-argon-medium',
      high: 'gemini-4-argon-high',
    },
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-pro-orchestrator-g1-pro',
    name: 'Orchestrator (Argon)',
    description: 'Antigravity Pro/Ultra orchestrator backed by Gemini 4 Argon',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    description: 'Gemini 4 Carbon deep reasoning model (Ultra / entitled accounts)',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    variantIds: {
      low: 'gemini-4-carbon-low',
      medium: 'gemini-4-carbon-medium',
      high: 'gemini-4-carbon-high',
    },
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'ultra',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Gemini 3.8 Flash for fast agent loops',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    variantIds: {
      low: 'gemini-3.8-flash-low',
      medium: 'gemini-3.8-flash-medium',
      high: 'gemini-3.8-flash-high',
    },
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    description: 'Legacy Gemini 3.1 Pro model',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'high'],
    defaultEffort: 'high',
    variantIds: {
      low: 'gemini-3.1-pro-low',
      high: 'gemini-3.1-pro-high',
    },
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    description: 'Low-latency Gemini 3 Flash for high-throughput agent loops',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
    isGemini3Series: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Stable Gemini 2.5 Pro coding and long-context model',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast Gemini 2.5 Flash model with optional thinking budget',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'low',
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Ultra-light Gemini 2.5 Flash variant',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: false,
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
  },
] as const;

const MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro-high': 'gemini-3.1-pro',
  'gemini-3-pro-low': 'gemini-3.1-pro',
  'gemini-3.0-pro': 'gemini-3.1-pro',
  'gemini-3.0-flash': 'gemini-3-flash',
  'gemini-3-flash-preview': 'gemini-3-flash',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro',
};

const REASONING_EFFORTS = [
  { id: ReasoningEffortId('low'), name: 'Low', description: 'Minimal thinking overhead' },
  { id: ReasoningEffortId('medium'), name: 'Medium', description: 'Balanced reasoning depth' },
  { id: ReasoningEffortId('high'), name: 'High', description: 'Maximum reasoning depth' },
  { id: ReasoningEffortId('xhigh'), name: 'XHigh', description: 'Maximum extended reasoning depth' },
] as const;

interface StoredModelSettings {
  version: 1;
  enabledModelIds: string[];
}

interface StoredCatalogCache {
  version: 1;
  updatedAt: number;
  models: UpstreamModelDescriptor[];
}

export interface UpstreamDispatchTarget {
  canonicalModel: string;
  upstreamModel: string;
  effectiveEffort?: ReasoningEffortValue;
  fallbackUpstreamModels: string[];
}

export function isGeminiModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes('gemini');
}

export function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const aliased = MODEL_ALIASES[trimmed] ?? trimmed;
  const { baseId, effort } = extractEffortSuffix(aliased);
  if (effort && isKnownVariantFamily(baseId)) {
    return baseId;
  }
  return aliased;
}

export function isGemini3SeriesModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    /^gemini-(?:[3-9]|\d{2,})(?:\.|-|$)/.test(lower) ||
    lower.startsWith('gemini-pro-orchestrator')
  );
}

export function inferModelTierAccess(
  modelId: string,
  displayName?: string,
): ModelTierAccess {
  const lower = `${modelId} ${displayName ?? ''}`.toLowerCase();
  if (
    lower.includes('ultra') ||
    lower.includes('gemini-4-carbon') ||
    lower.endsWith('-max') ||
    lower.includes('opus-5-5-max')
  ) {
    return 'ultra';
  }
  if (
    lower.includes('gemini-4-') ||
    lower.includes('orchestrator') ||
    lower.includes('-pro') ||
    lower.includes('claude-') ||
    lower.includes('gpt-')
  ) {
    return 'pro';
  }
  return 'all';
}

function tierTagLabel(tier: ModelTierAccess): string | undefined {
  switch (tier) {
    case 'ultra':
      return 'Ultra';
    case 'pro':
      return 'Pro';
    default:
      return undefined;
  }
}

export class AntigravityCatalog {
  private readonly settingsPath: string;
  private readonly cachePath: string;
  private enabledModelIds: string[];
  private loaded = false;
  private dynamicModels: UpstreamModelDescriptor[] = [];
  private catalogSource: 'upstream' | 'cache' | 'static' = 'static';
  private upstreamFallbackIds = new Map<string, string>();

  constructor(private readonly config: AntigravityPluginConfig) {
    const storageDir = resolveAntigravityStorageDir(config.storageDir);
    this.settingsPath = path.join(storageDir, 'models.json');
    this.cachePath = path.join(storageDir, 'catalog-cache.json');
    this.enabledModelIds = STATIC_GEMINI_MODELS.filter((m) => m.defaultEnabled).map(
      (m) => m.id,
    );
  }

  private migrateEnabledIds(rawIds: string[]): { ids: string[]; changed: boolean } {
    const cleaned = rawIds
      .filter((s) => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim());
    const migrated = [...new Set(cleaned.map((s) => normalizeModelId(s)))];
    const changed =
      migrated.length !== cleaned.length ||
      migrated.some((id, idx) => id !== cleaned[idx]);
    return { ids: migrated, changed };
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await readJsonFile<StoredModelSettings>(this.settingsPath).catch(
      () => undefined,
    );
    if (saved && Array.isArray(saved.enabledModelIds)) {
      const { ids, changed } = this.migrateEnabledIds(saved.enabledModelIds);
      this.enabledModelIds = ids;
      if (changed) {
        await writePrivateJsonFile(this.settingsPath, {
          version: 1,
          enabledModelIds: this.enabledModelIds,
        } satisfies StoredModelSettings).catch(() => undefined);
      }
    }
    if (this.dynamicModels.length === 0) {
      const cached = await readJsonFile<StoredCatalogCache>(this.cachePath).catch(
        () => undefined,
      );
      if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
        this.dynamicModels = cached.models;
        this.catalogSource = 'cache';
      }
    }
  }

  getCatalogSource(): 'upstream' | 'cache' | 'static' {
    return this.catalogSource;
  }

  async saveDynamicModels(models: UpstreamModelDescriptor[]): Promise<void> {
    this.dynamicModels = [...models];
    if (models.length === 0) return;
    this.catalogSource = 'upstream';
    await writePrivateJsonFile(this.cachePath, {
      version: 1,
      updatedAt: Date.now(),
      models: this.dynamicModels,
    } satisfies StoredCatalogCache).catch(() => undefined);
  }

  updateDynamicModels(models: UpstreamModelDescriptor[]): void {
    void this.saveDynamicModels(models);
  }

  async setEnabledModelIds(ids: string[]): Promise<string[]> {
    await this.ensureLoaded();
    const { ids: normalized } = this.migrateEnabledIds(ids);
    this.enabledModelIds = normalized;
    await writePrivateJsonFile(this.settingsPath, {
      version: 1,
      enabledModelIds: this.enabledModelIds,
    } satisfies StoredModelSettings);
    return [...this.enabledModelIds];
  }

  getEnabledModelIds(): string[] {
    return [...this.enabledModelIds];
  }

  defaultEnabledModelIds(): string[] {
    return STATIC_GEMINI_MODELS.filter((m) => m.defaultEnabled).map((m) => m.id);
  }

  mergedCatalog(quota?: QuotaSnapshotSummary): CatalogModelOption[] {
    const enabledSet = new Set(this.enabledModelIds);
    const quotaByModel = new Map<string, { remainingFraction?: number; resetTime?: string }>();
    const poolFallbackQuota = new Map<
      QuotaGroupSummary['pool'],
      { remainingFraction: number; resetTime?: string }
    >();

    for (const group of quota?.groups ?? []) {
      poolFallbackQuota.set(group.pool, {
        remainingFraction: group.remainingFraction,
        resetTime: group.resetTime,
      });
      for (const mId of group.modelIds) {
        quotaByModel.set(mId, {
          remainingFraction: group.remainingFraction,
          resetTime: group.resetTime,
        });
      }
    }

    const staticById = new Map(STATIC_GEMINI_MODELS.map((m) => [m.id, m]));
    const visibleDynamic = this.dynamicModels.filter((dyn) => {
      if (dyn.isInternal) return false;
      const effectiveText = `${dyn.id} ${dyn.displayName ?? ''}`;
      if (!this.config.includeNonGeminiModels && !isGeminiModelId(effectiveText)) {
        return false;
      }
      return true;
    });

    // Count occurrences of baseId with an effort suffix to detect new multi-variant families dynamically.
    const dynamicEffortCount = new Map<string, number>();
    for (const dyn of visibleDynamic) {
      const { baseId, effort } = extractEffortSuffix(dyn.id);
      if (effort) {
        dynamicEffortCount.set(baseId, (dynamicEffortCount.get(baseId) ?? 0) + 1);
      }
    }

    interface DynamicFamilyBucket {
      familyId: string;
      primary: UpstreamModelDescriptor;
      variants: Partial<Record<ReasoningEffortValue, UpstreamModelDescriptor>>;
      unsuffixedUpstreamId?: string;
    }

    const dynamicFamilies = new Map<string, DynamicFamilyBucket>();
    for (const dyn of visibleDynamic) {
      let familyId = dyn.id;
      let effort: ReasoningEffortValue | undefined;
      let unsuffixedUpstreamId: string | undefined;

      if (isPlaceholderModelId(dyn.id) && dyn.displayName) {
        const slug = displayNameToSlug(dyn.displayName);
        if (staticById.has(slug)) {
          familyId = slug;
          unsuffixedUpstreamId = dyn.id;
        }
      } else {
        const extracted = extractEffortSuffix(dyn.id);
        const shouldMerge =
          extracted.effort !== undefined &&
          (isKnownVariantFamily(extracted.baseId) ||
            staticById.has(extracted.baseId) ||
            (dynamicEffortCount.get(extracted.baseId) ?? 0) >= 2);
        if (shouldMerge) {
          familyId = extracted.baseId;
          effort = extracted.effort;
        }
      }

      let bucket = dynamicFamilies.get(familyId);
      if (!bucket) {
        bucket = {
          familyId,
          primary: dyn,
          variants: {},
          ...(unsuffixedUpstreamId ? { unsuffixedUpstreamId } : {}),
        };
        dynamicFamilies.set(familyId, bucket);
      } else if (unsuffixedUpstreamId && !bucket.unsuffixedUpstreamId) {
        bucket.unsuffixedUpstreamId = unsuffixedUpstreamId;
      }

      if (effort) {
        bucket.variants[effort] = dyn;
      }
    }

    const hasDynamic = this.dynamicModels.length > 0;
    const byId = new Map<string, CatalogModelOption>();
    this.upstreamFallbackIds.clear();

    for (const entry of STATIC_GEMINI_MODELS) {
      const q = quotaByModel.get(entry.id) ?? poolFallbackQuota.get(entry.pool);
      byId.set(entry.id, {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        enabled: enabledSet.has(entry.id),
        defaultEnabled: entry.defaultEnabled,
        contextWindow: entry.contextWindow,
        defaultMaxTokens: entry.defaultMaxTokens,
        supportsReasoning: entry.supportsReasoning,
        ...(entry.supportedEfforts ? { supportedEfforts: [...entry.supportedEfforts] } : {}),
        ...(entry.defaultEffort ? { defaultEffort: entry.defaultEffort } : {}),
        ...(entry.variantIds ? { variantIds: { ...entry.variantIds } } : {}),
        supportsImages: entry.supportsImages,
        pool: entry.pool,
        tierAccess: entry.tierAccess,
        ...(hasDynamic ? { isUpstreamAvailable: dynamicFamilies.has(entry.id) } : {}),
        ...(q?.remainingFraction !== undefined
          ? { remainingFraction: q.remainingFraction }
          : {}),
        ...(q?.resetTime ? { resetTime: q.resetTime } : {}),
        isDynamic: false,
      });
    }

    for (const [familyId, bucket] of dynamicFamilies) {
      const existing = byId.get(familyId);
      const dyn = bucket.primary;
      const variantEntries = EFFORT_ORDER.filter((eff) => bucket.variants[eff] !== undefined);
      const hasVariants = variantEntries.length > 0;

      const variantIds: Partial<Record<ReasoningEffortValue, string>> | undefined = hasVariants
        ? Object.fromEntries(
            variantEntries.map((eff) => [eff, bucket.variants[eff]!.id]),
          )
        : bucket.unsuffixedUpstreamId
          ? undefined
          : existing?.variantIds;

      if (bucket.unsuffixedUpstreamId && !hasVariants) {
        this.upstreamFallbackIds.set(familyId, bucket.unsuffixedUpstreamId);
      }

      const supportedEfforts: ReasoningEffortValue[] | undefined = hasVariants
        ? [...variantEntries]
        : existing?.supportedEfforts
          ? [...existing.supportedEfforts]
          : (dyn.supportsThinking ?? isGeminiModelId(familyId))
            ? ['low', 'medium', 'high']
            : undefined;

      const supportsReasoning =
        hasVariants ||
        (dyn.supportsThinking ?? existing?.supportsReasoning ?? isGeminiModelId(familyId));

      const defaultEffort =
        supportsReasoning && supportedEfforts && supportedEfforts.length > 0
          ? clampEffortToSupported(
              existing?.defaultEffort ?? this.config.defaultThinkingEffort,
              supportedEfforts,
            )
          : undefined;

      const pool =
        existing?.pool ??
        classifyPool(familyId, `${dyn.displayName ?? ''} ${dyn.modelProvider ?? ''}`);
      const tierAccess =
        existing?.tierAccess ?? inferModelTierAccess(familyId, dyn.displayName);

      // Compute conservative (minimum) remainingFraction across all variants in the family.
      const variantFractions = [
        dyn.remainingFraction,
        ...Object.values(bucket.variants).map((v) => v?.remainingFraction),
        quotaByModel.get(familyId)?.remainingFraction,
        ...Object.values(bucket.variants).map((v) =>
          v ? quotaByModel.get(v.id)?.remainingFraction : undefined,
        ),
      ].filter((f): f is number => typeof f === 'number');

      const minFraction =
        variantFractions.length > 0 ? Math.min(...variantFractions) : undefined;
      const fallbackQ = poolFallbackQuota.get(pool);
      const remainingFraction = minFraction ?? fallbackQ?.remainingFraction;
      const resetTime =
        dyn.resetTime ??
        Object.values(bucket.variants).find((v) => v?.resetTime)?.resetTime ??
        quotaByModel.get(familyId)?.resetTime ??
        fallbackQ?.resetTime;

      const cleanDisplayName = dyn.displayName
        ? stripEffortDisplaySuffix(dyn.displayName)
        : familyId;

      byId.set(familyId, {
        id: familyId,
        name: existing?.name ?? cleanDisplayName,
        description:
          existing?.description ??
          `Antigravity upstream model (${dyn.modelProvider ?? 'Google'})`,
        enabled: enabledSet.has(familyId),
        defaultEnabled: existing?.defaultEnabled ?? false,
        contextWindow: dyn.maxTokens ?? existing?.contextWindow ?? 1_048_576,
        defaultMaxTokens: dyn.maxOutputTokens ?? existing?.defaultMaxTokens ?? 65_536,
        supportsReasoning,
        ...(supportedEfforts ? { supportedEfforts } : {}),
        ...(defaultEffort ? { defaultEffort } : {}),
        ...(variantIds ? { variantIds } : {}),
        supportsImages: dyn.supportsImages ?? existing?.supportsImages ?? true,
        pool,
        tierAccess,
        isUpstreamAvailable: true,
        ...(remainingFraction !== undefined ? { remainingFraction } : {}),
        ...(resetTime ? { resetTime } : {}),
        isDynamic: !existing,
      });
    }

    const all = [...byId.values()];
    if (!hasDynamic) return all;
    // Place models returned by upstream fetchAvailableModels ahead of unlisted static fallbacks.
    return [
      ...all.filter((m) => m.isUpstreamAvailable),
      ...all.filter((m) => !m.isUpstreamAvailable),
    ];
  }

  async listModels(quota?: QuotaSnapshotSummary): Promise<readonly LlmModelInfo[]> {
    await this.ensureLoaded();
    const options = this.mergedCatalog(quota);
    const enabled = options.filter((o) => o.enabled);
    const finalExposed =
      enabled.length > 0 ? enabled : options.filter((o) => o.defaultEnabled);

    return finalExposed.map((opt) => {
      let badge: LlmModelBadge | undefined;
      if (opt.remainingFraction !== undefined) {
        badge = {
          text: `${Math.round(opt.remainingFraction * 100)}%`,
          tone:
            opt.remainingFraction <= 0.1
              ? 'warning'
              : opt.remainingFraction >= 0.5
                ? 'success'
                : 'neutral',
        };
      }
      const tierTag = tierTagLabel(opt.tierAccess ?? inferModelTierAccess(opt.id, opt.name));
      const suffix = tierTag
        ? `[${tierTag} · Antigravity Direct · Unofficial]`
        : `[Antigravity Direct · Unofficial]`;
      return {
        provider: PROVIDER_ID,
        id: opt.id,
        name: opt.name,
        description: `${opt.description} ${suffix}`,
        inputModalities: opt.supportsImages ? (['text', 'image'] as const) : (['text'] as const),
        ...(badge ? { badge } : {}),
      };
    });
  }

  resolveModel(modelId: string): LlmResolvedModelInfo {
    const canonical = normalizeModelId(modelId);
    const catalog = this.mergedCatalog();
    const option =
      catalog.find((m) => m.id === canonical || m.id === modelId) ??
      catalog[0] ??
      STATIC_GEMINI_MODELS[0];

    const resolvedId = option.id;
    const supported: readonly ReasoningEffortValue[] =
      option.supportedEfforts && option.supportedEfforts.length > 0
        ? option.supportedEfforts
        : ['low', 'medium', 'high'];

    const legacySuffixEffort = extractEffortSuffix(modelId).effort;
    const desiredDefault =
      legacySuffixEffort ??
      option.defaultEffort ??
      this.config.defaultThinkingEffort;
    const clampedDefault = clampEffortToSupported(desiredDefault, supported);

    const efforts = REASONING_EFFORTS.filter((e) =>
      supported.includes(e.id as ReasoningEffortValue),
    );

    return {
      provider: PROVIDER_ID,
      id: resolvedId,
      name: option.name,
      description: `${option.description} [Antigravity Direct · Unofficial]`,
      inputModalities: option.supportsImages ? ['text', 'image'] : ['text'],
      context: { contextWindow: option.contextWindow },
      defaultMaxTokens: option.defaultMaxTokens,
      ...(option.supportsReasoning
        ? {
            reasoning: {
              efforts: [...efforts],
              defaultEffort: ReasoningEffortId(clampedDefault),
            },
          }
        : {}),
      // Freeze top-level systemInstruction and place mid-conversation updates in history.
      systemPromptUpdate: 'in-history',
      // Omit toolUpdate so DSH resolves deferLoading tools cleanly on turn 0, keeping tools prefix constant.
    };
  }

  resolveUpstreamDispatch(
    modelId: string,
    requestedEffort?: string,
  ): UpstreamDispatchTarget {
    const canonical = normalizeModelId(modelId);
    const catalog = this.mergedCatalog();
    const option = catalog.find((m) => m.id === canonical || m.id === modelId);

    if (!option) {
      const legacy = extractEffortSuffix(modelId).effort;
      const effectiveEffort = isReasoningEffortValue(requestedEffort)
        ? requestedEffort
        : legacy;
      return {
        canonicalModel: canonical,
        upstreamModel: modelId.trim() || canonical,
        ...(effectiveEffort ? { effectiveEffort } : {}),
        fallbackUpstreamModels: [],
      };
    }

    if (!option.supportsReasoning) {
      const upstreamModel = this.upstreamFallbackIds.get(option.id) ?? option.id;
      return {
        canonicalModel: option.id,
        upstreamModel,
        fallbackUpstreamModels: [],
      };
    }

    const supported =
      option.supportedEfforts && option.supportedEfforts.length > 0
        ? option.supportedEfforts
        : (['low', 'medium', 'high'] as const);
    const legacySuffixEffort = extractEffortSuffix(modelId).effort;
    const rawDesired = isReasoningEffortValue(requestedEffort)
      ? requestedEffort
      : legacySuffixEffort ?? option.defaultEffort ?? this.config.defaultThinkingEffort;
    const effectiveEffort = clampEffortToSupported(rawDesired, supported);

    const variantMap = option.variantIds;
    const upstreamModel =
      variantMap?.[effectiveEffort] ??
      this.upstreamFallbackIds.get(option.id) ??
      option.id;

    // Build ordered fallback variants (prefer lower/nearby tiers if the chosen variant fails 404).
    const fallbackUpstreamModels: string[] = [];
    if (variantMap) {
      const idx = EFFORT_ORDER.indexOf(effectiveEffort);
      for (let i = idx - 1; i >= 0; i -= 1) {
        const candidate = variantMap[EFFORT_ORDER[i]!];
        if (candidate && candidate !== upstreamModel) {
          fallbackUpstreamModels.push(candidate);
        }
      }
      for (let i = idx + 1; i < EFFORT_ORDER.length; i += 1) {
        const candidate = variantMap[EFFORT_ORDER[i]!];
        if (candidate && candidate !== upstreamModel) {
          fallbackUpstreamModels.push(candidate);
        }
      }
    }

    return {
      canonicalModel: option.id,
      upstreamModel,
      effectiveEffort,
      fallbackUpstreamModels,
    };
  }
}
