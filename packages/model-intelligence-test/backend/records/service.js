import { randomUUID, createHash } from 'node:crypto';
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
  constructor(ctx, storage, engine) {
    this.ctx = ctx;
    this.storage = storage;
    this.engine = engine;
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
    if (!attempt) return;
    let view;
    try { view = this.engine.status(jobId); } catch { return; }
    const status = settled ? (view.status === 'cancelled' ? 'cancelled' : 'done') : 'running';
    await table.put(attemptId, { ...attempt, status, view, finishedAt: settled ? view.finishedAt ?? Date.now() : null });
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
    })) : [];
    if (!models.length || models.length > 64) throw new FingerprintError('invalid-models', '请选择 1–64 个有效模型');
    const record = {
      id: `rec-${randomUUID()}`, name: short(input.name, 120) || '未命名测试', kind, createdAt: Date.now(), models,
      options: clean(input.options ?? {}), prompt: kind === 'custom' ? String(input.prompt ?? '').slice(0, 200_000) : '',
      footerVersion: short(input.footerVersion, 40), preset: input.preset ? clean(input.preset) : null,
    };
    await records.put(record.id, record);
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
    const attempt = { id: `att-${randomUUID()}`, recordId: record.id, number, status: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null, jobId: null, view: null, error: null };
    await attempts.put(attempt.id, attempt);
    this.bump();
    if (!busy) await this.begin(attempt.id);
    return attempts.get(attempt.id);
  }

  async begin(attemptId) {
    const domain = await this.ready;
    const attempts = domain.table('attempts');
    const attempt = attempts.get(attemptId);
    const record = attempt && domain.table('records').get(attempt.recordId);
    if (!attempt || !record || attempt.status !== 'queued') return;
    try {
      const view = await this.engine.start(record.models.map(model => ({ provider: model.provider, id: model.id, ...(model.relay ? { relay: model.relay } : {}) })), record.options);
      this.byJob.set(view.id, attemptId);
      await attempts.put(attemptId, { ...attempts.get(attemptId), status: 'running', jobId: view.id, startedAt: Date.now(), view });
    } catch (error) {
      const message = error instanceof FingerprintError ? error.message : '指纹服务执行失败，请稍后重试。';
      await attempts.put(attemptId, { ...attempts.get(attemptId), status: 'failed', finishedAt: Date.now(), error: message });
      void this.startNextQueued(attemptId);
    }
    this.bump();
  }

  async startNextQueued(attemptId) {
    if (this.disposed) return;
    const domain = await this.ready;
    const recordId = domain.table('attempts').get(attemptId)?.recordId;
    if (!recordId) return;
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
      await domain.table('attempts').put(attemptId, { ...attempt, status: 'cancelled', finishedAt: Date.now() });
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
    if (record) await records.put(record.id, { ...record, options: { ...record.options, ...clean(options) } });
    if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.configure(attempt.jobId, options);
    this.bump();
    return this.attempt(attemptId);
  }
  async retry(attemptId, model) {
    const attempt = await this.liveJob(attemptId);
    if (!attempt.jobId || !this.engine.has(attempt.jobId)) throw new FingerprintError('expired', '该请求已不在内存中（运行时重启或已过期），请使用「再次请求」');
    this.engine.retry(attempt.jobId, model);
    const domain = await this.ready;
    await domain.table('attempts').put(attemptId, { ...domain.table('attempts').get(attemptId), status: 'running', finishedAt: null });
    this.bump();
    return this.attempt(attemptId);
  }

  async remove(recordId) {
    const domain = await this.domain();
    const attempts = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => item.recordId === recordId);
    for (const attempt of attempts) if (attempt.jobId && this.engine.has(attempt.jobId)) this.engine.cancel(attempt.jobId);
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
    await attempts.put(attempt.id, { ...attempt, status: snapshot?.ended ? 'done' : 'running', finishedAt: snapshot?.ended ? Date.now() : null, custom: { runs } });
    this.bump();
    return { attemptId: attempt.id };
  }

  // ---- partitions (favorites = default partition) -------------------------------------------
  static DEFAULT_PARTITION = 'favorites';
  itemKeyOf(partitionId, key) { return `${partitionId}-${createHash('sha1').update(key).digest('hex').slice(0, 20)}`; }

  async partitions() {
    const domain = await this.domain();
    const table = domain.table('partitions');
    if (!table.get(RecordsService.DEFAULT_PARTITION)) {
      await table.put(RecordsService.DEFAULT_PARTITION, { id: RecordsService.DEFAULT_PARTITION, name: '收藏', createdAt: 0, builtin: true });
    }
    const items = [...domain.table('partition_items').entries()].map(([, item]) => item);
    return {
      revision: this.revision,
      partitions: [...table.entries()].map(([, item]) => item).sort((a, b) => a.createdAt - b.createdAt)
        .map(partition => ({ ...partition, items: items.filter(item => item.partitionId === partition.id).sort((a, b) => a.addedAt - b.addedAt) })),
    };
  }
  async partitionSave(input) {
    const domain = await this.domain();
    const table = domain.table('partitions');
    const name = short(input?.name, 40);
    if (!name) throw new FingerprintError('invalid-partition', '分区名称不能为空');
    if (input?.id) {
      const current = table.get(input.id);
      if (!current) throw new FingerprintError('not-found', '分区不存在');
      await table.put(current.id, { ...current, name });
    } else {
      const id = `p-${randomUUID().slice(0, 12)}`;
      await table.put(id, { id, name, createdAt: Date.now(), builtin: false });
    }
    this.bump();
    return this.partitions();
  }
  async partitionDelete(partitionId) {
    if (partitionId === RecordsService.DEFAULT_PARTITION) throw new FingerprintError('builtin-partition', '收藏分区不能删除');
    const domain = await this.domain();
    const items = [...domain.table('partition_items').entries()].filter(([, item]) => item.partitionId === partitionId).map(([key]) => key);
    await domain.table('partition_items').deleteMany(items);
    await domain.table('partitions').delete(partitionId);
    this.bump();
    return this.partitions();
  }
  /** Add/remove/tag one relay channel in a partition. `item.key` is the relay row key. */
  async partitionItem(input) {
    const domain = await this.domain();
    const partitionId = short(input?.partitionId, 64) || RecordsService.DEFAULT_PARTITION;
    if (partitionId === RecordsService.DEFAULT_PARTITION) await this.partitions();
    if (!domain.table('partitions').get(partitionId)) throw new FingerprintError('not-found', '分区不存在');
    const item = input?.item;
    if (!item || typeof item.key !== 'string' || !item.key) throw new FingerprintError('invalid-item', '渠道参数无效');
    const table = domain.table('partition_items');
    const key = this.itemKeyOf(partitionId, item.key);
    if (input.remove) await table.delete(key);
    else {
      const current = table.get(key);
      const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map(tag => short(tag, 24)).filter(Boolean))].slice(0, 12) : current?.tags ?? [];
      await table.put(key, {
        ...(current ?? { addedAt: Date.now() }), key: item.key, partitionId, tags,
        siteId: short(item.siteId, 32), channelId: Number(item.channelId) || 0, model: short(item.model, 256), brand: short(item.brand, 64),
        supplier: short(item.supplier, 128), channelName: short(item.channelName, 128), testEndpoint: short(item.testEndpoint, 16),
        api: ['chat', 'responses', 'messages'].includes(input.api) ? input.api : current?.api ?? null,
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
    return { revision: this.revision, tags: document.tags && typeof document.tags === 'object' ? document.tags : {} };
  }
  async tagsSet(input) {
    const domain = await this.domain();
    const document = { ...(domain.global.get() ?? {}) };
    const tags = { ...(document.tags ?? {}) };
    const target = short(input?.target, 200);
    if (!target) return this.tags();
    const list = [...new Set((Array.isArray(input.tags) ? input.tags : []).map(tag => short(tag, 80)).filter(Boolean))].slice(0, 24);
    if (list.length) tags[target] = list; else delete tags[target];
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
}
