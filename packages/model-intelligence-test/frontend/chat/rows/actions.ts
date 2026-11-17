/**
 * Central no-op seam for the row actions this read-only mirror cannot perform.
 *
 * The DSH rows wire copy, branch/fork, message menus, quoting, the context menu,
 * pending-submission bubbles and the turn navigator to Host services. A plugin
 * mirror renders the same DOM but has no such services, so every one of those
 * actions lands here as a stub with the same call shape: the components keep
 * their buttons, `aria-*` wiring and visual states, and swapping these
 * functions for real transports is the only change needed to make them live.
 *
 * TODO(host): replace each stub with the Host transport that the reference
 * renderer called (session fork at a seq, message-quote intake, context menu
 * registration, turn navigation).
 */

/** Everything the ported rows can ask the host to do. */
export interface ChatRowActions {
  /** Copy the given text; the caller owns the success feedback. */
  copy: (text: string) => void;
  /** Fork the conversation at the message that produced this row. */
  branchAt: (messageId: string) => void;
  /** Quote a message into the composer. */
  quote: (messageId: string) => void;
  /** Open the per-message context menu at a viewport point. */
  openContextMenu: (messageId: string, position: { x: number; y: number }) => void;
  /** Navigate the transcript to a turn. */
  navigateToTurn: (turn: number) => void;
  /** Retry the turn that failed. */
  retryTurn: (turn: number) => void;
}

/** Do nothing; the shared body of every stubbed action. */
const noop = (): void => {};

/**
 * Stub action seat. Every member is a no-op, so the rendered controls stay
 * present and inert instead of disappearing or throwing.
 */
export const chatRowActions: ChatRowActions = {
  copy: noop,
  branchAt: noop,
  quote: noop,
  openContextMenu: noop,
  navigateToTurn: noop,
  retryTurn: noop,
};

/**
 * Replace the action seat, e.g. once a Host transport exists.
 * @param actions - the partial override; unset members keep their stub.
 * @returns nothing.
 */
export function setChatRowActions(actions: Partial<ChatRowActions>): void {
  Object.assign(chatRowActions, actions);
}
