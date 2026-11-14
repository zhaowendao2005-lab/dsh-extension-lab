import {
  LlmAdapter,
  LlmError,
  resolveImageAttachmentAccess,
  resolveRetryPolicy,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm';
import { AntigravityAccountManager, type AccountRecord } from './accounts.ts';
import { AntigravityCatalog } from './catalog.ts';
import { AntigravityHttpClient, AntigravityUpstreamError } from './client.ts';
import {
  PROVIDER_DISPLAY_NAME,
  PROVIDER_ID,
  type AntigravityPluginConfig,
} from './config.ts';
import {
  buildHubUserAgent,
  buildOutboundHeaders,
  deriveTrajectoryId,
  extractTrajectoryId,
  sanitizeUserAgent,
} from './identity.ts';
import { AntigravityOAuthManager } from './oauth.ts';
import {
  classifyPool,
  fetchAccountQuotaAndModels,
  loadCodeAssist,
} from './quota.ts';
import {
  GeminiSseStreamDecoder,
  buildAntigravityRequest,
  buildCountTokensEnvelope,
  type ResolvedImageData,
} from './translate.ts';
import { CacheTelemetryTracker } from './usage.ts';
import type {
  AntigravityStatusPayload,
  DoctorCheckItem,
  DoctorReport,
  QuotaSnapshotSummary,
} from '../shared/types.ts';

interface AttachmentImageVersionLike {
  data: Uint8Array;
  mediaType: string;
  width?: number;
  height?: number;
}

interface AttachmentStoreLike {
  readImageRequest?: (
    ref: unknown,
    target: { width: number; height: number; maxBytes: number },
    signal?: AbortSignal,
  ) => Promise<AttachmentImageVersionLike>;
}

function toPositiveSafeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : fallback;
}

function computeTargetDimensions(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  const safeW = toPositiveSafeInt(width, 1);
  const safeH = toPositiveSafeInt(height, 1);
  const safePixels = toPositiveSafeInt(maxPixels, 1_048_576);
  const pixels = safeW * safeH;
  if (pixels <= safePixels) {
    return { width: safeW, height: safeH };
  }
  const scale = Math.sqrt(safePixels / pixels);
  return {
    width: Math.max(1, Math.floor(safeW * scale)),
    height: Math.max(1, Math.floor(safeH * scale)),
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

function unrefTimer(timer: TimerHandle): void {
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    const fn = (timer as { unref?: () => void }).unref;
    if (typeof fn === 'function') fn.call(timer);
  }
}

function createStreamIdleWatchdog(
  parentSignal: AbortSignal | undefined,
  idleTimeoutMs: number,
): {
  signal: AbortSignal;
  touch: () => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timer: TimerHandle | undefined;

  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(
        new LlmError(
          `Antigravity stream idle timeout after ${idleTimeoutMs}ms`,
          'TIMEOUT',
        ),
      );
    }, idleTimeoutMs);
    unrefTimer(timer);
  };

  const onParentAbort = () => {
    if (timer) clearTimeout(timer);
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  if (!controller.signal.aborted) {
    arm();
  }

  return {
    signal: controller.signal,
    touch: () => {
      if (!controller.signal.aborted) arm();
    },
    cleanup: () => {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export class AntigravityService {
  readonly accounts: AntigravityAccountManager;
  readonly catalog: AntigravityCatalog;
  readonly client: AntigravityHttpClient;
  readonly oauth: AntigravityOAuthManager;
  readonly telemetry = new CacheTelemetryTracker();
  readonly adapter: AntigravityAdapter;

  private readonly resolveAttachments?: () => AttachmentStoreLike | undefined;
  private readonly resolveFsHostMapper?: () => ((hostPath: string) => string | undefined) | undefined;
  private readonly onAdaptersUpdated?: () => void;

  constructor(
    readonly config: AntigravityPluginConfig,
    deps?: {
      resolveAttachments?: () => AttachmentStoreLike | undefined;
      resolveFsHostMapper?: () => ((hostPath: string) => string | undefined) | undefined;
      onAdaptersUpdated?: () => void;
    },
  ) {
    this.resolveAttachments = deps?.resolveAttachments;
    this.resolveFsHostMapper = deps?.resolveFsHostMapper;
    this.onAdaptersUpdated = deps?.onAdaptersUpdated;

    this.accounts = new AntigravityAccountManager(config);
    this.catalog = new AntigravityCatalog(config);
    this.client = new AntigravityHttpClient(config);
    this.oauth = new AntigravityOAuthManager(config, async (creds) => {
      const account = await this.accounts.upsertAccountFromOAuth(creds);
      await this.refreshQuotaAndModelsForAccount(account.id).catch(() => undefined);
      this.notifyAdaptersUpdated();
    });
    this.adapter = new AntigravityAdapter(this);
  }

  notifyAdaptersUpdated(): void {
    this.onAdaptersUpdated?.();
  }

  async ensureAccountProjectId(
    account: AccountRecord,
    signal?: AbortSignal,
  ): Promise<string> {
    if (account.projectId && account.projectId.trim() !== '') {
      return account.projectId;
    }
    try {
      const info = await loadCodeAssist({
        client: this.client,
        accessToken: account.accessToken,
        email: account.email,
        signal,
      });
      if (info.projectId) {
        await this.accounts.updateAccountMeta(account.id, {
          projectId: info.projectId,
          tierLabel: info.tierLabel,
          tierId: info.tierId,
        });
        return info.projectId;
      }
    } catch {
      // Fall back cleanly to Google Cloud Code default consumer project id.
    }
    return 'aicode-consumers';
  }

  async refreshQuotaAndModelsForAccount(
    accountId?: string,
    signal?: AbortSignal,
  ): Promise<QuotaSnapshotSummary | undefined> {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();

    const target = accountId
      ? this.accounts.getAccountById(accountId)
      : this.accounts.getActiveAccount();
    if (!target) return undefined;

    const fresh = await this.accounts.ensureFreshToken(target.id, signal);
    const result = await fetchAccountQuotaAndModels({
      client: this.client,
      config: this.config,
      accountId: fresh.id,
      email: fresh.email,
      accessToken: fresh.accessToken,
      projectIdHint: fresh.projectId,
      signal,
    });

    this.accounts.setQuota(result.snapshot);
    if (result.models.length > 0) {
      await this.catalog.saveDynamicModels(result.models);
    }
    return result.snapshot;
  }

  async getStatusPayload(): Promise<AntigravityStatusPayload> {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();

    const active = this.accounts.getActiveAccount();
    const quota = active ? this.accounts.getQuota(active.id) : undefined;
    const options = this.catalog.mergedCatalog(quota);

    return {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_DISPLAY_NAME,
      unofficialChannel: true,
      accounts: this.accounts.listAccounts(),
      ...(active ? { activeAccountId: active.id } : {}),
      login: this.oauth.getStatus(),
      ...(quota ? { quota } : {}),
      ...(this.accounts.getColdNotice()
        ? { coldNotice: this.accounts.getColdNotice() }
        : {}),
      recentSwitches: this.accounts.getRecentSwitches(),
      telemetry: this.telemetry.summary(),
      models: {
        enabledModelIds: this.catalog.getEnabledModelIds(),
        options,
        source: this.catalog.getCatalogSource(),
      },
    };
  }

  async runDoctor(): Promise<DoctorReport> {
    await this.accounts.ensureLoaded();
    await this.catalog.ensureLoaded();

    const checks: DoctorCheckItem[] = [];
    const userAgent = sanitizeUserAgent(this.config.userAgent) || buildHubUserAgent();
    const active = this.accounts.getActiveAccount();

    if (!active) {
      checks.push({
        name: 'account',
        ok: false,
        detail: 'No Google account connected yet.',
      });
      return {
        ok: false,
        checkedAt: Date.now(),
        userAgent,
        checks,
      };
    }

    let fresh: AccountRecord;
    const t0 = Date.now();
    try {
      fresh = await this.accounts.ensureFreshToken(active.id);
      checks.push({
        name: 'oauth-token',
        ok: true,
        detail: `Valid access token for ${fresh.email} (expires in ${Math.max(0, Math.round((fresh.expiresAt - Date.now()) / 1000))}s)`,
        latencyMs: Date.now() - t0,
      });
    } catch (error) {
      checks.push({
        name: 'oauth-token',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t0,
      });
      return {
        ok: false,
        checkedAt: Date.now(),
        userAgent,
        checks,
      };
    }

    const t1 = Date.now();
    let projectId = fresh.projectId;
    try {
      const assist = await loadCodeAssist({
        client: this.client,
        accessToken: fresh.accessToken,
        email: fresh.email,
        projectIdHint: projectId,
      });
      projectId = assist.projectId ?? projectId ?? 'aicode-consumers';
      await this.accounts.updateAccountMeta(fresh.id, {
        projectId,
        tierLabel: assist.tierLabel,
        tierId: assist.tierId,
      });
      checks.push({
        name: 'loadCodeAssist',
        ok: true,
        detail: `project=${projectId}, tier=${assist.tierLabel ?? assist.tierId ?? 'unknown'}`,
        latencyMs: Date.now() - t1,
      });
    } catch (error) {
      checks.push({
        name: 'loadCodeAssist',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t1,
      });
    }

    const t2 = Date.now();
    try {
      const countBody = buildCountTokensEnvelope({
        model: `models/gemini-2.5-flash`,
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      });
      const { response, endpoint } = await this.client.post({
        method: 'countTokens',
        body: countBody,
        accessToken: fresh.accessToken,
        projectId,
        isContentRequest: false,
      });
      const data = (await response.json()) as { totalTokens?: number };
      checks.push({
        name: 'countTokens-probe',
        ok: true,
        detail: `endpoint=${endpoint}, totalTokens=${data.totalTokens ?? 'ok'}`,
        latencyMs: Date.now() - t2,
      });
    } catch (error) {
      checks.push({
        name: 'countTokens-probe',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - t2,
      });
    }

    // Verify outbound header hygiene invariants explicitly.
    const sampleHeaders = buildOutboundHeaders({
      accessToken: 'redacted',
      userAgent,
      projectId,
      isContentRequest: true,
    });
    const cleanHeadersOk =
      !('x-goog-user-project' in sampleHeaders) &&
      !('x-session-id' in sampleHeaders) &&
      sampleHeaders['User-Agent'] === userAgent;
    checks.push({
      name: 'header-hygiene',
      ok: cleanHeadersOk,
      detail: cleanHeadersOk
        ? 'Content requests omit x-goog-user-project and client spoof headers'
        : 'Header hygiene check failed',
    });

    return {
      ok: checks.every((c) => c.ok),
      checkedAt: Date.now(),
      userAgent,
      checks,
    };
  }

  async resolveImages(
    options: GenerateOptions,
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, ResolvedImageData> | undefined> {
    const refs = new Map<
      string,
      Extract<GenerateOptions['messages'][number]['content'][number], { type: 'image' }>['attachment']
    >();
    for (const msg of options.messages) {
      for (const block of msg.content) {
        if (block.type === 'image' && block.offloaded !== true) {
          refs.set(block.attachment.attachmentId, block.attachment);
        }
      }
    }
    if (refs.size === 0) return undefined;

    const attachments = this.resolveAttachments?.();
    if (!attachments || typeof attachments.readImageRequest !== 'function') {
      throw new LlmError(
        'Antigravity image input requires the DSH durable attachment service',
        'UNSUPPORTED_CONTENT',
      );
    }

    const hostMapper = this.resolveFsHostMapper?.();
    const resolved = new Map<string, ResolvedImageData>();

    for (const [id, ref] of refs.entries()) {
      const target = {
        ...computeTargetDimensions(
          ref.width,
          ref.height,
          this.config.requestImagePixelBudget,
        ),
        maxBytes: toPositiveSafeInt(this.config.requestImageMaxBytes, 5_242_880),
      };
      const version = await attachments.readImageRequest(ref, target, signal);
      let access: ReturnType<typeof resolveImageAttachmentAccess>;
      if (hostMapper) {
        try {
          access = resolveImageAttachmentAccess(attachments as never, hostMapper, ref);
        } catch {
          access = undefined;
        }
      }
      resolved.set(id, {
        data: version.data,
        mediaType: version.mediaType,
        width: version.width,
        height: version.height,
        ...(access ? { access } : {}),
      });
    }

    return resolved;
  }
}

export class AntigravityAdapter extends LlmAdapter {
  private readonly sessionTrajectoryIds = new Map<string, string>();
  private readonly registeredTrajectoryAcls = new Set<string>();

  constructor(private readonly service: AntigravityService) {
    super();
  }

  private getOrCreateTrajectoryId(accountId: string, sessionKey: string): string {
    const key = `${accountId}|${sessionKey}`;
    const existing = this.sessionTrajectoryIds.get(key);
    if (existing) return existing;
    const created = deriveTrajectoryId();
    if (this.sessionTrajectoryIds.size >= 256) {
      const oldestKey = this.sessionTrajectoryIds.keys().next().value;
      if (oldestKey) this.sessionTrajectoryIds.delete(oldestKey);
    }
    this.sessionTrajectoryIds.set(key, created);
    return created;
  }

  private async ensureTrajectoryAclRegistered(params: {
    accountId: string;
    accessToken: string;
    projectId: string;
    trajectoryId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const cacheKey = `${params.accountId}|${params.trajectoryId}`;
    if (this.registeredTrajectoryAcls.has(cacheKey)) return;
    if (params.signal?.aborted) return;

    try {
      await this.service.client.post({
        method: 'writeTrajectoryAcls',
        body: { trajectoryId: params.trajectoryId },
        accessToken: params.accessToken,
        projectId: params.projectId,
        isContentRequest: false,
        signal: params.signal,
        timeoutMs: 2500,
      });
      if (this.registeredTrajectoryAcls.size >= 256) {
        const oldest = this.registeredTrajectoryAcls.values().next().value;
        if (oldest) this.registeredTrajectoryAcls.delete(oldest);
      }
      this.registeredTrajectoryAcls.add(cacheKey);
    } catch {
      // Fail-open: trajectory ACL pre-registration must never block chat generation.
    }
  }

  providerInfo(_provider: string): LlmProviderInfo {
    return {
      id: PROVIDER_ID,
      name: PROVIDER_DISPLAY_NAME,
    };
  }

  providerRetryPolicy(provider: string) {
    return resolveRetryPolicy(
      {
        mode: 'normal',
        maxRetries: 2,
        retryableCodes: [
          'RATE_LIMIT',
          'SERVER',
          'TIMEOUT',
          'TRANSPORT',
          'EMPTY_RESPONSE',
        ],
        backoff: {
          initialDelayMs: 600,
          maxDelayMs: 8000,
          jitterRatio: 0.1,
        },
      },
      `antigravity:${provider}`,
    );
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    await this.service.accounts.ensureLoaded();
    const active = this.service.accounts.getActiveAccount();
    const quota = active ? this.service.accounts.getQuota(active.id) : undefined;
    return this.service.catalog.listModels(quota);
  }

  async resolveModel(
    _provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted();
    await this.service.catalog.ensureLoaded();
    signal?.throwIfAborted();
    return this.service.catalog.resolveModel(model);
  }

  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    signal?.throwIfAborted();
    await this.service.accounts.ensureLoaded();
    await this.service.catalog.ensureLoaded();
    signal?.throwIfAborted();

    const active = this.service.accounts.getActiveAccount();
    if (!active) {
      throw new LlmError(
        'No Antigravity Google account is signed in. Open Settings -> Antigravity or run /antigravity-accounts to connect one.',
        'AUTH',
      );
    }
    try {
      const fresh = await this.service.accounts.ensureFreshToken(active.id, signal);
      await this.service.ensureAccountProjectId(fresh, signal);
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(
        `Antigravity credential refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        'AUTH',
        { cause: error },
      );
    }
    const resolvedModel = await this.resolveModel(provider, model, signal);
    return {
      model: resolvedModel,
      stream: (options) => this.stream(options),
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.service.accounts.ensureLoaded();
    await this.service.catalog.ensureLoaded();

    const dispatch = this.service.catalog.resolveUpstreamDispatch(
      options.model,
      options.reasoningEffort,
    );
    const canonicalModel = dispatch.canonicalModel;
    const pool = classifyPool(canonicalModel);
    const sessionKey = options.sessionId?.trim() || 'default';
    const images = await this.service.resolveImages(options, options.signal);

    let failoverAttemptsRemaining = 1;
    let streamRetryAttemptsRemaining = Math.max(
      2,
      this.service.config.endpoints.length,
    );
    let sameEndpointStreamRetried = false;
    let bumped1M = false;
    let activeUpstreamModel = dispatch.upstreamModel;
    let fallbackVariantIdx = 0;

    for (;;) {
      let selected: AccountRecord;
      try {
        selected = this.service.accounts.selectAccountForSession(
          sessionKey,
          pool,
        ).account;
      } catch (error) {
        throw new LlmError(
          error instanceof Error ? error.message : String(error),
          'AUTH',
          { cause: error },
        );
      }

      let freshAccount: AccountRecord;
      try {
        freshAccount = await this.service.accounts.ensureFreshToken(
          selected.id,
          options.signal,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const switched = this.service.accounts.recordFailure({
          accountId: selected.id,
          sessionKey,
          category: 'AUTH',
          message: msg,
          pool,
        });
        if (switched && failoverAttemptsRemaining > 0) {
          failoverAttemptsRemaining -= 1;
          continue;
        }
        throw new LlmError(
          `Antigravity OAuth refresh failed (${selected.email}): ${msg}`,
          'AUTH',
          { cause: error },
        );
      }

      const projectId = await this.service.ensureAccountProjectId(
        freshAccount,
        options.signal,
      );
      const sessionGeneration = this.service.accounts.getUpstreamSessionGeneration(
        freshAccount.id,
        sessionKey,
      );

      const trajectoryId = this.getOrCreateTrajectoryId(freshAccount.id, sessionKey);
      const { envelope, requestId } = buildAntigravityRequest({
        options,
        accountId: freshAccount.id,
        accountEmail: freshAccount.email,
        projectId,
        sessionGeneration,
        trajectoryId,
        defaultThinkingEffort: this.service.config.defaultThinkingEffort,
        upstreamModel: activeUpstreamModel,
        effectiveEffort: dispatch.effectiveEffort,
        images,
      });

      await this.ensureTrajectoryAclRegistered({
        accountId: freshAccount.id,
        accessToken: freshAccount.accessToken,
        projectId,
        trajectoryId: extractTrajectoryId(requestId),
        signal: options.signal,
      });

      let response: Response;
      let usedEndpoint = '';
      try {
        const res = await this.service.client.post({
          method: 'streamGenerateContent',
          queryString: 'alt=sse',
          body: envelope,
          accessToken: freshAccount.accessToken,
          projectId,
          requestId,
          isContentRequest: true,
          signal: options.signal,
          allowSameAccount429Retry: true,
        });
        response = res.response;
        usedEndpoint = res.endpoint;
      } catch (error) {
        if (error instanceof AntigravityUpstreamError) {
          if (error.classified.isOneMillionContextError && !bumped1M) {
            bumped1M = true;
            this.service.accounts.bumpUpstreamSessionGeneration(
              freshAccount.id,
              sessionKey,
            );
            continue;
          }

          if (
            (error.classified.isModelNotFound || error.classified.status === 404) &&
            fallbackVariantIdx < dispatch.fallbackUpstreamModels.length
          ) {
            activeUpstreamModel = dispatch.fallbackUpstreamModels[fallbackVariantIdx]!;
            fallbackVariantIdx += 1;
            continue;
          }

          const switched = this.service.accounts.recordFailure({
            accountId: freshAccount.id,
            sessionKey,
            category: error.classified.category,
            message: error.classified.message,
            retryAfterMs: error.classified.retryAfterMs,
            pool,
          });
          if (switched && failoverAttemptsRemaining > 0) {
            failoverAttemptsRemaining -= 1;
            continue;
          }
        }
        throw error;
      }

      if (!response.body) {
        throw new LlmError(
          'Antigravity stream response contained no body',
          'EMPTY_RESPONSE',
        );
      }

      const decoder = new GeminiSseStreamDecoder(
        canonicalModel,
        freshAccount.id,
        requestId,
      );
      const watchdog = createStreamIdleWatchdog(
        options.signal,
        this.service.config.streamIdleTimeoutMs,
      );
      const reader = response.body.getReader();

      let emittedAnyChunk = false;
      try {
        for (;;) {
          if (watchdog.signal.aborted) {
            throw watchdog.signal.reason instanceof Error
              ? watchdog.signal.reason
              : new LlmError('Antigravity stream aborted', 'ABORTED');
          }
          const readPromise = reader.read();
          const abortPromise = new Promise<never>((_resolve, reject) => {
            if (watchdog.signal.aborted) {
              reject(watchdog.signal.reason);
              return;
            }
            const onAbort = () => reject(watchdog.signal.reason);
            watchdog.signal.addEventListener('abort', onAbort, { once: true });
            void readPromise.finally(() =>
              watchdog.signal.removeEventListener('abort', onAbort),
            );
          });

          const step = await Promise.race([readPromise, abortPromise]);
          if (step.done) break;
          watchdog.touch();

          const chunks = decoder.feed(step.value);
          for (const chunk of chunks) {
            emittedAnyChunk = true;
            yield chunk;
          }
        }

        const finalized = decoder.finish();
        if (!finalized.hasOutput && !emittedAnyChunk) {
          throw new LlmError(
            'Antigravity upstream stream completed with zero content blocks',
            'EMPTY_RESPONSE',
          );
        }

        this.service.accounts.recordSuccess(freshAccount.id, sessionKey);
        this.service.telemetry.record({
          model: canonicalModel,
          accountEmail: freshAccount.email,
          usage: finalized.usage,
        });

        for (const chunk of finalized.chunks) {
          yield chunk;
        }
        return;
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation error on cleanup.
        }
        if (options.signal?.aborted) {
          throw new LlmError('Antigravity stream aborted by caller', 'ABORTED', {
            cause: error,
          });
        }
        if (error instanceof AntigravityUpstreamError) {
          const isRetriableStreamStatus =
            (error.classified.status !== undefined &&
              (error.classified.status >= 500 || error.classified.status === 408)) ||
            error.classified.category === 'SERVER' ||
            error.classified.category === 'TRANSPORT';

          if (!emittedAnyChunk && isRetriableStreamStatus && usedEndpoint) {
            // Retry once on the same endpoint before cooling it down so Daily-only models
            // (e.g. gemini-4-*) do not prematurely fall back to Prod where they 429.
            if (!sameEndpointStreamRetried && streamRetryAttemptsRemaining > 0) {
              sameEndpointStreamRetried = true;
              streamRetryAttemptsRemaining -= 1;
              await new Promise((resolve) => setTimeout(resolve, 350));
              continue;
            }
            this.service.client.endpointHealth.markFailure(usedEndpoint);
          }

          if (!emittedAnyChunk && isRetriableStreamStatus && streamRetryAttemptsRemaining > 0) {
            streamRetryAttemptsRemaining -= 1;
            continue;
          }

          const switched = this.service.accounts.recordFailure({
            accountId: freshAccount.id,
            sessionKey,
            category: error.classified.category,
            message: error.classified.message,
            retryAfterMs: error.classified.retryAfterMs,
            pool,
          });
          if (!emittedAnyChunk && switched && failoverAttemptsRemaining > 0) {
            failoverAttemptsRemaining -= 1;
            continue;
          }
        }
        if (error instanceof LlmError) throw error;
        if (!emittedAnyChunk && usedEndpoint) {
          this.service.client.endpointHealth.markFailure(usedEndpoint);
        }
        if (!emittedAnyChunk && streamRetryAttemptsRemaining > 0) {
          streamRetryAttemptsRemaining -= 1;
          continue;
        }
        throw new LlmError(
          `Antigravity stream failed: ${error instanceof Error ? error.message : String(error)}`,
          'TRANSPORT',
          { cause: error },
        );
      } finally {
        watchdog.cleanup();
      }
    }
  }
}
