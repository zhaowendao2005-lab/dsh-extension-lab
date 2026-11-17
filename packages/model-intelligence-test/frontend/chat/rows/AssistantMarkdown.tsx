/** Assistant block column: the response body plus its stopped marker. */
import React from '../../runtime';
import { memo } from '../lazy';
import { assistantCss as css } from './classes';
import { t } from './locale';
import { ChatMarkdown } from '../md';

/** Props of the assistant body. */
export interface AssistantMarkdownProps {
  /** Display-ready assistant text. */
  text: string;
  /** Whether this message is still streaming. */
  streaming: boolean;
  /** Only finalized durable Assistant messages supply selection sources. */
  textInteractionSource?: boolean;
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined;
}

/**
 * Render one assistant message body.
 *
 * The DSH original walked the message's block list and rendered text, reasoning,
 * image and tool-call blocks separately. A mirrored transcript row carries the
 * assistant text as one string, so the block loop collapses to a single
 * Markdown block; the root/body shell, the empty-shell skip and the stopped
 * marker keep their original structure and conditions.
 * @param props - assistant text and stream state.
 * @returns the assistant body, or null when there is nothing to show.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text, streaming, textInteractionSource = false, interrupted,
}: AssistantMarkdownProps) {
  // Tool-call heads render as tool rows in the chat view's grouping pass, so a
  // node that is only those heads (or empty) would paint an empty root between
  // tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming || interrupted === true || text.trim() !== '';
  if (!hasVisible) return null;
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {text.trim() !== '' && (
          <ChatMarkdown text={text} running={streaming} />
        )}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  );
});
