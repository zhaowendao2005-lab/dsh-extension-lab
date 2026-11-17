import React from '../../runtime'
import type { CSSProperties, ReactNode, Ref } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard'
import { CodeToolbar, type CodeToolbarLabels } from './CodeToolbar'
import {
  diffFenceTokens, isDiffContent, isDiffFenceLanguage, parseDiffFence,
} from './diff-fence'
import type { DiffRow } from './diff-fence'
import {
  StreamingHighlightSession, grammarLoadCount, highlightToHtml, subscribeGrammarLoaded,
} from './highlight'
import type { HighlightSpan, StreamingHighlightFrame } from './highlight'
import { useViewportHighlighting } from './useViewportHighlighting'
export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /**
   * Render unified-diff rows: row colors by marker column, and each file's
   * removed and added sides tokenized with the language its header names.
   * Omitted, a `diff` or `patch` `lang` selects them; `true` or `false` forces
   * the choice for any `lang`.
   */
  diff?: boolean | undefined
  /**
   * The code is still growing (a streaming markdown fence): highlight through
   * a per-instance {@link StreamingHighlightSession}, which re-tokenizes only
   * appended text and keeps completed line groups (and DOM) untouched. The
   * caller must keep the component instance stable across growth (a
   * stream-stable React key); an unchanged streamed fence also retains that
   * tree when it settles. Cold settled callers get shiki's HTML.
   */
  streaming?: boolean | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Ref for the stable source-content wrapper, for owners that use it as a scrollport. */
  contentRef?: Ref<HTMLDivElement> | undefined
  /** Show a numbered gutter without adding numbers to copied source. Defaults to false. */
  lineNumbers?: boolean | undefined
  /** Show the language and copy header; false when the caller supplies a toolbar. Defaults to true. */
  showHeader?: boolean | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
  /** Enable the shared card toolbar and spacing; omit for custom toolbar layouts. */
  toolbarLabels?: CodeToolbarLabels | undefined
  /** With toolbarLabels, use the owner's wrapping preference and omit the toolbar's local wrap action. */
  wrap?: boolean | undefined
}

/**
 * The `pre` attributes shiki's HTML arm emits for the css-variables theme,
 * mirrored so the streaming arm's tree is interchangeable with the settled
 * swap (`tests/streaming-code-block.client.spec.tsx` pins the two arms'
 * parity).
 */
const SHIKI_PRE_PROPS = {
  className: 'shiki css-variables',
  style: { backgroundColor: 'var(--shiki-background)', color: 'var(--shiki-foreground)' },
  tabIndex: 0,
} as const

/** Completed-line group size; React reconciles groups while the DOM remains line-for-line identical. */
const STREAMING_LINE_GROUP_SIZE = 32

/** Line class per row kind; context rows keep the block's default ink. */
const DIFF_ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  add: 'mit-chat-md-diffAdd',
  del: 'mit-chat-md-diffDel',
  hunk: 'mit-chat-md-diffHunk',
  meta: 'mit-chat-md-diffMeta',
  context: 'mit-chat-md-diffContext',
}

/** One diff row: optional marker column, then the body with its token colors. */
function renderDiffRow(row: DiffRow, index: number, tokens: readonly HighlightSpan[] | undefined): ReactNode {
  const kindClass = DIFF_ROW_CLASS[row.kind]
  return (
    <React.Fragment key={index}>
      {index > 0 && '\n'}
      <span className={clsx('line', 'mit-chat-md-diffLine', kindClass)}>
        {isDiffContent(row)
          ? <React.Fragment>
            <span className={'mit-chat-md-diffMarker'}>{row.marker}</span>
            {tokens === undefined
              ? row.body
              : tokens.map((span, spanIndex) => <span key={spanIndex} style={span.style}>{span.text}</span>)}
          </React.Fragment>
          : row.raw}
      </span>
    </React.Fragment>
  )
}

function renderLine(line: readonly HighlightSpan[], index: number): ReactNode {
  return (
    <React.Fragment key={index}>
      {index > 0 && '\n'}
      <span className="line">
        {line.map((span, spanIndex) => <span key={spanIndex} style={span.style}>{span.text}</span>)}
      </span>
    </React.Fragment>
  )
}

export function CodeBlock({
  code, lang, diff, streaming, className, contentRef, lineNumbers = false, showHeader = true, copyLabel, copiedLabel, toolbarLabels, wrap,
}: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  const diffRows = React.useMemo(() => ((diff ?? isDiffFenceLanguage(lang)) ? parseDiffFence(trimmed) : undefined),
    [trimmed, lang, diff])
  const sourceLines = lineNumbers ? trimmed.split('\n') : undefined
  const rootRef = React.useRef<HTMLDivElement>(null)
  // Diff rows join the same viewport gate as grammar-highlighted fences, so an
  // off-screen fence paints its row colors without tokenizing the body.
  const highlighting = useViewportHighlighting(rootRef, diffRows === undefined ? lang : 'diff')
  // Re-render when a lazy grammar finishes loading, so a fence that showed plain
  // text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  const loaded = React.useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  // Each file's old and new sides are tokenized separately; a growing fence
  // re-tokenizes per chunk because that grouping has no incremental path, and
  // diffs in a fence are short enough to accept it.
  const diffTokens = React.useMemo(
    () => (diffRows === undefined || !highlighting ? undefined : diffFenceTokens(diffRows)),
    [diffRows, highlighting, loaded],
  )
  // Streaming state lives in refs mutated inside the memo (the MarkdownText
  // streaming-cache pattern): the session's caches carry across chunks only
  // because the owner keys this instance stably while the fence grows.
  const sessionRef = React.useRef<StreamingHighlightSession | null>(null)
  const lineCacheRef = React.useRef<{
    code: string
    lang: string | undefined
    generation: number
    frame: StreamingHighlightFrame
    groups: ReactNode[]
    pending: ReactNode[]
    nextLine: number
    body: ReactNode
  } | null>(null)
  const settledRef = React.useRef(false)
  const streamedBody = React.useMemo(() => {
    // A diff fence draws its own rows; the session's single-language stream is unused.
    if (!highlighting || diffRows !== undefined) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
      return undefined
    }
    if (streaming !== true) {
      const previous = lineCacheRef.current
      if (previous !== null && previous.code === trimmed && previous.lang === lang) {
        settledRef.current = true
        return previous.body
      }
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = true
      return undefined
    }
    if (settledRef.current) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
    }
    sessionRef.current ??= new StreamingHighlightSession()
    const frame = sessionRef.current.updateFrame(trimmed, lang)
    if (frame === undefined) {
      lineCacheRef.current = null
      return undefined
    }
    const previous = lineCacheRef.current
    if (previous?.frame === frame && previous.code === trimmed && previous.lang === lang) {
      return previous.body
    }
    const sameGeneration = previous?.generation === frame.generation
    const groups = sameGeneration ? [...previous.groups] : []
    let pending = sameGeneration ? [...previous.pending] : []
    let nextLine = sameGeneration ? previous.nextLine : 0
    for (const line of frame.appended) {
      pending.push(renderLine(line, nextLine))
      nextLine += 1
      if (pending.length !== STREAMING_LINE_GROUP_SIZE) continue
      const start = nextLine - pending.length
      groups.push(<React.Fragment key={start}>{pending}</React.Fragment>)
      pending = []
    }
    const tail = frame.tail.map((line, index) => renderLine(line, nextLine + index))
    const tailGroup = <React.Fragment key={nextLine - pending.length}>{[...pending, ...tail]}</React.Fragment>
    const body = <pre {...SHIKI_PRE_PROPS}><code>{groups}{tailGroup}</code></pre>
    lineCacheRef.current = {
      code: trimmed, lang, generation: frame.generation, frame, groups, pending, nextLine, body,
    }
    return body
  }, [streaming, highlighting, diffRows, trimmed, lang, loaded])
  const html = React.useMemo(
    () => (diffRows === undefined && highlighting && streaming !== true && streamedBody === undefined
      ? highlightToHtml(trimmed, lang)
      : undefined),
    [diffRows, streaming, highlighting, streamedBody, trimmed, lang, loaded],
  )
  const [copied, setCopied] = React.useState(false)
  const [localWrapped, setWrapped] = React.useState(true)
  const wrapped = wrap ?? localWrapped

  const onCopy = React.useCallback(() => {
    if (copied) return
    /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
       typed fallback if the DOM shape ever diverges. */
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  // shiki's HTML output is a static span tree it generated from `code` (no
  // user HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
  const body = diffRows !== undefined
    ? (
      <pre className={'mit-chat-md-plain'}><code>{diffRows.rows.map((row, index) => renderDiffRow(row, index, diffTokens?.get(index)))}</code></pre>
    )
    : streamedBody !== undefined
      ? streamedBody
      : html === undefined
        ? (
          <pre className={'mit-chat-md-plain'}><code>{sourceLines === undefined ? trimmed : sourceLines.map((line, index) => (
            <React.Fragment key={index}>{index > 0 && '\n'}<span className="line">{line}</span></React.Fragment>
          ))}</code></pre>
        )
        : (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )

  return (
    <div ref={rootRef} className={clsx('mit-chat-md-block', 'md-code-block', lineNumbers && 'mit-chat-md-numbered', diffRows !== undefined && !lineNumbers && 'mit-chat-md-diffFence', toolbarLabels !== undefined && 'mit-chat-md-card', className)}
      data-line-numbers={lineNumbers || undefined}
      data-code-wrap={toolbarLabels === undefined ? undefined : wrapped}
      style={sourceLines === undefined ? undefined : {
        '--dsl-code-block-line-number-width': `${Math.max(2, String(sourceLines.length).length)}ch`,
      } as CSSProperties}>
      {/* These paired attributes are stable semantic hooks for owner styling and DOM tests. */}
      {showHeader && <div className={'mit-chat-md-bannerWrap'}>
        {toolbarLabels !== undefined ? <CodeToolbar
          lang={lang} labels={toolbarLabels} copyLabel={copyLabel} copiedLabel={copiedLabel}
          copied={copied} wrapped={wrapped} onCopy={onCopy}
          onWrap={wrap === undefined ? () => { setWrapped(value => !value) } : undefined}
        /> : <div className={'mit-chat-md-banner'} data-code-block-banner>
          <div className={'mit-chat-md-infostring'} data-text-interaction-exclude="">{lang ?? ''}</div>
          <div className={'mit-chat-md-action'}>
            <button type="button" className={'mit-chat-md-copyButton'} onClick={onCopy}>
              {copied ? copiedLabel : copyLabel}
            </button>
          </div>
        </div>}
      </div>}
      <div ref={contentRef} className={'mit-chat-md-content'} data-code-block-content>{body}</div>
    </div>
  )
}
