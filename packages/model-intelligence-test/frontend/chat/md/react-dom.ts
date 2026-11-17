/**
 * Portal shim. The plugin runtime hands this package React but not ReactDOM, so
 * `createPortal` cannot mount into another container. Every call site keeps its
 * structure: the portal content renders in place instead of at the document
 * root, which is the only observable difference.
 * TODO(host): forward to the runtime's ReactDOM once the plugin runtime exposes it.
 */
import type { ReactNode } from 'react'

/**
 * Render `children` where the portal component sits.
 * @param children - portal content.
 * @param container - the container the content would mount into; unused here.
 * @returns the children, rendered inline.
 */
export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode {
  void container
  return children
}
