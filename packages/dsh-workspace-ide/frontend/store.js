/**
 * Minimal observable store. `useStore` re-renders on every `set`, which is fine
 * for this panel: each domain keeps its state small and its rows are virtualised.
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next || typeof next !== 'object') return state;
      state = next;
      for (const listener of [...listeners]) listener();
      return state;
    },
    patch(patch) {
      return store.set({ ...state, ...patch });
    },
    get state() {
      return state;
    },
    dispose() {
      listeners.clear();
    },
  };
  return store;
}
