import { createStore } from 'zustand/vanilla';
import type { PresentationState } from '../types';
import { COLUMN_LABELS } from '../types';

export function createPresentationDomain() {
  const store = createStore<PresentationState>(() => ({ columns: ['stage', 'input', 'output', 'ttft', 'e2e', 'generation', 'cost', 'match', 'round'], widths: {}, expanded: {}, followLatest: true, columnsOpen: false, viewOpen: false, configOpen: false, filter: '' }));
  return {
    store,
    toggleColumn(id: string): void { if (Object.hasOwn(COLUMN_LABELS, id)) store.setState(state => ({ columns: state.columns.includes(id) ? state.columns.filter(item => item !== id) : [...state.columns, id] })); },
    resizeColumn(id: string, width: number): void { if (Number.isFinite(width)) store.setState(state => ({ widths: { ...state.widths, [id]: Math.max(72, Math.min(720, width)) } })); },
    toggleColumns(): void { store.setState(state => ({ columnsOpen: !state.columnsOpen })); },
    toggleView(): void { store.setState(state => ({ viewOpen: !state.viewOpen })); },
    toggleConfig(): void { store.setState(state => ({ configOpen: !state.configOpen })); },
    toggleRound(id: string, defaultExpanded: boolean): void { store.setState(state => ({ expanded: { ...state.expanded, [id]: !(state.expanded[id] ?? defaultExpanded) } })); },
    toggleFollow(): void { store.setState(state => ({ followLatest: !state.followLatest })); },
    setFilter(filter: string): void { store.setState({ filter }); },
    resetExpansion(): void { store.setState({ expanded: {} }); },
  };
}
