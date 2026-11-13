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

export interface StaticModelEntry {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  contextWindow: number;
  defaultMaxTokens: number;
  supportsReasoning: boolean;
  defaultEffort?: ReasoningEffortValue;
  supportsImages: boolean;
  pool: QuotaGroupSummary['pool'];
  tierAccess: ModelTierAccess;
  isGemini3Series?: boolean;
}

export const STATIC_GEMINI_MODELS: readonly StaticModelEntry[] = [
  {
    id: 'gemini-4-hydrogen-xhigh',
    name: 'Gemini 4 Hydrogen (XHigh)',
    description: 'Antigravity Gemini 4 Hydrogen with maximum XHigh reasoning',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-hydrogen-high',
    name: 'Gemini 4 Hydrogen (High)',
    description: 'Antigravity Gemini 4 Hydrogen flagship with high reasoning',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-hydrogen-medium',
    name: 'Gemini 4 Hydrogen (Medium)',
    description: 'Balanced Gemini 4 Hydrogen tier for everyday coding',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-hydrogen-low',
    name: 'Gemini 4 Hydrogen (Low)',
    description: 'Fast Gemini 4 Hydrogen tier with light thinking overhead',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'low',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-argon-high',
    name: 'Gemini 4 Argon (High)',
    description: 'Gemini 4 Argon high-reasoning model for Pro & Ultra plans',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-argon-medium',
    name: 'Gemini 4 Argon (Medium)',
    description: 'Gemini 4 Argon balanced tier for Pro & Ultra plans',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-argon-low',
    name: 'Gemini 4 Argon (Low)',
    description: 'Fast Gemini 4 Argon tier for Pro & Ultra plans',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'low',
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
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-carbon-high',
    name: 'Gemini 4 Carbon (High)',
    description: 'Gemini 4 Carbon deep reasoning tier (Ultra / entitled accounts)',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'ultra',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-carbon-medium',
    name: 'Gemini 4 Carbon (Medium)',
    description: 'Gemini 4 Carbon balanced tier (Ultra / entitled accounts)',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'ultra',
    isGemini3Series: true,
  },
  {
    id: 'gemini-4-carbon-low',
    name: 'Gemini 4 Carbon (Low)',
    description: 'Gemini 4 Carbon fast tier (Ultra / entitled accounts)',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'low',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'ultra',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High)',
    description: 'Gemini 3.8 Flash with deep thinking for fast agent loops',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium)',
    description: 'Gemini 3.8 Flash balanced speed & reasoning tier',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'medium',
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low)',
    description: 'Ultra-low-latency Gemini 3.8 Flash tier',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'low',
    supportsImages: true,
    pool: 'gemini-flash',
    tierAccess: 'all',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro (High)',
    description: 'Legacy Gemini 3.1 Pro with deep thinking',
    defaultEnabled: true,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'high',
    supportsImages: true,
    pool: 'gemini-pro',
    tierAccess: 'pro',
    isGemini3Series: true,
  },
  {
    id: 'gemini-3.1-pro-low',
    name: 'Gemini 3.1 Pro (Low)',
    description: 'Fast Gemini 3.1 Pro tier with light thinking overhead',
    defaultEnabled: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
    supportsReasoning: true,
    defaultEffort: 'low',
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
  'gemini-3-pro-high': 'gemini-3.1-pro-high',
  'gemini-3-pro-low': 'gemini-3.1-pro-low',
  'gemini-3.0-pro': 'gemini-3.1-pro-high',
  'gemini-3.0-flash': 'gemini-3-flash',
  'gemini-3-flash-preview': 'gemini-3-flash',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro-high',
};

const REASONING_EFFORTS = [
  { id: ReasoningEffortId('low'), name: 'Low', description: 'Minimal thinking overhead' },
  { id: ReasoningEffortId('medium'), name: 'Medium', description: 'Balanced reasoning depth' },
  { id: ReasoningEffortId('high'), name: 'High', description: 'Maximum reasoning depth' },
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

export function isGeminiModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes('gemini');
}

export function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  return MODEL_ALIASES[trimmed] ?? trimmed;
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

  constructor(private readonly config: AntigravityPluginConfig) {
    const storageDir = resolveAntigravityStorageDir(config.storageDir);
    this.settingsPath = path.join(storageDir, 'models.json');
    this.cachePath = path.join(storageDir, 'catalog-cache.json');
    this.enabledModelIds = STATIC_GEMINI_MODELS.filter((m) => m.defaultEnabled).map(
      (m) => m.id,
    );
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await readJsonFile<StoredModelSettings>(this.settingsPath).catch(
      () => undefined,
    );
    if (saved && Array.isArray(saved.enabledModelIds)) {
      this.enabledModelIds = [...new Set(saved.enabledModelIds.filter((s) => typeof s === 'string' && s.trim() !== ''))];
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
    this.enabledModelIds = [
      ...new Set(ids.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim())),
    ];
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

    const hasDynamic = this.dynamicModels.length > 0;
    const dynamicIds = new Set(this.dynamicModels.map((m) => m.id));
    const byId = new Map<string, CatalogModelOption>();

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
        supportsImages: entry.supportsImages,
        pool: entry.pool,
        tierAccess: entry.tierAccess,
        ...(hasDynamic ? { isUpstreamAvailable: dynamicIds.has(entry.id) } : {}),
        ...(q?.remainingFraction !== undefined
          ? { remainingFraction: q.remainingFraction }
          : {}),
        ...(q?.resetTime ? { resetTime: q.resetTime } : {}),
        isDynamic: false,
      });
    }

    for (const dyn of this.dynamicModels) {
      if (dyn.isInternal) continue;
      if (!this.config.includeNonGeminiModels && !isGeminiModelId(dyn.id)) {
        continue;
      }
      const existing = byId.get(dyn.id);
      const pool = existing?.pool ?? classifyPool(dyn.id, `${dyn.displayName ?? ''} ${dyn.modelProvider ?? ''}`);
      const tierAccess = existing?.tierAccess ?? inferModelTierAccess(dyn.id, dyn.displayName);
      const q =
        dyn.remainingFraction !== undefined
          ? { remainingFraction: dyn.remainingFraction, resetTime: dyn.resetTime }
          : quotaByModel.get(dyn.id) ?? poolFallbackQuota.get(pool);

      byId.set(dyn.id, {
        id: dyn.id,
        name: existing?.name ?? dyn.displayName ?? dyn.id,
        description:
          existing?.description ??
          `Antigravity upstream model (${dyn.modelProvider ?? 'Google'})`,
        enabled: enabledSet.has(dyn.id),
        defaultEnabled: existing?.defaultEnabled ?? false,
        contextWindow: dyn.maxTokens ?? existing?.contextWindow ?? 1_048_576,
        defaultMaxTokens: dyn.maxOutputTokens ?? existing?.defaultMaxTokens ?? 65_536,
        supportsReasoning:
          dyn.supportsThinking ?? existing?.supportsReasoning ?? isGeminiModelId(dyn.id),
        supportsImages: dyn.supportsImages ?? existing?.supportsImages ?? true,
        pool,
        tierAccess,
        isUpstreamAvailable: true,
        ...(q?.remainingFraction !== undefined
          ? { remainingFraction: q.remainingFraction }
          : {}),
        ...(q?.resetTime ? { resetTime: q.resetTime } : {}),
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
    const option =
      this.mergedCatalog().find((m) => m.id === canonical || m.id === modelId) ??
      STATIC_GEMINI_MODELS[0];

    const resolvedId = canonical || option.id;
    const defaultEffortId =
      this.config.defaultThinkingEffort !== 'auto'
        ? ReasoningEffortId(this.config.defaultThinkingEffort)
        : option.id.endsWith('-high') || option.id.endsWith('-xhigh') || option.id.endsWith('-max')
          ? ReasoningEffortId('high')
          : option.id.endsWith('-low')
            ? ReasoningEffortId('low')
            : ReasoningEffortId('medium');

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
              efforts: [...REASONING_EFFORTS],
              defaultEffort: defaultEffortId,
            },
          }
        : {}),
      // Freeze top-level systemInstruction and place mid-conversation updates in history.
      systemPromptUpdate: 'in-history',
      // Omit toolUpdate so DSH resolves deferLoading tools cleanly on turn 0, keeping tools prefix constant.
    };
  }
}
