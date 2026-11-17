/**
 * File preview classification, default-render preference resolution,
 * and media Blob URL helpers for images/videos.
 */

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];

export function previewKindForPath(path) {
  if (typeof path !== 'string' || !path) return null;
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (IMAGE_EXTS.some((ext) => lower.endsWith(ext))) return 'image';
  if (VIDEO_EXTS.some((ext) => lower.endsWith(ext))) return 'video';
  return null;
}

export function isToggleablePreviewPath(path) {
  if (typeof path !== 'string' || !path) return false;
  const kind = previewKindForPath(path);
  if (kind === 'html' || kind === 'markdown') return true;
  return path.toLowerCase().endsWith('.svg');
}

export function defaultPreviewForPath(path, editorPrefs) {
  const kind = previewKindForPath(path);
  if (kind === 'html') return Boolean(editorPrefs?.defaultPreviewHtml);
  if (kind === 'markdown') return Boolean(editorPrefs?.defaultPreviewMd);
  return false;
}

export function base64ToBytes(base64) {
  if (!base64) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function mediaChunksToBlobUrl(chunks, mime) {
  const arrays = chunks.map((chunk) => base64ToBytes(chunk));
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    const blob = new Blob(arrays, { type: mime || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }
  return null;
}

export function revokeMediaUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

export function formatMediaSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
