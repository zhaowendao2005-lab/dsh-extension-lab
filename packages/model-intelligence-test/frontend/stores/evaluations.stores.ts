import { createStore } from 'zustand/vanilla';
import type { AttemptSummary, AttemptViewResult, Evaluation, EvaluationsState, FingerprintOptions, FingerprintRecord, ModelIntelligenceTransport, Preset, RecordModelRef, Run, StoredRecord, TestKind } from '../types';
import {
  applyFingerprintRun, cancelAttempt, clearRecords, configureAttempt, createFingerprintRun, createRecord,
  deleteRecord, failFingerprintRun, listRecords, modelOfRef, readAttempt, renameRecord, rerunRecord, retryAttempt, terminal, applyCustomRun,
} from './evaluations.datasource';

const ACTIVE_POLL_MS = 800;
const IDLE_POLL_MS = 4_000;
const TERMINAL_BILLING_GRACE_MS = 420_000;
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

export interface CreateRecordInput { kind: TestKind; name: string; models: RecordModelRef[]; options?: FingerprintOptions; prompt?: string; footerVersion?: string; preset?: Preset | null }

/**
 * Global, Host-persisted evaluation records. The Host owns records and attempts (请求); this domain
 * mirrors the list, loads the selected attempt of every watched record, polls active ones and
 * projects them into stable Run rows. Custom execution facts come only from the Host.
 */
export function createEvaluationsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<EvaluationsState>(() => ({ records: [], runs: {}, loaded: false }));
  let disposed = false;
  let stored: StoredRecord[] = [];
  let listRevision = -1;
  let listBusy = false;
  let acceptedVersion = 0;
  let failures = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const selected = new Map<string, string>();
  const entries = new Map<string, AttemptEntry>();
  const watched = new Set<string>();
  const dirtyAttempts = new Set<string>();

  // ---- projection -------------------------------------------------------------------------------
  function attemptOf(record: StoredRecord): AttemptSummary | undefined {
    const chosen = selected.get(record.id);
    const found = (record.attempts ?? []).find(attempt => attempt.id === chosen);
    if (found) return found;
    return record.attempts?.at(-1);
  }
  function runIdsOf(record: StoredRecord, attempt?: AttemptSummary): string[] {
    if (record.kind === 'custom') return attempt ? (entries.get(attempt.id)?.result?.custom?.runs ?? []).map(run => run.id) : [];
    const prefix = attempt?.id ?? `${record.id}:none`;
    return record.models.map((_, index) => `${prefix}:${index}`);
  }
  function fingerprintOf(record: StoredRecord, attempt: AttemptSummary | undefined, entry: AttemptEntry | undefined): FingerprintRecord {
    const view = entry?.result?.view ?? null;
    const status: FingerprintRecord['status'] = attempt ? STATUS[attempt.status] : 'failed';
    const errors = [attempt?.status === 'interrupted' ? '运行时重启，请求已中断' : null, attempt?.error ?? null, entry?.error ?? null].filter(Boolean);
    return {
      status, challenges: view?.challenges ?? [],
      ...(view ? { jobId: view.id, reference: { builtAt: view.reference.builtAt, sdk: view.reference.sdk }, concurrency: view.concurrency, timeoutMs: view.timeoutMs, slots: view.slots, limits: { ...view.limits } }
        : { concurrency: record.options?.concurrency, timeoutMs: record.options?.timeoutMs }),
      ...(entry?.busy ? { busy: entry.busy } : {}),
      ...(errors.length ? { error: errors.join('\n') } : {}),
      ...(!attempt ? { error: '这条记录还没有请求' } : {}),
    };
  }
  function projectRuns(record: StoredRecord, attempt: AttemptSummary | undefined, entry: AttemptEntry | undefined, previous: Record<string, Run>, next: Record<string, Run>): void {
    const ids = runIdsOf(record, attempt);
    if (record.kind === 'custom') {
      for (const summary of entry?.result?.custom?.runs ?? []) {
        const ref = record.models.find(model => model.id === summary.target.modelId && (summary.target.kind === 'a6api' ? model.a6api?.channelId === summary.target.channelId : model.provider === summary.target.providerId));
        if (ref) next[summary.id] = applyCustomRun(previous[summary.id], summary, record.id, modelOfRef(ref));
      }
      return;
    }
    const view = entry?.result?.view ?? null;
    record.models.forEach((ref, index) => {
      const id = ids[index];
      let run = previous[id] ?? createFingerprintRun(id, record.id, SESSION, modelOfRef(ref));
      const runView = view?.runs.find(item => item.provider === ref.provider && item.model === ref.id
        && (!ref.relay || !item.relay || (item.relay.channelId === ref.relay.channelId && item.relay.supplierId === ref.relay.supplierId)));
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
        options: record.options ?? {}, ...(attempt ? { attemptId: attempt.id } : {}), ...(record.a6api ? { a6api: record.a6api } : {}),
        ...(record.kind === 'fingerprint' ? { fingerprint: fingerprintOf(record, attempt, entry) } : {custom: {busy: entry?.busy, error: entry?.error}}),
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
    if (dirtyAttempts.has(attempt.id) || ACTIVE.has(attempt.status) || entry.seenStatus !== attempt.status) return attempt;
    const result = entry.result;
    const billingPending = result && 'custom' in result && Boolean(result.custom?.billingPending);
    const finishedAt = attempt.finishedAt ?? attempt.createdAt;
    if (record.kind === 'custom' && billingPending && Date.now() - finishedAt < TERMINAL_BILLING_GRACE_MS) return attempt;
    return undefined;
  }
  async function loadAttempt(attempt: AttemptSummary): Promise<void> {
    const entry = entries.get(attempt.id) ?? { revision: -1, loading: false };
    entries.set(attempt.id, entry);
    if (entry.loading) return;
    entry.loading = true;
    const forced = dirtyAttempts.delete(attempt.id);
    try {
      const result = await readAttempt(transport, attempt.id, !forced && entry.seenStatus === attempt.status ? entry.revision : -1);
      if (disposed || dirtyAttempts.has(attempt.id)) return;
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
      const version = acceptedVersion;
      const list = await listRecords(transport, listRevision);
      if (disposed) return;
      if (!('unchanged' in list) && version === acceptedVersion) {
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
    refreshAttempt(attemptId: string): void {
      if (disposed) return;
      dirtyAttempts.add(attemptId);
      refreshSoon();
    },
    /** Records whose selected attempt should be loaded (open tabs). */
    watch(ids: string[]): void {
      const next = new Set(ids);
      if (next.size === watched.size && [...next].every(id => watched.has(id))) return;
      watched.clear();
      for (const id of next) watched.add(id);
      refreshSoon();
    },
    /** a6Create already persisted the record; never route it through ordinary recordCreate. */
    acceptCreated(record: StoredRecord, attemptId: string): void {
      if (disposed) return;
      acceptedVersion++;
      selected.set(record.id, attemptId);
      watched.add(record.id);
      stored = [{ ...record, attempts: record.attempts ?? [] }, ...stored.filter(item => item.id !== record.id)];
      rebuild();
      refreshSoon();
    },
    /** Rename a Host record; the list is refreshed from the returned record so every view updates. */
    async rename(recordId: string, name: string): Promise<StoredRecord> {
      const record = await renameRecord(transport, recordId, name);
      if (!record?.id) throw new Error('Host 未返回更新后的记录');
      stored = stored.map(item => item.id === record.id ? { ...item, ...record } : item);
      rebuild();
      return record;
    },
    async create(input: CreateRecordInput): Promise<string> {
      const { record, attemptId } = await createRecord(transport, {
        kind: input.kind, name: input.name, models: input.models,
        ...(input.options ? { options: input.options } : {}), ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.footerVersion ? { footerVersion: input.footerVersion } : {}), ...(input.preset !== undefined ? { preset: input.preset } : {}),
      });
      if (disposed) return record.id;
      acceptedVersion++;
      if (attemptId) selected.set(record.id, attemptId);
      watched.add(record.id);
      if (!stored.some(item => item.id === record.id)) stored = [{ ...record, attempts: record.attempts ?? [] }, ...stored];
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
      // Custom runs retry in place through the custom domain; this path is fingerprint-only.
      if (!attemptId || !run || run.custom || entries.get(attemptId)?.busy || !run.fingerprint?.samples.some(sample => sample.state === 'failed')) return;
      busy(attemptId, 'retry', '');
      try {
        const result = await retryAttempt(transport, attemptId, { provider: run.model.provider, id: run.model.id });
        absorb(attemptId, result);
        busy(attemptId, undefined);
      } catch (error) { busy(attemptId, undefined, `重试失败样本失败：${message(error, 'Host 未接受重试请求')}`); }
      refreshSoon();
    },
    async remove(recordId: string): Promise<void> {
      await deleteRecord(transport, recordId);
      stored = stored.filter(record => record.id !== recordId);
      selected.delete(recordId);
      rebuild();
      refreshSoon();
    },
    async reset(): Promise<void> {
      await clearRecords(transport);
      stored = []; selected.clear(); entries.clear();
      rebuild();
      refreshSoon();
    },
    refresh: refreshSoon,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      // Host attempts survive closing a view; plugin teardown does not invent terminal states.
    },
  };
}
