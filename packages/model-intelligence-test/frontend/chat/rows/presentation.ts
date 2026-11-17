/**
 * Presentation policy and per-row open state, localized from the DSH client
 * runtime.
 *
 * The reference rows selected display policy through `usePresentation` and took
 * their open state from `useDisclosure` (both framework seats). This plugin has
 * neither seat, so the policy becomes a local constant object with the DSH
 * defaults, and the open state becomes plain `React.useState` per mounted row.
 * The selector-shaped `usePresentation` wrapper is kept so ported call sites read
 * the same way in both trees.
 */
import React from '../../runtime';

/** The DSH presentation defaults the rows depend on. */
export interface PresentationPolicy {
  /** Keep a settled reasoning row's one-line summary visible while collapsed. */
  readonly settledReasoningPreview: boolean;
  /** Readable label density stays at DSH's default; the rows never read it. */
  readonly detailed: boolean;
}

/** Default policy: exactly the DSH defaults for a read-only mirror. */
export const presentation: PresentationPolicy = {
  settledReasoningPreview: true,
  detailed: false,
};

/**
 * Select from the presentation policy.
 * @param select - projection over the fixed policy.
 * @returns the selected value.
 */
export function usePresentation<T>(select: (policy: PresentationPolicy) => T): T {
  return select(presentation);
}

/** Independent open state for one disclosure row. */
export interface UseDisclosure {
  readonly expanded: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Own one disclosure row's open state.
 * @returns the state value plus stable `open`/`close`/`toggle` callbacks.
 */
export function useDisclosure(): UseDisclosure {
  const [expanded, setExpanded] = React.useState(false);
  const open = React.useCallback(() => { setExpanded(true); }, []);
  const close = React.useCallback(() => { setExpanded(false); }, []);
  const toggle = React.useCallback(() => { setExpanded((value) => !value); }, []);
  return { expanded, open, close, toggle };
}
