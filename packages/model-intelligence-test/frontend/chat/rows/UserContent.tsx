/** User-authored message content: bubble text plus the remembered-reference footer. */
import React from '../../runtime';
import { messageCss as css } from './classes';
import { t } from './locale';
import { UserMessageBubble } from './UserMessageBubble';

/** Rendered user content. */
export interface UserContentData {
  /** Message text, kept verbatim (the bubble preserves its line breaks). */
  text: string;
  /** Labels of conversations this message recalled into context. */
  referenceLabels?: readonly string[] | undefined;
}

/**
 * Render user-style message content without row placement or actions.
 *
 * The DSH original also rendered an attachment stack and extra content blocks
 * through host slots. A mirrored transcript row carries text only, so those two
 * branches have no data to render and are omitted; the bubble, its data
 * attributes and the reference footer keep their original structure.
 * @param props.content - message text and optional recall labels.
 * @returns the stacked user content.
 */
export function UserContent({ content }: { content: UserContentData }) {
  const { text, referenceLabels = [] } = content;
  const showBubble = text !== '';
  return (
    <div className={css.userStack}>
      {showBubble && (
        <UserMessageBubble data-message-bubble="" data-text-interaction-source="">
          {text}
        </UserMessageBubble>
      )}
      {referenceLabels.length > 0 && (
        <div className={css.referenceSummary}>
          {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
        </div>
      )}
    </div>
  );
}
