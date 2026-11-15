import Schema from '@deepseek-ai/schemastery';
import type { DiagnosticMode, ReasoningEffortValue } from '../shared/types.ts';

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
export const DEFAULT_DIAGNOSTIC_RETAIN_DAYS = 7;

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
  wirePolicyV2: boolean;
  retrySafetyV2: boolean;
  diagnosticMode: DiagnosticMode;
  diagnosticRetainDays: number;
}

const effortEnum = (Schema.union as (values: string[]) => any)([
  'low',
  'medium',
  'high',
  'xhigh',
]).default('high');

const diagnosticModeEnum = (Schema.union as (values: string[]) => any)([
  'off',
  'metadata',
]).default('off');

export const Config = Schema.object({
  userAgent: Schema.string().description(
    'Optional Hub User-Agent override (sanitized against Antigravity Hub version floor)',
  ),
  endpoints: Schema.array(Schema.string())
    .default([...DEFAULT_ENDPOINTS])
    .description('Ordered Cloud Code internal endpoints (Daily -> Sandbox -> Prod)'),
  oauthPort: Schema.number()
    .min(1024)
    .max(65535)
    .default(DEFAULT_OAUTH_PORT)
    .description('Preferred localhost port for OAuth PKCE callback listener'),
  requestTimeoutMs: Schema.number()
    .min(5000)
    .max(600000)
    .default(DEFAULT_REQUEST_TIMEOUT_MS)
    .description('HTTP request / header connect timeout in milliseconds'),
  streamIdleTimeoutMs: Schema.number()
    .min(5000)
    .max(600000)
    .default(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    .description('Streaming idle watchdog timeout between SSE chunks in milliseconds'),
  quotaWarnThreshold: Schema.number()
    .min(0.01)
    .max(0.9)
    .default(DEFAULT_QUOTA_WARN_THRESHOLD)
    .description('Remaining quota fraction below which UI warns user'),
  quotaExhaustedThreshold: Schema.number()
    .min(0)
    .max(0.5)
    .default(DEFAULT_QUOTA_EXHAUSTED_THRESHOLD)
    .description('Remaining quota fraction at or below which sticky session switches account'),
  failureSwitchThreshold: Schema.number()
    .min(1)
    .max(10)
    .default(DEFAULT_FAILURE_SWITCH_THRESHOLD)
    .description('Consecutive AUTH/QUOTA/RATE_LIMIT failures on same account before switching'),
  includeNonGeminiModels: Schema.boolean()
    .default(false)
    .description('Expose non-Gemini models returned by fetchAvailableModels (experimental)'),
  defaultThinkingEffort: effortEnum.description(
    'Default reasoning effort when caller omits reasoningEffort',
  ),
  storageDir: Schema.string().description(
    'Optional override directory for Antigravity credentials and settings',
  ),
  wirePolicyV2: Schema.boolean()
    .default(true)
    .description('Separate model capability ceilings from default maxOutputTokens policy and gated enabledCreditTypes'),
  retrySafetyV2: Schema.boolean()
    .default(true)
    .description('Enable strict 429/RetryInfo/quotaResetDelay classification and stop rapid 600ms retry loops'),
  diagnosticMode: diagnosticModeEnum.description(
    'Sanitized protocol metadata trace mode written to private DSH plugin storage (off by default)',
  ),
  diagnosticRetainDays: Schema.number()
    .min(1)
    .max(30)
    .default(DEFAULT_DIAGNOSTIC_RETAIN_DAYS)
    .description('Retention window in days for rotated sanitized protocol diagnostics'),
});

function unwrapVolatile(raw: unknown): unknown {
  let current = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      current !== null &&
      typeof current === 'object' &&
      'get' in current &&
      typeof (current as { get?: unknown }).get === 'function'
    ) {
      current = (current as { get: () => unknown }).get();
      continue;
    }
    break;
  }
  return current;
}

function isAllowedEndpointUrl(trimmed: string): boolean {
  if (trimmed.startsWith('https://')) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:') return false;
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function sanitizeEndpointList(raw: unknown): string[] {
  const value = unwrapVolatile(raw);
  if (!Array.isArray(value)) return [...DEFAULT_ENDPOINTS];
  const cleaned: string[] = [];
  for (const entry of value) {
    const item = unwrapVolatile(entry);
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\/+$/, '');
    if (isAllowedEndpointUrl(trimmed)) cleaned.push(trimmed);
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
  const value = unwrapVolatile(raw);
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.trunc(clamped) : clamped;
}

function readOptionalNonEmptyString(raw: unknown): string | undefined {
  const value = unwrapVolatile(raw);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  const value = unwrapVolatile(raw);
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeConfig(raw: unknown): AntigravityPluginConfig {
  const unwrappedRoot = unwrapVolatile(raw);
  const input =
    unwrappedRoot !== null && typeof unwrappedRoot === 'object'
      ? (unwrappedRoot as Record<string, unknown>)
      : {};
  const userAgent = readOptionalNonEmptyString(input.userAgent);
  const storageDir = readOptionalNonEmptyString(input.storageDir);
  const oauthClientId = readOptionalNonEmptyString(input.oauthClientId);
  const oauthClientSecret = readOptionalNonEmptyString(input.oauthClientSecret);
  const effort = unwrapVolatile(input.defaultThinkingEffort);
  const defaultThinkingEffort: ReasoningEffortValue =
    effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
      ? effort
      : 'high';

  const diagRaw = unwrapVolatile(input.diagnosticMode);
  const diagnosticMode: DiagnosticMode = diagRaw === 'metadata' ? 'metadata' : 'off';

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
    includeNonGeminiModels: readBoolean(input.includeNonGeminiModels, false),
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
    wirePolicyV2: readBoolean(input.wirePolicyV2, true),
    retrySafetyV2: readBoolean(input.retrySafetyV2, true),
    diagnosticMode,
    diagnosticRetainDays: clampNumber(
      input.diagnosticRetainDays,
      DEFAULT_DIAGNOSTIC_RETAIN_DAYS,
      1,
      30,
      true,
    ),
  };
}
