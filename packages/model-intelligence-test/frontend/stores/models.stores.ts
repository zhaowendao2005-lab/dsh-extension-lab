import { createStore } from 'zustand/vanilla';
import type { CatalogTransport, ModelsState } from '../types';
import { readCatalog } from './models.datasource';

export function createModelsDomain(transport: CatalogTransport, onCatalog: (keys: Set<string>) => void) {
  const store = createStore<ModelsState>(() => ({ items: [], providers: [], loading: false }));
  let disposed = false;
  let revision = 0;
  return {
    store,
    refresh(): void {
      if (disposed) return;
      const request = ++revision;
      store.setState({ loading: true, error: undefined });
      void readCatalog(transport).then(result => {
        if (disposed || request !== revision) return;
        store.setState({ ...result, loading: false, error: result.providers.some(provider => provider.error) ? '部分提供方读取失败；仅显示成功返回的真实模型。' : undefined });
        onCatalog(new Set(result.items.map(item => item.key)));
      }).catch(error => {
        if (disposed || request !== revision) return;
        store.setState({ items: [], providers: [], loading: false, error: error instanceof Error ? error.message : String(error) });
        onCatalog(new Set());
      });
    },
    dispose(): void { disposed = true; revision++; },
  };
}
