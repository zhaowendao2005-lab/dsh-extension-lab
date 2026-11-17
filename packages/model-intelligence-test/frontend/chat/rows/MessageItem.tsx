// User message rows and turn-level error rows.
import React from '../../runtime';
import { messageCss as css } from './classes';
import { MessageIconActions } from './MessageIconActions';
import { t, type ChatTranslate } from './locale';
import { StateDot } from './StateDot';
import { UserContent, type UserContentData } from './UserContent';

/**
 * Map a failure code to the message the reader sees.
 * @param message - raw failure text reported by the turn.
 * @param code - failure code, when the source reported one.
 * @param translate - locale seat.
 * @returns the localized explanation, or the raw text for unrecognized codes.
 */
function failureMessage(
  message: string,
  code: unknown,
  translate: ChatTranslate,
): string {
  if (code === 'ACCOUNT_SIGNED_OUT') return translate('message.failure.accountSignedOut');
  if (code === 'INTERRUPTED') return translate('message.failure.interrupted');
  if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return translate('message.failure.accountSignInRequired');
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return translate('message.failure.quota');
  return code === 'AUTH' ? translate('message.failure.auth') : message;
}

/** Props of the user row. */
export interface UserRowProps {
  /** Message content. */
  content: UserContentData;
  /** Unix epoch ms of the message, for the clock beside the copy action. */
  time?: number | undefined;
}

/**
 * Render one user message: the bubble, then its icon action row.
 * @param props - content and event time.
 * @returns the user row.
 */
export function UserMessageNodeView({ content, time }: UserRowProps) {
  return (
    <div className={css.userRow}>
      <UserContent content={content} />
      {/* `MessageItem.module.css` has no `.actions`, so the reference row adds no
          extra class here; the icon row keeps its own `.actions` skin only. */}
      <MessageIconActions
        text={content.text}
        time={time}
        clock="start"
      />
    </div>
  );
}

/** Data of the turn error row. */
export interface TurnErrorNode {
  /** Raw failure text. */
  message: string;
  /** Failure code, when the turn reported one. */
  code?: string | undefined;
}

/**
 * Render the persistent notice for a turn that failed or was stopped.
 * @param props.node - failure text and code.
 * @returns the error row.
 */
export function TurnErrorItem({ node }: { node: TurnErrorNode }) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{node.code === 'ACCOUNT_SIGNED_OUT' || node.code === 'INTERRUPTED' ? t('message.taskStopped') : t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
      </div>
      {node.code !== undefined && node.code !== 'INTERRUPTED' && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  );
}
