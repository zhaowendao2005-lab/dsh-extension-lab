import {createStore} from 'zustand/vanilla';
import type {Currency, ModelIntelligenceTransport, Partition, PartitionItemInput, PartitionsView, RelayApi, RelayFidelity, RelayRow, RelayStoreState, RelayStatus} from '../types';
import {retryMissingPages, resolveChannels, deletePartition, listPartitions, readConcurrency, readHistory, readRow, readRows, readSites, readSnapshot, readSvg, savePartition, updatePartitionItem} from './relay.datasource';

const DEFAULT_STATUS: RelayStatus = {state: 'idle', progress: 0, pages: 0, total: 0, fetchedAt: null, stale: false, error: null};
const DEFAULT_COLUMNS = ['favorite', 'model', 'channel', 'price', 'success', 'success24h', 'ttft', 'throughput', 'cache', 'labels', 'guarantee', 'updated', 'status'];
const DEFAULT_WIDTHS: Record<string, number> = {
  favorite: 56, guarantee: 88, ratio: 96, endpoint: 96, brand: 112, model: 220, channel: 260, success: 150, success24h: 92, price: 190, ttft: 96, throughput: 96, cache: 112, labels: 170, updated: 112, status: 96,
};
export const FAVORITES = 'favorites';
const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

/** Partition item identity: one channel serving one model on one site. */
export function relayItemKey(row: Pick<RelayRow, 'channelId' | 'modelName'>, siteId: string): string {
  return `${siteId}:${row.channelId}:${row.modelName}`;
}

export function createRelayDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<RelayStoreState>(() => ({
    sites: [], sorts: [], siteId: 'a6api', status: DEFAULT_STATUS, brands: [], models: [], rows: [], total: 0,
    loading: false, filter: {brands: [], models: [], fidelity: 'all', sort: 'comprehensive'}, columns: DEFAULT_COLUMNS, widths: DEFAULT_WIDTHS,
    columnsOpen: false, detailLoading: false, scrollTop: 0, viewportHeight: 560,
    menu: {open: null, brandQuery: '', modelQuery: ''}, history: {}, concurrency: {}, svg: {}, partitions: [], partitionMenu: null,
    view: 'list', currency: 'usd', resolved: {}, pool: null, retrying: false,
  }));
  let disposed = false;
  let initialized = false;
  let revision = 0;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let partitionsLoaded = false;
  let resolveTimer: ReturnType<typeof setTimeout> | undefined;
  const wanted = new Map<string, {channelId: number; model: string}>();
  const refKey = (channelId: number, model: string): string => `${channelId}|${model}`;

  function clearPoll(): void {
    if (poll !== undefined) { clearTimeout(poll); poll = undefined; }
    if (resolveTimer !== undefined) { clearTimeout(resolveTimer); resolveTimer = undefined; }
  }
  /** Look the wanted channel/model pairs up in the snapshot; unanswered (null) ones are asked again while it builds. */
  function flushResolve(): void {
    if (disposed || !wanted.size) return;
    const refs = [...wanted.values()].slice(0, 512);
    const {siteId} = store.getState();
    void resolveChannels(transport, siteId, refs).then(value => {
      if (disposed) return;
      const next = {...store.getState().resolved};
      let pending = false;
      for (const item of value.items) {
        const key = refKey(item.channelId, item.model);
        next[key] = item;
        if (item.found === null) pending = true; else wanted.delete(key);
      }
      store.setState({resolved: next, status: value.status});
      if (pending && resolveTimer === undefined) resolveTimer = setTimeout(() => { resolveTimer = undefined; flushResolve(); }, 1500);
    }).catch(() => { /* a failed lookup leaves the entry unresolved; the UI shows it as unknown, never as expired */ });
  }
  function resolveRefs(refs: {channelId: number; model: string}[]): void {
    if (disposed) return;
    const known = store.getState().resolved;
    let added = false;
    for (const ref of refs) {
      const key = refKey(ref.channelId, ref.model);
      if (known[key]?.found !== undefined && known[key]?.found !== null) continue;
      if (!wanted.has(key)) { wanted.set(key, ref); added = true; }
    }
    if (added) flushResolve();
  }
  function setError(error: unknown): void {
    store.setState({loading: false, error: message(error, '中转站读取失败，请稍后重试。')});
  }
  /** A snapshot rebuild can start from any read (Host refreshes it once its TTL expires). */
  function schedulePoll(): void {
    clearPoll();
    if (disposed) return;
    poll = setTimeout(() => { poll = undefined; updateSnapshot(false); }, 900);
  }

  function loadRows(requestRevision = ++revision): void {
    if (disposed) return;
    const current = store.getState();
    store.setState({loading: true, error: undefined});
    const {siteId, filter} = current;
    void readRows(transport, {
      siteId, ...(filter.brands.length ? {brands: filter.brands} : {}), ...(filter.models.length ? {models: filter.models} : {}),
      fidelity: filter.fidelity, sort: filter.sort, offset: 0, limit: 20_000,
    }).then(value => {
      if (disposed || requestRevision !== revision) return;
      store.setState({rows: value.rows, total: value.total, status: value.status, loading: false, error: value.status.error ?? undefined, scrollTop: 0});
      if (value.status.state === 'building') schedulePoll();
      else clearPoll();
    }).catch(error => {
      if (disposed || requestRevision !== revision) return;
      setError(error);
    });
  }

  function updateSnapshot(force = false): void {
    if (disposed) return;
    const requestRevision = ++revision;
    const {siteId} = store.getState();
    store.setState({loading: true, error: undefined});
    void readSnapshot(transport, siteId, force).then(value => {
      if (disposed || requestRevision !== revision) return;
      store.setState({status: value.status, brands: value.brands, models: value.models, sorts: value.sorts, loading: value.status.state !== 'ready', error: value.status.error ?? undefined});
      clearPoll();
      if (value.status.state === 'ready') loadRows(requestRevision);
      else if (value.status.state === 'building') schedulePoll();
    }).catch(error => {
      if (disposed || requestRevision !== revision) return;
      setError(error);
    });
  }

  // ---- partitions (favorites = default partition) -------------------------------------------
  function applyPartitions(view: PartitionsView): void {
    if (disposed) return;
    const partitions: Partition[] = [...view.partitions].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.createdAt - b.createdAt);
    store.setState({partitions, partitionsError: undefined});
    resolveRefs(partitions.flatMap(partition => partition.items.map(item => ({channelId: item.channelId, model: item.model}))));
  }
  function partitionCall(run: () => Promise<PartitionsView>): void {
    void run().then(applyPartitions).catch(error => { if (!disposed) store.setState({partitionsError: message(error, '分区操作失败')}); });
  }
  function loadPartitions(): void {
    if (disposed) return;
    partitionsLoaded = true;
    partitionCall(() => listPartitions(transport));
  }
  function favoriteRefs(): {channelId: number; model: string}[] {
    return store.getState().partitions.flatMap(partition => partition.items.map(item => ({channelId: item.channelId, model: item.model})));
  }
  function itemInput(row: RelayRow): PartitionItemInput['item'] {
    const {siteId} = store.getState();
    return {
      key: relayItemKey(row, siteId), siteId, channelId: row.channelId, model: row.modelName, brand: row.brand,
      supplier: row.supplierName, channelName: row.channelName, testEndpoint: row.testEndpoint,
    };
  }
  function rowOf(rowKey: string): RelayRow | undefined {
    const state = store.getState();
    return state.rows.find(row => row.rowKey === rowKey) ?? (state.detail?.rowKey === rowKey ? state.detail : undefined);
  }

  function lazy(field: 'history' | 'concurrency' | 'svg', rowKey: string): void {
    if (disposed) return;
    const {siteId} = store.getState();
    const reader = field === 'history' ? readHistory : field === 'concurrency' ? readConcurrency : readSvg;
    store.setState({[field]: {...store.getState()[field], [rowKey]: {...store.getState()[field][rowKey], loading: true, error: undefined}}});
    void reader(transport, siteId, rowKey).then(value => {
      if (disposed) return;
      store.setState({[field]: {...store.getState()[field], [rowKey]: {loading: false, value}}});
    }).catch(error => {
      if (disposed) return;
      store.setState({[field]: {...store.getState()[field], [rowKey]: {loading: false, error: message(error, '读取失败')}}});
    });
  }

  function init(): void {
    if (disposed) return;
    if (!partitionsLoaded) loadPartitions();
    if (initialized) return;
    initialized = true;
    store.setState({loading: true, error: undefined});
    void readSites(transport).then(value => {
      if (disposed) return;
      const siteId = value.sites.some(site => site.id === store.getState().siteId) ? store.getState().siteId : value.sites[0]?.id ?? '';
      store.setState({sites: value.sites, sorts: value.sorts, siteId, filter: {...store.getState().filter, sort: value.sorts[0]?.id ?? 'comprehensive'}});
      if (siteId) updateSnapshot(false); else throw new Error('没有可用的中转站站点。');
    }).catch(error => { if (!disposed) { initialized = false; setError(error); } });
  }

  function patchFilter(patch: Partial<RelayStoreState['filter']>): void {
    if (disposed) return;
    store.setState({filter: {...store.getState().filter, ...patch}});
    loadRows();
  }
  const toggle = (list: string[], value: string): string[] => list.includes(value) ? list.filter(item => item !== value) : [...list, value];

  return {
    store,
    init,
    loadPartitions,
    refresh(): void { updateSnapshot(true); },
    site(id: string): void {
      if (disposed || !store.getState().sites.some(site => site.id === id)) return;
      revision++;
      clearPoll();
      store.setState({siteId: id, filter: {...store.getState().filter, brands: [], models: []}, rows: [], total: 0, detail: undefined});
      updateSnapshot(false);
    },
    menu(open: 'brand' | 'model' | null): void { store.setState({menu: {...store.getState().menu, open}}); },
    menuQuery(kind: 'brand' | 'model', query: string): void {
      store.setState({menu: {...store.getState().menu, [kind === 'brand' ? 'brandQuery' : 'modelQuery']: query}});
    },
    toggleBrand(name: string): void {
      const {filter, models} = store.getState();
      const brands = toggle(filter.brands, name);
      // Model selections that no longer belong to a selected brand drop out.
      const allowed = new Set(models.filter(model => !brands.length || brands.includes(model.brand)).map(model => model.name));
      patchFilter({brands, models: filter.models.filter(model => allowed.has(model))});
    },
    toggleModel(name: string): void { patchFilter({models: toggle(store.getState().filter.models, name)}); },
    clearFilter(kind: 'brand' | 'model'): void { patchFilter(kind === 'brand' ? {brands: [], models: []} : {models: []}); },
    fidelity(value: RelayFidelity): void { patchFilter({fidelity: value}); },
    sort(value: string): void { patchFilter({sort: value}); },
    toggleColumn(id: string): void {
      const current = store.getState();
      if (current.columns.includes(id)) {
        if (current.columns.length <= 1) return;
        store.setState({columns: current.columns.filter(column => column !== id)});
      } else store.setState({columns: [...current.columns, id]});
    },
    resizeColumn(id: string, width: number): void {
      if (!Number.isFinite(width)) return;
      store.setState({widths: {...store.getState().widths, [id]: Math.max(48, Math.min(520, Math.round(width)))}});
    },
    toggleColumns(): void { store.setState({columnsOpen: !store.getState().columnsOpen}); },
    scroll(top: number, viewportHeight: number): void { store.setState({scrollTop: Math.max(0, top), viewportHeight: Math.max(120, viewportHeight)}); },
    openDetail(rowKey: string): void {
      if (disposed) return;
      const cached = store.getState().rows.find(row => row.rowKey === rowKey);
      store.setState({detail: cached, detailLoading: true, partitionMenu: null});
      void readRow(transport, store.getState().siteId, rowKey).then(value => { if (!disposed) store.setState({detail: value.row, detailLoading: false, status: value.status}); }).catch(error => { if (!disposed) { setError(error); store.setState({detailLoading: false}); } });
    },
    closeDetail(): void { store.setState({detail: undefined, detailLoading: false, partitionMenu: null}); },
    loadHistory(rowKey: string): void { lazy('history', rowKey); },
    loadConcurrency(rowKey: string): void { lazy('concurrency', rowKey); },
    loadSvg(rowKey: string): void { lazy('svg', rowKey); },
    toggleFavorite(rowKey: string): void {
      const row = rowOf(rowKey);
      if (!row || disposed) return;
      const item = itemInput(row);
      const favorites = store.getState().partitions.find(partition => partition.id === FAVORITES);
      const existing = favorites?.items.find(entry => entry.siteId === item.siteId && entry.channelId === item.channelId && entry.model === item.model);
      partitionCall(() => updatePartitionItem(transport, {partitionId: FAVORITES, item, ...(existing ? {remove: true} : {})}));
    },
    partitionMenu(rowKey: string | null): void { store.setState({partitionMenu: rowKey}); },
    assign(rowKey: string, partitionId: string): void {
      const row = rowOf(rowKey);
      store.setState({partitionMenu: null});
      if (!row || disposed) return;
      const item = itemInput(row);
      const exists = store.getState().partitions.find(partition => partition.id === partitionId)?.items
        .some(entry => entry.siteId === item.siteId && entry.channelId === item.channelId && entry.model === item.model);
      partitionCall(() => updatePartitionItem(transport, {partitionId, item, ...(exists ? {remove: true} : {})}));
    },
    createPartition(name: string): void { partitionCall(() => savePartition(transport, {name})); },
    renamePartition(id: string, name: string): void { partitionCall(() => savePartition(transport, {id, name})); },
    deletePartition(id: string): void { partitionCall(() => deletePartition(transport, id)); },
    updateItem(partitionId: string, key: string, patch: {remove?: boolean; tags?: string[]; api?: RelayApi}): void {
      const item = store.getState().partitions.find(partition => partition.id === partitionId)?.items.find(entry => entry.key === key);
      if (!item) return;
      partitionCall(() => updatePartitionItem(transport, {
        partitionId, ...patch,
        item: {key: `${item.siteId}:${item.channelId}:${item.model}`, siteId: item.siteId, channelId: item.channelId, model: item.model, brand: item.brand, supplier: item.supplier, channelName: item.channelName, testEndpoint: item.testEndpoint},
      }));
    },
    view(view: 'list' | 'favorites'): void { store.setState({view}); if (view === 'favorites') { loadPartitions(); resolveRefs(favoriteRefs()); } },
    currency(value: Currency): void { store.setState({currency: value}); },
    resolve: resolveRefs,
    retryMissing(): void {
      if (disposed || store.getState().retrying) return;
      store.setState({retrying: true});
      void retryMissingPages(transport, store.getState().siteId).then(status => {
        if (disposed) return;
        store.setState({status, retrying: false});
        schedulePoll();
      }).catch(error => { if (!disposed) store.setState({retrying: false, error: message(error, '补抓失败页请求失败')}); });
    },
    /** Drop a channel that no longer exists from every partition (the 已过期 quick-clear). */
    clearExpired(siteId: string, channelId: number, model: string): void {
      for (const partition of store.getState().partitions) {
        for (const item of partition.items) {
          if (item.siteId === siteId && item.channelId === channelId && item.model === model) {
            partitionCall(() => updatePartitionItem(transport, {partitionId: partition.id, remove: true, item: {key: `${item.siteId}:${item.channelId}:${item.model}`, siteId: item.siteId, channelId: item.channelId, model: item.model, brand: item.brand, supplier: item.supplier, channelName: item.channelName, testEndpoint: item.testEndpoint}}));
          }
        }
      }
    },
    poolOpen(partitionId: string, key: string): void {
      const item = store.getState().partitions.find(partition => partition.id === partitionId)?.items.find(entry => entry.key === key);
      if (!item) return;
      const guess = item.api ?? (/claude|anthropic/i.test(`${item.brand} ${item.model}`) ? 'messages' : item.testEndpoint === 'responses' ? 'responses' : 'chat');
      store.setState({pool: {partitionId, key, format: guess}});
    },
    poolFormat(format: RelayApi): void { const pool = store.getState().pool; if (pool) store.setState({pool: {...pool, format}}); },
    poolClose(): void { store.setState({pool: null}); },
    dispose(): void { disposed = true; revision++; clearPoll(); },
  };
}
