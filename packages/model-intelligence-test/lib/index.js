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
var a6Slots = z.array(z.strictObject({ tokenId: z.number().int().positive(), provider: id(128) })).min(1).max(8);
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
  a6Selections: z.strictObject({ revision: z.number().int().nonnegative().optional() }),
  a6Preferences: z.strictObject({ selectionId: id() }),
  a6PreferencesSave: z.strictObject({ selectionId: id(), slots: a6Slots, timeoutMs: timeoutMs.optional() }),
  a6Create: z.strictObject({ selectionId: id(), name: z.string().max(120), slots: a6Slots, timeoutMs: timeoutMs.optional(), models: z.array(a6Channel).min(1).max(64).optional() }),
  a6Action: z.strictObject({ selectionId: id(), tokenId: z.number().int().positive(), model: id(256), channelId: z.number().int().positive(), operation: z.enum(["pin", "route", "restore"]) })
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
  a6BridgeInfo: "Read the owner-only loopback pairing configuration and account-bound page connection status.",
  a6Selections: "Read selections sent by the paired a6api userscript. Does not start inference.",
  a6Preferences: "Read account-scoped test-token to DSH-provider mappings chosen by the user.",
  a6PreferencesSave: "Save the user-selected token/provider mappings for this account and runtime profile.",
  a6Create: "Create an a6api-specific fingerprint attempt using user-selected test token/provider slots (real inference).",
  a6Action: "Execute one explicit pin, route-add or restore action for a selected test token through the paired page."
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
function requestFailure(failure) {
  const status = failure?.status;
  if (failure?.kind === "platform-quota") return "a6api \u5E7F\u573A\u81EA\u52A9\u6D4B\u8BD5\u914D\u989D\u5DF2\u6EE1\uFF08\u6BCF\u8D26\u53F7 5 \u6B21/\u5206\u949F\u3001\u6BCF\u6E20\u9053 20 \u6B21/\u5206\u949F\uFF09\xB7 \u672C\u6B21\u672A\u53D1\u5F80\u5546\u5BB6\u3001\u672A\u6263\u8D39";
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
function redact(text2) {
  if (typeof text2 !== "string" || !text2) return null;
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (match) => /^bearer/i.test(match) ? "Bearer [redacted]" : match.length > 12 ? `${match.slice(0, 6)}\u2026[redacted]` : "[redacted]"), text2).slice(0, 8e3);
}
function failureDetail(failure, source) {
  const facts = failure?.failure ?? failure;
  const message = redact(typeof facts === "string" ? facts : facts?.message);
  return {
    source,
    message,
    code: typeof facts?.code === "string" ? facts.code : null,
    status: Number.isInteger(facts?.status) ? facts.status : null,
    text: typeof facts === "string" ? null : redact(facts?.detail ?? facts?.message ?? null),
    stack: typeof failure?.stack === "string" ? redact(failure.stack) : null
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
   * @param hooks.bridge paired a6api site-command bridge (no API keys)
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
      if (typeof llm.prepareCall !== "function") throw new FingerprintError("incompatible-runtime", "\u5F53\u524D DSH \u4E0D\u652F\u6301\u5B98\u65B9 LLM \u8BF7\u6C42\u51C6\u5907\u63A5\u53E3\uFF0C\u8BF7\u5347\u7EA7\u8FD0\u884C\u65F6");
    }
    this.starting += 1;
    try {
      if (a6api) {
        this.hooks.bridge.assertReady(a6api, a6api.slots);
        const availableProviders = new Set(llm.listProviders().map((provider) => provider.id));
        if (a6api.slots.some((slot) => !availableProviders.has(slot.provider))) throw new FingerprintError("unknown-model", "\u6240\u9009 DSH \u63D0\u4F9B\u5546\u5DF2\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
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
    this.hooks = { bridge: this.hooks.bridge };
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
    job.status = "done";
    job.finishedAt = Date.now();
    this.touch(job);
    this.settle(job);
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
    const workers = job.a6api.slots.map(async (slot) => {
      const identity = tokenIdentity(job.a6api, slot.tokenId);
      if (!await this.tokenSlots.acquire(identity, signal)) return;
      try {
        while (job.pending.length && !signal.aborted) {
          const run = job.pending.shift();
          run.callProvider = slot.provider;
          run.slotTokenId = slot.tokenId;
          const queued = run.samples.filter((sample) => sample.state === "queued");
          if (!queued.length) continue;
          const leaseId = randomUUID();
          const target = { tokenId: slot.tokenId, model: run.model, channelId: run.a6api.channelId, leaseId };
          let attemptedPin = false;
          try {
            run.routing = "waiting-page";
            this.touch(job);
            if (this.hooks.bridge.waitReady) await this.hooks.bridge.waitReady(job.a6api, [slot], signal);
            else this.hooks.bridge.assertReady(job.a6api, [slot]);
            run.routing = "pinning";
            this.touch(job);
            if (signal.aborted) break;
            attemptedPin = true;
            const ack = await this.hooks.bridge.execute(job.a6api, { ...target, operation: "pin" });
            if (!ack.verified) throw new FingerprintError("pin-unverified", "\u56FA\u5B9A\u6E20\u9053\u672A\u786E\u8BA4\uFF0C\u672A\u53D1\u9001\u91C7\u6837\u8BF7\u6C42");
            if (signal.aborted) break;
            run.routing = "sampling";
            this.touch(job);
            if (!await this.acquire(signal, queued.length)) break;
            try {
              const settled = await Promise.allSettled(queued.map((sample) => this.sample(job, llm, run, sample)));
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
                const restored = await this.hooks.bridge.execute(job.a6api, { ...target, operation: "restore" });
                if (restored.conflict || !restored.restored && !restored.skipped) throw new FingerprintError("restore-unverified", "\u56FA\u5B9A\u5173\u7CFB\u672A\u6062\u590D\uFF0C\u8BF7\u68C0\u67E5 a6api \u9875\u9762");
                run.routing = "restored";
              } catch (error) {
                run.routing = "restore-failed";
                run.error = { stage: "finalizing", message: "\u56FA\u5B9A\u5173\u7CFB\u6062\u590D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 a6api \u9875\u9762\u540E\u91CD\u65B0\u8FDE\u63A5\uFF1B\u672C\u6B21\u6D4B\u8BD5\u5DF2\u505C\u6B62\u9886\u53D6\u4EFB\u52A1", detail: failureDetail(error, "restore") };
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
    } else job.status = "done";
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
  failJob(job, failure) {
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
        sample.errorDetail = { ...failureDetail(failure, "scheduler"), message: sample.error };
      }
      run.stage = "failed";
      run.error = {
        stage: "streaming",
        message: "\u6307\u7EB9\u4EFB\u52A1\u6267\u884C\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5",
        detail: failureDetail(failure, "scheduler")
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
    let truncated = false, failure = null, rawFailure = null, failureSource = "prepare";
    try {
      const prepared = await llm.prepareCall({ provider: run.callProvider ?? run.provider, model: run.model }, signal);
      signal.throwIfAborted();
      const message = createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: job.challenges[sample.index].prompt }]
      });
      failureSource = "stream";
      for await (const chunk of prepared.stream({ ...prepared.config, messages: [message], signal })) {
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
          failure = finish.kind === "error" ? requestFailure(rawFailure) : "\u4F9B\u5E94\u5546\u4E2D\u65AD\u4E86\u6A21\u578B\u8BF7\u6C42";
        } else if (finish.kind === "tool-calls") failure = "\u6A21\u578B\u5C1D\u8BD5\u8C03\u7528\u5DE5\u5177\uFF0C\u56DE\u7B54\u65E0\u6548";
      }
    } catch (error) {
      if (!textLimitController.signal.aborted) {
        failure = requestFailure(error?.failure ?? error);
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
    } else if (failure) {
      sample.state = "failed";
      sample.error = failure;
      sample.errorDetail = { ...failureDetail(rawFailure, failureSource), message: failure };
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

// backend/a6/bridge.js
import { randomBytes, randomUUID as randomUUID2, timingSafeEqual } from "node:crypto";
var PREFIX = "/mit-a6/bridge/";
var SITE_ORIGINS = /* @__PURE__ */ new Set(["https://a6api.vip", "https://www.a6api.vip"]);
var MAX_BODY = 256e3;
var ONLINE_MS = 15e3;
var COMMAND_MS = 45e3;
var clone = (value) => JSON.parse(JSON.stringify(value));
var secret = () => randomBytes(32).toString("base64url");
var equal = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
var A6Error = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new A6Error("invalid-input", `${label}\u65E0\u6548`);
  return value;
}
function text(value, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new A6Error("invalid-input", "\u5B57\u6BB5\u4E3A\u7A7A\u6216\u8D85\u957F");
  return value.trim();
}
function channelOf(item) {
  return {
    listingId: Number.isSafeInteger(item?.listingId) && item.listingId >= 0 ? item.listingId : 0,
    channelId: positive(item?.channelId, "\u6E20\u9053 ID"),
    supplierId: Number.isSafeInteger(item?.supplierId) && item.supplierId >= 0 ? item.supplierId : 0,
    model: text(item?.model),
    ...Object.fromEntries(["supplierName", "channelName", "brand"].map((key) => [key, typeof item?.[key] === "string" ? item[key].slice(0, 256) : ""]))
  };
}
function channelKey(item) {
  return `${item.listingId}:${item.channelId}:${item.supplierId}:${item.model}`;
}
function tokensOf(input2) {
  if (!Array.isArray(input2) || input2.length > 32) throw new A6Error("invalid-input", "\u6D4B\u8BD5\u4EE4\u724C\u5217\u8868\u65E0\u6548");
  const seen = /* @__PURE__ */ new Set();
  return input2.map((item) => ({ id: positive(item?.id, "\u6D4B\u8BD5\u4EE4\u724C ID"), name: String(item?.name ?? "").slice(0, 120) })).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
var A6Bridge = class {
  constructor({ origin = "", nativeUrl = "dsh://open", clock = Date.now } = {}) {
    this.origin = origin.replace(/\/$/, "");
    this.nativeUrl = nativeUrl;
    this.now = clock;
    this.capability = secret();
    this.connections = /* @__PURE__ */ new Map();
    this.selections = /* @__PURE__ */ new Map();
    this.commands = /* @__PURE__ */ new Map();
    this.revision = 1;
    this.disposed = false;
    this.ready = Promise.resolve();
    this.recovered = /* @__PURE__ */ new Map();
    this.notApplied = /* @__PURE__ */ new Set();
  }
  attachStorage(storage) {
    this.ready = storage.managed().then((domain) => {
      if (!domain) throw new A6Error("storage-unavailable", "a6api \u914D\u7F6E\u5B58\u50A8\u4E0D\u53EF\u7528");
      this.leaseTable = domain.table("auth");
      for (const [key, value] of this.leaseTable.entries()) if (key.startsWith("lease:") && value.meta && value.command) this.recovered.set(key, value);
    });
    this.ready.catch(() => {
    });
  }
  recover(connection) {
    for (const [key, lease] of this.recovered) {
      if (lease.meta.accountId !== connection.accountId || lease.meta.siteOrigin !== connection.siteOrigin || lease.recovering) continue;
      lease.recovering = true;
      void this.execute({ ...lease.meta, connectionId: connection.id }, lease.command).then((result) => {
        if (!result.conflict && (result.restored || result.skipped)) this.recovered.delete(key);
      }).catch(() => {
      }).finally(() => {
        lease.recovering = false;
      });
    }
  }
  info() {
    return {
      configuration: { origin: this.origin, capability: this.capability },
      nativeSupported: Boolean(this.nativeUrl),
      connected: [...this.connections.values()].some((connection) => this.online(connection)),
      connections: [...this.connections.values()].map((connection) => ({ id: connection.id, accountId: connection.accountId, siteOrigin: connection.siteOrigin, online: this.online(connection) }))
    };
  }
  online(connection) {
    return connection && this.now() - connection.lastSeen < ONLINE_MS;
  }
  launch(selectionId = "") {
    const url = new URL(this.origin || "http://127.0.0.1");
    if (selectionId) url.hash = `mit-a6-selection=${encodeURIComponent(selectionId)}`;
    return { nativeUrl: this.nativeUrl, webUrl: url.href };
  }
  connect(input2) {
    if (!SITE_ORIGINS.has(input2?.siteOrigin)) throw new A6Error("wrong-origin", "\u4EC5\u652F\u6301 a6api \u5B98\u7F51");
    const accountId = text(String(input2?.accountId ?? ""), 32);
    if (!/^\d+$/.test(accountId)) throw new A6Error("invalid-account", "a6api \u8D26\u53F7 ID \u65E0\u6548");
    const pageId = text(input2?.pageId, 128);
    for (const old of this.connections.values()) if (old.pageId === pageId) this.dropConnection(old.id);
    if (this.connections.size >= 32) throw new A6Error("connection-limit", "\u8FDE\u63A5\u9875\u9762\u8FC7\u591A\uFF0C\u8BF7\u5173\u95ED\u4E0D\u7528\u7684\u9875\u9762\u540E\u91CD\u8BD5");
    const connection = { id: randomUUID2(), accountId, pageId, siteOrigin: input2.siteOrigin, sessionToken: secret(), tokens: tokensOf(input2.tokens ?? []), lastSeen: this.now() };
    this.connections.set(connection.id, connection);
    this.revision++;
    this.recover(connection);
    return { connectionId: connection.id, sessionToken: connection.sessionToken, launch: this.launch() };
  }
  authenticate(input2, sessionToken) {
    const connection = this.connections.get(input2?.connectionId);
    if (!connection || !equal(connection.sessionToken, sessionToken) || String(input2?.accountId) !== connection.accountId) throw new A6Error("not-paired", "\u9875\u9762\u672A\u914D\u5BF9\u6216\u8D26\u53F7\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5");
    connection.lastSeen = this.now();
    return connection;
  }
  submit(connection, input2) {
    if (!Array.isArray(input2.models) || !input2.models.length || input2.models.length > 64) throw new A6Error("invalid-selection", "\u6BCF\u6B21\u8BF7\u9009\u62E9 1\u201364 \u4E2A\u5F85\u6D4B\u9879");
    const models = [...new Map(input2.models.map(channelOf).map((item) => [channelKey(item), item])).values()];
    const tokens2 = tokensOf(input2.tokens ?? connection.tokens);
    if (!tokens2.length) throw new A6Error("no-test-token", "\u8BF7\u5148\u5230\u4EE4\u724C\u7BA1\u7406\u9875\u9009\u62E9\u7528\u4E8E\u6D4B\u8BD5\u7684\u4EE4\u724C");
    connection.tokens = tokens2;
    if (this.selections.size >= 100) this.selections.delete(this.selections.keys().next().value);
    const selection = { id: randomUUID2(), connectionId: connection.id, accountId: connection.accountId, siteOrigin: connection.siteOrigin, createdAt: this.now(), models, tokens: tokens2 };
    this.selections.set(selection.id, selection);
    this.revision++;
    return { selectionId: selection.id, launch: this.launch(selection.id) };
  }
  list(revision) {
    if (revision === this.revision) return { revision, unchanged: true };
    return { revision: this.revision, selections: [...this.selections.values()].map(clone) };
  }
  selection(id2) {
    const selection = this.selections.get(id2);
    if (!selection) throw new A6Error("selection-expired", "\u7F51\u9875\u9009\u62E9\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u56DE a6api \u91CD\u65B0\u70B9\u51FB\u300C\u524D\u5F80 DSH \u6D4B\u8BD5\u300D");
    return clone(selection);
  }
  connectionFor(meta) {
    const exact = this.connections.get(meta.connectionId);
    if (this.online(exact) && exact.accountId === meta.accountId && exact.siteOrigin === meta.siteOrigin) return exact;
    const live = [...this.connections.values()].find((connection) => this.online(connection) && connection.accountId === meta.accountId && connection.siteOrigin === meta.siteOrigin);
    if (!live) throw new A6Error("page-offline", "a6api \u9875\u9762\u672A\u8FDE\u63A5\u6216\u8D26\u53F7\u5DF2\u5207\u6362\uFF1B\u8BF7\u4FDD\u6301\u539F\u8D26\u53F7\u9875\u9762\u6253\u5F00\u5E76\u91CD\u65B0\u8FDE\u63A5");
    return live;
  }
  assertReady(meta, slots) {
    if ([...this.recovered.values()].some((lease) => lease.meta.accountId === meta.accountId && lease.meta.siteOrigin === meta.siteOrigin)) throw new A6Error("recovering", "\u4E0A\u6B21\u6D4B\u8BD5\u56FA\u5B9A\u5173\u7CFB\u6B63\u5728\u6062\u590D\uFF0C\u8BF7\u7A0D\u540E\u518D\u5F00\u59CB");
    const connection = this.connectionFor(meta);
    for (const slot of slots) if (!connection.tokens.some((token) => token.id === slot.tokenId)) throw new A6Error("token-not-selected", "\u6D4B\u8BD5\u4EE4\u724C\u5DF2\u53D6\u6D88\u9009\u62E9\uFF0C\u8BF7\u56DE\u7F51\u9875\u91CD\u65B0\u786E\u8BA4");
    return connection;
  }
  poll(connection, input2 = {}) {
    if (Array.isArray(input2.tokens)) connection.tokens = tokensOf(input2.tokens);
    this.recover(connection);
    return { connected: true, commands: [...this.commands.values()].filter((entry) => entry.connectionId === connection.id).map((entry) => clone(entry.command)) };
  }
  async ack(connection, input2) {
    const entry = this.commands.get(input2.commandId);
    if (!entry || entry.connectionId !== connection.id) return { ok: true, ignored: true };
    this.commands.delete(input2.commandId);
    clearTimeout(entry.timer);
    if (input2.ok === true) {
      const result = input2.result && typeof input2.result === "object" ? {
        verified: input2.result.verified === true,
        restored: input2.result.restored === true,
        skipped: input2.result.skipped === true,
        conflict: input2.result.conflict === true
      } : {};
      if (entry.command.operation === "restore" && !result.conflict && (result.restored || result.skipped)) {
        await this.leaseTable?.delete(`lease:${entry.command.leaseId}`);
      }
      entry.resolve(result);
    } else {
      if (entry.command.operation === "pin" && input2.result?.notApplied === true) {
        this.notApplied.add(entry.command.leaseId);
        await this.leaseTable?.delete(`lease:${entry.command.leaseId}`);
      }
      entry.reject(new A6Error("site-operation-failed", typeof input2.error === "string" ? input2.error.slice(0, 400).replace(/\bsk-[\w-]+/g, "[redacted]") : "a6api \u7AD9\u70B9\u64CD\u4F5C\u5931\u8D25"));
    }
    return { ok: true };
  }
  async waitReady(meta, slots, signal) {
    while (!signal.aborted && !this.disposed) {
      try {
        return this.assertReady(meta, slots);
      } catch (error) {
        if (!["page-offline", "recovering"].includes(error.code)) throw error;
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 1e3);
          signal.addEventListener("abort", done, { once: true });
        });
      }
    }
    throw new A6Error("cancelled", "\u5DF2\u53D6\u6D88");
  }
  async execute(meta, command, { timeoutMs: timeoutMs2 = COMMAND_MS } = {}) {
    try {
      if (this.disposed) throw new A6Error("disposed", "\u63D2\u4EF6\u5DF2\u5378\u8F7D");
      await this.ready;
      if (command.operation === "restore" && this.notApplied.delete(command.leaseId)) return { skipped: true, restored: true };
      const connection = command.operation === "restore" ? this.connectionFor(meta) : this.assertReady(meta, [{ tokenId: command.tokenId }]);
      if (command.operation === "pin" && this.leaseTable) {
        const lease = { siteId: `lease:${command.leaseId}`, meta, command: { ...command, operation: "restore" } };
        await this.leaseTable.put(lease.siteId, lease);
      }
      const id2 = randomUUID2();
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.commands.delete(id2);
          reject(new A6Error("site-timeout", "\u7B49\u5F85\u6CB9\u7334\u6267\u884C\u64CD\u4F5C\u8D85\u65F6\uFF1B\u8BF7\u68C0\u67E5 a6api \u9875\u9762\u8FDE\u63A5\u4E0E\u56FA\u5B9A\u72B6\u6001"));
        }, timeoutMs2);
        this.commands.set(id2, { connectionId: connection.id, command: { ...command, id: id2 }, resolve, reject, timer });
      });
    } catch (error) {
      if (command.operation === "restore" && this.leaseTable) {
        const key = `lease:${command.leaseId}`;
        const lease = this.leaseTable.get(key);
        if (lease) this.recovered.set(key, lease);
      }
      throw error;
    }
  }
  dropConnection(id2) {
    this.connections.delete(id2);
    for (const [commandId, entry] of this.commands) if (entry.connectionId === id2) {
      clearTimeout(entry.timer);
      this.commands.delete(commandId);
      entry.reject(new A6Error("page-offline", "a6api \u9875\u9762\u5DF2\u91CD\u8FDE\u6216\u5207\u6362\u8D26\u53F7"));
    }
  }
  mount(webServer) {
    this.origin = webServer.getOrigin();
    const url = new URL(this.origin);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new A6Error("loopback-required", "a6api \u6865\u63A5\u4EC5\u5141\u8BB8\u672C\u673A DSH \u670D\u52A1");
    return webServer.register({ kind: "prefix", path: PREFIX, handler: (req, res) => this.handle(req, res) });
  }
  async handle(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const host = new URL(`http://${req.headers.host ?? ""}`).hostname;
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new A6Error("wrong-host", "\u975E\u6CD5 Host");
      if (req.headers.origin && !SITE_ORIGINS.has(req.headers.origin) && req.headers.origin !== this.origin) throw new A6Error("wrong-origin", "\u975E\u6CD5\u6765\u6E90");
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "\u4EC5\u63A5\u53D7 POST" }));
        return;
      }
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new A6Error("invalid-input", "\u9700\u8981 JSON \u8BF7\u6C42");
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new A6Error("body-limit", "\u8BF7\u6C42\u8FC7\u5927");
        chunks.push(chunk);
      }
      const input2 = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const action = new URL(req.url, this.origin).pathname.slice(PREFIX.length);
      let result;
      if (action === "connect") {
        if (!equal(req.headers["x-mit-capability"], this.capability)) throw new A6Error("not-paired", "\u8FDE\u63A5\u53E3\u4EE4\u4E0D\u6B63\u786E\uFF0C\u8BF7\u4ECE DSH \u91CD\u65B0\u590D\u5236\u8FDE\u63A5\u914D\u7F6E");
        await this.ready;
        result = this.connect(input2);
      } else {
        const connection = this.authenticate(input2, req.headers["x-mit-session"]);
        if (action === "selection") result = this.submit(connection, input2);
        else if (action === "poll") result = this.poll(connection, input2);
        else if (action === "ack") result = await this.ack(connection, input2);
        else throw new A6Error("not-found", "\u63A5\u53E3\u4E0D\u5B58\u5728");
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error?.code === "not-paired" || error?.code === "wrong-origin" || error?.code === "wrong-host" ? 403 : 400;
      res.end(JSON.stringify({ error: error instanceof A6Error ? error.message : "\u6865\u63A5\u8BF7\u6C42\u683C\u5F0F\u65E0\u6548", code: error?.code ?? "invalid-input" }));
    }
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.commands.values()) {
      clearTimeout(entry.timer);
      entry.reject(new A6Error("disposed", "\u63D2\u4EF6\u5DF2\u5378\u8F7D"));
    }
    this.commands.clear();
    this.connections.clear();
    this.selections.clear();
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
    this.bridge = deps.bridge;
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
  // Owner-only control plane; browser pages use the paired, narrowly scoped bridge instead.
  a6BridgeInfo() {
    return this.guard(() => this.bridge.info());
  }
  a6Selections(request) {
    return this.guard(() => this.bridge.list(request?.revision));
  }
  a6Preferences(request) {
    return this.guard(() => this.a6.preferences(request));
  }
  a6PreferencesSave(request) {
    return this.guard(() => this.a6.savePreferences(request));
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
  "a6BridgeInfo",
  "a6Selections",
  "a6Preferences",
  "a6PreferencesSave",
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
import { randomUUID as randomUUID3 } from "node:crypto";
var PERSIST_THROTTLE_MS = 1500;
var MAX_RECORDS = 500;
var ACTIVE = /* @__PURE__ */ new Set(["queued", "running"]);
var END_SAMPLE = /* @__PURE__ */ new Set(["complete", "truncated", "failed", "cancelled"]);
var END_STAGE = /* @__PURE__ */ new Set(["completed", "failed", "timeout", "cancelled"]);
var clean = (value) => JSON.parse(JSON.stringify(value ?? null));
var short = (text2, max) => String(text2 ?? "").trim().slice(0, max);
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
    const status = settled ? view.status === "cancelled" ? "cancelled" : "done" : "running";
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
      id: `rec-${randomUUID3()}`,
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
    const attempt = { id: `att-${randomUUID3()}`, recordId: record.id, number, status: "queued", createdAt: Date.now(), startedAt: null, finishedAt: null, jobId: null, view: null, error: null };
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
    const attempt = existing ?? { id: `att-${randomUUID3()}`, recordId, number: 1, createdAt: Date.now(), startedAt: Date.now(), jobId: null, view: null, error: null };
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

// backend/a6/service.js
import { randomUUID as randomUUID4 } from "node:crypto";
var A6Service = class {
  constructor({ ctx, storage, records, bridge, engine }) {
    Object.assign(this, { ctx, storage, records, bridge, engine });
    this.manualLeases = /* @__PURE__ */ new Map();
  }
  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new A6Error("storage-unavailable", "\u4E13\u9879\u914D\u7F6E\u5B58\u50A8\u4E0D\u53EF\u7528");
    return domain.table("auth");
  }
  preferenceKey(selection) {
    return `prefs:${selection.siteOrigin}:${selection.accountId}`;
  }
  slots(selection, input2) {
    if (!Array.isArray(input2) || !input2.length || input2.length > 8) throw new A6Error("invalid-slots", "\u8BF7\u9009\u62E9 1\u20138 \u4E2A\u6D4B\u8BD5\u69FD\u4F4D");
    const seen = /* @__PURE__ */ new Set();
    return input2.map((slot) => {
      if (!selection.tokens.some((token) => token.id === slot.tokenId) || seen.has(slot.tokenId)) throw new A6Error("invalid-slots", "\u6D4B\u8BD5\u4EE4\u724C\u672A\u9009\u62E9\u6216\u91CD\u590D");
      seen.add(slot.tokenId);
      if (typeof slot.provider !== "string" || !slot.provider.trim() || slot.provider.length > 128) throw new A6Error("invalid-slots", "\u8BF7\u4E3A\u6BCF\u4E2A\u6D4B\u8BD5\u4EE4\u724C\u9009\u62E9 DSH \u63D0\u4F9B\u5546");
      return { tokenId: slot.tokenId, provider: slot.provider };
    });
  }
  async preferences({ selectionId }) {
    const selection = this.bridge.selection(selectionId);
    const row = (await this.table()).get(this.preferenceKey(selection));
    return { slots: (row?.slots ?? []).filter((slot) => selection.tokens.some((token) => token.id === slot.tokenId)), timeoutMs: row?.timeoutMs ?? 18e4 };
  }
  async savePreferences(input2) {
    const selection = this.bridge.selection(input2.selectionId);
    const slots = this.slots(selection, input2.slots);
    const key = this.preferenceKey(selection);
    await (await this.table()).put(key, { siteId: key, slots, timeoutMs: input2.timeoutMs ?? 18e4 });
    return { ok: true };
  }
  async create(input2) {
    const selection = this.bridge.selection(input2.selectionId);
    const slots = this.slots(selection, input2.slots);
    this.bridge.assertReady(selection, slots);
    const llm = this.ctx.get("llm");
    const providers = new Set(llm?.listProviders().map((provider) => provider.id) ?? []);
    if (slots.some((slot) => !providers.has(slot.provider))) throw new A6Error("unknown-provider", "\u9009\u62E9\u7684 DSH \u63D0\u4F9B\u5546\u5DF2\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
    const allowed = new Set(selection.models.map(channelKey));
    const channels = input2.models ? input2.models.map(channelOf) : selection.models;
    if (!channels.length || channels.length > 64 || channels.some((model) => !allowed.has(channelKey(model)))) throw new A6Error("invalid-selection", "\u5F85\u6D4B\u9879\u4E0D\u5C5E\u4E8E\u7F51\u9875\u9009\u62E9\u6216\u6570\u91CF\u65E0\u6548");
    if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error("invalid-selection", "\u5F85\u6D4B\u6E05\u5355\u91CD\u590D");
    for (const slot of slots) {
      const identity = tokenIdentity(selection, slot.tokenId);
      const leases = [...this.manualLeases.entries()].filter(([key]) => key.startsWith(`${identity}:`));
      if (!leases.length) continue;
      if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error("slot-busy", "\u6B64\u6D4B\u8BD5\u4EE4\u724C\u6B63\u5728\u6267\u884C\u4EFB\u52A1");
      await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
      try {
        for (const [key, lease] of leases) {
          const restored = await this.bridge.execute(selection, { operation: "restore", tokenId: slot.tokenId, model: lease.model, channelId: lease.channelId, leaseId: lease.leaseId });
          if (restored.conflict || !restored.restored && !restored.skipped) throw new A6Error("restore-unverified", "\u8BF7\u5148\u6062\u590D\u5FEB\u6377\u56FA\u5B9A\uFF0C\u518D\u5F00\u59CB\u4E13\u9879\u6D4B\u8BD5");
          this.manualLeases.delete(key);
        }
      } finally {
        this.engine.tokenSlots.release(identity);
      }
    }
    await this.savePreferences(input2);
    const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: selection.siteOrigin, connectionId: selection.connectionId, slots };
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
        relay: { siteId: "a6api", channelId: channel.channelId, supplierId: channel.supplierId, listingId: channel.listingId, model: channel.model, api: "chat" }
      }))
    });
  }
  async action(input2) {
    const selection = this.bridge.selection(input2.selectionId);
    if (!selection.tokens.some((token) => token.id === input2.tokenId)) throw new A6Error("token-not-selected", "\u53EA\u80FD\u64CD\u4F5C\u4F60\u9009\u62E9\u7684\u6D4B\u8BD5\u4EE4\u724C");
    if (!selection.models.some((channel) => channel.model === input2.model && channel.channelId === input2.channelId)) throw new A6Error("invalid-selection", "\u76EE\u6807\u4E0D\u5C5E\u4E8E\u5F53\u524D\u5F85\u6D4B\u6E05\u5355");
    const identity = tokenIdentity(selection, input2.tokenId);
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error("slot-busy", "\u8BE5\u6D4B\u8BD5\u4EE4\u724C\u6B63\u5728\u6267\u884C\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u69FD\u4F4D\u7A7A\u95F2\u540E\u518D\u64CD\u4F5C");
    const controller = new AbortController();
    if (!await this.engine.tokenSlots.acquire(identity, controller.signal)) throw new A6Error("slot-busy", "\u69FD\u4F4D\u7E41\u5FD9");
    const key = `${identity}:${input2.model}`;
    try {
      const savedLease = this.manualLeases.get(key);
      let leaseId = savedLease?.leaseId;
      if (input2.operation === "restore" && !leaseId) return { ok: true, result: { skipped: true } };
      if (input2.operation === "pin") {
        if (leaseId) throw new A6Error("already-pinned", "\u8BF7\u5148\u6062\u590D\u672C\u6B21\u624B\u52A8\u56FA\u5B9A\uFF0C\u518D\u9009\u62E9\u5176\u4ED6\u76EE\u6807");
        leaseId = randomUUID4();
        this.manualLeases.set(key, { leaseId, model: input2.model, channelId: input2.channelId });
      }
      const result = await this.bridge.execute(selection, { operation: input2.operation, tokenId: input2.tokenId, model: savedLease?.model ?? input2.model, channelId: input2.operation === "restore" ? savedLease.channelId : input2.channelId, leaseId: leaseId ?? randomUUID4() });
      if (input2.operation === "pin" && !result.verified) throw new A6Error("pin-unverified", "\u56FA\u5B9A\u6E20\u9053\u672A\u786E\u8BA4");
      if (input2.operation === "restore") {
        if (result.conflict) throw new A6Error("restore-conflict", "\u56FA\u5B9A\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u6CA1\u6709\u8986\u76D6");
        this.manualLeases.delete(key);
      }
      return { ok: true, result: { ...result, target: { tokenId: input2.tokenId, model: savedLease?.model ?? input2.model, channelId: input2.operation === "restore" ? savedLease.channelId : input2.channelId } } };
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
  const bridge = new A6Bridge();
  bridge.attachStorage(storage);
  ctx.effect(() => bridge.mount(ctx.webServer), "model-intelligence.a6-bridge");
  let records;
  const engine = new FingerprintEngine(ctx, {
    onTouch: (job) => records?.onTouch(job),
    onSettled: (job) => records?.onSettled(job),
    bridge
  });
  records = new RecordsService(ctx, storage, engine);
  const a6 = new A6Service({ ctx, storage, bridge, records, engine });
  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    bridge.dispose();
    void storage.close();
  }, "model-intelligence.lifecycle");
  new ModelIntelligenceService(ctx, { engine, records, a6, bridge });
  ctx.effect(() => ctx.typert.register(hostContribution), "model-intelligence.remote-contract");
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
