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
var relayRef = z.strictObject({ siteId, channelId: z.number().int().min(1), model: id(256), api: relayApi });
var modelRef = z.strictObject({ provider: id(128), id: id(256) });
var recordModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional(), relay: relayRef.optional() });
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
  partitionSave: z.strictObject({ id: id(64).optional(), name: z.string().min(1).max(40) }),
  partitionDelete: z.strictObject({ partitionId: id(64) }),
  partitionItem: z.strictObject({
    partitionId: id(64).optional(),
    remove: z.boolean().optional(),
    tags: z.array(z.string().max(24)).max(12).optional(),
    api: relayApi.optional(),
    item: z.strictObject({
      key: id(128),
      siteId,
      channelId: z.number().int().min(0),
      model: z.string().max(256),
      brand: z.string().max(64),
      supplier: z.string().max(128),
      channelName: z.string().max(128),
      testEndpoint: z.string().max(16)
    })
  }),
  relayAuthStatus: z.strictObject({ siteId }),
  relayAuthSet: z.strictObject({
    siteId,
    apiKey: z.string().max(512).nullable().optional(),
    accessToken: z.string().max(512).nullable().optional(),
    userId: z.string().max(12).nullable().optional()
  }),
  relayAuthVerify: z.strictObject({ siteId }),
  relayProviderModel: z.strictObject({
    siteId,
    format: relayApi,
    model: id(256),
    name: z.string().max(120).optional(),
    remove: z.boolean().optional(),
    channelId: z.number().int().nonnegative().optional(),
    image: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional()
  }),
  relayProvidersClear: z.strictObject({ siteId }),
  relaySnapshot: z.strictObject({ siteId, force: z.boolean().optional() }),
  relayRows: z.strictObject({
    siteId,
    brands: z.array(z.string().max(128)).max(64).optional(),
    models: z.array(z.string().max(256)).max(256).optional(),
    fidelity: z.enum(["all", "guaranteed", "direct"]).optional(),
    sort: z.enum(["comprehensive", "price_asc", "price_desc", "success_desc", "p50_asc"]).optional(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(2e4)
  }),
  relayRow: z.strictObject({ siteId, rowKey: id() }),
  relayHistory: z.strictObject({ siteId, rowKey: id() }),
  relayConcurrency: z.strictObject({ siteId, rowKey: id() }),
  relaySvg: z.strictObject({ siteId, rowKey: id() }),
  relayResolve: z.strictObject({ siteId, refs: z.array(z.strictObject({ channelId: z.number().int().min(0), model: z.string().max(256) })).max(512) }),
  relayRetryMissing: z.strictObject({ siteId }),
  tagsSet: z.strictObject({ target: z.string().min(1).max(200), tags: z.array(z.string().min(1).max(80)).max(24) })
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
  attemptConfigure: "Change concurrency / request deadline of an attempt (live, non-preemptive) and the record defaults.",
  attemptRetry: "Re-run failed samples of one model inside an attempt.",
  customSave: "Persist the snapshot of a simulated custom attempt.",
  partitionsList: "List channel partitions (favorites is the default partition).",
  partitionSave: "Create or rename a partition.",
  partitionDelete: "Delete a partition and its items.",
  partitionItem: "Add, tag or remove one relay channel in a partition.",
  relayAuthStatus: "Relay credential status (configured / verified), never the values.",
  relayAuthSet: "Store or clear relay credentials in the Host credential store.",
  relayAuthVerify: "Verify the relay system access token against the site.",
  relayProviderModel: "Add or remove a relay model on a plugin-managed pi-ai provider route.",
  relayProvidersClear: "Remove every plugin-managed pi-ai provider route of a site.",
  relayManagedRoutes: "List provider route ids this plugin may manage (for read-only display).",
  relaySites: "List adapted relay sites and their anonymous capabilities.",
  relaySnapshot: "Read the status and facets of a relay channel snapshot, starting a background full fetch when needed.",
  relayRows: "Read one filtered, sorted window of relay channel listings from the Host snapshot.",
  relayRow: "Read one relay channel listing detail.",
  relayHistory: "Fetch the 24h / 7d success series of one channel on demand.",
  relayConcurrency: "Fetch the live concurrency sample of one channel (anonymous).",
  relaySvg: "Fetch the latest SVG self-test of one channel (needs the relay access token).",
  relayResolve: "Look up channel/model pairs in the relay snapshot: price and whether the channel still exists.",
  relayRetryMissing: "Re-fetch only the snapshot pages that failed last time.",
  tagsList: "Read the global tag map (target \u2192 tags) used by favorites, results and filters.",
  tagsSet: "Replace the tags of one target (channel+model or DSH model); an empty list removes the entry."
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

// backend/relay/stream.js
var RELAY_APIS = ["chat", "responses", "messages"];
function request(api, { apiUrl, key, model, prompt }) {
  const base = apiUrl.replace(/\/+$/, "");
  if (api === "messages") {
    return {
      url: `${base}/v1/messages`,
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: 32e3, stream: true, messages: [{ role: "user", content: prompt }] }
    };
  }
  if (api === "responses") {
    return {
      url: `${base}/v1/responses`,
      headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${key}` },
      body: { model, stream: true, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
    };
  }
  return {
    url: `${base}/v1/chat/completions`,
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${key}` },
    body: { model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: prompt }] }
  };
}
async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
      let event = "";
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}
var num = (value) => Number.isFinite(value) && value >= 0 ? value : null;
function* normalise(api, payload, state) {
  if (api === "messages") {
    if (payload.type === "message_start") {
      state.input = num(payload.message?.usage?.input_tokens);
      state.output = num(payload.message?.usage?.output_tokens);
    } else if (payload.type === "content_block_delta") {
      if (payload.delta?.type === "text_delta") yield { type: "text", text: payload.delta.text ?? "" };
      else if (payload.delta?.type === "thinking_delta") yield { type: "reasoning", text: payload.delta.thinking ?? "" };
    } else if (payload.type === "message_delta") {
      if (payload.usage) state.output = num(payload.usage.output_tokens) ?? state.output;
      if (payload.delta?.stop_reason) state.stop = payload.delta.stop_reason === "max_tokens" ? "max-tokens" : payload.delta.stop_reason === "tool_use" ? "tool-calls" : "stop";
    } else if (payload.type === "error") {
      state.error = { message: payload.error?.message ?? "stream error", code: payload.error?.type ?? null };
    }
    return;
  }
  if (api === "responses") {
    if (payload.type === "response.output_text.delta") yield { type: "text", text: payload.delta ?? "" };
    else if (payload.type === "response.reasoning_summary_text.delta" || payload.type === "response.reasoning_text.delta") yield { type: "reasoning", text: payload.delta ?? "" };
    else if (payload.type === "response.completed" || payload.type === "response.incomplete") {
      const usage = payload.response?.usage;
      state.input = num(usage?.input_tokens);
      state.output = num(usage?.output_tokens);
      state.stop = payload.type === "response.incomplete" ? "max-tokens" : "stop";
    } else if (payload.type === "response.failed" || payload.type === "error") {
      state.error = { message: payload.response?.error?.message ?? payload.message ?? "stream error", code: payload.response?.error?.code ?? payload.code ?? null };
    }
    return;
  }
  if (payload.error) {
    state.error = { message: payload.error.message ?? "stream error", code: payload.error.type ?? payload.error.code ?? null };
    return;
  }
  const choice = payload.choices?.[0];
  const delta = choice?.delta;
  if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
  else if (delta?.reasoning) yield { type: "reasoning", text: delta.reasoning };
  if (typeof delta?.content === "string" && delta.content) yield { type: "text", text: delta.content };
  if (choice?.finish_reason) state.stop = choice.finish_reason === "length" ? "max-tokens" : choice.finish_reason === "tool_calls" ? "tool-calls" : "stop";
  if (payload.usage) {
    state.input = num(payload.usage.prompt_tokens);
    state.output = num(payload.usage.completion_tokens);
  }
}
var RelayStreamError = class extends Error {
  constructor(message, facts) {
    super(message);
    this.failure = facts;
  }
};
async function* relayStream({ apiUrl, apiKey, channelId, model, api, prompt, signal }) {
  const key = `${apiKey}-${channelId}`;
  const spec = request(api, { apiUrl, key, model, prompt });
  let response;
  try {
    response = await fetch(spec.url, { method: "POST", headers: spec.headers, body: JSON.stringify(spec.body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RelayStreamError("\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9", { message: error?.message ?? "network error", code: "network", status: null });
  }
  if (!response.ok || !response.body) {
    let text = "";
    try {
      text = (await response.text()).slice(0, 4e3);
    } catch {
    }
    throw new RelayStreamError(`HTTP ${response.status}`, { message: `${response.status} ${text}`.trim(), code: "http", status: response.status, detail: text });
  }
  const state = { input: null, output: null, stop: null, error: null };
  for await (const { data } of sse(response.body)) {
    if (data === "[DONE]") break;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    for (const event of normalise(api, payload, state)) yield event;
    if (state.error) break;
  }
  yield {
    type: "finish",
    kind: state.error ? "error" : state.stop ?? "stop",
    failure: state.error ? { message: state.error.message, code: state.error.code, status: null } : null,
    usage: { inputTokens: state.input, outputTokens: state.output }
  };
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
function requestFailure(failure3) {
  const status = failure3?.status;
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
function redact(text) {
  if (typeof text !== "string" || !text) return null;
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (match) => /^bearer/i.test(match) ? "Bearer [redacted]" : match.length > 12 ? `${match.slice(0, 6)}\u2026[redacted]` : "[redacted]"), text).slice(0, 8e3);
}
function failureDetail(failure3, source) {
  const facts = failure3?.failure ?? failure3;
  const message = redact(typeof facts === "string" ? facts : facts?.message);
  return {
    source,
    message,
    code: typeof facts?.code === "string" ? facts.code : null,
    status: Number.isInteger(facts?.status) ? facts.status : null,
    text: typeof facts === "string" ? null : redact(facts?.detail ?? facts?.message ?? null),
    stack: typeof failure3?.stack === "string" ? redact(failure3.stack) : null
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
   * @param hooks.relayKey(siteId) resolves the relay API key on the Host, or null
   * @param hooks.relayApiUrl(siteId) relay API base URL
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
  async start(models, options2) {
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
    const relayModels = models.filter((m) => m.relay);
    const llm = this.ctx.get("llm");
    if (dshModels.length) {
      if (!llm) throw new FingerprintError("unavailable", "\u5F53\u524D\u8FD0\u884C\u65F6\u6CA1\u6709\u53EF\u7528\u7684 LLM \u670D\u52A1");
      if (typeof llm.prepareCall !== "function") throw new FingerprintError("incompatible-runtime", "\u5F53\u524D DSH \u4E0D\u652F\u6301\u5B98\u65B9 LLM \u8BF7\u6C42\u51C6\u5907\u63A5\u53E3\uFF0C\u8BF7\u5347\u7EA7\u8FD0\u884C\u65F6");
    }
    this.starting += 1;
    try {
      const relayAuth = /* @__PURE__ */ new Map();
      for (const model of relayModels) {
        const r = model.relay;
        if (!r || typeof r.siteId !== "string" || !Number.isSafeInteger(r.channelId) || r.channelId <= 0 || typeof r.model !== "string" || !r.model || !["chat", "responses", "messages"].includes(r.api)) {
          throw new FingerprintError("invalid-models", "\u4E2D\u8F6C\u7AD9\u6E20\u9053\u53C2\u6570\u65E0\u6548");
        }
        if (!relayAuth.has(r.siteId)) {
          const key = await this.hooks.relayKey?.(r.siteId);
          if (!key) throw new FingerprintError("relay-key-missing", "\u672A\u914D\u7F6E\u4E2D\u8F6C\u7AD9 API Key\uFF0C\u8BF7\u5148\u5728\u8BBE\u7F6E\u300CAPI \u9002\u914D\u7AD9\u70B9\u300D\u4E2D\u586B\u5199");
          relayAuth.set(r.siteId, { key, apiUrl: this.hooks.relayApiUrl?.(r.siteId) });
        }
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
        relay: model.relay ? { ...model.relay, ...relayAuth.get(model.relay.siteId) } : null,
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
        concurrency: limits.concurrency,
        timeoutMs: limits.timeoutMs,
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
    if (Number.isFinite(options2?.concurrency) && options2.concurrency !== job.concurrency) {
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
      this.settle(job);
    }
    return this.view(job);
  }
  dispose() {
    this.disposed = true;
    this.hooks = {};
    for (const job of this.jobs.values()) this.cancel(job.id);
    this.jobs.clear();
    this.loaded = void 0;
  }
  prune() {
    const finished = [...this.jobs.values()].filter((job) => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
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
        await this.drain(job);
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
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
    } finally {
      this.release(queued.length);
    }
    if (job.controller.signal.aborted) return;
    this.maybeAnalyze(job, run);
  }
  failJob(job, failure3) {
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
        sample.errorDetail = { ...failureDetail(failure3, "scheduler"), message: sample.error };
      }
      run.stage = "failed";
      run.error = {
        stage: "streaming",
        message: "\u6307\u7EB9\u4EFB\u52A1\u6267\u884C\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u521B\u5EFA\u6D4B\u8BD5",
        detail: failureDetail(failure3, "scheduler")
      };
    }
    job.pending = [];
    job.active.clear();
    job.status = "done";
    job.finishedAt = Date.now();
    this.touch(job);
    this.wakeJob(job);
    this.settle(job);
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
  async sample(job, llm, run, sample) {
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
    let truncated = false, failure3 = null, rawFailure = null, failureSource = "prepare";
    if (run.relay) {
      try {
        ({ truncated, failure: failure3, rawFailure, failureSource } = await this.relaySample(job, run, sample, signal, textLimitController));
      } finally {
        clearTimeout(sample.timer);
        sample.timer = void 0;
        sample.timeout = void 0;
      }
    } else try {
      const prepared = await llm.prepareCall({ provider: run.provider, model: run.model }, signal);
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
          failure3 = finish.kind === "error" ? requestFailure(rawFailure) : "\u4F9B\u5E94\u5546\u4E2D\u65AD\u4E86\u6A21\u578B\u8BF7\u6C42";
        } else if (finish.kind === "tool-calls") failure3 = "\u6A21\u578B\u5C1D\u8BD5\u8C03\u7528\u5DE5\u5177\uFF0C\u56DE\u7B54\u65E0\u6548";
      }
    } catch (error) {
      if (!textLimitController.signal.aborted) {
        failure3 = requestFailure(error?.failure ?? error);
        rawFailure = error;
      }
    } finally {
      clearTimeout(sample.timer);
      sample.timer = void 0;
      sample.timeout = void 0;
    }
    if (job.controller.signal.aborted) return;
    if (!run.relay) {
      const firstTokenAt = assistantStreamFirstTokenTime(events.snapshot());
      sample.firstByteMs = firstTokenAt === void 0 ? null : firstTokenAt - sample.startedAt;
    }
    if (textLimitController.signal.aborted) sample.finish = "text-limit";
    this.finishTiming(sample);
    if (timeoutController.signal.aborted) {
      sample.state = "failed";
      sample.error = `\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(sample.timeoutMs / 1e3)} \u79D2\uFF09`;
      sample.errorDetail = { source: "timeout", message: sample.error, code: "timeout", status: null, text: null, stack: null };
    } else if (failure3) {
      sample.state = "failed";
      sample.error = failure3;
      sample.errorDetail = { ...failureDetail(rawFailure, failureSource), message: failure3 };
    } else {
      sample.state = truncated ? "truncated" : "complete";
      sample.errorDetail = null;
    }
    this.refreshStage(run);
    this.touch(job);
  }
  /** Relay channel sample: same timing/truncation semantics as the DSH path, own wire protocol. */
  async relaySample(job, run, sample, signal, textLimitController) {
    const r = run.relay;
    let truncated = false, failure3 = null, rawFailure = null, failureSource = "stream";
    let text = "";
    try {
      for await (const event of relayStream({ apiUrl: r.apiUrl, apiKey: r.key, channelId: r.channelId, model: r.model, api: r.api, prompt: job.challenges[sample.index].prompt, signal })) {
        if (signal.aborted) break;
        const now = Date.now();
        if (event.type === "text" || event.type === "reasoning") {
          if (!event.text) continue;
          if (!sample.firstAt) {
            sample.firstAt = now;
            sample.firstByteMs = now - sample.startedAt;
          }
          sample.lastAt = now;
          sample.generationMs = now > sample.firstAt ? now - sample.firstAt : null;
          if (event.type === "text") {
            if (sample.firstTextMs === null) sample.firstTextMs = now - sample.startedAt;
            text += event.text;
            sample.text = text.slice(0, MAX_TEXT);
            sample.count = parseNumbers(sample.text).length;
          }
          sample.state = "streaming";
          this.refreshStage(run);
          this.touch(job);
          if (text.length >= MAX_TEXT) {
            truncated = true;
            clearTimeout(sample.timer);
            sample.timer = void 0;
            sample.timeout = void 0;
            textLimitController.abort();
            break;
          }
        } else if (event.type === "finish") {
          sample.inputTokens = tokens(event.usage?.inputTokens);
          sample.outputTokens = tokens(event.usage?.outputTokens);
          sample.finish = event.kind;
          if (event.kind === "max-tokens") truncated = true;
          else if (event.kind === "error") {
            rawFailure = event.failure;
            failure3 = requestFailure(event.failure);
          } else if (event.kind === "tool-calls") failure3 = "\u6A21\u578B\u5C1D\u8BD5\u8C03\u7528\u5DE5\u5177\uFF0C\u56DE\u7B54\u65E0\u6548";
        }
      }
    } catch (error) {
      if (!textLimitController.signal.aborted && !signal.aborted) {
        rawFailure = error?.failure ?? error;
        failure3 = requestFailure(rawFailure);
      }
    }
    if (truncated && textLimitController.signal.aborted) sample.finish = "text-limit";
    return { truncated, failure: failure3, rawFailure, failureSource };
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
      limits: { ...LIMITS },
      reference: { ...job.reference },
      challenges: job.challenges.map((challenge) => ({ ...challenge })),
      runs: job.runs.map((run) => ({
        provider: run.provider,
        model: run.model,
        stage: run.stage,
        error: run.error,
        analysis: run.analysis,
        ...run.relay ? { relay: { siteId: run.relay.siteId, channelId: run.relay.channelId, model: run.relay.model, api: run.relay.api } } : {},
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

// backend/relay/client.js
var USER_AGENT = "dsh-model-intelligence-test/1.0 (+relay source adaptation)";
var DEFAULT_TIMEOUT_MS2 = 3e4;
var RelayError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function failure(status, headers) {
  const error = status === 404 ? new RelayError("relay-not-found", "\u4E2D\u8F6C\u7AD9\u6CA1\u6709\u627E\u5230\u8BF7\u6C42\u7684\u516C\u5F00\u63A5\u53E3\u3002") : status === 429 ? new RelayError("relay-rate-limited", "\u4E2D\u8F6C\u7AD9\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002") : status >= 500 ? new RelayError("relay-unavailable", "\u4E2D\u8F6C\u7AD9\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002") : new RelayError("relay-request-failed", `\u4E2D\u8F6C\u7AD9\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${status}\uFF09\u3002`);
  error.status = status;
  const retryAfter = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter, 120) * 1e3;
  return error;
}
async function getJson(url, { timeoutMs: timeoutMs2 = DEFAULT_TIMEOUT_MS2 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs2),
      redirect: "follow"
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw timedOut ? new RelayError("relay-timeout", `\u4E2D\u8F6C\u7AD9\u54CD\u5E94\u8D85\u65F6\uFF08${Math.round(timeoutMs2 / 1e3)} \u79D2\uFF09\u3002`) : new RelayError("relay-network", "\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
  }
  if (!response.ok) throw failure(response.status, response.headers);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new RelayError("relay-invalid", "\u4E2D\u8F6C\u7AD9\u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON\u3002");
  }
  if (!body || typeof body !== "object") throw new RelayError("relay-invalid", "\u4E2D\u8F6C\u7AD9\u8FD4\u56DE\u7684\u5185\u5BB9\u4E3A\u7A7A\u3002");
  if (body.success === false) {
    const message = typeof body.message === "string" && body.message.length <= 200 ? body.message : "\u4E2D\u8F6C\u7AD9\u62D2\u7EDD\u4E86\u8FD9\u6B21\u516C\u5F00\u67E5\u8BE2\u3002";
    throw new RelayError("relay-rejected", message);
  }
  return body.data ?? body;
}

// backend/relay/site.js
var SORTS = [
  { id: "comprehensive", label: "\u7EFC\u5408\u63A8\u8350" },
  { id: "price_asc", label: "\u4EF7\u683C\u4ECE\u4F4E\u5230\u9AD8" },
  { id: "price_desc", label: "\u4EF7\u683C\u4ECE\u9AD8\u5230\u4F4E" },
  { id: "success_desc", label: "\u6210\u529F\u7387\u4F18\u5148" },
  { id: "p50_asc", label: "\u5EF6\u8FDF\u4F18\u5148" }
];
var SITES = [
  {
    id: "a6api",
    name: "a6api",
    label: "a6api \u4E2D\u8F6C\u7AD9",
    webUrl: "https://a6api.vip",
    apiUrl: "https://api.a6api.vip",
    docsUrl: "https://a6api.vip/docs",
    anonymous: true,
    note: "\u516C\u5F00\u6E20\u9053\u76EE\u5F55\u533F\u540D\u8BFB\u53D6\uFF1BSVG \u68C0\u6D4B\u9700\u8981\u5728\u8BBE\u7F6E\u300CAPI \u9002\u914D\u7AD9\u70B9\u300D\u586B\u5199\u7CFB\u7EDF\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID\uFF1B\u56FA\u5B9A\u5546\u5BB6\u3001\u52A0\u5165\u8DEF\u7531\u6682\u672A\u63D0\u4F9B\u3002",
    endpoints: { channels: "/api/marketplace/public/channels/search", hotModels: "/api/marketplace/hot-models" }
  }
];
function siteOf(id2) {
  return SITES.find((site) => site.id === id2);
}

// backend/relay/snapshot.js
var PAGE_SIZE = 100;
var TTL_MS = 10 * 6e4;
var PAGE_CONCURRENCY = 6;
var PUBLISH_EVERY = 6;
var DEFAULT_EXCHANGE_RATE = 6.7;
function micros(value) {
  return Number.isFinite(value) ? value / 1e6 : null;
}
function rate(value) {
  return Number.isFinite(value) ? value / 100 : null;
}
function compact(item) {
  const official = item.official_price ?? {};
  return {
    rowKey: `${item.listing_id}:${item.channel_id}:${item.supplier_id}`,
    listingId: item.listing_id,
    channelId: item.channel_id,
    supplierId: item.supplier_id,
    supplierName: item.supplier_name || item.supplier_nickname || `\u6E20\u9053 ${item.channel_id}`,
    channelName: item.channel_name ?? "",
    modelName: item.model_name ?? "",
    brand: item.brand ?? "",
    inputPrice: micros(item.input_price_micros),
    outputPrice: micros(item.output_price_micros),
    cacheReadPrice: micros(item.cache_read_price_micros),
    cacheWritePrice: micros(item.cache_write_price_micros),
    officialInputPrice: micros(official.input_price_micros),
    officialOutputPrice: micros(official.output_price_micros),
    successRate: rate(item.recent_success_rate),
    success24h: rate(item.success_rate_24h),
    success7d: rate(item.success_rate_7d),
    success7dState: item.sr_7d_state ?? "",
    ttftMs: Number.isFinite(item.p50_ttft_ms) ? item.p50_ttft_ms : null,
    recentP50Ms: Number.isFinite(item.recent_p50_ms) ? item.recent_p50_ms : null,
    throughput: Number.isFinite(item.throughput_tps) ? item.throughput_tps : null,
    cacheHitRate: rate(item.cache_hit_rate_24h),
    guaranteed: Boolean(item.authenticity_guaranteed),
    labels: Array.isArray(item.smart_routing_labels) ? item.smart_routing_labels : [],
    testEndpoint: item.test_endpoint ?? "",
    modelDetection: Boolean(item.model_detection_supported),
    listingAvailability: item.listing_availability ?? 0,
    lastSuccessAt: item.last_success_at ?? null,
    lastSampleAt: item.last_sample_at ?? null,
    priceDirection: item.price_change_direction ?? "",
    realtimeRatio: Number.isFinite(item.realtime_ratio_usd) ? item.realtime_ratio_usd : null,
    description: typeof item.description === "string" ? item.description.slice(0, 240) : "",
    guaranteeBadge: item.authenticity_guarantee_badge_key ?? "",
    officialDirect: Boolean(item.official_direct ?? item.is_official_direct),
    success24hState: item.sr_24h_state ?? "",
    sampleCount: Number.isFinite(item.sample_count) ? item.sample_count : null,
    buckets: Array.isArray(item.success_buckets) ? item.success_buckets.slice(0, 12).map((bucket) => rate(bucket?.success_rate)) : [],
    lastFailureAt: item.last_failure_at ?? null,
    lastFailureCode: item.last_failure_code ?? "",
    routeStatus: item.route_status ?? "",
    chargeType: item.charge_type ?? "",
    perRequestPrice: micros(item.per_request_price_micros)
  };
}
function bucketsOf(list) {
  return Array.isArray(list) ? list.map((bucket) => ({
    at: Number.isFinite(bucket?.t) ? bucket.t * 1e3 : null,
    requests: Number.isFinite(bucket?.s) ? bucket.s : 0,
    rate: rate(bucket?.r),
    latencyMs: Number.isFinite(bucket?.d) ? bucket.d : null,
    firstMs: Number.isFinite(bucket?.f) ? bucket.f : null,
    cacheRate: rate(bucket?.c)
  })) : [];
}
function sortRows(rows, sort) {
  const copy = rows.slice();
  const byNumber = (key, fallback) => (a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return fallback(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right || fallback(a, b);
  };
  const byNumberDesc = (key, fallback) => (a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return fallback(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || fallback(a, b);
  };
  const tie = (a, b) => b.successRate - a.successRate || a.supplierName.localeCompare(b.supplierName, "zh-CN");
  switch (sort) {
    case "price_asc":
      return copy.sort(byNumber("inputPrice", tie));
    case "price_desc":
      return copy.sort(byNumberDesc("inputPrice", tie));
    case "success_desc":
      return copy.sort((a, b) => (b.successRate ?? -1) - (a.successRate ?? -1) || tie(a, b));
    case "p50_asc":
      return copy.sort(byNumber("ttftMs", tie));
    default:
      return copy.sort(tie);
  }
}
var RelaySnapshot = class {
  constructor(site) {
    this.site = site;
    this.rows = [];
    this.total = 0;
    this.brands = [];
    this.models = [];
    this.fetchedAt = 0;
    this.state = "idle";
    this.progress = 0;
    this.pages = 0;
    this.error = null;
    this.promise = null;
    this.partial = false;
    this.missingPages = 0;
    this.missing = [];
    this.map = /* @__PURE__ */ new Map();
    this.exchangeRate = DEFAULT_EXCHANGE_RATE;
  }
  stale() {
    return this.state === "ready" && Date.now() - this.fetchedAt > TTL_MS;
  }
  status() {
    return { state: this.state, progress: this.progress, pages: this.pages, total: this.total, fetchedAt: this.fetchedAt || null, stale: this.stale(), partial: this.partial, missingPages: this.missingPages, missing: this.missing.slice(0, 40), exchangeRate: this.exchangeRate, error: this.error };
  }
  facets() {
    return { brands: this.brands, models: this.models };
  }
  ensure(force = false) {
    if (this.promise) return this.promise;
    if (this.state === "ready" && !force && !this.stale()) return Promise.resolve(this);
    this.promise = this.load(force).finally(() => {
      this.promise = null;
    });
    return this.promise;
  }
  /** Fetch pages [numbers]; resolves with the pages that failed (never retried silently). */
  async crawl(numbers, url, publish) {
    const failed = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < numbers.length) {
        const number = numbers[cursor++];
        try {
          const data = await getJson(url(number));
          for (const item of Array.isArray(data.items) ? data.items : []) {
            const row = compact(item);
            this.map.set(row.rowKey, row);
            const rate2 = Number(item.realtime_ratio_exchange_rate);
            if (Number.isFinite(rate2) && rate2 > 0) this.exchangeRate = rate2;
          }
        } catch (error) {
          failed.push({ page: number, status: error?.status ?? 0, code: error?.code ?? "relay-error", message: error instanceof RelayError ? error.message : "\u4E2D\u8F6C\u7AD9\u8BF7\u6C42\u5931\u8D25" });
        }
        this.progress += 1;
        publish();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, numbers.length) }, worker));
    return failed;
  }
  async load(force, onlyMissing = false) {
    const onLoaded = this.onLoaded;
    this.state = "building";
    this.error = null;
    try {
      const url = (number) => `${this.site.webUrl}/api/marketplace/public/channels/search?page=${number}&page_size=${PAGE_SIZE}`;
      let pending;
      if (onlyMissing && this.missing.length) {
        pending = this.missing.map((item) => item.page);
        this.progress = this.pages - pending.length;
      } else {
        this.map = /* @__PURE__ */ new Map();
        this.missing = [];
        this.progress = 0;
        const hot = await getJson(`${this.site.webUrl}/api/marketplace/hot-models`).catch(() => null);
        if (hot) {
          const items = Array.isArray(hot.items) ? hot.items : [];
          const brandMap = /* @__PURE__ */ new Map();
          for (const item of items) {
            const brand = item.brand || "\u5176\u4ED6";
            const entry = brandMap.get(brand) ?? { id: brand, name: brand, count: 0 };
            entry.count += 1;
            brandMap.set(brand, entry);
          }
          this.brands = [...brandMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
          this.models = items.map((item) => ({ brand: item.brand || "\u5176\u4ED6", name: item.model_name, count: item.listing_count ?? 0 })).filter((item) => item.name);
        }
        const first = await getJson(url(1));
        this.total = Number(first.total) || 0;
        this.pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        for (const item of Array.isArray(first.items) ? first.items : []) {
          const row = compact(item);
          this.map.set(row.rowKey, row);
          const rate2 = Number(item.realtime_ratio_exchange_rate);
          if (Number.isFinite(rate2) && rate2 > 0) this.exchangeRate = rate2;
        }
        this.progress = 1;
        pending = Array.from({ length: this.pages - 1 }, (_, index) => index + 2);
      }
      let published = 0;
      const publish = () => {
        if (++published % PUBLISH_EVERY === 0) this.rows = [...this.map.values()];
      };
      this.missing = await this.crawl(pending, url, publish);
      this.rows = [...this.map.values()];
      this.total = this.rows.length;
      this.partial = this.missing.length > 0;
      this.missingPages = this.missing.length;
      this.fetchedAt = Date.now();
      this.state = "ready";
      this.progress = this.pages;
      this.error = this.partial ? this.describeMissing() : null;
      try {
        await onLoaded?.(this);
      } catch {
      }
      return this;
    } catch (error) {
      this.rows = [...this.map?.values() ?? []];
      this.state = this.rows.length ? "ready" : "error";
      this.error = error instanceof RelayError ? error.message : "\u4E2D\u8F6C\u7AD9\u5FEB\u7167\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
      this.partial = this.rows.length > 0;
      if (error?.status) this.error = `${this.error}\uFF08HTTP ${error.status}\uFF09`;
      return this;
    }
  }
  /** "12 页被限流（HTTP 429）…" — raw cause, no softening. */
  describeMissing() {
    const byStatus = /* @__PURE__ */ new Map();
    for (const item of this.missing) byStatus.set(item.status || item.code, (byStatus.get(item.status || item.code) ?? 0) + 1);
    const parts = [...byStatus.entries()].map(([key, count]) => `${count} \u9875 ${typeof key === "number" ? `HTTP ${key}` : key}`);
    return `${this.missing.length}/${this.pages} \u9875\u8BFB\u53D6\u5931\u8D25\uFF1A${parts.join("\u3001")}\u3002\u5DF2\u5C55\u793A\u5176\u4F59 ${this.rows.length} \u6761\u6E20\u9053\uFF0C\u53EF\u70B9\u51FB\u300C\u8865\u6293\u5931\u8D25\u9875\u300D\u3002`;
  }
  /** Re-fetch only the pages that failed last time. */
  retryMissing() {
    if (this.promise || !this.missing.length) return this.promise ?? Promise.resolve(this);
    this.promise = this.load(false, true).finally(() => {
      this.promise = null;
    });
    return this.promise;
  }
  /** Look up channel/model pairs: price + presence. `found:null` when the snapshot cannot answer yet. */
  resolve(refs) {
    const ready = this.rows.length > 0 && (this.state === "ready" || this.progress >= this.pages);
    const index = new Map(this.rows.map((row) => [`${row.channelId}|${row.modelName}`, row]));
    return refs.map((ref) => {
      const row = index.get(`${ref.channelId}|${ref.model}`);
      return {
        channelId: ref.channelId,
        model: ref.model,
        found: row ? true : ready && !this.partial ? false : null,
        rowKey: row?.rowKey ?? null,
        inputPrice: row?.inputPrice ?? null,
        outputPrice: row?.outputPrice ?? null,
        perRequestPrice: row?.perRequestPrice ?? null,
        chargeType: row?.chargeType ?? ""
      };
    });
  }
  query({ brand, model, brands, models, fidelity = "all", sort, offset = 0, limit = 200 }) {
    const brandSet = /* @__PURE__ */ new Set([...Array.isArray(brands) ? brands : [], ...brand ? [brand] : []]);
    const modelSet = /* @__PURE__ */ new Set([...Array.isArray(models) ? models : [], ...model ? [model] : []]);
    const filtered = this.rows.filter((row) => (!brandSet.size || brandSet.has(row.brand)) && (!modelSet.size || modelSet.has(row.modelName)) && (fidelity === "guaranteed" ? row.guaranteed : fidelity === "direct" ? row.officialDirect : true));
    const sorted = sortRows(filtered, sort);
    const start = Math.max(0, Math.min(offset, sorted.length));
    const end = Math.min(start + Math.max(1, Math.min(limit, 2e4)), sorted.length);
    return { rows: sorted.slice(start, end), total: sorted.length, offset: start };
  }
  detail(rowKey) {
    return this.rows.find((row) => row.rowKey === rowKey) ?? null;
  }
  /** Restore a persisted snapshot so the page opens instantly after a restart (then refresh if stale). */
  restore(cached) {
    if (!cached || !Array.isArray(cached.rows) || !cached.rows.length || this.rows.length) return;
    this.rows = cached.rows;
    this.map = new Map(cached.rows.map((row) => [row.rowKey, row]));
    this.missing = Array.isArray(cached.missing) ? cached.missing : [];
    this.missingPages = this.missing.length;
    this.partial = this.missing.length > 0;
    if (Number(cached.exchangeRate) > 0) this.exchangeRate = Number(cached.exchangeRate);
    this.brands = Array.isArray(cached.brands) ? cached.brands : [];
    this.models = Array.isArray(cached.models) ? cached.models : [];
    this.total = this.rows.length;
    this.fetchedAt = Number(cached.fetchedAt) || 0;
    this.pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
    this.progress = this.pages;
    this.state = "ready";
  }
  serialize() {
    return { siteId: this.site.id, fetchedAt: this.fetchedAt, rows: this.rows, brands: this.brands, models: this.models, missing: this.missing, exchangeRate: this.exchangeRate };
  }
  /** On-demand 24h / 7d series: small pages return the bucket arrays the bulk pages omit. */
  async history(rowKey) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError("relay-not-found", "\u6E20\u9053\u4E0D\u5728\u5F53\u524D\u5FEB\u7167\u4E2D\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    const query = new URLSearchParams({ page: "1", page_size: "20", channel_id: String(row.channelId), model: row.modelName });
    const data = await getJson(`${this.site.webUrl}/api/marketplace/public/channels/search?${query}`);
    const items = Array.isArray(data.items) ? data.items : [];
    const item = items.find((entry) => entry.listing_id === row.listingId) ?? items.find((entry) => entry.channel_id === row.channelId) ?? null;
    if (!item) throw new RelayError("relay-not-found", "\u4E2D\u8F6C\u7AD9\u6CA1\u6709\u8FD4\u56DE\u8BE5\u6E20\u9053\u7684\u5386\u53F2\u6570\u636E\u3002");
    return {
      rowKey,
      success24h: rate(item.success_rate_24h),
      success7d: rate(item.success_rate_7d),
      state24h: item.sr_24h_state ?? "",
      state7d: item.sr_7d_state ?? "",
      hours: bucketsOf(item.b24),
      days: bucketsOf(item.b7d),
      lastSuccessAt: item.last_success_at ?? null,
      lastFailureAt: item.last_failure_at ?? null,
      lastFailureCode: item.last_failure_code ?? "",
      recent: Array.isArray(item.success_buckets) ? item.success_buckets.map((bucket) => ({ samples: bucket?.sample_count ?? 0, success: bucket?.success_count ?? 0, rate: rate(bucket?.success_rate) })) : [],
      fetchedAt: Date.now()
    };
  }
  /** Anonymous live concurrency sample for one channel listing. */
  async concurrency(rowKey) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError("relay-not-found", "\u6E20\u9053\u4E0D\u5728\u5F53\u524D\u5FEB\u7167\u4E2D\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    let response;
    try {
      response = await fetch(`${this.site.webUrl}/api/marketplace/public/channel-concurrency/query`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ listing_ids: [row.listingId] }),
        signal: AbortSignal.timeout(15e3)
      });
    } catch {
      throw new RelayError("relay-network", "\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
    }
    if (!response.ok) throw new RelayError("relay-unavailable", `\u5E76\u53D1\u67E5\u8BE2\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    const body = await response.json().catch(() => null);
    const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.items) ? body.data.items : [];
    const item = list.find((entry) => entry?.listing_id === row.listingId || entry?.channel_id === row.channelId) ?? list[0] ?? null;
    if (!item) return { rowKey, active: null, limit: null, limitState: "", quality: "", sampledAt: Date.now() };
    return {
      rowKey,
      active: Number.isFinite(item.active) ? item.active : null,
      limit: Number.isFinite(item.limit?.value) ? item.limit.value : null,
      limitState: item.limit?.state ?? "",
      quality: typeof item.quality === "string" ? item.quality : "",
      sampledAt: Number(item.sampled_at_ms) || Date.now()
    };
  }
  /** Latest SVG self-test (login-only). Returns the SVG markup; the client renders it in a sandboxed image. */
  async svg(rowKey, headers) {
    const row = this.detail(rowKey);
    if (!row) throw new RelayError("relay-not-found", "\u6E20\u9053\u4E0D\u5728\u5F53\u524D\u5FEB\u7167\u4E2D\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    if (!headers) throw new RelayError("auth-missing", "SVG \u68C0\u6D4B\u9700\u8981\u767B\u5F55\u6001\uFF1A\u8BF7\u5148\u5728\u8BBE\u7F6E\u300CAPI \u9002\u914D\u7AD9\u70B9\u300D\u586B\u5199\u7CFB\u7EDF\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID");
    const query = new URLSearchParams({ channel_id: String(row.channelId), model: row.modelName });
    let response;
    try {
      response = await fetch(`${this.site.webUrl}/api/marketplace/self-tests/pelican/latest?${query}`, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(2e4) });
    } catch {
      throw new RelayError("relay-network", "\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
    }
    if (response.status === 401 || response.status === 403) throw new RelayError("auth-invalid", "\u767B\u5F55\u6001\u65E0\u6548\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u586B\u5199\u7CFB\u7EDF\u8BBF\u95EE\u4EE4\u724C");
    if (!response.ok) throw new RelayError("relay-unavailable", `SVG \u68C0\u6D4B\u8BFB\u53D6\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    const body = await response.json().catch(() => null);
    const data = body?.data ?? body;
    const item = data?.item;
    if (!item?.svg_base64) return { rowKey, svg: null, createdAt: null };
    let svg = "";
    try {
      svg = Buffer.from(String(item.svg_base64), "base64").toString("utf8").slice(0, 4e5);
    } catch {
      svg = "";
    }
    return { rowKey, svg: svg || null, createdAt: item.created_at ?? item.updated_at ?? null };
  }
};
var snapshots = /* @__PURE__ */ new Map();
function snapshotOf(siteId2) {
  const site = siteOf(siteId2);
  if (!site) throw new RelayError("relay-unknown-site", "\u6CA1\u6709\u627E\u5230\u8BE5\u4E2D\u8F6C\u7AD9\u7AD9\u70B9\u3002");
  let snapshot = snapshots.get(site.id);
  if (!snapshot) {
    snapshot = new RelaySnapshot(site);
    snapshots.set(site.id, snapshot);
  }
  return snapshot;
}
function disposeSnapshots() {
  snapshots.clear();
}

// backend/relay/providers.js
import { createHash } from "node:crypto";

// backend/relay/auth.js
var FIELDS = ["apiKey", "accessToken", "userId"];
var SUFFIX = { apiKey: "API_KEY", accessToken: "ACCESS_TOKEN", userId: "USER_ID" };
function credentialName(siteId2, field) {
  return `MIT_${siteId2.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${SUFFIX[field]}`;
}
var RelayAuth = class {
  constructor(ctx, storage) {
    this.ctx = ctx;
    this.storage = storage;
    this.verified = /* @__PURE__ */ new Map();
  }
  /** Plugin-owned credential records; see `managedDomain` for why the credential store is not enough. */
  async vault() {
    const domain = await this.storage.managed();
    if (!domain) throw new RelayError("storage-unavailable", "\u51ED\u636E\u5B58\u50A8\u4E0D\u53EF\u7528");
    return domain.table("auth");
  }
  site(siteId2) {
    const site = siteOf(siteId2);
    if (!site) throw new RelayError("relay-unknown-site", "\u672A\u9002\u914D\u7684\u4E2D\u8F6C\u7AD9");
    return site;
  }
  credentials() {
    const service = this.ctx.get("credentials");
    if (!service) throw new RelayError("credentials-unavailable", "\u5F53\u524D\u8FD0\u884C\u65F6\u6CA1\u6709\u51ED\u636E\u670D\u52A1");
    return service;
  }
  async resolve(siteId2, field) {
    this.site(siteId2);
    const stored = await (await this.vault()).get(siteId2);
    const value = stored?.[field];
    if (typeof value === "string" && value) return value;
    const service = this.ctx.get("credentials");
    if (!service) return null;
    const hit = await service.resolve(credentialName(siteId2, field));
    return typeof hit?.value === "string" && hit.value ? hit.value : null;
  }
  async status(siteId2) {
    const site = this.site(siteId2);
    const service = this.ctx.get("credentials");
    const stored = await (await this.vault()).get(siteId2);
    const entries = await Promise.all(FIELDS.map(async (field) => {
      const local = typeof stored?.[field] === "string" && stored[field];
      if (local) return [field, { configured: true, source: "plugin", writable: true }];
      const info = service ? await service.describe(credentialName(siteId2, field)) : null;
      return [field, { configured: Boolean(info?.configured), source: info?.source ?? null, writable: info?.writable !== false }];
    }));
    const result = Object.fromEntries(entries);
    const userId = result.userId.configured ? await this.resolve(siteId2, "userId") : null;
    return {
      siteId: site.id,
      apiKey: result.apiKey,
      accessToken: result.accessToken,
      userId: userId ? { configured: true, value: userId } : { configured: false, value: null },
      apiKeyRef: credentialName(siteId2, "apiKey"),
      verified: this.verified.get(siteId2) ?? null
    };
  }
  async set(siteId2, patch) {
    this.site(siteId2);
    const table = await this.vault();
    const current = await table.get(siteId2) ?? { siteId: siteId2 };
    const next = { ...current, siteId: siteId2 };
    const service = this.ctx.get("credentials");
    for (const field of FIELDS) {
      const value = patch?.[field];
      if (value === void 0) continue;
      const name2 = credentialName(siteId2, field);
      if (value === null || value === "") {
        delete next[field];
        try {
          await service?.unset(name2);
        } catch {
        }
        continue;
      }
      const text = String(value).trim();
      if (field === "userId" && !/^\d{1,12}$/.test(text)) throw new RelayError("invalid-user-id", "\u7528\u6237 ID \u5FC5\u987B\u662F\u6570\u5B57");
      if (text.length > 512) throw new RelayError("invalid-credential", "\u51ED\u636E\u8FC7\u957F");
      next[field] = text;
      try {
        await service?.set(name2, text);
      } catch {
      }
      if (field !== "apiKey") this.verified.delete(siteId2);
    }
    await table.put(siteId2, next);
    return this.status(siteId2);
  }
  /** Headers for dashboard (login-only) endpoints, or null when the token is not configured. */
  async dashboardHeaders(siteId2) {
    const [token, userId] = await Promise.all([this.resolve(siteId2, "accessToken"), this.resolve(siteId2, "userId")]);
    if (!token || !userId) return null;
    return { authorization: token, "new-api-user": userId };
  }
  async verify(siteId2) {
    const site = this.site(siteId2);
    const headers = await this.dashboardHeaders(siteId2);
    if (!headers) throw new RelayError("auth-missing", "\u8BF7\u5148\u586B\u5199\u7CFB\u7EDF\u8BBF\u95EE\u4EE4\u724C\u4E0E\u7528\u6237 ID");
    let response;
    try {
      response = await fetch(`${site.webUrl}/api/user/self`, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(2e4) });
    } catch {
      throw new RelayError("relay-network", "\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
    }
    if (response.status === 401 || response.status === 403 || body?.success === false) {
      this.verified.delete(siteId2);
      throw new RelayError("auth-invalid", "\u7CFB\u7EDF\u8BBF\u95EE\u4EE4\u724C\u6216\u7528\u6237 ID \u65E0\u6548\uFF0C\u8BF7\u5728 a6api \u4E2A\u4EBA\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u751F\u6210");
    }
    if (!response.ok) throw new RelayError("relay-unavailable", `\u4E2D\u8F6C\u7AD9\u6821\u9A8C\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    const user = body?.data ?? body;
    const verified = { username: typeof user?.username === "string" ? user.username.slice(0, 64) : null, displayName: typeof user?.display_name === "string" ? user.display_name.slice(0, 64) : null, at: Date.now() };
    this.verified.set(siteId2, verified);
    return this.status(siteId2);
  }
};

// backend/relay/traits.js
var IMAGE_UNSUPPORTED = [/deepseek-(v3|v4|r1|chat|reasoner)/i, /llama-?3(?!.*vision)/i, /qwen(?!.*(?:vl|omni))/i, /glm-(4|3)(?!.*v)/i, /kimi-k2(?!.*vision)/i];
var IMAGE_SUPPORTED = [/vision/i, /-vl\b/i, /vl-/i, /omni/i, /4o\b/i, /gemini/i, /claude-(3|4|5|sonnet|opus|haiku)/i, /gpt-(4\.1|5|6|4o)/i, /o[34]-.*(?:vision)?/i, /pixtral/i, /llava/i, /gemma-?3/i, /glm-4\.?\d*v/i, /qwen[\w.-]*-(vl|omni)/i, /step-1v/i, /internvl/i, /minicpm-v/i];
var REASONING_FAMILIES = [/thinking/i, /reasoning/i, /^o[134](?:-|$)/i, /gpt-(5|6)/i, /gpt-4\.1.*(?:think)/i, /deepseek-(v4|r1|reasoner)/i, /r1(?:-|$)/i, /qwq/i, /glm-[\d.]*(?:air|think|z1)/i, /claude-.*(?:sonnet|opus|thinking)/i, /grok-[3-9]/i, /kimi-k2.*(?:think)/i, /qwen3/i];
var REASONING_EFFORTS = [
  { id: "off", name: "\u5173\u95ED" },
  { id: "low", name: "\u4F4E" },
  { id: "medium", name: "\u4E2D" },
  { id: "high", name: "\u9AD8" }
];
var THINKING_BUDGET = { low: 1024, medium: 4096, high: 8192 };
function matches(table, id2) {
  return table.some((pattern) => pattern.test(id2));
}
function inferImage(model) {
  const id2 = String(model ?? "");
  if (!id2) return false;
  if (matches(IMAGE_UNSUPPORTED, id2)) return false;
  return matches(IMAGE_SUPPORTED, id2);
}
function inferReasoning(model) {
  const id2 = String(model ?? "");
  return Boolean(id2) && matches(REASONING_FAMILIES, id2);
}
function reasoningInfo(model, enabled) {
  const on = enabled === void 0 ? inferReasoning(model) : Boolean(enabled);
  if (!on) return void 0;
  return { efforts: REASONING_EFFORTS, defaultEffort: "medium" };
}
function thinkingParams(api, effort) {
  if (!effort || effort === "off") return {};
  const budget = THINKING_BUDGET[effort];
  if (!budget) return {};
  if (api === "messages") return { thinking: { type: "enabled", budget_tokens: budget } };
  if (api === "responses") return { reasoning: { effort } };
  return { reasoning_effort: effort };
}

// backend/relay/providers.js
var PI_NS = "llm-pi-ai";
var FORMATS = {
  chat: { api: "openai-completions", path: "", label: "Chat Completions" },
  responses: { api: "openai-responses", path: "/v1", label: "Responses" },
  messages: { api: "anthropic-messages", path: "", label: "Anthropic Messages" }
};
function hash4(siteId2, format) {
  return createHash("sha1").update(`model-intelligence-test:${siteId2}:${format}`).digest("hex").slice(0, 4);
}
function routeId(siteId2, format) {
  return `${siteId2}-${format}-${hash4(siteId2, format)}`;
}
function managedRoutes(siteId2) {
  return Object.keys(FORMATS).map((format) => ({ format, id: routeId(siteId2, format), ...FORMATS[format] }));
}
function allManagedRouteIds(siteIds) {
  return siteIds.flatMap((siteId2) => managedRoutes(siteId2).map((route) => route.id));
}
function isReadOnlyConfig(error) {
  const message = String(error && error.message ? error.message : error);
  return /overridden by a home patch|command-line overlay|settings-rejected|read-only/i.test(message);
}
var ManagedProviders = class {
  constructor(ctx, storage) {
    this.ctx = ctx;
    this.storage = storage;
    this.onChange = void 0;
  }
  /** Called after every registry write so the adapter can re-register its route set. */
  changed() {
    try {
      this.onChange?.();
    } catch {
    }
  }
  /**
   * The routes this plugin's own LLM adapter owns: registry rows only.
   *
   * Config rows (`source: 'config'`) belong to pi-ai and must never be claimed here — registering a
   * route that already has an adapter throws DUPLICATE_ADAPTER and would take the whole plugin down.
   */
  async adapterRoutes() {
    const table = await this.table();
    const routes = /* @__PURE__ */ new Map();
    for (const [, value] of table.entries()) {
      if (!value || !Array.isArray(value.models) || !value.models.length) continue;
      const site = siteOf(value.siteId);
      const spec = FORMATS[value.format];
      if (!site || !spec) continue;
      const id2 = routeId(value.siteId, value.format);
      routes.set(id2, {
        id: id2,
        siteId: value.siteId,
        format: value.format,
        apiUrl: site.apiUrl,
        label: `${site.name} \xB7 ${spec.label}\uFF08\u6A21\u578B\u667A\u80FD\u6D4B\u8BD5\uFF09`,
        models: value.models.map((model) => ({
          id: String(model.id),
          name: model.name ? String(model.name) : null,
          channelId: model.channelId === void 0 || model.channelId === null ? void 0 : Number(model.channelId),
          image: model.image,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow
        }))
      });
    }
    return routes;
  }
  settings() {
    const service = this.ctx.get("settings");
    if (!service || typeof service.mutate !== "function") throw new RelayError("settings-unavailable", "\u5F53\u524D\u8FD0\u884C\u65F6\u6CA1\u6709\u8BBE\u7F6E\u670D\u52A1\uFF0C\u65E0\u6CD5\u5199\u5165\u63D0\u4F9B\u5546");
    return service;
  }
  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new RelayError("storage-unavailable", "\u63D0\u4F9B\u5546\u6CE8\u518C\u8868\u4E0D\u53EF\u7528");
    return domain.table("routes");
  }
  /** Registry rows: what the user asked to publish, independent of whether the write landed. */
  async registry(siteId2) {
    const table = await this.table();
    const rows = /* @__PURE__ */ new Map();
    for (const entry of table.entries()) {
      const value = entry[1];
      if (!value || value.siteId !== siteId2) continue;
      rows.set(String(value.format), Array.isArray(value.models) ? value.models : []);
    }
    return rows;
  }
  async writeRegistry(siteId2, format, models) {
    const table = await this.table();
    const key = `${siteId2}-${format}`;
    if (!models.length) {
      await table.delete(key);
      return;
    }
    await table.put(key, { id: key, siteId: siteId2, format, models });
  }
  /** Current models per managed route: the config wins when present, the registry fills the gap. */
  current(siteId2) {
    const routes = managedRoutes(siteId2);
    let providers = {};
    try {
      const descriptors = this.settings().describe({ redactSecrets: true });
      const entry = Array.isArray(descriptors) ? descriptors.find((item) => String(item?.ns) === PI_NS) : null;
      providers = entry?.value?.providers ?? {};
    } catch {
      providers = {};
    }
    return routes.map((route) => {
      const config = providers[route.id];
      const models = Array.isArray(config?.models) ? config.models.map((model) => ({ id: String(model.id), name: model.name ? String(model.name) : null })) : [];
      return { id: route.id, format: route.format, api: route.api, label: route.label, present: Boolean(config), models, source: config ? "config" : "registry" };
    });
  }
  /** Registry-filled view, used when the runtime refuses config writes. */
  async currentWithRegistry(siteId2) {
    const routes = this.current(siteId2);
    const registry = await this.registry(siteId2);
    return routes.map((route) => {
      if (route.models.length || !registry.has(route.format)) return route;
      return { ...route, models: registry.get(route.format).map((model) => ({
        id: String(model.id),
        name: model.name ? String(model.name) : null,
        channelId: model.channelId === void 0 || model.channelId === null ? void 0 : Number(model.channelId),
        image: model.image === void 0 ? void 0 : Boolean(model.image),
        reasoning: model.reasoning === void 0 ? void 0 : Boolean(model.reasoning),
        contextWindow: Number.isInteger(model.contextWindow) ? model.contextWindow : void 0
      })), source: "registry" };
    });
  }
  /** Ready-to-paste provider block for the case where the plugin cannot write the config itself. */
  snippet(siteId2, routes) {
    const site = siteOf(siteId2);
    if (!site) return "";
    const lines = ["- id: llm-pi-ai", "  config:", "    providers:"];
    for (const route of routes) {
      if (!route.models.length) continue;
      lines.push(`      ${route.id}:`);
      lines.push(`        displayName: ${JSON.stringify(`${site.name} \xB7 ${route.label}\uFF08\u6A21\u578B\u667A\u80FD\u6D4B\u8BD5\uFF09`)}`);
      lines.push(`        api: ${route.api}`);
      lines.push(`        baseURL: ${JSON.stringify(`${site.apiUrl}${FORMATS[route.format]?.path ?? ""}`)}`);
      lines.push(`        apiKeyEnv: ${credentialName(siteId2, "apiKey")}`);
      lines.push("        models:");
      for (const model of route.models) lines.push(`          - id: ${model.id}${model.name ? `
            name: ${model.name}` : ""}`);
    }
    return lines.join("\n");
  }
  /**
   * Add (or remove) one model on the route of the given format. Writes the runtime config when the
   * runtime allows it, and always records the intent in the registry so the UI can show the model
   * and hand back a config snippet when the write is refused.
   */
  async setModel(siteId2, { format, model, name: name2, remove = false, channelId, image, reasoning, contextWindow }) {
    const site = siteOf(siteId2);
    if (!site) throw new RelayError("relay-unknown-site", "\u672A\u9002\u914D\u7684\u4E2D\u8F6C\u7AD9");
    const spec = FORMATS[format];
    if (!spec) throw new RelayError("invalid-format", "API \u683C\u5F0F\u65E0\u6548");
    const id2 = String(model ?? "").trim();
    if (!id2 || id2.length > 256) throw new RelayError("invalid-model", "\u6A21\u578B\u540D\u79F0\u65E0\u6548");
    const route = routeId(siteId2, format);
    const registry = await this.registry(siteId2);
    const channel = channelId === void 0 || channelId === null ? void 0 : Number(channelId);
    const same = (item) => item.id === id2 && (item.channelId === void 0 || item.channelId === null ? void 0 : Number(item.channelId)) === channel;
    const existing = (registry.get(format) ?? []).filter((item) => !same(item));
    const extras = {
      ...name2 ? { name: String(name2).slice(0, 120) } : {},
      ...channel === void 0 ? {} : { channelId: channel },
      image: typeof image === "boolean" ? image : inferImage(id2),
      reasoning: typeof reasoning === "boolean" ? reasoning : inferReasoning(id2),
      ...Number.isInteger(contextWindow) ? { contextWindow } : {}
    };
    const models = remove ? existing : [...existing, { id: id2, ...extras }];
    await this.writeRegistry(siteId2, format, models);
    this.changed();
    let applied = false;
    let reason;
    try {
      const settings = this.settings();
      const configured = models.map((item) => ({ id: item.id, ...item.name ? { name: item.name } : {} }));
      if (!models.length) await settings.mutate(PI_NS, [{ op: "unset", path: ["providers", route] }]);
      else {
        await settings.mutate(PI_NS, [{
          op: "set",
          path: ["providers", route],
          value: {
            displayName: `${site.name} \xB7 ${spec.label}\uFF08\u6A21\u578B\u667A\u80FD\u6D4B\u8BD5\uFF09`,
            api: spec.api,
            baseURL: `${site.apiUrl}${spec.path}`,
            apiKeyEnv: credentialName(siteId2, "apiKey"),
            models: configured
          }
        }]);
      }
      applied = true;
    } catch (error) {
      if (!isReadOnlyConfig(error)) throw error;
      reason = "\u5F53\u524D\u8FD0\u884C\u65F6\u7684\u63D0\u4F9B\u5546\u914D\u7F6E\u7531\u914D\u7F6E\u8865\u4E01\u6216 overlay \u63D0\u4F9B\uFF0C\u63D2\u4EF6\u65E0\u6CD5\u76F4\u63A5\u5199\u5165\uFF1B\u6A21\u578B\u5DF2\u52A0\u5165\u63D2\u4EF6\u81EA\u5E26\u7684\u9002\u914D\u5668\uFF0C\u53EF\u76F4\u63A5\u4F7F\u7528\u3002";
    }
    const providers = await this.currentWithRegistry(siteId2);
    return { providers, applied, reason, snippet: this.snippet(siteId2, providers) };
  }
  /** Feature off / one-click cleanup: drop the registry and every route that is actually in config. */
  async clear(siteId2) {
    const registry = await this.registry(siteId2);
    for (const format of Object.keys(FORMATS)) await this.writeRegistry(siteId2, format, []);
    this.changed();
    const present = this.current(siteId2).filter((item) => item.present);
    let reason;
    if (present.length) {
      try {
        await this.settings().mutate(PI_NS, present.map((route) => ({ op: "unset", path: ["providers", route.id] })));
      } catch (error) {
        if (!isReadOnlyConfig(error)) throw error;
        reason = "\u914D\u7F6E\u7531\u914D\u7F6E\u8865\u4E01\u6216 overlay \u63D0\u4F9B\uFF0C\u63D2\u4EF6\u65E0\u6CD5\u5220\u9664\u5176\u4E2D\u7684\u63D0\u4F9B\u5546\uFF0C\u8BF7\u624B\u52A8\u79FB\u9664\u3002";
      }
    }
    const providers = await this.currentWithRegistry(siteId2);
    return { providers, applied: !present.length, reason, snippet: routesWithModels(providers) ? this.snippet(siteId2, providers) : "", cleared: registry.size };
  }
};
function routesWithModels(routes) {
  return routes.some((route) => route.models.length > 0);
}

// backend/service/catalog.js
function assertOwner(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== "owner" || principalOf(invocation)) {
    throw new RemoteError("model-intelligence/owner-required", "Only the owner may use the model intelligence test.", {});
  }
}
function remoteFailure(error) {
  if (error instanceof FingerprintError || error instanceof RelayError) {
    return new RemoteError(`model-intelligence/${error.code}`, error.message, {});
  }
  if (error instanceof RemoteError) return error;
  return new RemoteError("model-intelligence/internal", "\u670D\u52A1\u6267\u884C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", {});
}
var siteView = (site) => ({ id: site.id, name: site.name, label: site.label, webUrl: site.webUrl, docsUrl: site.docsUrl, anonymous: site.anonymous, note: site.note });
var ModelIntelligenceService = class extends Service {
  constructor(ctx, deps) {
    super(ctx, "modelIntelligence");
    this.engine = deps.engine;
    this.records = deps.records;
    this.auth = deps.auth;
    this.providers = deps.providers;
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
  recordsList(request2) {
    return this.guard(() => this.records.list(request2?.revision));
  }
  recordCreate(request2) {
    return this.guard(() => this.records.create(request2));
  }
  recordRerun(request2) {
    return this.guard(() => this.records.rerun(request2.recordId));
  }
  recordDelete(request2) {
    return this.guard(() => this.records.remove(request2.recordId));
  }
  recordsClear() {
    return this.guard(() => this.records.clear());
  }
  attemptView(request2) {
    return this.guard(() => this.records.attempt(request2.attemptId, request2.revision));
  }
  attemptCancel(request2) {
    return this.guard(() => this.records.cancel(request2.attemptId));
  }
  attemptConfigure(request2) {
    return this.guard(() => this.records.configure(request2.attemptId, { concurrency: request2.concurrency, timeoutMs: request2.timeoutMs }));
  }
  attemptRetry(request2) {
    return this.guard(() => this.records.retry(request2.attemptId, request2.model));
  }
  customSave(request2) {
    return this.guard(() => this.records.saveCustom(request2.recordId, request2.snapshot));
  }
  // ---- partitions ----------------------------------------------------------------------------
  partitionsList() {
    return this.guard(() => this.records.partitions());
  }
  partitionSave(request2) {
    return this.guard(() => this.records.partitionSave(request2));
  }
  partitionDelete(request2) {
    return this.guard(() => this.records.partitionDelete(request2.partitionId));
  }
  partitionItem(request2) {
    return this.guard(() => this.records.partitionItem(request2));
  }
  // ---- relay site auth & managed providers ---------------------------------------------------
  relayAuthStatus(request2) {
    return this.guard(async () => ({ ...await this.auth.status(request2.siteId), providers: await this.providers.currentWithRegistry(request2.siteId), apis: RELAY_APIS }));
  }
  relayAuthSet(request2) {
    return this.guard(async () => ({ ...await this.auth.set(request2.siteId, request2), providers: await this.providers.currentWithRegistry(request2.siteId), apis: RELAY_APIS }));
  }
  relayAuthVerify(request2) {
    return this.guard(async () => ({ ...await this.auth.verify(request2.siteId), providers: await this.providers.currentWithRegistry(request2.siteId), apis: RELAY_APIS }));
  }
  relayProviderModel(request2) {
    return this.guard(async () => {
      if (!request2.remove && !await this.auth.resolve(request2.siteId, "apiKey")) throw new RelayError("relay-key-missing", "\u8BF7\u5148\u586B\u5199 API Key\uFF0C\u518D\u628A\u6A21\u578B\u52A0\u5165\u63D0\u4F9B\u5546");
      return this.providers.setModel(request2.siteId, request2);
    });
  }
  relayProvidersClear(request2) {
    return this.guard(async () => this.providers.clear(request2.siteId));
  }
  relayManagedRoutes() {
    return this.guard(async () => ({ routes: allManagedRouteIds(SITES.map((site) => site.id)) }));
  }
  // ---- relay directory -----------------------------------------------------------------------
  async relaySites() {
    assertOwner(this.ctx.invocation);
    return { sites: SITES.map(siteView), sorts: SORTS };
  }
  relaySnapshot(request2) {
    return this.guard(async () => {
      const site = siteOf(request2?.siteId);
      if (!site) throw new RelayError("relay-unknown-site", "\u6CA1\u6709\u627E\u5230\u8BE5\u4E2D\u8F6C\u7AD9\u7AD9\u70B9\u3002");
      const snapshot = snapshotOf(site.id);
      void snapshot.ensure(Boolean(request2?.force));
      return { site: siteView(site), status: snapshot.status(), ...snapshot.facets(), sorts: SORTS };
    });
  }
  relayRows(request2) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request2.siteId);
      if (snapshot.state !== "ready" && !snapshot.rows.length) {
        void snapshot.ensure(false);
        return { status: snapshot.status(), rows: [], total: 0, offset: 0 };
      }
      if (snapshot.stale()) void snapshot.ensure(false);
      const page = snapshot.query({ brands: request2.brands, models: request2.models, fidelity: request2.fidelity, sort: request2.sort, offset: request2.offset, limit: request2.limit });
      return { status: snapshot.status(), ...page };
    });
  }
  relayRow(request2) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request2.siteId);
      const row = snapshot.detail(request2.rowKey);
      if (!row) throw new RelayError("relay-row-not-found", "\u6CA1\u6709\u627E\u5230\u8FD9\u6761\u6E20\u9053\u8BB0\u5F55\u3002");
      return { row, status: snapshot.status() };
    });
  }
  tagsList() {
    return this.guard(() => this.records.tags());
  }
  tagsSet(request2) {
    return this.guard(() => this.records.tagsSet(request2));
  }
  relayResolve(request2) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request2.siteId);
      void snapshot.ensure(false);
      return { status: snapshot.status(), items: snapshot.resolve(request2.refs) };
    });
  }
  relayRetryMissing(request2) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request2.siteId);
      void snapshot.retryMissing();
      return { status: snapshot.status() };
    });
  }
  relayHistory(request2) {
    return this.guard(() => snapshotOf(request2.siteId).history(request2.rowKey));
  }
  relayConcurrency(request2) {
    return this.guard(() => snapshotOf(request2.siteId).concurrency(request2.rowKey));
  }
  relaySvg(request2) {
    return this.guard(async () => snapshotOf(request2.siteId).svg(request2.rowKey, await this.auth.dashboardHeaders(request2.siteId)));
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
  "partitionsList",
  "partitionSave",
  "partitionDelete",
  "partitionItem",
  "relayAuthStatus",
  "relayAuthSet",
  "relayAuthVerify",
  "relayProviderModel",
  "relayProvidersClear",
  "relayManagedRoutes",
  "relaySites",
  "relaySnapshot",
  "relayRows",
  "relayRow",
  "relayHistory",
  "relayConcurrency",
  "relaySvg",
  "relayResolve",
  "relayRetryMissing",
  "tagsList",
  "tagsSet"
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
    attempts: domainTable(z2.object({ id: z2.string().min(1), recordId: z2.string().min(1) }).passthrough()),
    partitions: domainTable(identified),
    partition_items: domainTable(z2.object({ key: z2.string().min(1), partitionId: z2.string().min(1) }).passthrough())
  }
});
var managedDomain = defineDomain({
  name: "model_intelligence_managed",
  version: 1,
  layout: "per-record",
  tables: {
    routes: domainTable(z2.object({ id: z2.string().min(1) }).passthrough()),
    // Relay credentials (API key, 系统访问令牌, 用户 ID) per site. The Host credential store is
    // regenerated from the launcher overlay on restart, so plugin-written refs would vanish; the
    // registry keeps them and mirrors them into the credential service for provider `apiKeyEnv` use.
    auth: domainTable(z2.object({ siteId: z2.string().min(1) }).passthrough())
  }
});
var relayDomain = defineDomain({
  name: "model_intelligence_relay",
  // v2: rows carry the 24h / 7d success series and the cache-hit rate, which the old
  // 500-row pages dropped. Bumping the version discards the stale cache instead of
  // rendering a table full of dashes until the TTL expires.
  version: 2,
  layout: "per-record",
  invalidRecords: "backup-and-skip",
  tables: {
    snapshots: domainTable(z2.object({ siteId: z2.string().min(1), fetchedAt: z2.number(), rows: z2.array(z2.unknown()) }).passthrough())
  }
});
var PluginStorage = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = (async () => {
      const records = await ctx.storageDomain.open(recordsDomain);
      let relay = null;
      try {
        relay = await ctx.storageDomain.open(relayDomain);
      } catch (error) {
        ctx.logger?.("model-intelligence")?.warn?.("relay cache unavailable", error);
      }
      let managed = null;
      try {
        managed = await ctx.storageDomain.open(managedDomain);
      } catch (error) {
        ctx.logger?.("model-intelligence")?.warn?.("managed provider registry unavailable", error);
      }
      return { records, relay, managed };
    })();
    this.ready.catch(() => {
    });
  }
  async records() {
    return (await this.ready).records;
  }
  async relay() {
    return (await this.ready).relay;
  }
  async managed() {
    return (await this.ready).managed;
  }
  async close() {
    try {
      const { records, relay, managed } = await this.ready;
      await Promise.allSettled([records.close(), relay?.close(), managed?.close()]);
    } catch {
    }
  }
};

// backend/records/service.js
import { randomUUID as randomUUID2, createHash as createHash2 } from "node:crypto";
var PERSIST_THROTTLE_MS = 1500;
var MAX_RECORDS = 500;
var ACTIVE = /* @__PURE__ */ new Set(["queued", "running"]);
var END_SAMPLE = /* @__PURE__ */ new Set(["complete", "truncated", "failed", "cancelled"]);
var END_STAGE = /* @__PURE__ */ new Set(["completed", "failed", "timeout", "cancelled"]);
var clean = (value) => JSON.parse(JSON.stringify(value ?? null));
var short = (text, max) => String(text ?? "").trim().slice(0, max);
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
var RecordsService = class _RecordsService {
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
      ...model.relay ? { relay: clean(model.relay) } : {}
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
      preset: input2.preset ? clean(input2.preset) : null
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
      const view = await this.engine.start(record.models.map((model) => ({ provider: model.provider, id: model.id, ...model.relay ? { relay: model.relay } : {} })), record.options);
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
  // ---- partitions (favorites = default partition) -------------------------------------------
  static DEFAULT_PARTITION = "favorites";
  itemKeyOf(partitionId, key) {
    return `${partitionId}-${createHash2("sha1").update(key).digest("hex").slice(0, 20)}`;
  }
  async partitions() {
    const domain = await this.domain();
    const table = domain.table("partitions");
    if (!table.get(_RecordsService.DEFAULT_PARTITION)) {
      await table.put(_RecordsService.DEFAULT_PARTITION, { id: _RecordsService.DEFAULT_PARTITION, name: "\u6536\u85CF", createdAt: 0, builtin: true });
    }
    const items = [...domain.table("partition_items").entries()].map(([, item]) => item);
    return {
      revision: this.revision,
      partitions: [...table.entries()].map(([, item]) => item).sort((a, b) => a.createdAt - b.createdAt).map((partition) => ({ ...partition, items: items.filter((item) => item.partitionId === partition.id).sort((a, b) => a.addedAt - b.addedAt) }))
    };
  }
  async partitionSave(input2) {
    const domain = await this.domain();
    const table = domain.table("partitions");
    const name2 = short(input2?.name, 40);
    if (!name2) throw new FingerprintError("invalid-partition", "\u5206\u533A\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
    if (input2?.id) {
      const current = table.get(input2.id);
      if (!current) throw new FingerprintError("not-found", "\u5206\u533A\u4E0D\u5B58\u5728");
      await table.put(current.id, { ...current, name: name2 });
    } else {
      const id2 = `p-${randomUUID2().slice(0, 12)}`;
      await table.put(id2, { id: id2, name: name2, createdAt: Date.now(), builtin: false });
    }
    this.bump();
    return this.partitions();
  }
  async partitionDelete(partitionId) {
    if (partitionId === _RecordsService.DEFAULT_PARTITION) throw new FingerprintError("builtin-partition", "\u6536\u85CF\u5206\u533A\u4E0D\u80FD\u5220\u9664");
    const domain = await this.domain();
    const items = [...domain.table("partition_items").entries()].filter(([, item]) => item.partitionId === partitionId).map(([key]) => key);
    await domain.table("partition_items").deleteMany(items);
    await domain.table("partitions").delete(partitionId);
    this.bump();
    return this.partitions();
  }
  /** Add/remove/tag one relay channel in a partition. `item.key` is the relay row key. */
  async partitionItem(input2) {
    const domain = await this.domain();
    const partitionId = short(input2?.partitionId, 64) || _RecordsService.DEFAULT_PARTITION;
    if (partitionId === _RecordsService.DEFAULT_PARTITION) await this.partitions();
    if (!domain.table("partitions").get(partitionId)) throw new FingerprintError("not-found", "\u5206\u533A\u4E0D\u5B58\u5728");
    const item = input2?.item;
    if (!item || typeof item.key !== "string" || !item.key) throw new FingerprintError("invalid-item", "\u6E20\u9053\u53C2\u6570\u65E0\u6548");
    const table = domain.table("partition_items");
    const key = this.itemKeyOf(partitionId, item.key);
    if (input2.remove) await table.delete(key);
    else {
      const current = table.get(key);
      const tags = Array.isArray(input2.tags) ? [...new Set(input2.tags.map((tag) => short(tag, 24)).filter(Boolean))].slice(0, 12) : current?.tags ?? [];
      await table.put(key, {
        ...current ?? { addedAt: Date.now() },
        key: item.key,
        partitionId,
        tags,
        siteId: short(item.siteId, 32),
        channelId: Number(item.channelId) || 0,
        model: short(item.model, 256),
        brand: short(item.brand, 64),
        supplier: short(item.supplier, 128),
        channelName: short(item.channelName, 128),
        testEndpoint: short(item.testEndpoint, 16),
        api: ["chat", "responses", "messages"].includes(input2.api) ? input2.api : current?.api ?? null
      });
    }
    this.bump();
    return this.partitions();
  }
  // ---- tags ----------------------------------------------------------------------------------
  // One map for every taggable thing (relay channel+model or DSH model): target → tag strings. Tags are
  // plain strings with a category prefix (`close:<model>`, `quality:intact|degraded`, `tested`) so any
  // component can filter on them. Stored in the records domain's global document (additive, no version bump).
  async tags() {
    const domain = await this.domain();
    const document = domain.global.get() ?? {};
    return { revision: this.revision, tags: document.tags && typeof document.tags === "object" ? document.tags : {} };
  }
  async tagsSet(input2) {
    const domain = await this.domain();
    const document = { ...domain.global.get() ?? {} };
    const tags = { ...document.tags ?? {} };
    const target = short(input2?.target, 200);
    if (!target) return this.tags();
    const list = [...new Set((Array.isArray(input2.tags) ? input2.tags : []).map((tag) => short(tag, 80)).filter(Boolean))].slice(0, 24);
    if (list.length) tags[target] = list;
    else delete tags[target];
    document.tags = tags;
    await domain.global.set(document);
    this.bump();
    return this.tags();
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
};

// backend/relay/adapter.js
import { attributionHeaders } from "@deepseek-ai/dsh-llm";
var MAX_TOKENS = 32e3;
var DEFAULT_CONTEXT = 128e3;
function* failure2(message, code, status) {
  yield { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } };
  yield {
    type: "finish",
    reason: { kind: "error", failure: { message, code, ...status === void 0 ? {} : { status } } }
  };
}
function* aborted(message) {
  yield { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } };
  yield { type: "finish", reason: { kind: "aborted", failure: { message, code: "ABORTED" } } };
}
var textOf = (content) => content.filter((block) => block.type === "text").map((block) => block.text).join("");
function systemPrompt(options2) {
  const parts = [];
  if (typeof options2.system === "string" && options2.system.trim()) parts.push(options2.system);
  for (const message of options2.messages) {
    if (message.role === "system") {
      const text = textOf(message.content);
      if (text.trim()) parts.push(text);
    }
  }
  return parts.join("\n\n");
}
function conversation(options2) {
  return options2.messages.filter((message) => {
    if (message.role === "system" || message.role === "developer") return false;
    return Boolean(message.content.length);
  });
}
function chatMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) out.push({ role: "user", content: text });
      continue;
    }
    if (message.role === "assistant") {
      const text = textOf(message.content);
      const calls = message.content.filter((block) => block.type === "tool-call");
      out.push({
        role: "assistant",
        content: text || null,
        ...calls.length ? {
          tool_calls: calls.map((call) => ({
            id: String(call.id),
            type: "function",
            function: { name: call.name, arguments: call.arguments || "{}" }
          }))
        } : {}
      });
      continue;
    }
    if (message.role === "tool") {
      out.push({ role: "tool", tool_call_id: String(message.toolCallId), content: textOf(message.content) || "(empty)" });
    }
  }
  return out;
}
function responsesInput(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) out.push({ role: "user", content: [{ type: "input_text", text }] });
      continue;
    }
    if (message.role === "assistant") {
      const text = textOf(message.content);
      if (text) out.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of message.content.filter((block) => block.type === "tool-call")) {
        out.push({ type: "function_call", call_id: String(call.id), name: call.name, arguments: call.arguments || "{}" });
      }
      continue;
    }
    if (message.role === "tool") {
      out.push({ type: "function_call_output", call_id: String(message.toolCallId), output: textOf(message.content) || "(empty)" });
    }
  }
  return out;
}
function parseArguments(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function messagesTurns(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === "user") {
      const blocks = [];
      const text = textOf(message.content);
      if (text) blocks.push({ type: "text", text });
      if (blocks.length) out.push({ role: "user", content: blocks });
      continue;
    }
    if (message.role === "assistant") {
      const blocks = [];
      const text = textOf(message.content);
      if (text) blocks.push({ type: "text", text });
      for (const call of message.content.filter((block) => block.type === "tool-call")) {
        blocks.push({ type: "tool_use", id: String(call.id), name: call.name, input: parseArguments(call.arguments) });
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks });
      continue;
    }
    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: String(message.toolCallId), content: textOf(message.content) || "(empty)" }]
      });
    }
  }
  return mergeTurns(out);
}
function mergeTurns(turns) {
  const out = [];
  for (const turn of turns) {
    const previous = out[out.length - 1];
    if (previous && previous.role === turn.role) previous.content.push(...turn.content);
    else out.push({ role: turn.role, content: [...turn.content] });
  }
  return out;
}
function toolsOf(options2, api) {
  const tools = options2.tools ?? [];
  if (!tools.length) return {};
  if (api === "messages") {
    return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) };
  }
  if (api === "responses") {
    return { tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })) };
  }
  return { tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };
}
function buildRequest(route, options2) {
  const base = route.apiUrl.replace(/\/+$/, "");
  const key = route.channelId === void 0 ? route.key : `${route.key}-${route.channelId}`;
  const common = { "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() };
  const messages = conversation(options2);
  const thinking = thinkingParams(route.format, options2.reasoningEffort);
  const maxTokens = options2.maxTokens ?? MAX_TOKENS;
  const stop = Array.isArray(options2.stop) && options2.stop.length ? { stop: options2.stop } : {};
  if (route.format === "messages") {
    const system2 = systemPrompt(options2);
    return {
      url: `${base}/v1/messages`,
      headers: { ...common, "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: {
        model: route.model,
        max_tokens: maxTokens,
        stream: true,
        ...system2 ? { system: system2 } : {},
        messages: messagesTurns(messages),
        ...toolsOf(options2, "messages"),
        ...thinking,
        ...options2.temperature === void 0 ? {} : { temperature: options2.temperature },
        ...stop
      }
    };
  }
  if (route.format === "responses") {
    const system2 = systemPrompt(options2);
    return {
      url: `${base}/v1/responses`,
      headers: { ...common, authorization: `Bearer ${key}` },
      body: {
        model: route.model,
        stream: true,
        input: responsesInput(messages),
        ...system2 ? { instructions: system2 } : {},
        max_output_tokens: maxTokens,
        ...toolsOf(options2, "responses"),
        ...thinking,
        ...options2.temperature === void 0 ? {} : { temperature: options2.temperature },
        ...stop
      }
    };
  }
  const system = systemPrompt(options2);
  return {
    url: `${base}/v1/chat/completions`,
    headers: { ...common, authorization: `Bearer ${key}` },
    body: {
      model: route.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [...system ? [{ role: "system", content: system }] : [], ...chatMessages(messages)],
      ...options2.maxTokens === void 0 ? {} : { max_tokens: options2.maxTokens },
      ...toolsOf(options2, "chat"),
      ...thinking,
      ...options2.temperature === void 0 ? {} : { temperature: options2.temperature },
      ...stop
    }
  };
}
var Emission = class {
  constructor() {
    this.index = 0;
    this.blocks = /* @__PURE__ */ new Map();
  }
  *open(kind, extras = {}) {
    const index = this.index++;
    const block = { kind, index, text: "", ...extras };
    this.blocks.set(index, block);
    yield { type: "block-start", index, blockType: kind };
  }
  *text(text) {
    if (!text) return;
    let block = this.find("text");
    if (!block) {
      for (const chunk of this.open("text")) yield chunk;
      block = this.find("text");
    }
    block.text += text;
    yield { type: "text-delta", index: block.index, text };
  }
  *reasoning(text) {
    if (!text) return;
    let block = this.find("reasoning");
    if (!block) {
      for (const chunk of this.open("reasoning")) yield chunk;
      block = this.find("reasoning");
    }
    block.text += text;
    yield { type: "reasoning-delta", index: block.index, text };
  }
  /** One tool call identified by its provider-side key (index or id). */
  *tool(key, { id: id2, name: name2 }) {
    let block = this.find("tool-call", key);
    if (!block) {
      for (const chunk of this.open("tool-call", { toolKey: key, id: String(id2 ?? ""), name: String(name2 ?? ""), args: "" })) yield chunk;
      block = this.find("tool-call", key);
    }
    if (id2 && !block.id) block.id = String(id2);
    if (name2 && !block.name) block.name = String(name2);
    return block;
  }
  *arguments(block, delta) {
    if (!delta) return;
    block.args += delta;
    yield { type: "tool-call-delta", index: block.index, id: block.id || `call-${block.index}`, ...block.name ? { name: block.name } : {}, argumentsDelta: delta };
  }
  find(kind, key) {
    for (const block of this.blocks.values()) {
      if (block.kind !== kind) continue;
      if (kind === "tool-call" && block.toolKey !== key) continue;
      if (!block.closed) return block;
      if (kind !== "tool-call") return void 0;
    }
    return void 0;
  }
  *closeAll() {
    for (const block of [...this.blocks.values()]) {
      if (block.closed) continue;
      block.closed = true;
      if (block.kind === "text") yield { type: "block-end", index: block.index, block: { type: "text", text: block.text } };
      else if (block.kind === "reasoning") yield { type: "block-end", index: block.index, block: { type: "reasoning", text: block.text } };
      else yield { type: "block-end", index: block.index, block: { type: "tool-call", id: block.id || `call-${block.index}`, name: block.name, arguments: block.args || "{}" } };
    }
  }
};
var num2 = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
function usageOf({ input: input2, output, cacheRead, cacheWrite, total }) {
  return {
    inputTokens: num2(input2),
    outputTokens: num2(output),
    ...total === void 0 ? {} : { totalTokens: num2(total) },
    ...cacheRead ? { cacheReadTokens: num2(cacheRead) } : {},
    ...cacheWrite ? { cacheWriteTokens: num2(cacheWrite) } : {}
  };
}
function stopOf(reason) {
  if (reason === "length" || reason === "max_tokens" || reason === "incomplete") return "max-tokens";
  if (reason === "tool_calls" || reason === "tool_use" || reason === "function_call") return "tool-calls";
  return "stop";
}
async function* chatStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stop: null, error: null };
  for await (const { data } of sse(body)) {
    if (data === "[DONE]") break;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (payload.error) {
      state.error = { message: payload.error.message ?? "\u4E0A\u6E38\u8FD4\u56DE\u9519\u8BEF", code: payload.error.type ?? payload.error.code };
      break;
    }
    if (payload.usage) {
      state.input = payload.usage.prompt_tokens ?? state.input;
      state.output = payload.usage.completion_tokens ?? state.output;
      state.cacheRead = payload.usage.prompt_tokens_details?.cached_tokens ?? state.cacheRead;
    }
    const choice = payload.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (delta.reasoning_content) yield* emit.reasoning(String(delta.reasoning_content));
    if (delta.reasoning) yield* emit.reasoning(String(delta.reasoning));
    if (typeof delta.content === "string") yield* emit.text(delta.content);
    for (const call of delta.tool_calls ?? []) {
      const key = call.index ?? 0;
      const block = yield* emit.tool(key, { id: call.id, name: call.function?.name });
      yield* emit.arguments(block, call.function?.arguments ?? "");
    }
    if (choice.finish_reason) state.stop = stopOf(choice.finish_reason);
  }
  yield* emit.closeAll();
  yield { type: "usage", usage: usageOf(state) };
  yield* terminal(state);
}
async function* responsesStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, stop: null, error: null };
  const open = /* @__PURE__ */ new Map();
  for await (const { event, data } of sse(body)) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    const kind = payload.type ?? event;
    if (kind === "response.output_text.delta") {
      yield* emit.text(payload.delta ?? "");
      continue;
    }
    if (kind === "response.reasoning_summary_text.delta" || kind === "response.reasoning_text.delta") {
      yield* emit.reasoning(payload.delta ?? "");
      continue;
    }
    if (kind === "response.output_item.added" && payload.item?.type === "function_call") {
      const block = yield* emit.tool(payload.item.id ?? payload.output_index ?? 0, { id: payload.item.call_id ?? payload.item.id, name: payload.item.name });
      open.set(payload.item.id ?? String(payload.output_index), block);
      yield* emit.arguments(block, payload.item.arguments ?? "");
      continue;
    }
    if (kind === "response.function_call_arguments.delta") {
      let block = open.get(payload.item_id);
      if (!block) {
        block = yield* emit.tool(payload.item_id ?? payload.output_index ?? 0, { id: payload.item_id, name: void 0 });
        open.set(payload.item_id ?? String(payload.output_index), block);
      }
      yield* emit.arguments(block, payload.delta ?? "");
      continue;
    }
    if (kind === "response.completed" || kind === "response.incomplete") {
      const usage = payload.response?.usage ?? {};
      state.input = usage.input_tokens ?? state.input;
      state.output = usage.output_tokens ?? state.output;
      state.cacheRead = usage.input_tokens_details?.cached_tokens ?? state.cacheRead;
      state.stop = kind === "response.incomplete" ? "max-tokens" : stopOf(payload.response?.status === "incomplete" ? "incomplete" : "stop");
      continue;
    }
    if (kind === "response.failed" || kind === "error") {
      state.error = {
        message: payload.response?.error?.message ?? payload.message ?? "\u4E0A\u6E38\u8FD4\u56DE\u9519\u8BEF",
        code: payload.response?.error?.code ?? payload.code
      };
      break;
    }
  }
  yield* emit.closeAll();
  yield { type: "usage", usage: usageOf(state) };
  yield* terminal(state);
}
async function* messagesStream(body) {
  const emit = new Emission();
  const state = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, stop: null, error: null };
  const blocks = /* @__PURE__ */ new Map();
  for await (const { data } of sse(body)) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    const kind = payload.type;
    if (kind === "message_start") {
      state.input = payload.message?.usage?.input_tokens ?? state.input;
      state.output = payload.message?.usage?.output_tokens ?? state.output;
      state.cacheRead = payload.message?.usage?.cache_read_input_tokens ?? 0;
      state.cacheWrite = payload.message?.usage?.cache_creation_input_tokens ?? 0;
      continue;
    }
    if (kind === "content_block_start") {
      const block = payload.content_block ?? {};
      const key = payload.index ?? 0;
      if (block.type === "tool_use") {
        const target = yield* emit.tool(key, { id: block.id, name: block.name });
        blocks.set(key, target);
      } else if (block.type === "thinking") blocks.set(key, "reasoning");
      else blocks.set(key, "text");
      continue;
    }
    if (kind === "content_block_delta") {
      const delta = payload.delta ?? {};
      if (delta.type === "text_delta") yield* emit.text(delta.text ?? "");
      else if (delta.type === "thinking_delta") yield* emit.reasoning(delta.thinking ?? "");
      else if (delta.type === "input_json_delta") {
        const block = blocks.get(payload.index);
        if (block) yield* emit.arguments(block, delta.partial_json ?? "");
      }
      continue;
    }
    if (kind === "message_delta") {
      if (payload.usage) state.output = payload.usage.output_tokens ?? state.output;
      if (payload.delta?.stop_reason) state.stop = stopOf(payload.delta.stop_reason);
      continue;
    }
    if (kind === "error") {
      state.error = { message: payload.error?.message ?? "\u4E0A\u6E38\u8FD4\u56DE\u9519\u8BEF", code: payload.error?.type };
      break;
    }
  }
  yield* emit.closeAll();
  yield { type: "usage", usage: usageOf(state) };
  yield* terminal(state);
}
function* terminal(state) {
  if (state.error) {
    yield { type: "finish", reason: { kind: "error", failure: { message: state.error.message, code: state.error.code ?? "PROVIDER_ERROR" } } };
    return;
  }
  yield { type: "finish", reason: { kind: state.stop ?? "stop" } };
}
var RelayAdapter = class {
  /**
   * @param options - `{auth}`: relay credential resolver (`auth.resolve(siteId,'apiKey')`)
   */
  constructor({ auth }) {
    this.auth = auth;
    this.routes = /* @__PURE__ */ new Map();
  }
  /** Replace the owned route set (called whenever the registry changes). */
  setRoutes(routes) {
    this.routes = routes;
  }
  /** Snapshot for one route, or null when this adapter does not own it. */
  routeOf(provider) {
    return this.routes.get(provider) ?? null;
  }
  providerInfo(provider) {
    const route = this.routeOf(provider);
    return { id: provider, name: route?.label ?? provider };
  }
  // Relay routes share one upstream: the provider default policy is the right one.
  providerRetryPolicy() {
    return void 0;
  }
  listModels(provider) {
    return Promise.resolve().then(() => {
      const route = this.routeOf(provider);
      if (!route) return [];
      return route.models.map((model) => ({
        provider,
        id: model.id,
        name: model.name || model.id,
        inputModalities: ["text"]
      }));
    });
  }
  resolveModel(provider, model) {
    return Promise.resolve().then(() => {
      const route = this.routeOf(provider);
      if (!route) throw new Error(`\u4E2D\u8F6C\u7AD9\u9002\u914D\u5668\u4E0D\u62E5\u6709\u63D0\u4F9B\u5546 "${provider}"`);
      const entry = route.models.find((item) => item.id === model);
      const description = entry?.channelId === void 0 ? void 0 : `a6api \u6E20\u9053 #${entry.channelId}`;
      return {
        provider,
        id: model,
        name: entry?.name || model,
        ...description ? { description } : {},
        inputModalities: ["text"],
        context: { contextWindow: entry?.contextWindow ?? DEFAULT_CONTEXT },
        ...reasoningInfo(model, entry?.reasoning) ? { reasoning: reasoningInfo(model, entry?.reasoning) } : {}
      };
    });
  }
  prepareCall(provider, model) {
    return this.resolveModel(provider, model).then((info) => ({
      model: info,
      stream: (options2) => this.stream(options2)
    }));
  }
  /**
   * One model turn: map the request, stream it upstream, and translate the upstream events back
   * into harness chunks. Nothing here throws mid-stream — every failure ends as an error/aborted
   * `finish` chunk, which is the protocol's in-band error delivery.
   */
  async *stream(options2) {
    const route = this.routeOf(options2.provider);
    if (!route) {
      yield* failure2(`\u4E2D\u8F6C\u7AD9\u9002\u914D\u5668\u4E0D\u62E5\u6709\u63D0\u4F9B\u5546 "${options2.provider}"`, "NO_ADAPTER");
      return;
    }
    const entry = route.models.find((item) => item.id === options2.model);
    if (!entry) {
      yield* failure2(`\u4E2D\u8F6C\u7AD9\u8DEF\u7531 "${route.label}" \u6CA1\u6709\u6A21\u578B "${options2.model}"`, "UNKNOWN_MODEL");
      return;
    }
    if (options2.signal?.aborted) {
      yield* aborted("\u8BF7\u6C42\u5DF2\u88AB\u8C03\u7528\u65B9\u53D6\u6D88");
      return;
    }
    let key;
    try {
      key = await this.auth.resolve(route.siteId, "apiKey");
    } catch (error) {
      yield* failure2(`\u65E0\u6CD5\u8BFB\u53D6\u4E2D\u8F6C\u7AD9 API Key\uFF1A${error?.message ?? error}`, "INVALID_CREDENTIAL");
      return;
    }
    if (!key) {
      yield* failure2("\u672A\u914D\u7F6E\u4E2D\u8F6C\u7AD9 API Key\uFF0C\u8BF7\u5148\u5728\u300CAPI \u9002\u914D\u7AD9\u70B9\u300D\u4E2D\u586B\u5199", "MISSING_CREDENTIAL");
      return;
    }
    const spec = buildRequest(
      { format: route.format, apiUrl: route.apiUrl, key, model: options2.model, channelId: entry.channelId },
      options2
    );
    let response;
    try {
      response = await fetch(spec.url, {
        method: "POST",
        headers: spec.headers,
        body: JSON.stringify(spec.body),
        signal: options2.signal
      });
    } catch (error) {
      if (options2.signal?.aborted) {
        yield* aborted("\u8BF7\u6C42\u5DF2\u88AB\u8C03\u7528\u65B9\u53D6\u6D88");
        return;
      }
      yield* failure2(`\u65E0\u6CD5\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\uFF1A${error?.message ?? error}`, "TRANSPORT");
      return;
    }
    if (!response.ok || !response.body) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 600);
      } catch {
      }
      const code = response.status === 401 || response.status === 403 ? "AUTH" : response.status === 429 ? "RATE_LIMIT" : response.status === 400 || response.status === 422 ? "INVALID_REQUEST" : response.status >= 500 ? "SERVER" : "PROVIDER_ERROR";
      yield* failure2(`\u4E0A\u6E38 HTTP ${response.status}\uFF1A${detail || "\u65E0\u54CD\u5E94\u4F53"}`, code, response.status);
      return;
    }
    try {
      if (route.format === "messages") yield* messagesStream(response.body);
      else if (route.format === "responses") yield* responsesStream(response.body);
      else yield* chatStream(response.body);
    } catch (error) {
      if (options2.signal?.aborted) {
        yield* aborted("\u8BF7\u6C42\u5DF2\u88AB\u8C03\u7528\u65B9\u53D6\u6D88");
        return;
      }
      yield* failure2(`\u8BFB\u53D6\u4E0A\u6E38\u6D41\u5931\u8D25\uFF1A${error?.message ?? error}`, "TRANSPORT");
    }
  }
};

// backend/index.js
var name = "model-intelligence-test";
var inject = ["typert", "storageDomain", "credentials"];
function apply(ctx) {
  const storage = new PluginStorage(ctx);
  const auth = new RelayAuth(ctx, storage);
  const providers = new ManagedProviders(ctx, storage);
  let records;
  const engine = new FingerprintEngine(ctx, {
    onTouch: (job) => records?.onTouch(job),
    onSettled: (job) => records?.onSettled(job),
    relayKey: (siteId2) => auth.resolve(siteId2, "apiKey"),
    relayApiUrl: (siteId2) => siteOf(siteId2)?.apiUrl
  });
  records = new RecordsService(ctx, storage, engine);
  void storage.relay().then((domain) => {
    if (!domain) return;
    const table = domain.table("snapshots");
    for (const site of SITES) {
      const snapshot = snapshotOf(site.id);
      snapshot.restore(table.get(site.id));
      snapshot.onLoaded = (loaded) => table.put(site.id, loaded.serialize());
    }
  }).catch(() => {
  });
  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    for (const site of SITES) snapshotOf(site.id).onLoaded = void 0;
    disposeSnapshots();
    void storage.close();
  }, "model-intelligence.lifecycle");
  new ModelIntelligenceService(ctx, { engine, records, auth, providers });
  ctx.effect(() => ctx.typert.register(hostContribution), "model-intelligence.remote-contract");
  const adapter = new RelayAdapter({ auth });
  ctx.inject(["llm"], (llmCtx) => {
    const llm = llmCtx.get("llm");
    let handle = null;
    const sync = async () => {
      const routes = await providers.adapterRoutes();
      adapter.setRoutes(routes);
      const ids = [...routes.keys()];
      if (!ids.length) {
        handle?.();
        handle = null;
        return;
      }
      if (handle) handle.replace(ids);
      else handle = llm.registerAdapter(ids, adapter);
    };
    providers.onChange = () => {
      void sync().catch((error) => {
        void error;
      });
    };
    llmCtx.effect(() => () => {
      providers.onChange = void 0;
      handle?.();
      handle = null;
    }, "model-intelligence.relay-adapter");
    void sync().catch((error) => {
      void error;
    });
  });
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
