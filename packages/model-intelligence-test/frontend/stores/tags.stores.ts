import {createStore} from 'zustand/vanilla';
import type {ModelIntelligenceTransport, TagsState} from '../types';
import {readTags, writeTags} from './tags.datasource';

const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

/** Global tag map: one Host-persisted source for favorites, test results and filters. */
export function createTagsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<TagsState>(() => ({map: {}, loaded: false, menu: null, query: '', category: 'all'}));
  let disposed = false;
  let loading = false;

  function load(): void {
    if (disposed || loading) return;
    loading = true;
    void readTags(transport).then(map => { if (!disposed) store.setState({map, loaded: true, error: undefined}); })
      .catch(error => { if (!disposed) store.setState({error: message(error, '读取标签失败')}); })
      .finally(() => { loading = false; });
  }
  function set(target: string, tags: string[]): void {
    if (disposed) return;
    // Optimistic: the Host answer replaces the whole map, so a rejected write rolls back.
    const before = store.getState().map;
    store.setState({map: {...before, ...(tags.length ? {[target]: tags} : {})}});
    if (!tags.length) { const next = {...store.getState().map}; delete next[target]; store.setState({map: next}); }
    void writeTags(transport, target, tags).then(map => { if (!disposed) store.setState({map, error: undefined}); })
      .catch(error => { if (!disposed) store.setState({map: before, error: message(error, '保存标签失败')}); });
  }
  return {
    store,
    load,
    set,
    toggle(target: string, tag: string): void {
      const current = store.getState().map[target] ?? [];
      set(target, current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]);
    },
    menu(target: string | null): void { store.setState({menu: target, query: '', category: 'all'}); },
    query(query: string): void { store.setState({query}); },
    category(category: string): void { store.setState({category}); },
    dispose(): void { disposed = true; },
  };
}
