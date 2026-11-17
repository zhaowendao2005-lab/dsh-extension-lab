// Host clipboard write shared by the vendored copy controls. Success feedback
// stays with each control; this helper reports whether the host accepted a
// write and leaves focus where it found it.

/**
 * Attempt the async Clipboard API write.
 * @param text - the exact text to place on the clipboard.
 * @returns true only when the host accepted the write.
 */
async function writeWithClipboardApi(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    // A denied permission can block the async API while execCommand still works; the caller tries it below.
    return false;
  }
  return true;
}

/**
 * Write text to the host clipboard, preferring the async Clipboard API and
 * falling back to `execCommand('copy')` when that API is missing or refuses the
 * write.
 * @param text - the exact text to place on the clipboard.
 * @returns true only when the host accepted the write.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  // lib.dom types clipboard non-optional, but insecure contexts omit it.
  if (typeof navigator.clipboard?.writeText === 'function') {
    if (await writeWithClipboardApi(text)) return true;
  }
  const exec = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : undefined;
  if (exec === undefined) return false;
  // Selecting the textarea moves focus; return it so a keyboard user stays on the copy control.
  const focused = document.activeElement;
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  try {
    document.body.appendChild(el);
    el.select();
    return exec('copy');
  } catch {
    return false;
  } finally {
    el.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
