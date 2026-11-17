/**
 * React is injected by the DSH ModuleLoader (`require('react')`), so it is never
 * bundled — two copies of React would break hooks across the host tree.
 * Views import the live bindings below instead of receiving React as a prop.
 */
let React = null;
let ReactDom = null;

/** The host owns ReactDOM too; never bundle a second renderer for an overlay. */
export function setReactDom(renderer) {
  ReactDom = renderer;
}

export function canCreatePortal() {
  return typeof ReactDom?.createPortal === 'function' && typeof Element !== 'undefined'
    && typeof Element.prototype.attachShadow === 'function';
}

export function createPortal(children, target) {
  if (!canCreatePortal()) throw new Error('workspace-ide: isolated full view is unavailable');
  return ReactDom.createPortal(children, target);
}

export let Fragment = null;

export function setReact(runtime) {
  React = runtime;
  Fragment = runtime.Fragment;
}

function runtime() {
  if (!React) {
    throw new Error(
      'workspace-ide: React runtime was not injected yet (JSX may only run inside components)'
    );
  }
  return React;
}

/**
 * The JSX factory handed to esbuild (`--jsx-factory=h`). It reads React at call
 * time, so a module may declare components freely; it must not evaluate JSX at
 * module scope, because factories run before the ModuleLoader calls `apply`.
 */
export function h(type, props, ...children) {
  const react = runtime();
  return children.length > 0
    ? react.createElement(type, props, ...children)
    : react.createElement(type, props);
}

/** Quiet bridge from a store's subscribe/getSnapshot pair to React. */
export function useStore(store) {
  return runtime().useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useEffect(...args) {
  return runtime().useEffect(...args);
}

export function useLayoutEffect(...args) {
  return runtime().useLayoutEffect(...args);
}

export function useRef(...args) {
  return runtime().useRef(...args);
}

/** Only for bundled third-party components (react-bridge.js); views stay stateless (R4). */
export function useState(...args) {
  return runtime().useState(...args);
}

export function useMemo(...args) {
  return runtime().useMemo(...args);
}

export function useCallback(...args) {
  return runtime().useCallback(...args);
}

export function useReducer(...args) {
  return runtime().useReducer(...args);
}

export function useContext(...args) {
  return runtime().useContext(...args);
}

export function createContext(...args) {
  return runtime().createContext(...args);
}

export function memo(component) {
  return runtime().memo(component);
}
