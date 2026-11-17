/** Anchor-preserving tooltips; an optional body portal escapes clipping containers and stacking contexts that cap the bubble's z-index. */
import React from '../../runtime';
import { lazyContext } from '../lazy';
import { createPortal } from './react-dom';
import { tooltipCss as css } from './classes';
import { placeTooltip, type TooltipSide } from './tooltip-placement';
import { useDismissOnOutsidePointer } from './use-dismiss-on-outside-pointer';
// Tooltips take the wide answer — any key returns to the keyboard. Focus rings read the
// narrower `data-input-modality` attribute the same module publishes.
import { pointerModality } from './input-modality';

export type { TooltipSide } from './tooltip-placement';

/**
 * Suppression channel for nested tooltips: a visible descendant tooltip
 * withdraws the enclosing tooltip while its bubble is shown.
 */
export const tooltipSuppression = lazyContext<((suppressed: boolean) => void) | null>(null);

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  'aria-describedby'?: string | undefined;
  ref?: React.Ref<HTMLElement> | undefined;
  onPointerEnter?: React.PointerEventHandler | undefined;
  onPointerLeave?: React.PointerEventHandler | undefined;
  onPointerDown?: React.PointerEventHandler | undefined;
  onClick?: React.MouseEventHandler | undefined;
  onFocus?: React.FocusEventHandler | undefined;
  onBlur?: React.FocusEventHandler | undefined;
}

/** Bubble text, or a resolver evaluated only while visible. */
type TooltipLabel = string | (() => string);

/** Whether the anchor or any of its descendants truncates horizontally. */
function clipped(anchor: HTMLElement): boolean {
  return [anchor, ...anchor.querySelectorAll<HTMLElement>('*')]
    .some(el => el instanceof HTMLElement && el.scrollWidth > el.clientWidth);
}

/**
 * Attach a hover/focus tooltip to an anchor element.
 *
 * The DSH original also renders platform keycaps for `shortcutKeys`; no call site
 * in the chat rows supplies them, so that optional branch is dropped and the DOM
 * for every used prop set is unchanged.
 * @param props.label - bubble text, or a resolver evaluated only while visible.
 * @param props.side - preferred placement (default 'right'); fitting tries the opposite then perpendicular sides.
 * @param props.align - cross-axis alignment; default 'center'.
 * @param props.portal - render the bubble under document.body, so an ancestor's clipping or its
 * stacking context cannot hide it.
 * @param props.delayMs - hover delay in milliseconds (default 0).
 * @param props.focusDelayMs - keyboard focus delay in milliseconds (default 0).
 * @param props.gap - anchor-to-bubble distance in pixels (default 8).
 * @param props.disabled - suppress the bubble while true; the anchor renders identically.
 * @param props.maxWidth - bubble width cap in pixels.
 * @param props.openOnClick - clicking or tapping also pins the bubble for reading.
 * @param props.onlyWhenClipped - show the bubble only when the anchor overflows horizontally.
 * @param props.children - a single anchor element; its own ref is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble, optionally portaled to the body.
 */
export function Tooltip({ label, side = 'right', align = 'center', delayMs = 0, focusDelayMs = 0, gap = 8, disabled = false, portal = false, maxWidth, openOnClick = false, onlyWhenClipped = false, children }: {
  label: TooltipLabel;
  side?: TooltipSide;
  align?: 'center' | 'end';
  delayMs?: number;
  focusDelayMs?: number;
  gap?: number;
  disabled?: boolean;
  portal?: boolean;
  maxWidth?: number;
  openOnClick?: boolean;
  onlyWhenClipped?: boolean;
  children: React.ReactElement<AnchorProps>;
}) {
  const id = React.useId();
  const [pinned, setPinned] = React.useState(false);
  const anchor = React.useRef<HTMLElement | null>(null);
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as React.ReactElement<AnchorProps> & { ref?: React.Ref<HTMLElement> }).ref;
  const mergedRef = React.useCallback((el: HTMLElement | null) => {
    anchor.current = el;
    if (typeof childRef === 'function') childRef(el);
    else if (childRef != null) (childRef as React.MutableRefObject<HTMLElement | null>).current = el;
  }, [childRef]);
  const [pos, setPos] = React.useState<DOMRect | null>(null);
  const bubble = React.useRef<HTMLSpanElement | null>(null);
  const resolvedLabel: string | null = pos === null
    ? null
    : typeof label === 'function' ? label() : label;
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = React.useRef({ hover: false, focus: false });

  // A nested tooltip's bubble owns the pointer position, so this tooltip
  // withdraws its own while a descendant shows one.
  const TooltipSuppression = tooltipSuppression();
  const suppressAncestors = React.useContext(TooltipSuppression);
  const [suppressed, setSuppressed] = React.useState(false);
  const announce = React.useCallback((active: boolean) => { suppressAncestors?.(active); }, [suppressAncestors]);
  const visible = pos !== null && !disabled;
  // ResizeObserver supplies the laid-out border box; fitting never reads
  // geometry after a position write or needs a React commit to flip sides.
  React.useEffect(() => {
    const el = bubble.current;
    if (pos === null || !visible || suppressed || el === null) return;
    let size: ResizeObserverSize | undefined;
    let anchorRect = pos;
    /** Write the fitted position once a box size is known. */
    const fit = () => {
      if (size === undefined) return;
      const placement = placeTooltip({
        anchor: anchorRect, width: size.inlineSize, height: size.blockSize,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, side, align, gap,
      });
      const horizontal = placement.side === 'right' || placement.side === 'left';
      const offsetX = horizontal ? 0 : align === 'end' ? placement.width : placement.width / 2;
      const offsetY = horizontal ? placement.height / 2 : placement.side === 'top' ? placement.height : 0;
      el.style.left = `${placement.left + offsetX}px`;
      el.style.top = `${placement.top + offsetY}px`;
      el.dataset.side = placement.side;
      el.style.visibility = 'visible';
    };
    /** Re-read the anchor box and refit after a window resize. */
    const onResize = () => {
      if (anchor.current !== null) anchorRect = anchor.current.getBoundingClientRect();
      fit();
    };
    const observer = new ResizeObserver((entries) => {
      size = entries[0]?.borderBoxSize[0];
      fit();
    });
    observer.observe(el, { box: 'border-box' });
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [align, gap, pos, side, suppressed, visible]);
  React.useEffect(() => {
    announce(visible);
    return () => { announce(false); };
  }, [announce, visible]);

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = React.useCallback(() => {
    if (showTimer.current === null) return;
    clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);
  React.useEffect(() => {
    if (pinned && (disabled || !openOnClick)) setPinned(false);
    if (disabled) {
      cancelShow();
      triggers.current = { hover: false, focus: false };
      setPos(null);
    }
    return cancelShow;
  }, [cancelShow, disabled, openOnClick, pinned]);

  /** Raise the bubble at the anchor's current box. */
  const show = () => {
    if (disabled) return;
    const el = anchor.current;
    if (el === null) return;
    if (onlyWhenClipped && !clipped(el)) return;
    setPos(el.getBoundingClientRect());
    announce(true);
  };
  /** Raise the bubble after `delay`, cancelling any pending show first. */
  const showAfterDelay = (delay: number) => {
    cancelShow();
    if (delay <= 0) {
      show();
      return;
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      show();
    }, delay);
  };
  const withdraw = React.useCallback(() => {
    setPinned(false);
    setPos(null);
    announce(false);
  }, [announce]);
  /** Hide unless another trigger (hover, focus, pin) still holds the bubble. */
  const hide = () => {
    cancelShow();
    if (!triggers.current.hover && !triggers.current.focus && !pinned) withdraw();
  };
  const dismiss = React.useCallback(() => {
    cancelShow();
    triggers.current = { hover: false, focus: false };
    withdraw();
  }, [cancelShow, withdraw]);
  useDismissOnOutsidePointer(anchor, openOnClick && visible, dismiss, bubble);
  React.useEffect(() => {
    if (!openOnClick || !visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => { document.removeEventListener('keydown', onKeyDown, true); };
  }, [dismiss, openOnClick, visible]);

  const content = visible && !suppressed && (
    <span
      ref={bubble}
      id={openOnClick ? id : undefined}
      className={css.bubble}
      data-side={side}
      data-portal={portal || undefined}
      data-pinned={pinned || undefined}
      data-align={align}
      style={{ left: pos.left, top: pos.top, visibility: 'hidden', ...maxWidth === undefined ? {} : { maxWidth: `min(${maxWidth}px, calc(100vw - 24px))` } }}
      role="tooltip"
    >
      {resolvedLabel && <span className={css.label}>{resolvedLabel}</span>}
    </span>
  );

  return (
    <TooltipSuppression.Provider value={setSuppressed}>
      {React.cloneElement(children, {
        ref: mergedRef,
        'aria-describedby': openOnClick && visible
          ? [children.props['aria-describedby'], id].filter(Boolean).join(' ')
          : children.props['aria-describedby'],
        onPointerEnter: (e: React.PointerEvent) => {
          children.props.onPointerEnter?.(e);
          if (e.pointerType === 'touch') return;
          // iOS can emit mouse entry when a tapped control replaces its icon.
          if (e.pointerType === 'mouse' && !window.matchMedia('(any-hover: hover)').matches) return;
          triggers.current.hover = true;
          showAfterDelay(delayMs);
        },
        onPointerLeave: (e: React.PointerEvent) => {
          children.props.onPointerLeave?.(e);
          triggers.current.hover = false;
          cancelShow();
          if (!pinned) withdraw();
        },
        onPointerDown: (e: React.PointerEvent) => {
          children.props.onPointerDown?.(e);
          if (e.pointerType === 'touch' && !pinned) dismiss();
        },
        // Activating an ordinary action dismisses the bubble: it often changes
        // what the anchor now does (pin → unpin), and the click leaves the
        // anchor focused, which would otherwise pin the relabelled bubble up.
        onClick: (e: React.MouseEvent) => {
          children.props.onClick?.(e);
          triggers.current.focus = false;
          cancelShow();
          if (openOnClick && !disabled && !pinned) { setPinned(true); show(); }
          else withdraw();
        },
        onFocus: (e: React.FocusEvent) => {
          children.props.onFocus?.(e);
          if (pointerModality()) return;
          triggers.current.focus = true;
          showAfterDelay(focusDelayMs);
        },
        onBlur: (e: React.FocusEvent) => { children.props.onBlur?.(e); triggers.current.focus = false; hide(); },
      })}
      {portal ? (content !== false && createPortal(content, document.body)) : content}
    </TooltipSuppression.Provider>
  );
}
