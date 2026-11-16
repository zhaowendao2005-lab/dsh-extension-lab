import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { normalizeEditorPrefs } from '../service/layout.js';

export const EDITOR_WRAP_LIMITS = Object.freeze({ maxLines: 2000, maxLineChars: 500 });

/** Derive actual wrapping from the current buffer, without persisting a second preference.
 * Accepts a string or CodeMirror Text. A disabled preference needs no document scan.
 */
export function getEditorWrapState(doc, prefs) {
  const requested = normalizeEditorPrefs(prefs).wrap;
  if (!requested) return { requested, enabled: false, reason: null };
  const reason = wrapBlockReason(doc);
  return { requested, enabled: !reason, reason };
}

/** Both sides share one wrap policy so split/unified layouts behave consistently. */
export function getDiffWrapState(sides, prefs) {
  const oldSide = getEditorWrapState(sides?.oldText ?? '', prefs);
  const newSide = getEditorWrapState(sides?.newText ?? '', prefs);
  return { requested: oldSide.requested, enabled: oldSide.enabled && newSide.enabled, reason: oldSide.reason ?? newSide.reason };
}

/** The only font-size source for ordinary and diff editors. Reconfiguration is effect-only.
 * The computed content attribute is the same class used by EditorView.lineWrapping;
 * depending on doc makes crossing a safety threshold take effect in the same transaction.
 */
export function editorPrefsExtension(source, { wrapAllowed = true } = {}) {
  const prefs = normalizeEditorPrefs(source);
  return [
    EditorView.theme({ '&': { fontSize: prefs.fontSize + 'px' } }),
    EditorState.tabSize.of(prefs.tabSize),
    indentUnit.of(' '.repeat(prefs.indentSize)),
    EditorView.contentAttributes.compute(['doc'], (state) => (
      wrapAllowed && getEditorWrapState(state.doc, prefs).enabled ? { class: 'cm-lineWrapping' } : {}
    )),
  ];
}

function wrapBlockReason(doc) {
  const { maxLines, maxLineChars } = EDITOR_WRAP_LIMITS;
  if (typeof doc !== 'string') {
    if (doc.lines > maxLines) return '自动换行已暂停：文本超过 ' + maxLines + ' 行';
    for (let index = 1; index <= doc.lines; index += 1) {
      if (doc.line(index).length > maxLineChars) return '自动换行已暂停：单行超过 ' + maxLineChars + ' 字符';
    }
    return null;
  }
  let lines = 1;
  let lineChars = 0;
  for (let index = 0; index < doc.length; index += 1) {
    const code = doc.charCodeAt(index);
    if (code === 10 || code === 13) {
      // Match EditorState's default line splitting, including CRLF and lone CR.
      if (code === 13 && doc.charCodeAt(index + 1) === 10) index += 1;
      lines += 1;
      lineChars = 0;
      if (lines > maxLines) return '自动换行已暂停：文本超过 ' + maxLines + ' 行';
    } else {
      lineChars += 1;
      if (lineChars > maxLineChars) return '自动换行已暂停：单行超过 ' + maxLineChars + ' 字符';
    }
  }
  return null;
}
