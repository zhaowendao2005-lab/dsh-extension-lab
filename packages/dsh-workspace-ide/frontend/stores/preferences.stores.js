/**
 * Browser-global workbench preferences: the whole-surface scale and the editor
 * preferences every view shares. They are not session state (two sessions show the
 * same user preferences) and they are not Host state (a preference never needs a
 * round-trip), so one store owns them for the whole client module.
 *
 * The percentage is a real number, not a fixed preset: the Settings page lets the
 * user type any value inside UI_SCALE_MIN..UI_SCALE_MAX, and the surface applies it
 * with CSS zoom (a percentage is not an integer layout unit).
 */
import { createStore } from '../store.js';
import {
  DEFAULT_EDITOR_PREFS, loadLayout, normalizeEditorPrefs, readEditorPrefs, saveLayout,
} from '../service/layout.js';

export const UI_SCALE_MIN = 50;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_DEFAULT = 100;

/** Persisted/action value → a usable percentage. Invalid input keeps the fallback. */
export function normalizeUiScale(value, fallback = UI_SCALE_DEFAULT) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number);
  if (rounded < UI_SCALE_MIN || rounded > UI_SCALE_MAX) return fallback;
  return rounded;
}

/**
 * Typed text → percentage. The unit is optional ("125" and "125%" are the same),
 * decimals round to the nearest integer, and anything else reports why it failed so
 * the field can explain itself instead of silently overwriting the stored value.
 */
export function parseUiScaleText(text) {
  const raw = String(text ?? '').trim().replace(/[%％]$/, '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return { ok: false, reason: 'nan' };
  const rounded = Math.round(Number(raw));
  if (!Number.isFinite(rounded) || rounded < UI_SCALE_MIN || rounded > UI_SCALE_MAX) {
    return { ok: false, reason: 'range' };
  }
  return { ok: true, value: rounded };
}

/** Message shown under the scale field for a rejected draft. */
export function uiScaleErrorText(reason) {
  if (reason === 'range') return `请输入 ${UI_SCALE_MIN}–${UI_SCALE_MAX} 之间的整数百分比。`;
  if (reason === 'empty') return '请输入百分比，例如 125。';
  return '请输入数字百分比，例如 125 或 125%。';
}

/** Merge new preferences over whatever else the layout key holds (geometry, sizes). */
function persist(store) {
  const state = store.getSnapshot();
  saveLayout({ ...loadLayout(), uiScale: state.uiScale, editor: state.editor });
}

export function createPreferences() {
  const persisted = loadLayout();
  const store = createStore({
    uiScale: normalizeUiScale(persisted.uiScale),
    editor: readEditorPrefs(persisted),
  });
  // Draft text for the percentage input: transient, never persisted.
  const draft = createStore({ scaleText: null, error: null });

  const actions = {
    setUiScale(value) {
      const next = normalizeUiScale(value, store.getSnapshot().uiScale);
      if (next !== store.getSnapshot().uiScale) {
        store.patch({ uiScale: next });
        persist(store);
      }
      draft.set({ scaleText: null, error: null });
      return next;
    },

    setEditorPref(key, value) {
      const editor = normalizeEditorPrefs({ [key]: value }, store.getSnapshot().editor);
      store.patch({ editor });
      persist(store);
      return editor;
    },

    reset() {
      store.patch({ uiScale: UI_SCALE_DEFAULT, editor: { ...DEFAULT_EDITOR_PREFS } });
      draft.set({ scaleText: null, error: null });
      persist(store);
    },

    /** Live edit of the percentage field; the stored value is untouched until commit. */
    setScaleDraft(text) {
      draft.set({ scaleText: String(text ?? ''), error: null });
    },

    /** Enter/blur: accept a valid draft, otherwise explain the problem and keep it editable. */
    commitScaleDraft() {
      const text = draft.getSnapshot().scaleText;
      if (text == null) return { ok: true };
      const parsed = parseUiScaleText(text);
      if (!parsed.ok) {
        draft.set({ error: uiScaleErrorText(parsed.reason) });
        return parsed;
      }
      actions.setUiScale(parsed.value);
      return parsed;
    },

    /** Escape: drop the draft and show the stored value again. */
    cancelScaleDraft() {
      draft.set({ scaleText: null, error: null });
    },

    dispose() {
      store.dispose();
      draft.dispose();
    },
  };

  return { store, draft, actions };
}
