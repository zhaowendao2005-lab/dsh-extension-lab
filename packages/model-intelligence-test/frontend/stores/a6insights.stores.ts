import { createStore } from 'zustand/vanilla';
import type { A6InsightsState, A6OperationToken, A6OperationView, A6RelationKind, A6ResultActionInput, A6ResultFeedback, Evaluation, ModelIntelligenceTransport } from '../types';
import { channelTests as fetchChannelTests, keyChannels as fetchKeyChannels, keyChannelPrices as fetchKeyChannelPrices, removeRoute as removeKeyRoute, unpinChannel as unpinKeyChannelRemote, pinChannel as pinKeyChannelRemote, readLedger, readOperationState, refreshOperationRelations, resultAction, selectOperationToken } from './a6insights.datasource';

export const ledgerKey = (recordId: string, attemptId?: string): string => JSON.stringify([recordId, attemptId ?? '*']);
export const operationRowKey = (recordId: string, model: string, channelId: number): string => JSON.stringify([recordId, model, channelId]);
export const channelTestKey = (model: string, channelId: number): string => JSON.stringify([model, channelId]);
export function operationTokenIssue(token?: A6OperationToken): string {
  if (!token) return '已选 Key 不在当前账号列表中，请重新选择';
  if (typeof token.expiredTime === 'number' && token.expiredTime > 0 && token.expiredTime * 1000 <= Date.now()) return 'Key 已过期';
  if (token.status !== undefined && token.status !== 1 && token.status !== '1') return 'Key 不可用';
  return '';
}
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Operation IO is explicit and single-flight. Only the local ledger mirror is polled. */
export function createA6InsightsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<A6InsightsState>(() => ({ operations: null, loading: false, busy: 0, query: '', results: {}, ledgers: {}, scopes: {}, keyChannels: {tokenId: null, view: null, loading: false}, keyPrices: {tokenId: null, view: null, loading: false}, channelTests: {}, keyView: {tokenId: null, query: '', expanded: [], selected: []} }));
  let disposed = false;
  let generation = 0;
  let accountId = '';
  let initialized = false;
  let credentialKey = '';
  let operationsRequested = false;
  let queue = Promise.resolve();
  let records: Evaluation[] = [];
  let testsSignature = '';
  const ledgerRequests = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function accept(view: A6OperationView, epoch: number): boolean {
    if (disposed || epoch !== generation) return false;
    if (view.accountId && accountId && view.accountId !== accountId) {
      store.setState({error: '账号已变化，请刷新账号信息后重试。'});
      return false;
    }
    const previous = store.getState().operations;
    if (previous?.accountId === view.accountId && previous.revision > view.revision) return false;
    store.setState({operations: view, error: undefined});
    return true;
  }
  function feedback(key: string, value: A6ResultFeedback): void {
    if (!disposed) store.setState(state => ({results: {...state.results, [key]: value}}));
  }
  function enqueue(epoch: number, work: () => Promise<void>): void {
    if (disposed) return;
    store.setState(state => ({busy: state.busy + 1}));
    queue = queue.then(async () => {
      if (disposed || epoch !== generation) return;
      try { await work(); }
      finally { if (!disposed && epoch === generation) store.setState(state => ({busy: Math.max(0, state.busy - 1)})); }
    }).catch(error => {
      if (!disposed && epoch === generation) store.setState({error: message(error)});
    });
  }
  function readOperations(options: {refreshTokens?: boolean; refreshRelations?: boolean} = {}): void {
    operationsRequested = true;
    const epoch = generation;
    enqueue(epoch, async () => {
      store.setState({loading: true, error: undefined, feedback: undefined});
      try { accept(await readOperationState(transport, options), epoch); }
      catch (error) { if (!disposed && epoch === generation) store.setState({error: message(error)}); }
      finally { if (!disposed && epoch === generation) store.setState({loading: false}); }
    });
  }
  async function loadLedger(record: Evaluation, refresh = false): Promise<void> {
    const attemptId = (store.getState().scopes[record.id] ?? 'attempt') === 'record' ? undefined : record.attemptId;
    const key = ledgerKey(record.id, attemptId);
    const requestKey = `${generation}:${key}`;
    if (disposed || ledgerRequests.has(requestKey)) return;
    ledgerRequests.add(requestKey);
    const epoch = generation;
    store.setState(state => ({ledgers: {...state.ledgers, [key]: {...state.ledgers[key], loading: true, error: undefined}}}));
    try {
      const view = await readLedger(transport, record.id, attemptId, refresh);
      if (!disposed && epoch === generation && records.some(item => item.id === record.id)) store.setState(state => ({ledgers: {...state.ledgers, [key]: {view, loading: false}}}));
    } catch (error) {
      if (!disposed && epoch === generation && records.some(item => item.id === record.id)) store.setState(state => ({ledgers: {...state.ledgers, [key]: {...state.ledgers[key], loading: false, error: message(error)}}}));
    } finally { ledgerRequests.delete(requestKey); }
  }
  function tick(): void {
    if (disposed) return;
    for (const record of records) void loadLedger(record);
    timer = setTimeout(tick, 4_000);
  }
  function readKeyChannels(tokenId: number, refresh = false): void {
    if (disposed || !Number.isSafeInteger(tokenId) || tokenId <= 0) return;
    const current = store.getState().keyChannels;
    if (current.loading && current.tokenId === tokenId) return;
    const epoch = generation;
    store.setState(state => ({keyChannels: {...state.keyChannels, tokenId, loading: true, error: undefined}}));
    void fetchKeyChannels(transport, tokenId, refresh).then(view => {
      if (disposed || epoch !== generation) return;
      store.setState(state => state.keyChannels.tokenId === tokenId ? {keyChannels: {tokenId, view, loading: false}} : state);
    }).catch(error => {
      if (disposed || epoch !== generation) return;
      store.setState(state => state.keyChannels.tokenId === tokenId ? {keyChannels: {...state.keyChannels, loading: false, error: message(error)}} : state);
    });
  }
  function readKeyPrices(tokenId: number, refresh = false): void {
    if (disposed || !Number.isSafeInteger(tokenId) || tokenId <= 0) return;
    const current = store.getState().keyPrices;
    if (current.loading && current.tokenId === tokenId) return;
    const epoch = generation;
    store.setState(state => ({keyPrices: {...state.keyPrices, tokenId, loading: true, error: undefined}}));
    void fetchKeyChannelPrices(transport, tokenId, refresh).then(view => {
      if (disposed || epoch !== generation) return;
      store.setState(state => state.keyPrices.tokenId === tokenId ? {keyPrices: {tokenId, view, loading: false}} : state);
    }).catch(error => {
      if (disposed || epoch !== generation) return;
      store.setState(state => state.keyPrices.tokenId === tokenId ? {keyPrices: {...state.keyPrices, loading: false, error: message(error)}} : state);
    });
  }
  function readChannelTests(model: string, channelId: number, limit = 20): void {
    if (disposed) return;
    const key = channelTestKey(model, channelId);
    const entry = store.getState().channelTests[key];
    if (entry?.loading) return;
    const epoch = generation;
    store.setState(state => ({channelTests: {...state.channelTests, [key]: {view: entry?.view ?? null, loading: true, error: undefined}}}));
    void fetchChannelTests(transport, model, channelId, limit).then(view => {
      if (disposed || epoch !== generation) return;
      store.setState(state => {
        // Keep the key overview's inline summary on the same facts as the expanded history.
        const current = state.keyChannels.view;
        const channelTests = {...state.channelTests, [key]: {view, loading: false}};
        if (!current) return {channelTests};
        const tests = {...(current.tests ?? {}), [key]: {total: view.total, latest: view.entries[0] ?? null}};
        return {channelTests, keyChannels: {...state.keyChannels, view: {...current, tests}}};
      });
    }).catch(error => {
      if (disposed || epoch !== generation) return;
      store.setState(state => ({channelTests: {...state.channelTests, [key]: {...(state.channelTests[key] ?? {view: null}), loading: false, error: message(error)}}}));
    });
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
        operationsRequested = false;
        store.setState({operations: null, query: '', results: {}, ledgers: {}, error: undefined, feedback: undefined, loading: false, busy: 0, keyChannels: {tokenId: null, view: null, loading: false}, keyPrices: {tokenId: null, view: null, loading: false}, channelTests: {}, keyView: {tokenId: null, query: '', expanded: [], selected: []}});
        testsSignature = '';
      }
      const previous = new Set(records.map(record => ledgerKey(record.id, record.attemptId)));
      records = next.filter(record => Boolean(record.a6api));
      // Any attempt transition can add/refresh a channel's latest record: re-read the cached
      // overview so counts and latest results never wait for a click (site data is cache-backed).
      const signature = records.map(record => `${record.id}:${(record.attempts ?? []).map(attempt => `${attempt.id}:${attempt.status}:${attempt.finishedAt ?? 0}`).join(',')}`).join('|');
      const testsChanged = signature !== testsSignature;
      testsSignature = signature;
      const overviewTokenId = store.getState().keyChannels.tokenId;
      if (testsChanged && overviewTokenId !== null) readKeyChannels(overviewTokenId);
      const ids = new Set(records.map(record => record.id));
      store.setState(state => {
        const entries = Object.entries(state.ledgers);
        const retained = entries.filter(([key]) => ids.has((JSON.parse(key) as string[])[0]));
        return entries.length === retained.length ? state : {ledgers: Object.fromEntries(retained)};
      });
      if (records.length && !operationsRequested) readOperations();
      if (changed || records.some(record => !previous.has(ledgerKey(record.id, record.attemptId)))) for (const record of records) void loadLedger(record);
    },
    load(): void { if (!store.getState().busy) readOperations(); },
    setQuery(query: string): void { store.setState({query}); },
    select(tokenId: number | null): void {
      if (store.getState().busy) return;
      const epoch = generation;
      enqueue(epoch, async () => {
        store.setState({loading: true, error: undefined, feedback: undefined});
        try {
          const view = await selectOperationToken(transport, tokenId);
          if (accept(view, epoch)) store.setState({results: {}, feedback: tokenId === null ? '已清除操作 Key 选择' : `已保存操作 Key #${tokenId}；所有结果行共用此 Key。`});
        } catch (error) { if (!disposed && epoch === generation) store.setState({error: message(error)}); }
        finally { if (!disposed && epoch === generation) store.setState({loading: false}); }
      });
    },
    refreshTokens(): void { if (!store.getState().busy) readOperations({refreshTokens: true}); },
    refreshRelations(kind: A6RelationKind): void {
      if (store.getState().busy) return;
      const epoch = generation;
      enqueue(epoch, async () => {
        store.setState({loading: true, error: undefined, feedback: undefined});
        try { accept(await refreshOperationRelations(transport, kind), epoch); }
        catch (error) { if (!disposed && epoch === generation) store.setState({error: message(error)}); }
        finally { if (!disposed && epoch === generation) store.setState({loading: false}); }
      });
    },
    action(input: A6ResultActionInput): void {
      const key = operationRowKey(input.recordId, input.model, input.channelId);
      if (store.getState().results[key]?.pending) return;
      const epoch = generation;
      const captured = {...input};
      feedback(key, {pending: input.operation});
      enqueue(epoch, async () => {
        const current = store.getState().operations;
        if (!records.some(record => record.id === captured.recordId)) { feedback(key, {}); return; }
        if (captured.operation !== 'restore' && current?.tokenId !== captured.tokenId) { feedback(key, {error: '操作 Key 已改变，请确认当前选择后重试。'}); return; }
        try {
          const outcome = await resultAction(transport, captured);
          if (!accept(outcome.state, epoch)) return;
          if (captured.operation === 'restore') {
            feedback(key, {message: outcome.result?.skipped ? '没有待恢复的旧固定' : `已恢复旧固定 · Key #${outcome.result?.tokenId ?? captured.tokenId}`});
            return;
          }
          const state = outcome.state;
          const modelPins = state.pins.filter(pin => pin.model === captured.model);
          const modelRoutes = state.routes.filter(route => route.model === captured.model);
          const sameKey = state.tokenId === captured.tokenId;
          const pinsFresh = sameKey && state.pinsAt !== null && !state.loading.pins && !state.errors.pins;
          const routesFresh = sameKey && state.routesAt !== null && !state.loading.routes && !state.errors.routes;
          const verified = captured.operation === 'pin'
            ? pinsFresh && modelPins.length === 1 && modelPins[0].channelId === captured.channelId && modelPins[0].routeEffective === true
            : captured.operation === 'unpin'
              ? pinsFresh && !modelPins.some(pin => pin.channelId === captured.channelId)
              : captured.operation === 'route'
                ? routesFresh && modelRoutes.some(route => route.channelIds.includes(captured.channelId))
                : routesFresh && !modelRoutes.some(route => route.channelIds.includes(captured.channelId));
          const label = captured.operation === 'pin' ? '固定' : captured.operation === 'unpin' ? '解除固定' : captured.operation === 'route' ? '路由' : '移出路由';
          feedback(key, verified ? {message: `${label}已读回确认 · Key #${captured.tokenId}`} : {error: '操作后尚未读回确认，请刷新对应关系；按钮保持未确认状态。'});
        } catch (error) {
          let mirrored = false;
          if (!disposed && epoch === generation) {
            // Host refreshes in its mutation finally; this reads only that cached mirror.
            try { mirrored = accept(await readOperationState(transport), epoch); } catch { /* Preserve the action error below. */ }
          }
          if (!disposed && epoch === generation) {
            if (!mirrored) store.setState(state => {
              if (!state.operations || (captured.operation !== 'restore' && state.operations.tokenId !== captured.tokenId)) return state;
              const kind = captured.operation === 'route' || captured.operation === 'unroute' ? 'routes' : 'pins';
              return {operations: {...state.operations, errors: {...state.operations.errors, [kind]: '操作未确认，请显式刷新关系。'}}};
            });
            feedback(key, {error: message(error)});
          }
        } finally { if (!disposed && epoch === generation && store.getState().results[key]?.pending) feedback(key, {}); }
      });
    },
    scope(recordId: string, scope: 'attempt'|'record'): void {
      store.setState(state => ({scopes: {...state.scopes, [recordId]: scope}}));
      const record = records.find(item => item.id === recordId);
      if (record) void loadLedger(record);
    },
    refreshLedger(recordId: string): void { const record = records.find(item => item.id === recordId); if (record) void loadLedger(record, true); },
    loadKeyChannels(tokenId: number, refresh = false): void {
      readKeyChannels(tokenId, refresh);
      if (refresh) readKeyPrices(tokenId, true);
      else if (!store.getState().keyPrices.view || store.getState().keyPrices.tokenId !== tokenId) readKeyPrices(tokenId);
    },
    loadKeyChannelPrices(tokenId: number, refresh = false): void { readKeyPrices(tokenId, refresh); },
    unpinKeyChannel(item: {model: string; channelId: number}): void {
      if (disposed) return;
      const tokenId = store.getState().keyChannels.tokenId;
      if (!tokenId) return;
      const epoch = generation;
      store.setState(state => ({keyChannels: {...state.keyChannels, loading: true, error: undefined}}));
      void unpinKeyChannelRemote(transport, {tokenId, model: item.model, channelId: item.channelId}).then(() => {
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false}}));
        readKeyChannels(tokenId, true);
      }).catch(error => {
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false, error: message(error)}}));
        readKeyChannels(tokenId, true);
      });
    },
    pinKeyChannel(item: {model: string; channelId: number}): void {
      if (disposed) return;
      const tokenId = store.getState().keyChannels.tokenId;
      if (!tokenId) return;
      const epoch = generation;
      store.setState(state => ({keyChannels: {...state.keyChannels, loading: true, error: undefined}}));
      void pinKeyChannelRemote(transport, {tokenId, model: item.model, channelId: item.channelId}).then(outcome => {
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false}}));
        readKeyChannels(tokenId, true);
        if (!outcome.routeEffective) {
          store.setState(state => ({keyChannels: {...state.keyChannels, error: '已固定，但站点还没把路由切到这条渠道；刷新确认它是否生效。'}}));
        }
      }).catch(error => {
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false, error: message(error)}}));
        readKeyChannels(tokenId, true);
      });
    },
    removeKeyRoutes(items: Array<{model: string; channelId: number}>): void {
      if (disposed || !items.length) return;
      const tokenId = store.getState().keyChannels.tokenId;
      if (!tokenId) return;
      const epoch = generation;
      store.setState(state => ({keyChannels: {...state.keyChannels, loading: true, error: undefined}}));
      void (async () => {
        for (const item of items) await removeKeyRoute(transport, {tokenId, model: item.model, channelId: item.channelId});
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false}}));
        readKeyChannels(tokenId, true);
      })().catch(error => {
        if (disposed || epoch !== generation) return;
        store.setState(state => ({keyChannels: {...state.keyChannels, loading: false, error: message(error)}}));
        readKeyChannels(tokenId, true);
      });
    },
    loadChannelTests(model: string, channelId: number, limit = 20): void { readChannelTests(model, channelId, limit); },
    patchKeyView(value: Partial<A6InsightsState['keyView']>): void {
      if (disposed) return;
      const previous = store.getState().keyView;
      const next = {...previous, ...value};
      if (value.tokenId !== undefined && value.tokenId !== previous.tokenId) { next.expanded = []; next.selected = []; }
      store.setState({keyView: next});
      if (next.tokenId !== null && next.tokenId !== previous.tokenId) { readKeyChannels(next.tokenId); readKeyPrices(next.tokenId); }
      if (value.tokenId === null) store.setState({keyChannels: {tokenId: null, view: null, loading: false}, keyPrices: {tokenId: null, view: null, loading: false}});
    },
    dispose(): void { disposed = true; generation++; if (timer) clearTimeout(timer); },
  };
}
