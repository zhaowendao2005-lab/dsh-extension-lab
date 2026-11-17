import { createStore } from 'zustand/vanilla';
import type { A6Draft, A6Selection, CustomDetailTab, CustomRunDetailEntry, CustomState, ModelIntelligenceTransport } from '../types';
import { createCustomTask as createCustomTaskService, loadRunDetail, openOutput, readFile } from './custom.datasource';

const ACTIVE = new Set(['queued', 'preparing', 'running', 'tooling', 'validating']);
const BILLING_PENDING = new Set(['pending', 'observed', 'partial']);
const BILLING_GRACE_MS = 420_000;
const keyOf = (attemptId: string, runId: string): string => `${attemptId}:${runId}`;

export function createCustomDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<CustomState>(() => ({ draft: { a6Models: [], a6Tokens: [], tokens: [], concurrency: 2, timeoutMs: 180_000, creating: false, step: 1 }, details: {}, selectedRunIds: [], preview: { open: false, loading: false, html: null, path: null, label: null } }));
  let disposed = false;
  let active: {attemptId: string; runId: string} | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const terminalSince = new Map<string, number>();
  const requests = new Map<string, number>();
  function setEntry(id: string, update: Partial<CustomRunDetailEntry>): void {
    if (disposed) return;
    store.setState(state => {
      const previous = state.details[id] ?? { loading: false, revision: -1, tab: 'chat' as const };
      return { details: { ...state.details, [id]: { ...previous, ...update } } };
    });
  }
  async function load(attemptId: string, runId: string): Promise<void> {
    const id = keyOf(attemptId, runId);
    const revision = store.getState().details[id]?.revision ?? -1;
    const request = (requests.get(id) ?? 0) + 1;
    requests.set(id, request);
    setEntry(id, { loading: true, error: undefined });
    try {
      const result = await loadRunDetail(transport, { attemptId, runId, ...(revision >= 0 ? { revision } : {}) });
      if (disposed || requests.get(id) !== request) return;
      if (!('unchanged' in result)) setEntry(id, { detail: result, revision: result.revision, loading: false, error: undefined });
      else setEntry(id, { revision: result.revision, loading: false });
    } catch (error) {
      if (!disposed && requests.get(id) === request) setEntry(id, { loading: false, error: error instanceof Error ? error.message : '读取 Host 详情失败' });
    }
  }
  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    if (!active || disposed) return;
    const id = keyOf(active.attemptId, active.runId);
    const entry = store.getState().details[id];
    const summary = entry?.detail?.run;
    const activeRun = Boolean(summary && ACTIVE.has(summary.phase));
    if (activeRun) terminalSince.delete(id);
    if (!summary || !entry?.detail) {
      timer = setTimeout(() => { timer = undefined; const current = active; if (current) void load(current.attemptId, current.runId).finally(schedule); }, 1_000);
      return;
    }
    const billsPending = entry.detail.requests.length === 0 || entry.detail.requests.some(request => BILLING_PENDING.has(request.billingState));
    const finishedAt = summary.finishedAt ?? terminalSince.get(id) ?? Date.now();
    if (!terminalSince.has(id)) terminalSince.set(id, finishedAt);
    if (!activeRun && (!billsPending || Date.now() - finishedAt >= BILLING_GRACE_MS)) return;
    timer = setTimeout(() => { timer = undefined; const current = active; if (current) void load(current.attemptId, current.runId).finally(schedule); }, activeRun ? 1_000 : 4_000);
  }
  return {
    store,
    async createTask(input: Parameters<typeof createCustomTaskService>[1]) {
      return createCustomTaskService(transport, input);
    },
    beginFromSelection(selection: A6Selection, draft?: A6Draft): void {
      store.setState(state => ({ draft: { ...state.draft, sourceSelectionId: selection.id, sourceRecordId: undefined, a6Models: draft?.models ?? selection.models, a6Tokens: selection.tokens, tokens: draft?.tokens ?? selection.tokens.map(token => token.id), timeoutMs: draft?.timeoutMs ?? state.draft.timeoutMs, step: 1, error: undefined } }));
    },
    beginFromFingerprint(recordId: string, models: import('../types').Model[], slots: {tokenId: number; name?: string}[] = []): void {
      const channels = models.flatMap(model => model.a6api ? [model.a6api] : []);
      if (!channels.length) return;
      const chosen = slots.slice(0, 1);
      store.setState(state => ({ selectedRunIds: [], selectionRecordId: undefined, draft: { ...state.draft, sourceRecordId: recordId, sourceSelectionId: undefined, a6Models: channels, a6Tokens: slots.map(slot => ({ id: slot.tokenId, name: slot.name ?? `token #${slot.tokenId}` })), tokens: chosen.map(slot => slot.tokenId), concurrency: 1, step: 1, error: undefined } }));
    },
    startSelection(recordId: string): void { store.setState({ selectionRecordId: recordId, selectedRunIds: [] }); },
    toggleRunSelection(recordId: string, runId: string): void {
      store.setState(state => state.selectionRecordId !== recordId ? state : ({ selectedRunIds: state.selectedRunIds.includes(runId) ? state.selectedRunIds.filter(id => id !== runId) : [...state.selectedRunIds, runId] }));
    },
    cancelSelection(): void { store.setState({ selectionRecordId: undefined, selectedRunIds: [] }); },
    clearSelection(): void { store.setState({ selectedRunIds: [] }); },
    patchDraft(value: Partial<Pick<CustomState['draft'], 'concurrency' | 'timeoutMs' | 'step'>>): void {
      store.setState(state => ({ draft: { ...state.draft, ...value, error: undefined } }));
    },
    removeA6Model(key: string): void {
      store.setState(state => ({ draft: { ...state.draft, a6Models: state.draft.a6Models.filter(model => `${model.channelId}:${model.model}` !== key), error: undefined } }));
    },
    toggleToken(tokenId: number): void {
      store.setState(state => ({ draft: { ...state.draft, tokens: state.draft.tokens.includes(tokenId) ? state.draft.tokens.filter(id => id !== tokenId) : [...state.draft.tokens, tokenId], error: undefined } }));
    },
    resetSource(): void { store.setState(state => ({ draft: { ...state.draft, sourceSelectionId: undefined, sourceRecordId: undefined, a6Models: [], a6Tokens: [], tokens: [], error: undefined } })); },
    watch(attemptId: string | undefined, runId: string | undefined): void {
      const next = attemptId && runId ? { attemptId, runId } : undefined;
      if (active?.attemptId === next?.attemptId && active?.runId === next?.runId) return;
      active = next;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (next) void load(next.attemptId, next.runId).finally(schedule);
    },
    setTab(attemptId: string, runId: string, tab: CustomDetailTab): void { setEntry(keyOf(attemptId, runId), { tab }); },
    async readFile(attemptId: string, runId: string, path: string): Promise<void> {
      const id = keyOf(attemptId, runId); const request = (requests.get(`${id}:file`) ?? 0) + 1; requests.set(`${id}:file`, request);
      setEntry(id, { fileLoading: true, file: undefined });
      try { const file = await readFile(transport, { attemptId, runId, path }); if (!disposed && requests.get(`${id}:file`) === request) setEntry(id, { file, fileLoading: false }); }
      catch (error) { if (!disposed && requests.get(`${id}:file`) === request) setEntry(id, { fileLoading: false, error: error instanceof Error ? error.message : '读取文件失败' }); }
    },
    async openOutput(attemptId: string, runId: string, mode: 'preview' | 'vscode') {
      const id = keyOf(attemptId, runId);
      setEntry(id, { previewLoading: true, error: undefined });
      if (mode === 'preview') store.setState({ preview: { open: true, loading: true, html: null, path: null, label: runId } });
      try {
        const result = await openOutput(transport, { attemptId, runId, mode });
        setEntry(id, { previewLoading: false, previewPath: result.path });
        if (mode === 'preview' && !disposed) store.setState({ preview: { open: true, loading: false, html: result.html ?? null, path: result.path ?? null, label: runId } });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : '打开成果失败';
        setEntry(id, { previewLoading: false, error: message });
        if (mode === 'preview' && !disposed) store.setState({ preview: { open: true, loading: false, html: null, path: null, label: runId, error: message } });
        throw error;
      }
    },
    closeOutput(attemptId: string, runId: string): void { setEntry(keyOf(attemptId, runId), { previewOpen: false, previewPath: undefined }); },
    dismissPreview(): void { if (!disposed) store.setState(state => ({ preview: { ...state.preview, open: false, html: null, path: null, label: null } })); },
    dispose(): void { if (disposed) return; disposed = true; active = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; requests.clear(); terminalSince.clear(); },
  };
}
