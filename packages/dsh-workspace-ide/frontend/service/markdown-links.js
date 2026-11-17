/**
 * Pure link/image-source classification for the Markdown preview. The pane never navigates
 * the Host page: workspace-relative targets are handed to the workbench, `#anchor` scrolls
 * inside the pane, http/https/mailto open in a new tab and everything else (`javascript:`,
 * `data:`, `file:`, …) renders inert.
 */

const EXTERNAL = /^(https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve a relative reference against the document that contains it.
 * `docs/guide.md` + `../img/logo.png` → `img/logo.png`; a leading `/` is workspace-root
 * relative, like VS Code. Returns '' when the reference is empty or scheme-qualified.
 */
export function resolveWorkspacePath(basePath, href) {
  const raw = String(href ?? '').replace(/[?#][\s\S]*$/, '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the literal text: a malformed escape must not blank the link.
  }
  if (!decoded || SCHEME.test(decoded)) return '';
  const base = decoded.startsWith('/') ? [] : String(basePath ?? '').split('/').slice(0, -1);
  const segments = [];
  for (const part of [...base, ...decoded.split('/')]) {
    if (!part || part === '.') continue;
    if (part === '..') {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

/**
 * `{ kind: 'anchor' | 'external' | 'file' | 'inert' }`.
 * `inert` also covers a bare `#` and any target that cannot be resolved.
 */
export function classifyHref(href, basePath) {
  const value = String(href ?? '').trim();
  if (!value) return { kind: 'inert' };
  if (value.startsWith('#')) return value.length > 1 ? { kind: 'anchor', href: value } : { kind: 'inert' };
  if (value.startsWith('//')) return { kind: 'external', href: `https:${value}` };
  if (EXTERNAL.test(value)) return { kind: 'external', href: value };
  const path = resolveWorkspacePath(basePath, value);
  return path ? { kind: 'file', path } : { kind: 'inert' };
}
