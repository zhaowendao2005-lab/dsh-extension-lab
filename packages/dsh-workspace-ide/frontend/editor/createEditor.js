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

const LIMITS = {
  wrapMaxLines: 2000,
  wrapMaxLineChars: 500,
  syntaxMaxBytes: 4 * 1024 * 1024,
  historyMaxBytes: 2 * 1024 * 1024,
};

export function createEditor({ parent, doc = '', languageId = 'plaintext', readOnly = false, prefs, onChange, onCursor, onSave }) {
  const languageLane = new Compartment();
  const readOnlyLane = new Compartment();
  const wrapLane = new Compartment();
  const prefsLane = new Compartment();
  const fontSize = prefs?.fontSize ?? 13;
  const tabSize = prefs?.tabSize ?? 2;
  const size = doc.length;
  const lineCount = countLines(doc);
  const longLine = longestLine(doc) > LIMITS.wrapMaxLineChars;
  const big = size > LIMITS.syntaxMaxBytes;
  const degrade = {
    syntax: !big,
    wrap: lineCount <= LIMITS.wrapMaxLines && !longLine,
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
    prefsLane.of(prefsExtension({ fontSize, tabSize })),
    wrapLane.of(degrade.wrap && (prefs?.wrap ?? true) ? EditorView.lineWrapping : []),
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

  return {
    view,
    degrade,
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
      view.dispatch({ effects: wrapLane.reconfigure(next ? EditorView.lineWrapping : []) });
    },
    setPrefs(next) {
      view.dispatch({
        effects: [
          prefsLane.reconfigure(prefsExtension(next)),
          wrapLane.reconfigure(next.wrap && degrade.wrap ? EditorView.lineWrapping : []),
        ],
      });
    },
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

/** Font size and tab width come from panel settings, never from the theme. */
function prefsExtension({ fontSize, tabSize }) {
  return [
    EditorView.theme({ '&': { fontSize: `${fontSize}px` }, '.cm-content': { tabSize: String(tabSize) } }),
    EditorState.tabSize.of(tabSize),
  ];
}

function readOnlyExtensions(readOnly) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

function languageExtension(languageId) {
  const support = languageSupport(languageId);
  return support ? [support] : [];
}

function countLines(text) {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) lines += 1;
  return lines;
}

function longestLine(text) {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      longest = Math.max(longest, current);
      current = 0;
    } else {
      current += 1;
    }
  }
  return Math.max(longest, current);
}
