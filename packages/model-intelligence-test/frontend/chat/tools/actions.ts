/**
 * Host interactions the read-only mirror cannot perform yet.
 *
 * DSH binds these to the live Session (file preview, recorded-context menus,
 * trajectory navigation). A mirror row keeps the affordance and its DOM, and
 * routes the action here so the host can be wired later in one place.
 */

/** Where the Host should land a previewed file. */
export interface OpenFileOptions {
  /** 1-based line to scroll to inside the file. */
  line?: number | undefined;
}

/**
 * Open a recorded file path in the Host's preview surface.
 * @param path - path as the tool recorded it.
 * @param options - optional target line.
 */
export function openFile(path: string, options?: OpenFileOptions): void {
  // TODO(host): ask the Host transport to open `path` at `options?.line`.
  void path;
  void options;
}

/**
 * Bind the Host's file context menu to one path.
 * @param path - path the gesture belongs to.
 * @returns trigger props for the summary link, or undefined while unbound.
 */
export function fileContextMenuProps(path: string): { onContextMenu?: () => void } | undefined {
  // TODO(host): return the Host's context-menu trigger props for `path`.
  void path;
  return undefined;
}

/**
 * Bind the Host's URL context menu to one link.
 * @param url - the http(s) URL the gesture belongs to.
 * @returns trigger props for the summary link, or undefined while unbound.
 */
export function urlContextMenuProps(url: string): { onContextMenu?: () => void } | undefined {
  // TODO(host): return the Host's context-menu trigger props for `url`.
  void url;
  return undefined;
}

/**
 * Jump from the mirror row to the same call in the Host's trajectory view.
 * @param toolName - wire tool name of the call.
 */
export function inspectCall(toolName: string): void {
  // TODO(host): navigate the Host to this call's trajectory record.
  void toolName;
}
