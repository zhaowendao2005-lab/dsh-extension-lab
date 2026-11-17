/** Shared user-message background, typography, and content inset. */
import React from '../../runtime';
import { cx } from './cx';
import { bubbleCss as css } from './classes';

/** Native div attributes for user-authored message content. */
export type UserMessageBubbleProps = React.ComponentPropsWithoutRef<'div'>;

/**
 * Render user-style message content without row placement or actions.
 * @param props - Native div attributes and the caller-owned content.
 * @returns A theme-aware message surface that wraps its content.
 */
export function UserMessageBubble({ className, ...props }: UserMessageBubbleProps) {
  return <div {...props} className={cx(css.bubble, className)} />;
}
