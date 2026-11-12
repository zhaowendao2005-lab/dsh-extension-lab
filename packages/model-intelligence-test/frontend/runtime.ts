import type * as ReactTypes from 'react';
import type { Store } from './types';
// Runtime methods are installed by the DSH ModuleLoader before rendering; React is never bundled.
const React = {} as typeof ReactTypes;
export default React;
export let createElement: typeof ReactTypes.createElement;
export let useEffect: typeof ReactTypes.useEffect;
export let useLayoutEffect: typeof ReactTypes.useLayoutEffect;
export let useMemo: typeof ReactTypes.useMemo;
export let useRef: typeof ReactTypes.useRef;
export function setReact(value: typeof ReactTypes) {
  Object.assign(React, value);
  ({ createElement, useEffect, useLayoutEffect, useMemo, useRef } = value);
}
export function useStore<T, U>(store: Store<T>, selector: (state: T) => U): U {
  const getSnapshot = React.useMemo(() => {
    let initialized = false;
    let previousState: T;
    let previousValue: U;
    return () => {
      const state = store.getState();
      if (!initialized || !Object.is(state, previousState)) {
        previousState = state;
        previousValue = selector(state);
        initialized = true;
      }
      return previousValue;
    };
  }, [store, selector]);
  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
