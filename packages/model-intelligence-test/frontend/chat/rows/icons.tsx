/**
 * The handful of DSH product icons the chat rows draw.
 *
 * The reference icons are `<use>` references into the `dsw-icon-*` sprite that
 * ui-theme injects into the host document. A plugin cannot rely on that sprite
 * being present (and must not depend on host theme internals), so each glyph
 * below carries the same geometry from ui-primitives `icons/artwork.ts`, owned
 * inline. Stroke width, view box and `currentColor` plumbing are unchanged, and
 * every component keeps the DSH signature `{size, className}` with the artwork's
 * own default size.
 */
import React from '../../runtime';

/** Props every product icon accepts. */
export interface IconProps {
  /** Rendered height in px; defaults to the glyph's own size. */
  size?: number;
  className?: string;
}

interface Glyph {
  readonly size: number;
  /** Inner SVG markup, verbatim from the DSH artwork definition. */
  readonly body: string;
}

const REGULAR_STROKE = 1;

const GLYPHS = {
  'think-outline': {
    size: 16,
    body: '<path d="M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z" stroke="currentColor"></path><path d="M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z" stroke="currentColor"></path><path d="M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z" fill="currentColor"></path>',
  },
  'copy-outline': {
    size: 16,
    body: '<rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor"></rect><path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor"></path>',
  },
  'check-outline': {
    size: 16,
    body: '<path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"></path>',
  },
  'branch-outline': {
    size: 16,
    body: '<path d="M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564" stroke="currentColor"></path><path d="M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944" stroke="currentColor"></path><circle cx="12.4502" cy="3.3079" r="1.56962" stroke="currentColor"></circle><circle cx="12.4502" cy="12.6921" r="1.56962" stroke="currentColor"></circle>',
  },
  'database-outline': {
    size: 16,
    body: '<path d="M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z" stroke="currentColor"></path><path d="M2 3.80371V11.7848" stroke="currentColor"></path><path d="M14 3.80371V11.7848" stroke="currentColor"></path><path d="M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396" stroke="currentColor"></path><path d="M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847" stroke="currentColor"></path>',
  },
  'gauge-outline': {
    size: 16,
    body: '<path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor"></path><path d="M8 8.49994L11.6114 4.88855" stroke="currentColor"></path><path d="M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z" fill="currentColor"></path>',
  },
  'chevron-down-outline': {
    size: 14,
    body: '<path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor"></path>',
  },
  'chevron-up-outline': {
    size: 14,
    body: '<path d="M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10" stroke="currentColor"></path>',
  },
} as const satisfies Record<string, Glyph>;

type GlyphName = keyof typeof GLYPHS;

/**
 * Build one icon component around a vendored glyph.
 * @param name - glyph key; also the `data-icon` id suffix the reference emitted.
 * @returns the icon component.
 */
function glyphIcon(name: GlyphName): (props: IconProps) => React.JSX.Element {
  const glyph: Glyph = GLYPHS[name];
  return ({ size = glyph.size, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={REGULAR_STROKE}
      className={className}
      data-icon={`dsw-icon-${name}-regular`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}

/** DSH think glyph (reasoning disclosure leading icon). */
export const IconThinkOutlineRegular = glyphIcon('think-outline');
/** DSH copy glyph. */
export const IconCopyOutlineRegular = glyphIcon('copy-outline');
/** DSH check glyph (copied state, completed step). */
export const IconCheckOutlineRegular = glyphIcon('check-outline');
/** DSH branch glyph. */
export const IconBranchOutlineRegular = glyphIcon('branch-outline');
/** DSH database glyph (token usage). */
export const IconDatabaseOutlineRegular = glyphIcon('database-outline');
/** DSH gauge glyph (session activity). */
export const IconGaugeOutlineRegular = glyphIcon('gauge-outline');
/** DSH collapsed-disclosure chevron. */
export const IconChevronDownOutlineRegular = glyphIcon('chevron-down-outline');
/** DSH expanded-disclosure chevron. */
export const IconChevronUpOutlineRegular = glyphIcon('chevron-up-outline');
