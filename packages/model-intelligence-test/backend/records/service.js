import { randomUUID } from 'node:crypto';
import { FingerprintError } from '../fingerprint/engine.js';

/**
 * Host-authoritative test records. A record pins *what* is tested (models / channels, options);
 * each execution is an attempt (`请求`) stored separately. Fingerprint attempts are executed by the
 * engine and their live view is persisted on a throttle; custom (simulated) attempts are
 * snapshots saved by the client. Everything is global to the runtime, not per chat session.
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
    ended: runs.filter(run => END_STAGE.has(run.stage)).length,
    completed: runs.filter(run => run.stage === 'completed').length,
    failed: runs.filter(run => run.stage === 'failed' || run.stage === 'timeout').length,
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
    this.timers = new Map();    // attemptId -> persistence timer
    this.disposed = false;
    this.ready = this.boot();
    this.ready.catch(() => {});
  }

  async boot() {
    const domain = await this.storage.records();
    // Attempts that were running when the runtime stopped can never resume: mark them interrupted.
    const attempts = domain.table('attempts');
    for (const [id, attempt] of [...attempts.entries()]) {
      if (!ACTIVE.has(attempt.status)) continue;
      await attempts.put(id, { ...attempt, status: 'interrupted', finishedAt: attempt.finishedAt ?? Date.now(), view: interrupt(attempt.view), jobId: null });
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
    this.timers.set(attemptId, setTimeout(() => { this.timers.delete(attemptId); void this.persistJob(attemptId, job.id); }, PERSIST_THROTTLE_MS));
  }
  onSettled(job) {
    const attemptId = this.byJob.get(job.id);
    if (!attemptId) return;
    clearTimeout(this.timers.get(attemptId)); this.timers.delete(attemptId);
    void this.persistJob(attemptId, job.id, true).then(() => this.startNextQueued(attemptId));
  }

  async persistJob(attemptId, jobId, settled = false) {
    if (this.disposed) return;
    const domain = await this.ready;
    const table = domain.table('attempts');
    const attempt = table.get(attemptId);
    if (!attempt || this.disposed || this.removing.has(attempt.recordId)) return;
    let view;
    try { view = this.engine.status(jobId); } catch { return; }
    const status = settled ? (view.status === 'cancelled' ? 'cancelled' : view.status === 'failed' ? 'failed' : 'done') : 'running';
    await this.put(domain, 'attempts', attemptId, { ...attempt, status, view, finishedAt: settled ? view.finishedAt ?? Date.now() : null });
    this.bump();
  }

  // ---- queries --------------------------------------------------------------------------------
  attemptSummary(attempt) {
    const live = attempt.jobId && this.engine.has(attempt.jobId) ? this.safeStatus(attempt.jobId) : null;
    const view = live ?? attempt.view;
    return {
      id: attempt.id, recordId: attempt.recordId, number: attempt.number, status: attempt.status,
      createdAt: attempt.createdAt, startedAt: attempt.startedAt ?? null, finishedAt: attempt.finishedAt ?? null,
      error: attempt.error ?? null, summary: view ? summaryOf(view) : null,
    };
  }
  safeStatus(jobId) { try { return this.engine.status(jobId); } catch { return null; } }

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
    const live = attempt.jobId && this.engine.has(attempt.jobId) ? this.engine.status(attempt.jobId, revision) : null;
    if (live?.unchanged) return { id: attempt.id, unchanged: true, revision: live.revision };
    const view = live ?? attempt.view ?? null;
    return { ...this.attemptSummary(attempt), view, custom: attempt.custom ?? null, revision: view?.revision ?? 0 };
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
    if (!models.length || models.length > 64) throw new FingerprintError('invalid-models', '请选择 1–64 个有效模型');
    const record = {
      id: `rec-${randomUUID()}`, name: short(input.name, 120) || '未命名测试', kind, createdAt: Date.now(), models,
      options: clean(input.options ?? {}), prompt: kind === 'custom' ? String(input.prompt ?? '').slice(0, 200_000) : '',
      footerVersion: short(input.footerVersion, 40), preset: input.preset ? clean(input.preset) : null,
      ...(input.a6api ? { a6api: clean(input.a6api) } : {}),
    };
    await this.put(domain, 'records', record.id, record);
    this.bump();
    const attempt = kind === 'fingerprint' ? await this.launch(record) : null;
    return { record, attemptId: attempt?.id ?? null };
  }

  /** Re-request with the record's fixed model set; queued behind a running attempt of the same record. */
  async rerun(recordId) {
    const domain = await this.domain();
    const record = domain.table('records').get(recordId);
    if (!record) throw new FingerprintError('not-found', '测试记录不存在');
    if (record.kind !== 'fingerprint') throw new FingerprintError('unsupported', '自定义任务请在前端重新运行');
    const attempt = await this.launch(record);
    return { attemptId: attempt.id };
  }

  async launch(record) {
    const domain = await this.ready;
    const attempts = domain.table('attempts');
    const existing = [...attempts.entries()].map(([, item]) => item).filter(item => item.recordId === record.id);
    const number = existing.reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const busy = existing.some(item => ACTIVE.has(item.status));
    const attempt = { id: `att-${randomUUID()}`, recordId: record.id, number, status: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null, jobId: null, view: null, error: null,
      ...(this.ledger && record.a6api ? { ledgerVersion: 1 } : {}) };
    await this.put(domain, 'attempts', attempt.id, attempt);
    this.bump();
    if (!busy) await this.begin(attempt.id);
    return attempts.get(attempt.id);
  }

  async begin(attemptId) {
    const domain = await this.ready;
    const attempts = domain.table('attempts');
    const attempt = attempts.get(attemptId);
    const record = attempt && domain.table('records').get(attempt.recordId);
    if (!attempt || !record || attempt.status !== 'queued' || this.disposed || this.removing.has(record.id)) return;
    try {
      const view = await this.engine.start(record.models.map(model => ({ provider: model.provider, id: model.id, ...(model.relay ? { relay: model.relay } : {}), ...(model.a6api ? { a6api: model.a6api } : {}) })), record.options, record.a6api ?? null, { recordId: record.id, attemptId });
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || !domain.table('records').get(record.id) || attempts.get(attemptId).status !== 'queued') {
        if (this.engine.has(view.id)) this.engine.cancel(view.id);
        return;
      }
      this.byJob.set(view.id, attemptId);
      await this.put(domain, 'attempts', attemptId, { ...attempts.get(attemptId), status: 'running', jobId: view.id, startedAt: Date.now(), view });
    } catch (error) {
      if (this.disposed || this.removing.has(record.id) || !attempts.get(attemptId) || attempts.get(attemptId).status !== 'queued') return;
      const message = error instanceof FingerprintError ? error.message : '指纹服务执行失败，请稍后重试。';
      await this.put(domain, 'attempts', attemptId, { ...attempts.get(attemptId), status: 'failed', finishedAt: Date.now(), error: message });
      void this.startNextQueued(attemptId);
    }
    this.bump();
  }

  async startNextQueued(attemptId) {
    if (this.disposed) return;
    const domain = await this.ready;
    const recordId = domain.table('attempts').get(attemptId)?.recordId;
    if (!recordId || this.disposed || this.removing.has(recordId)) return;
    const all = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => item.recordId === recordId);
    if (all.some(item => item.status === 'running')) return;
    const next = all.filter(item => item.status === 'queued').sort((a, b) => a.number - b.number)[0];
    if (next) await this.begin(next.id);
  }

  async liveJob(attemptId) {
    const domain = await this.domain();
    const attempt = domain.table('attempts').get(attemptId);
    if (!attempt) throw new FingerprintError('not-found', '请求不存在或已删除');
    return attempt;
  }

  async cancel(attemptId) {
    const attempt = await this.liveJob(attemptId);
    const domain = await this.ready;
    if (attempt.status === 'queued') {
      await this.put(domain, 'attempts', attemptId, { ...attempt, status: 'cancelled', finishedAt: Date.now() });
      this.bump();
    } else if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
    return this.attempt(attemptId);
  }
  async configure(attemptId, options) {
    const attempt = await this.liveJob(attemptId);
    const domain = await this.ready;
    const records = domain.table('records');
    const record = records.get(attempt.recordId);
    // Options are a record-level setting: future re-requests inherit the latest values.
    if (record) await this.put(domain, 'records', record.id, { ...record, options: { ...record.options, ...clean(options) } });
    if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.configure(attempt.jobId, options);
    this.bump();
    return this.attempt(attemptId);
  }
  async retry(attemptId, model) {
    const attempt = await this.liveJob(attemptId);
    if (!attempt.jobId || !this.engine.has(attempt.jobId)) throw new FingerprintError('expired', '该请求已不在内存中（运行时重启或已过期），请使用「再次请求」');
    this.engine.retry(attempt.jobId, model);
    const domain = await this.ready;
    await this.put(domain, 'attempts', attemptId, { ...domain.table('attempts').get(attemptId), status: 'running', finishedAt: null });
    this.bump();
    return this.attempt(attemptId);
  }

  async remove(recordId) {
    const domain = await this.domain();
    this.removing.add(recordId);
    await Promise.allSettled([...(this.writes.get(recordId) ?? [])]);
    const attempts = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => item.recordId === recordId);
    // Invalidate billing before aborting sampling, so its finally/late HTTP callbacks cannot write.
    await this.ledger?.removeRecord(recordId);
    for (const attempt of attempts) {
      clearTimeout(this.timers.get(attempt.id)); this.timers.delete(attempt.id);
      if (attempt.jobId) this.byJob.delete(attempt.jobId);
      if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
    }
    await domain.table('attempts').deleteMany(attempts.map(item => item.id));
    await domain.table('records').delete(recordId);
    this.bump();
    return { ok: true };
  }
  async clear() {
    const domain = await this.domain();
    for (const recordId of [...domain.table('records').keys()]) await this.remove(recordId);
    return { ok: true };
  }

  /** Custom (simulated) attempts: the client owns their lifecycle and saves terminal snapshots. */
  async saveCustom(recordId, snapshot) {
    const domain = await this.domain();
    const record = domain.table('records').get(recordId);
    if (!record || record.kind !== 'custom') throw new FingerprintError('not-found', '自定义测试记录不存在');
    const attempts = domain.table('attempts');
    const existing = [...attempts.entries()].map(([, item]) => item).find(item => item.recordId === recordId);
    const attempt = existing ?? { id: `att-${randomUUID()}`, recordId, number: 1, createdAt: Date.now(), startedAt: Date.now(), jobId: null, view: null, error: null };
    const runs = Array.isArray(snapshot?.runs) ? clean(snapshot.runs).slice(0, 64) : [];
    await this.put(domain, 'attempts', attempt.id, { ...attempt, status: snapshot?.ended ? 'done' : 'running', finishedAt: snapshot?.ended ? Date.now() : null, custom: { runs } });
    this.bump();
    return { attemptId: attempt.id };
  }

  async dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.writes.values()].flatMap(writes => [...writes]));
  }
}
