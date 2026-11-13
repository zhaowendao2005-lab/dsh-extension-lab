import Schema from '@deepseek-ai/schemastery';
import type { ReasoningEffortValue } from '../shared/types.ts';

export const PROVIDER_ID = 'antigravity' as const;
export const PROVIDER_DISPLAY_NAME = 'Antigravity (Cloud Code · Unofficial)';

export const DEFAULT_ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
] as const;

export const DEFAULT_QUOTA_WARN_THRESHOLD = 0.15;
export const DEFAULT_QUOTA_EXHAUSTED_THRESHOLD = 0.05;
export const DEFAULT_FAILURE_SWITCH_THRESHOLD = 3;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_OAUTH_PORT = 51121;
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4_194_304;
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1_048_576;

export interface AntigravityPluginConfig {
  userAgent?: string;
  endpoints: string[];
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthPort: number;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  quotaWarnThreshold: number;
  quotaExhaustedThreshold: number;
  failureSwitchThreshold: number;
  includeNonGeminiModels: boolean;
  defaultThinkingEffort: ReasoningEffortValue;
  storageDir?: string;
  requestImagePixelBudget: number;
  requestImageMaxBytes: number;
}

const effortEnum = (Schema.union as (values: string[]) => any)([
  'low',
  'medium',
  'high',
  'xhigh',
]).default('high');

export const Config = Schema.object({
  userAgent: Schema.string()
    .description('Optional Hub User-Agent override (sanitized against Antigravity Hub version floor)')
    .volatile(),
  endpoints: Schema.array(Schema.string())
    .default([...DEFAULT_ENDPOINTS])
    .description('Ordered Cloud Code internal endpoints (Daily -> Sandbox -> Prod)')
    .volatile(),
  oauthPort: Schema.number()
    .min(1024)
    .max(65535)
    .default(DEFAULT_OAUTH_PORT)
    .description('Preferred localhost port for OAuth PKCE callback listener')
    .volatile(),
  requestTimeoutMs: Schema.number()
    .min(5000)
    .max(600000)
    .default(DEFAULT_REQUEST_TIMEOUT_MS)
    .description('HTTP request / header connect timeout in milliseconds')
    .volatile(),
  streamIdleTimeoutMs: Schema.number()
    .min(5000)
    .max(600000)
    .default(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    .description('Streaming idle watchdog timeout between SSE chunks in milliseconds')
    .volatile(),
  quotaWarnThreshold: Schema.number()
    .min(0.01)
    .max(0.9)
    .default(DEFAULT_QUOTA_WARN_THRESHOLD)
    .description('Remaining quota fraction below which UI warns user')
    .volatile(),
  quotaExhaustedThreshold: Schema.number()
    .min(0)
    .max(0.5)
    .default(DEFAULT_QUOTA_EXHAUSTED_THRESHOLD)
    .description('Remaining quota fraction at or below which sticky session switches account')
    .volatile(),
  failureSwitchThreshold: Schema.number()
    .min(1)
    .max(10)
    .default(DEFAULT_FAILURE_SWITCH_THRESHOLD)
    .description('Consecutive AUTH/QUOTA/RATE_LIMIT failures on same account before switching')
    .volatile(),
  includeNonGeminiModels: Schema.boolean()
    .default(false)
    .description('Expose non-Gemini models returned by fetchAvailableModels (experimental)')
    .volatile(),
  defaultThinkingEffort: effortEnum
    .description('Default reasoning effort when caller omits reasoningEffort')
    .volatile(),
  storageDir: Schema.string()
    .description('Optional override directory for Antigravity credentials and settings')
    .volatile(),
});

function sanitizeEndpointList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ENDPOINTS];
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().replace(/\/+$/, '');
    if (trimmed.startsWith('https://')) cleaned.push(trimmed);
  }
  return cleaned.length > 0 ? [...new Set(cleaned)] : [...DEFAULT_ENDPOINTS];
}

function clampNumber(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const clamped = Math.min(max, Math.max(min, raw));
  return integer ? Math.trunc(clamped) : clamped;
}

export function normalizeConfig(raw: unknown): AntigravityPluginConfig {
  const input =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const userAgent =
    typeof input.userAgent === 'string' && input.userAgent.trim() !== ''
      ? input.userAgent.trim()
      : undefined;
  const storageDir =
    typeof input.storageDir === 'string' && input.storageDir.trim() !== ''
      ? input.storageDir.trim()
      : undefined;
  const oauthClientId =
    typeof input.oauthClientId === 'string' && input.oauthClientId.trim() !== ''
      ? input.oauthClientId.trim()
      : undefined;
  const oauthClientSecret =
    typeof input.oauthClientSecret === 'string' && input.oauthClientSecret.trim() !== ''
      ? input.oauthClientSecret.trim()
      : undefined;
  const effort = input.defaultThinkingEffort;
  const defaultThinkingEffort: ReasoningEffortValue =
    effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
      ? effort
      : 'high';

  const quotaExhaustedThreshold = clampNumber(
    input.quotaExhaustedThreshold,
    DEFAULT_QUOTA_EXHAUSTED_THRESHOLD,
    0,
    0.5,
  );
  const quotaWarnThreshold = Math.max(
    quotaExhaustedThreshold,
    clampNumber(input.quotaWarnThreshold, DEFAULT_QUOTA_WARN_THRESHOLD, 0.01, 0.9),
  );

  return {
    userAgent,
    endpoints: sanitizeEndpointList(input.endpoints),
    oauthClientId,
    oauthClientSecret,
    oauthPort: clampNumber(input.oauthPort, DEFAULT_OAUTH_PORT, 1024, 65535, true),
    requestTimeoutMs: clampNumber(
      input.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      5000,
      600_000,
      true,
    ),
    streamIdleTimeoutMs: clampNumber(
      input.streamIdleTimeoutMs,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      5000,
      600_000,
      true,
    ),
    quotaWarnThreshold,
    quotaExhaustedThreshold,
    failureSwitchThreshold: clampNumber(
      input.failureSwitchThreshold,
      DEFAULT_FAILURE_SWITCH_THRESHOLD,
      1,
      10,
      true,
    ),
    includeNonGeminiModels: input.includeNonGeminiModels === true,
    defaultThinkingEffort,
    storageDir,
    requestImagePixelBudget: clampNumber(
      input.requestImagePixelBudget,
      DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
      1,
      33_554_432,
      true,
    ),
    requestImageMaxBytes: clampNumber(
      input.requestImageMaxBytes,
      DEFAULT_REQUEST_IMAGE_MAX_BYTES,
      1024,
      20_971_520,
      true,
    ),
  };
}
