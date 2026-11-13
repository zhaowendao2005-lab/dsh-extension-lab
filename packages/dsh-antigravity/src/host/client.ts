import { LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm';
import type { AntigravityPluginConfig } from './config.ts';
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

export interface ClassifiedUpstreamError {
  code: LlmErrorCode;
  category: StickyFailureCategory;
  status?: number;
  message: string;
  retryAfterMs?: number;
  isOneMillionContextError: boolean;
  isSignatureError: boolean;
  isModelNotFound: boolean;
}

const DEFAULT_ENDPOINT_COOLDOWN_MS = 30_000;
const SANDBOX_ENDPOINT_COOLDOWN_MS = 60_000;
const SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES = 1;
const SAME_ACCOUNT_MAX_WAIT_MS = 8_000;

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

export function parseRetryDelayMs(
  bodyText: string,
  retryAfterHeader?: string | null,
): number | undefined {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric * 1000) + 200;
    }
    const parsedDur = parseDurationMs(trimmed);
    if (parsedDur !== undefined) return parsedDur + 200;
    const dateMs = Date.parse(trimmed);
    if (Number.isFinite(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) return diff + 200;
    }
  }

  try {
    const parsedJson = JSON.parse(bodyText);
    const structured = extractStructuredRetryMs(parsedJson);
    if (structured !== undefined) return structured + 200;
  } catch {
    // Non-JSON body; inspect text patterns next.
  }

  for (const re of TEXT_DELAY_PATTERNS) {
    const match = re.exec(bodyText);
    if (match?.[1]) {
      const parsed = parseDurationMs(match[1]);
      if (parsed !== undefined) return parsed + 1000;
    }
  }
  return undefined;
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
): ClassifiedUpstreamError {
  const message = extractMessageFromBody(bodyText);
  const lower = `${message}\n${bodyText}`.toLowerCase();

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
    const retryAfterMs = parseRetryDelayMs(bodyText, retryAfterHeader);
    const isExhaustedQuota =
      lower.includes('quota_exhausted') ||
      lower.includes('exhausted your capacity') ||
      lower.includes('quota exceeded') ||
      (retryAfterMs !== undefined && retryAfterMs > 60_000);
    return {
      code: isExhaustedQuota ? 'QUOTA' : 'RATE_LIMIT',
      category: isExhaustedQuota ? 'QUOTA' : 'RATE_LIMIT',
      status,
      message,
      retryAfterMs,
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
}

export class AntigravityHttpClient {
  readonly endpointHealth = new EndpointHealthTracker();

  constructor(private readonly config: AntigravityPluginConfig) {}

  async post(options: UpstreamCallOptions): Promise<{
    response: Response;
    endpoint: string;
  }> {
    const transient429Limit = options.allowSameAccount429Retry
      ? SAME_ACCOUNT_MAX_TRANSIENT_429_RETRIES
      : 0;

    let transientAttempts = 0;

    for (;;) {
      try {
        return await this.postAcrossEndpoints(options);
      } catch (error) {
        if (error instanceof AntigravityUpstreamError) {
          const isExplicitShortBackoff =
            error.classified.retryAfterMs !== undefined &&
            error.classified.retryAfterMs <= SAME_ACCOUNT_MAX_WAIT_MS;
          const isTransient429 =
            error.classified.status === 429 &&
            error.classified.category === 'RATE_LIMIT' &&
            isExplicitShortBackoff &&
            transientAttempts < transient429Limit;
          if (isTransient429) {
            const waitMs = Math.min(
              SAME_ACCOUNT_MAX_WAIT_MS,
              error.classified.retryAfterMs ?? (transientAttempts + 1) * 1200,
            );
            transientAttempts += 1;
            await sleepWithAbort(waitMs, options.signal);
            continue;
          }
        }
        throw error;
      }
    }
  }

  private async postAcrossEndpoints(options: UpstreamCallOptions): Promise<{
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
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;

    let lastError: AntigravityUpstreamError | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const endpoint = candidates[i];
      const hasNext = i + 1 < candidates.length;
      const query = options.queryString ? `?${options.queryString}` : '';
      const url = `${endpoint}/v1internal:${options.method}${query}`;

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
          return { response, endpoint };
        }

        const errText = await response.text();
        const retryAfter = response.headers.get('retry-after');
        const classified = classifyUpstreamHttpError(response.status, errText, retryAfter);
        const upstreamError = new AntigravityUpstreamError(classified, options.requestId);

        if (hasNext && shouldTryNextEndpoint(response.status, endpoint)) {
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
        if (hasNext) {
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
