/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import React from '../../runtime';
import { memo } from '../lazy';
import { a11yCss, reasoningCss as css } from './classes';
import { DisclosureRow } from './DisclosureRow';
import { IconThinkOutlineRegular } from './icons';
import { t } from './locale';
import { useDisclosure, usePresentation } from './presentation';
import { reasoningText } from './reasoning-text';
import { TextShimmer } from './TextShimmer';
import { ChatMarkdown } from '../md';

/** First line of a block of text. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

/** First line of the last paragraph whose first line is already complete. */
function latestCompletedParagraphFirstLine(text: string): string {
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd = nextParagraph === null ? text.length
      : nextParagraph.index + nextParagraph[0].indexOf('\n');
    const newline = text.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

/**
 * Render one assistant reasoning block collapsed until the reader opens it. The
 * collapsed summary omits double-asterisk markers; expanded content renders
 * the complete Markdown with secondary typography. A streaming preview advances
 * when a paragraph's first line completes. Mode changes toggle CSS display without unmounting
 * collapsed summaries.
 *
 * The DSH original filled its expanded body from the
 * `conversation.chat.reasoning.body` slot; a plugin cannot render host slots, so
 * the same display-ready text goes through the shared chat Markdown renderer.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @returns the reasoning disclosure.
 */
export const ReasoningRow = memo(function ReasoningRow({
  text: rawText, running, textInteractionSource = false,
}: {
  text: string;
  running: boolean;
  textInteractionSource?: boolean;
}) {
  const { expanded, toggle } = useDisclosure();
  const { text, hidden } = React.useMemo(() => {
    const display = reasoningText(rawText);
    return { text: display, hidden: display !== rawText && display.trim() === '' };
  }, [rawText]);
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text);
  const summary = React.useMemo(() => summaryText.replaceAll('**', ''), [summaryText]);
  const preview = usePresentation(policy => !expanded && summary !== ''
    && (running || policy.settledReasoningPreview));
  const collapsedContent = React.useMemo(() => (
    <>
      <span className={css.separator} data-shimmer-decoration aria-hidden />
      <span className={css.summary} data-streaming={running || undefined}>
        <span className={css.summaryText}>
          <TextShimmer>{summary}</TextShimmer>
        </span>
      </span>
    </>
  ), [running, summary]);
  const content = React.useMemo(() => expanded ? (
    <div className={css.thinkBody} data-text-interaction-source={textInteractionSource && !running ? '' : undefined}>
      <ChatMarkdown text={text} running={running} />
    </div>
  ) : undefined, [expanded, running, text, textInteractionSource]);

  if (hidden) return null;

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={<IconThinkOutlineRegular size={14} />}
        title={t('message.think')}
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  );
});
