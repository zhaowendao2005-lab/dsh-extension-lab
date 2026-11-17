/**
 * Public entry point of the ported DSH Markdown rendering layer.
 *
 * `ChatMarkdown` is a thin wrapper over {@link MarkdownText}: it fills the
 * capabilities the DSH Client shell used to supply — localized chrome copy,
 * host navigation, and file-drag transport — with local defaults, so ordinary
 * Markdown (headings, lists, code fences, tables, quotes, links, inline code,
 * and math) renders exactly as it does in the DSH transcript.
 */
import React from '../../runtime'
import clsx from 'clsx'
import { MarkdownText } from './MarkdownText'
import type { MarkdownLabels } from './render'

/** Classes the wrapper's outer container carries, for the caller's layout. */
export const chatMdClass = {
  /** Outermost container: sizing and scrolling belong to the caller. */
  flow: 'mit-chat-md-flow',
  /** The renderer's own root element inside {@link chatMdClass.flow}. */
  markdown: 'mit-chat-md-markdown',
} as const

/**
 * Chrome copy for one rendered document. Values match the Chinese seat of the
 * `client-ui-cot-translation` locale table this plugin's UI language follows.
 */
const DEFAULT_LABELS: MarkdownLabels = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
    toolbarLabels: { codeLabel: '代码块', wrapLabel: '自动换行', unwrapLabel: '不换行' },
  },
  footnotes: '脚注',
}

/** Props of one embedded, read-only Markdown document. */
export interface ChatMarkdownProps {
  /** Markdown source; re-rendered incrementally while `running` is set. */
  text: string
  /** The source is still streaming, so unterminated blocks keep their placeholder form. */
  running?: boolean
  /** Extra class for the wrapper, which is the element the caller sizes. */
  className?: string
}

/**
 * Render one Markdown document exactly as the DSH transcript does.
 * @param props - source text, streaming state, and the caller's layout class.
 * @returns the rendered document, wrapped in {@link chatMdClass.flow}.
 */
export function ChatMarkdown({ text, running = false, className }: ChatMarkdownProps): React.JSX.Element {
  // `createElement`, not JSX: the entry point stays a `.ts` module.
  return React.createElement('div', { className: clsx(chatMdClass.flow, className) },
    React.createElement(MarkdownText, { text, streaming: running, labels: DEFAULT_LABELS }))
}
