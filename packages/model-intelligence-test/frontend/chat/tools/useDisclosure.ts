/**
 * Independent open state for one disclosure seat.
 *
 * Port of ui-chat/src/client/chat/use-disclosure.ts minus the enclosing-Turn
 * reset source: a mirror row belongs to a finished record, so there is no live
 * answer whose replacement should collapse it. The hook is created by the render
 * site and handed to the row, exactly as the Chat seat supplies it.
 */

import React from '../../runtime';

/** One row's disclosure seat: initially collapsed, owned by the render site. */
export type UseDisclosure = () => {
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  toggle: () => void;
};

/**
 * Own one initially collapsed disclosure without an external subscription.
 * @returns the open state, an explicit setter, and a toggle action.
 */
export function useDisclosure(): ReturnType<UseDisclosure> {
  const [expanded, setExpandedState] = React.useState(false);
  const setExpanded = React.useCallback((open: boolean) => {
    setExpandedState(open);
  }, []);
  const toggle = React.useCallback(() => {
    setExpandedState(previous => !previous);
  }, []);
  return { expanded, setExpanded, toggle };
}
