/** Tooltip placement for the vendored tooltip bubble. */

/** Side of the anchor the bubble prefers. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** Alignment of the bubble along the anchor's cross axis. */
export type TooltipAlign = 'start' | 'center' | 'end';

/** Inputs describing one placement pass. */
export interface TooltipPlacementInput {
  /** Anchor rectangle in viewport coordinates. */
  anchor: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** Measured bubble width. */
  width: number;
  /** Measured bubble height. */
  height: number;
  /** Viewport width the bubble must stay inside. */
  viewportWidth: number;
  /** Viewport height the bubble must stay inside. */
  viewportHeight: number;
  /** Preferred side. */
  side: TooltipSide;
  /** Cross-axis alignment. */
  align: TooltipAlign;
  /** Distance between anchor and bubble. */
  gap: number;
}

/** Result of one placement pass, in viewport coordinates. */
export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly side: TooltipSide;
  readonly overflow: boolean;
}

/** Viewport margin kept on every edge. */
const VIEWPORT_MARGIN = 12;

/** Distance between two horizontally adjacent surfaces. */
const HORIZONTAL_GAP = 10;

/** Opposite side of a given side. */
function opposite(side: TooltipSide): TooltipSide {
  if (side === 'top') return 'bottom';
  if (side === 'bottom') return 'top';
  if (side === 'left') return 'right';
  return 'left';
}

/** Clamp `value` into `[min, max]`, tolerating an inverted range. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** Place a box on one side of the anchor, aligned on the cross axis. */
function place(
  input: TooltipPlacementInput,
  side: TooltipSide,
): { left: number; top: number } {
  const { anchor, width, height, align } = input;
  const anchorWidth = anchor.right - anchor.left;
  const anchorHeight = anchor.bottom - anchor.top;
  if (side === 'top' || side === 'bottom') {
    const centered = anchor.left + (anchorWidth - width) / 2;
    const left = align === 'start'
      ? anchor.left
      : align === 'end' ? anchor.right - width : centered;
    const top = side === 'top' ? anchor.top - height - input.gap : anchor.bottom + input.gap;
    return { left, top };
  }
  const centered = anchor.top + (anchorHeight - height) / 2;
  const top = align === 'start'
    ? anchor.top
    : align === 'end' ? anchor.bottom - height : centered;
  const left = side === 'left'
    ? anchor.left - width - HORIZONTAL_GAP
    : anchor.right + HORIZONTAL_GAP;
  return { left, top };
}

/**
 * Resolve a viewport-safe position for the tooltip bubble.
 * @param input - anchor, bubble size, viewport size and preference.
 * @returns the chosen position plus whether any candidate overflowed.
 */
export function placeTooltip(input: TooltipPlacementInput): TooltipPlacement {
  const candidates: TooltipSide[] = [input.side, opposite(input.side)];
  if (input.side === 'top' || input.side === 'bottom') candidates.push('right', 'left');
  else candidates.push('top', 'bottom');
  let overflow = false;
  let fallback: TooltipPlacement | undefined;
  for (const side of candidates) {
    const { left: rawLeft, top: rawTop } = place(input, side);
    const left = clamp(rawLeft, VIEWPORT_MARGIN, input.viewportWidth - VIEWPORT_MARGIN - input.width);
    const top = clamp(rawTop, VIEWPORT_MARGIN, input.viewportHeight - VIEWPORT_MARGIN - input.height);
    const candidate: TooltipPlacement = {
      left,
      top,
      width: input.width,
      height: input.height,
      side,
      overflow: left !== rawLeft || top !== rawTop,
    };
    if (!candidate.overflow) return candidate;
    overflow = true;
    fallback ??= candidate;
  }
  return { ...(fallback as TooltipPlacement), overflow };
}
