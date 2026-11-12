import { createStore } from 'zustand/vanilla';
import type { Evaluation, EvaluationsState, FingerprintJobView, FingerprintLimits, FingerprintOptions, FingerprintRecord, FingerprintRunView, Model, ModelIntelligenceTransport, Run } from '../types';
import { advanceCustomRun, applyFingerprintRun, cancelCustomRun, cancelFingerprint, configureFingerprint, createCustomRun, createFingerprintRun, failFingerprintRun, fingerprintValuesEqual, pollFingerprint, retryFingerprint, snapshotEvaluation, startFingerprint, terminal } from './evaluations.datasource';

const clock = (): number => typeof performance === 'undefined' ? Date.now() : performance.now();
const POLL_MS = 700;
const MAX_RETRY_MS = 10_000;
const CLEANUP_ATTEMPTS = 5;
// Mirrors the Host caps: a malformed or forged snapshot must never widen a job's runtime limits.
const MAX_CONCURRENCY = 6;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 1_800_000;
const LIMIT_FIELDS = ['maxConcurrency', 'maxConcurrentRequests', 'requestsPerModel', 'defaultConcurrency', 'defaultTimeoutMs', 'minTimeoutMs', 'maxTimeoutMs'] as const;
const retryDelay = (failures: number): number => Math.min(MAX_RETRY_MS, POLL_MS * 2 ** Math.min(failures, 5));
const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;
const modelKey = (provider: string, model: string): string => JSON.stringify([provider, model]);
function validLimits(value: unknown): value is FingerprintLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const limits = value as Record<string, unknown>;
  return LIMIT_FIELDS.every(field => {
    const limit = limits[field];
    return typeof limit === 'number' && Number.isFinite(limit);
  });
}

type FingerprintLifecycle = {
  recordId: string;
  models: Set<string>;
  jobId?: string;
  revision: number;
  ended: boolean;
  detached: boolean;
  cancelRequested: boolean;
  pollBusy: boolean;
  cancelBusy: boolean;
  pollFailures: number;
  cancelFailures: number;
  pollTimer?: ReturnType<typeof setTimeout>;
  cancelTimer?: ReturnType<typeof setTimeout>;
  connectionError?: string;
  cancellationError?: string;
  configurationError?: string;
  retryError?: string;
};

/** Owns evaluation facts: real Host fingerprint jobs and a separate custom-only simulation clock. */
export function createEvaluationsDomain(sessionId: string, transport: ModelIntelligenceTransport) {
  const store = createStore<EvaluationsState>(() => ({ records: [], runs: {} }));
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let previousTick = 0;
  const elapsedByRun = new Map<string, number>();
  // An object token identifies a launch, not just its record ID. Old replies cannot target a reused ID.
  const fingerprints = new Map<string, FingerprintLifecycle>();

  // ---- custom (simulated) ----
  function stop(): void { if (timer !== undefined) { clearInterval(timer); timer = undefined; } }
  function tick(): void {
    if (disposed) return;
    const now = clock();
    const delta = Math.max(0, now - previousTick);
    previousTick = now;
    const state = store.getState();
    let runs = state.runs;
    let active = false;
    for (const record of state.records) {
      if (record.kind !== 'custom') continue;
      record.runIds.forEach((id, index) => {
        const run = state.runs[id];
        if (!run || terminal(run.stage)) return;
        const elapsed = (elapsedByRun.get(id) ?? 0) + delta;
        elapsedByRun.set(id, elapsed);
        const next = advanceCustomRun(run, index, elapsed);
        if (next !== run) { if (runs === state.runs) runs = { ...state.runs }; runs[id] = next; }
        if (!terminal(next.stage)) active = true; else elapsedByRun.delete(id);
      });
    }
    if (runs !== state.runs) store.setState({ runs });
    if (!active) stop();
  }
  function stopIfNoCustomRuns(): void {
    const state = store.getState();
    if (!state.records.some(record => record.kind === 'custom' && record.runIds.some(id => state.runs[id] && !terminal(state.runs[id].stage)))) stop();
  }

  // ---- fingerprint (real) ----
  function current(life: FingerprintLifecycle): boolean {
    return !disposed && !life.detached && fingerprints.get(life.recordId) === life;
  }
  function clearPoll(life: FingerprintLifecycle): void {
    if (life.pollTimer !== undefined) clearTimeout(life.pollTimer);
    life.pollTimer = undefined;
  }
  function clearCancel(life: FingerprintLifecycle): void {
    if (life.cancelTimer !== undefined) clearTimeout(life.cancelTimer);
    life.cancelTimer = undefined;
  }
  // Configuration and retry failures stay distinct from transport (connection) and cancellation
  // feedback; a later successful action or a terminal snapshot clears the message it supersedes.
  function feedback(life: FingerprintLifecycle): string | undefined {
    return [life.cancelRequested && !life.ended ? life.cancellationError ?? '已请求取消，等待 Host 确认。' : undefined,
      life.connectionError, life.configurationError, life.retryError].filter(Boolean).join('\n') || undefined;
  }
  function publishFeedback(life: FingerprintLifecycle): void {
    if (!current(life)) return;
    const error = feedback(life);
    store.setState(state => {
      const record = state.records.find(item => item.id === life.recordId);
      if (!record?.fingerprint || record.fingerprint.error === error) return state;
      const fingerprint: FingerprintRecord = { ...record.fingerprint, error };
      return { records: state.records.map(item => item === record ? { ...record, fingerprint } : item) };
    });
  }
  function setBusy(life: FingerprintLifecycle, busy: FingerprintRecord['busy']): void {
    if (!current(life)) return;
    store.setState(state => {
      const record = state.records.find(item => item.id === life.recordId);
      if (!record?.fingerprint || record.fingerprint.busy === busy) return state;
      const fingerprint: FingerprintRecord = { ...record.fingerprint, busy };
      return { records: state.records.map(item => item === record ? { ...record, fingerprint } : item) };
    });
  }
  function markEnded(life: FingerprintLifecycle): void {
    life.ended = true;
    life.connectionError = undefined;
    life.cancellationError = undefined;
    life.configurationError = undefined;
    life.retryError = undefined;
    clearPoll(life); clearCancel(life);
  }

  /**
   * Validate and publish the whole Host snapshot in ONE transaction, matching provider + model.
   * `reopened` names the single model whose terminal run a Host retry legitimately re-queued.
   */
  function applyJob(life: FingerprintLifecycle, job: FingerprintJobView, reopened?: string): boolean {
    if (life.ended) return false;
    if (!job || job.id !== life.jobId || !Number.isSafeInteger(job.revision) || job.revision < 0
      || !['running', 'done', 'cancelled'].includes(job.status)) throw new Error('指纹任务响应标识或版本无效');
    if (job.revision <= life.revision) return false;
    if (!Array.isArray(job.runs) || !Array.isArray(job.challenges) || !job.reference) throw new Error('指纹任务响应格式无效');
    if (!Number.isInteger(job.concurrency) || job.concurrency < 1 || job.concurrency > MAX_CONCURRENCY
      || !Number.isInteger(job.timeoutMs) || job.timeoutMs < MIN_TIMEOUT_MS || job.timeoutMs > MAX_TIMEOUT_MS
      || !validLimits(job.limits)) throw new Error('指纹任务响应配置无效');
    const views = new Map<string, FingerprintRunView>();
    for (const view of job.runs) {
      if (!view || typeof view.provider !== 'string' || typeof view.model !== 'string' || !Array.isArray(view.samples)
        || (!terminal(view.stage) && !['queued', 'waiting-first-token', 'streaming', 'finalizing', 'analyzing'].includes(view.stage))) throw new Error('指纹模型响应格式无效');
      if (job.status !== 'running' && !terminal(view.stage)) throw new Error('指纹任务终止响应仍含执行中的模型');
      const key = modelKey(view.provider, view.model);
      if (!life.models.has(key) || views.has(key)) throw new Error('指纹模型响应与请求不匹配');
      views.set(key, view);
    }
    if (views.size !== life.models.size) throw new Error('指纹模型响应不完整');
    const state = store.getState();
    const record = current(life) ? state.records.find(item => item.id === life.recordId) : undefined;
    let runs = state.runs;
    if (record) {
      for (const runId of record.runIds) {
        const run = state.runs[runId];
        const key = run ? modelKey(run.model.provider, run.model.id) : undefined;
        const view = key === undefined ? undefined : views.get(key);
        if (!run || !view) throw new Error('指纹运行记录与响应不匹配');
        if (terminal(run.stage) && !terminal(view.stage) && key !== reopened) throw new Error('忽略回退到执行中的指纹响应');
        const next = applyFingerprintRun(run, view);
        if (next !== run) { if (runs === state.runs) runs = { ...state.runs }; runs[runId] = next; }
      }
    }
    // No mutation before every run projects successfully. A terminal snapshot latches the launch.
    life.revision = job.revision;
    life.connectionError = undefined;
    life.pollFailures = 0;
    if (job.status !== 'running') markEnded(life);
    if (record) {
      const fingerprint: FingerprintRecord = { ...record.fingerprint, jobId: job.id, status: job.status,
        concurrency: job.concurrency, timeoutMs: job.timeoutMs, limits: { ...job.limits },
        reference: { builtAt: job.reference.builtAt, sdk: job.reference.sdk }, challenges: job.challenges, error: feedback(life) };
      const records = fingerprintValuesEqual(record.fingerprint, fingerprint) ? state.records
        : state.records.map(item => item === record ? { ...record, fingerprint } : item);
      if (records !== state.records || runs !== state.runs) store.setState({ records, runs });
    }
    return true;
  }

  function failStart(life: FingerprintLifecycle, reason: string): void {
    if (!current(life)) return;
    markEnded(life);
    store.setState(state => {
      const record = state.records.find(item => item.id === life.recordId);
      if (!record?.fingerprint) return state;
      let runs = state.runs;
      for (const runId of record.runIds) {
        const run = state.runs[runId];
        if (run && !terminal(run.stage)) { if (runs === state.runs) runs = { ...state.runs }; runs[runId] = failFingerprintRun(run, reason); }
      }
      const fingerprint: FingerprintRecord = { ...record.fingerprint, status: 'failed', error: reason };
      return { runs, records: state.records.map(item => item === record ? { ...record, fingerprint } : item) };
    });
  }
  function pollFailed(life: FingerprintLifecycle, error: unknown): void {
    if (!current(life) || life.ended) return;
    life.pollFailures = Math.min(life.pollFailures + 1, 5);
    life.connectionError = `进度连接异常：${message(error, '连接中断')}；${retryDelay(life.pollFailures) / 1000} 秒后重试。Host 执行状态尚未确认。`;
    publishFeedback(life);
  }
  function schedulePoll(life: FingerprintLifecycle): void {
    if (!current(life) || life.ended || !life.jobId || life.pollBusy || life.pollTimer !== undefined) return;
    life.pollTimer = setTimeout(() => {
      life.pollTimer = undefined;
      if (!current(life) || life.ended || !life.jobId) return;
      life.pollBusy = true;
      void (async () => {
        try {
          const view = await pollFingerprint(transport, life.jobId!, life.revision);
          if (!current(life) || life.ended) return;
          if (!view || view.id !== life.jobId || !Number.isSafeInteger(view.revision) || view.revision < 0) throw new Error('指纹进度响应标识或版本无效');
          if ('unchanged' in view) {
            if (view.unchanged !== true || view.revision > life.revision) throw new Error('指纹进度缺少新版本快照');
            // An old unchanged response must not change facts or roll back our revision.
          } else applyJob(life, view);
          life.pollFailures = 0;
          life.connectionError = undefined;
          publishFeedback(life);
        } catch (error) { pollFailed(life, error); }
        finally { life.pollBusy = false; schedulePoll(life); }
      })();
    }, retryDelay(life.pollFailures));
  }

  function cancelFailed(life: FingerprintLifecycle, error: unknown): void {
    if (life.ended) return;
    life.cancelFailures += 1;
    life.cancellationError = `取消尚未确认：${message(error, '连接中断')}；正在重试，不能视为已取消。`;
    publishFeedback(life);
    // Cleanup cannot rely on a still-mounted record. Keep a bounded retry lease after removal
    // or disposal; if the transport is permanently gone, report the unacknowledged job explicitly.
    if (life.detached && life.cancelFailures >= CLEANUP_ATTEMPTS) {
      console.error(`[model-intelligence] Host cancellation unconfirmed for job ${life.jobId}; cleanup retries exhausted.`, error);
      return;
    }
    if (life.cancelTimer === undefined) {
      life.cancelTimer = setTimeout(() => { life.cancelTimer = undefined; sendCancel(life); }, retryDelay(life.cancelFailures));
    }
  }
  function sendCancel(life: FingerprintLifecycle): void {
    if (!life.jobId || life.ended || !life.cancelRequested || life.cancelBusy) return;
    clearCancel(life);
    life.cancelBusy = true;
    void (async () => {
      try {
        const job = await cancelFingerprint(transport, life.jobId!);
        if (life.ended) return;
        applyJob(life, job);
        if (!life.ended) throw new Error('Host 尚未返回任务终止确认');
      } catch (error) { cancelFailed(life, error); }
      finally { life.cancelBusy = false; schedulePoll(life); }
    })();
  }
  function requestCancel(life: FingerprintLifecycle): void {
    if (life.ended) return;
    life.cancelRequested = true;
    publishFeedback(life);
    sendCancel(life); // No ID yet: launchFingerprint resumes this exact intent on start response.
  }
  function detach(life: FingerprintLifecycle): void {
    life.detached = true;
    if (fingerprints.get(life.recordId) === life) fingerprints.delete(life.recordId);
    clearPoll(life);
    // Preserve any in-flight cancellation and its retry lease instead of issuing overlapping cancels.
    requestCancel(life);
  }
  function launchFingerprint(life: FingerprintLifecycle, models: Model[]): void {
    // Publication can synchronously trigger remove/reset/dispose. Do not start a new job afterward.
    if (!current(life)) return;
    void (async () => {
      try {
        const job = await startFingerprint(transport, models);
        // Capture the ID even if another response field is invalid, and even after dispose.
        if (!job || typeof job.id !== 'string' || !job.id) throw new Error('指纹任务未返回有效标识');
        life.jobId = job.id;
        if (!current(life)) { life.detached = true; life.cancelRequested = true; }
        try { applyJob(life, job); }
        catch (error) { pollFailed(life, error); }
        if (life.cancelRequested) sendCancel(life);
        schedulePoll(life);
      } catch (error) {
        if (!life.jobId) failStart(life, message(error, '指纹任务启动失败'));
        else { pollFailed(life, error); if (life.cancelRequested) sendCancel(life); schedulePoll(life); }
      }
    })();
  }

  /** A live, still-owned fingerprint launch that has a Host job ID. */
  function lookup(id: string): {record: Evaluation; life: FingerprintLifecycle; jobId: string} | undefined {
    if (disposed) return undefined;
    const record = store.getState().records.find(item => item.id === id);
    const life = fingerprints.get(id);
    if (!record || record.kind !== 'fingerprint' || !life || !current(life) || !life.jobId) return undefined;
    return { record, life, jobId: life.jobId };
  }

  /** Live, non-preemptive Host reconfiguration; the snapshot must carry the new revision itself. */
  function setFingerprintConfig(id: string, options: FingerprintOptions): void {
    const target = lookup(id);
    if (!target || target.record.fingerprint?.busy) return;
    const { life, jobId } = target;
    setBusy(life, 'configure');
    // A store subscriber may have removed/disposed the record synchronously; do not issue a Host call then.
    if (!current(life)) return;
    void (async () => {
      try {
        const job = await configureFingerprint(transport, jobId, options);
        if (!current(life)) return;
        applyJob(life, job);
        // Accepted by the Host (including an unchanged no-op): earlier action feedback is superseded.
        life.configurationError = undefined;
        life.retryError = undefined;
      } catch (error) {
        if (!current(life)) return;
        // A rejected or unconfirmed change is not a successful one: keep the last Host snapshot.
        life.configurationError = `配置更新失败：${message(error, 'Host 未接受配置变更')}`;
      }
      setBusy(life, undefined);
      publishFeedback(life);
    })();
  }

  /** Re-run only this model's failed samples; the Host may reopen a finished job. */
  function retryFailedSample(id: string, runId: string): void {
    const target = lookup(id);
    if (!target || target.record.fingerprint?.busy) return;
    const { life, jobId } = target;
    const run = store.getState().runs[runId];
    // The UI already gates the button; a missing run or no failed sample is not an error here.
    if (!run || run.testId !== id || !run.fingerprint?.samples.some(sample => sample.state === 'failed')) return;
    const model = { provider: run.model.provider, id: run.model.id };
    const key = modelKey(model.provider, model.id);
    setBusy(life, 'retry');
    // A store subscriber may have removed/disposed the record synchronously; do not issue a Host call then.
    if (!current(life)) return;
    void (async () => {
      try {
        const job = await retryFingerprint(transport, jobId, model);
        if (!current(life)) return;
        // A retry reopens the job (running, finishedAt null, newer revision). Drop the terminal
        // latch first, or the newer snapshot would be discarded as a late terminal write.
        const wasEnded = life.ended;
        life.ended = false;
        life.connectionError = undefined;
        life.cancellationError = undefined;
        try {
          if (applyJob(life, job, key)) schedulePoll(life);
          else if (wasEnded) life.ended = true;
        } catch (error) {
          if (wasEnded) life.ended = true;
          throw error;
        }
        // The Host accepted the retry: older configuration/retry feedback is superseded.
        life.configurationError = undefined;
        life.retryError = undefined;
      } catch (error) {
        if (!current(life)) return;
        life.retryError = `重试失败样本失败：${message(error, 'Host 未接受重试请求')}`;
      }
      setBusy(life, undefined);
      publishFeedback(life);
    })();
  }

  function cancel(id: string): void {
    if (disposed) return;
    const record = store.getState().records.find(item => item.id === id);
    if (!record) return;
    if (record.kind === 'fingerprint') {
      const life = fingerprints.get(id);
      if (life) requestCancel(life);
      return;
    }
    store.setState(state => {
      let runs = state.runs;
      for (const runId of record.runIds) {
        const old = runs[runId];
        if (!old) continue;
        const next = cancelCustomRun(old);
        elapsedByRun.delete(runId);
        if (next !== old) { if (runs === state.runs) runs = { ...runs }; runs[runId] = next; }
      }
      return runs === state.runs ? state : { runs };
    });
    stopIfNoCustomRuns();
  }

  return {
    store,
    submit(value: Evaluation, models: Model[]): Evaluation {
      const record = snapshotEvaluation(value.kind === 'fingerprint' ? { ...value, fingerprint: { status: 'starting', challenges: [] } } : value);
      if (disposed) return record;
      // Domain callers normally supply fresh IDs. Never overwrite another live record or run.
      const state = store.getState();
      if (state.records.some(item => item.id === record.id) || record.runIds.length !== models.length
        || new Set(record.runIds).size !== record.runIds.length || record.runIds.some(id => state.runs[id])) throw new Error('测试记录或运行标识重复/不完整');
      const runs: Record<string, Run> = Object.fromEntries(models.map((model, index) => {
        const id = record.runIds[index];
        return [id, record.kind === 'fingerprint' ? createFingerprintRun(id, record.id, sessionId, model) : createCustomRun(id, record.id, sessionId, model)];
      }));
      const life: FingerprintLifecycle | undefined = record.kind === 'fingerprint' ? {
        recordId: record.id, models: new Set(models.map(model => modelKey(model.provider, model.id))), revision: -1,
        ended: false, detached: false, cancelRequested: false, pollBusy: false, cancelBusy: false, pollFailures: 0, cancelFailures: 0,
      } : undefined;
      if (life) fingerprints.set(record.id, life);
      store.setState({ records: [record, ...state.records], runs: { ...state.runs, ...runs } });
      if (life) launchFingerprint(life, models);
      else if (!disposed && timer === undefined && store.getState().records.some(item => item === record)) { previousTick = clock(); timer = setInterval(tick, 120); }
      return record;
    },
    cancel,
    setFingerprintConfig,
    retryFailedSample,
    remove(id: string): void {
      if (disposed) return;
      const record = store.getState().records.find(item => item.id === id);
      if (!record) return;
      const life = fingerprints.get(id);
      if (life) detach(life);
      for (const runId of record.runIds) elapsedByRun.delete(runId);
      store.setState(state => { const runs = { ...state.runs }; for (const runId of record.runIds) delete runs[runId]; return { records: state.records.filter(item => item.id !== id), runs }; });
      stopIfNoCustomRuns();
    },
    reset(): void {
      if (disposed) return;
      for (const life of [...fingerprints.values()]) detach(life);
      stop(); elapsedByRun.clear(); store.setState({ records: [], runs: {} });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stop(); elapsedByRun.clear();
      for (const life of [...fingerprints.values()]) detach(life);
    },
  };
}
