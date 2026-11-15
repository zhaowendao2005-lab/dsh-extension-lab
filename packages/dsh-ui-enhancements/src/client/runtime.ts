/**
 * React & ReactDOM runtime holder. The DSH ModuleLoader injects the shared
 * host modules at factory time (`require('react')`, `require('react-dom/client')`).
 */
import type * as ReactTypes from 'react'

export interface RootHandle {
  render(children: ReactTypes.ReactNode): void
  unmount(): void
}

export interface ReactDOMClientLike {
  createRoot(container: Element | DocumentFragment): RootHandle
}

const React = {} as typeof ReactTypes
let reactDomClient: ReactDOMClientLike | null = null

export default React

export function setReact(value: typeof ReactTypes, domClient?: ReactDOMClientLike): void {
  Object.assign(React, value)
  if (domClient) reactDomClient = domClient
}

export function createRoot(container: Element | DocumentFragment): RootHandle | null {
  return reactDomClient ? reactDomClient.createRoot(container) : null
}

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export function useSnapshot<T>(store: SnapshotStore<T>): T {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
