import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateChallenges, loadDetector, parseNumbers } from 'lmfpd-sdk';

// The SDK owns challenges and scoring. Only the Host llm service sends model requests.
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
  const message = typeof failure === 'string' ? failure : typeof failure?.message === 'string' ? redact(failure.message) : null;
  return {
    source, message,
    code: typeof failure?.code === 'string' ? failure.code : null,
    status: Number.isInteger(failure?.status) ? failure.status : null,
    text: typeof failure === 'string' ? null : redact(failure?.detail ?? failure?.message ?? null),
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
  constructor(ctx) {
    this.ctx = ctx;
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
    const llm = this.ctx.get('llm');
    if (!llm || typeof llm.stream !== 'function') throw new FingerprintError('unavailable', '当前运行时没有可用的 LLM 服务');
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
    this.starting += 1;
    try {
      const providers = new Set(llm.listProviders().map(provider => provider.id));
      for (const provider of new Set(models.map(m => m.provider))) {
        if (!providers.has(provider)) throw new FingerprintError('unknown-model', '所选供应商已不可用，请刷新模型目录');
        let available;
        try { available = new Set((await llm.listModels(provider)).map(m => m.id)); }
        catch { throw new FingerprintError('catalog-unavailable', '无法确认所选模型，请刷新模型目录后重试'); }
        if (models.some(m => m.provider === provider && !available.has(m.id))) throw new FingerprintError('unknown-model', '所选模型已不在当前目录中，请刷新后重选');
      }
      const reference = await this.detector();
      if (this.disposed) throw new FingerprintError('disposed', '插件正在卸载');
      const challenges = generateChallenges(REQUESTS_PER_MODEL).map(item => ({
        id: item.id, expectedCount: item.expected_count, prompt: item.prompt, language: languageOf(item.prompt),
      }));
      const runs = models.map(model => ({
        provider: model.provider, model: model.id, stage: 'queued', analysis: null, error: null,
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
    }
    return this.view(job);
  }

  dispose() {
    this.disposed = true;
    for (const job of this.jobs.values()) this.cancel(job.id);
    this.jobs.clear(); this.loaded = undefined;
  }

  prune() {
    const finished = [...this.jobs.values()].filter(job => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
    for (const job of finished) {
      if (Date.now() - job.finishedAt > FINISHED_JOB_TTL_MS || this.jobs.size >= MAX_RETAINED_JOBS) this.jobs.delete(job.id);
    }
  }
  touch(job) { job.revision += 1; }
  wakeJob(job) { const wake = job.wake; job.wake = undefined; wake?.(); }

  // One bounded pool for the entire plugin: every in-flight model request, across all jobs and tabs.
  acquire(signal) {
    if (signal.aborted || this.disposed) return Promise.resolve(false);
    if (this.activeSamples < MAX_CONCURRENT_REQUESTS) { this.activeSamples += 1; return Promise.resolve(true); }
    return new Promise(resolve => {
      const entry = { resolve, signal, abort: null };
      entry.abort = () => {
        const index = this.waiters.indexOf(entry);
        if (index !== -1) this.waiters.splice(index, 1);
        resolve(false);
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiters.push(entry);
    });
  }
  release() {
    this.activeSamples -= 1;
    while (this.waiters.length) {
      const entry = this.waiters.shift();
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted || this.disposed) { entry.resolve(false); continue; }
      this.activeSamples += 1; entry.resolve(true); break;
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
        const promise = this.runModel(job, llm, run).catch(() => {}).finally(() => {
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
  }

  async runModel(job, llm, run) {
    if (job.controller.signal.aborted) return;
    run.stage = 'queued'; this.touch(job);
    await Promise.all(run.samples.map(sample => this.sample(job, llm, run, sample)));
    if (job.controller.signal.aborted) return;
    this.maybeAnalyze(job, run);
  }

  failJob(job) {
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

  async sample(job, llm, run, sample) {
    // A retried model keeps its already-finished samples; only queued ones are sampled again.
    if (sample.state !== 'queued') return;
    const timeoutController = new AbortController();
    const signal = AbortSignal.any([job.controller.signal, timeoutController.signal]);
    sample.timeout = timeoutController;
    sample.timeoutMs = job.timeoutMs;
    sample.state = 'waiting'; sample.startedAt = Date.now();
    this.armTimeout(sample);
    this.refreshStage(run); this.touch(job);
    let truncated = false, failure = null, rawFailure = null;
    try {
      for await (const chunk of llm.stream({
        provider: run.provider, model: run.model, signal,
        messages: [{ role: 'user', content: [{ type: 'text', text: job.challenges[sample.index].prompt }] }],
      })) {
        if (signal.aborted) break;
        if ((chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta') && typeof chunk.text === 'string' && chunk.text.length) {
          const now = Date.now();
          if (!sample.firstAt) { sample.firstAt = now; sample.firstByteMs = now - sample.startedAt; }
          sample.lastAt = now;
          sample.generationMs = now > sample.firstAt ? now - sample.firstAt : null;
          sample.state = 'streaming'; this.refreshStage(run);
          if (chunk.type === 'text-delta') {
            if (sample.firstTextMs === null) sample.firstTextMs = now - sample.startedAt;
            sample.text = (sample.text + chunk.text).slice(0, MAX_TEXT);
            sample.count = parseNumbers(sample.text).length;
            if (sample.text.length >= MAX_TEXT) { truncated = true; sample.finish = 'text-limit'; break; }
          }
          this.touch(job);
        } else if (chunk?.type === 'usage' && chunk.usage) {
          sample.inputTokens = tokens(chunk.usage.inputTokens) ?? sample.inputTokens;
          sample.outputTokens = tokens(chunk.usage.outputTokens) ?? sample.outputTokens;
          this.touch(job);
        } else if (chunk?.type === 'finish') {
          sample.finish = chunk.reason?.kind ?? null;
          rawFailure = chunk.reason?.failure ?? null;
          if (sample.finish === 'max-tokens') truncated = true;
          else if (sample.finish === 'error') failure = requestFailure(chunk.reason.failure);
          else if (sample.finish === 'aborted') failure = '供应商中断了模型请求';
          else if (sample.finish === 'tool-calls') failure = '模型尝试调用工具，回答无效';
          this.touch(job);
        }
      }
    } catch (error) { failure = requestFailure(error); rawFailure = error; }
    finally { clearTimeout(sample.timer); sample.timer = undefined; sample.timeout = undefined; }
    // cancel() already published the terminal snapshot; late chunks cannot resurrect it.
    if (job.controller.signal.aborted) return;
    this.finishTiming(sample);
    sample.count = parseNumbers(sample.text).length;
    if (timeoutController.signal.aborted) {
      sample.state = 'failed';
      sample.error = `请求超时（${Math.round(sample.timeoutMs / 1000)} 秒）`;
      sample.errorDetail = { source: 'timeout', message: sample.error, code: 'timeout', status: null, text: null, stack: null };
    } else if (failure) {
      sample.state = 'failed'; sample.error = failure;
      sample.errorDetail = { ...failureDetail(rawFailure, 'stream'), message: failure };
    } else if (!sample.finish) {
      sample.state = 'failed'; sample.error = '响应流意外结束，未收到完成标记';
      sample.errorDetail = { source: 'stream', message: sample.error, code: 'incomplete-stream', status: null, text: null, stack: null };
    } else { sample.state = truncated ? 'truncated' : 'complete'; sample.errorDetail = null; }
    this.refreshStage(run); this.touch(job);
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
