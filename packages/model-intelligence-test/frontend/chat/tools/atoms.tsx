/**
 * Vendored DSH UI primitives used by the tool-call row.
 *
 * Each export is a structural copy of its DSH original. Two mechanical changes:
 * hooks and constructors go through `React.*` (this plugin never bundles React,
 * the Host injects it), and CSS-module lookups become the class maps declared
 * below, whose names are the original CSS keys under the vendored prefixes.
 *
 * - TextShimmer   <- ui-primitives/src/TextShimmer.tsx
 * - DisclosureRow <- ui-primitives/src/DisclosureRow.tsx
 */

import React from '../../runtime';
import type { Context, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from './icons';

/* CSS-module keys of the vendored stylesheet (frontend/styles/chat-tools.css). */
const shimmerCss = {
  root: 'mit-chat-tool-shimmer-root',
  content: 'mit-chat-tool-shimmer-content',
  text: 'mit-chat-tool-shimmer-text',
  decoration: 'mit-chat-tool-shimmer-decoration',
  sweep: 'mit-chat-tool-shimmer-sweep',
  highlight: 'mit-chat-tool-shimmer-highlight',
};

const disclosureCss = {
  root: 'mit-chat-tool-disclosure-root',
  header: 'mit-chat-tool-disclosure-header',
  row: 'mit-chat-tool-disclosure-row',
  leading: 'mit-chat-tool-disclosure-leading',
  iconIdle: 'mit-chat-tool-disclosure-iconIdle',
  chevronHover: 'mit-chat-tool-disclosure-chevronHover',
  title: 'mit-chat-tool-disclosure-title',
};

/* ------------------------------------------------------------------ */
/* TextShimmer                                                        */
/* ------------------------------------------------------------------ */

/* The DSH module creates this context at import time. React arrives only after
   the Host calls setReact, so the context is created on first render and
   memoized here for a stable identity across renders. */
let decorativeCopyContext: Context<boolean | undefined> | undefined;
function decorativeCopy(): Context<boolean | undefined> {
  return (decorativeCopyContext ??= React.createContext<boolean | undefined>(undefined));
}

/** Text and activity supplied by the owning row. */
export interface TextShimmerProps {
  /** Text or presentational children with text in nested TextShimmer instances. */
  children: ReactNode;
  /** Whether to animate; nested instances share the containing row's activity. */
  active?: boolean | undefined;
  className?: string | undefined;
  /** Layout class applied equally to the base and decorative content. */
  contentClassName?: string | undefined;
}

function TextContent({ children, className }: Pick<TextShimmerProps, 'children' | 'className'>) {
  const decorative = React.useContext(decorativeCopy());
  const generated = decorative === true && typeof children === 'string';
  return (
    <span className={clsx(shimmerCss.text, className)} data-shimmer-text={generated ? children : undefined}>
      {generated ? null : children}
    </span>
  );
}

/**
 * Render text with one shared highlight while retaining selectable, accessible
 * content. Nested instances inherit the outer animation. Keep icons outside;
 * mark decorative separators with data-shimmer-decoration so their background
 * follows the highlight.
 */
export function TextShimmer({ children, active = false, className, contentClassName }: TextShimmerProps) {
  const DecorativeCopy = decorativeCopy();
  const decorative = React.useContext(DecorativeCopy);
  if (decorative !== undefined) return <TextContent className={className}>{children}</TextContent>;
  const content = typeof children === 'string' ? <TextContent>{children}</TextContent> : children;
  return (
    <span className={clsx(shimmerCss.root, className)} data-shimmer={active || undefined}>
      <DecorativeCopy.Provider value={false}>
        <span className={clsx(shimmerCss.content, contentClassName)}>{content}</span>
      </DecorativeCopy.Provider>
      {active && (
        // The decorative copy must not be reachable: React 19 passes `inert` through as a boolean.
        <span className={shimmerCss.decoration} aria-hidden="true" inert={true}>
          <span className={shimmerCss.sweep}>
            <DecorativeCopy.Provider value>
              <span className={clsx(shimmerCss.content, shimmerCss.highlight, contentClassName)}>{content}</span>
            </DecorativeCopy.Provider>
          </span>
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* DisclosureRow                                                      */
/* ------------------------------------------------------------------ */

/** Shared 24px process row: tertiary text and icons, secondary on hover. */
export interface DisclosureRowProps {
  icon: ReactNode;
  title: string;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
  /** Animate the complete header while its owning operation is running. */
  running?: boolean | undefined;
  /** Makes the title row the disclosure target; with an accessory, it shrinks to its content width. */
  expandOnRowClick?: boolean | undefined;
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined;
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined;
  collapsedContent?: ReactNode;
  /** Independent action beside the title, outside the disclosure target and shimmer. */
  headerAccessory?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
  rowClassName?: string | undefined;
  /** Sizing class for the header text area, beside the leading icon. */
  contentClassName?: string | undefined;
  /** Layout class shared by the header text and its decorative copy. */
  contentLayoutClassName?: string | undefined;
  leadingClassName?: string | undefined;
  chevronClassName?: string | undefined;
  titleClassName?: string | undefined;
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  running = false,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  headerAccessory,
  children,
  className,
  rowClassName,
  contentClassName,
  contentLayoutClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick;
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggle();
  };
  const collapsedLeading = previewChevron ? (
    <>
      <span className={disclosureCss.iconIdle}>{icon}</span>
      <IconChevronDownOutlineRegular className={clsx(chevronClassName, disclosureCss.chevronHover)} />
    </>
  ) : icon;
  const leading = open
    ? <IconChevronUpOutlineRegular className={chevronClassName} />
    : collapsedLeading;

  return (
    <div className={clsx(disclosureCss.root, className)} data-open={open || undefined}>
      <div className={disclosureCss.header} data-disclosure-header data-has-accessory={!!headerAccessory || undefined}>
        <div
          className={clsx(disclosureCss.row, rowClassName)}
          data-disclosure-row
          data-expandable={rowExpands || undefined}
          role={rowExpands ? 'button' : undefined}
          tabIndex={rowExpands ? 0 : undefined}
          aria-expanded={rowExpands ? open : undefined}
          onClick={rowExpands ? onToggle : undefined}
          onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
        >
          {expandable && !rowExpands ? (
            <button
              type="button"
              className={clsx(disclosureCss.leading, leadingClassName)}
              aria-label={title}
              aria-expanded={open}
              onClick={toggleFromLeading}
            >
              {leading}
            </button>
          ) : (
            <span className={clsx(disclosureCss.leading, leadingClassName)}>
              {leading}
            </span>
          )}
          <TextShimmer active={running} className={contentClassName} contentClassName={contentLayoutClassName}>
            <TextShimmer className={clsx(disclosureCss.title, titleClassName)}>{title}</TextShimmer>
            {(keepContentWhenOpen || !open) && collapsedContent}
          </TextShimmer>
        </div>
        {headerAccessory}
      </div>
      {open && children}
    </div>
  );
}
