/** Text activity animation shared by a row and its nested text fragments. */
import React from '../../runtime';
import { lazyContext, memo } from '../lazy';
import { cx } from './cx';
import { shimmerCss as css } from './classes';

const decorativeCopy = lazyContext<boolean | undefined>(undefined);

/** Text and activity supplied by the owning row. */
export interface TextShimmerProps {
  /** Text or presentational children with text in nested TextShimmer instances. No effects or element ids. */
  children: React.ReactNode;
  /** Whether to animate; nested instances share the containing row's activity. */
  active?: boolean | undefined;
  className?: string | undefined;
  /** Layout class applied equally to the base and decorative content. */
  contentClassName?: string | undefined;
}

/** Render one text fragment; inside a decoration it is emptied and kept as an attribute. */
function TextContent({ children, className }: Pick<TextShimmerProps, 'children' | 'className'>) {
  const DecorativeCopy = decorativeCopy();
  const decorative = React.useContext(DecorativeCopy);
  const generated = decorative === true && typeof children === 'string';
  return (
    <span className={cx(css.text, className)} data-shimmer-text={generated ? children : undefined}>
      {generated ? null : children}
    </span>
  );
}

/**
 * Render text with one shared highlight while retaining selectable, accessible content.
 * Nested instances inherit the outer animation. Keep icons outside; mark decorative
 * separators with data-shimmer-decoration so their background follows the highlight.
 * Active children also render in an inert, clipped decoration; supply only presentation.
 * @param props - localized text, running state, and owner styling.
 * @returns retained text and its optional decorative highlight.
 */
export const TextShimmer = memo(function TextShimmer({ children, active = false, className, contentClassName }: TextShimmerProps) {
  const DecorativeCopy = decorativeCopy();
  const decorative = React.useContext(DecorativeCopy);
  if (decorative !== undefined) return <TextContent className={className}>{children}</TextContent>;
  const content = typeof children === 'string' ? <TextContent>{children}</TextContent> : children;
  return (
    <span className={cx(css.root, className)} data-shimmer={active || undefined}>
      <DecorativeCopy.Provider value={false}>
        <span className={cx(css.content, contentClassName)}>{content}</span>
      </DecorativeCopy.Provider>
      {active && (
        // React 18 forwards inert as an empty string; a boolean is dropped.
        <span className={css.decoration} aria-hidden="true" {...({ inert: '' } as Record<string, unknown>)}>
          <span className={css.sweep}>
            <DecorativeCopy.Provider value>
              <span className={cx(css.content, css.highlight, contentClassName)}>{content}</span>
            </DecorativeCopy.Provider>
          </span>
        </span>
      )}
    </span>
  );
});
