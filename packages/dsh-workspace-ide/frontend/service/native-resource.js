/**
 * Pure helpers to build `dsh-resource://file/session/…` URIs so files opened inside the
 * IDE workbench can be handed off to DSH's native right-sidebar document previewer.
 */

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

function encodePath(filePath) {
  return filePath.split('/').map(encodeSegment).join('/');
}

/**
 * Build a session-scoped DSH file resource address matching `@deepseek-ai/dsh-util-workspace-path`.
 * Backslashes are normalized to `/` and leading `./` prefixes are dropped.
 */
export function buildSessionFileAddress(sessionId, filePath) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof filePath !== 'string' || !filePath) return null;
  const normalized = filePath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!normalized) return null;
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/**
 * Resolve the path passed to `buildSessionFileAddress`.
 * When the workbench is on the session's own cwd (`source === 'session'`), keep the relative
 * path so the native header displays the short project path; when switched to another root,
 * pass the absolute path under `workspace.root` so the Host reads from that directory.
 */
export function resolveNativeOpenPath(relPath, workspace) {
  if (typeof relPath !== 'string' || !relPath) return null;
  const clean = relPath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!clean) return null;
  if (/^(?:\/|[A-Za-z]:[/\\])/.test(clean)) return clean;
  if (workspace?.source === 'session') return clean;
  const root = typeof workspace?.root === 'string'
    ? workspace.root.replace(/\\/g, '/').replace(/\/+$/, '')
    : '';
  if (!root) return clean;
  return `${root}/${clean}`;
}
