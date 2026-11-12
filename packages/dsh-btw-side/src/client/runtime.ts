/**
 * React runtime holder. The DSH ModuleLoader injects the shared React module at
 * factory time (`require('react')`); React is never bundled into the plugin.
 * Components import the default object from here, so `React.createElement` and
 * the hooks resolve after `setReact()` has populated it.
 */
import type * as ReactTypes from 'react'

const React = {} as typeof ReactTypes

export default React

export function setReact(value: typeof ReactTypes): void {
  Object.assign(React, value)
}

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export function useSnapshot<T>(store: SnapshotStore<T>): T {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
