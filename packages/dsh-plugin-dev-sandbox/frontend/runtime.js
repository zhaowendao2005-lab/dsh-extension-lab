/**
 * React is injected by the DSH ModuleLoader (`require('react')`), so it is never
 * bundled. Views import the live bindings below instead of receiving it as a prop.
 */
let React = null;

export let h = null;
export let Fragment = null;

export function setReact(runtime) {
  React = runtime;
  h = runtime.createElement;
  Fragment = runtime.Fragment;
}

/** One-line bridge from the store's subscribe/getSnapshot pair to React. */
export function useStore(store) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useEffect(...args) { return React.useEffect(...args); }
export function useRef(...args) { return React.useRef(...args); }
