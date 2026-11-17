/**
 * File preview classification and default-render preference resolution.
 * Supports HTML (.html/.htm) and Markdown (.md/.markdown).
 */

export function previewKindForPath(path) {
  if (typeof path !== 'string' || !path) return null;
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return null;
}

export function defaultPreviewForPath(path, editorPrefs) {
  const kind = previewKindForPath(path);
  if (kind === 'html') return Boolean(editorPrefs?.defaultPreviewHtml);
  if (kind === 'markdown') return Boolean(editorPrefs?.defaultPreviewMd);
  return false;
}
