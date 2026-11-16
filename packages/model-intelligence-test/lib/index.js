// shared/contract.js
import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
var catalogSchema = z.object({ providers: z.array(z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })),
  error: z.string().optional()
})) });
var id = (max = 128) => z.string().min(1).max(max);
var siteId = id(64);
var concurrency = z.number().int().min(1).max(6);
var timeoutMs = z.number().int().min(3e4).max(18e5);
var relayApi = z.enum(["chat", "responses", "messages"]);
var relayRef = z.strictObject({ siteId, channelId: z.number().int().min(1), model: id(256), api: relayApi, listingId: z.number().int().min(0).optional(), supplierId: z.number().int().min(0).optional() });
var modelRef = z.strictObject({ provider: id(128), id: id(256) });
var recordModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional(), relay: relayRef.optional() });
var a6Channel = z.strictObject({ listingId: z.number().int().nonnegative(), channelId: z.number().int().positive(), supplierId: z.number().int().nonnegative(), model: id(256), supplierName: z.string().max(256).optional(), channelName: z.string().max(256).optional(), brand: z.string().max(256).optional() });
var a6Slots = z.array(z.strictObject({ tokenId: z.number().int().positive() })).min(1);
var options = z.strictObject({ concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() });
var schemas = {
  recordsList: z.strictObject({ revision: z.number().int().min(0).optional() }),
  recordCreate: z.strictObject({
    kind: z.enum(["fingerprint", "custom"]),
    name: z.string().max(120),
    models: z.array(recordModel).min(1).max(64),
    options: options.optional(),
    prompt: z.string().max(2e5).optional(),
    footerVersion: z.string().max(40).optional(),
    preset: z.strictObject({ id: z.string().max(128), name: z.string().max(120), body: z.string().max(2e5) }).nullable().optional()
  }),
  recordRerun: z.strictObject({ recordId: id() }),
  recordDelete: z.strictObject({ recordId: id() }),
  attemptView: z.strictObject({ attemptId: id(), revision: z.number().int().min(0).optional() }),
  attemptCancel: z.strictObject({ attemptId: id() }),
  attemptConfigure: z.strictObject({ attemptId: id(), concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() }),
  attemptRetry: z.strictObject({ attemptId: id(), model: modelRef }),
  customSave: z.strictObject({ recordId: id(), snapshot: z.strictObject({ ended: z.boolean(), runs: z.array(z.json()).max(64) }) }),
  a6ConfigSave: z.strictObject({ accessToken: z.string().max(512).optional(), userId: z.string().max(40).optional() }),
  a6Selections: z.strictObject({ revision: z.number().int().nonnegative().optional() }),
  a6Create: z.strictObject({ selectionId: id(), name: z.string().max(120), slots: a6Slots, timeoutMs: timeoutMs.optional(), models: z.array(a6Channel).min(1).max(64).optional() }),
  a6Action: z.strictObject({ selectionId: id(), tokenId: z.number().int().positive(), model: id(256), channelId: z.number().int().positive(), operation: z.enum(["pin", "restore"]) })
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
  a6Action: "Pin, route or restore one explicit channel for a selected test token, using the stored access token."
};
var json = (symbol) => ({ mode: "strict", typeSymbol: `model-intelligence-test#${symbol}`, create: () => z.json() });
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
var remoteInfo = createTypertRemoteInfo({ package: "model-intelligence-test", methods }, z);
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
  return `${meta.siteOrigin}:${meta.accountId}:${tokenId}`;
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
  const inputTokens = Number(raw.input_tokens ?? raw.prompt_tokens ?? 0);
  const outputTokens = Number(raw.output_tokens ?? raw.completion_tokens ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const cacheReadTokens = Number(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0);
  const reasoningTokens = Number(raw.output_tokens_details?.reasoning_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    ...cacheReadTokens > 0 ? { cacheReadTokens } : {},
    ...reasoningTokens > 0 ? { reasoningTokens } : {}
  };
}
async function* openChannelStream({ key, model, prompt, api = "chat", signal }) {
  const spec = build(api, { key, model, prompt });
  let response;
  try {
    response = await fetch(spec.url, { method: "POST", headers: spec.headers, body: JSON.stringify(spec.body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChannelError("\u65E0\u6CD5\u8FDE\u63A5 a6api", { message: error?.message ?? "network error", code: "network", status: void 0 });
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
      usage = usageOf(payload, "messages") ?? usage;
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
    usage = usageOf(payload, "chat") ?? usage;
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
function redact(text3) {
  if (typeof text3 !== "string" || !text3) return null;
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (match) => /^bearer/i.test(match) ? "Bearer [redacted]" : match.length > 12 ? `${match.slice(0, 6)}\u2026[redacted]` : "[redacted]"), text3).slice(0, 8e3);
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
  async start(models, options2, a6api = null) {
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
      const identity = tokenIdentity(job.a6api, slot.tokenId);
      if (!await this.tokenSlots.acquire(identity, signal)) return;
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
          const target = { tokenId: slot.tokenId, model: run.model, channelId: run.a6api.channelId };
          let attemptedPin = false;
          try {
            run.routing = "pinning";
            this.touch(job);
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
        this.tokenSlots.release(identity);
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
    try {
      const prompt = job.challenges[sample.index].prompt;
      let source;
      if (run.relay) {
        if (!key) throw new FingerprintError("key-unavailable", "\u6D4B\u8BD5\u4EE4\u724C\u5BC6\u94A5\u4E0D\u53EF\u7528");
        source = (this.hooks.openStream ?? openChannelStream)({ key, model: run.model, prompt, api: run.relay.api, signal });
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
    return this.guard(() => this.records.remove(request.recordId));
  }
  recordsClear() {
    return this.guard(() => this.records.clear());
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
  "a6Action"
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
import { z as z2 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
var identified = z2.object({ id: z2.string().min(1) }).passthrough();
var recordsDomain = defineDomain({
  name: "model_intelligence_test",
  version: 1,
  layout: "per-record",
  global: { schema: z2.record(z2.string(), z2.unknown()), initial: {} },
  tables: {
    records: domainTable(identified),
    attempts: domainTable(z2.object({ id: z2.string().min(1), recordId: z2.string().min(1) }).passthrough())
  }
});
var settingsDomain = defineDomain({
  name: "model_intelligence_settings",
  version: 1,
  layout: "per-record",
  tables: {
    // Account-scoped preferences and lease records; no test API key is stored by this flow.
    auth: domainTable(z2.object({ siteId: z2.string().min(1) }).passthrough())
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
var short = (text3, max) => String(text3 ?? "").trim().slice(0, max);
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
  constructor(ctx, storage, engine) {
    this.ctx = ctx;
    this.storage = storage;
    this.engine = engine;
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
    if (!attempt) return;
    let view;
    try {
      view = this.engine.status(jobId);
    } catch {
      return;
    }
    const status = settled ? view.status === "cancelled" ? "cancelled" : view.status === "failed" ? "failed" : "done" : "running";
    await table.put(attemptId, { ...attempt, status, view, finishedAt: settled ? view.finishedAt ?? Date.now() : null });
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
    await records.put(record.id, record);
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
    const number = existing.reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const busy = existing.some((item) => ACTIVE.has(item.status));
    const attempt = { id: `att-${randomUUID2()}`, recordId: record.id, number, status: "queued", createdAt: Date.now(), startedAt: null, finishedAt: null, jobId: null, view: null, error: null };
    await attempts.put(attempt.id, attempt);
    this.bump();
    if (!busy) await this.begin(attempt.id);
    return attempts.get(attempt.id);
  }
  async begin(attemptId) {
    const domain = await this.ready;
    const attempts = domain.table("attempts");
    const attempt = attempts.get(attemptId);
    const record = attempt && domain.table("records").get(attempt.recordId);
    if (!attempt || !record || attempt.status !== "queued") return;
    try {
      const view = await this.engine.start(record.models.map((model) => ({ provider: model.provider, id: model.id, ...model.relay ? { relay: model.relay } : {}, ...model.a6api ? { a6api: model.a6api } : {} })), record.options, record.a6api ?? null);
      this.byJob.set(view.id, attemptId);
      await attempts.put(attemptId, { ...attempts.get(attemptId), status: "running", jobId: view.id, startedAt: Date.now(), view });
    } catch (error) {
      const message = error instanceof FingerprintError ? error.message : "\u6307\u7EB9\u670D\u52A1\u6267\u884C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
      await attempts.put(attemptId, { ...attempts.get(attemptId), status: "failed", finishedAt: Date.now(), error: message });
      void this.startNextQueued(attemptId);
    }
    this.bump();
  }
  async startNextQueued(attemptId) {
    if (this.disposed) return;
    const domain = await this.ready;
    const recordId = domain.table("attempts").get(attemptId)?.recordId;
    if (!recordId) return;
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
      await domain.table("attempts").put(attemptId, { ...attempt, status: "cancelled", finishedAt: Date.now() });
      this.bump();
    } else if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
    return this.attempt(attemptId);
  }
  async configure(attemptId, options2) {
    const attempt = await this.liveJob(attemptId);
    const domain = await this.ready;
    const records = domain.table("records");
    const record = records.get(attempt.recordId);
    if (record) await records.put(record.id, { ...record, options: { ...record.options, ...clean(options2) } });
    if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.configure(attempt.jobId, options2);
    this.bump();
    return this.attempt(attemptId);
  }
  async retry(attemptId, model) {
    const attempt = await this.liveJob(attemptId);
    if (!attempt.jobId || !this.engine.has(attempt.jobId)) throw new FingerprintError("expired", "\u8BE5\u8BF7\u6C42\u5DF2\u4E0D\u5728\u5185\u5B58\u4E2D\uFF08\u8FD0\u884C\u65F6\u91CD\u542F\u6216\u5DF2\u8FC7\u671F\uFF09\uFF0C\u8BF7\u4F7F\u7528\u300C\u518D\u6B21\u8BF7\u6C42\u300D");
    this.engine.retry(attempt.jobId, model);
    const domain = await this.ready;
    await domain.table("attempts").put(attemptId, { ...domain.table("attempts").get(attemptId), status: "running", finishedAt: null });
    this.bump();
    return this.attempt(attemptId);
  }
  async remove(recordId) {
    const domain = await this.domain();
    const attempts = [...domain.table("attempts").entries()].map(([, item]) => item).filter((item) => item.recordId === recordId);
    for (const attempt of attempts) if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
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
    await attempts.put(attempt.id, { ...attempt, status: snapshot?.ended ? "done" : "running", finishedAt: snapshot?.ended ? Date.now() : null, custom: { runs } });
    this.bump();
    return { attemptId: attempt.id };
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
};

// backend/a6/site.js
var SITE_ORIGIN = "https://a6api.vip";
var TIMEOUT_MS = 25e3;
var text = (value, max = 300) => typeof value === "string" ? value.slice(0, max) : "";
function failure(status, payload) {
  const code = text(payload?.code ?? payload?.error?.code, 80);
  const message = text(payload?.message ?? payload?.error?.message, 300);
  if (status === 401 || status === 403) {
    if (code === "dashboard_auth_user_id_missing") return new A6Error("auth-user-id-missing", "\u8BBF\u95EE\u4EE4\u724C\u7F3A\u5C11\u7528\u6237 ID\uFF1A\u8BF7\u540C\u65F6\u586B\u5199\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID\u3002");
    return new A6Error("auth-invalid", "\u8BBF\u95EE\u4EE4\u724C\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728 a6api \u8BBE\u7F6E\u9875\u91CD\u65B0\u751F\u6210\u3002");
  }
  if (status === 429) return new A6Error("rate-limited", "a6api \u63A5\u53E3\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
  return new A6Error(`http-${status}`, message || `a6api \u8FD4\u56DE HTTP ${status}`);
}
var A6Site = class {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.accessToken = "";
    this.userId = "";
  }
  /** Tokens are account-wide, so only the tail is ever echoed back to the UI. */
  configure({ accessToken, userId }) {
    this.accessToken = typeof accessToken === "string" ? accessToken.trim() : "";
    this.userId = userId === void 0 || userId === null ? "" : String(userId).trim();
    if (this.accessToken && !this.userId) throw new A6Error("auth-user-id-missing", "\u8BF7\u540C\u65F6\u586B\u5199\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID\u3002");
  }
  get configured() {
    return Boolean(this.accessToken && this.userId);
  }
  get mask() {
    if (!this.accessToken) return "";
    return this.accessToken.length <= 8 ? "\u2022\u2022\u2022\u2022" : `${this.accessToken.slice(0, 3)}\u2022\u2022\u2022\u2022${this.accessToken.slice(-4)}`;
  }
  headers() {
    if (!this.configured) throw new A6Error("auth-missing", "\u5C1A\u672A\u914D\u7F6E a6api \u8BBF\u95EE\u4EE4\u724C\u3002");
    return { authorization: this.accessToken, "new-api-user": this.userId, accept: "application/json" };
  }
  async request(path, { method = "GET", query, body } = {}) {
    const url = new URL(path, SITE_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== void 0 && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = this.headers();
    if (body !== void 0) headers["content-type"] = "application/json";
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      throw new A6Error("network", `\u65E0\u6CD5\u8FDE\u63A5 a6api\uFF1A${text(error?.message, 160) || "\u7F51\u7EDC\u9519\u8BEF"}`);
    }
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
    }
    if (!response.ok) throw failure(response.status, payload);
    if (payload && payload.success === false) throw failure(response.status, payload);
    return payload;
  }
  async self() {
    const payload = await this.request("/api/user/self");
    const data = payload?.data ?? payload;
    return { id: data?.id ?? Number(this.userId), name: text(data?.display_name ?? data?.username, 120), quota: Number(data?.quota ?? 0) };
  }
  /** Probe the credential pair and report what it can see. */
  async verify() {
    const account = await this.self();
    const pins = await this.pins();
    return { account, pins: pins.length };
  }
  async tokens() {
    const payload = await this.request("/api/token/search", { query: { p: 1, page_size: 100 } });
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.items) ? payload.data.items : [];
    return rows.map((row) => ({
      id: Number(row.id),
      name: text(row.name, 120) || `\u4EE4\u724C ${row.id}`,
      maskedKey: text(row.key, 80),
      unlimited: Boolean(row.unlimited_quota),
      remainQuota: Number(row.remain_quota ?? 0)
    })).filter((token) => Number.isInteger(token.id) && token.id > 0);
  }
  /** Plaintext test key. Host-only; never persisted and never sent to the client. */
  async tokenKey(tokenId) {
    const payload = await this.request(`/api/token/${Number(tokenId)}/key`, { method: "POST", body: {} });
    const key = payload?.data?.key ?? payload?.key;
    if (typeof key !== "string" || !key) throw new A6Error("key-unavailable", `\u4EE4\u724C ${tokenId} \u6CA1\u6709\u53EF\u7528\u7684\u5BC6\u94A5`);
    return key;
  }
  async pins() {
    const payload = await this.request("/api/marketplace/pins");
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return rows.filter((row) => row && Number(row.token_id) > 0).map((row) => ({
      tokenId: Number(row.token_id),
      channelId: Number(row.channel_id),
      supplierId: Number(row.supplier_id ?? 0),
      model: text(row.model_name, 256),
      status: text(row.status, 40)
    }));
  }
  /** Pin (token, model) to one channel. Returns false when the site refuses to route there. */
  async pin({ tokenId, model, channelId, fallback = false }) {
    const payload = await this.request("/api/marketplace/pin", {
      method: "POST",
      body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId), fallback_to_smart_routing: Boolean(fallback) }
    });
    const data = payload?.data ?? payload;
    return { routeEffective: data?.route_effective !== false, supplierId: Number(data?.supplier_id ?? 0) };
  }
  async unpin({ tokenId, model, channelId }) {
    await this.request("/api/marketplace/unpin", {
      method: "POST",
      body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId) }
    });
    return { ok: true };
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
    brand: text2(item?.brand)
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

// backend/a6/service.js
var CONFIG_KEY = "a6-site";
var KEY_TTL_MS = 10 * 6e4;
var A6Service = class {
  constructor({ ctx, storage, records, intake, site, engine }) {
    Object.assign(this, { ctx, storage, records, intake, site, engine });
    this.manualLeases = /* @__PURE__ */ new Map();
    this.keyCache = /* @__PURE__ */ new Map();
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
    const next = {
      accessToken: typeof accessToken === "string" && accessToken.trim() ? accessToken.trim() : this.site.accessToken,
      userId: userId === void 0 ? this.site.userId : String(userId ?? "").trim()
    };
    if (!next.accessToken) throw new A6Error("auth-missing", "\u8BF7\u586B\u5199 a6api \u8BBF\u95EE\u4EE4\u724C");
    if (!next.userId) throw new A6Error("auth-user-id-missing", "\u8BF7\u586B\u5199 a6api \u7528\u6237 ID");
    this.site.configure(next);
    let verified;
    try {
      verified = await this.site.verify();
    } catch (error) {
      this.site.configure({ accessToken: "", userId: "" });
      throw error;
    }
    await (await this.table()).put(CONFIG_KEY, { siteId: CONFIG_KEY, ...next });
    return { ok: true, ...await this.config(), account: verified.account, pins: verified.pins };
  }
  async rotateIntake() {
    await this.intake.rotate();
    return this.config();
  }
  // ---- test keys -----------------------------------------------------------------------------
  /** Plaintext key for one token, cached briefly so a whole run reuses one lookup. */
  async key(tokenId) {
    const cached = this.keyCache.get(tokenId);
    if (cached && cached.until > Date.now()) return cached.key;
    const key = await this.site.tokenKey(tokenId);
    this.keyCache.set(tokenId, { key, until: Date.now() + KEY_TTL_MS });
    return key;
  }
  async tokens() {
    if (!this.site.configured) await this.config();
    if (!this.site.configured) throw new A6Error("auth-missing", "\u8BF7\u5148\u914D\u7F6E a6api \u8BBF\u95EE\u4EE4\u724C");
    return { tokens: await this.site.tokens() };
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
    const selection = this.selection(input2.selectionId);
    const slots = this.slots(selection, input2.slots);
    const allowed = new Set(selection.models.map(channelKey));
    const channels = input2.models ? input2.models.map(channelOf) : selection.models;
    if (!channels.length || channels.length > 64 || channels.some((model) => !allowed.has(channelKey(model)))) {
      throw new A6Error("invalid-selection", "\u5F85\u6D4B\u9879\u4E0D\u5C5E\u4E8E\u7F51\u9875\u9009\u62E9\u6216\u6570\u91CF\u65E0\u6548");
    }
    if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error("invalid-selection", "\u5F85\u6D4B\u6E05\u5355\u91CD\u590D");
    await this.releaseManual(selection, slots);
    const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: selection.siteOrigin, slots };
    return this.records.create({
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
  }
  async releaseManual(selection, slots) {
    for (const slot of slots) {
      const identity = tokenIdentity(selection, slot.tokenId);
      const held = [...this.manualLeases.entries()].filter(([key]) => key.startsWith(`${identity}:`));
      if (!held.length) continue;
      if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error("slot-busy", "\u6B64\u6D4B\u8BD5\u4EE4\u724C\u6B63\u5728\u6267\u884C\u4EFB\u52A1");
      await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
      try {
        for (const [key, lease] of held) {
          await this.site.unpin({ tokenId: slot.tokenId, model: lease.model, channelId: lease.channelId });
          this.manualLeases.delete(key);
        }
      } finally {
        this.engine.tokenSlots.release(identity);
      }
    }
  }
  async action(input2) {
    const selection = this.selection(input2.selectionId);
    if (!selection.tokens.some((token) => token.id === input2.tokenId)) throw new A6Error("token-not-selected", "\u53EA\u80FD\u64CD\u4F5C\u4F60\u9009\u62E9\u7684\u6D4B\u8BD5\u4EE4\u724C");
    if (!selection.models.some((channel) => channel.model === input2.model && channel.channelId === input2.channelId)) {
      throw new A6Error("invalid-selection", "\u76EE\u6807\u4E0D\u5C5E\u4E8E\u5F53\u524D\u5F85\u6D4B\u6E05\u5355");
    }
    const identity = tokenIdentity(selection, input2.tokenId);
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error("slot-busy", "\u8BE5\u6D4B\u8BD5\u4EE4\u724C\u6B63\u5728\u6267\u884C\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u69FD\u4F4D\u7A7A\u95F2\u540E\u518D\u64CD\u4F5C");
    await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
    const key = `${identity}:${input2.model}`;
    try {
      const lease = this.manualLeases.get(key);
      if (input2.operation === "restore") {
        if (!lease) return { ok: true, result: { skipped: true } };
        await this.site.unpin({ tokenId: input2.tokenId, model: lease.model, channelId: lease.channelId });
        this.manualLeases.delete(key);
        return { ok: true, result: { restored: true, target: lease } };
      }
      if (lease) throw new A6Error("already-pinned", "\u8BF7\u5148\u6062\u590D\u672C\u6B21\u624B\u52A8\u56FA\u5B9A\uFF0C\u518D\u9009\u62E9\u5176\u4ED6\u76EE\u6807");
      if (input2.operation === "pin") {
        const outcome = await this.site.pin({ tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId });
        if (!outcome.routeEffective) throw new A6Error("pin-unverified", "\u56FA\u5B9A\u6E20\u9053\u672A\u751F\u6548\uFF0C\u8BF7\u68C0\u67E5\u8BE5\u6E20\u9053\u662F\u5426\u53EF\u7528");
        const target = { tokenId: input2.tokenId, model: input2.model, channelId: input2.channelId, supplierId: outcome.supplierId };
        this.manualLeases.set(key, target);
        return { ok: true, result: { verified: true, target } };
      }
      throw new A6Error("invalid-operation", "\u53EA\u652F\u6301\u56FA\u5B9A\u4E0E\u6062\u590D");
    } finally {
      this.engine.tokenSlots.release(identity);
    }
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
  const engine = new FingerprintEngine(ctx, {
    onTouch: (job) => records?.onTouch(job),
    onSettled: (job) => records?.onSettled(job),
    // The engine talks to a6api through these three calls only; it never sees credential storage.
    a6: {
      pin: (target) => a6.site.pin(target),
      unpin: (target) => a6.site.unpin(target),
      key: (tokenId) => a6.key(tokenId)
    }
  });
  records = new RecordsService(ctx, storage, engine);
  a6 = new A6Service({ ctx, storage, intake, site, records, engine });
  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    void storage.close();
  }, "model-intelligence.lifecycle");
  new ModelIntelligenceService(ctx, { engine, records, a6 });
  ctx.effect(() => ctx.typert.register(hostContribution), "model-intelligence.remote-contract");
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
