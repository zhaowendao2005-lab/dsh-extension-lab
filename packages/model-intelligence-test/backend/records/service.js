import { randomUUID } from 'node:crypto';
import { FingerprintError } from '../fingerprint/engine.js';

/**
 * Host-authoritative test records. A record pins *what* is tested (models / channels, options);
 * each execution is an attempt (`请求`) stored separately. Fingerprint attempts are executed by the
 * engine; custom attempts use isolated Host Agent sessions. Both persist authoritative snapshots. Everything is global to the runtime, not per chat session.
 */
const PERSIST_THROTTLE_MS = 1_500;
const MAX_RECORDS = 500;
const ACTIVE = new Set(['queued', 'running']);
const END_SAMPLE = new Set(['complete', 'truncated', 'failed', 'cancelled']);
const END_STAGE = new Set(['completed', 'failed', 'timeout', 'cancelled']);

const clean = value => JSON.parse(JSON.stringify(value ?? null));
const short = (text, max) => String(text ?? '').trim().slice(0, max);

function interrupt(view) {
  if (!view) return view;
  const copy = clean(view);
  copy.status = 'cancelled';
  copy.finishedAt = copy.finishedAt ?? Date.now();
  for (const run of copy.runs ?? []) {
    if (END_STAGE.has(run.stage)) continue;
    for (const sample of run.samples ?? []) {
      if (END_SAMPLE.has(sample.state)) continue;
      sample.state = 'cancelled';
      sample.error = '运行时重启，请求已中断';
      sample.errorDetail = { source: 'cancelled', message: sample.error, code: 'interrupted', status: null, text: null, stack: null };
    }
    run.stage = 'cancelled'; run.analysis = null;
  }
  return copy;
}

function summaryOf(view) {
  const runs = view?.runs ?? [];
  return {
    total: runs.length,
    ended: runs.filter(run => END_STAGE.has(run.stage ?? run.phase) || run.phase === 'interrupted').length,
    completed: runs.filter(run => (run.stage ?? run.phase) === 'completed').length,
    failed: runs.filter(run => ['failed', 'timeout', 'interrupted'].includes(run.stage ?? run.phase)).length,
  };
}

export class RecordsService {
  constructor(ctx, storage, engine, { ledger = engine.hooks?.ledger } = {}) {
    this.ctx = ctx;
    this.storage = storage;
    this.engine = engine;
    this.ledger = ledger;
    this.removing = new Set();
    this.writes = new Map();
    this.revision = 1;
    this.byJob = new Map();     // jobId -> attemptId
    this.launchLocks = new Map();
    this.starting = new Set();
    this.timers = new Map();    // attemptId -> persistence timer
    this.closing = false;
    this.disposed = false;
    this.ready = this.boot();
    this.ready.catch(() => {});
  }

  async boot() {
    const domain = await this.storage.records();
    // An interrupted attempt is never auto-dispatched. An eligible custom run may be resumed explicitly.
    const attempts = domain.table('attempts');
    for (const [id, attempt] of [...attempts.entries()]) {
      if (!ACTIVE.has(attempt.status)) continue;
      await attempts.put(id, { ...attempt, status: 'interrupted', finishedAt: attempt.finishedAt ?? Date.now(), view: interrupt(attempt.view), custom: attempt.custom ? { ...attempt.custom, runs: (attempt.custom.runs ?? []).map(run => ['completed','failed','cancelled','interrupted'].includes(run.phase) ? run : { ...run, phase: 'interrupted', finishedAt: Date.now(), error: {code:'interrupted', message:'运行时重启，会话已中断', phase:run.phase} }) } : undefined, jobId: null });
    }
    return domain;
  }

  async domain() {
    if (this.disposed) throw new FingerprintError('disposed', '插件正在卸载');
    return this.ready;
  }
  bump() { this.revision += 1; }

  async put(domain, table, id, value) {
    const recordId = table === 'records' ? id : value.recordId;
    if (this.disposed || this.removing.has(recordId)) return;
    const writes = this.writes.get(recordId) ?? new Set();
    this.writes.set(recordId, writes);
    const work = Promise.resolve().then(() => {
      if (this.disposed || this.removing.has(recordId)) return;
      return domain.table(table).put(id, value);
    });
    writes.add(work);
    try { return await work; } finally {
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
    this.timers.set(attemptId, setTimeout(() => { this.timers.delete(attemptId); void this.persistJob(attemptId, job.id).catch(() => {}); }, PERSIST_THROTTLE_MS));
  }
  onSettled(job) {
    const attemptId = this.byJob.get(job.id);
    if (!attemptId) return;
    clearTimeout(this.timers.get(attemptId)); this.timers.delete(attemptId);
    void this.persistJob(attemptId, job.id).then(() => this.startNextQueued(attemptId)).catch(() => {});
  }

  async persistJob(attemptId, jobId) {
    if (this.disposed) return;
    const domain = await this.ready;
    const table = domain.table('attempts');
    const recordId = table.get(attemptId)?.recordId;
    if (!recordId) return;
    await this.serializeLaunch(recordId, async () => {
      const attempt = table.get(attemptId);
      if (attempt?.jobId !== jobId || this.disposed || this.removing.has(recordId)) return;
      const view = this.safeStatus(jobId);
      if (!view) return;
      const status = ['cancelled', 'failed', 'done'].includes(view.status) ? view.status : 'running';
      await this.put(domain, 'attempts', attemptId, { ...attempt, status, ...(jobId.startsWith('custom-') ? {custom: {runs:view.runs, revision:view.revision}, view:null} : {view}), finishedAt: status === 'running' ? null : view.finishedAt ?? Date.now() });
      this.bump();
    });
  }

  // ---- queries --------------------------------------------------------------------------------
  attemptSummary(attempt) {
    const live = attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId) ? this.safeStatus(attempt.jobId) : null;
    const view = live ?? attempt.view ?? attempt.custom;
    return {
      id: attempt.id, recordId: attempt.recordId, number: attempt.number, status: attempt.status,
      createdAt: attempt.createdAt, startedAt: attempt.startedAt ?? null, finishedAt: attempt.finishedAt ?? null,
      error: attempt.error ?? null, summary: view ? summaryOf(view) : null,
    };
  }
  runner(jobId) { return jobId?.startsWith('custom-') ? this.custom : this.engine; }
  safeStatus(jobId) { try { return this.runner(jobId)?.status(jobId); } catch { return null; } }

  async list(revision) {
    const domain = await this.domain();
    if (revision === this.revision) return { revision: this.revision, unchanged: true };
    const attempts = [...domain.table('attempts').entries()].map(([, attempt]) => attempt);
    const records = [...domain.table('records').entries()].map(([, record]) => record)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(record => ({
        ...record,
        attempts: attempts.filter(attempt => attempt.recordId === record.id).sort((a, b) => a.number - b.number).map(attempt => this.attemptSummary(attempt)),
      }));
    return { revision: this.revision, records };
  }

  async attempt(attemptId, revision) {
    const domain = await this.domain();
    const attempt = domain.table('attempts').get(attemptId);
    if (!attempt) throw new FingerprintError('not-found', '请求不存在或已删除');
    const customAttempt = !!attempt.custom || attempt.jobId?.startsWith('custom-');
    const live = attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId) ? this.runner(attempt.jobId).status(attempt.jobId, customAttempt ? undefined : revision) : null;
    if (live?.unchanged) return { id: attempt.id, unchanged: true, revision: live.revision };
    const view = live ?? attempt.view ?? null;
    const isCustom = !!attempt.custom || attempt.jobId?.startsWith('custom-');
    let custom = isCustom ? (live ? {runs:live.runs,revision:live.revision} : attempt.custom) : null;
    if (custom && this.custom?.projectAttempt) custom = { ...custom, ...await this.custom.projectAttempt(attempt.id, custom.runs) };
    return { ...this.attemptSummary(attempt), view: isCustom ? null : view, custom, ...(custom ? {billingPending:custom.billingPending} : {}), revision: customAttempt ? this.revision : live?.revision ?? attempt.custom?.revision ?? view?.revision ?? 0 };
  }

  /**
   * Every persisted fingerprint / custom run bucketed by its `model|channelId` channel.
   * Read-only: persisted snapshots only, so results survive restarts. Shared by the per-channel
   * history and the key overview summary so both views always read the same facts.
   */
  async channelEntryMap() {
    const domain = await this.domain();
    const records = new Map([...domain.table('records').entries()]);
    const buckets = new Map();
    const at = attempt => attempt.finishedAt ?? attempt.startedAt ?? attempt.createdAt ?? null;
    const push = (model, channelId, entry) => {
      const key = `${model}|${channelId}`;
      const list = buckets.get(key);
      if (list) list.push(entry); else buckets.set(key, [entry]);
    };
    const base = (record, attempt, model, channelId) => ({
      recordId: record.id, recordName: record.name, recordKind: record.kind,
      attemptId: attempt.id, attemptNumber: attempt.number, status: attempt.status, at: at(attempt),
      model, channelId,
    });
    for (const attempt of domain.table('attempts').entries().map(([, value]) => value)) {
      const record = records.get(attempt.recordId);
      if (!record) continue;
      for (const run of attempt.view?.runs ?? []) {
        const channelId = Number(run.relay?.channelId);
        if (typeof run.model !== 'string' || !Number.isSafeInteger(channelId) || channelId <= 0) continue;
        const samples = Array.isArray(run.samples) ? run.samples : [];
        push(run.model, channelId, {
          ...base(record, attempt, run.model, channelId), runId: null,
          provider: run.provider ?? (record.a6api ? 'a6api' : null),
          fingerprint: {
            stage: run.stage ?? null,
            decision: run.analysis?.decision ?? null,
            probability: Number.isFinite(run.analysis?.probability) ? run.analysis.probability : null,
            predictionName: run.analysis?.predictionName ?? null,
            usedOutputs: run.analysis?.usedOutputs ?? null,
            samples: { total: samples.length, ended: samples.filter(sample => END_SAMPLE.has(sample.state)).length },
          },
          custom: null,
        });
      }
      for (const run of attempt.custom?.runs ?? []) {
        const channelId = Number(run.target?.channelId);
        const model = run.target?.modelId;
        if (typeof model !== 'string' || !model || !Number.isSafeInteger(channelId) || channelId <= 0) continue;
        push(model, channelId, {
          ...base(record, attempt, model, channelId), runId: run.id ?? null,
          provider: run.target?.providerId ?? (run.target?.kind === 'a6api' ? 'a6api' : null) ?? (record.a6api ? 'a6api' : null),
          fingerprint: null,
          custom: {
            phase: run.phase ?? null,
            outputState: run.output?.state ?? null,
            outputPath: run.output?.relativePath ?? null,
            inputTokens: run.usage?.inputTokens ?? null,
            outputTokens: run.usage?.outputTokens ?? null,
            cost: run.usage?.cost ?? null,
            ttftMs: run.metrics?.ttftMs ?? null,
            modelTokensPerSecond: run.metrics?.modelTokensPerSecond ?? null,
            error: run.error?.message ?? null,
          },
        });
      }
    }
    for (const list of buckets.values()) list.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return buckets;
  }

  /**
   * Historical runs of one model channel across every record and attempt.
   * Read-only: persisted snapshots only, so results survive restarts.
   */
  async channelTests({ model, channelId, limit = 20 } = {}) {
    const cap = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.floor(Number(limit)))) : 20;
    const buckets = await this.channelEntryMap();
    const entries = buckets.get(`${model}|${channelId}`) ?? [];
    return { model, channelId, total: entries.length, entries: entries.slice(0, cap) };
  }

  /**
   * One batch summary per requested channel so the key overview can show record counts and the
   * latest result without opening every channel. Keys are `model|channelId`; missing channels get
   * `{total: 0, latest: null}` rather than being omitted.
   */
  async channelTestSummaries(channels = []) {
    const wanted = channels
      .filter(channel => typeof channel?.model === 'string' && channel.model && Number.isSafeInteger(Number(channel?.channelId)) && Number(channel.channelId) > 0)
      .map(channel => ({ model: channel.model, channelId: Number(channel.channelId) }));
    const buckets = wanted.length ? await this.channelEntryMap() : new Map();
    const tests = {};
    for (const { model, channelId } of wanted) {
      // Same key the client uses for one channel (`channelTestKey` = JSON [model, channelId]).
      const key = JSON.stringify([model, channelId]);
      if (key in tests) continue;
      const entries = buckets.get(`${model}|${channelId}`) ?? [];
      tests[key] = { total: entries.length, latest: entries[0] ?? null };
    }
    return { tests, generatedAt: Date.now() };
  }

  // ---- mutations ------------------------------------------------------------------------------
  async create(input) {
    const domain = await this.domain();
    const records = domain.table('records');
    if ([...records.keys()].length >= MAX_RECORDS) throw new FingerprintError('too-many-records', `测试记录已达 ${MAX_RECORDS} 条，请先删除旧记录`);
    const kind = input?.kind === 'custom' ? 'custom' : 'fingerprint';
    const models = Array.isArray(input?.models) ? input.models.map(model => ({
      provider: short(model.provider, 128), id: short(model.id, 256), name: short(model.name || model.id, 256),
      ...(model.relay ? { relay: clean(model.relay) } : {}),
      ...(model.a6api ? { a6api: clean(model.a6api) } : {}),
    })) : [];
    if (models.some(model => model.a6api || model.relay) && !input.a6api) throw new FingerprintError('invalid-source', '渠道目标必须从专项入口创建');
    if (!models.length || models.length > 64) throw new FingerprintError('invalid-models', '请选择 1–64 个有效模型');
    const record = {
      id: `rec-${randomUUID()}`, name: short(input.name, 120) || '未命名测试', kind, createdAt: Date.now(), models,
      options: clean(input.options ?? {}), prompt: kind === 'custom' ? String(input.prompt ?? '').slice(0, 200_000) : '',
      footerVersion: short(input.footerVersion, 40), preset: input.preset ? clean(input.preset) : null,
      ...(input.a6api ? { a6api: clean(input.a6api) } : {}),
    };
    await this.put(domain, 'records', record.id, record);
    this.bump();
    const attempt = await this.launch(record);
    return { record, attemptId: attempt?.id ?? null };
  }

  /** Re-request with the record's fixed model set; queued behind a running attempt of the same record. */
  async rerun(recordId) {
    const domain = await this.domain();
    const record = domain.table('records').get(recordId);
    if (!record) throw new FingerprintError('not-found', '测试记录不存在');
    const attempt = await this.launch(record);
    return { attemptId: attempt.id };
  }

  /** Rename a saved record without touching its attempts or historical snapshots. */
  async rename(recordId, name) {
    const domain = await this.domain();
    const record = domain.table('records').get(recordId);
    if (!record) throw new FingerprintError('not-found', '测试记录不存在或已删除');
    const next = typeof name === 'string' ? short(name, 120) : '';
    if (!next) throw new FingerprintError('invalid-name', '测试记录名称不能为空');
    await this.put(domain, 'records', recordId, { ...record, name: next });
    this.bump();
    return domain.table('records').get(recordId);
  }

  async serializeLaunch(recordId, action) {
    const previous = this.launchLocks.get(recordId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.launchLocks.set(recordId, current);
    try { return await current; }
    finally { if (this.launchLocks.get(recordId) === current) this.launchLocks.delete(recordId); }
  }

  async launch(record) {
    if (this.closing) throw new FingerprintError('disposed', '插件正在卸载');
    return this.serializeLaunch(record.id, async () => {
      const domain = await this.domain();
      if (this.closing || this.removing.has(record.id) || !domain.table('records').get(record.id)) throw new FingerprintError('not-found', '测试记录不存在或正在关闭');
      const attempts = domain.table('attempts');
      const existing = [...attempts.entries()].map(([, item]) => item).filter(item => item.recordId === record.id);
      const number = existing.reduce((max, item) => Math.max(max, item.number), 0) + 1;
      const busy = existing.some(item => ACTIVE.has(item.status));
    const attempt = { id: `att-${randomUUID()}`, recordId: record.id, number, status: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null, jobId: null, view: null, error: null,
        ...(record.kind === 'custom' ? {models:clean(record.models), ...(record.a6api?.selectionId && !record.a6api.sourceRecordId ? {intakeSelectionId: record.a6api.selectionId} : {})} : {}),
        ...(this.ledger && record.a6api ? { ledgerVersion: 1 } : {}) };
      await this.put(domain, 'attempts', attempt.id, attempt);
      this.bump();
      if (!busy) await this.begin(attempt.id);
      return attempts.get(attempt.id);
    });
  }

  async begin(attemptId) {
    const domain = await this.ready;
    const attempts = domain.table('attempts');
    const attempt = attempts.get(attemptId);
    if (this.starting.has(attemptId)) return;
    const source = attempt && domain.table('records').get(attempt.recordId);
    const record = source && attempt.models ? {...source, models:attempt.models} : source;
    if (!attempt || !record || attempt.status !== 'queued' || this.closing || this.disposed || this.removing.has(record.id)) return;
    this.starting.add(attemptId);
    try {
      const view = record.kind === 'custom' ? await this.custom.start(record, attempt) : await this.engine.start(record.models.map(model => ({ provider: model.provider, id: model.id, ...(model.relay ? { relay: model.relay } : {}), ...(model.a6api ? { a6api: model.a6api } : {}) })), record.options, record.a6api ?? null, { recordId: record.id, attemptId });
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || !domain.table('records').get(record.id) || attempts.get(attemptId).status !== 'queued') {
        if (this.runner(view.id)?.has(view.id)) this.runner(view.id).cancel(view.id);
        return;
      }
      this.byJob.set(view.id, attemptId);
      await this.put(domain, 'attempts', attemptId, { ...attempts.get(attemptId), status: 'running', jobId: view.id, startedAt: Date.now(), ...(record.kind === 'custom' ? {custom:{runs:view.runs,revision:view.revision},view:null} : {view}) });
      if (record.kind === 'custom') this.custom.activate(view.id);
    } catch (error) {
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || attempts.get(attemptId).status !== 'queued') return;
      const message = error instanceof FingerprintError ? error.message : record.kind === 'custom' ? '自定义会话启动失败，请检查运行时配置。' : '指纹服务执行失败，请稍后重试。';
      await this.put(domain, 'attempts', attemptId, { ...attempts.get(attemptId), status: 'failed', finishedAt: Date.now(), error: message });
      void this.startNextQueued(attemptId);
    } finally {
      this.starting.delete(attemptId);
      this.bump();
    }
  }

  async startNextQueued(attemptId) {
    if (this.closing || this.disposed) return;
    const domain = await this.ready;
    const recordId = domain.table('attempts').get(attemptId)?.recordId;
    if (!recordId || this.disposed || this.removing.has(recordId)) return;
    await this.serializeLaunch(recordId, async () => {
      const all = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => item.recordId === recordId);
      if (all.some(item => ACTIVE.has(item.status) && item.status !== 'queued')) return;
      const next = all.filter(item => item.status === 'queued').sort((a, b) => a.number - b.number)[0];
      if (next) await this.begin(next.id);
    });
  }

  async liveJob(attemptId) {
    const domain = await this.domain();
    const attempt = domain.table('attempts').get(attemptId);
    if (!attempt) throw new FingerprintError('not-found', '请求不存在或已删除');
    return attempt;
  }

  async customMutation(attemptId, action) {
    const initial = await this.liveJob(attemptId);
    return this.serializeLaunch(initial.recordId, async () => {
      const domain = await this.domain();
      const attempt = domain.table('attempts').get(attemptId);
      const source = domain.table('records').get(initial.recordId);
      if (this.closing || this.removing.has(initial.recordId) || !attempt || source?.kind !== 'custom') throw new FingerprintError('not-found', '自定义测试轮次不可用');
      return action(domain, attempt, { ...source, models: attempt.models ?? source.models });
    });
  }
  /** Shared by continue and in-place retry: one runnable run re-enters its original attempt. */
  async requeueCustomRun(attemptId, runId, method) {
    return this.customMutation(attemptId, async (domain, attempt, record) => {
      const attempts = domain.table('attempts');
      if ([...attempts.entries()].some(([, item]) => item.recordId === record.id && item.id !== attemptId && item.status === 'running')) {
        throw new FingerprintError('task-busy', '该记录的另一个轮次正在运行，请先等待它结束');
      }
      return this.custom[method]({ record, attempt, runId, bind: async (jobId, runs, revision) => {
        if (this.closing) throw new FingerprintError('disposed', '插件正在卸载');
        await this.put(domain, 'attempts', attemptId, { ...attempt, status: 'running', finishedAt: null, jobId, view: null, custom: { runs, revision } });
        if (attempt.jobId && attempt.jobId !== jobId) this.byJob.delete(attempt.jobId);
        clearTimeout(this.timers.get(attemptId)); this.timers.delete(attemptId);
        this.byJob.set(jobId, attemptId);
        this.bump();
      } });
    });
  }
  /** The run died mid-session: resume the same DSH session and sandbox with `continue`. */
  continueCustomRun({ attemptId, runId }) { return this.requeueCustomRun(attemptId, runId, 'continueRun'); }
  /** The run died before it could be resumed: restart it in place with a fresh session, like fingerprint retry. */
  retryCustomRun({ attemptId, runId }) { return this.requeueCustomRun(attemptId, runId, 'rerunRun'); }
  async cancelCustomRun({ attemptId, runId }) {
    return this.customMutation(attemptId, (_domain, attempt) => this.custom.cancelRun({ attemptId, runId, jobId: attempt.jobId }));
  }

  async cancel(attemptId) {
    const initial = await this.liveJob(attemptId);
    await this.serializeLaunch(initial.recordId, async () => {
      const domain = await this.domain();
      const attempt = domain.table('attempts').get(attemptId);
      if (!attempt || this.closing || this.removing.has(initial.recordId)) return;
      if (attempt.status === 'queued') {
        await this.put(domain, 'attempts', attemptId, { ...attempt, status: 'cancelled', finishedAt: Date.now() });
        this.bump(); void this.startNextQueued(attemptId);
      } else if (attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId)) this.runner(attempt.jobId).cancel(attempt.jobId);
    });
    return this.attempt(attemptId);
  }
  async configure(attemptId, options) {
    const initial = await this.liveJob(attemptId);
    await this.serializeLaunch(initial.recordId, async () => {
      const domain = await this.domain();
      const attempt = domain.table('attempts').get(attemptId);
      const records = domain.table('records');
      const record = records.get(initial.recordId);
      if (this.closing || !attempt || !record || this.removing.has(record.id)) throw new FingerprintError('not-found', '测试轮次不可用');
      await this.put(domain, 'records', record.id, { ...record, options: { ...record.options, ...clean(options) } });
      if (attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId)) this.runner(attempt.jobId).configure(attempt.jobId, options);
      this.bump();
    });
    return this.attempt(attemptId);
  }
  async retry(attemptId, model) {
    const attempt = await this.liveJob(attemptId);
    const record = (await this.ready).table('records').get(attempt.recordId);
    if (record?.kind === 'custom') {
      // Legacy model-addressed retry: resolve the single failed run and retry it in place.
      const runs = (attempt.custom?.runs ?? []).filter(run => run.target?.providerId === model.provider && run.target?.modelId === model.id && ['failed','cancelled','interrupted'].includes(run.phase));
      if (runs.length !== 1) throw new FingerprintError('invalid-model', '模型不属于该轮次或渠道身份不唯一，请从具体渠道行重试');
      await this.retryCustomRun({ attemptId, runId: runs[0].id });
      return this.attempt(attemptId);
    }
    // A finished attempt keeps its view on disk after a runtime restart; rebuild that job on demand
    // so retry keeps its meaning (re-sample only the failed challenges of one model).
    let live = Boolean(attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId));
    if (!live && attempt.jobId && attempt.view && ['done', 'failed'].includes(attempt.status)) {
      try {
        await this.engine.restore(attempt.view, { recordId: attempt.recordId, attemptId }, record?.a6api ?? null);
        this.byJob.set(attempt.jobId, attemptId);
        live = true;
      } catch { /* fall through to the expired error below */ }
    }
    if (!live) throw new FingerprintError('expired', '该请求已不在内存中（运行时重启或已过期），请使用「再次请求」');
    this.engine.retry(attempt.jobId, model);
    const domain = await this.ready;
    await this.put(domain, 'attempts', attemptId, { ...domain.table('attempts').get(attemptId), status: 'running', finishedAt: null });
    this.bump();
    return this.attempt(attemptId);
  }

  async remove(recordId) {
    return this.serializeLaunch(recordId, async () => {
      const domain = await this.domain();
      if (this.closing) throw new FingerprintError('disposed', '插件正在卸载');
      if (!domain.table('records').get(recordId)) return { ok: true };
      this.removing.add(recordId);
      try {
        await Promise.allSettled([...(this.writes.get(recordId) ?? [])]);
        const attempts = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => item.recordId === recordId);
        await this.custom?.removeRecord(recordId);
        // Invalidate billing before aborting sampling, so its finally/late HTTP callbacks cannot write.
        await this.ledger?.removeRecord(recordId);
        for (const attempt of attempts) {
          clearTimeout(this.timers.get(attempt.id)); this.timers.delete(attempt.id);
          if (attempt.jobId) this.byJob.delete(attempt.jobId);
          if (attempt.jobId && this.runner(attempt.jobId)?.has(attempt.jobId)) this.runner(attempt.jobId).cancel(attempt.jobId);
        }
        await domain.table('attempts').deleteMany(attempts.map(item => item.id));
        await domain.table('records').delete(recordId);
        this.bump();
        return { ok: true };
      } catch (error) {
        this.removing.delete(recordId);
        throw error;
      }
    });
  }
  async clear() {
    const domain = await this.domain();
    for (const recordId of [...domain.table('records').keys()]) await this.remove(recordId);
    return { ok: true };
  }

  async saveCustom() { throw new FingerprintError('unsupported', '自定义测试状态由 Host 管理，客户端快照写入已停用'); }

  async dispose() {
    this.closing = true;
    this.custom?.stopScheduling();
    await this.ready.catch(() => {});
    await Promise.allSettled([...this.launchLocks.values()]);
    await this.custom?.dispose();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.launchLocks.values()]);
    this.disposed = true;
    await Promise.allSettled([...this.writes.values()].flatMap(writes => [...writes]));
  }
}
