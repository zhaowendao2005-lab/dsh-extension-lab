/** Internal host types for the BTW side-ask plugin. */

export interface BtwConfig {
  commandName: string
  onConflict: 'rename' | 'disable'
  barForm: 'dock' | 'right-tab'
  compression: 'inherit' | 'isolated' | 'direct'
  maxTokens: number
  timeoutMs: number
  maxConcurrent: number
  maxPerSession: number
  showProvenance: boolean
}

export interface BtwSnapshot {
  sessionId: string
  capturedAt: number
  provider: string
  model: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  tools?: unknown[]
  messageCount: number
}

export const DEFAULT_CONFIG: BtwConfig = {
  commandName: 'btw',
  onConflict: 'rename',
  barForm: 'dock',
  compression: 'inherit',
  maxTokens: 8192,
  timeoutMs: 120_000,
  maxConcurrent: 3,
  maxPerSession: 20,
  showProvenance: true,
}

export function normalizeConfig(input: unknown): BtwConfig {
  const raw = (input ?? {}) as Record<string, unknown>
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  const num = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  return {
    commandName:
      typeof raw.commandName === 'string' && /^[A-Za-z][\w-]{0,31}$/.test(raw.commandName)
        ? raw.commandName
        : DEFAULT_CONFIG.commandName,
    onConflict: pick(raw.onConflict, ['rename', 'disable'] as const, 'rename'),
    barForm: pick(raw.barForm, ['dock', 'right-tab'] as const, 'dock'),
    compression: pick(raw.compression, ['inherit', 'isolated', 'direct'] as const, 'inherit'),
    maxTokens: Math.round(num(raw.maxTokens, DEFAULT_CONFIG.maxTokens, 64, 8192)),
    timeoutMs: Math.round(num(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs, 1_000, 300_000)),
    maxConcurrent: Math.round(num(raw.maxConcurrent, DEFAULT_CONFIG.maxConcurrent, 1, 16)),
    maxPerSession: Math.round(num(raw.maxPerSession, DEFAULT_CONFIG.maxPerSession, 1, 20)),
    showProvenance: typeof raw.showProvenance === 'boolean' ? raw.showProvenance : true,
  }
}
