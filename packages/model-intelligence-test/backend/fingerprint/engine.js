import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateChallenges, loadDetector, parseNumbers } from 'lmfpd-sdk';
import { relayStream } from '../relay/stream.js';
import { AssistantStreamAccumulator, BlockAssembler, createUserMessage, isTokenDelta, isVisibleChunk, chunkHasVisibleText, assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm';

// The SDK owns challenges/scoring; DSH owns request preparation, transport and stream assembly.
const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 6;
const REQUESTS_PER_MODEL = 3;
// Six model slots with three challenges each: the pool is sized so one record can fill every slot.
const MAX_CONCURRENT_REQUESTS = DEFAULT_CONCURRENCY * REQUESTS_PER_MODEL;
const DEFAULT_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_RUNNING_JOBS = 4;
const MAX_RETAINED_JOBS = 16;
const MAX_TEXT = 24_000;
const RELOAD_AFTER_MS = 10 * 60_000;
const DATA_TTL_SECONDS = 3_600;
const FINISHED_JOB_TTL_MS = 60 * 60_000;
const END_STATES = new Set(['complete', 'truncated', 'failed', 'cancelled']);
const END_STAGES = new Set(['completed', 'failed', 'timeout', 'cancelled']);
const LIMITS = {
  maxConcurrency: MAX_CONCURRENCY, maxConcurrentRequests: MAX_CONCURRENT_REQUESTS, requestsPerModel: REQUESTS_PER_MODEL,
  defaultConcurrency: DEFAULT_CONCURRENCY, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, minTimeoutMs: MIN_TIMEOUT_MS, maxTimeoutMs: MAX_TIMEOUT_MS,
};

export class FingerprintError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function cachePath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'cache', 'model-intelligence-test', 'lmfpd-data.bin');
}
function languageOf(prompt) {
  if (/[\uac00-\ud7af]/.test(prompt)) return 'ko';
  if (/[\u3040-\u30ff]/.test(prompt)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(prompt)) return 'zh';
  return /entiers|choisissez|nombres/i.test(prompt) ? 'fr' : 'en';
}
const finite = value => Number.isFinite(value) ? value : null;
const tokens = value => Number.isFinite(value) && value >= 0 ? value : null;
const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
// Provider error text can contain headers, endpoint URLs or credentials. Never forward it verbatim:
// the diagnostic detail below is redacted before it leaves the Host.
function requestFailure(failure) {
  const status = failure?.status;
  if (status === 401 || status === 403) return '供应商认证或权限失败，请检查当前运行时的模型配置';
  if (status === 429) return '供应商限流或配额不足，请稍后重试';
  if (status === 404) return '供应商未找到所选模型';
  if (Number.isInteger(status) && status >= 500) return '供应商服务暂时不可用';
  return '模型请求失败，请检查当前运行时的供应商配置或稍后重试';
}
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{4,}/g,
  /\b(?:api[-_]?key|authorization|x-api-key|token)["'\s:=]{1,4}[^\s"',}]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];
function redact(text) {
  if (typeof text !== 'string' || !text) return null;
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, match =>
    /^bearer/i.test(match) ? 'Bearer [redacted]' : match.length > 12 ? `${match.slice(0, 6)}…[redacted]` : '[redacted]'), text).slice(0, 8000);
}
// Everything the Host knows about a failed request, so the UI can show a stack instead of a guess.
function failureDetail(failure, source) {
  // DSH LlmError keeps serializable provider facts in .failure, not on the live Error itself.
  const facts = failure?.failure ?? failure;
  const message = redact(typeof facts === 'string' ? facts : facts?.message);
  return {
    source, message,
    code: typeof facts?.code === 'string' ? facts.code : null,
    status: Number.isInteger(facts?.status) ? facts.status : null,
    text: typeof facts === 'string' ? null : redact(facts?.detail ?? facts?.message ?? null),
    stack: typeof failure?.stack === 'string' ? redact(failure.stack) : null,
  };
}
function publicAnalysis(a) {
  return {
    decision: a.decision, prediction: a.prediction ?? null, predictionName: a.prediction_name ?? null,
    familyName: a.family_prediction_name ?? null, probability: finite(a.probability),
    probabilityStatus: a.probability_status, rankingScore: finite(a.ranking_score), usedOutputs: a.used_outputs,
    candidates: a.results.map(item => ({
      model: item.model, displayName: item.display_name, family: item.family, familyName: item.family_name,
      score: item.score, probability: finite(item.probability),
    })),
    diagnostics: a.diagnostics.map(item => ({
      index: item.index, parsed: item.parsed_numbers, minimum: item.minimum_numbers,
      accepted: item.accepted, outOfRange: item.raw_out_of_range_count,
    })),
    sequence: a.sequence && Number.isFinite(a.sequence.autocorrelation) && Number.isFinite(a.sequence.small_step_share) ? {
      autocorrelation: finite(a.sequence.autocorrelation), smallStepShare: finite(a.sequence.small_step_share),
      modelLike: a.sequence.model_like,
    } : null,
    method: a.method,
  };
}
/** Normalise the request options so a bad client value can never disable the safety caps. */
function optionsOf(options) {
  const concurrency = Number.isFinite(options?.concurrency) ? clampInt(options.concurrency, 1, MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? clampInt(options.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  return { concurrency, timeoutMs };
}

export class FingerprintEngine {
  /**
   * @param hooks.onTouch(job)   every revision bump (callers throttle persistence themselves)
   * @param hooks.onSettled(job) the job left `running` (done / cancelled / failed)
   * @param hooks.relayKey(siteId) resolves the relay API key on the Host, or null
   * @param hooks.relayApiUrl(siteId) relay API base URL
   */
  constructor(ctx, hooks = {}) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.jobs = new Map();
    this.loaded = undefined;
    this.loading = undefined;
    this.disposed = false;
    this.starting = 0;
    this.activeSamples = 0;
    this.waiters = [];
  }

  async detector() {
    if (this.loaded && Date.now() - this.loaded.at < RELOAD_AFTER_MS) return this.loaded;
    if (!this.loading) {
      this.loading = loadDetector({ cache: cachePath(), ttl: DATA_TTL_SECONDS })
        .then(detector => {
          const loaded = { detector, at: Date.now(), builtAt: detector.builtAt };
          if (!this.disposed) this.loaded = loaded;
          return loaded;
        }).finally(() => { this.loading = undefined; });
    }
    try { return await this.loading; }
    catch {
      if (this.loaded) return this.loaded;
      throw new FingerprintError('reference-unavailable', '无法加载指纹参考库，且没有可用缓存。请检查网络后重新创建测试。');
    }
  }

  async start(models, options) {
    if (this.disposed) throw new FingerprintError('disposed', '插件正在卸载');
    if (!Array.isArray(models) || models.length < 1 || models.length > 64 || models.some(m => !m || typeof m.provider !== 'string' || typeof m.id !== 'string')) {
      throw new FingerprintError('invalid-models', '请选择 1–64 个有效模型');
    }
    if (new Set(models.map(m => JSON.stringify([m.provider, m.id]))).size !== models.length) {
      throw new FingerprintError('duplicate-model', '同一测试不能重复选择同一个供应商模型');
    }
    this.prune();
    if (this.starting + [...this.jobs.values()].filter(job => job.status === 'running').length >= MAX_RUNNING_JOBS) {
      throw new FingerprintError('busy', `已有 ${MAX_RUNNING_JOBS} 个指纹测试正在执行，请等待结束或取消后再创建`);
    }
    const limits = optionsOf(options);
    const dshModels = models.filter(m => !m.relay);
    const relayModels = models.filter(m => m.relay);
    const llm = this.ctx.get('llm');
    if (dshModels.length) {
      if (!llm) throw new FingerprintError('unavailable', '当前运行时没有可用的 LLM 服务');
      if (typeof llm.prepareCall !== 'function') throw new FingerprintError('incompatible-runtime', '当前 DSH 不支持官方 LLM 请求准备接口，请升级运行时');
    }
    this.starting += 1;
    try {
      const relayAuth = new Map();
      for (const model of relayModels) {
        const r = model.relay;
        if (!r || typeof r.siteId !== 'string' || !Number.isSafeInteger(r.channelId) || r.channelId <= 0 || typeof r.model !== 'string' || !r.model || !['chat', 'responses', 'messages'].includes(r.api)) {
          throw new FingerprintError('invalid-models', '中转站渠道参数无效');
        }
        if (!relayAuth.has(r.siteId)) {
          const key = await this.hooks.relayKey?.(r.siteId);
          if (!key) throw new FingerprintError('relay-key-missing', '未配置中转站 API Key，请先在设置「API 适配站点」中填写');
          relayAuth.set(r.siteId, { key, apiUrl: this.hooks.relayApiUrl?.(r.siteId) });
        }
      }
      const providers = dshModels.length ? new Set(llm.listProviders().map(provider => provider.id)) : new Set();
      for (const provider of new Set(dshModels.map(m => m.provider))) {
        if (!providers.has(provider)) throw new FingerprintError('unknown-model', '所选供应商已不可用，请刷新模型目录');
        let available;
        try { available = new Set((await llm.listModels(provider)).map(m => m.id)); }
        catch { throw new FingerprintError('catalog-unavailable', '无法确认所选模型，请刷新模型目录后重试'); }
        if (dshModels.some(m => m.provider === provider && !available.has(m.id))) throw new FingerprintError('unknown-model', '所选模型已不在当前目录中，请刷新后重选');
      }
      const reference = await this.detector();
      if (this.disposed) throw new FingerprintError('disposed', '插件正在卸载');
      const challenges = generateChallenges(REQUESTS_PER_MODEL).map(item => ({
        id: item.id, expectedCount: item.expected_count, prompt: item.prompt, language: languageOf(item.prompt),
      }));
      const runs = models.map(model => ({
        provider: model.provider, model: model.id, stage: 'queued', analysis: null, error: null,
        relay: model.relay ? { ...model.relay, ...relayAuth.get(model.relay.siteId) } : null,
        samples: challenges.map((challenge, index) => ({
          index, state: 'queued', expectedCount: challenge.expectedCount, text: '', count: 0,
          firstByteMs: null, firstTextMs: null, generationMs: null, durationMs: null,
          inputTokens: null, outputTokens: null, finish: null, error: null, errorDetail: null,
          startedAt: 0, firstAt: 0, lastAt: 0, timeoutMs: limits.timeoutMs, timer: undefined, timeout: undefined,
        })),
      }));
      const job = {
        id: `fp-${randomUUID()}`, revision: 1, status: 'running', createdAt: Date.now(), finishedAt: null,
        controller: new AbortController(), detector: reference.detector,
        reference: { builtAt: reference.builtAt, source: 'lmfpd-sdk', sdk: 'lmfpd-sdk@0.2.0' }, challenges,
        concurrency: limits.concurrency, timeoutMs: limits.timeoutMs,
        runs, pending: [...runs], active: new Map(), settled: 0, wake: undefined, loop: null,
      };
      this.jobs.set(job.id, job);
      this.schedule(job);
      return this.view(job);
    } finally { this.starting -= 1; }
  }

  status(jobId, revision) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError('not-found', '指纹任务不存在或已过期');
    if (revision === job.revision) return { id: job.id, revision: job.revision, unchanged: true };
    return this.view(job);
  }

  /** Live, non-preemptive configuration: lowering a limit never aborts an in-flight request. */
  configure(jobId, options) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError('not-found', '指纹任务不存在或已过期');
    let changed = false;
    if (Number.isFinite(options?.concurrency) && options.concurrency !== job.concurrency) {
      job.concurrency = clampInt(options.concurrency, 1, MAX_CONCURRENCY);
      changed = true;
    }
    if (Number.isFinite(options?.timeoutMs) && options.timeoutMs !== job.timeoutMs) {
      const raised = options.timeoutMs > job.timeoutMs;
      job.timeoutMs = clampInt(options.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      changed = true;
      // Raising the cap extends requests that are already running; lowering it only affects future requests.
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
      if (job.status === 'running') this.wakeJob(job);
    }
    return this.view(job);
  }

  /** Re-run the failed samples of one model. Completed samples of that model are kept. */
  retry(jobId, model) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError('not-found', '指纹任务不存在或已过期');
    if (this.disposed) throw new FingerprintError('disposed', '插件正在卸载');
    if (job.status === 'cancelled' || job.controller.signal.aborted) throw new FingerprintError('cancelled', '已取消的测试不能重试，请重新创建测试');
    if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') throw new FingerprintError('invalid-models', '重试的模型无效');
    const run = job.runs.find(item => item.provider === model.provider && item.model === model.id);
    if (!run) throw new FingerprintError('unknown-model', '该模型不属于这个指纹测试');
    if (run.samples.some(sample => !END_STATES.has(sample.state))) throw new FingerprintError('busy', '该模型仍在执行，请等待当前请求结束');
    const failed = run.samples.filter(sample => sample.state === 'failed');
    if (!failed.length) throw new FingerprintError('nothing-to-retry', '该模型没有可重试的失败样本');
    for (const sample of failed) {
      clearTimeout(sample.timer);
      sample.state = 'queued'; sample.text = ''; sample.count = 0;
      sample.firstByteMs = null; sample.firstTextMs = null; sample.generationMs = null; sample.durationMs = null;
      sample.inputTokens = null; sample.outputTokens = null; sample.finish = null; sample.error = null;
      sample.errorDetail = null;
      sample.startedAt = 0; sample.firstAt = 0; sample.lastAt = 0; sample.timer = undefined; sample.timeout = undefined;
      sample.timeoutMs = job.timeoutMs;
    }
    run.analysis = null; run.error = null; run.stage = 'queued';
    job.status = 'running'; job.finishedAt = null;
    if (!job.pending.includes(run)) job.pending.push(run);
    this.touch(job);
    this.schedule(job);
    return this.view(job);
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new FingerprintError('not-found', '指纹任务不存在或已过期');
    if (job.status === 'running') {
      job.controller.abort();
      for (const run of job.runs) {
        if (END_STAGES.has(run.stage)) continue;
        for (const sample of run.samples) {
          if (END_STATES.has(sample.state)) continue;
          clearTimeout(sample.timer);
          sample.timer = undefined; sample.timeout = undefined;
          this.finishTiming(sample);
          sample.state = 'cancelled'; sample.error = '已取消';
          sample.errorDetail = { source: 'cancelled', message: sample.error, code: 'cancelled', status: null, text: null, stack: null };
        }
        // A cancelled model is not scored, even if some of its samples are valid.
        run.stage = 'cancelled'; run.analysis = null; run.error = null;
      }
      job.pending = []; job.active.clear();
      job.status = 'cancelled'; job.finishedAt = Date.now(); this.touch(job);
      this.wakeJob(job);
      this.settle(job);
    }
    return this.view(job);
  }

  dispose() {
    this.disposed = true;
    this.hooks = {};
    for (const job of this.jobs.values()) this.cancel(job.id);
    this.jobs.clear(); this.loaded = undefined;
  }

  prune() {
    const finished = [...this.jobs.values()].filter(job => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
    for (const job of finished) {
      if (Date.now() - job.finishedAt > FINISHED_JOB_TTL_MS || this.jobs.size >= MAX_RETAINED_JOBS) this.jobs.delete(job.id);
    }
  }
  touch(job) {
    job.revision += 1;
    try { this.hooks.onTouch?.(job); } catch { /* persistence hooks never break scheduling */ }
  }
  settle(job) {
    try { this.hooks.onSettled?.(job); } catch { /* persistence hooks never break scheduling */ }
  }
  /** Jobs that are still retained in memory (persisted attempts may outlive them). */
  has(jobId) { return this.jobs.has(jobId); }
  wakeJob(job) { const wake = job.wake; job.wake = undefined; wake?.(); }

  // Reserve all queued challenges of a model atomically: the global cap must not split its batch.
  acquire(signal, count) {
    if (signal.aborted || this.disposed) return Promise.resolve(false);
    if (!this.waiters.length && this.activeSamples + count <= MAX_CONCURRENT_REQUESTS) {
      this.activeSamples += count; return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const entry = { resolve, signal, count, abort: null };
      entry.abort = () => {
        const index = this.waiters.indexOf(entry);
        if (index !== -1) this.waiters.splice(index, 1);
        resolve(false);
        this.release(0);
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiters.push(entry);
    });
  }
  release(count) {
    this.activeSamples -= count;
    while (this.waiters.length) {
      const entry = this.waiters[0];
      if (!entry.signal.aborted && !this.disposed && this.activeSamples + entry.count > MAX_CONCURRENT_REQUESTS) break;
      this.waiters.shift();
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted || this.disposed) { entry.resolve(false); continue; }
      this.activeSamples += entry.count; entry.resolve(true);
    }
  }

  /**
   * Per-job scheduler: at most `concurrency` models run at once and each model always runs its
   * three challenges together. A live concurrency increase wakes the loop and admits more models.
   */
  schedule(job) {
    if (job.loop) { this.wakeJob(job); return; }
    job.loop = (async () => {
      try { await this.drain(job); } catch (error) { this.failJob(job, error); }
      finally {
        job.loop = null;
        // A retry may have queued a model while the loop was already returning; restart it so the
        // reopened job always makes progress instead of being dropped.
        if (!this.disposed && job.status === 'running' && !job.controller.signal.aborted
          && (job.pending.length > 0 || job.active.size > 0)) this.schedule(job);
      }
    })();
  }
  async drain(job) {
    const llm = this.ctx.get('llm');
    const { signal } = job.controller;
    while (job.status === 'running' && !signal.aborted) {
      while (job.active.size < job.concurrency && job.pending.length) {
        const run = job.pending.shift();
        const promise = this.runModel(job, llm, run).catch(error => this.failJob(job, error)).finally(() => {
          job.active.delete(run);
          job.settled += 1;
          this.wakeJob(job);
        });
        job.active.set(run, promise);
      }
      if (!job.active.size) break;
      const seen = job.settled;
      await new Promise(resolve => {
        job.wake = resolve;
        // A completion may have landed between the check above and installing the wake-up.
        if (job.settled !== seen) this.wakeJob(job);
      });
      job.wake = undefined;
    }
    await Promise.allSettled([...job.active.values()]);
    for (const run of job.runs) this.maybeAnalyze(job, run);
    if (job.status !== 'running' || signal.aborted) return;
    // A retry may have queued a model between the loop exit and here: keep the job running and let
    // the scheduler restart it instead of publishing a finished job with queued samples.
    if (job.pending.length > 0 || job.active.size > 0) return;
    job.status = 'done'; job.finishedAt = Date.now(); this.touch(job);
    this.settle(job);
  }

  async runModel(job, llm, run) {
    if (job.controller.signal.aborted) return;
    run.stage = 'queued'; this.touch(job);
    const queued = run.samples.filter(sample => sample.state === 'queued');
    if (!queued.length || !await this.acquire(job.controller.signal, queued.length)) return;
    try {
      if (job.controller.signal.aborted || this.disposed) return;
      // Keep reservations until every sibling settles, even if one unexpectedly rejects.
      const settled = await Promise.allSettled(queued.map(sample => this.sample(job, llm, run, sample)));
      const rejected = settled.find(result => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    } finally { this.release(queued.length); }
    if (job.controller.signal.aborted) return;
    this.maybeAnalyze(job, run);
  }

  failJob(job, failure) {
    if (job.status !== 'running') return;
    job.controller.abort();
    for (const run of job.runs) {
      if (END_STAGES.has(run.stage)) continue;
      for (const sample of run.samples) if (!END_STATES.has(sample.state)) {
        clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined;
        this.finishTiming(sample); sample.state = 'failed'; sample.error = '指纹任务执行中断';
        sample.errorDetail = { ...failureDetail(failure, 'scheduler'), message: sample.error };
      }
      run.stage = 'failed';
      run.error = {
        stage: 'streaming', message: '指纹任务执行中断，请重新创建测试',
        detail: failureDetail(failure, 'scheduler'),
      };
    }
    job.pending = []; job.active.clear();
    job.status = 'done'; job.finishedAt = Date.now(); this.touch(job);
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
    if (!sample.timeout) { sample.timer = undefined; return; }
    sample.timer = setTimeout(() => sample.timeout?.abort(), Math.max(0, sample.startedAt + sample.timeoutMs - Date.now()));
  }

  // Project the canonical DSH result into fingerprint/UI facts; never concatenate raw deltas here.
  projectResponse(sample, assembler, final = false) {
    // The official safe-prefix accessor also tolerates an open non-text block during streaming.
    const blocks = final ? assembler.blocks() : assembler.interruptedBlocks();
    sample.text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, MAX_TEXT);
    sample.count = parseNumbers(sample.text).length;
    sample.inputTokens = tokens(assembler.usage?.inputTokens);
    sample.outputTokens = tokens(assembler.usage?.outputTokens);
  }

  async sample(job, llm, run, sample) {
    // runModel has already reserved this model's entire batch. Queue time is not request time.
    if (sample.state !== 'queued' || job.controller.signal.aborted) return;
    const timeoutController = new AbortController();
    const textLimitController = new AbortController();
    const signal = AbortSignal.any([job.controller.signal, timeoutController.signal, textLimitController.signal]);
    const assembler = new BlockAssembler();
    const events = new AssistantStreamAccumulator();
    sample.timeout = timeoutController;
    sample.timeoutMs = job.timeoutMs;
    sample.state = 'waiting'; sample.startedAt = Date.now();
    this.armTimeout(sample);
    this.refreshStage(run); this.touch(job);
    let truncated = false, failure = null, rawFailure = null, failureSource = 'prepare';
    if (run.relay) {
      try { ({ truncated, failure, rawFailure, failureSource } = await this.relaySample(job, run, sample, signal, textLimitController)); }
      finally { clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined; }
    } else try {
      const prepared = await llm.prepareCall({ provider: run.provider, model: run.model }, signal);
      signal.throwIfAborted();
      const message = createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: job.challenges[sample.index].prompt }],
      });
      failureSource = 'stream';
      for await (const chunk of prepared.stream({ ...prepared.config, messages: [message], signal })) {
        // Cancellation already publishes a terminal snapshot; do not consume late responses.
        if (signal.aborted) break;
        const timed = events.push({ time: Date.now(), chunk });
        assembler.push(timed.chunk);
        this.projectResponse(sample, assembler);
        if (isTokenDelta(timed.chunk)) {
          if (!sample.firstAt) { sample.firstAt = timed.time; sample.firstByteMs = timed.time - sample.startedAt; }
          sample.lastAt = timed.time;
          sample.generationMs = timed.time > sample.firstAt ? timed.time - sample.firstAt : null;
        }
        if (sample.firstTextMs === null && chunkHasVisibleText(timed.chunk)) sample.firstTextMs = timed.time - sample.startedAt;
        // Completed blocks count as received content even when an adapter emits no deltas.
        if (isTokenDelta(timed.chunk) || isVisibleChunk(timed.chunk)) sample.state = 'streaming';
        this.refreshStage(run); this.touch(job);
        if (sample.text.length >= MAX_TEXT) {
          truncated = true;
          // The cap won before the deadline; iterator cleanup must not turn truncation into timeout.
          clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined;
          textLimitController.abort();
          break;
        }
      }
      // cancel() already published the terminal snapshot: no final projection may change it.
      if (job.controller.signal.aborted) return;
      // DSH owns terminal semantics, including its default stop for a naturally exhausted stream.
      const finish = assembler.finish;
      this.projectResponse(sample, assembler, true);
      sample.finish = truncated ? 'text-limit' : finish.kind;
      if (!truncated) {
        if (finish.kind === 'max-tokens') truncated = true;
        else if (finish.kind === 'error' || finish.kind === 'aborted') {
          rawFailure = finish.failure;
          failure = finish.kind === 'error' ? requestFailure(rawFailure) : '供应商中断了模型请求';
        } else if (finish.kind === 'tool-calls') failure = '模型尝试调用工具，回答无效';
      }
    } catch (error) {
      // Breaking a locally capped stream may make its iterator throw during cleanup.
      if (!textLimitController.signal.aborted) { failure = requestFailure(error?.failure ?? error); rawFailure = error; }
    } finally { clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined; }
    // cancel() already published the terminal snapshot; late chunks cannot resurrect it.
    if (job.controller.signal.aborted) return;
    if (!run.relay) {
      const firstTokenAt = assistantStreamFirstTokenTime(events.snapshot());
      sample.firstByteMs = firstTokenAt === undefined ? null : firstTokenAt - sample.startedAt;
    }
    if (textLimitController.signal.aborted) sample.finish = 'text-limit';
    this.finishTiming(sample);
    if (timeoutController.signal.aborted) {
      sample.state = 'failed';
      sample.error = `请求超时（${Math.round(sample.timeoutMs / 1000)} 秒）`;
      sample.errorDetail = { source: 'timeout', message: sample.error, code: 'timeout', status: null, text: null, stack: null };
    } else if (failure) {
      sample.state = 'failed'; sample.error = failure;
      sample.errorDetail = { ...failureDetail(rawFailure, failureSource), message: failure };
    } else { sample.state = truncated ? 'truncated' : 'complete'; sample.errorDetail = null; }
    this.refreshStage(run); this.touch(job);
  }

  /** Relay channel sample: same timing/truncation semantics as the DSH path, own wire protocol. */
  async relaySample(job, run, sample, signal, textLimitController) {
    const r = run.relay;
    let truncated = false, failure = null, rawFailure = null, failureSource = 'stream';
    let text = '';
    try {
      for await (const event of relayStream({ apiUrl: r.apiUrl, apiKey: r.key, channelId: r.channelId, model: r.model, api: r.api, prompt: job.challenges[sample.index].prompt, signal })) {
        if (signal.aborted) break;
        const now = Date.now();
        if (event.type === 'text' || event.type === 'reasoning') {
          if (!event.text) continue;
          if (!sample.firstAt) { sample.firstAt = now; sample.firstByteMs = now - sample.startedAt; }
          sample.lastAt = now;
          sample.generationMs = now > sample.firstAt ? now - sample.firstAt : null;
          if (event.type === 'text') {
            if (sample.firstTextMs === null) sample.firstTextMs = now - sample.startedAt;
            text += event.text;
            sample.text = text.slice(0, MAX_TEXT);
            sample.count = parseNumbers(sample.text).length;
          }
          sample.state = 'streaming';
          this.refreshStage(run); this.touch(job);
          if (text.length >= MAX_TEXT) {
            truncated = true;
            clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined;
            textLimitController.abort();
            break;
          }
        } else if (event.type === 'finish') {
          sample.inputTokens = tokens(event.usage?.inputTokens);
          sample.outputTokens = tokens(event.usage?.outputTokens);
          sample.finish = event.kind;
          if (event.kind === 'max-tokens') truncated = true;
          else if (event.kind === 'error') { rawFailure = event.failure; failure = requestFailure(event.failure); }
          else if (event.kind === 'tool-calls') failure = '模型尝试调用工具，回答无效';
        }
      }
    } catch (error) {
      if (!textLimitController.signal.aborted && !signal.aborted) { rawFailure = error?.failure ?? error; failure = requestFailure(rawFailure); }
    }
    if (truncated && textLimitController.signal.aborted) sample.finish = 'text-limit';
    return { truncated, failure, rawFailure, failureSource };
  }

  maybeAnalyze(job, run) {
    if (job.controller.signal.aborted || run.analysis || END_STAGES.has(run.stage)) return;
    if (!run.samples.every(sample => END_STATES.has(sample.state))) return;
    run.stage = 'analyzing'; this.touch(job);
    try {
      run.analysis = publicAnalysis(job.detector.analyze(run.samples.map(sample => ({
        text: sample.state === 'complete' || sample.state === 'truncated' ? sample.text : '',
        expected_count: sample.expectedCount,
      })), { strict: false }));
      run.stage = 'completed';
    } catch (error) {
      run.stage = 'failed';
      run.error = {
        stage: 'analyzing', message: '指纹分析失败，请检查参考库版本并重新创建测试',
        detail: failureDetail(error, 'analysis'),
      };
    }
    this.touch(job);
  }
  refreshStage(run) {
    if (END_STAGES.has(run.stage) || run.analysis) return;
    const states = run.samples.map(sample => sample.state);
    if (states.every(state => END_STATES.has(state))) {
      if (states.every(state => state === 'failed' || state === 'cancelled')) {
        const failed = run.samples.filter(sample => sample.state === 'failed');
        run.stage = failed.length && failed.every(sample => sample.error?.startsWith('请求超时')) ? 'timeout' : 'failed';
        run.error = {
          stage: 'streaming', message: failed[0]?.error ?? '全部样本未完成',
          detail: failed[0]?.errorDetail ?? null,
        };
      } else run.stage = 'analyzing';
    } else if (states.includes('streaming')) run.stage = 'streaming';
    else if (states.includes('waiting')) run.stage = 'waiting-first-token';
    else run.stage = 'queued';
  }
  view(job) {
    return {
      id: job.id, revision: job.revision, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt,
      concurrency: job.concurrency, timeoutMs: job.timeoutMs, limits: { ...LIMITS },
      reference: { ...job.reference }, challenges: job.challenges.map(challenge => ({ ...challenge })),
      runs: job.runs.map(run => ({
        provider: run.provider, model: run.model, stage: run.stage, error: run.error, analysis: run.analysis,
        ...(run.relay ? { relay: { siteId: run.relay.siteId, channelId: run.relay.channelId, model: run.relay.model, api: run.relay.api } } : {}),
        samples: run.samples.map(sample => ({
          index: sample.index, state: sample.state, expectedCount: sample.expectedCount, count: sample.count, text: sample.text,
          firstByteMs: sample.firstByteMs, firstTextMs: sample.firstTextMs, generationMs: sample.generationMs,
          durationMs: sample.durationMs, inputTokens: sample.inputTokens, outputTokens: sample.outputTokens,
          finish: sample.finish, error: sample.error, errorDetail: sample.errorDetail ?? null,
        })),
      })),
    };
  }
}
