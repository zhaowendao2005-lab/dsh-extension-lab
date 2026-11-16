import { createStore } from 'zustand/vanilla';
import type { A6InsightsState, A6ProviderView, A6ResultActionInput, A6ResultFeedback, A6Target, Evaluation, ModelIntelligenceTransport } from '../types';
import { configureProviders, readLedger, readProviderState, resultAction, saveTarget } from './a6insights.datasource';

export const ledgerKey = (recordId: string, attemptId?: string): string => JSON.stringify([recordId, attemptId ?? '*']);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Host facts are polled once per plugin, independently from rendered rows or tabs. */
export function createA6InsightsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<A6InsightsState>(() => ({ providers: null, loading: false, managerOpen: false, query: '', selected: [], saving: false, targetQueries: {}, results: {}, ledgers: {}, scopes: {} }));
  let disposed = false;
  let generation = 0;
  let accountId = '';
  let initialized = false;
  let credentialKey = '';
  let providerRequest = false;
  let providerWanted = false;
  let mutationCount = 0;
  let selectionDirty = false;
  let records: Evaluation[] = [];
  const ledgerRequests = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function accept(view: A6ProviderView, epoch: number, resetSelection = false): boolean {
    if (disposed || epoch !== generation || (accountId && view.accountId && view.accountId !== accountId)) return false;
    const previous = store.getState().providers;
    if (previous?.accountId === view.accountId && previous.revision > view.revision) return false;
    store.setState({ providers: view, error: undefined, ...((!selectionDirty || resetSelection) ? {selected: view.selectedProviderIds} : {}) });
    if (resetSelection) selectionDirty = false;
    return true;
  }
  function feedback(model: string, value: A6ResultFeedback): void {
    if (!disposed) store.setState(state => ({ results: {...state.results, [model]: value} }));
  }
  async function refreshProviders(scan = false, refresh = false): Promise<void> {
    providerWanted = true;
    if (disposed || providerRequest || mutationCount) return;
    providerRequest = true;
    const epoch = generation;
    store.setState({loading: true, error: undefined});
    try { accept(await readProviderState(transport, {scan, refresh}), epoch); }
    catch (error) { if (!disposed && epoch === generation) store.setState({error: message(error)}); }
    finally { providerRequest = false; if (!disposed && epoch === generation) store.setState({loading: false}); }
  }
  async function loadLedger(record: Evaluation, refresh = false): Promise<void> {
    const attemptId = (store.getState().scopes[record.id] ?? 'attempt') === 'record' ? undefined : record.attemptId;
    const key = ledgerKey(record.id, attemptId);
    if (disposed || ledgerRequests.has(key)) return;
    ledgerRequests.add(key);
    const epoch = generation;
    store.setState(state => ({ledgers: {...state.ledgers, [key]: {...state.ledgers[key], loading: true, error: undefined}}}));
    try {
      const view = await readLedger(transport, record.id, attemptId, refresh);
      if (!disposed && epoch === generation && records.some(item => item.id === record.id)) store.setState(state => ({ledgers: {...state.ledgers, [key]: {view, loading: false}}}));
    } catch (error) {
      if (!disposed && epoch === generation && records.some(item => item.id === record.id)) store.setState(state => ({ledgers: {...state.ledgers, [key]: {...state.ledgers[key], loading: false, error: message(error)}}}));
    } finally { ledgerRequests.delete(key); }
  }
  function tick(): void {
    if (disposed) return;
    if (providerWanted || records.length) void refreshProviders();
    for (const record of records) void loadLedger(record);
    timer = setTimeout(tick, 4_000);
  }
  return {
    store,
    start(): void { tick(); },
    watch(next: Evaluation[], account: string, credentials: string): void {
      const changed = !initialized || account !== accountId || credentials !== credentialKey;
      credentialKey = credentials;
      initialized = true;
      if (changed) {
        generation++;
        accountId = account;
        selectionDirty = false;
        store.setState({providers: null, selected: [], results: {}, ledgers: {}, error: undefined, feedback: undefined, loading: false, saving: false});
      }
      const previous = new Set(records.map(record => ledgerKey(record.id, record.attemptId)));
      records = next.filter(record => Boolean(record.a6api));
      const ids = new Set(records.map(record => record.id));
      store.setState(state => {
        const entries = Object.entries(state.ledgers);
        const retained = entries.filter(([key]) => ids.has((JSON.parse(key) as string[])[0]));
        return entries.length === retained.length ? state : {ledgers: Object.fromEntries(retained)};
      });
      if (changed || records.some(record => !previous.has(ledgerKey(record.id, record.attemptId)))) {
        if (records.length || providerWanted) void refreshProviders();
        for (const record of records) void loadLedger(record);
      }
    },
    toggleManager(): void {
      const managerOpen = !store.getState().managerOpen;
      store.setState({managerOpen});
      if (managerOpen) void refreshProviders();
    },
    setQuery(query: string): void { store.setState({query}); },
    toggleProvider(id: string): void {
      if (store.getState().saving) return;
      selectionDirty = true;
      store.setState(state => ({selected: state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id], feedback: undefined}));
    },
    async configure(): Promise<void> {
      if (store.getState().saving) return;
      if (mutationCount) { store.setState({feedback: '正在保存使用目标或执行渠道操作，请完成后再保存提供商选择。'}); return; }
      mutationCount++;
      const epoch = generation;
      store.setState({saving: true, error: undefined, feedback: undefined});
      try {
        const view = await configureProviders(transport, store.getState().selected);
        if (accept(view, epoch, true)) store.setState({feedback: view.scanning ? '选择已保存，正在后台匹配…' : '参与匹配的提供商已保存'});
      } catch (error) { if (!disposed && epoch === generation) store.setState({error: message(error)}); }
      finally { mutationCount--; if (!disposed && epoch === generation) store.setState({saving: false}); }
    },
    refresh(scan = false): void {
      if (mutationCount) { store.setState({feedback: '渠道操作进行中，请完成后再刷新匹配。'}); return; }
      void refreshProviders(scan, true);
    },
    setTargetQuery(model: string, query: string): void { store.setState(state => ({targetQueries: {...state.targetQueries, [model]: query}})); },
    async save(recordId: string, model: string, target: A6Target): Promise<void> {
      if (store.getState().results[model]?.pending) return;
      mutationCount++;
      const epoch = generation;
      feedback(model, {pending: 'save'});
      try {
        const view = await saveTarget(transport, recordId, model, target);
        if (records.some(record => record.id === recordId) && accept(view, epoch)) feedback(model, {message: '使用目标已保存'});
      } catch (error) { if (!disposed && epoch === generation && records.some(record => record.id === recordId)) feedback(model, {error: message(error)}); }
      finally { mutationCount--; if (!disposed && epoch === generation && store.getState().results[model]?.pending) feedback(model, {}); }
    },
    async action(input: A6ResultActionInput): Promise<void> {
      if (store.getState().results[input.model]?.pending) return;
      mutationCount++;
      const epoch = generation;
      feedback(input.model, {pending: input.operation});
      try {
        const outcome = await resultAction(transport, input);
        const skipped = outcome.result && 'skipped' in outcome.result && outcome.result.skipped === true;
        const restoredTokenId = outcome.result && 'tokenId' in outcome.result && typeof outcome.result.tokenId === 'number' ? outcome.result.tokenId : undefined;
        const text = input.operation === 'restore' ? skipped ? '没有待恢复的本插件固定' : `已恢复本插件保存的原固定关系${restoredTokenId === undefined ? '' : ` · 原令牌 #${restoredTokenId}`}` : `${input.operation === 'pin' ? '已固定到' : '已加入路由：'}渠道 #${input.channelId} · 令牌 #${input.tokenId}`;
        if (!disposed && epoch === generation) feedback(input.model, {message: text});
      } catch (error) { if (!disposed && epoch === generation && records.some(record => record.id === input.recordId)) feedback(input.model, {error: message(error)}); }
      finally { mutationCount--; if (!disposed && epoch === generation && store.getState().results[input.model]?.pending) feedback(input.model, {}); }
    },
    scope(recordId: string, scope: 'attempt'|'record'): void {
      store.setState(state => ({scopes: {...state.scopes, [recordId]: scope}}));
      const record = records.find(item => item.id === recordId);
      if (record) void loadLedger(record);
    },
    refreshLedger(recordId: string): void { const record = records.find(item => item.id === recordId); if (record) void loadLedger(record, true); },
    dispose(): void { disposed = true; generation++; if (timer) clearTimeout(timer); },
  };
}
