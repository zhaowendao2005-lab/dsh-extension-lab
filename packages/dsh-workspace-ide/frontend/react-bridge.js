/**
 * React bridge for bundled third-party components (currently `react-markdown`).
 *
 * The plugin never ships React: the DSH ModuleLoader hands the Host copy to `runtime.js`
 * and two copies would break hooks. Libraries installed from npm import React themselves,
 * which under our IIFE build would emit a bare `require('react')` at bundle top level — the
 * Host only provides `require` inside the ModuleLoader factory, so that throws before
 * `apply()` runs (docs/build.md §3, rule R12's rationale).
 *
 * `scripts/build.mjs` resolves `react` and `react/jsx-runtime` here through an esbuild
 * `onResolve` hook, so every bundled component shares the single injected runtime.
 */
export {
  Fragment,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from './runtime.js';

import { h } from './runtime.js';

/** `createElement` is the same lazy React lookup as the JSX factory. */
export const createElement = h;

/**
 * Automatic-runtime entry point. React reads `key` from the element config rather than from
 * props, so it is folded into the config here instead of being forwarded as a child.
 */
export function jsx(type, props, key) {
  return key === undefined ? h(type, props) : h(type, { ...props, key });
}

export const jsxs = jsx;
export const jsxDEV = jsx;
