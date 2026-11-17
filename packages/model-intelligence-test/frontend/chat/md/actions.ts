/**
 * Host interactions the ported Markdown layer cannot perform on its own.
 *
 * The reference implementation receives these capabilities from the DSH Client
 * shell: opening an external link in the system browser, revealing a workspace
 * file, driving an OS-level file drag out of the window, and opening the
 * object context menu. None of that exists inside this plugin's embedded
 * read-only session mirror, so every action stays a no-op and the markup it
 * decorates — anchors, file-link buttons, draggable images, context-menu seats —
 * is kept exactly as the original rendered it.
 *
 * A caller that can provide the real behaviour passes its own implementation
 * where a delegate accepts one; the exports here are the defaults.
 *
 * TODO(host): route these to the DSH Host once the plugin may open files,
 * external URLs, OS drags, and object menus.
 */
import type { HTMLAttributes } from 'react'
import type { FileDragActions, FileDragSource, PreparedFileDrag } from './file-drag-actions'
import type { MarkdownExternalLinkHandler, MarkdownMenuTarget } from './MarkdownDelegate'

/**
 * Open an absolute HTTP(S) destination selected from Markdown.
 * @param href - destination URL.
 */
export const openExternalLink: MarkdownExternalLinkHandler = (href: string): void => {
  // TODO(host): hand `href` to the host's external browser opener.
  void href
}

/**
 * Open a decoded local destination selected from Markdown.
 * @param path - absolute or workspace-relative file path.
 * @param options - first line to reveal when the destination specifies one.
 */
export function openFile(path: string, options?: { line?: number }): void {
  // TODO(host): reveal `path` (and `options.line`) in the host workspace.
  void path
  void options
}

/**
 * Context-menu seats of one Markdown object; the host owns the menu itself.
 * @param target - the object the gesture applies to.
 * @returns no trigger props, so the native context menu stays in charge.
 */
export function getMarkdownMenuTriggerProps(
  target: MarkdownMenuTarget,
): Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'> {
  // TODO(host): return the object menu's trigger props for `target`.
  void target
  return {}
}

/** Started transfer that reports "native dragging did not take over" and releases nothing. */
const inertPreparedFileDrag: PreparedFileDrag = {
  /** @returns false, meaning the browser keeps its own drag image and payload. */
  start: (): boolean => false,
  /** Release nothing: no resource was prepared. */
  release: (): void => {},
}

/**
 * Prepare a file export from a draggable Markdown object.
 * @param source - file content and export name.
 * @param signal - preparation cancellation.
 * @returns a prepared operation that never starts a transfer.
 */
export async function prepareFileDrag(source: FileDragSource, signal: AbortSignal): Promise<PreparedFileDrag> {
  // TODO(host): authorize the export with the host and hand back a real transfer.
  void source
  void signal
  return inertPreparedFileDrag
}

/** Display the owner's localized export-failure message. */
export function reportFileDragFailure(): void {
  // TODO(host): surface the export failure through the host's notice surface.
}

/** Default file-drag capability for draggable Markdown images. */
export const fileDrag: FileDragActions = {
  prepare: prepareFileDrag,
  reportFailure: reportFileDragFailure,
}
