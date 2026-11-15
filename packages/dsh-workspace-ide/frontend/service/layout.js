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

export const DEFAULT_EDITOR_PREFS = { fontSize: 13, wrap: true, tabSize: 2 };

/** Merge persisted editor preferences over the defaults (unknown keys are dropped). */
export function readEditorPrefs(stored) {
  const prefs = { ...DEFAULT_EDITOR_PREFS };
  const source = stored?.editor;
  if (source && typeof source === 'object') {
    if (Number.isFinite(source.fontSize)) prefs.fontSize = Math.min(20, Math.max(10, Math.round(source.fontSize)));
    if (typeof source.wrap === 'boolean') prefs.wrap = source.wrap;
    if (Number.isFinite(source.tabSize)) prefs.tabSize = Math.min(8, Math.max(1, Math.round(source.tabSize)));
  }
  return prefs;
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
