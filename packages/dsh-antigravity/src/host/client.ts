import { LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm';
import type { AntigravityPluginConfig } from './config.ts';
import {
  NOOP_DIAGNOSTIC_OBSERVER,
  sanitizeErrorDetailText,
  type ProtocolDiagnosticEventInput,
  type ProtocolDiagnosticObserver,
} from './diagnostics.ts';
import { buildOutboundHeaders } from './identity.ts';

export type LlmErrorCode =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE_LIMIT'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'SERVER'
  | 'TRANSPORT'
  | 'EMPTY_RESPONSE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type StickyFailureCategory =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'CONTEXT_LENGTH'
  | 'SERVER'
  | 'TRANSPORT'
  | 'UNKNOWN';

export type RetryDelaySource =
  | 'retry_info'
  | 'quota_reset_delay'
  | 'retry_after_header'
  | 'body_regex'
  | 'none';

export type Upstream429SubType =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'resource_exhausted_unknown';

export interface ClassifiedUpstreamError {
  code: LlmErrorCode;
  category: StickyFailureCategory;
  status?: number;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  quotaResetDelayMs?: number;
  delaySource?: RetryDelaySource;
  subType?: Upstream429SubType;
  errorReason?: string;
  errorStatus?: string;
  sanitizedDetail?: string;
  isOneMillionContextError: boolean;
  isSignatureError: boolean;
  isModelNotFound: boolean;
}

const DEFAULT_ENDPOINT_COOLDOWN_MS = 30_000;
const SANDBOX_ENDPOINT_COOLDOWN_MS = 60_000;
const SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES = 1;
const SAME_ACCOUNT_MAX_WAIT_MS = 8_000;
const SAME_ACCOUNT_MAX_WAIT_V2_MS = 15_000;
const SAME_ACCOUNT_MIN_WAIT_V2_MS = 1_000;

export function isSandboxEndpoint(urlOrHost: string): boolean {
  return urlOrHost.toLowerCase().includes('sandbox.googleapis.com');
}

/**
 * AGM v5.0.3 endpoint fallback policy:
 * Only switch endpoints on network/transport failure, 408, 404, 5xx,
 * or Sandbox 400 ("User location is not supported").
 * Never switch endpoints on Daily/Prod 400, 401, 403, or 429.
 */
export function shouldTryNextEndpoint(status: number, endpointUrl: string): boolean {
  if (status === 408 || status === 404 || status >= 500) {
    return true;
  }
  if (status === 400 && isSandboxEndpoint(endpointUrl)) {
    return true;
  }
  return false;
}

const DURATION_PART_RE =
  /([\d.]+)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)/gi;

export function parseDurationMs(raw: string): number | undefined {
  let totalMs = 0;
  let matched = false;
  DURATION_PART_RE.lastIndex = 0;
  for (const match of raw.matchAll(DURATION_PART_RE)) {
    matched = true;
    const val = Number(match[1]);
    if (!Number.isFinite(val)) return undefined;
    const unit = match[2].toLowerCase();
    if (unit === 'ms' || unit.startsWith('millisecond')) {
      totalMs += val;
    } else if (unit === 's' || unit.startsWith('sec')) {
      totalMs += val * 1000;
    } else if (unit === 'm' || unit.startsWith('min')) {
      totalMs += val * 60 * 1000;
    } else if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) {
      totalMs += val * 60 * 60 * 1000;
    }
  }
  if (!matched || totalMs <= 0) return undefined;
  return Math.round(totalMs);
}

const TEXT_DELAY_PATTERNS = [
  /quota will reset after ([^.,;\]\n]+)/i,
  /quota will reset in ([^.,;\]\n]+)/i,
  /resets in ([^.,;\]\n]+)/i,
  /retry after ([^.,;\]\n]+)/i,
  /reset after ([^.,;\]\n]+)/i,
  /try again in ([^.,;\]\n]+)/i,
  /backoff for ([^.,;\]\n]+)/i,
];

function extractStructuredRetryMs(obj: unknown, depth = 0): number | undefined {
  if (depth > 8 || obj === null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractStructuredRetryMs(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    const norm = k.replaceAll('_', '').toLowerCase();
    if (
      norm === 'retryafter' ||
      norm === 'retrydelay' ||
      norm === 'quotaresetdelay'
    ) {
      if (typeof v === 'string') {
        const parsed = parseDurationMs(v);
        if (parsed !== undefined) return parsed;
        const asSec = Number(v);
        if (Number.isFinite(asSec) && asSec > 0) return Math.round(asSec * 1000);
      } else if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        return Math.round(v * 1000);
      }
    }
    const nested = extractStructuredRetryMs(v, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export interface ParsedRetryDelayDetails {
  retryAfterMs?: number;
  quotaResetDelayMs?: number;
  delaySource: RetryDelaySource;
  errorReason?: string;
  errorStatus?: string;
}

function parseDurationOrSeconds(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const parsed = parseDurationMs(v);
    if (parsed !== undefined) return parsed;
    const asSec = Number(v);
    if (Number.isFinite(asSec) && asSec > 0) return Math.round(asSec * 1000);
  } else if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return Math.round(v * 1000);
  }
  return undefined;
}

function extractRpcStructuredMeta(parsedJson: unknown): {
  retryInfoDelayMs?: number;
  quotaResetDelayMs?: number;
  fallbackDelayMs?: number;
  errorReason?: string;
  errorStatus?: string;
} {
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return {};
  }
  const root = parsedJson as Record<string, unknown>;
  const errObj =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : root;
  const errorStatus =
    typeof errObj.status === 'string' && errObj.status.trim() !== ''
      ? errObj.status.trim()
      : undefined;

  let retryInfoDelayMs: number | undefined;
  let quotaResetDelayMs: number | undefined;
  let errorReason: string | undefined;

  const details = Array.isArray(errObj.details) ? errObj.details : [];
  for (const item of details) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const typeStr = typeof rec['@type'] === 'string' ? rec['@type'] : '';

    if (typeof rec.reason === 'string' && rec.reason.trim() !== '' && !errorReason) {
      errorReason = rec.reason.trim();
    }

    if (typeStr.includes('RetryInfo') || 'retryDelay' in rec || 'retry_delay' in rec) {
      const delay = parseDurationOrSeconds(rec.retryDelay ?? rec.retry_delay);
      if (delay !== undefined && retryInfoDelayMs === undefined) {
        retryInfoDelayMs = delay;
      }
    }

    const meta =
      rec.metadata && typeof rec.metadata === 'object' && !Array.isArray(rec.metadata)
        ? (rec.metadata as Record<string, unknown>)
        : undefined;
    if (meta) {
      const qDelay = parseDurationOrSeconds(
        meta.quotaResetDelay ?? meta.quota_reset_delay,
      );
      if (qDelay !== undefined && quotaResetDelayMs === undefined) {
        quotaResetDelayMs = qDelay;
      }
      const mRetry = parseDurationOrSeconds(meta.retryDelay ?? meta.retry_delay);
      if (mRetry !== undefined && retryInfoDelayMs === undefined) {
        retryInfoDelayMs = mRetry;
      }
    }
  }

  const fallbackDelayMs = extractStructuredRetryMs(parsedJson);
  return {
    retryInfoDelayMs,
    quotaResetDelayMs,
    fallbackDelayMs,
    errorReason,
    errorStatus,
  };
}

export function parseRetryDelayDetails(
  bodyText: string,
  retryAfterHeader?: string | null,
): ParsedRetryDelayDetails {
  let rpcMeta: ReturnType<typeof extractRpcStructuredMeta> = {};
  try {
    const parsedJson = JSON.parse(bodyText);
    rpcMeta = extractRpcStructuredMeta(parsedJson);
  } catch {
    // Non-JSON body; inspect header & regex patterns.
  }

  let headerRetryMs: number | undefined;
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      headerRetryMs = Math.round(numeric * 1000) + 200;
    } else {
      const parsedDur = parseDurationMs(trimmed);
      if (parsedDur !== undefined) {
        headerRetryMs = parsedDur + 200;
      } else {
        const dateMs = Date.parse(trimmed);
        if (Number.isFinite(dateMs)) {
          const diff = dateMs - Date.now();
          if (diff > 0) headerRetryMs = Math.round(diff) + 200;
        }
      }
    }
  }

  if (rpcMeta.retryInfoDelayMs !== undefined) {
    return {
      retryAfterMs: rpcMeta.retryInfoDelayMs + 200,
      ...(rpcMeta.quotaResetDelayMs !== undefined
        ? { quotaResetDelayMs: rpcMeta.quotaResetDelayMs }
        : {}),
      delaySource: 'retry_info',
      ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
      ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
    };
  }

  if (rpcMeta.quotaResetDelayMs !== undefined) {
    return {
      retryAfterMs: rpcMeta.quotaResetDelayMs + 200,
      quotaResetDelayMs: rpcMeta.quotaResetDelayMs,
      delaySource: 'quota_reset_delay',
      ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
      ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
    };
  }

  if (headerRetryMs !== undefined) {
    return {
      retryAfterMs: headerRetryMs,
      delaySource: 'retry_after_header',
      ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
      ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
    };
  }

  if (rpcMeta.fallbackDelayMs !== undefined) {
    return {
      retryAfterMs: rpcMeta.fallbackDelayMs + 200,
      delaySource: 'body_regex',
      ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
      ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
    };
  }

  for (const re of TEXT_DELAY_PATTERNS) {
    const match = re.exec(bodyText);
    if (match?.[1]) {
      const parsed = parseDurationMs(match[1]);
      if (parsed !== undefined) {
        return {
          retryAfterMs: parsed + 1000,
          delaySource: 'body_regex',
          ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
          ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
        };
      }
    }
  }

  return {
    delaySource: 'none',
    ...(rpcMeta.errorReason ? { errorReason: rpcMeta.errorReason } : {}),
    ...(rpcMeta.errorStatus ? { errorStatus: rpcMeta.errorStatus } : {}),
  };
}

export function parseRetryDelayMs(
  bodyText: string,
  retryAfterHeader?: string | null,
): number | undefined {
  return parseRetryDelayDetails(bodyText, retryAfterHeader).retryAfterMs;
}

function extractMessageFromBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return 'empty upstream response';
  try {
    const json = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
    if (typeof json?.error?.message === 'string' && json.error.message.trim()) {
      return json.error.message.trim();
    }
    if (typeof json?.message === 'string' && json.message.trim()) {
      return json.message.trim();
    }
  } catch {
    // Plain text fallback.
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}

export function classifyUpstreamHttpError(
  status: number,
  bodyText: string,
  retryAfterHeader?: string | null,
  options?: { retrySafetyV2?: boolean },
): ClassifiedUpstreamError {
  const retrySafetyV2 = options?.retrySafetyV2 !== false;
  const rawMessage = extractMessageFromBody(bodyText);
  const message = sanitizeErrorDetailText(rawMessage, 240) ?? rawMessage;
  const lower = `${rawMessage}\n${bodyText}`.toLowerCase();
  const delayMeta = parseRetryDelayDetails(bodyText, retryAfterHeader);
  const metaTag =
    delayMeta.errorStatus || delayMeta.errorReason
      ? `[${[delayMeta.errorStatus, delayMeta.errorReason].filter(Boolean).join('/')}] `
      : '';
  const sanitizedDetail = `${metaTag}${message}`;

  const isOneMillionContextError =
    lower.includes('maximum number of tokens allowed 1048576') ||
    lower.includes('input token count exceeds the maximum');

  const isContextError =
    isOneMillionContextError ||
    lower.includes('context_length_exceeded') ||
    lower.includes('context length exceeded') ||
    lower.includes('exceeds the maximum number of tokens') ||
    lower.includes('prompt is too long') ||
    lower.includes('input is too long for this model');

  const isSignatureError =
    status === 400 &&
    (lower.includes('thoughtsignature') ||
      lower.includes('thought_signature') ||
      lower.includes('invalid signature') ||
      lower.includes('thinking block'));

  const isModelNotFound =
    status === 404 ||
    lower.includes('model not found') ||
    lower.includes('unknown model') ||
    lower.includes('not found for api version') ||
    lower.includes('publisher model');

  if (status === 401 || lower.includes('unauthenticated') || lower.includes('invalid_grant')) {
    return {
      code: 'AUTH',
      category: 'AUTH',
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  if (status === 403) {
    const isQuotaWords =
      lower.includes('quota') ||
      lower.includes('credit') ||
      lower.includes('rate limit') ||
      lower.includes('resource_exhausted');
    return {
      code: isQuotaWords ? 'QUOTA' : 'AUTH',
      category: isQuotaWords ? 'QUOTA' : 'AUTH',
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  if (status === 429 || status === 529) {
    const retryAfterMs = delayMeta.retryAfterMs;
    const isExplicitQuotaExhaustion =
      lower.includes('quota_exhausted') ||
      lower.includes('exhausted your capacity') ||
      lower.includes('quota exceeded') ||
      lower.includes('daily limit') ||
      delayMeta.errorReason === 'QUOTA_EXHAUSTED' ||
      delayMeta.quotaResetDelayMs !== undefined ||
      (retryAfterMs !== undefined && retryAfterMs > 60_000);

    const isExplicitRateLimit =
      delayMeta.errorReason === 'RATE_LIMIT_EXCEEDED' ||
      lower.includes('rate limit') ||
      lower.includes('rate_limit') ||
      lower.includes('too many requests') ||
      lower.includes('per minute') ||
      (retryAfterMs !== undefined && retryAfterMs <= 60_000);

    if (isExplicitQuotaExhaustion) {
      return {
        code: 'QUOTA',
        category: 'QUOTA',
        status,
        message: sanitizedDetail,
        retryable: false,
        subType: 'quota_exhausted',
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        ...(delayMeta.quotaResetDelayMs !== undefined
          ? { quotaResetDelayMs: delayMeta.quotaResetDelayMs }
          : {}),
        delaySource: delayMeta.delaySource,
        ...(delayMeta.errorReason ? { errorReason: delayMeta.errorReason } : {}),
        ...(delayMeta.errorStatus ? { errorStatus: delayMeta.errorStatus } : {}),
        sanitizedDetail,
        isOneMillionContextError: false,
        isSignatureError: false,
        isModelNotFound: false,
      };
    }

    if (isExplicitRateLimit || !retrySafetyV2) {
      return {
        code: 'RATE_LIMIT',
        category: 'RATE_LIMIT',
        status,
        message: sanitizedDetail,
        retryable:
          !retrySafetyV2 ||
          (retryAfterMs !== undefined && retryAfterMs <= SAME_ACCOUNT_MAX_WAIT_V2_MS),
        subType: isExplicitRateLimit ? 'rate_limited' : 'resource_exhausted_unknown',
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        delaySource: delayMeta.delaySource,
        ...(delayMeta.errorReason ? { errorReason: delayMeta.errorReason } : {}),
        ...(delayMeta.errorStatus ? { errorStatus: delayMeta.errorStatus } : {}),
        sanitizedDetail,
        isOneMillionContextError: false,
        isSignatureError: false,
        isModelNotFound: false,
      };
    }

    // Bare / ambiguous 429 ("Resource has been exhausted" without explicit delay or rate-limit evidence):
    // Fail safely to QUOTA so DSH llm-retry will not rapidly re-slam upstream at 600ms/1200ms.
    return {
      code: 'QUOTA',
      category: 'QUOTA',
      status,
      message: sanitizedDetail,
      retryable: false,
      subType: 'resource_exhausted_unknown',
      delaySource: delayMeta.delaySource,
      ...(delayMeta.errorReason ? { errorReason: delayMeta.errorReason } : {}),
      ...(delayMeta.errorStatus ? { errorStatus: delayMeta.errorStatus } : {}),
      sanitizedDetail,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  if (isContextError) {
    return {
      code: 'CONTEXT_WINDOW_EXCEEDED',
      category: 'INVALID_REQUEST',
      status,
      message,
      isOneMillionContextError,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  if (status === 400 || isModelNotFound || status === 422) {
    return {
      code: 'INVALID_REQUEST',
      category: 'INVALID_REQUEST',
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError,
      isModelNotFound,
    };
  }

  if (status === 408 || status === 504) {
    return {
      code: 'TIMEOUT',
      category: 'SERVER',
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER',
      category: 'SERVER',
      status,
      message,
      isOneMillionContextError: false,
      isSignatureError: false,
      isModelNotFound: false,
    };
  }

  return {
    code: 'UNKNOWN',
    category: 'UNKNOWN',
    status,
    message,
    isOneMillionContextError: false,
    isSignatureError: false,
    isModelNotFound: false,
  };
}

export class AntigravityUpstreamError extends LlmError {
  readonly classified: ClassifiedUpstreamError;

  constructor(classified: ClassifiedUpstreamError, requestId?: string, cause?: unknown) {
    super(
      classified.status !== undefined
        ? `Antigravity upstream HTTP ${classified.status}: ${classified.message}`
        : `Antigravity upstream error: ${classified.message}`,
      classified.code,
      {
        ...(classified.status !== undefined ? { status: classified.status } : {}),
        ...(classified.retryAfterMs !== undefined
          ? { providerRetryAfterMs: classified.retryAfterMs }
          : {}),
        ...(requestId ? { requestId: ProviderRequestId(requestId) } : {}),
        ...(cause !== undefined ? { cause } : {}),
      },
    );
    this.classified = classified;
  }
}

export class EndpointHealthTracker {
  private readonly cooldownUntil = new Map<string, number>();

  markFailure(endpoint: string): void {
    const cooldownMs = isSandboxEndpoint(endpoint)
      ? SANDBOX_ENDPOINT_COOLDOWN_MS
      : DEFAULT_ENDPOINT_COOLDOWN_MS;
    this.cooldownUntil.set(endpoint, Date.now() + cooldownMs);
  }

  markHealthy(endpoint: string): void {
    this.cooldownUntil.delete(endpoint);
  }

  isHealthy(endpoint: string, now = Date.now()): boolean {
    const until = this.cooldownUntil.get(endpoint);
    if (until === undefined) return true;
    if (until <= now) {
      this.cooldownUntil.delete(endpoint);
      return true;
    }
    return false;
  }

  orderedEndpoints(endpoints: readonly string[]): string[] {
    const now = Date.now();
    const healthy: string[] = [];
    const cooling: string[] = [];
    for (const ep of endpoints) {
      if (this.isHealthy(ep, now)) healthy.push(ep);
      else cooling.push(ep);
    }
    // Preserve Daily -> Sandbox -> Prod ordering inside healthy group, then cooled fallbacks.
    return [...healthy, ...cooling];
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function linkTimeoutSignal(
  outerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new LlmError(`Antigravity request timed out after ${timeoutMs}ms`, 'TIMEOUT'));
  }, timeoutMs);

  const onOuterAbort = () => {
    controller.abort(outerSignal?.reason);
  };
  if (outerSignal) {
    if (outerSignal.aborted) {
      clearTimeout(timer);
      controller.abort(outerSignal.reason);
    } else {
      outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    },
  };
}

export interface UpstreamCallOptions {
  method:
    | 'streamGenerateContent'
    | 'generateContent'
    | 'loadCodeAssist'
    | 'fetchAvailableModels'
    | 'retrieveUserQuotaSummary'
    | 'writeTrajectoryAcls'
    | 'countTokens';
  queryString?: string;
  body: unknown;
  accessToken: string;
  projectId?: string;
  requestId?: string;
  isContentRequest: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowSameAccount429Retry?: boolean;
  disableRetry?: boolean;
  diagnosticSource?: ProtocolDiagnosticEventInput['source'];
  diagnosticSessionId?: string;
  diagnosticAccountId?: string;
  entitlementSource?: string;
  entitlementGeneration?: number;
  resolvedMaxTokens?: number;
}

export class AntigravityHttpClient {
  readonly endpointHealth = new EndpointHealthTracker();

  constructor(
    private readonly config: AntigravityPluginConfig,
    private readonly observer: ProtocolDiagnosticObserver = NOOP_DIAGNOSTIC_OBSERVER,
  ) {}

  async post(options: UpstreamCallOptions): Promise<{
    response: Response;
    endpoint: string;
  }> {
    const transient429Limit =
      options.allowSameAccount429Retry && !options.disableRetry
        ? SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES
        : 0;

    let transientAttempts = 0;

    for (;;) {
      try {
        return await this.postAcrossEndpoints(options, transientAttempts + 1);
      } catch (error) {
        if (error instanceof AntigravityUpstreamError) {
          const maxWait = this.config.retrySafetyV2
            ? SAME_ACCOUNT_MAX_WAIT_V2_MS
            : SAME_ACCOUNT_MAX_WAIT_MS;
          const isExplicitShortBackoff =
            error.classified.retryAfterMs !== undefined &&
            error.classified.retryAfterMs <= maxWait;
          const allowedByRetrySafety =
            !this.config.retrySafetyV2 || error.classified.subType === 'rate_limited';
          const isTransient429 =
            error.classified.status === 429 &&
            error.classified.category === 'RATE_LIMIT' &&
            allowedByRetrySafety &&
            isExplicitShortBackoff &&
            transientAttempts < transient429Limit;
          if (isTransient429) {
            const rawWait = error.classified.retryAfterMs ?? (transientAttempts + 1) * 1200;
            const waitMs = this.config.retrySafetyV2
              ? Math.max(SAME_ACCOUNT_MIN_WAIT_V2_MS, Math.min(maxWait, rawWait))
              : Math.min(maxWait, rawWait);
            transientAttempts += 1;
            await sleepWithAbort(waitMs, options.signal);
            continue;
          }
        }
        throw error;
      }
    }
  }

  private async postAcrossEndpoints(
    options: UpstreamCallOptions,
    retryRound = 1,
  ): Promise<{
    response: Response;
    endpoint: string;
  }> {
    const candidates = this.endpointHealth.orderedEndpoints(this.config.endpoints);
    const headers = buildOutboundHeaders({
      accessToken: options.accessToken,
      userAgent: this.config.userAgent,
      projectId: options.projectId,
      isContentRequest: options.isContentRequest,
    });
    const bodyJson = JSON.stringify(options.body);
    const bodyBytes = Buffer.byteLength(bodyJson, 'utf8');
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;

    let lastError: AntigravityUpstreamError | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const endpoint = candidates[i];
      const hasNext = i + 1 < candidates.length;
      const query = options.queryString ? `?${options.queryString}` : '';
      const url = `${endpoint}/v1internal:${options.method}${query}`;
      const attemptNum = (retryRound - 1) * candidates.length + (i + 1);
      const startedAt = Date.now();

      const { signal, cleanup } = linkTimeoutSignal(options.signal, timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal,
        });

        if (response.ok) {
          this.endpointHealth.markHealthy(endpoint);
          if (this.observer.enabled) {
            this.observer.record({
              requestId: options.requestId ?? `${options.method}-${startedAt}`,
              sessionId: options.diagnosticSessionId,
              source: options.diagnosticSource ?? (options.isContentRequest ? 'direct-adapter' : 'aux'),
              method: options.method,
              attempt: attemptNum,
              endpoint,
              accountIdHash: options.diagnosticAccountId,
              entitlementSource: options.entitlementSource,
              entitlementGeneration: options.entitlementGeneration,
              wirePolicyV2: this.config.wirePolicyV2,
              retrySafetyV2: this.config.retrySafetyV2,
              resolvedMaxTokens: options.resolvedMaxTokens,
              headers,
              body: options.body,
              byteLength: bodyBytes,
              httpStatus: response.status,
              durationMs: Date.now() - startedAt,
            });
          }
          return { response, endpoint };
        }

        const errText = await response.text();
        const retryAfter = response.headers.get('retry-after');
        const classified = classifyUpstreamHttpError(response.status, errText, retryAfter, {
          retrySafetyV2: this.config.retrySafetyV2,
        });
        const upstreamError = new AntigravityUpstreamError(classified, options.requestId);

        if (this.observer.enabled) {
          this.observer.record({
            requestId: options.requestId ?? `${options.method}-${startedAt}`,
            sessionId: options.diagnosticSessionId,
            source: options.diagnosticSource ?? (options.isContentRequest ? 'direct-adapter' : 'aux'),
            method: options.method,
            attempt: attemptNum,
            endpoint,
            accountIdHash: options.diagnosticAccountId,
            entitlementSource: options.entitlementSource,
            entitlementGeneration: options.entitlementGeneration,
            wirePolicyV2: this.config.wirePolicyV2,
            retrySafetyV2: this.config.retrySafetyV2,
            resolvedMaxTokens: options.resolvedMaxTokens,
            headers,
            body: options.body,
            byteLength: bodyBytes,
            httpStatus: response.status,
            classifiedCode: classified.code,
            classifiedSubType: classified.subType,
            retryAfterMs: classified.retryAfterMs,
            parsedDelaySource: classified.delaySource,
            errorDetailSummary: classified.sanitizedDetail ?? classified.message,
            durationMs: Date.now() - startedAt,
          });
        }

        if (!options.disableRetry && hasNext && shouldTryNextEndpoint(response.status, endpoint)) {
          this.endpointHealth.markFailure(endpoint);
          lastError = upstreamError;
          continue;
        }
        throw upstreamError;
      } catch (error) {
        if (options.signal?.aborted) {
          throw new LlmError('Request aborted by caller', 'ABORTED', {
            ...(options.requestId ? { requestId: ProviderRequestId(options.requestId) } : {}),
            cause: error,
          });
        }
        if (error instanceof AntigravityUpstreamError) {
          throw error;
        }
        const isTimeout =
          error instanceof LlmError && error.code === 'TIMEOUT';
        const message =
          error instanceof Error ? error.message : String(error);
        const transportErr = new AntigravityUpstreamError(
          {
            code: isTimeout ? 'TIMEOUT' : 'TRANSPORT',
            category: 'TRANSPORT',
            message,
            isOneMillionContextError: false,
            isSignatureError: false,
            isModelNotFound: false,
          },
          options.requestId,
          error,
        );
        if (!options.disableRetry && hasNext) {
          this.endpointHealth.markFailure(endpoint);
          lastError = transportErr;
          continue;
        }
        throw transportErr;
      } finally {
        cleanup();
      }
    }

    throw (
      lastError ??
      new AntigravityUpstreamError(
        {
          code: 'TRANSPORT',
          category: 'TRANSPORT',
          message: 'No Cloud Code endpoints configured',
          isOneMillionContextError: false,
          isSignatureError: false,
          isModelNotFound: false,
        },
        options.requestId,
      )
    );
  }
}
