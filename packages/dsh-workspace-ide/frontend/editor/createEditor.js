/**
 * Thin owner of one CodeMirror view. Everything that varies per file (language, wrap,
 * read-only, large-file degradation) lives in compartments so switching a tab's language
 * never rebuilds the view state.
 */
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { languageSupport } from './languages.js';
import { editorThemeExtension } from './theme.js';
import { editorPrefsExtension, getEditorWrapState } from './preferences.js';
import { normalizeEditorPrefs } from '../service/layout.js';

const LIMITS = {
  syntaxMaxBytes: 4 * 1024 * 1024,
  historyMaxBytes: 2 * 1024 * 1024,
};

export function createEditor({ parent, doc = '', languageId = 'plaintext', readOnly = false, prefs, onChange, onCursor, onSave }) {
  const languageLane = new Compartment();
  const readOnlyLane = new Compartment();
  const prefsLane = new Compartment();
  let currentPrefs = normalizeEditorPrefs(prefs);
  const size = doc.length;
  const big = size > LIMITS.syntaxMaxBytes;
  const degrade = {
    syntax: !big,
    history: size <= LIMITS.historyMaxBytes,
  };

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    foldGutter(),
    highlightSelectionMatches(),
    keymap.of([
      ...(onSave ? [{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }] : []),
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    editorThemeExtension(),
    prefsLane.of(editorPrefsExtension(currentPrefs)),
    readOnlyLane.of(readOnlyExtensions(readOnly)),
    languageLane.of(degrade.syntax ? languageExtension(languageId) : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) onChange(update.state.doc.toString());
      if (update.selectionSet && onCursor) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        onCursor({ line: line.number, column: head - line.from + 1 });
      }
    }),
  ];
  if (degrade.history) extensions.push(history());

  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });

  function setPrefs(next) {
    const normalized = normalizeEditorPrefs(next, currentPrefs);
    if (Object.keys(normalized).every((key) => normalized[key] === currentPrefs[key])) return;
    currentPrefs = normalized;
    // Effects only: keep the document, selection and undo history intact.
    view.dispatch({ effects: prefsLane.reconfigure(editorPrefsExtension(currentPrefs)) });
  }

  return {
    view,
    get degrade() {
      return { ...degrade, wrap: getEditorWrapState(view.state.doc, { wrap: true }).enabled };
    },
    focus() {
      view.focus();
    },
    value() {
      return view.state.doc.toString();
    },
    setLanguage(nextId) {
      view.dispatch({ effects: languageLane.reconfigure(languageExtension(nextId)) });
    },
    setReadOnly(next) {
      view.dispatch({ effects: readOnlyLane.reconfigure(readOnlyExtensions(next)) });
    },
    setWrap(next) {
      setPrefs({ wrap: next });
    },
    setPrefs,
    /** Put the cursor on a 1-based line/column and scroll it into view. */
    gotoLine(line, column = 1) {
      const doc = view.state.doc;
      const target = doc.line(Math.min(Math.max(1, line), doc.lines));
      const pos = Math.min(target.from + Math.max(0, column - 1), target.to);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
    },

    /** Replace the whole document without polluting the undo history. */
    reset(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    destroy() {
      view.destroy();
    },
  };
}

function readOnlyExtensions(readOnly) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

function languageExtension(languageId) {
  const support = languageSupport(languageId);
  return support ? [support] : [];
}
