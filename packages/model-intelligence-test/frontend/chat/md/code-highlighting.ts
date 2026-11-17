/** Shared filename-to-grammar selection and lazy line highlighter for source views. */
import React from '../../runtime'
import {
  grammarLoadCount, highlightLines, subscribeGrammarLoaded, type HighlightSpan,
} from './highlight'
// The single extension table lives in `./code-language`, copied verbatim from the
// shared util; re-export it so callers keep importing the language selector and
// the preview registry's suffix list from this module.
export { CODE_HIGHLIGHT_EXTENSIONS, languageForPath } from './code-language'
/** Highlight one source fragment into one token list per line. */
export type CodeHighlighter = (code: string) => HighlightSpan[][] | undefined

/**
 * Bind the shared lazy highlighter to one language and refresh after its grammar loads.
 * @param language - grammar hint selected from the source filename.
 * @returns a stable fragment highlighter; unknown and loading grammars return `undefined` for plain-text fallback.
 */
export function useCodeHighlighter(language: string | undefined): CodeHighlighter {
  const loaded = React.useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  return React.useCallback(code => highlightLines(code, language), [language, loaded])
}

export type { HighlightSpan }
