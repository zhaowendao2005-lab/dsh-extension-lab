// shared/contract.js
import { z as z2 } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";

// shared/market.js
import { z } from "zod";
var amount = z.number().finite().nonnegative();
var marketSchema = z.strictObject({
  capturedAt: z.number().int().nonnegative(),
  chargeType: z.string().max(40),
  currency: z.string().max(12),
  unit: z.string().max(40),
  inputPriceMicros: amount.optional(),
  outputPriceMicros: amount.optional(),
  cacheReadPriceMicros: amount.optional(),
  cacheWritePriceMicros: amount.optional(),
  perRequestPriceMicros: amount.optional(),
  exchangeRate: z.number().finite().positive().optional(),
  cacheHitRate24h: z.number().finite().min(0).max(1e4).optional(),
  cacheHitState: z.string().max(40).optional()
});
function marketOf(value) {
  if (!value || typeof value !== "object") return void 0;
  const parsed = marketSchema.safeParse(value);
  return parsed.success ? parsed.data : void 0;
}

// shared/contract.js
var catalogSchema = z2.object({ providers: z2.array(z2.object({
  id: z2.string(),
  name: z2.string(),
  models: z2.array(z2.object({ id: z2.string(), name: z2.string(), description: z2.string().optional() })),
  error: z2.string().optional()
})) });
var id = (max = 128) => z2.string().min(1).max(max);
var siteId = id(64);
var concurrency = z2.number().int().min(1).max(6);
var timeoutMs = z2.number().int().min(3e4).max(18e5);
var relayApi = z2.enum(["chat", "responses", "messages"]);
var relayRef = z2.strictObject({ siteId, channelId: z2.number().int().min(1), model: id(256), api: relayApi, listingId: z2.number().int().min(0).optional(), supplierId: z2.number().int().min(0).optional() });
var modelRef = z2.strictObject({ provider: id(128), id: id(256) });
var recordModel = z2.strictObject({ provider: id(128), id: id(256), name: z2.string().max(256).optional(), relay: relayRef.optional() });
var a6Channel = z2.strictObject({ listingId: z2.number().int().nonnegative(), channelId: z2.number().int().positive(), supplierId: z2.number().int().nonnegative(), model: id(256), supplierName: z2.string().max(256).optional(), channelName: z2.string().max(256).optional(), brand: z2.string().max(256).optional(), market: marketSchema.optional() });
var a6Slots = z2.array(z2.strictObject({ tokenId: z2.number().int().positive() })).min(1);
var options = z2.strictObject({ concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() });
var schemas = {
  recordsList: z2.strictObject({ revision: z2.number().int().min(0).optional() }),
  recordCreate: z2.strictObject({
    kind: z2.enum(["fingerprint", "custom"]),
    name: z2.string().max(120),
    models: z2.array(recordModel).min(1).max(64),
    options: options.optional(),
    prompt: z2.string().max(2e5).optional(),
    footerVersion: z2.string().max(40).optional(),
    preset: z2.strictObject({ id: z2.string().max(128), name: z2.string().max(120), body: z2.string().max(2e5) }).nullable().optional()
  }),
  recordRerun: z2.strictObject({ recordId: id() }),
  recordDelete: z2.strictObject({ recordId: id() }),
  attemptView: z2.strictObject({ attemptId: id(), revision: z2.number().int().min(0).optional() }),
  attemptCancel: z2.strictObject({ attemptId: id() }),
  attemptConfigure: z2.strictObject({ attemptId: id(), concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() }),
  attemptRetry: z2.strictObject({ attemptId: id(), model: modelRef }),
  customSave: z2.strictObject({ recordId: id(), snapshot: z2.strictObject({ ended: z2.boolean(), runs: z2.array(z2.json()).max(64) }) }),
  a6ConfigSave: z2.strictObject({ accessToken: z2.string().max(512).optional(), userId: z2.string().max(40).optional() }),
  a6Selections: z2.strictObject({ revision: z2.number().int().nonnegative().optional() }),
  a6Create: z2.strictObject({ selectionId: id(), name: z2.string().max(120), slots: a6Slots, timeoutMs: timeoutMs.optional(), models: z2.array(a6Channel).min(1).max(64).optional() }),
  a6Action: z2.strictObject({ selectionId: id(), tokenId: z2.number().int().positive(), model: id(256), channelId: z2.number().int().positive(), operation: z2.enum(["pin", "restore"]) }),
  a6ProviderState: z2.strictObject({ refresh: z2.boolean().optional(), scan: z2.boolean().optional() }),
  a6ProviderConfigure: z2.strictObject({ providerIds: z2.array(id(128)).max(256) }),
  a6TargetSave: z2.strictObject({ recordId: id(), model: id(256), tokenId: z2.number().int().positive(), providerId: id(128).optional() }),
  a6ResultAction: z2.strictObject({ recordId: id(), model: id(256), channelId: z2.number().int().positive(), tokenId: z2.number().int().positive(), providerId: id(128).optional(), operation: z2.enum(["pin", "route", "restore"]) }),
  a6LedgerView: z2.strictObject({ attemptId: id().optional(), recordId: id().optional(), refresh: z2.boolean().optional() }).refine((value) => value.attemptId || value.recordId, "\u7F3A\u5C11\u6D4B\u8BD5\u8BB0\u5F55\u6216\u8F6E\u6B21 ID")
};
var DESCRIPTIONS = {
  catalog: "Read configured provider/model metadata; does not invoke inference or endpoint discovery.",
  recordsList: "List persisted test records with attempt summaries; {unchanged:true} when the revision has not moved.",
  recordCreate: "Create a test record; fingerprint records immediately start their first attempt (real model requests).",
  recordRerun: "Re-request a fingerprint record with its fixed model set; queued behind a running attempt.",
  recordDelete: "Delete a record and its attempts, cancelling running requests.",
  recordsClear: "Delete every record and attempt.",
  attemptView: "Read one attempt: live engine view or persisted snapshot.",
  attemptCancel: "Cancel a queued or running attempt.",
  attemptConfigure: "Change concurrency / request deadline / channel lane of an attempt (live, non-preemptive) and the record defaults.",
  attemptRetry: "Re-run the failed samples of one model; completed samples are kept.",
  customSave: "Persist a simulated custom-task snapshot; no inference is performed.",
  a6Config: "Read a6api credential state (masked access token, intake token, loopback origin); never returns the access token.",
  a6ConfigSave: "Verify and store the a6api access token plus user id in Host storage.",
  a6IntakeRotate: "Rotate the intake token the userscript uses; received selections stay valid.",
  a6Tokens: "List the account test tokens from a6api (id and name only, no key material).",
  a6Selections: "Read selections sent by the a6api userscript. Does not start inference.",
  a6Create: "Create an a6api-specific fingerprint attempt using user-selected test token slots (real inference).",
  a6Action: "Pin or restore one explicit channel for a selected test token, using the stored access token.",
  a6ProviderState: "Read account-scoped cached token metadata and configured-provider matching progress. No keys are returned.",
  a6ProviderConfigure: "Persist selected local provider identities and start background account-key matching without modifying providers.",
  a6TargetSave: "Save the account/model target token and optional matched local provider for a recorded channel.",
  a6ResultAction: "Explicitly pin, add a route or restore a recorded channel for the saved target; serializes with active test slots.",
  a6LedgerView: "Read durable executions and known billing totals for a record or attempt; refresh schedules reconciliation, never inference."
};
var json = (symbol) => ({ mode: "strict", typeSymbol: `model-intelligence-test#${symbol}`, create: () => z2.json() });
var input = (symbol, schema) => {
  const codec = { mode: "strict", typeSymbol: `model-intelligence-test#${symbol}`, create: () => schema };
  return [{ name: "request", source: "json", codec, strictCodec: codec }];
};
var methods = {};
for (const [name2, description] of Object.entries(DESCRIPTIONS)) {
  methods[`modelIntelligence/${name2}`] = {
    service: "modelIntelligence",
    description,
    invocation: { kind: "direct" },
    parameters: schemas[name2] ? input(`${name2}:request`, schemas[name2]) : [],
    result: name2 === "catalog" ? { mode: "strict", typeSymbol: "model-intelligence-test#catalog", create: () => catalogSchema } : json(`${name2}:result`)
  };
}
var REMOTE_METHOD_NAMES = Object.keys(DESCRIPTIONS);
var remoteInfo = createTypertRemoteInfo({ package: "model-intelligence-test", methods }, z2);
var hostContribution = { package: remoteInfo.package, face: "host", schemas: [], invocations: remoteInfo.descriptors, model: { symbols: [], exports: [], relations: [] } };

// backend/fingerprint/engine.js
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { generateChallenges, loadDetector, parseNumbers } from "lmfpd-sdk";

// backend/a6/slots.js
var TokenSlots = class {
  constructor() {
    this.busy = /* @__PURE__ */ new Set();
    this.waiters = [];
  }
  acquire(id2, signal) {
    if (signal?.aborted) return Promise.resolve(false);
    if (!this.busy.has(id2)) {
      this.busy.add(id2);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const entry = { id: id2, signal, resolve, abort: null };
      entry.abort = () => {
        const index = this.waiters.indexOf(entry);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      this.waiters.push(entry);
    });
  }
  release(id2) {
    this.busy.delete(id2);
    const index = this.waiters.findIndex((entry2) => entry2.id === id2 && !entry2.signal?.aborted);
    if (index < 0) return;
    const [entry] = this.waiters.splice(index, 1);
    entry.signal?.removeEventListener("abort", entry.abort);
    this.busy.add(id2);
    entry.resolve(true);
  }
};
function tokenIdentity(meta, tokenId) {
  const origin = meta.siteOrigin === "https://www.a6api.vip" ? "https://a6api.vip" : meta.siteOrigin;
  return `${origin}:${meta.accountId}:${tokenId}`;
}

// backend/fingerprint/engine.js
import { AssistantStreamAccumulator, BlockAssembler, createUserMessage, isTokenDelta, isVisibleChunk, chunkHasVisibleText, assistantStreamFirstTokenTime } from "@deepseek-ai/dsh-llm";

// backend/a6/transport.js
var ENDPOINT = "https://api.a6api.vip";
var ChannelError = class extends Error {
  constructor(message, facts) {
    super(message);
    this.name = "ChannelError";
    this.failure = facts;
  }
};
function build(api, { key, model, prompt }) {
  if (api === "messages") {
    return {
      url: `${ENDPOINT}/v1/messages`,
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: 32e3, stream: true, messages: [{ role: "user", content: prompt }] }
    };
  }
  return {
    url: `${ENDPOINT}/v1/chat/completions`,
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${key}` },
    body: { model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: prompt }] }
  };
}
async function* frames(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
      const data = [];
      for (const line of block.split(/\r?\n/)) if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      if (data.length) yield data.join("\n");
    }
  }
}
function classify(status, body, response) {
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
  }
  const error = payload?.error ?? payload;
  const code = typeof error?.code === "string" ? error.code : typeof error?.type === "string" ? error.type : `http-${status}`;
  const message = typeof error?.message === "string" ? error.message : `HTTP ${status}`;
  const header = Number(response?.headers?.get?.("retry-after"));
  const providerRetryAfterMs = Number.isFinite(header) && header > 0 ? Math.min(header, 300) * 1e3 : void 0;
  const platformQuota = status === 429 && (code === "specific_channel_rate_limited" || /广场自助测试|每个账号每分钟/.test(`${message} ${body ?? ""}`));
  return {
    status,
    code,
    message,
    providerRetryAfterMs,
    kind: status === 429 ? platformQuota ? "platform-quota" : "rate-limited" : status >= 500 ? "upstream-unavailable" : "request-failed"
  };
}
var TEXT = 1;
var REASONING = 0;
function stopReason(value) {
  if (value === "length" || value === "max_tokens") return "max-tokens";
  if (value === "tool_calls" || value === "tool_use") return "tool-calls";
  return "stop";
}
function usageOf(payload, api) {
  const raw = api === "messages" ? payload?.usage ?? payload?.message?.usage : payload?.usage;
  if (!raw) return null;
  const amount2 = (value) => value === void 0 || value === null ? NaN : Number(value);
  const inputTokens = amount2(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = amount2(raw.output_tokens ?? raw.completion_tokens);
  const cacheReadTokens = amount2(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens);
  const reasoningTokens = amount2(raw.output_tokens_details?.reasoning_tokens);
  const usage = Object.fromEntries(Object.entries({ inputTokens, outputTokens, cacheReadTokens, reasoningTokens }).filter(([, value]) => Number.isFinite(value) && value >= 0));
  return Object.keys(usage).length ? usage : null;
}
async function* openChannelStream({ key, model, prompt, api = "chat", signal, onDispatch, onMetadata, onUsage, fetchImpl = globalThis.fetch }) {
  const spec = build(api, { key, model, prompt });
  let response;
  try {
    signal?.throwIfAborted();
    await onDispatch?.();
    response = await fetchImpl(spec.url, { method: "POST", headers: spec.headers, body: JSON.stringify(spec.body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChannelError("\u65E0\u6CD5\u8FDE\u63A5 a6api", { message: error?.message ?? "network error", code: "network", status: void 0 });
  }
  try {
    await onMetadata?.({ requestId: response.headers?.get?.("X-Oneapi-Request-Id") || null, httpStatus: response.status });
  } catch (error) {
    try {
      await response.body?.cancel?.();
    } catch {
    }
    throw error;
  }
  if (!response.ok || !response.body) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 2e3);
    } catch {
    }
    const verdict = classify(response.status, body, response);
    throw new ChannelError(verdict.message, {
      message: `${verdict.message}\uFF08HTTP ${verdict.status}\uFF09`,
      code: verdict.code,
      status: verdict.status,
      kind: verdict.kind,
      detail: body.slice(0, 600),
      providerRetryAfterMs: verdict.providerRetryAfterMs
    });
  }
  let failure2 = null;
  let reason = "stop";
  let usage = null;
  let sawText = false;
  for await (const data of frames(response.body)) {
    if (data === "[DONE]") break;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (api === "messages") {
      if (payload.type === "content_block_delta") {
        if (payload.delta?.type === "thinking_delta") yield { type: "reasoning-delta", index: REASONING, text: payload.delta.thinking ?? "" };
        else if (typeof payload.delta?.text === "string" && payload.delta.text) {
          sawText = true;
          yield { type: "text-delta", index: TEXT, text: payload.delta.text };
        }
      } else if (payload.type === "message_delta") {
        if (payload.delta?.stop_reason) reason = stopReason(payload.delta.stop_reason);
      } else if (payload.type === "error") {
        failure2 = { message: String(payload.error?.message ?? "stream error").slice(0, 300), code: String(payload.error?.type ?? "stream_error") };
      }
      const partial2 = usageOf(payload, "messages");
      if (partial2) {
        usage = { ...usage, ...partial2 };
        onUsage?.(usage);
      }
      continue;
    }
    if (payload.error) {
      failure2 = { message: String(payload.error.message ?? "stream error").slice(0, 300), code: String(payload.error.code ?? payload.error.type ?? "stream_error") };
      continue;
    }
    const choice = payload.choices?.[0];
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (typeof reasoning === "string" && reasoning) yield { type: "reasoning-delta", index: REASONING, text: reasoning };
    if (typeof choice?.delta?.content === "string" && choice.delta.content) {
      sawText = true;
      yield { type: "text-delta", index: TEXT, text: choice.delta.content };
    }
    if (choice?.finish_reason) reason = stopReason(choice.finish_reason);
    const partial = usageOf(payload, "chat");
    if (partial) {
      usage = { ...usage, ...partial };
      onUsage?.(usage);
    }
  }
  if (usage) yield { type: "usage", usage };
  yield { type: "finish", reason: failure2 ? { kind: "error", failure: failure2 } : { kind: reason } };
  if (!sawText && !failure2) {
    throw new ChannelError("\u6E20\u9053\u6CA1\u6709\u8FD4\u56DE\u4EFB\u4F55\u5185\u5BB9", { message: "stream ended without text", code: "empty-stream", status: 200, kind: "empty-stream" });
  }
}

// backend/fingerprint/engine.js
var DEFAULT_CONCURRENCY = 6;
var MAX_CONCURRENCY = 6;
var REQUESTS_PER_MODEL = 3;
var MAX_CONCURRENT_REQUESTS = DEFAULT_CONCURRENCY * REQUESTS_PER_MODEL;
var DEFAULT_TIMEOUT_MS = 18e4;
var MIN_TIMEOUT_MS = 3e4;
var MAX_TIMEOUT_MS = 18e5;
var MAX_RUNNING_JOBS = 4;
var MAX_RETAINED_JOBS = 16;
var MAX_TEXT = 24e3;
var RELOAD_AFTER_MS = 10 * 6e4;
var DATA_TTL_SECONDS = 3600;
var FINISHED_JOB_TTL_MS = 60 * 6e4;
var END_STATES = /* @__PURE__ */ new Set(["complete", "truncated", "failed", "cancelled"]);
var END_STAGES = /* @__PURE__ */ new Set(["completed", "failed", "timeout", "cancelled"]);
var LIMITS = {
  maxConcurrency: MAX_CONCURRENCY,
  maxConcurrentRequests: MAX_CONCURRENT_REQUESTS,
  requestsPerModel: REQUESTS_PER_MODEL,
  defaultConcurrency: DEFAULT_CONCURRENCY,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  minTimeoutMs: MIN_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS
};
var FingerprintError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function cachePath() {
  return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "cache", "model-intelligence-test", "lmfpd-data.bin");
}
function languageOf(prompt) {
  if (/[\uac00-\ud7af]/.test(prompt)) return "ko";
  if (/[\u3040-\u30ff]/.test(prompt)) return "ja";
  if (/[\u4e00-\u9fff]/.test(prompt)) return "zh";
  return /entiers|choisissez|nombres/i.test(prompt) ? "fr" : "en";
}
var finite = (value) => Number.isFinite(value) ? value : null;
var tokens = (value) => Number.isFinite(value) && value >= 0 ? value : null;
var clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
function requestFailure(failure2) {
  const status = failure2?.status;
  if (failure2?.kind === "platform-quota") return "a6api \u5E7F\u573A\u81EA\u52A9\u6D4B\u8BD5\u914D\u989D\u5DF2\u6EE1\uFF08\u6BCF\u8D26\u53F7 5 \u6B21/\u5206\u949F\u3001\u6BCF\u6E20\u9053 20 \u6B21/\u5206\u949F\uFF09\xB7 \u672C\u6B21\u672A\u53D1\u5F80\u5546\u5BB6\u3001\u672A\u6263\u8D39";
  if (status === 401 || status === 403) return "\u4F9B\u5E94\u5546\u8BA4\u8BC1\u6216\u6743\u9650\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u8FD0\u884C\u65F6\u7684\u6A21\u578B\u914D\u7F6E";
  if (status === 429) return "\u4F9B\u5E94\u5546\u9650\u6D41\u6216\u914D\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  if (status === 404) return "\u4F9B\u5E94\u5546\u672A\u627E\u5230\u6240\u9009\u6A21\u578B";
  if (Number.isInteger(status) && status >= 500) return "\u4F9B\u5E94\u5546\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528";
  return "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u8FD0\u884C\u65F6\u7684\u4F9B\u5E94\u5546\u914D\u7F6E\u6216\u7A0D\u540E\u91CD\u8BD5";
}
var SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{4,}/g,
  /\b(?:api[-_]?key|authorization|x-api-key|token)["'\s:=]{1,4}[^\s"',}]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
];
function redact(text4) {
  if (typeof text4 !== "string" || !text4) return null;
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (match) => /^bearer/i.test(match) ? "Bearer [redacted]" : match.length > 12 ? `${match.slice(0, 6)}\u2026[redacted]` : "[redacted]"), text4).slice(0, 8e3);
}
function failureDetail(failure2, source) {
  const facts = failure2?.failure ?? failure2;
  const message = redact(typeof facts === "string" ? facts : facts?.message);
  return {
    source,
    message,
    code: typeof facts?.code === "string" ? facts.code : null,
    status: Number.isInteger(facts?.status) ? facts.status : null,
    text: typeof facts === "string" ? null : redact(facts?.detail ?? facts?.message ?? null),
    stack: typeof failure2?.stack === "string" ? redact(failure2.stack) : null
  };
}
function publicAnalysis(a) {
  return {
    decision: a.decision,
    prediction: a.prediction ?? null,
    predictionName: a.prediction_name ?? null,
    familyName: a.family_prediction_name ?? null,
    probability: finite(a.probability),
    probabilityStatus: a.probability_status,
    rankingScore: finite(a.ranking_score),
    usedOutputs: a.used_outputs,
    candidates: a.results.map((item) => ({
      model: item.model,
      displayName: item.display_name,
      family: item.family,
      familyName: item.family_name,
      score: item.score,
      probability: finite(item.probability)
    })),
    diagnostics: a.diagnostics.map((item) => ({
      index: item.index,
      parsed: item.parsed_numbers,
      minimum: item.minimum_numbers,
      accepted: item.accepted,
      outOfRange: item.raw_out_of_range_count
    })),
    sequence: a.sequence && Number.isFinite(a.sequence.autocorrelation) && Number.isFinite(a.sequence.small_step_share) ? {
      autocorrelation: finite(a.sequence.autocorrelation),
      smallStepShare: finite(a.sequence.small_step_share),
      modelLike: a.sequence.model_like
    } : null,
    method: a.method
  };
}
function optionsOf(options2) {
  const concurrency2 = Number.isFinite(options2?.concurrency) ? clampInt(options2.concurrency, 1, MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  const timeoutMs2 = Number.isFinite(options2?.timeoutMs) ? clampInt(options2.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  return { concurrency: concurrency2, timeoutMs: timeoutMs2 };
}
var FingerprintEngine = class {
  /**
   * @param hooks.onTouch(job)   every revision bump (callers throttle persistence themselves)
   * @param hooks.onSettled(job) the job left `running` (done / cancelled / failed)
   * @param hooks.a6 pin/unpin/key calls into a6api; the engine never holds credentials
   */
  constructor(ctx, hooks = {}) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.jobs = /* @__PURE__ */ new Map();
    this.loaded = void 0;
    this.loading = void 0;
    this.disposed = false;
    this.starting = 0;
    this.activeSamples = 0;
    this.waiters = [];
    this.tokenSlots = new TokenSlots();
  }
  async detector() {
    if (this.loaded && Date.now() - this.loaded.at < RELOAD_AFTER_MS) return this.loaded;
    if (!this.loading) {
      this.loading = loadDetector({ cache: cachePath(), ttl: DATA_TTL_SECONDS }).then((detector) => {
        const loaded = { detector, at: Date.now(), builtAt: detector.builtAt };
        if (!this.disposed) this.loaded = loaded;
        return loaded;
      }).finally(() => {
        this.loading = void 0;
      });
    }
    try {
      return await this.loading;
    } catch {
      if (this.loaded) return this.loaded;
      throw new FingerprintError("reference-unavailable", "\u65E0\u6CD5\u52A0\u8F7D\u6307\u7EB9\u53C2\u8003\u5E93\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u7F13\u5B58\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5\u3002");
    }
  }
  async start(models, options2, a6api = null, executionContext = {}) {
    if (this.disposed) throw new FingerprintError("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
    if (!Array.isArray(models) || models.length < 1 || models.length > 64 || models.some((m) => !m || typeof m.provider !== "string" || typeof m.id !== "string")) {
      throw new FingerprintError("invalid-models", "\u8BF7\u9009\u62E9 1\u201364 \u4E2A\u6709\u6548\u6A21\u578B");
    }
    if (new Set(models.map((m) => JSON.stringify([m.provider, m.id]))).size !== models.length) {
      throw new FingerprintError("duplicate-model", "\u540C\u4E00\u6D4B\u8BD5\u4E0D\u80FD\u91CD\u590D\u9009\u62E9\u540C\u4E00\u4E2A\u4F9B\u5E94\u5546\u6A21\u578B");
    }
    this.prune();
    if (this.starting + [...this.jobs.values()].filter((job) => job.status === "running").length >= MAX_RUNNING_JOBS) {
      throw new FingerprintError("busy", `\u5DF2\u6709 ${MAX_RUNNING_JOBS} \u4E2A\u6307\u7EB9\u6D4B\u8BD5\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u7ED3\u675F\u6216\u53D6\u6D88\u540E\u518D\u521B\u5EFA`);
    }
    const limits = optionsOf(options2);
    const dshModels = models.filter((m) => !m.relay);
    if (!a6api && models.some((m) => m.relay)) throw new FingerprintError("a6-entry-required", "\u6E20\u9053\u6D4B\u8BD5\u8BF7\u4ECE a6api \u6CB9\u7334\u6253\u5F00\u4E13\u9879\u521B\u5EFA\u9875");
    const llm = this.ctx.get("llm");
    if (dshModels.length || a6api) {
      if (!llm) throw new FingerprintError("unavailable", "\u5F53\u524D\u8FD0\u884C\u65F6\u6CA1\u6709\u53EF\u7528\u7684 LLM \u670D\u52A1");
      if (dshModels.length && typeof llm.prepareCall !== "function") throw new FingerprintError("incompatible-runtime", "\u5F53\u524D DSH \u4E0D\u652F\u6301\u5B98\u65B9 LLM \u8BF7\u6C42\u51C6\u5907\u63A5\u53E3\uFF0C\u8BF7\u5347\u7EA7\u8FD0\u884C\u65F6");
    }
    this.starting += 1;
    try {
      if (a6api && a6api.slots.some((slot) => !Number.isSafeInteger(slot.tokenId))) {
        throw new FingerprintError("invalid-slots", "\u6D4B\u8BD5\u4EE4\u724C\u69FD\u4F4D\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
      }
      const providers = dshModels.length ? new Set(llm.listProviders().map((provider) => provider.id)) : /* @__PURE__ */ new Set();
      for (const provider of new Set(dshModels.map((m) => m.provider))) {
        if (!providers.has(provider)) throw new FingerprintError("unknown-model", "\u6240\u9009\u4F9B\u5E94\u5546\u5DF2\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u6A21\u578B\u76EE\u5F55");
        let available;
        try {
          available = new Set((await llm.listModels(provider)).map((m) => m.id));
        } catch {
          throw new FingerprintError("catalog-unavailable", "\u65E0\u6CD5\u786E\u8BA4\u6240\u9009\u6A21\u578B\uFF0C\u8BF7\u5237\u65B0\u6A21\u578B\u76EE\u5F55\u540E\u91CD\u8BD5");
        }
        if (dshModels.some((m) => m.provider === provider && !available.has(m.id))) throw new FingerprintError("unknown-model", "\u6240\u9009\u6A21\u578B\u5DF2\u4E0D\u5728\u5F53\u524D\u76EE\u5F55\u4E2D\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u9009");
      }
      const reference = await this.detector();
      if (this.disposed) throw new FingerprintError("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
      const challenges = generateChallenges(REQUESTS_PER_MODEL).map((item) => ({
        id: item.id,
        expectedCount: item.expected_count,
        prompt: item.prompt,
        language: languageOf(item.prompt)
      }));
      const runs = models.map((model) => ({
        provider: model.provider,
        model: model.id,
        stage: "queued",
        analysis: null,
        error: null,
        a6api: model.a6api ?? null,
        callProvider: null,
        slotTokenId: null,
        routing: null,
        relay: model.relay ? { siteId: model.relay.siteId, channelId: model.relay.channelId, model: model.relay.model, api: model.relay.api, listingId: model.relay.listingId ?? 0, supplierId: model.relay.supplierId ?? 0 } : null,
        samples: challenges.map((challenge, index) => ({
          index,
          state: "queued",
          expectedCount: challenge.expectedCount,
          text: "",
          count: 0,
          firstByteMs: null,
          firstTextMs: null,
          generationMs: null,
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          finish: null,
          error: null,
          errorDetail: null,
          startedAt: 0,
          firstAt: 0,
          lastAt: 0,
          timeoutMs: limits.timeoutMs,
          timer: void 0,
          timeout: void 0
        }))
      }));
      const job = {
        id: `fp-${randomUUID()}`,
        revision: 1,
        status: "running",
        createdAt: Date.now(),
        finishedAt: null,
        controller: new AbortController(),
        detector: reference.detector,
        reference: { builtAt: reference.builtAt, source: "lmfpd-sdk", sdk: "lmfpd-sdk@0.2.0" },
        challenges,
        concurrency: a6api ? a6api.slots.length : limits.concurrency,
        timeoutMs: limits.timeoutMs,
        a6api,
        executionContext,
        runs,
        pending: [...runs],
        active: /* @__PURE__ */ new Map(),
        settled: 0,
        wake: void 0,
        loop: null
      };
      this.jobs.set(job.id, job);
      this.schedule(job);
      return this.view(job);
    } finally {
      this.starting -= 1;
    }
  }
  status(jobId, revision) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError("not-found", "\u6307\u7EB9\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F");
    if (revision === job.revision) return { id: job.id, revision: job.revision, unchanged: true };
    return this.view(job);
  }
  /** Live, non-preemptive configuration: lowering a limit never aborts an in-flight request. */
  configure(jobId, options2) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError("not-found", "\u6307\u7EB9\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F");
    let changed = false;
    if (!job.a6api && Number.isFinite(options2?.concurrency) && options2.concurrency !== job.concurrency) {
      job.concurrency = clampInt(options2.concurrency, 1, MAX_CONCURRENCY);
      changed = true;
    }
    if (Number.isFinite(options2?.timeoutMs) && options2.timeoutMs !== job.timeoutMs) {
      const raised = options2.timeoutMs > job.timeoutMs;
      job.timeoutMs = clampInt(options2.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      changed = true;
      if (raised) {
        for (const run of job.runs) for (const sample of run.samples) {
          if (!sample.timer || !sample.timeout || sample.timeout.signal.aborted) continue;
          sample.timeoutMs = job.timeoutMs;
          this.armTimeout(sample);
        }
      }
    }
    if (changed) {
      this.touch(job);
      if (job.status === "running") this.wakeJob(job);
    }
    return this.view(job);
  }
  /** Re-run the failed samples of one model. Completed samples of that model are kept. */
  retry(jobId, model) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError("not-found", "\u6307\u7EB9\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F");
    if (this.disposed) throw new FingerprintError("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
    if (job.status === "cancelled" || job.controller.signal.aborted) throw new FingerprintError("cancelled", "\u5DF2\u53D6\u6D88\u7684\u6D4B\u8BD5\u4E0D\u80FD\u91CD\u8BD5\uFF0C\u8BF7\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5");
    if (!model || typeof model.provider !== "string" || typeof model.id !== "string") throw new FingerprintError("invalid-models", "\u91CD\u8BD5\u7684\u6A21\u578B\u65E0\u6548");
    const run = job.runs.find((item) => item.provider === model.provider && item.model === model.id);
    if (!run) throw new FingerprintError("unknown-model", "\u8BE5\u6A21\u578B\u4E0D\u5C5E\u4E8E\u8FD9\u4E2A\u6307\u7EB9\u6D4B\u8BD5");
    if (run.samples.some((sample) => !END_STATES.has(sample.state))) throw new FingerprintError("busy", "\u8BE5\u6A21\u578B\u4ECD\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u8BF7\u6C42\u7ED3\u675F");
    const failed = run.samples.filter((sample) => sample.state === "failed");
    if (!failed.length) throw new FingerprintError("nothing-to-retry", "\u8BE5\u6A21\u578B\u6CA1\u6709\u53EF\u91CD\u8BD5\u7684\u5931\u8D25\u6837\u672C");
    for (const sample of failed) {
      clearTimeout(sample.timer);
      sample.state = "queued";
      sample.text = "";
      sample.count = 0;
      sample.firstByteMs = null;
      sample.firstTextMs = null;
      sample.generationMs = null;
      sample.durationMs = null;
      sample.inputTokens = null;
      sample.outputTokens = null;
      sample.finish = null;
      sample.error = null;
      sample.errorDetail = null;
      sample.startedAt = 0;
      sample.firstAt = 0;
      sample.lastAt = 0;
      sample.timer = void 0;
      sample.timeout = void 0;
      sample.timeoutMs = job.timeoutMs;
    }
    run.analysis = null;
    run.error = null;
    run.stage = "queued";
    job.status = "running";
    job.finishedAt = null;
    if (!job.pending.includes(run)) job.pending.push(run);
    this.touch(job);
    this.schedule(job);
    return this.view(job);
  }
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError("not-found", "\u6307\u7EB9\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F");
    if (job.status === "running") {
      job.controller.abort();
      for (const run of job.runs) {
        if (END_STAGES.has(run.stage)) continue;
        for (const sample of run.samples) {
          if (END_STATES.has(sample.state)) continue;
          clearTimeout(sample.timer);
          sample.timer = void 0;
          sample.timeout = void 0;
          this.finishTiming(sample);
          sample.state = "cancelled";
          sample.error = "\u5DF2\u53D6\u6D88";
          sample.errorDetail = { source: "cancelled", message: sample.error, code: "cancelled", status: null, text: null, stack: null };
        }
        run.stage = "cancelled";
        run.analysis = null;
        run.error = null;
      }
      job.pending = [];
      job.active.clear();
      job.status = "cancelled";
      job.finishedAt = Date.now();
      this.touch(job);
      this.wakeJob(job);
      if (!job.a6api) this.settle(job);
    }
    return this.view(job);
  }
  dispose() {
    this.disposed = true;
    this.hooks = { a6: this.hooks.a6 };
    for (const job of this.jobs.values()) this.cancel(job.id);
    this.jobs.clear();
    this.loaded = void 0;
  }
  prune() {
    const finished = [...this.jobs.values()].filter((job) => job.finishedAt && !job.loop).sort((a, b) => a.finishedAt - b.finishedAt);
    for (const job of finished) {
      if (Date.now() - job.finishedAt > FINISHED_JOB_TTL_MS || this.jobs.size >= MAX_RETAINED_JOBS) this.jobs.delete(job.id);
    }
  }
  touch(job) {
    job.revision += 1;
    try {
      this.hooks.onTouch?.(job);
    } catch {
    }
  }
  settle(job) {
    try {
      this.hooks.onSettled?.(job);
    } catch {
    }
  }
  /** Jobs that are still retained in memory (persisted attempts may outlive them). */
  has(jobId) {
    return this.jobs.has(jobId);
  }
  wakeJob(job) {
    const wake = job.wake;
    job.wake = void 0;
    wake?.();
  }
  // Reserve all queued challenges of a model atomically: the global cap must not split its batch.
  acquire(signal, count) {
    if (signal.aborted || this.disposed) return Promise.resolve(false);
    if (!this.waiters.length && this.activeSamples + count <= MAX_CONCURRENT_REQUESTS) {
      this.activeSamples += count;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const entry = { resolve, signal, count, abort: null };
      entry.abort = () => {
        const index = this.waiters.indexOf(entry);
        if (index !== -1) this.waiters.splice(index, 1);
        resolve(false);
        this.release(0);
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      this.waiters.push(entry);
    });
  }
  release(count) {
    this.activeSamples -= count;
    while (this.waiters.length) {
      const entry = this.waiters[0];
      if (!entry.signal.aborted && !this.disposed && this.activeSamples + entry.count > MAX_CONCURRENT_REQUESTS) break;
      this.waiters.shift();
      entry.signal.removeEventListener("abort", entry.abort);
      if (entry.signal.aborted || this.disposed) {
        entry.resolve(false);
        continue;
      }
      this.activeSamples += entry.count;
      entry.resolve(true);
    }
  }
  /**
   * Per-job scheduler: at most `concurrency` models run at once and each model always runs its
   * three challenges together. A live concurrency increase wakes the loop and admits more models.
   */
  schedule(job) {
    if (job.loop) {
      this.wakeJob(job);
      return;
    }
    job.loop = (async () => {
      try {
        if (job.a6api) await this.drainA6(job);
        else await this.drain(job);
      } catch (error) {
        this.failJob(job, error);
      } finally {
        job.loop = null;
        if (!this.disposed && job.status === "running" && !job.controller.signal.aborted && (job.pending.length > 0 || job.active.size > 0)) this.schedule(job);
      }
    })();
  }
  async drain(job) {
    const llm = this.ctx.get("llm");
    const { signal } = job.controller;
    while (job.status === "running" && !signal.aborted) {
      while (job.active.size < job.concurrency && job.pending.length) {
        const run = job.pending.shift();
        const promise = this.runModel(job, llm, run).catch((error) => this.failJob(job, error)).finally(() => {
          job.active.delete(run);
          job.settled += 1;
          this.wakeJob(job);
        });
        job.active.set(run, promise);
      }
      if (!job.active.size) break;
      const seen = job.settled;
      await new Promise((resolve) => {
        job.wake = resolve;
        if (job.settled !== seen) this.wakeJob(job);
      });
      job.wake = void 0;
    }
    await Promise.allSettled([...job.active.values()]);
    for (const run of job.runs) this.maybeAnalyze(job, run);
    if (job.status !== "running" || signal.aborted) return;
    if (job.pending.length > 0 || job.active.size > 0) return;
    this.complete(job);
  }
  async runModel(job, llm, run) {
    if (job.controller.signal.aborted) return;
    run.stage = "queued";
    this.touch(job);
    const queued = run.samples.filter((sample) => sample.state === "queued");
    if (!queued.length || !await this.acquire(job.controller.signal, queued.length)) return;
    try {
      if (job.controller.signal.aborted || this.disposed) return;
      const settled = await Promise.allSettled(queued.map((sample) => this.sample(job, llm, run, sample)));
      const rejected = settled.find((item) => item.status === "rejected");
      if (rejected) throw rejected.reason;
    } finally {
      this.release(queued.length);
    }
    if (!job.controller.signal.aborted) this.maybeAnalyze(job, run);
  }
  /** One worker per user-selected test token. A worker pins exactly one channel, waits for all
   * three calls and their iterator cleanup, restores the pin, then takes the next item immediately. */
  async drainA6(job) {
    const { signal } = job.controller;
    const llm = this.ctx.get("llm");
    const workers = job.a6api.slots.slice(0, job.pending.length).map(async (slot) => {
      const identity2 = tokenIdentity(job.a6api, slot.tokenId);
      if (!await this.tokenSlots.acquire(identity2, signal)) return;
      try {
        let key;
        try {
          key = await this.hooks.a6.key(slot.tokenId);
        } catch (error) {
          if (!signal.aborted) this.failJob(job, error);
          return;
        }
        while (job.pending.length && !signal.aborted) {
          const run = job.pending.shift();
          run.slotTokenId = slot.tokenId;
          const queued = run.samples.filter((sample) => sample.state === "queued");
          if (!queued.length) continue;
          const target = { tokenId: slot.tokenId, model: run.model, channelId: run.a6api.channelId, a6api: job.a6api };
          let attemptedPin = false;
          try {
            run.routing = "pinning";
            this.touch(job);
            if (signal.aborted) break;
            await this.hooks.a6.assertSlot?.(slot.tokenId, job.a6api);
            if (signal.aborted) break;
            attemptedPin = true;
            const pinned = await this.hooks.a6.pin(target);
            if (!pinned?.routeEffective) throw new FingerprintError("pin-unverified", "\u56FA\u5B9A\u6E20\u9053\u672A\u751F\u6548\uFF0C\u672A\u53D1\u9001\u91C7\u6837\u8BF7\u6C42");
            if (signal.aborted) break;
            run.routing = "sampling";
            this.touch(job);
            if (!await this.acquire(signal, queued.length)) break;
            try {
              const settled = await Promise.allSettled(queued.map((sample) => this.sample(job, llm, run, sample, key)));
              const rejected = settled.find((item) => item.status === "rejected");
              if (rejected) throw rejected.reason;
            } finally {
              this.release(queued.length);
            }
          } catch (error) {
            if (!signal.aborted) this.failRun(job, run, error, "pin");
          } finally {
            if (attemptedPin) {
              run.routing = "restoring";
              this.touch(job);
              try {
                await this.hooks.a6.unpin(target);
                run.routing = "restored";
              } catch (error) {
                run.routing = "restore-failed";
                run.error = { stage: "finalizing", message: "\u56FA\u5B9A\u5173\u7CFB\u6062\u590D\u5931\u8D25\uFF0C\u8BF7\u5230 a6api \u624B\u5DE5\u89E3\u9664\u56FA\u5B9A\uFF1B\u672C\u6B21\u6D4B\u8BD5\u5DF2\u505C\u6B62\u9886\u53D6\u4EFB\u52A1", detail: failureDetail(error, "restore") };
                this.touch(job);
                this.failJob(job, error);
              }
            }
            this.touch(job);
          }
          if (!signal.aborted) this.maybeAnalyze(job, run);
        }
      } finally {
        this.tokenSlots.release(identity2);
      }
    });
    await Promise.allSettled(workers);
    if (job.controller.signal.aborted) {
      if (job.status === "running") job.status = "cancelled";
      job.finishedAt = Date.now();
      this.touch(job);
      this.settle(job);
    } else this.complete(job);
  }
  /** Publish the terminal status: a job with no surviving model is a failed job, not a finished one. */
  complete(job) {
    if (job.status !== "running") return;
    job.status = job.runs.length > 0 && job.runs.every((run) => run.stage !== "completed") ? "failed" : "done";
    job.finishedAt = Date.now();
    this.touch(job);
    this.settle(job);
  }
  failRun(job, run, error, source) {
    for (const sample of run.samples) if (!END_STATES.has(sample.state)) {
      sample.state = "failed";
      sample.error = error?.message ?? "a6api \u7AD9\u70B9\u64CD\u4F5C\u5931\u8D25";
      sample.errorDetail = failureDetail(error, source);
    }
    run.stage = "failed";
    run.analysis = null;
    run.error = { stage: "finalizing", message: error?.message ?? "a6api \u7AD9\u70B9\u64CD\u4F5C\u5931\u8D25", detail: failureDetail(error, source) };
    this.touch(job);
  }
  failJob(job, failure2) {
    if (job.status !== "running") return;
    job.controller.abort();
    for (const run of job.runs) {
      if (END_STAGES.has(run.stage)) continue;
      for (const sample of run.samples) if (!END_STATES.has(sample.state)) {
        clearTimeout(sample.timer);
        sample.timer = void 0;
        sample.timeout = void 0;
        this.finishTiming(sample);
        sample.state = "failed";
        sample.error = "\u6307\u7EB9\u4EFB\u52A1\u6267\u884C\u4E2D\u65AD";
        sample.errorDetail = { ...failureDetail(failure2, "scheduler"), message: sample.error };
      }
      run.stage = "failed";
      run.error = {
        stage: "streaming",
        message: "\u6307\u7EB9\u4EFB\u52A1\u6267\u884C\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5",
        detail: failureDetail(failure2, "scheduler")
      };
    }
    job.pending = [];
    job.active.clear();
    job.status = "done";
    job.finishedAt = Date.now();
    this.touch(job);
    this.wakeJob(job);
    if (!job.a6api) this.settle(job);
  }
  finishTiming(sample) {
    if (sample.startedAt && sample.durationMs === null) sample.durationMs = Date.now() - sample.startedAt;
    if (sample.firstAt && sample.lastAt > sample.firstAt) sample.generationMs = sample.lastAt - sample.firstAt;
  }
  /** Re-arm the request deadline from the sample's own start time, so raising the cap extends it. */
  armTimeout(sample) {
    clearTimeout(sample.timer);
    if (!sample.timeout) {
      sample.timer = void 0;
      return;
    }
    sample.timer = setTimeout(() => sample.timeout?.abort(), Math.max(0, sample.startedAt + sample.timeoutMs - Date.now()));
  }
  // Project the canonical DSH result into fingerprint/UI facts; never concatenate raw deltas here.
  projectResponse(sample, assembler, final = false) {
    const blocks = final ? assembler.blocks() : assembler.interruptedBlocks();
    sample.text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").slice(0, MAX_TEXT);
    sample.count = parseNumbers(sample.text).length;
    sample.inputTokens = tokens(assembler.usage?.inputTokens);
    sample.outputTokens = tokens(assembler.usage?.outputTokens);
  }
  async sample(job, llm, run, sample, key) {
    if (sample.state !== "queued" || job.controller.signal.aborted) return;
    const timeoutController = new AbortController();
    const textLimitController = new AbortController();
    const signal = AbortSignal.any([job.controller.signal, timeoutController.signal, textLimitController.signal]);
    const assembler = new BlockAssembler();
    const events = new AssistantStreamAccumulator();
    sample.timeout = timeoutController;
    sample.timeoutMs = job.timeoutMs;
    sample.state = "waiting";
    sample.startedAt = Date.now();
    this.armTimeout(sample);
    this.refreshStage(run);
    this.touch(job);
    let truncated = false, failure2 = null, rawFailure = null, failureSource = "prepare";
    const ledger = this.hooks.ledger;
    let execution = null, observedUsage = {};
    try {
      const prompt = job.challenges[sample.index].prompt;
      let source;
      if (run.relay) {
        if (!key) throw new FingerprintError("key-unavailable", "\u6D4B\u8BD5\u4EE4\u724C\u5BC6\u94A5\u4E0D\u53EF\u7528");
        signal.throwIfAborted();
        if (ledger && job.executionContext?.attemptId) {
          execution = await ledger.begin({
            ...job.executionContext,
            jobId: job.id,
            provider: run.provider,
            model: run.model,
            challengeIndex: sample.index,
            siteOrigin: job.a6api?.siteOrigin,
            accountId: job.a6api?.accountId,
            tokenId: run.slotTokenId,
            intendedChannelId: run.relay.channelId
          });
          if (!execution) throw new FingerprintError("ledger-unavailable", "\u8BF7\u6C42\u8BB0\u5F55\u6216\u8D26\u53F7\u5DF2\u53D8\u66F4\uFF0C\u672A\u53D1\u9001\u91C7\u6837\u8BF7\u6C42");
        }
        signal.throwIfAborted();
        source = (this.hooks.openStream ?? openChannelStream)({
          key,
          model: run.model,
          prompt,
          api: run.relay.api,
          signal,
          onDispatch: () => ledger?.dispatch(execution),
          onMetadata: (metadata) => ledger?.metadata(execution, metadata),
          onUsage: (usage) => {
            observedUsage = { ...observedUsage, ...usage };
          }
        });
      } else {
        const prepared = await llm.prepareCall({ provider: run.callProvider ?? run.provider, model: run.model }, signal);
        signal.throwIfAborted();
        source = prepared.stream({
          ...prepared.config,
          signal,
          messages: [createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: prompt }] })]
        });
      }
      failureSource = "stream";
      for await (const chunk of source) {
        if (signal.aborted) break;
        if (chunk.type === "usage") observedUsage = { ...observedUsage, ...chunk.usage };
        const timed = events.push({ time: Date.now(), chunk });
        assembler.push(timed.chunk);
        this.projectResponse(sample, assembler);
        if (isTokenDelta(timed.chunk)) {
          if (!sample.firstAt) {
            sample.firstAt = timed.time;
            sample.firstByteMs = timed.time - sample.startedAt;
          }
          sample.lastAt = timed.time;
          sample.generationMs = timed.time > sample.firstAt ? timed.time - sample.firstAt : null;
        }
        if (sample.firstTextMs === null && chunkHasVisibleText(timed.chunk)) sample.firstTextMs = timed.time - sample.startedAt;
        if (isTokenDelta(timed.chunk) || isVisibleChunk(timed.chunk)) sample.state = "streaming";
        this.refreshStage(run);
        this.touch(job);
        if (sample.text.length >= MAX_TEXT) {
          truncated = true;
          clearTimeout(sample.timer);
          sample.timer = void 0;
          sample.timeout = void 0;
          textLimitController.abort();
          break;
        }
      }
      if (job.controller.signal.aborted) return;
      const finish = assembler.finish;
      this.projectResponse(sample, assembler, true);
      sample.finish = truncated ? "text-limit" : finish.kind;
      if (!truncated) {
        if (finish.kind === "max-tokens") truncated = true;
        else if (finish.kind === "error" || finish.kind === "aborted") {
          rawFailure = finish.failure;
          failure2 = finish.kind === "error" ? requestFailure(rawFailure) : "\u4F9B\u5E94\u5546\u4E2D\u65AD\u4E86\u6A21\u578B\u8BF7\u6C42";
        } else if (finish.kind === "tool-calls") failure2 = "\u6A21\u578B\u5C1D\u8BD5\u8C03\u7528\u5DE5\u5177\uFF0C\u56DE\u7B54\u65E0\u6548";
      }
    } catch (error) {
      if (!textLimitController.signal.aborted) {
        failure2 = requestFailure(error?.failure ?? error);
        rawFailure = error;
      }
    } finally {
      clearTimeout(sample.timer);
      sample.timer = void 0;
      sample.timeout = void 0;
      if (execution) {
        try {
          await ledger.finish(execution, {
            state: job.controller.signal.aborted ? "cancelled" : timeoutController.signal.aborted ? "timeout" : failure2 ? "failed" : "ended",
            finishKind: textLimitController.signal.aborted ? "text-limit" : sample.finish,
            streamUsage: observedUsage
          });
        } catch {
        }
      }
    }
    if (job.controller.signal.aborted) return;
    const firstTokenAt = assistantStreamFirstTokenTime(events.snapshot());
    sample.firstByteMs = firstTokenAt === void 0 ? null : firstTokenAt - sample.startedAt;
    if (textLimitController.signal.aborted) sample.finish = "text-limit";
    this.finishTiming(sample);
    if (timeoutController.signal.aborted) {
      sample.state = "failed";
      sample.error = `\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(sample.timeoutMs / 1e3)} \u79D2\uFF09`;
      sample.errorDetail = { source: "timeout", message: sample.error, code: "timeout", status: null, text: null, stack: null };
    } else if (failure2) {
      sample.state = "failed";
      sample.error = failure2;
      sample.errorDetail = { ...failureDetail(rawFailure, failureSource), message: failure2 };
    } else {
      sample.state = truncated ? "truncated" : "complete";
      sample.errorDetail = null;
    }
    this.refreshStage(run);
    this.touch(job);
  }
  maybeAnalyze(job, run) {
    if (job.controller.signal.aborted || run.analysis || END_STAGES.has(run.stage)) return;
    if (!run.samples.every((sample) => END_STATES.has(sample.state))) return;
    run.stage = "analyzing";
    this.touch(job);
    try {
      run.analysis = publicAnalysis(job.detector.analyze(run.samples.map((sample) => ({
        text: sample.state === "complete" || sample.state === "truncated" ? sample.text : "",
        expected_count: sample.expectedCount
      })), { strict: false }));
      run.stage = "completed";
    } catch (error) {
      run.stage = "failed";
      run.error = {
        stage: "analyzing",
        message: "\u6307\u7EB9\u5206\u6790\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u53C2\u8003\u5E93\u7248\u672C\u5E76\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5",
        detail: failureDetail(error, "analysis")
      };
    }
    this.touch(job);
  }
  refreshStage(run) {
    if (END_STAGES.has(run.stage) || run.analysis) return;
    const states = run.samples.map((sample) => sample.state);
    if (states.every((state) => END_STATES.has(state))) {
      if (states.every((state) => state === "failed" || state === "cancelled")) {
        const failed = run.samples.filter((sample) => sample.state === "failed");
        run.stage = failed.length && failed.every((sample) => sample.error?.startsWith("\u8BF7\u6C42\u8D85\u65F6")) ? "timeout" : "failed";
        run.error = {
          stage: "streaming",
          message: failed[0]?.error ?? "\u5168\u90E8\u6837\u672C\u672A\u5B8C\u6210",
          detail: failed[0]?.errorDetail ?? null
        };
      } else run.stage = "analyzing";
    } else if (states.includes("streaming")) run.stage = "streaming";
    else if (states.includes("waiting")) run.stage = "waiting-first-token";
    else run.stage = "queued";
  }
  view(job) {
    return {
      id: job.id,
      revision: job.revision,
      status: job.status,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      concurrency: job.concurrency,
      timeoutMs: job.timeoutMs,
      limits: { ...LIMITS, ...job.a6api ? { maxConcurrency: job.a6api.slots.length, maxConcurrentRequests: job.a6api.slots.length * REQUESTS_PER_MODEL } : {} },
      slots: job.a6api?.slots.length ?? 0,
      reference: { ...job.reference },
      challenges: job.challenges.map((challenge) => ({ ...challenge })),
      runs: job.runs.map((run) => ({
        provider: run.provider,
        model: run.model,
        stage: run.stage,
        error: run.error,
        analysis: run.analysis,
        callProvider: run.callProvider,
        slotTokenId: run.slotTokenId,
        routing: run.routing,
        ...run.relay ? { relay: { siteId: run.relay.siteId, channelId: run.relay.channelId, model: run.relay.model, api: run.relay.api, listingId: run.relay.listingId, supplierId: run.relay.supplierId } } : {},
        samples: run.samples.map((sample) => ({
          index: sample.index,
          state: sample.state,
          expectedCount: sample.expectedCount,
          count: sample.count,
          text: sample.text,
          firstByteMs: sample.firstByteMs,
          firstTextMs: sample.firstTextMs,
          generationMs: sample.generationMs,
          durationMs: sample.durationMs,
          inputTokens: sample.inputTokens,
          outputTokens: sample.outputTokens,
          finish: sample.finish,
          error: sample.error,
          errorDetail: sample.errorDetail ?? null
        }))
      }))
    };
  }
};

// backend/service/catalog.js
import { Service } from "@deepseek-ai/cordis";
import { bindTypertRemote, Remote, RemoteError, principalOf } from "@deepseek-ai/dsh-typert-protocol";

// backend/a6/errors.js
var A6Error = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "A6Error";
    this.code = code;
  }
};

// backend/service/catalog.js
function assertOwner(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== "owner" || principalOf(invocation)) {
    throw new RemoteError("model-intelligence/owner-required", "Only the owner may use the model intelligence test.", {});
  }
}
function remoteFailure(error) {
  if (error instanceof FingerprintError || error instanceof A6Error) {
    return new RemoteError(`model-intelligence/${error.code}`, error.message, {});
  }
  if (error instanceof RemoteError) return error;
  return new RemoteError("model-intelligence/internal", "\u670D\u52A1\u6267\u884C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", {});
}
var ModelIntelligenceService = class extends Service {
  constructor(ctx, deps) {
    super(ctx, "modelIntelligence");
    this.engine = deps.engine;
    this.records = deps.records;
    this.a6 = deps.a6;
    this.ledger = deps.ledger;
    this.typertRemote = bindTypertRemote(this, "modelIntelligence");
    for (const initialize of remoteInitializers) initialize.call(this);
  }
  async guard(run) {
    assertOwner(this.ctx.invocation);
    try {
      return await run();
    } catch (error) {
      throw remoteFailure(error);
    }
  }
  // ---- records & attempts --------------------------------------------------------------------
  recordsList(request) {
    return this.guard(() => this.records.list(request?.revision));
  }
  recordCreate(request) {
    return this.guard(() => this.records.create(request));
  }
  recordRerun(request) {
    return this.guard(() => this.records.rerun(request.recordId));
  }
  recordDelete(request) {
    return this.guard(() => this.a6.removeRecord(request.recordId));
  }
  recordsClear() {
    return this.guard(() => this.a6.clearRecords());
  }
  attemptView(request) {
    return this.guard(() => this.records.attempt(request.attemptId, request.revision));
  }
  attemptCancel(request) {
    return this.guard(() => this.records.cancel(request.attemptId));
  }
  attemptConfigure(request) {
    return this.guard(() => this.records.configure(request.attemptId, { concurrency: request.concurrency, timeoutMs: request.timeoutMs }));
  }
  attemptRetry(request) {
    return this.guard(() => this.records.retry(request.attemptId, request.model));
  }
  customSave(request) {
    return this.guard(() => this.records.saveCustom(request.recordId, request.snapshot));
  }
  // Owner-only control plane. The only page-facing surface is the one-way selection intake.
  a6Config() {
    return this.guard(() => this.a6.config());
  }
  a6ConfigSave(request) {
    return this.guard(() => this.a6.saveConfig(request ?? {}));
  }
  a6IntakeRotate() {
    return this.guard(() => this.a6.rotateIntake());
  }
  a6Tokens() {
    return this.guard(() => this.a6.tokens());
  }
  a6Selections(request) {
    return this.guard(() => this.a6.selections(request));
  }
  a6Create(request) {
    return this.guard(() => this.a6.create(request));
  }
  a6Action(request) {
    return this.guard(() => this.a6.action(request));
  }
  a6ProviderState(request) {
    return this.guard(async () => {
      await this.a6.config();
      return this.a6.providerState(request ?? {});
    });
  }
  a6ProviderConfigure(request) {
    return this.guard(async () => {
      await this.a6.config();
      return this.a6.providerConfigure(request);
    });
  }
  a6TargetSave(request) {
    return this.guard(() => this.a6.targetSave(request));
  }
  a6ResultAction(request) {
    return this.guard(() => this.a6.resultAction(request));
  }
  a6LedgerView(request) {
    return this.guard(async () => {
      await this.a6.config();
      return this.ledger.view(request);
    });
  }
  // ---- DSH model catalog ---------------------------------------------------------------------
  async catalog() {
    assertOwner(this.ctx.invocation);
    const llm = this.ctx.get("llm");
    if (!llm || typeof llm.listProviders !== "function" || typeof llm.listModels !== "function") {
      throw new RemoteError("model-intelligence/unavailable", "\u6A21\u578B\u76EE\u5F55\u4E0D\u53EF\u7528\uFF1A\u5F53\u524D\u8FD0\u884C\u65F6\u672A\u6CE8\u518C\u5B8C\u6574\u7684 LLM \u670D\u52A1\u3002", {});
    }
    let configuredProviders;
    try {
      configuredProviders = llm.listProviders();
    } catch {
      throw new RemoteError("model-intelligence/catalog-failed", "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8FD0\u884C\u65F6\u7684\u6A21\u578B\u76EE\u5F55\uFF0C\u8BF7\u91CD\u8BD5\u3002", {});
    }
    if (!Array.isArray(configuredProviders) || configuredProviders.some((provider) => !provider || typeof provider.id !== "string" || typeof provider.name !== "string")) {
      throw new RemoteError("model-intelligence/catalog-invalid", "\u5F53\u524D\u8FD0\u884C\u65F6\u8FD4\u56DE\u7684\u6A21\u578B\u76EE\u5F55\u683C\u5F0F\u65E0\u6548\u3002", {});
    }
    const providers = await Promise.all(configuredProviders.map(async (provider) => {
      let models;
      try {
        models = await llm.listModels(provider.id);
      } catch {
        return { id: provider.id, name: provider.name, models: [], error: "\u6B64\u4F9B\u5E94\u5546\u7684\u6A21\u578B\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u8FD0\u884C\u65F6\u914D\u7F6E\u540E\u91CD\u8BD5\u3002" };
      }
      if (!Array.isArray(models) || models.some((model) => !model || typeof model.id !== "string" || typeof model.name !== "string" || model.description !== void 0 && typeof model.description !== "string")) {
        throw new RemoteError("model-intelligence/catalog-invalid", "\u5F53\u524D\u8FD0\u884C\u65F6\u8FD4\u56DE\u7684\u6A21\u578B\u76EE\u5F55\u683C\u5F0F\u65E0\u6548\u3002", {});
      }
      return { id: provider.id, name: provider.name, models: models.map((model) => ({
        id: model.id,
        name: model.name,
        ...model.description === void 0 ? {} : { description: model.description }
      })) };
    }));
    return { providers };
  }
};
var REMOTE_METHODS = [
  "catalog",
  "recordsList",
  "recordCreate",
  "recordRerun",
  "recordDelete",
  "recordsClear",
  "attemptView",
  "attemptCancel",
  "attemptConfigure",
  "attemptRetry",
  "customSave",
  "a6Config",
  "a6ConfigSave",
  "a6IntakeRotate",
  "a6Tokens",
  "a6Selections",
  "a6Create",
  "a6Action",
  "a6ProviderState",
  "a6ProviderConfigure",
  "a6TargetSave",
  "a6ResultAction",
  "a6LedgerView"
];
var remoteInitializers = [];
for (const name2 of REMOTE_METHODS) {
  Remote(name2)(ModelIntelligenceService.prototype[name2], {
    kind: "method",
    name: name2,
    static: false,
    private: false,
    addInitializer(initialize) {
      remoteInitializers.push(initialize);
    }
  });
}

// backend/records/domain.js
import { z as z3 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
var identified = z3.object({ id: z3.string().min(1) }).passthrough();
var recordsDomain = defineDomain({
  name: "model_intelligence_test",
  version: 1,
  layout: "per-record",
  global: { schema: z3.record(z3.string(), z3.unknown()), initial: {} },
  tables: {
    records: domainTable(identified),
    attempts: domainTable(z3.object({ id: z3.string().min(1), recordId: z3.string().min(1) }).passthrough()),
    executions: domainTable(z3.object({ id: z3.string().min(1), recordId: z3.string().min(1), attemptId: z3.string().min(1) }).passthrough())
  }
});
var settingsDomain = defineDomain({
  name: "model_intelligence_settings",
  version: 1,
  layout: "per-record",
  tables: {
    // Account-scoped preferences and lease records; no test API key is stored by this flow.
    auth: domainTable(z3.object({ siteId: z3.string().min(1) }).passthrough())
  }
});
var PluginStorage = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = (async () => {
      const records = await ctx.storageDomain.open(recordsDomain);
      let managed = null;
      try {
        managed = await ctx.storageDomain.open(settingsDomain);
      } catch (error) {
        ctx.logger?.("model-intelligence")?.warn?.("settings domain unavailable", error);
      }
      return { records, managed };
    })();
    this.ready.catch(() => {
    });
  }
  async records() {
    return (await this.ready).records;
  }
  async managed() {
    return (await this.ready).managed;
  }
  async close() {
    try {
      const { records, managed } = await this.ready;
      await Promise.allSettled([records.close(), managed?.close()]);
    } catch {
    }
  }
};

// backend/records/service.js
import { randomUUID as randomUUID2 } from "node:crypto";
var PERSIST_THROTTLE_MS = 1500;
var MAX_RECORDS = 500;
var ACTIVE = /* @__PURE__ */ new Set(["queued", "running"]);
var END_SAMPLE = /* @__PURE__ */ new Set(["complete", "truncated", "failed", "cancelled"]);
var END_STAGE = /* @__PURE__ */ new Set(["completed", "failed", "timeout", "cancelled"]);
var clean = (value) => JSON.parse(JSON.stringify(value ?? null));
var short = (text4, max) => String(text4 ?? "").trim().slice(0, max);
function interrupt(view) {
  if (!view) return view;
  const copy = clean(view);
  copy.status = "cancelled";
  copy.finishedAt = copy.finishedAt ?? Date.now();
  for (const run of copy.runs ?? []) {
    if (END_STAGE.has(run.stage)) continue;
    for (const sample of run.samples ?? []) {
      if (END_SAMPLE.has(sample.state)) continue;
      sample.state = "cancelled";
      sample.error = "\u8FD0\u884C\u65F6\u91CD\u542F\uFF0C\u8BF7\u6C42\u5DF2\u4E2D\u65AD";
      sample.errorDetail = { source: "cancelled", message: sample.error, code: "interrupted", status: null, text: null, stack: null };
    }
    run.stage = "cancelled";
    run.analysis = null;
  }
  return copy;
}
function summaryOf(view) {
  const runs = view?.runs ?? [];
  return {
    total: runs.length,
    ended: runs.filter((run) => END_STAGE.has(run.stage)).length,
    completed: runs.filter((run) => run.stage === "completed").length,
    failed: runs.filter((run) => run.stage === "failed" || run.stage === "timeout").length
  };
}
var RecordsService = class {
  constructor(ctx, storage, engine, { ledger = engine.hooks?.ledger } = {}) {
    this.ctx = ctx;
    this.storage = storage;
    this.engine = engine;
    this.ledger = ledger;
    this.removing = /* @__PURE__ */ new Set();
    this.writes = /* @__PURE__ */ new Map();
    this.revision = 1;
    this.byJob = /* @__PURE__ */ new Map();
    this.timers = /* @__PURE__ */ new Map();
    this.disposed = false;
    this.ready = this.boot();
    this.ready.catch(() => {
    });
  }
  async boot() {
    const domain = await this.storage.records();
    const attempts = domain.table("attempts");
    for (const [id2, attempt] of [...attempts.entries()]) {
      if (!ACTIVE.has(attempt.status)) continue;
      await attempts.put(id2, { ...attempt, status: "interrupted", finishedAt: attempt.finishedAt ?? Date.now(), view: interrupt(attempt.view), jobId: null });
    }
    return domain;
  }
  async domain() {
    if (this.disposed) throw new FingerprintError("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
    return this.ready;
  }
  bump() {
    this.revision += 1;
  }
  async put(domain, table, id2, value) {
    const recordId = table === "records" ? id2 : value.recordId;
    if (this.disposed || this.removing.has(recordId)) return;
    const writes = this.writes.get(recordId) ?? /* @__PURE__ */ new Set();
    this.writes.set(recordId, writes);
    const work = Promise.resolve().then(() => {
      if (this.disposed || this.removing.has(recordId)) return;
      return domain.table(table).put(id2, value);
    });
    writes.add(work);
    try {
      return await work;
    } finally {
      writes.delete(work);
      if (!writes.size && this.writes.get(recordId) === writes) this.writes.delete(recordId);
    }
  }
  // ---- engine hooks -------------------------------------------------------------------------
  onTouch(job) {
    const attemptId = this.byJob.get(job.id);
    if (!attemptId) return;
    this.bump();
    if (this.timers.has(attemptId)) return;
    this.timers.set(attemptId, setTimeout(() => {
      this.timers.delete(attemptId);
      void this.persistJob(attemptId, job.id);
    }, PERSIST_THROTTLE_MS));
  }
  onSettled(job) {
    const attemptId = this.byJob.get(job.id);
    if (!attemptId) return;
    clearTimeout(this.timers.get(attemptId));
    this.timers.delete(attemptId);
    void this.persistJob(attemptId, job.id, true).then(() => this.startNextQueued(attemptId));
  }
  async persistJob(attemptId, jobId, settled = false) {
    if (this.disposed) return;
    const domain = await this.ready;
    const table = domain.table("attempts");
    const attempt = table.get(attemptId);
    if (!attempt || this.disposed || this.removing.has(attempt.recordId)) return;
    let view;
    try {
      view = this.engine.status(jobId);
    } catch {
      return;
    }
    const status = settled ? view.status === "cancelled" ? "cancelled" : view.status === "failed" ? "failed" : "done" : "running";
    await this.put(domain, "attempts", attemptId, { ...attempt, status, view, finishedAt: settled ? view.finishedAt ?? Date.now() : null });
    this.bump();
  }
  // ---- queries --------------------------------------------------------------------------------
  attemptSummary(attempt) {
    const live = attempt.jobId && this.engine.has(attempt.jobId) ? this.safeStatus(attempt.jobId) : null;
    const view = live ?? attempt.view;
    return {
      id: attempt.id,
      recordId: attempt.recordId,
      number: attempt.number,
      status: attempt.status,
      createdAt: attempt.createdAt,
      startedAt: attempt.startedAt ?? null,
      finishedAt: attempt.finishedAt ?? null,
      error: attempt.error ?? null,
      summary: view ? summaryOf(view) : null
    };
  }
  safeStatus(jobId) {
    try {
      return this.engine.status(jobId);
    } catch {
      return null;
    }
  }
  async list(revision) {
    const domain = await this.domain();
    if (revision === this.revision) return { revision: this.revision, unchanged: true };
    const attempts = [...domain.table("attempts").entries()].map(([, attempt]) => attempt);
    const records = [...domain.table("records").entries()].map(([, record]) => record).sort((a, b) => b.createdAt - a.createdAt).map((record) => ({
      ...record,
      attempts: attempts.filter((attempt) => attempt.recordId === record.id).sort((a, b) => a.number - b.number).map((attempt) => this.attemptSummary(attempt))
    }));
    return { revision: this.revision, records };
  }
  async attempt(attemptId, revision) {
    const domain = await this.domain();
    const attempt = domain.table("attempts").get(attemptId);
    if (!attempt) throw new FingerprintError("not-found", "\u8BF7\u6C42\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664");
    const live = attempt.jobId && this.engine.has(attempt.jobId) ? this.engine.status(attempt.jobId, revision) : null;
    if (live?.unchanged) return { id: attempt.id, unchanged: true, revision: live.revision };
    const view = live ?? attempt.view ?? null;
    return { ...this.attemptSummary(attempt), view, custom: attempt.custom ?? null, revision: view?.revision ?? 0 };
  }
  // ---- mutations ------------------------------------------------------------------------------
  async create(input2) {
    const domain = await this.domain();
    const records = domain.table("records");
    if ([...records.keys()].length >= MAX_RECORDS) throw new FingerprintError("too-many-records", `\u6D4B\u8BD5\u8BB0\u5F55\u5DF2\u8FBE ${MAX_RECORDS} \u6761\uFF0C\u8BF7\u5148\u5220\u9664\u65E7\u8BB0\u5F55`);
    const kind = input2?.kind === "custom" ? "custom" : "fingerprint";
    const models = Array.isArray(input2?.models) ? input2.models.map((model) => ({
      provider: short(model.provider, 128),
      id: short(model.id, 256),
      name: short(model.name || model.id, 256),
      ...model.relay ? { relay: clean(model.relay) } : {},
      ...model.a6api ? { a6api: clean(model.a6api) } : {}
    })) : [];
    if (!models.length || models.length > 64) throw new FingerprintError("invalid-models", "\u8BF7\u9009\u62E9 1\u201364 \u4E2A\u6709\u6548\u6A21\u578B");
    const record = {
      id: `rec-${randomUUID2()}`,
      name: short(input2.name, 120) || "\u672A\u547D\u540D\u6D4B\u8BD5",
      kind,
      createdAt: Date.now(),
      models,
      options: clean(input2.options ?? {}),
      prompt: kind === "custom" ? String(input2.prompt ?? "").slice(0, 2e5) : "",
      footerVersion: short(input2.footerVersion, 40),
      preset: input2.preset ? clean(input2.preset) : null,
      ...input2.a6api ? { a6api: clean(input2.a6api) } : {}
    };
    await this.put(domain, "records", record.id, record);
    this.bump();
    const attempt = kind === "fingerprint" ? await this.launch(record) : null;
    return { record, attemptId: attempt?.id ?? null };
  }
  /** Re-request with the record's fixed model set; queued behind a running attempt of the same record. */
  async rerun(recordId) {
    const domain = await this.domain();
    const record = domain.table("records").get(recordId);
    if (!record) throw new FingerprintError("not-found", "\u6D4B\u8BD5\u8BB0\u5F55\u4E0D\u5B58\u5728");
    if (record.kind !== "fingerprint") throw new FingerprintError("unsupported", "\u81EA\u5B9A\u4E49\u4EFB\u52A1\u8BF7\u5728\u524D\u7AEF\u91CD\u65B0\u8FD0\u884C");
    const attempt = await this.launch(record);
    return { attemptId: attempt.id };
  }
  async launch(record) {
    const domain = await this.ready;
    const attempts = domain.table("attempts");
    const existing = [...attempts.entries()].map(([, item]) => item).filter((item) => item.recordId === record.id);
    const number3 = existing.reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const busy = existing.some((item) => ACTIVE.has(item.status));
    const attempt = {
      id: `att-${randomUUID2()}`,
      recordId: record.id,
      number: number3,
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      jobId: null,
      view: null,
      error: null,
      ...this.ledger && record.a6api ? { ledgerVersion: 1 } : {}
    };
    await this.put(domain, "attempts", attempt.id, attempt);
    this.bump();
    if (!busy) await this.begin(attempt.id);
    return attempts.get(attempt.id);
  }
  async begin(attemptId) {
    const domain = await this.ready;
    const attempts = domain.table("attempts");
    const attempt = attempts.get(attemptId);
    const record = attempt && domain.table("records").get(attempt.recordId);
    if (!attempt || !record || attempt.status !== "queued" || this.disposed || this.removing.has(record.id)) return;
    try {
      const view = await this.engine.start(record.models.map((model) => ({ provider: model.provider, id: model.id, ...model.relay ? { relay: model.relay } : {}, ...model.a6api ? { a6api: model.a6api } : {} })), record.options, record.a6api ?? null, { recordId: record.id, attemptId });
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || !domain.table("records").get(record.id) || attempts.get(attemptId).status !== "queued") {
        if (this.engine.has(view.id)) this.engine.cancel(view.id);
        return;
      }
      this.byJob.set(view.id, attemptId);
      await this.put(domain, "attempts", attemptId, { ...attempts.get(attemptId), status: "running", jobId: view.id, startedAt: Date.now(), view });
    } catch (error) {
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || attempts.get(attemptId).status !== "queued") return;
      const message = error instanceof FingerprintError ? error.message : "\u6307\u7EB9\u670D\u52A1\u6267\u884C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
      await this.put(domain, "attempts", attemptId, { ...attempts.get(attemptId), status: "failed", finishedAt: Date.now(), error: message });
      void this.startNextQueued(attemptId);
    }
    this.bump();
  }
  async startNextQueued(attemptId) {
    if (this.disposed) return;
    const domain = await this.ready;
    const recordId = domain.table("attempts").get(attemptId)?.recordId;
    if (!recordId || this.disposed || this.removing.has(recordId)) return;
    const all = [...domain.table("attempts").entries()].map(([, item]) => item).filter((item) => item.recordId === recordId);
    if (all.some((item) => item.status === "running")) return;
    const next = all.filter((item) => item.status === "queued").sort((a, b) => a.number - b.number)[0];
    if (next) await this.begin(next.id);
  }
  async liveJob(attemptId) {
    const domain = await this.domain();
    const attempt = domain.table("attempts").get(attemptId);
    if (!attempt) throw new FingerprintError("not-found", "\u8BF7\u6C42\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664");
    return attempt;
  }
  async cancel(attemptId) {
    const attempt = await this.liveJob(attemptId);
    const domain = await this.ready;
    if (attempt.status === "queued") {
      await this.put(domain, "attempts", attemptId, { ...attempt, status: "cancelled", finishedAt: Date.now() });
      this.bump();
    } else if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
    return this.attempt(attemptId);
  }
  async configure(attemptId, options2) {
    const attempt = await this.liveJob(attemptId);
    const domain = await this.ready;
    const records = domain.table("records");
    const record = records.get(attempt.recordId);
    if (record) await this.put(domain, "records", record.id, { ...record, options: { ...record.options, ...clean(options2) } });
    if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.configure(attempt.jobId, options2);
    this.bump();
    return this.attempt(attemptId);
  }
  async retry(attemptId, model) {
    const attempt = await this.liveJob(attemptId);
    if (!attempt.jobId || !this.engine.has(attempt.jobId)) throw new FingerprintError("expired", "\u8BE5\u8BF7\u6C42\u5DF2\u4E0D\u5728\u5185\u5B58\u4E2D\uFF08\u8FD0\u884C\u65F6\u91CD\u542F\u6216\u5DF2\u8FC7\u671F\uFF09\uFF0C\u8BF7\u4F7F\u7528\u300C\u518D\u6B21\u8BF7\u6C42\u300D");
    this.engine.retry(attempt.jobId, model);
    const domain = await this.ready;
    await this.put(domain, "attempts", attemptId, { ...domain.table("attempts").get(attemptId), status: "running", finishedAt: null });
    this.bump();
    return this.attempt(attemptId);
  }
  async remove(recordId) {
    const domain = await this.domain();
    this.removing.add(recordId);
    await Promise.allSettled([...this.writes.get(recordId) ?? []]);
    const attempts = [...domain.table("attempts").entries()].map(([, item]) => item).filter((item) => item.recordId === recordId);
    await this.ledger?.removeRecord(recordId);
    for (const attempt of attempts) {
      clearTimeout(this.timers.get(attempt.id));
      this.timers.delete(attempt.id);
      if (attempt.jobId) this.byJob.delete(attempt.jobId);
      if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
    }
    await domain.table("attempts").deleteMany(attempts.map((item) => item.id));
    await domain.table("records").delete(recordId);
    this.bump();
    return { ok: true };
  }
  async clear() {
    const domain = await this.domain();
    for (const recordId of [...domain.table("records").keys()]) await this.remove(recordId);
    return { ok: true };
  }
  /** Custom (simulated) attempts: the client owns their lifecycle and saves terminal snapshots. */
  async saveCustom(recordId, snapshot) {
    const domain = await this.domain();
    const record = domain.table("records").get(recordId);
    if (!record || record.kind !== "custom") throw new FingerprintError("not-found", "\u81EA\u5B9A\u4E49\u6D4B\u8BD5\u8BB0\u5F55\u4E0D\u5B58\u5728");
    const attempts = domain.table("attempts");
    const existing = [...attempts.entries()].map(([, item]) => item).find((item) => item.recordId === recordId);
    const attempt = existing ?? { id: `att-${randomUUID2()}`, recordId, number: 1, createdAt: Date.now(), startedAt: Date.now(), jobId: null, view: null, error: null };
    const runs = Array.isArray(snapshot?.runs) ? clean(snapshot.runs).slice(0, 64) : [];
    await this.put(domain, "attempts", attempt.id, { ...attempt, status: snapshot?.ended ? "done" : "running", finishedAt: snapshot?.ended ? Date.now() : null, custom: { runs } });
    this.bump();
    return { attemptId: attempt.id };
  }
  async dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.writes.values()].flatMap((writes) => [...writes]));
  }
};

// backend/a6/site.js
var SITE_ORIGIN = "https://a6api.vip";
var TIMEOUT_MS = 25e3;
var text = (value, max = 300) => typeof value === "string" ? value.slice(0, max) : "";
var rowsOf = (payload) => Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.items) ? payload.data.items : Array.isArray(payload) ? payload : [];
var number = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : void 0;
var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function failure(status, payload) {
  const code = text(payload?.code ?? payload?.error?.code, 80);
  const message = text(payload?.message ?? payload?.error?.message, 300);
  if (status === 401 || status === 403) return new A6Error(code === "dashboard_auth_user_id_missing" ? "auth-user-id-missing" : "auth-invalid", code === "dashboard_auth_user_id_missing" ? "\u8BBF\u95EE\u4EE4\u724C\u7F3A\u5C11\u7528\u6237 ID\uFF0C\u8BF7\u540C\u65F6\u586B\u5199\u3002" : "\u8BBF\u95EE\u4EE4\u724C\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u914D\u7F6E\u3002");
  if (status === 429) return new A6Error("rate-limited", "a6api \u63A5\u53E3\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
  return new A6Error(`http-${status}`, message || `a6api \u8FD4\u56DE HTTP ${status}`);
}
function retryDelay(headers) {
  const value = headers.get("retry-after");
  const seconds = value !== null && value.trim() !== "" ? Number(value) : NaN;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(seconds)) return Math.max(1e3, seconds * 1e3);
  const date = value ? Date.parse(value) : NaN;
  if (Number.isFinite(date)) return Math.max(1e3, date - Date.now());
  if (Number.isFinite(reset) && reset > 0) return reset > 1e9 ? Math.max(1e3, reset * 1e3 - Date.now()) : reset * 1e3;
  return 5e3;
}
var A6Site = class {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { fetchImpl, accessToken: "", userId: "", generation: 0, active: 0, cooldownUntil: 0 });
    this.controller = new AbortController();
  }
  configure({ accessToken, userId }) {
    this.accessToken = typeof accessToken === "string" ? accessToken.trim() : "";
    this.userId = userId === void 0 || userId === null ? "" : String(userId).trim();
    this.generation += 1;
    this.onConfigure?.({ siteOrigin: SITE_ORIGIN, accountId: this.userId });
    if (this.accessToken && !this.userId) throw new A6Error("auth-user-id-missing", "\u8BF7\u540C\u65F6\u586B\u5199\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID\u3002");
  }
  get configured() {
    return Boolean(this.accessToken && this.userId);
  }
  get mask() {
    return !this.accessToken ? "" : this.accessToken.length <= 8 ? "\u2022\u2022\u2022\u2022" : `${this.accessToken.slice(0, 3)}\u2022\u2022\u2022\u2022${this.accessToken.slice(-4)}`;
  }
  headers() {
    if (!this.configured) throw new A6Error("auth-missing", "\u5C1A\u672A\u914D\u7F6E a6api \u8BBF\u95EE\u4EE4\u724C\u3002");
    return { authorization: this.accessToken, "new-api-user": this.userId, accept: "application/json" };
  }
  /** Shared bounded control-plane budget; model inference does not consume this queue. */
  async request(path, { method = "GET", query, body, timeoutMs: timeoutMs2 = TIMEOUT_MS } = {}) {
    const generation = this.generation;
    const headers = this.headers();
    while (this.active >= 2 || Date.now() < this.cooldownUntil) {
      if (this.controller.signal.aborted) throw new A6Error("disposed", "\u670D\u52A1\u5DF2\u5173\u95ED");
      if (generation !== this.generation) throw new A6Error("account-changed", "\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
      await wait(Math.min(250, Math.max(20, this.cooldownUntil - Date.now())));
    }
    if (generation !== this.generation) throw new A6Error("account-changed", "\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
    if (this.controller.signal.aborted) throw new A6Error("disposed", "\u670D\u52A1\u5DF2\u5173\u95ED");
    this.active += 1;
    try {
      const url = new URL(path, SITE_ORIGIN);
      for (const [key, value] of Object.entries(query ?? {})) if (value !== void 0 && value !== null) url.searchParams.set(key, String(value));
      if (body !== void 0) headers["content-type"] = "application/json";
      let response;
      try {
        response = await this.fetchImpl(url, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeoutMs2)]) });
      } catch {
        throw new A6Error("network", "\u65E0\u6CD5\u8FDE\u63A5 a6api\uFF0C\u8FDE\u63A5\u8D85\u65F6\u6216\u8BF7\u6C42\u5DF2\u4E2D\u6B62\u3002");
      }
      const raw = await response.text();
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (generation !== this.generation) throw new A6Error("account-changed", "\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u5DF2\u5FFD\u7565\u65E7\u54CD\u5E94");
      if (!response.ok || payload?.success === false) {
        const error = failure(response.status, payload);
        if (response.status === 429) {
          error.retryAfterMs = Math.min(3e5, retryDelay(response.headers));
          this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + error.retryAfterMs);
        }
        throw error;
      }
      return payload;
    } finally {
      this.active -= 1;
    }
  }
  async self() {
    const payload = await this.request("/api/user/self");
    const data = payload?.data ?? payload;
    return { id: data?.id ?? Number(this.userId), name: text(data?.display_name ?? data?.username, 120), quota: number(data?.quota) };
  }
  async verify() {
    const account = await this.self();
    if (String(account.id) !== this.userId) throw new A6Error("wrong-account", "\u7528\u6237 ID \u4E0E\u8BBF\u95EE\u4EE4\u724C\u7684\u8D26\u53F7\u4E0D\u4E00\u81F4");
    return { account, pins: (await this.pins()).length };
  }
  async tokens() {
    const found = /* @__PURE__ */ new Map();
    let previous = "";
    for (let p = 1; p <= 1e3; p += 1) {
      const payload = await this.request("/api/token/search", { query: { p, page_size: 100 } });
      const rows = rowsOf(payload);
      const signature = rows.map((row) => row.id).join(",");
      if (rows.length && signature === previous) throw new A6Error("pagination-incomplete", "\u4EE4\u724C\u5206\u9875\u91CD\u590D\uFF0C\u672A\u80FD\u786E\u8BA4\u5B8C\u6574\u5217\u8868\uFF0C\u8BF7\u5237\u65B0");
      previous = signature;
      for (const row of rows) {
        const id2 = Number(row.id);
        if (Number.isSafeInteger(id2) && id2 > 0) found.set(id2, { id: id2, name: text(row.name, 120) || `\u4EE4\u724C ${id2}`, maskedKey: text(row.key, 120), status: number(row.status), expiredTime: number(row.expired_time), unlimited: Boolean(row.unlimited_quota), remainQuota: number(row.remain_quota) });
      }
      const total = number(payload?.data?.total ?? payload?.total);
      if (!rows.length || (total !== void 0 ? found.size >= total : rows.length < 100)) return [...found.values()];
    }
    throw new A6Error("pagination-incomplete", "\u4EE4\u724C\u6570\u91CF\u8D85\u51FA\u5355\u6B21\u540C\u6B65\u9884\u7B97\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0");
  }
  async tokenKey(tokenId) {
    const payload = await this.request(`/api/token/${Number(tokenId)}/key`, { method: "POST", body: {}, timeoutMs: 1e4 });
    const key = payload?.data?.key ?? payload?.key;
    if (typeof key !== "string" || !key) throw new A6Error("key-unavailable", `\u4EE4\u724C ${tokenId} \u6CA1\u6709\u53EF\u7528\u7684\u5BC6\u94A5`);
    return key;
  }
  async pins() {
    return rowsOf(await this.request("/api/marketplace/pins")).filter((row) => Number(row?.token_id) > 0).map((row) => ({ tokenId: Number(row.token_id), channelId: Number(row.channel_id), supplierId: Number(row.supplier_id ?? 0), model: text(row.model_name, 256), status: text(row.status, 40), fallback: typeof row.fallback_to_smart_routing === "boolean" ? row.fallback_to_smart_routing : void 0, routeEffective: row.route_effective === true }));
  }
  async pin({ tokenId, model, channelId, fallback = false }) {
    await this.request("/api/marketplace/pin", { method: "POST", body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId), fallback_to_smart_routing: Boolean(fallback) } });
    const current = (await this.pins()).find((row) => row.tokenId === Number(tokenId) && row.model === model);
    return { routeEffective: current?.channelId === Number(channelId) && current?.routeEffective === true, supplierId: current?.supplierId ?? 0 };
  }
  async unpin({ tokenId, model, channelId }) {
    await this.request("/api/marketplace/unpin", { method: "POST", body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId) } });
    return { ok: true };
  }
  async billingSettings() {
    const payload = await this.request("/api/status");
    const data = payload?.data ?? payload;
    return { quotaPerUnit: number(data?.quota_per_unit), usdExchangeRate: number(data?.usd_exchange_rate) };
  }
  async requestLogs(requestId) {
    const rows = [];
    let previous = "";
    for (let p = 1; p <= 20; p += 1) {
      const payload = await this.request("/api/log/self", { query: { request_id: requestId, p, page_size: 100 } });
      const page = rowsOf(payload);
      const signature = JSON.stringify(page);
      if (page.length && signature === previous) return { rows, complete: false };
      previous = signature;
      rows.push(...page);
      const total = number(payload?.data?.total ?? payload?.total);
      if (!page.length || (total !== void 0 ? rows.length >= total : page.length < 100)) return { rows, complete: payload?.data?.total_capped !== true };
    }
    return { rows, complete: false };
  }
  async subscriptions() {
    const payload = await this.request("/api/subscriptions");
    return rowsOf(payload);
  }
  async addRoute({ tokenId, model, channelId }) {
    const read = async () => (await this.subscriptions()).find((row) => Number(row.token_id) === Number(tokenId) && (row.model_name ?? row.model) === model);
    const has = (row) => Array.isArray(row?.channels) && row.channels.some((item) => Number(typeof item === "number" ? item : item.channel_id ?? item.id) === Number(channelId));
    const existing = await read();
    if (!has(existing)) {
      if (existing) {
        if (!existing.id) throw new A6Error("route-unverified", "\u8DEF\u7531\u6C60\u7F3A\u5C11\u53EF\u9A8C\u8BC1\u7684 ID");
        await this.request(`/api/subscriptions/${existing.id}/channels`, { method: "PATCH", body: { channel_id: Number(channelId) } });
      } else {
        await this.request("/api/subscriptions", { method: "POST", body: { token_id: Number(tokenId), model_name: model, channels: [{ channel_id: Number(channelId) }], caps: { input_price_micros: 0, output_price_micros: 0, cache_read_price_micros: 0, cache_write_price_micros: 0, per_request_price_micros: 0 }, sort_strategy: "price_asc" } });
      }
    }
    const observed = await read();
    if (!has(observed)) throw new A6Error("route-unverified", "\u672A\u80FD\u8BFB\u56DE\u52A0\u5165\u8DEF\u7531\u7ED3\u679C\uFF0C\u8BF7\u68C0\u67E5\u7AD9\u70B9\u72B6\u6001");
    return { verified: true, tokenId: Number(tokenId), model, channelId: Number(channelId), subscriptionId: observed.id };
  }
  dispose() {
    this.controller.abort();
  }
};

// backend/a6/intake.js
import { randomBytes, timingSafeEqual } from "node:crypto";
var PATH = "/mit-a6/select";
var SITE_ORIGINS = /* @__PURE__ */ new Set(["https://a6api.vip", "https://www.a6api.vip"]);
var MAX_BODY = 256e3;
var MAX_MODELS = 64;
var MAX_SELECTIONS = 20;
var KEY = "a6-intake";
var equal = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
var text2 = (value, max = 256) => typeof value === "string" ? value.trim().slice(0, max) : "";
var positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new A6Error("invalid-input", `${label}\u65E0\u6548`);
  return value;
};
function channelOf(item) {
  return {
    listingId: Number.isSafeInteger(item?.listingId) && item.listingId >= 0 ? item.listingId : 0,
    channelId: positive(item?.channelId, "\u6E20\u9053 ID"),
    supplierId: Number.isSafeInteger(item?.supplierId) && item.supplierId >= 0 ? item.supplierId : 0,
    model: text2(item?.model) || (() => {
      throw new A6Error("invalid-input", "\u7F3A\u5C11\u6A21\u578B\u540D\u79F0");
    })(),
    supplierName: text2(item?.supplierName),
    channelName: text2(item?.channelName),
    brand: text2(item?.brand),
    ...marketOf(item?.market) ? { market: marketOf(item.market) } : {}
  };
}
function channelKey(item) {
  return `${item.listingId}:${item.channelId}:${item.supplierId}:${item.model}`;
}
function modelsOf(input2) {
  if (!Array.isArray(input2) || !input2.length || input2.length > MAX_MODELS) throw new A6Error("invalid-input", "\u5F85\u6D4B\u6E05\u5355\u4E3A\u7A7A\u6216\u6570\u91CF\u65E0\u6548");
  const seen = /* @__PURE__ */ new Set();
  return input2.map(channelOf).filter((item) => {
    const key = channelKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function tokensOf(input2) {
  if (!Array.isArray(input2) || !input2.length) throw new A6Error("invalid-input", "\u6D4B\u8BD5\u4EE4\u724C\u5217\u8868\u4E3A\u7A7A\u6216\u6570\u91CF\u65E0\u6548");
  const seen = /* @__PURE__ */ new Set();
  return input2.map((item) => ({ id: positive(item?.id, "\u6D4B\u8BD5\u4EE4\u724C ID"), name: text2(item?.name, 120) || `\u4EE4\u724C ${item.id}` })).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
var A6Intake = class {
  constructor() {
    this.token = "";
    this.selections = /* @__PURE__ */ new Map();
    this.revision = 0;
    this.storage = null;
    this.ready = Promise.resolve();
  }
  attachStorage(storage) {
    this.storage = storage;
    this.ready = this.load();
  }
  async load() {
    if (!this.storage) return;
    const domain = await this.storage.managed();
    if (!domain) return;
    const table = domain.table("auth");
    const row = table.get(KEY);
    if (row?.token) {
      this.token = row.token;
      return;
    }
    this.token = randomBytes(24).toString("base64url");
    await table.put(KEY, { siteId: KEY, token: this.token });
  }
  /** Regenerate the intake token; already-received selections stay usable. */
  async rotate() {
    await this.ready;
    this.token = randomBytes(24).toString("base64url");
    const domain = await this.storage?.managed();
    await domain?.table("auth").put(KEY, { siteId: KEY, token: this.token });
    return this.token;
  }
  list(revision) {
    if (Number.isInteger(revision) && revision === this.revision) return { unchanged: true, revision: this.revision };
    return { revision: this.revision, selections: [...this.selections.values()].slice(-MAX_SELECTIONS).reverse() };
  }
  selection(id2) {
    const found = this.selections.get(id2);
    if (!found) throw new A6Error("selection-missing", "\u9009\u62E9\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u7F51\u9875\u91CD\u65B0\u52FE\u9009\u540E\u53D1\u9001");
    return found;
  }
  submit(input2) {
    const siteOrigin = text2(input2?.siteOrigin, 120);
    if (!SITE_ORIGINS.has(siteOrigin)) throw new A6Error("wrong-site", "\u53EA\u63A5\u53D7 a6api \u7AD9\u70B9\u53D1\u6765\u7684\u9009\u62E9");
    const accountId = text2(input2?.accountId, 40);
    if (!accountId) throw new A6Error("invalid-input", "\u7F3A\u5C11\u8D26\u53F7\u6807\u8BC6");
    const selection = {
      id: randomBytes(9).toString("base64url"),
      siteOrigin,
      accountId,
      pageId: text2(input2?.pageId, 120),
      createdAt: Date.now(),
      models: modelsOf(input2?.models),
      tokens: tokensOf(input2?.tokens)
    };
    this.selections.set(selection.id, selection);
    while (this.selections.size > MAX_SELECTIONS) this.selections.delete(this.selections.keys().next().value);
    this.revision += 1;
    return { ok: true, selectionId: selection.id, revision: this.revision, models: selection.models.length, tokens: selection.tokens.length };
  }
  mount(webServer) {
    this.origin = webServer.getOrigin();
    const url = new URL(this.origin);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new A6Error("loopback-required", "\u9009\u62E9\u5BFC\u5165\u53E3\u4EC5\u5141\u8BB8\u672C\u673A DSH \u670D\u52A1");
    return webServer.register({ kind: "prefix", path: PATH, handler: (req, res) => this.handle(req, res) });
  }
  async handle(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-mit-intake");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const host = new URL(`http://${req.headers.host ?? ""}`).hostname;
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new A6Error("wrong-host", "\u975E\u6CD5 Host");
      if (req.method !== "POST") throw new A6Error("method", "\u4EC5\u63A5\u53D7 POST");
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new A6Error("invalid-input", "\u9700\u8981 JSON \u8BF7\u6C42");
      await this.ready;
      if (!equal(req.headers["x-mit-intake"], this.token)) throw new A6Error("not-paired", "\u5BFC\u5165\u53E3\u4EE4\u4E0D\u6B63\u786E\uFF0C\u8BF7\u4ECE DSH \u9762\u677F\u91CD\u65B0\u590D\u5236");
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new A6Error("body-limit", "\u8BF7\u6C42\u8FC7\u5927");
        chunks.push(chunk);
      }
      const input2 = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.end(JSON.stringify(this.submit(input2)));
    } catch (error) {
      res.statusCode = error?.code === "not-paired" || error?.code === "wrong-host" || error?.code === "wrong-site" ? 403 : 400;
      res.end(JSON.stringify({ error: error instanceof A6Error ? error.message : "\u8BF7\u6C42\u683C\u5F0F\u65E0\u6548", code: error?.code ?? "invalid-input" }));
    }
  }
};

// backend/a6/providers.js
import { credentialRef } from "@deepseek-ai/dsh-credentials";
var TTL_MS = 5 * 6e4;
var clone = (value) => JSON.parse(JSON.stringify(value));
var fail = (code, message) => new A6Error(code, message);
var mask = (value) => typeof value !== "string" ? "" : /[*•]/u.test(value) ? value.slice(0, 100) : value.length > 12 ? `${value.slice(0, 3)}\u2022\u2022\u2022\u2022${value.slice(-4)}` : value ? "\u2022\u2022\u2022\u2022" : "";
var publicToken = (token) => ({
  id: Number(token.id),
  name: String(token.name ?? `\u4EE4\u724C ${token.id}`).slice(0, 120),
  maskedKey: mask(token.maskedKey),
  ...token.status === void 0 ? {} : { status: token.status },
  ...token.expiredTime === void 0 ? {} : { expiredTime: token.expiredTime }
});
function assertUsableToken(token) {
  if (!token) throw fail("token-not-found", "\u8BE5\u4EE4\u724C\u5DF2\u4E0D\u5C5E\u4E8E\u5F53\u524D\u8D26\u53F7\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u9009");
  if (token.status !== void 0 && ![1, "1", "enabled", "active"].includes(token.status)) {
    throw fail("token-unavailable", "\u8BE5\u4EE4\u724C\u5DF2\u505C\u7528\u3001\u8FC7\u671F\u6216\u989D\u5EA6\u4E0D\u8DB3");
  }
  if (Number(token.expiredTime) > 0 && Number(token.expiredTime) * 1e3 <= Date.now()) {
    throw fail("token-expired", "\u8BE5\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
  }
}
var A6Providers = class {
  constructor(service) {
    this.service = service;
    this.revision = 1;
    this.epoch = 0;
    this.account = null;
    this.loading = null;
    this.scan = null;
    this.writeTail = Promise.resolve();
    this.reveals = /* @__PURE__ */ new Map();
    this.revealActive = 0;
    this.revealWaiters = [];
    this.disposed = false;
  }
  directory() {
    const llm = this.service.ctx.get("llm");
    const providers = llm?.listProviders?.() ?? [];
    return providers.filter((row) => row && typeof row.id === "string" && typeof row.name === "string").map(({ id: id2, name: name2 }) => ({ id: id2, name: name2 }));
  }
  /** Only explicit API-key references have a known authentication contract in this version. */
  reference(providerId) {
    const ctx = this.service.ctx;
    try {
      const declaration = ctx.get("llm")?.listConfigurableProviders?.().find((row) => row.provider === providerId);
      if (!declaration || declaration.error || !Array.isArray(declaration.settingsPath)) return null;
      const descriptor = ctx.get("settings")?.describe?.({ redactSecrets: true }).find((row) => row.ns === declaration.settingsNs);
      let section = descriptor?.value;
      for (const part of declaration.settingsPath) section = section?.[part];
      const secretOverride = descriptor?.secrets?.some((secret) => secret.set && declaration.settingsPath.every((part, index) => secret.path[index] === part) && ["apiKey", "headers", "auth", "apiKeys"].includes(secret.path[declaration.settingsPath.length]));
      if (!section || typeof section !== "object" || secretOverride || section.apiKey || section.auth || section.apiKeys || section.headers && Object.keys(section.headers).length) return null;
      if (typeof section.apiKeyEnv !== "string" || !section.apiKeyEnv.trim()) return null;
      return { ref: credentialRef(section.apiKeyEnv.trim()), stamp: JSON.stringify([
        declaration.settingsNs,
        declaration.settingsPath,
        section.apiKeyEnv,
        section.baseURL ?? declaration.defaultBaseURL,
        section.api,
        section.auth,
        descriptor.revision
      ]) };
    } catch {
      return null;
    }
  }
  async resolve(providerId) {
    if (!this.directory().some((row) => row.id === providerId)) throw fail("provider-not-found", "\u6B64\u63D0\u4F9B\u5546\u5DF2\u4ECE DSH \u79FB\u9664");
    const reference = this.reference(providerId);
    if (!reference) throw fail("provider-unsupported", "\u6B64\u63D0\u4F9B\u5546\u6CA1\u6709\u53EF\u5B89\u5168\u89E3\u6790\u7684\u663E\u5F0F API Key \u5F15\u7528");
    const credentials = this.service.ctx.get("credentials");
    if (!credentials) throw fail("credentials-unavailable", "Host \u51ED\u636E\u670D\u52A1\u4E0D\u53EF\u7528");
    let resolved;
    try {
      resolved = await credentials.resolve(reference.ref);
    } catch {
      throw fail("provider-credential-error", "\u65E0\u6CD5\u8BFB\u53D6\u6B64\u63D0\u4F9B\u5546\u5F53\u524D\u51ED\u636E");
    }
    if (typeof resolved?.value !== "string" || !resolved.value) throw fail("provider-key-missing", "\u6B64\u63D0\u4F9B\u5546\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684 API Key");
    return { value: resolved.value, stamp: reference.stamp };
  }
  invalidate() {
    this.epoch += 1;
    if (this.account) this.account.observedAt = 0;
    this.scan = null;
    if (this.account) for (const row of Object.values(this.account.matches)) {
      row.state = row.tokenIds?.length ? "stale" : "pending";
    }
    this.revision += 1;
  }
  reset() {
    this.invalidate();
    this.account = null;
    this.loading = null;
  }
  async ensure() {
    this.service.assertAvailable();
    await this.service.config();
    this.service.assertAvailable();
    if (this.disposed) throw fail("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
    const identity2 = this.service.accountIdentity();
    if (this.account?.identity === identity2) return this.account;
    if (!this.loading || this.loading.identity !== identity2) {
      const generation = this.service.generation;
      const task = (async () => {
        const table = await this.service.table();
        const stored = table.get(`a6-providers:${identity2}`);
        if (this.disposed || generation !== this.service.generation) throw fail("account-changed", "\u8D26\u53F7\u5DF2\u5207\u6362\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
        const matches = clone(stored?.matches ?? {});
        for (const row of Object.values(matches)) row.state = row.tokenIds?.length ? "stale" : "pending";
        this.account = {
          identity: identity2,
          accountId: this.service.site.configured ? String(this.service.site.userId) : "",
          selectedProviderIds: Array.isArray(stored?.selectedProviderIds) ? stored.selectedProviderIds : [],
          tokens: Array.isArray(stored?.tokens) ? stored.tokens.map(publicToken) : [],
          targets: stored?.targets ?? {},
          matches,
          observedAt: 0,
          error: void 0
        };
        return this.account;
      })();
      this.loading = { identity: identity2, task };
    }
    return this.loading.task;
  }
  valid(account, epoch) {
    return !this.disposed && !this.service.configSaving && this.account === account && this.epoch === epoch && account.identity === this.service.accountIdentity();
  }
  async persist(account) {
    const task = this.writeTail.catch(() => {
    }).then(async () => {
      if (this.disposed || this.account !== account || account.identity !== this.service.accountIdentity()) return;
      const table = await this.service.table();
      if (this.disposed || this.account !== account || account.identity !== this.service.accountIdentity()) return;
      await table.put(`a6-providers:${account.identity}`, {
        siteId: "a6-providers",
        selectedProviderIds: [...account.selectedProviderIds],
        tokens: account.tokens.map(publicToken),
        targets: clone(account.targets),
        matches: clone(account.matches)
      });
    });
    this.writeTail = task;
    await task;
  }
  snapshot(account) {
    return {
      accountId: account.accountId,
      revision: this.revision,
      providers: this.directory().map((provider) => {
        const row = account.matches[provider.id];
        return { ...provider, state: row?.state ?? "pending", tokenIds: [...row?.tokenIds ?? []], ...row?.error ? { error: row.error } : {} };
      }),
      tokens: account.tokens.map(publicToken),
      selectedProviderIds: [...account.selectedProviderIds],
      targets: clone(account.targets),
      scanning: Boolean(this.scan),
      ...account.error ? { error: account.error } : {}
    };
  }
  async state({ refresh = false, scan = false } = {}) {
    const account = await this.ensure();
    const ttl = account.error || Object.values(account.matches).some((row) => ["unmatched", "error"].includes(row.state)) ? 45e3 : TTL_MS;
    if (!account.accountId) account.error = "\u8BF7\u5148\u914D\u7F6E a6api \u8D26\u53F7";
    else if (refresh || scan || !account.observedAt || Date.now() - account.observedAt > ttl) this.start(account, { full: scan || refresh });
    return this.snapshot(account);
  }
  async configure({ providerIds } = {}) {
    const account = await this.ensure();
    if (!account.accountId) throw fail("auth-missing", "\u8BF7\u5148\u914D\u7F6E a6api \u8D26\u53F7");
    const allowed = new Set(this.directory().map((row) => row.id));
    if (!Array.isArray(providerIds) || providerIds.length > 256 || providerIds.some((id2) => !allowed.has(id2))) {
      throw fail("invalid-providers", "\u63D0\u4F9B\u5546\u9009\u62E9\u65E0\u6548\uFF0C\u8BF7\u5237\u65B0 DSH \u76EE\u5F55");
    }
    this.invalidate();
    account.selectedProviderIds = [...new Set(providerIds)];
    await this.persist(account);
    this.start(account, { full: true });
    return this.snapshot(account);
  }
  start(account, { full }) {
    if (this.disposed) return;
    if (this.scan) {
      if (full && !this.scan.full) this.scan.followupFull = true;
      return;
    }
    const epoch = this.epoch;
    const handle = { full, followupFull: false };
    this.scan = handle;
    this.revision += 1;
    handle.promise = this.discover(account, epoch, full).catch(async () => {
      if (!this.valid(account, epoch)) return;
      account.error = "\u63D0\u4F9B\u5546\u6838\u5BF9\u672A\u5B8C\u6210\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0";
      account.observedAt = Date.now();
      this.revision += 1;
      await this.persist(account);
    }).catch(() => {
    }).finally(() => {
      if (this.scan === handle) {
        this.scan = null;
        this.revision += 1;
        if (handle.followupFull && this.valid(account, epoch)) this.start(account, { full: true });
      }
    });
  }
  /** Pending-only single flight, shared by discovery and explicit target checks. */
  reveal(tokenId, account) {
    const generation = this.service.generation;
    const identity2 = `${account.identity}:${generation}:${tokenId}`;
    if (!this.reveals.has(identity2)) {
      const operation = (async () => {
        if (this.revealActive >= 2) await new Promise((resolve) => this.revealWaiters.push(resolve));
        else this.revealActive += 1;
        try {
          this.service.assertAvailable();
          if (generation !== this.service.generation || this.account !== account) throw fail("account-changed", "\u8D26\u53F7\u5DF2\u5207\u6362");
          return await this.service.site.tokenKey(tokenId);
        } finally {
          const next = this.revealWaiters.shift();
          if (next) next();
          else this.revealActive -= 1;
        }
      })().finally(() => this.reveals.delete(identity2));
      this.reveals.set(identity2, operation);
    }
    return this.reveals.get(identity2);
  }
  async discover(account, epoch, full) {
    const tokens2 = await this.service.site.tokens();
    if (!this.valid(account, epoch)) return;
    account.tokens = tokens2.map(publicToken);
    account.error = void 0;
    const selected = account.selectedProviderIds.filter((id2) => this.directory().some((row) => row.id === id2));
    const locals = [];
    for (const id2 of selected) {
      const old = account.matches[id2];
      try {
        const local = await this.resolve(id2);
        if (!this.valid(account, epoch)) return;
        locals.push({ id: id2, ...local, tokenIds: [], failed: false, previous: old?.tokenIds ?? [] });
        account.matches[id2] = { state: old?.tokenIds?.length ? "stale" : "pending", tokenIds: old?.tokenIds ?? [] };
      } catch (error) {
        if (!this.valid(account, epoch)) return;
        account.matches[id2] = { state: error.code === "provider-unsupported" ? "unsupported" : "error", tokenIds: old?.tokenIds ?? [], error: error instanceof A6Error ? error.message : "\u63D0\u4F9B\u5546\u914D\u7F6E\u8BFB\u53D6\u5931\u8D25" };
      }
    }
    const revealIds = full || locals.some((local) => !local.previous.length) ? tokens2.map((token) => token.id) : [...new Set(locals.flatMap((local) => local.previous))].filter((id2) => tokens2.some((token) => token.id === id2));
    const queue = [...revealIds];
    const worker = async () => {
      while (queue.length && this.valid(account, epoch)) {
        const id2 = queue.shift();
        try {
          const key = await this.reveal(id2, account);
          if (!this.valid(account, epoch)) return;
          for (const local of locals) if (local.value === key) local.tokenIds.push(id2);
        } catch {
          for (const local of locals) local.failed = true;
        }
      }
    };
    if (locals.length) await Promise.all([worker(), worker()]);
    if (!this.valid(account, epoch)) return;
    for (const local of locals) {
      if (this.reference(local.id)?.stamp !== local.stamp) {
        account.matches[local.id] = { state: "stale", tokenIds: local.previous };
        continue;
      }
      const ids = [...new Set(local.tokenIds)];
      account.matches[local.id] = {
        state: ids.length > 1 ? "ambiguous" : ids.length === 1 ? "exact" : local.failed ? "error" : full ? "unmatched" : "stale",
        tokenIds: ids.length ? ids : local.failed ? local.previous : [],
        ...local.failed ? { error: "\u90E8\u5206\u4EE4\u724C\u5BC6\u94A5\u672A\u80FD\u6838\u5BF9\uFF0C\u8BF7\u5237\u65B0\u7EE7\u7EED\u53D1\u73B0" } : {}
      };
    }
    account.observedAt = Date.now();
    this.revision += 1;
    await this.persist(account);
  }
  async verifyTarget({ tokenId, providerId }, account) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw fail("invalid-token", "\u4EE4\u724C ID \u65E0\u6548");
    const epoch = this.epoch;
    const tokens2 = await this.service.site.tokens();
    if (!this.valid(account, epoch)) throw fail("account-changed", "\u8D26\u53F7\u6216\u63D0\u4F9B\u5546\u914D\u7F6E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
    const token = tokens2.find((row) => row.id === tokenId);
    assertUsableToken(token);
    if (providerId !== void 0) {
      if (!account.selectedProviderIds.includes(providerId)) throw fail("provider-not-selected", "\u8BF7\u5148\u5728\u7BA1\u7406\u9762\u677F\u9009\u62E9\u6B64\u63D0\u4F9B\u5546");
      const local = await this.resolve(providerId);
      const remote = await this.reveal(tokenId, account);
      if (!this.valid(account, epoch) || this.reference(providerId)?.stamp !== local.stamp) throw fail("provider-changed", "\u63D0\u4F9B\u5546\u914D\u7F6E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9");
      if (local.value !== remote) {
        account.matches[providerId] = { state: "stale", tokenIds: [], error: "\u5F53\u524D\u51ED\u636E\u4E0E\u6B64\u4EE4\u724C\u4E0D\u5339\u914D" };
        this.revision += 1;
        await this.persist(account);
        throw fail("provider-mismatch", "\u5F53\u524D\u63D0\u4F9B\u5546\u51ED\u636E\u4E0E\u6240\u9009\u4EE4\u724C\u4E0D\u5339\u914D");
      }
      const old = account.matches[providerId];
      const tokenIds = ["exact", "ambiguous"].includes(old?.state) ? [.../* @__PURE__ */ new Set([...old.tokenIds ?? [], tokenId])] : [tokenId];
      account.matches[providerId] = { state: tokenIds.length > 1 ? "ambiguous" : "exact", tokenIds };
      this.revision += 1;
      await this.persist(account);
    }
    return token;
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
  }
};

// backend/a6/service.js
var CONFIG_KEY = "a6-site";
var KEY_TTL_MS = 10 * 6e4;
var A6Service = class {
  constructor({ ctx, storage, records, intake, site, engine }) {
    Object.assign(this, { ctx, storage, records, intake, site, engine });
    this.manualLeases = /* @__PURE__ */ new Map();
    this.deletingRecords = /* @__PURE__ */ new Set();
    this.clearInProgress = false;
    this.keyCache = /* @__PURE__ */ new Map();
    this.keyFlights = /* @__PURE__ */ new Map();
    this.generation = 0;
    this.configSaving = false;
    this.creating = 0;
    this.disposed = false;
    this.providers = new A6Providers(this);
  }
  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new A6Error("storage-unavailable", "\u4E13\u9879\u914D\u7F6E\u5B58\u50A8\u4E0D\u53EF\u7528");
    return domain.table("auth");
  }
  // ---- access token --------------------------------------------------------------------------
  async config() {
    await this.intake.ready;
    const row = (await this.table()).get(CONFIG_KEY);
    if (row?.accessToken && !this.site.configured) this.site.configure({ accessToken: row.accessToken, userId: row.userId });
    return {
      configured: this.site.configured,
      mask: this.site.mask,
      userId: this.site.userId,
      intakeToken: this.intake.token,
      origin: this.intake.origin ?? ""
    };
  }
  async saveConfig({ accessToken, userId }) {
    await this.config();
    if (this.configSaving || this.creating || this.engine.starting || this.engine.tokenSlots.busy.size || [...this.engine.jobs.values()].some((job) => job.a6api && job.status === "running")) {
      throw new A6Error("account-busy", "\u4E13\u9879\u4EFB\u52A1\u6216\u4EE4\u724C\u64CD\u4F5C\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7ED3\u675F\u540E\u518D\u5207\u6362\u8D26\u53F7\u51ED\u636E");
    }
    const previous = { accessToken: this.site.accessToken, userId: this.site.userId };
    const next = {
      accessToken: typeof accessToken === "string" && accessToken.trim() ? accessToken.trim() : previous.accessToken,
      userId: userId === void 0 ? previous.userId : String(userId ?? "").trim()
    };
    if (!next.accessToken) throw new A6Error("auth-missing", "\u8BF7\u586B\u5199 a6api \u8BBF\u95EE\u4EE4\u724C");
    if (!next.userId) throw new A6Error("auth-user-id-missing", "\u8BF7\u586B\u5199 a6api \u7528\u6237 ID");
    this.configSaving = true;
    this.generation += 1;
    this.keyCache.clear();
    this.keyFlights.clear();
    this.providers.reset();
    try {
      this.site.configure(next);
      const verified = await this.site.verify();
      if (String(verified.account?.id) !== next.userId) throw new A6Error("account-mismatch", "\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID \u4E0D\u4E00\u81F4");
      await (await this.table()).put(CONFIG_KEY, { siteId: CONFIG_KEY, ...next });
      return { ok: true, ...await this.config(), account: verified.account, pins: verified.pins };
    } catch (error) {
      this.site.configure(previous);
      this.generation += 1;
      this.providers.reset();
      throw error;
    } finally {
      this.configSaving = false;
    }
  }
  async rotateIntake() {
    await this.intake.rotate();
    return this.config();
  }
  // ---- test keys -----------------------------------------------------------------------------
  accountIdentity() {
    return `${SITE_ORIGIN}:${this.site.configured ? this.site.userId : ""}`;
  }
  assertAvailable() {
    if (this.disposed) throw new A6Error("disposed", "\u63D2\u4EF6\u6B63\u5728\u5378\u8F7D");
    if (this.configSaving) throw new A6Error("account-busy", "\u8D26\u53F7\u51ED\u636E\u6B63\u5728\u5207\u6362\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
  /** Account/generation-scoped cache for the automatic sampling lane only. */
  async key(tokenId) {
    this.assertAvailable();
    const generation = this.generation;
    const identity2 = `${this.accountIdentity()}:${generation}:${tokenId}`;
    const cached = this.keyCache.get(identity2);
    if (cached && cached.until > Date.now()) return cached.key;
    if (!this.keyFlights.has(identity2)) {
      const flight = this.site.tokenKey(tokenId).then((key) => {
        if (generation !== this.generation || this.disposed) throw new A6Error("account-changed", "\u8D26\u53F7\u51ED\u636E\u5DF2\u5207\u6362");
        this.keyCache.set(identity2, { key, until: Date.now() + KEY_TTL_MS });
        return key;
      }).finally(() => this.keyFlights.delete(identity2));
      this.keyFlights.set(identity2, flight);
    }
    return this.keyFlights.get(identity2);
  }
  async tokens() {
    if (!this.site.configured) await this.config();
    this.assertAvailable();
    if (!this.site.configured) throw new A6Error("auth-missing", "\u8BF7\u5148\u914D\u7F6E a6api \u8BBF\u95EE\u4EE4\u724C");
    return { tokens: (await this.site.tokens()).map(publicToken) };
  }
  providerState(input2) {
    return this.providers.state(input2);
  }
  providerConfigure(input2) {
    return this.providers.configure(input2);
  }
  invalidateProviders() {
    this.providers.invalidate();
  }
  assertRecordActive(recordId) {
    if (this.clearInProgress) throw new A6Error("records-clearing", "\u8BB0\u5F55\u6B63\u5728\u6E05\u7A7A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    if (this.deletingRecords.has(recordId)) throw new A6Error("record-deleting", "\u6B64\u8BB0\u5F55\u6B63\u5728\u5220\u9664\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
  /** Keep a record reachable until every daily pin associated with it is restored. */
  async removeRecord(recordId) {
    this.assertRecordActive(recordId);
    this.deletingRecords.add(recordId);
    try {
      const domain = await this.records.domain();
      const record = domain.table("records").get(recordId);
      if (record?.a6api) {
        await this.loadLeases();
        if ([...this.manualLeases.values()].some((lease) => lease.recordId === recordId)) {
          throw new A6Error("record-has-lease", "\u6B64\u8BB0\u5F55\u4ECD\u6709\u65E5\u5E38\u56FA\u5B9A\u6216\u5F85\u6062\u590D\u79DF\u7EA6\uFF0C\u8BF7\u5148\u6062\u590D\u540E\u518D\u5220\u9664");
        }
        if (this.engine.tokenSlots.busy.size) {
          throw new A6Error("record-busy", "\u4EE4\u724C\u69FD\u4F4D\u4ECD\u5728\u6267\u884C\u64CD\u4F5C\uFF0C\u8BF7\u7ED3\u675F\u6216\u6062\u590D\u540E\u518D\u5220\u9664\u4E13\u9879\u8BB0\u5F55");
        }
      }
      return await this.records.remove(recordId);
    } finally {
      this.deletingRecords.delete(recordId);
    }
  }
  async clearRecords() {
    this.assertRecordActive();
    if (this.deletingRecords.size || this.creating) throw new A6Error("records-busy", "\u8BB0\u5F55\u6B63\u5728\u521B\u5EFA\u6216\u5220\u9664\uFF0C\u8BF7\u7A0D\u540E\u6E05\u7A7A");
    this.clearInProgress = true;
    try {
      const domain = await this.records.domain();
      const entries = [...domain.table("records").entries()];
      const ids = new Set(entries.map(([id2]) => id2));
      await this.loadLeases();
      if ([...this.manualLeases.values()].some((lease) => ids.has(lease.recordId))) {
        throw new A6Error("records-have-leases", "\u8BB0\u5F55\u4E2D\u4ECD\u6709\u65E5\u5E38\u56FA\u5B9A\u6216\u5F85\u6062\u590D\u79DF\u7EA6\uFF0C\u8BF7\u5148\u6062\u590D\u540E\u518D\u6E05\u7A7A");
      }
      if (entries.some(([, record]) => record?.a6api) && this.engine.tokenSlots.busy.size) {
        throw new A6Error("records-busy", "\u4EE4\u724C\u69FD\u4F4D\u4ECD\u5728\u6267\u884C\u64CD\u4F5C\uFF0C\u8BF7\u7ED3\u675F\u6216\u6062\u590D\u540E\u518D\u6E05\u7A7A\u4E13\u9879\u8BB0\u5F55");
      }
      return await this.records.clear();
    } finally {
      this.clearInProgress = false;
    }
  }
  async recordTarget(input2) {
    this.assertRecordActive(input2.recordId);
    this.assertAvailable();
    await this.config();
    this.assertAvailable();
    const domain = await this.records.domain();
    const record = domain.table("records").get(input2.recordId);
    this.assertRecordActive(input2.recordId);
    if (!record?.a6api) throw new A6Error("record-not-found", "\u4E13\u9879\u8BB0\u5F55\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664");
    this.assertAccount(record.a6api);
    if (!record.models.some((row) => row.id === input2.model && row.a6api?.model === input2.model && (input2.channelId === void 0 || row.a6api.channelId === input2.channelId))) {
      throw new A6Error("invalid-selection", "\u6A21\u578B\u6216\u6E20\u9053\u4E0D\u5C5E\u4E8E\u6B64\u4E13\u9879\u8BB0\u5F55");
    }
    return record;
  }
  assertAccount(meta) {
    if (!this.site.configured || String(meta.accountId) !== String(this.site.userId) || ![SITE_ORIGIN, "https://www.a6api.vip"].includes(meta.siteOrigin)) {
      throw new A6Error("account-mismatch", "\u5F53\u524D a6api \u8D26\u53F7\u4E0E\u8BB0\u5F55\u6765\u6E90\u4E0D\u540C\uFF0C\u8BF7\u5207\u6362\u5230\u539F\u8D26\u53F7");
    }
  }
  async targetSave(input2) {
    await this.recordTarget(input2);
    const account = await this.providers.ensure();
    const generation = this.generation;
    const epoch = this.providers.epoch;
    this.targetVersions ??= /* @__PURE__ */ new Map();
    const id2 = `${account.identity}:${input2.model}`;
    const version = (this.targetVersions.get(id2) ?? 0) + 1;
    this.targetVersions.set(id2, version);
    await this.providers.verifyTarget(input2, account);
    await this.recordTarget(input2);
    if (generation !== this.generation || epoch !== this.providers.epoch || this.targetVersions.get(id2) !== version) throw new A6Error("target-superseded", "\u76EE\u6807\u9009\u62E9\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0");
    account.targets[input2.model] = { tokenId: input2.tokenId, ...input2.providerId === void 0 ? {} : { providerId: input2.providerId } };
    this.providers.revision += 1;
    await this.providers.persist(account);
    return this.providers.snapshot(account);
  }
  // ---- selections ----------------------------------------------------------------------------
  selections(request) {
    return this.intake.list(request?.revision);
  }
  selection(id2) {
    return this.intake.selection(id2);
  }
  slots(selection, input2) {
    if (!Array.isArray(input2) || !input2.length) throw new A6Error("invalid-slots", "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u6D4B\u8BD5\u69FD\u4F4D");
    const seen = /* @__PURE__ */ new Set();
    return input2.map((slot) => {
      const token = selection.tokens.find((item) => item.id === slot.tokenId);
      if (!token || seen.has(slot.tokenId)) throw new A6Error("invalid-slots", "\u6D4B\u8BD5\u4EE4\u724C\u672A\u9009\u62E9\u6216\u91CD\u590D");
      seen.add(slot.tokenId);
      return { tokenId: token.id, name: token.name };
    });
  }
  async create(input2) {
    this.assertRecordActive();
    this.assertAvailable();
    await this.config();
    this.assertRecordActive();
    this.assertAvailable();
    const selection = this.selection(input2.selectionId);
    this.assertAccount(selection);
    this.creating += 1;
    try {
      const slots = this.slots(selection, input2.slots);
      const allowed = new Map(selection.models.map((channel) => [channelKey(channel), channel]));
      const requested = input2.models ? input2.models.map(channelOf) : selection.models;
      if (!requested.length || requested.length > 64 || requested.some((model) => !allowed.has(channelKey(model)))) {
        throw new A6Error("invalid-selection", "\u5F85\u6D4B\u9879\u4E0D\u5C5E\u4E8E\u7F51\u9875\u9009\u62E9\u6216\u6570\u91CF\u65E0\u6548");
      }
      const channels = requested.map((model) => allowed.get(channelKey(model)));
      if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error("invalid-selection", "\u5F85\u6D4B\u6E05\u5355\u91CD\u590D");
      await this.releaseManual(selection, slots);
      this.assertRecordActive();
      const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: SITE_ORIGIN, slots };
      return await this.records.create({
        kind: "fingerprint",
        name: input2.name || "a6api \u4E13\u9879\u6307\u7EB9",
        a6api,
        options: { timeoutMs: input2.timeoutMs ?? 18e4, concurrency: slots.length },
        models: channels.map((channel) => ({
          // Stable identity is the tested channel, not the worker that happens to claim it.
          provider: `a6api:${channel.channelId}:${channel.supplierId}`,
          id: channel.model,
          name: channel.model,
          a6api: channel,
          relay: { siteId: "a6api", channelId: channel.channelId, supplierId: channel.supplierId, listingId: channel.listingId, model: channel.model, api: channel.model && /claude|anthropic/i.test(`${channel.brand} ${channel.model}`) ? "messages" : "chat" }
        }))
      });
    } finally {
      this.creating -= 1;
    }
  }
  async loadLeases() {
    if (!this.leasesReady) this.leasesReady = (async () => {
      const table = await this.table();
      for (const [key, lease] of table.entries()) {
        if (key.startsWith("a6-lease:") && lease?.identity && lease?.model) this.manualLeases.set(key.slice("a6-lease:".length), lease);
      }
    })();
    return this.leasesReady;
  }
  async putLease(key, lease) {
    await (await this.table()).put(`a6-lease:${key}`, { ...lease, siteId: "a6-lease" });
    this.manualLeases.set(key, lease);
  }
  async deleteLease(key) {
    await (await this.table()).delete(`a6-lease:${key}`);
    this.manualLeases.delete(key);
  }
  async releaseManual(selection, slots) {
    await this.loadLeases();
    const identities = new Set(slots.map((slot) => tokenIdentity({ ...selection, siteOrigin: SITE_ORIGIN }, slot.tokenId)));
    if ([...this.manualLeases.values()].some((lease) => identities.has(lease.identity))) {
      throw new A6Error("lease-held", "\u6D4B\u8BD5\u4EE4\u724C\u4ECD\u6709\u65E5\u5E38\u56FA\u5B9A\u6216\u5F85\u6062\u590D\u79DF\u7EA6\uFF0C\u8BF7\u5148\u663E\u5F0F\u6062\u590D\uFF0C\u6216\u6539\u7528\u4E13\u7528\u6D4B\u8BD5\u4EE4\u724C");
    }
    const pins = await this.site.pins();
    if (pins.some((pin) => slots.some((slot) => slot.tokenId === pin.tokenId))) {
      throw new A6Error("pin-conflict", "\u6D4B\u8BD5\u4EE4\u724C\u5DF2\u6709\u7AD9\u70B9\u56FA\u5B9A\uFF0C\u8BF7\u5148\u5728\u539F\u5904\u6062\u590D\uFF0C\u6216\u9009\u62E9\u4E13\u7528\u6D4B\u8BD5\u4EE4\u724C");
    }
  }
  /** Called by the engine under its token lock, including retries of historical records. */
  async assertTestSlot(tokenId, meta) {
    this.assertRecordActive();
    this.assertAvailable();
    await this.config();
    this.assertAvailable();
    if (!meta) throw new A6Error("account-missing", "\u6D4B\u8BD5\u69FD\u4F4D\u7F3A\u5C11\u8D26\u53F7\u8EAB\u4EFD\uFF0C\u62D2\u7EDD\u4FEE\u6539\u56FA\u5B9A");
    this.assertAccount(meta);
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error("invalid-token", "\u6D4B\u8BD5\u4EE4\u724C ID \u65E0\u6548");
    await this.releaseManual(meta, [{ tokenId }]);
  }
  async resultAction(input2) {
    const record = await this.recordTarget(input2);
    if (input2.operation === "restore") {
      await this.loadLeases();
      const candidates = [...this.manualLeases.values()].filter((lease) => lease.accountId === String(record.a6api.accountId) && lease.siteOrigin === SITE_ORIGIN && lease.recordId === input2.recordId && lease.model === input2.model && lease.channelId === input2.channelId);
      const original = candidates.find((lease) => lease.tokenId === input2.tokenId) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!original && candidates.length > 1) throw new A6Error("lease-ambiguous", "\u6B64\u7ED3\u679C\u6709\u591A\u4E2A\u5F85\u6062\u590D\u76EE\u6807\uFF0C\u8BF7\u9009\u62E9\u539F\u4EE4\u724C\u540E\u6062\u590D");
      if (original) input2 = { ...input2, tokenId: original.tokenId };
    }
    return this.performAction(input2, record.a6api, async () => {
      await this.recordTarget(input2);
      if (input2.operation === "restore") return;
      const account = await this.providers.ensure();
      const target = account.targets[input2.model];
      if (!target || target.tokenId !== input2.tokenId || target.providerId !== input2.providerId) {
        throw new A6Error("target-changed", "\u6B64\u6A21\u578B\u7684\u4F7F\u7528\u76EE\u6807\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
      }
      await this.providers.verifyTarget(input2, account);
      await this.recordTarget(input2);
    });
  }
  async performAction(input2, meta, validate) {
    if (!["pin", "route", "restore"].includes(input2.operation)) throw new A6Error("invalid-operation", "\u53EA\u652F\u6301\u56FA\u5B9A\u3001\u52A0\u5165\u8DEF\u7531\u4E0E\u6062\u590D");
    this.assertAvailable();
    this.assertRecordActive(input2.recordId);
    this.assertAccount(meta);
    if (this.creating) throw new A6Error("slot-busy", "\u4E13\u9879\u4EFB\u52A1\u6B63\u5728\u521B\u5EFA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    const generation = this.generation;
    const identity2 = tokenIdentity({ ...meta, siteOrigin: SITE_ORIGIN }, input2.tokenId);
    if (this.engine.tokenSlots.busy.has(identity2)) throw new A6Error("slot-busy", "\u8BE5\u4EE4\u724C\u6B63\u5728\u6267\u884C\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u69FD\u4F4D\u7A7A\u95F2\u540E\u518D\u64CD\u4F5C");
    await this.engine.tokenSlots.acquire(identity2, new AbortController().signal);
    const key = `${identity2}:${input2.model}`;
    const targetId = `${this.accountIdentity()}:${input2.model}`;
    const targetVersion = this.targetVersions?.get(targetId);
    const providerEpoch = this.providers.epoch;
    const assertCurrent = () => {
      this.assertAvailable();
      this.assertRecordActive(input2.recordId);
      if (input2.recordId && input2.operation !== "restore" && (targetVersion !== this.targetVersions?.get(targetId) || providerEpoch !== this.providers.epoch)) {
        throw new A6Error("target-changed", "\u76EE\u6807\u6216\u63D0\u4F9B\u5546\u914D\u7F6E\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
      }
    };
    try {
      await this.loadLeases();
      await validate();
      assertCurrent();
      if (generation !== this.generation) throw new A6Error("account-changed", "\u8D26\u53F7\u5DF2\u5207\u6362\uFF0C\u8BF7\u5237\u65B0");
      const lease = this.manualLeases.get(key);
      if (input2.operation === "restore") {
        if (!lease) return { ok: true, result: { skipped: true, operation: "restore" } };
        if (lease.channelId !== input2.channelId) throw new A6Error("lease-conflict", "\u5F53\u524D\u56FA\u5B9A\u79DF\u7EA6\u5C5E\u4E8E\u5176\u4ED6\u6E20\u9053\uFF0C\u8BF7\u5148\u6062\u590D\u539F\u76EE\u6807");
        return await this.restoreLease(key, lease);
      }
      if (input2.operation === "route") {
        assertCurrent();
        const outcome2 = await this.site.addRoute({ tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId });
        if (outcome2?.verified !== true) throw new A6Error("route-unverified", "\u672A\u80FD\u8BFB\u56DE\u8DEF\u7531\u65B0\u589E\u7ED3\u679C");
        return { ok: true, result: outcome2 };
      }
      if (lease) throw new A6Error("already-pinned", "\u6B64\u76EE\u6807\u5C1A\u6709\u56FA\u5B9A\u6216\u6062\u590D\u79DF\u7EA6\uFF0C\u8BF7\u5148\u6062\u590D");
      const current = (await this.site.pins()).filter((pin) => pin.tokenId === input2.tokenId && pin.model === input2.model);
      if (current.length > 1) throw new A6Error("pin-conflict", "\u7AD9\u70B9\u56FA\u5B9A\u5173\u7CFB\u4E0D\u552F\u4E00\uFF0C\u8BF7\u5148\u5728\u7AD9\u70B9\u5904\u7406");
      const previous = current[0] ?? null;
      if (previous && typeof previous.fallback !== "boolean") {
        throw new A6Error("pin-conflict", "\u65E0\u6CD5\u786E\u8BA4\u5DF2\u6709\u56FA\u5B9A\u7684\u667A\u80FD\u515C\u5E95\u8BBE\u7F6E\uFF0C\u672A\u8986\u76D6\u73B0\u6709\u56FA\u5B9A");
      }
      const target = {
        identity: identity2,
        accountId: String(meta.accountId),
        siteOrigin: SITE_ORIGIN,
        tokenId: input2.tokenId,
        model: input2.model,
        channelId: input2.channelId,
        recordId: input2.recordId ?? null,
        previous,
        fallback: false,
        stage: "preparing",
        createdAt: Date.now()
      };
      await this.putLease(key, target);
      const before = (await this.site.pins()).filter((pin) => pin.tokenId === input2.tokenId && pin.model === input2.model);
      if (previous ? before.length !== 1 || !this.samePin(before[0], previous) : before.length !== 0) {
        throw new A6Error("pin-conflict", "\u56FA\u5B9A\u51C6\u5907\u671F\u95F4\u7AD9\u70B9\u5173\u7CFB\u5DF2\u53D8\u5316\uFF0C\u672A\u6267\u884C\u8986\u76D6\u4E14\u4FDD\u7559\u79DF\u7EA6");
      }
      assertCurrent();
      const outcome = await this.site.pin({ tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId, fallback: false });
      if (!outcome.routeEffective) throw new A6Error("pin-unverified", "\u56FA\u5B9A\u6E20\u9053\u672A\u751F\u6548\uFF1B\u5DF2\u4FDD\u7559\u6062\u590D\u79DF\u7EA6\uFF0C\u8BF7\u5148\u6062\u590D");
      const observed = (await this.site.pins()).filter((pin) => pin.tokenId === input2.tokenId && pin.model === input2.model);
      const pinned = observed[0];
      if (observed.length !== 1 || pinned.channelId !== input2.channelId || pinned.fallback !== false || pinned.routeEffective !== true) {
        throw new A6Error("pin-unverified", "\u56FA\u5B9A\u8BFB\u56DE\u672A\u786E\u8BA4\uFF0C\u5DF2\u4FDD\u7559\u6062\u590D\u79DF\u7EA6");
      }
      await this.putLease(key, { ...target, stage: "pinned", supplierId: pinned.supplierId });
      return { ok: true, result: { verified: true, operation: "pin", tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId, target: { tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId, supplierId: pinned.supplierId } } };
    } finally {
      this.engine.tokenSlots.release(identity2);
    }
  }
  samePin(actual, expected) {
    return Boolean(actual && expected && actual.channelId === expected.channelId && (expected.supplierId === void 0 || actual.supplierId === expected.supplierId) && (expected.fallback === void 0 || actual.fallback === expected.fallback));
  }
  async restoreLease(key, lease) {
    const pins = (await this.site.pins()).filter((pin) => pin.tokenId === lease.tokenId && pin.model === lease.model);
    if (pins.length > 1) throw new A6Error("lease-conflict", "\u7AD9\u70B9\u56FA\u5B9A\u5173\u7CFB\u4E0D\u552F\u4E00\uFF0C\u4FDD\u7559\u6062\u590D\u79DF\u7EA6");
    const current = pins[0] ?? null;
    if (!current && !lease.previous || this.samePin(current, lease.previous)) {
      await this.deleteLease(key);
      return { ok: true, result: { restored: true, operation: "restore", tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId } };
    }
    if (!this.samePin(current, lease)) throw new A6Error("lease-conflict", "\u7AD9\u70B9\u56FA\u5B9A\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u672A\u8986\u76D6\u4FEE\u6539\u4E14\u4FDD\u7559\u6062\u590D\u79DF\u7EA6");
    if (lease.previous) {
      const outcome = await this.site.pin({ tokenId: lease.tokenId, model: lease.model, channelId: lease.previous.channelId, fallback: lease.previous.fallback });
      if (!outcome.routeEffective) throw new A6Error("restore-unverified", "\u539F\u56FA\u5B9A\u6062\u590D\u672A\u751F\u6548\uFF0C\u4FDD\u7559\u79DF\u7EA6");
    } else {
      await this.site.unpin({ tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId });
    }
    const after = (await this.site.pins()).filter((pin) => pin.tokenId === lease.tokenId && pin.model === lease.model);
    if (lease.previous ? after.length !== 1 || !this.samePin(after[0], lease.previous) : after.length !== 0) {
      throw new A6Error("restore-unverified", "\u6062\u590D\u8BFB\u56DE\u4E0D\u4E00\u81F4\uFF0C\u4FDD\u7559\u79DF\u7EA6");
    }
    await this.deleteLease(key);
    return { ok: true, result: { restored: true, operation: "restore", tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId } };
  }
  async action(input2) {
    await this.config();
    this.assertAvailable();
    const selection = this.selection(input2.selectionId);
    this.assertAccount(selection);
    if (!selection.tokens.some((token) => token.id === input2.tokenId)) throw new A6Error("token-not-selected", "\u53EA\u80FD\u64CD\u4F5C\u4F60\u9009\u62E9\u7684\u6D4B\u8BD5\u4EE4\u724C");
    if (!selection.models.some((channel) => channel.model === input2.model && channel.channelId === input2.channelId)) {
      throw new A6Error("invalid-selection", "\u76EE\u6807\u4E0D\u5C5E\u4E8E\u5F53\u524D\u5F85\u6D4B\u6E05\u5355");
    }
    return this.performAction(input2, selection, async () => this.assertAccount(selection));
  }
  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.keyCache.clear();
    this.keyFlights.clear();
    this.providers.dispose();
  }
};

// backend/a6/ledger.js
import { randomUUID as randomUUID3 } from "node:crypto";
var DELAYS = [2e3, 5e3, 15e3, 3e4, 6e4, 12e4];
var number2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var nonnegative = (value) => number2(value) !== null && value >= 0 ? value : null;
var text3 = (value, max = 256) => typeof value === "string" ? value.slice(0, max) : "";
var terminalBilling = /* @__PURE__ */ new Set(["reconciled", "ambiguous", "unattributed"]);
var identity = (origin, account) => JSON.stringify([origin || "https://a6api.vip", String(account ?? "")]);
var usageOf2 = (usage) => Object.fromEntries(["inputTokens", "outputTokens", "cacheReadTokens"].filter((key) => nonnegative(usage?.[key]) !== null).map((key) => [key, usage[key]]));
var confirmedBilling = (row) => ["observed", "reconciled"].includes(row.billingState) ? row.billing : null;
var A6Ledger = class {
  constructor({ storage, site, onChange } = {}) {
    this.storage = storage;
    this.site = site;
    this.onChange = onChange;
    this.generation = 0;
    this.account = null;
    this.disposed = false;
    this.authPaused = false;
    this.timers = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.queues = /* @__PURE__ */ new Map();
    this.removed = /* @__PURE__ */ new Set();
    this.creating = /* @__PURE__ */ new Set();
    this.ready = storage.records();
    this.ready.catch(() => {
    });
  }
  configure({ siteOrigin = "https://a6api.vip", accountId = this.site?.userId } = {}) {
    this.generation += 1;
    this.authPaused = false;
    this.account = identity(siteOrigin, accountId);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const generation = this.generation;
    void this.ready.then(async (domain) => {
      for (const [, row] of domain.table("executions").entries()) {
        if (!this.current(row, generation)) continue;
        if (row.state === "dispatching" || row.state === "response-received") await this.change(row.id, generation, (item) => ({ ...item, state: "unknown", finishedAt: item.finishedAt ?? Date.now() }));
        if (row.requestId && !terminalBilling.has(row.billingState)) this.schedule(row.id, 0, generation);
      }
    }).catch(() => {
    });
  }
  current(row, generation = this.generation) {
    return !this.disposed && generation === this.generation && !this.removed.has(row.recordId) && identity(row.siteOrigin, row.accountId) === (this.account ?? identity(row.siteOrigin, this.site?.userId)) && String(row.accountId) === String(this.site?.userId ?? "");
  }
  async change(id2, generation, mutate) {
    const previous = this.queues.get(id2) ?? Promise.resolve();
    const next = previous.catch(() => {
    }).then(async () => {
      const domain = await this.ready, table = domain.table("executions"), row = table.get(id2);
      if (!row || !this.current(row, generation) || !domain.table("records").get(row.recordId) || !domain.table("attempts").get(row.attemptId)) return null;
      const updated = mutate(row);
      if (!updated) return null;
      await table.put(id2, updated);
      try {
        this.onChange?.(updated);
      } catch {
      }
      return updated;
    });
    this.queues.set(id2, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id2) === next) this.queues.delete(id2);
    }
  }
  async begin(input2) {
    const generation = this.generation;
    const domain = await this.ready;
    const row = {
      id: `exe-${randomUUID3()}`,
      recordId: input2.recordId,
      attemptId: input2.attemptId,
      jobId: text3(input2.jobId),
      siteOrigin: input2.siteOrigin || "https://a6api.vip",
      accountId: String(input2.accountId ?? ""),
      provider: text3(input2.provider),
      model: text3(input2.model),
      tokenId: input2.tokenId,
      intendedChannelId: input2.intendedChannelId,
      challengeIndex: input2.challengeIndex,
      createdAt: Date.now(),
      dispatchStartedAt: null,
      finishedAt: null,
      state: "prepared",
      requestId: null,
      httpStatus: null,
      streamUsage: {},
      usageState: "missing",
      billingState: "pending",
      billing: null,
      generation
    };
    if (!this.current(row, generation) || !domain.table("records").get(row.recordId) || !domain.table("attempts").get(row.attemptId)) return null;
    row.retryOrdinal = [...domain.table("executions").entries()].filter(([, item]) => item.attemptId === row.attemptId && item.provider === row.provider && item.model === row.model && item.challengeIndex === row.challengeIndex).length;
    const work = (async () => {
      await domain.table("executions").put(row.id, row);
      if (!this.current(row, generation) || !domain.table("records").get(row.recordId) || !domain.table("attempts").get(row.attemptId)) {
        await domain.table("executions").delete(row.id);
        return null;
      }
      try {
        this.onChange?.(row);
      } catch {
      }
      return { id: row.id, generation };
    })();
    this.creating.add(work);
    try {
      return await work;
    } finally {
      this.creating.delete(work);
    }
  }
  async dispatch(handle) {
    if (!handle) return;
    const row = await this.change(handle.id, handle.generation, (item) => ({ ...item, state: "dispatching", dispatchStartedAt: Date.now() }));
    if (!row) throw new Error("\u8BF7\u6C42\u8BB0\u5F55\u6216\u8D26\u53F7\u5DF2\u53D8\u66F4\uFF0C\u672A\u53D1\u9001\u91C7\u6837\u8BF7\u6C42");
  }
  async metadata(handle, metadata) {
    if (!handle) return;
    const updated = await this.change(handle.id, handle.generation, (row) => ({
      ...row,
      requestId: text3(metadata.requestId) || null,
      httpStatus: Number.isInteger(metadata.httpStatus) ? metadata.httpStatus : null,
      responseReceivedAt: Date.now(),
      state: "response-received"
    }));
    if (!updated?.requestId) return;
    const domain = await this.ready;
    const duplicates = [...domain.table("executions").entries()].map(([, row]) => row).filter((row) => row.requestId === updated.requestId && identity(row.siteOrigin, row.accountId) === identity(updated.siteOrigin, updated.accountId));
    if (duplicates.length > 1) for (const duplicate of duplicates) {
      await this.change(duplicate.id, handle.generation, (row) => ({ ...row, billingState: "ambiguous", requestIdCollision: true }));
      clearTimeout(this.timers.get(duplicate.id));
      this.timers.delete(duplicate.id);
    }
  }
  async finish(handle, { state, finishKind, streamUsage } = {}) {
    if (!handle) return;
    const usage = usageOf2(streamUsage);
    const row = await this.change(handle.id, handle.generation, (item) => ({
      ...item,
      state: item.dispatchStartedAt ? state || "ended" : "not-sent",
      finishKind: text3(finishKind, 80),
      finishedAt: Date.now(),
      streamUsage: usage,
      usageState: Object.keys(usage).length ? "stream" : "missing",
      billingState: item.requestIdCollision ? "ambiguous" : !item.dispatchStartedAt ? "not-sent" : item.requestId ? "pending" : "unattributed"
    }));
    if (row?.requestId && !row.requestIdCollision) this.schedule(row.id, 0, handle.generation);
  }
  schedule(id2, index, generation = this.generation, delay = DELAYS[index]) {
    if (this.disposed || this.authPaused || generation !== this.generation || this.timers.has(id2)) return;
    if (index >= DELAYS.length) return;
    const timer = setTimeout(() => {
      this.timers.delete(id2);
      void this.reconcile(id2, generation, index).catch(() => {
      });
    }, delay);
    timer.unref?.();
    this.timers.set(id2, timer);
  }
  reconcile(id2, generation = this.generation, index = 0) {
    const key = `${generation}:${id2}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.query(id2, generation, index).finally(() => {
      if (this.pending.get(key) === work) this.pending.delete(key);
    });
    this.pending.set(key, work);
    return work;
  }
  async query(id2, generation, index) {
    if (this.authPaused || generation !== this.generation || this.disposed) return;
    let row = await this.change(id2, generation, (item) => item.requestId && !item.requestIdCollision ? { ...item, billingState: "querying" } : null);
    if (!row) return;
    try {
      const [result, settings] = await Promise.all([this.site.requestLogs(row.requestId), this.site.billingSettings()]);
      if (!this.current(row, generation)) return;
      const matching = (result.rows ?? []).filter((log2) => log2.request_id === row.requestId);
      const relevant = matching.filter((log2) => Number(log2.type) === 2 || Number(log2.type) === 6);
      const mismatch = matching.some((log2) => String(log2.token_id) !== String(row.tokenId) || log2.model_name !== row.model);
      const ambiguous = mismatch || relevant.length > 1 || relevant.some((log2) => Number(log2.type) === 6) || result.complete !== true;
      const log = relevant.length === 1 && Number(relevant[0].type) === 2 && !ambiguous ? relevant[0] : null;
      let other = log?.other;
      if (typeof other === "string") {
        try {
          other = JSON.parse(other);
        } catch {
          other = {};
        }
      }
      const quota = nonnegative(log?.quota), quotaPerUnit = nonnegative(settings?.quotaPerUnit), usdExchangeRate = nonnegative(settings?.usdExchangeRate);
      const settled = other?.settle_phase === "request_settled";
      const billing = log ? {
        quota,
        quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : null,
        usdExchangeRate,
        costCny: quota !== null && quotaPerUnit > 0 && usdExchangeRate > 0 ? quota / quotaPerUnit * usdExchangeRate : null,
        inputTokens: nonnegative(log.prompt_tokens),
        outputTokens: nonnegative(log.completion_tokens),
        cacheReadTokens: nonnegative(other?.cache_tokens),
        actualChannelId: nonnegative(other?.actual_channel_id) ?? nonnegative(log.channel),
        billedChannelId: nonnegative(other?.billed_channel_id),
        settlePhase: text3(other?.settle_phase, 80),
        observedAt: Date.now(),
        source: "site-log"
      } : null;
      row = await this.change(id2, generation, (item) => ({
        ...item,
        billingState: item.requestIdCollision || ambiguous ? "ambiguous" : billing ? settled ? "reconciled" : "observed" : index + 1 >= DELAYS.length ? "deferred" : "not-found-yet",
        ...billing ? { billing: item.billing?.quotaPerUnit > 0 && item.billing?.usdExchangeRate > 0 ? {
          ...billing,
          quotaPerUnit: item.billing.quotaPerUnit,
          usdExchangeRate: item.billing.usdExchangeRate,
          costCny: billing.quota !== null ? billing.quota / item.billing.quotaPerUnit * item.billing.usdExchangeRate : null
        } : billing } : {},
        billingCheckedAt: Date.now(),
        billingError: null,
        channelMismatch: billing?.actualChannelId != null ? billing.actualChannelId !== item.intendedChannelId : item.channelMismatch ?? false
      }));
      if (row && !terminalBilling.has(row.billingState)) this.schedule(id2, index + 1, generation);
    } catch (error) {
      const auth = /auth|401|403/.test(String(error?.code ?? ""));
      if (auth && this.current(row, generation)) {
        this.authPaused = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
      }
      row = await this.change(id2, generation, (item) => ({ ...item, billingState: item.requestIdCollision ? "ambiguous" : auth ? "unavailable" : index + 1 >= DELAYS.length ? "deferred" : "not-found-yet", billingError: auth ? "auth" : "query-failed", billingCheckedAt: Date.now() }));
      if (row && !auth && !terminalBilling.has(row.billingState)) this.schedule(id2, index + 1, generation, Math.max(DELAYS[index + 1] ?? 0, nonnegative(error?.retryAfterMs) ?? 0));
    }
  }
  async view({ attemptId, recordId, refresh = false } = {}) {
    const domain = await this.ready;
    const attempts = [...domain.table("attempts").entries()].map(([, item]) => item).filter((item) => (!attemptId || item.id === attemptId) && (!recordId || item.recordId === recordId));
    const ids = new Set(attempts.map((item) => item.id));
    const rows = [...domain.table("executions").entries()].map(([, item]) => item).filter((row) => ids.has(row.attemptId) && row.dispatchStartedAt != null);
    if (refresh) {
      for (const row of rows) if (this.current(row) && row.requestId && !row.requestIdCollision) {
        clearTimeout(this.timers.get(row.id));
        this.timers.delete(row.id);
        void this.reconcile(row.id).catch(() => {
        });
      }
    }
    const legacy = attempts.some((attempt) => attempt.ledgerVersion !== 1);
    const billed = rows.filter((row) => row.billing?.costCny != null && ["observed", "reconciled"].includes(row.billingState));
    const tokenRows = rows.map((row) => ({ input: confirmedBilling(row)?.inputTokens ?? row.streamUsage?.inputTokens, output: confirmedBilling(row)?.outputTokens ?? row.streamUsage?.outputTokens }));
    const sum = (key) => {
      const known = tokenRows.map((row) => nonnegative(row[key])).filter((value) => value !== null);
      return known.length ? known.reduce((a, b) => a + b, 0) : null;
    };
    return {
      executions: rows.map(({ generation, ...row }) => ({
        ...row,
        inputTokens: confirmedBilling(row)?.inputTokens ?? row.streamUsage?.inputTokens ?? null,
        outputTokens: confirmedBilling(row)?.outputTokens ?? row.streamUsage?.outputTokens ?? null,
        costCny: confirmedBilling(row)?.costCny ?? null,
        usageState: confirmedBilling(row) ? "billing" : row.usageState,
        accountState: this.current(row) ? "current" : "historical"
      })),
      summary: {
        requestCount: legacy && !rows.length ? null : rows.length,
        knownCostCny: billed.length ? billed.reduce((sum2, row) => sum2 + row.billing.costCny, 0) : null,
        billedCount: billed.length,
        pendingCount: rows.length - rows.filter((row) => row.billingState === "reconciled").length,
        inputTokens: sum("input"),
        outputTokens: sum("output"),
        coverage: {
          legacy,
          requestIdCount: rows.filter((row) => row.requestId).length,
          billingCompleteCount: rows.filter((row) => row.billingState === "reconciled").length,
          usageCount: tokenRows.filter((row) => nonnegative(row.input) !== null && nonnegative(row.output) !== null).length,
          inputCount: tokenRows.filter((row) => nonnegative(row.input) !== null).length,
          outputCount: tokenRows.filter((row) => nonnegative(row.output) !== null).length,
          unattributedCount: rows.filter((row) => !row.requestId).length,
          ambiguousCount: rows.filter((row) => row.billingState === "ambiguous").length
        }
      }
    };
  }
  async removeRecord(recordId) {
    this.removed.add(recordId);
    await Promise.allSettled([...this.creating]);
    const domain = await this.ready;
    const ids = [...domain.table("executions").entries()].filter(([, row]) => row.recordId === recordId).map(([id2]) => id2);
    for (const id2 of ids) {
      clearTimeout(this.timers.get(id2));
      this.timers.delete(id2);
    }
    await Promise.allSettled(ids.map((id2) => this.queues.get(id2)));
    await domain.table("executions").deleteMany(ids);
  }
  async dispose() {
    this.disposed = true;
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.creating, ...this.queues.values(), ...this.pending.values()]);
    this.pending.clear();
  }
};

// backend/index.js
var name = "model-intelligence-test";
var inject = ["typert", "storageDomain", "webServer"];
function apply(ctx) {
  const storage = new PluginStorage(ctx);
  const site = new A6Site();
  const intake = new A6Intake();
  intake.attachStorage(storage);
  ctx.effect(() => intake.mount(ctx.webServer), "model-intelligence.a6-intake");
  let records;
  let a6;
  const ledger = new A6Ledger({ storage, site, onChange: () => records?.bump() });
  site.onConfigure = (meta) => {
    ledger.configure(meta);
    a6?.invalidateProviders();
  };
  const engine = new FingerprintEngine(ctx, {
    ledger,
    onTouch: (job) => records?.onTouch(job),
    onSettled: (job) => records?.onSettled(job),
    // The engine talks to a6api through these three calls only; it never sees credential storage.
    a6: {
      assertSlot: (tokenId, meta) => a6.assertTestSlot(tokenId, meta),
      pin: (target) => a6.site.pin(target),
      unpin: (target) => a6.site.unpin(target),
      key: (tokenId) => a6.key(tokenId)
    }
  });
  records = new RecordsService(ctx, storage, engine, { ledger });
  a6 = new A6Service({ ctx, storage, intake, site, records, engine });
  for (const event of ["llm/adapters-updated", "credentials/reference-updated", "settings/document-updated"]) {
    ctx.on(event, () => a6.invalidateProviders());
  }
  ctx.effect(() => () => {
    a6.dispose();
    engine.dispose();
    site.dispose();
    void Promise.all([records.dispose(), ledger.dispose()]).finally(() => storage.close());
  }, "model-intelligence.lifecycle");
  new ModelIntelligenceService(ctx, { engine, records, a6, ledger });
  ctx.effect(() => ctx.typert.register(hostContribution), "model-intelligence.remote-contract");
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
