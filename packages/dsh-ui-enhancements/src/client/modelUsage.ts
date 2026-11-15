import type { CatalogProvider } from '../shared/contract'

export interface ModelUsageEntry {
  providerId: string
  modelId: string
}

/** Newest confirmed selection first; deliberately independent of session ids. */
export type ModelUsageHistory = ModelUsageEntry[]

const STORAGE_KEY = 'dsh-ui-enhancements:model-usage:v1'

function normalizeHistory(value: unknown): ModelUsageHistory {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.filter((entry): entry is ModelUsageEntry => {
    if (
      !entry ||
      typeof entry.providerId !== 'string' || !entry.providerId ||
      typeof entry.modelId !== 'string' || !entry.modelId
    ) return false
    const key = JSON.stringify([entry.providerId, entry.modelId])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(({ providerId, modelId }) => ({ providerId, modelId }))
}

export function loadModelUsage(fallback: ModelUsageHistory = []): ModelUsageHistory {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? fallback : normalizeHistory(JSON.parse(raw))
  } catch (error) {
    console.warn('[ui-enhancements] cannot read model usage history', error)
    return fallback
  }
}

export function recordModelUsage(
  history: ModelUsageHistory,
  selection: ModelUsageEntry,
): ModelUsageHistory {
  // Read again before writing so another window's latest selections are retained.
  const latest = loadModelUsage(history)
  const next = [
    { providerId: selection.providerId, modelId: selection.modelId },
    ...latest.filter((entry) =>
      entry.providerId !== selection.providerId || entry.modelId !== selection.modelId,
    ),
  ]
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    // The picker still remembers selections in memory when storage is unavailable.
    console.warn('[ui-enhancements] cannot persist model usage history', error)
  }
  return next
}

/** Provider recency comes first, followed by model recency within each provider. */
export function sortProvidersByUsage(
  providers: CatalogProvider[],
  history: ModelUsageHistory,
): CatalogProvider[] {
  const providerOrder = new Map<string, number>()
  const modelOrder = new Map<string, Map<string, number>>()
  history.forEach(({ providerId, modelId }, index) => {
    if (!providerOrder.has(providerId)) providerOrder.set(providerId, index)
    let models = modelOrder.get(providerId)
    if (!models) {
      models = new Map<string, number>()
      modelOrder.set(providerId, models)
    }
    if (!models.has(modelId)) models.set(modelId, index)
  })
  // Equal ranks keep the original catalog order, including never-used entries.
  const unused = history.length
  return [...providers]
    .sort((a, b) => (providerOrder.get(a.id) ?? unused) - (providerOrder.get(b.id) ?? unused))
    .map((provider) => {
      const order = modelOrder.get(provider.id)
      return {
        ...provider,
        models: [...provider.models].sort((a, b) =>
          (order?.get(a.id) ?? unused) - (order?.get(b.id) ?? unused),
        ),
      }
    })
}
