/**
 * Panel geometry is browser-local: it must survive a panel close/reopen without a
 * Host round-trip, and it is never a source of truth for anything else.
 * (docs/ui-spec.md §2 → 持久化)
 */
const KEY = 'workspace_ide/ui.layout';
const WORKBENCH_PREFIX = 'workspace_ide/ui.workbench.v1.';

export function loadLayout() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export const DEFAULT_EDITOR_PREFS = Object.freeze({
  fontSize: 13,
  wrap: true,
  tabSize: 2,
  indentSize: 2,
  defaultPreviewHtml: false,
  defaultPreviewMd: false,
});

/** Pure validation shared by persisted values, settings actions and editor instances.
 * Invalid updates keep the validated fallback; finite numbers are rounded and clamped.
 * tabSize displays existing tabs; indentSize controls spaces inserted by future indentation.
 */
export function normalizeEditorPrefs(source, fallback = DEFAULT_EDITOR_PREFS) {
  const prefs = { ...DEFAULT_EDITOR_PREFS };
  for (const candidate of [fallback, source]) {
    if (!candidate || typeof candidate !== 'object') continue;
    for (const [key, min, max] of [['fontSize', 10, 20], ['tabSize', 1, 8], ['indentSize', 1, 8]]) {
      if (Number.isFinite(candidate[key])) prefs[key] = Math.min(max, Math.max(min, Math.round(candidate[key])));
    }
    if (typeof candidate.wrap === 'boolean') prefs.wrap = candidate.wrap;
    if (typeof candidate.defaultPreviewHtml === 'boolean') prefs.defaultPreviewHtml = candidate.defaultPreviewHtml;
    if (typeof candidate.defaultPreviewMd === 'boolean') prefs.defaultPreviewMd = candidate.defaultPreviewMd;
  }
  return prefs;
}

/** Merge persisted editor preferences over the defaults (unknown keys are dropped). */
export function readEditorPrefs(stored) {
  return normalizeEditorPrefs(stored?.editor);
}

export function saveLayout(value) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private-mode storage failures must never break the panel.
  }
}

/**
 * Per-session workbench layout (tabs, groups, split tree). The Host right sidebar already
 * persists which host tab is open per session; this key keeps our internal arrangement in
 * the same scope so switching sessions never mixes two workspaces' tabs.
 */
export function loadWorkbench(sessionId) {
  if (!sessionId) return null;
  try {
    const raw = window.localStorage.getItem(WORKBENCH_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWorkbench(sessionId, value) {
  if (!sessionId) return;
  try {
    window.localStorage.setItem(WORKBENCH_PREFIX + sessionId, JSON.stringify(value));
  } catch {
    // Same rule as saveLayout: layout is a preference, never worth an error bar.
  }
}
