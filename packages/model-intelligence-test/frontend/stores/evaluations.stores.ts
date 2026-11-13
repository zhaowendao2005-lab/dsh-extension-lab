import { createStore } from 'zustand/vanilla';
import type { AttemptSummary, AttemptViewResult, Evaluation, EvaluationsState, FingerprintOptions, FingerprintRecord, ModelIntelligenceTransport, Preset, RecordModelRef, Run, StoredRecord, TestKind } from '../types';
import {
  advanceCustomRun, applyFingerprintRun, cancelAttempt, cancelCustomRun, clearRecords, configureAttempt, createCustomRun, createFingerprintRun, createRecord,
  deleteRecord, failFingerprintRun, listRecords, modelOfRef, readAttempt, rerunRecord, retryAttempt, saveCustomAttempt, terminal,
} from './evaluations.datasource';

const clock = (): number => typeof performance === 'undefined' ? Date.now() : performance.now();
const ACTIVE_POLL_MS = 800;
const IDLE_POLL_MS = 4_000;
const MAX_RETRY_MS = 10_000;
const SESSION = 'global';
const ACTIVE = new Set<AttemptSummary['status']>(['queued', 'running']);
const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;
const STATUS: Record<AttemptSummary['status'], FingerprintRecord['status']> = {
  queued: 'starting', running: 'running', done: 'done', cancelled: 'cancelled', failed: 'failed', interrupted: 'cancelled',
};

type AttemptEntry = {
  revision: number;
  /** Last full Host answer for this attempt. */
  result?: Exclude<AttemptViewResult, {unchanged: true}>;
  loading: boolean;
  /** Status from the records list when the cached result was taken; a change forces a reload. */
  seenStatus?: AttemptSummary['status'];
  busy?: FingerprintRecord['busy'];
  error?: string;
};
type CustomSim = { recordId: string; attemptId: string; runs: Run[]; elapsed: number[]; saving: boolean };

export interface CreateRecordInput { kind: TestKind; name: string; models: RecordModelRef[]; options?: FingerprintOptions; prompt?: string; footerVersion?: string; preset?: Preset | null }

/**
 * Global, Host-persisted evaluation records. The Host owns records and attempts (请求); this domain
 * mirrors the list, loads the selected attempt of every watched record, polls active ones and
 * projects them into Run rows. Custom tasks are still simulated locally; their snapshots persist.
 */
export function createEvaluationsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<EvaluationsState>(() => ({ records: [], runs: {}, loaded: false }));
  let disposed = false;
  let stored: StoredRecord[] = [];
  let listRevision = -1;
  let listBusy = false;
  let failures = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let simTimer: ReturnType<typeof setInterval> | undefined;
  let previousTick = 0;
  const selected = new Map<string, string>();
  const entries = new Map<string, AttemptEntry>();
  const watched = new Set<string>();
  const sims = new Map<string, CustomSim>();

  // ---- projection -------------------------------------------------------------------------------
  function attemptOf(record: StoredRecord): AttemptSummary | undefined {
    const chosen = selected.get(record.id);
    const found = record.attempts.find(attempt => attempt.id === chosen);
    if (found) return found;
    // A just-started custom simulation exists before the next list sync carries its attempt.
    const sim = sims.get(record.id);
    if (sim && sim.attemptId === chosen) return { id: sim.attemptId, recordId: record.id, number: 1, status: 'running', createdAt: Date.now(), startedAt: Date.now(), finishedAt: null, error: null, summary: null };
    return record.attempts[record.attempts.length - 1];
  }
  function runIdsOf(record: StoredRecord, attempt?: AttemptSummary): string[] {
    const prefix = attempt?.id ?? `${record.id}:none`;
    return record.models.map((_, index) => `${prefix}:${index}`);
  }
  function fingerprintOf(record: StoredRecord, attempt: AttemptSummary | undefined, entry: AttemptEntry | undefined): FingerprintRecord {
    const view = entry?.result?.view ?? null;
    const status: FingerprintRecord['status'] = attempt ? STATUS[attempt.status] : 'failed';
    const errors = [attempt?.status === 'interrupted' ? '运行时重启，请求已中断' : null, attempt?.error ?? null, entry?.error ?? null].filter(Boolean);
    return {
      status, challenges: view?.challenges ?? [],
      ...(view ? { jobId: view.id, reference: { builtAt: view.reference.builtAt, sdk: view.reference.sdk }, concurrency: view.concurrency, timeoutMs: view.timeoutMs, limits: { ...view.limits } }
        : { concurrency: record.options?.concurrency, timeoutMs: record.options?.timeoutMs }),
      ...(entry?.busy ? { busy: entry.busy } : {}),
      ...(errors.length ? { error: errors.join('\n') } : {}),
      ...(!attempt ? { error: '这条记录还没有请求' } : {}),
    };
  }
  function projectRuns(record: StoredRecord, attempt: AttemptSummary | undefined, entry: AttemptEntry | undefined, previous: Record<string, Run>, next: Record<string, Run>): void {
    const ids = runIdsOf(record, attempt);
    const sim = sims.get(record.id);
    if (record.kind === 'custom') {
      if (sim && attempt && sim.attemptId === attempt.id) { sim.runs.forEach((run, index) => { next[ids[index]] = run; }); return; }
      const saved = (entry?.result?.custom?.runs ?? []) as Run[];
      record.models.forEach((ref, index) => {
        const id = ids[index];
        const old = previous[id];
        const snapshot = saved[index];
        if (old) { next[id] = old; return; }
        const base = snapshot && typeof snapshot === 'object' ? { ...snapshot, id, testId: record.id, sessionId: SESSION } : createCustomRun(id, record.id, SESSION, modelOfRef(ref));
        next[id] = attempt?.status === 'interrupted' && !terminal(base.stage) ? cancelCustomRun(base) : base;
      });
      return;
    }
    const view = entry?.result?.view ?? null;
    record.models.forEach((ref, index) => {
      const id = ids[index];
      let run = previous[id] ?? createFingerprintRun(id, record.id, SESSION, modelOfRef(ref));
      const runView = view?.runs.find(item => item.provider === ref.provider && item.model === ref.id);
      if (runView) run = applyFingerprintRun(run, runView);
      else if (attempt && (attempt.status === 'failed' || attempt.status === 'interrupted' || attempt.status === 'cancelled') && !terminal(run.stage)) {
        run = failFingerprintRun(run, attempt.error ?? (attempt.status === 'cancelled' ? '请求已取消' : '运行时重启，请求已中断'));
      }
      next[id] = run;
    });
  }
  function rebuild(): void {
    if (disposed) return;
    const state = store.getState();
    const runs: Record<string, Run> = {};
    const records: Evaluation[] = stored.map(record => {
      const attempt = attemptOf(record);
      const entry = attempt ? entries.get(attempt.id) : undefined;
      projectRuns(record, attempt, entry, state.runs, runs);
      const old = state.records.find(item => item.id === record.id);
      const value: Evaluation = {
        id: record.id, name: record.name, kind: record.kind, createdAt: record.createdAt, prompt: record.prompt, footerVersion: record.footerVersion,
        ...(record.preset ? { preset: record.preset } : {}), runIds: runIdsOf(record, attempt), attempts: record.attempts, models: record.models,
        options: record.options ?? {}, ...(attempt ? { attemptId: attempt.id } : {}),
        ...(record.kind === 'fingerprint' ? { fingerprint: fingerprintOf(record, attempt, entry) } : {}),
      };
      return old && JSON.stringify(old) === JSON.stringify(value) ? old : value;
    });
    const sameRecords = records.length === state.records.length && records.every((item, index) => item === state.records[index]);
    const runKeys = Object.keys(runs);
    const sameRuns = runKeys.length === Object.keys(state.runs).length && runKeys.every(key => state.runs[key] === runs[key]);
    if (!sameRecords || !sameRuns || !state.loaded) store.setState({ records: sameRecords ? state.records : records, runs: sameRuns ? state.runs : runs, loaded: true, error: state.error });
  }
  function setError(error: string | undefined): void {
    if (store.getState().error !== error) store.setState({ error });
  }

  // ---- Host synchronisation ---------------------------------------------------------------------
  function needsAttempt(record: StoredRecord): AttemptSummary | undefined {
    if (!watched.has(record.id)) return undefined;
    const attempt = attemptOf(record);
    if (!attempt) return undefined;
    const entry = entries.get(attempt.id);
    if (!entry || entry.loading) return entry ? undefined : attempt;
    if (sims.get(record.id)?.attemptId === attempt.id) return undefined;
    if (ACTIVE.has(attempt.status) || entry.seenStatus !== attempt.status) return attempt;
    return undefined;
  }
  async function loadAttempt(attempt: AttemptSummary): Promise<void> {
    const entry = entries.get(attempt.id) ?? { revision: -1, loading: false };
    entries.set(attempt.id, entry);
    if (entry.loading) return;
    entry.loading = true;
    try {
      const result = await readAttempt(transport, attempt.id, entry.seenStatus === attempt.status ? entry.revision : -1);
      if (disposed) return;
      if (!('unchanged' in result)) { entry.result = result; entry.revision = result.revision; }
      entry.seenStatus = attempt.status;
      entry.error = undefined;
    } catch (error) {
      entry.error = `请求详情读取失败：${message(error, '连接中断')}`;
    } finally { entry.loading = false; }
  }
  async function sync(): Promise<void> {
    if (disposed || listBusy) return;
    listBusy = true;
    try {
      const list = await listRecords(transport, listRevision);
      if (disposed) return;
      if (!('unchanged' in list)) {
        if (!Array.isArray(list.records)) throw new Error('测试记录响应格式无效');
        stored = list.records;
        listRevision = list.revision;
        const live = new Set(stored.flatMap(record => record.attempts.map(attempt => attempt.id)));
        for (const id of [...entries.keys()]) if (!live.has(id)) entries.delete(id);
        for (const [recordId, attemptId] of [...selected]) if (!live.has(attemptId)) selected.delete(recordId);
      }
      await Promise.all(stored.map(needsAttempt).filter((item): item is AttemptSummary => Boolean(item)).map(loadAttempt));
      failures = 0;
      setError(undefined);
    } catch (error) {
      failures = Math.min(failures + 1, 5);
      setError(`测试记录同步失败：${message(error, '连接中断')}，稍后自动重试。`);
    } finally {
      listBusy = false;
      rebuild();
    }
  }
  function schedule(delay?: number): void {
    if (disposed) return;
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    const active = stored.some(record => record.attempts.some(attempt => ACTIVE.has(attempt.status)));
    const wait = delay ?? (failures ? Math.min(MAX_RETRY_MS, ACTIVE_POLL_MS * 2 ** failures) : active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    pollTimer = setTimeout(() => { pollTimer = undefined; void sync().finally(() => schedule()); }, wait);
  }
  function refreshSoon(): void { schedule(0); }

  // ---- custom simulation ------------------------------------------------------------------------
  function stopSim(): void { if (simTimer !== undefined) { clearInterval(simTimer); simTimer = undefined; } }
  function persistSim(sim: CustomSim, ended: boolean): void {
    if (sim.saving && !ended) return;
    sim.saving = true;
    void saveCustomAttempt(transport, sim.recordId, ended, sim.runs).catch(error => setError(`自定义测试保存失败：${message(error, '连接中断')}`))
      .finally(() => { sim.saving = false; if (ended) { sims.delete(sim.recordId); entries.delete(sim.attemptId); refreshSoon(); } });
  }
  function tick(): void {
    if (disposed) return;
    const now = clock();
    const delta = Math.max(0, now - previousTick);
    previousTick = now;
    let changed = false;
    for (const sim of sims.values()) {
      let active = false;
      sim.runs = sim.runs.map((run, index) => {
        if (terminal(run.stage)) return run;
        sim.elapsed[index] += delta;
        const next = advanceCustomRun(run, index, sim.elapsed[index]);
        if (next !== run) changed = true;
        if (!terminal(next.stage)) active = true;
        return next;
      });
      if (!active && !sim.saving) persistSim(sim, true);
    }
    if (changed) rebuild();
    if (![...sims.values()].some(sim => sim.runs.some(run => !terminal(run.stage)))) stopSim();
  }
  async function startCustom(record: StoredRecord): Promise<void> {
    const runs = record.models.map((ref, index) => createCustomRun(`pending:${index}`, record.id, SESSION, modelOfRef(ref)));
    const { attemptId } = await saveCustomAttempt(transport, record.id, false, runs);
    if (disposed) return;
    const sim: CustomSim = { recordId: record.id, attemptId, runs: runs.map((run, index) => ({ ...run, id: `${attemptId}:${index}` })), elapsed: runs.map(() => 0), saving: false };
    sims.set(record.id, sim);
    selected.set(record.id, attemptId);
    if (simTimer === undefined) { previousTick = clock(); simTimer = setInterval(tick, 120); }
  }

  // ---- actions ------------------------------------------------------------------------------------
  function storedOf(recordId: string): StoredRecord | undefined { return stored.find(record => record.id === recordId); }
  function selectedAttemptId(recordId: string): string | undefined {
    const record = storedOf(recordId);
    return record ? attemptOf(record)?.id : undefined;
  }
  function busy(attemptId: string, value: FingerprintRecord['busy'], error?: string): void {
    const entry = entries.get(attemptId) ?? { revision: -1, loading: false };
    entry.busy = value;
    if (error !== undefined) entry.error = error || undefined;
    entries.set(attemptId, entry);
    rebuild();
  }
  function absorb(attemptId: string, result: AttemptViewResult): void {
    const entry = entries.get(attemptId) ?? { revision: -1, loading: false };
    if (!('unchanged' in result)) { entry.result = result; entry.revision = result.revision; entry.seenStatus = result.status; }
    entries.set(attemptId, entry);
  }

  void sync().finally(() => schedule());

  return {
    store,
    /** Records whose selected attempt should be loaded (open tabs). */
    watch(ids: string[]): void {
      const next = new Set(ids);
      if (next.size === watched.size && [...next].every(id => watched.has(id))) return;
      watched.clear();
      for (const id of next) watched.add(id);
      refreshSoon();
    },
    async create(input: CreateRecordInput): Promise<string> {
      const { record, attemptId } = await createRecord(transport, {
        kind: input.kind, name: input.name, models: input.models,
        ...(input.options ? { options: input.options } : {}), ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.footerVersion ? { footerVersion: input.footerVersion } : {}), ...(input.preset !== undefined ? { preset: input.preset } : {}),
      });
      if (attemptId) selected.set(record.id, attemptId);
      watched.add(record.id);
      if (!stored.some(item => item.id === record.id)) stored = [{ ...record, attempts: record.attempts ?? [] }, ...stored];
      if (record.kind === 'custom') {
        try { await startCustom(record); }
        catch (error) { setError(`自定义测试启动失败：${message(error, '连接中断')}`); }
      }
      rebuild();
      refreshSoon();
      return record.id;
    },
    async rerun(recordId: string): Promise<void> {
      const { attemptId } = await rerunRecord(transport, recordId);
      selected.set(recordId, attemptId);
      refreshSoon();
    },
    selectAttempt(recordId: string, attemptId: string): void {
      selected.set(recordId, attemptId);
      rebuild();
      refreshSoon();
    },
    async cancel(recordId: string): Promise<void> {
      const record = storedOf(recordId);
      if (!record) return;
      const sim = sims.get(recordId);
      if (record.kind === 'custom' && sim) {
        sim.runs = sim.runs.map(run => cancelCustomRun(run));
        rebuild();
        persistSim(sim, true);
        return;
      }
      const attemptId = selectedAttemptId(recordId);
      if (!attemptId) return;
      busy(attemptId, entries.get(attemptId)?.busy, '');
      try { absorb(attemptId, await cancelAttempt(transport, attemptId)); }
      catch (error) { busy(attemptId, undefined, `取消失败：${message(error, 'Host 未确认取消')}`); }
      refreshSoon();
    },
    async configure(recordId: string, options: FingerprintOptions): Promise<void> {
      const attemptId = selectedAttemptId(recordId);
      if (!attemptId || entries.get(attemptId)?.busy) return;
      busy(attemptId, 'configure', '');
      try { absorb(attemptId, await configureAttempt(transport, attemptId, options)); busy(attemptId, undefined); }
      catch (error) { busy(attemptId, undefined, `配置更新失败：${message(error, 'Host 未接受配置变更')}`); }
      refreshSoon();
    },
    async retry(recordId: string, runId: string): Promise<void> {
      const attemptId = selectedAttemptId(recordId);
      const run = store.getState().runs[runId];
      if (!attemptId || !run || entries.get(attemptId)?.busy || !run.fingerprint?.samples.some(sample => sample.state === 'failed')) return;
      busy(attemptId, 'retry', '');
      try { absorb(attemptId, await retryAttempt(transport, attemptId, { provider: run.model.provider, id: run.model.id })); busy(attemptId, undefined); }
      catch (error) { busy(attemptId, undefined, `重试失败样本失败：${message(error, 'Host 未接受重试请求')}`); }
      refreshSoon();
    },
    async remove(recordId: string): Promise<void> {
      sims.delete(recordId);
      await deleteRecord(transport, recordId);
      stored = stored.filter(record => record.id !== recordId);
      selected.delete(recordId);
      rebuild();
      refreshSoon();
    },
    async reset(): Promise<void> {
      sims.clear(); stopSim();
      await clearRecords(transport);
      stored = []; selected.clear(); entries.clear();
      rebuild();
      refreshSoon();
    },
    refresh: refreshSoon,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopSim();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      // Running Host attempts keep running: records are global and survive this view.
      for (const sim of sims.values()) void saveCustomAttempt(transport, sim.recordId, false, sim.runs).catch(() => {});
      sims.clear();
    },
  };
}
