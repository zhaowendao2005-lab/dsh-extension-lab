/**
 * Editor theming. Tokens only: the panel must repaint with the host theme, and R8 forbids
 * colour literals, so every value here is a `--dsw-*` / `--wid-*` custom property.
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'var(--dsw-alias-bg-base)',
    fontSize: 'var(--dsh-code-font-size, 13px)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--ds-font-family-code)',
    lineHeight: '1.5',
  },
  '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--dsw-alias-bg-document-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-bg-layer-1)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-tertiary)',
    borderRight: '1px solid var(--dsw-alias-border-l1)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-selectionMatch': { backgroundColor: 'var(--dsw-alias-bg-layer-2)' },
  '.cm-searchMatch': { backgroundColor: 'var(--dsw-alias-bg-layer-2)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--dsw-alias-bg-document-selection)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--dsw-alias-border-l1)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--dsw-alias-bg-layer-2)',
    border: '1px solid var(--dsw-alias-border-l1)',
    color: 'var(--dsw-alias-label-primary)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--dsw-alias-bg-layer-2)',
    outline: '1px solid var(--dsw-alias-border-l2)',
  },
  '.cm-placeholder': { color: 'var(--dsw-alias-label-tertiary)' },
});

export const editorHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--wid-syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--wid-syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--wid-syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--wid-syn-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--wid-syn-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--wid-syn-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--wid-syn-property)' },
  { tag: [tags.tagName], color: 'var(--wid-syn-tag)' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: 'var(--wid-syn-variable)' },
  { tag: [tags.heading, tags.strong], fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--wid-syn-link)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--dsw-alias-state-error-primary)' },
]);

export function editorThemeExtension() {
  return [editorTheme, syntaxHighlighting(editorHighlight)];
}
