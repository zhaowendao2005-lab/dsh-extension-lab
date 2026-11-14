/**
 * Panel geometry is browser-local: it must survive a panel close/reopen without a
 * Host round-trip, and it is never a source of truth for anything else.
 * (docs/ui-spec.md §2 → 持久化)
 */
const KEY = 'workspace_ide/ui.layout';

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
