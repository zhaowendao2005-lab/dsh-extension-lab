/**
 * One tool summary row with its lazily mounted expanded body.
 *
 * Port of ui-tool/src/client/tool/components/ToolRow.tsx. The card branches
 * (terminal / diff / read / image / search / web / details / ask-question) are
 * absent because each derives from a `ToolCallBlock`'s result metadata, which the
 * read-only mirror does not carry; every other call renders the generic IN/OUT
 * card. DOM, class hooks, data-* attributes and copy are the original ones.
 */

import React from '../../runtime';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { DisclosureRow, TextShimmer } from './atoms';
import { IconInspectOutlineRegular } from './icons';
import { label } from './labels';
import { formatToolBody, type ToolRowState, type ToolRowVariant } from './row-model';
import type { OpenFileOptions } from './actions';
import type { UseDisclosure } from './useDisclosure';

/* CSS-module keys of the vendored stylesheet (frontend/styles/chat-tools.css). */
const css = {
  root: 'mit-chat-tool-root',
  row: 'mit-chat-tool-row',
  leading: 'mit-chat-tool-leading',
  title: 'mit-chat-tool-title',
  sep: 'mit-chat-tool-sep',
  summary: 'mit-chat-tool-summary',
  summarySuffix: 'mit-chat-tool-summarySuffix',
  fileLink: 'mit-chat-tool-fileLink',
  errorSummary: 'mit-chat-tool-errorSummary',
  stoppedSummary: 'mit-chat-tool-stoppedSummary',
  bodyWrap: 'mit-chat-tool-bodyWrap',
  inspectButton: 'mit-chat-tool-inspectButton',
  ioCard: 'mit-chat-tool-ioCard',
  ioSection: 'mit-chat-tool-ioSection',
  ioLabel: 'mit-chat-tool-ioLabel',
  ioDivider: 'mit-chat-tool-ioDivider',
  ioText: 'mit-chat-tool-ioText',
  visuallyHidden: 'mit-chat-tool-visuallyHidden',
};

/** Host gesture bindings for a file or URL; the mirror supplies none. */
export type ContextMenuTriggerProps = {
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

export interface ToolRowProps {
  /** Subscribe here, where the row owns its expanded body. */
  useDisclosure: UseDisclosure;
  variant: ToolRowVariant;
  /** Wire tool name for tool-owned styling layered over the generic variant. */
  toolName?: string | undefined;
  icon: ReactNode;
  title: string;
  summary: string;
  /**
   * Trailing summary fragment rendered outside the ellipsized summary text, so
   * a narrow row clips the summary before this. Error and stopped rows omit it.
   */
  summarySuffix?: string | null | undefined;
  /** Original argument JSON formatted only while the row is expanded. */
  bodyRaw?: string | null | undefined;
  /** Flattened result text for the expanded Output section; null/absent = no output section. */
  output?: string | null | undefined;
  /** First error line for rows without an exit status capsule. */
  errorSummary?: string | null | undefined;
  state: ToolRowState;
  /** Recorded file target or a supported argument fallback. With onOpenFile,
   * the summary opens that path through the owner's file-preview callback. */
  filePath?: string | undefined;
  /** 1-based line the call was about; absent = open the file at its beginning. */
  filePathLine?: number | undefined;
  /** Open the path (already cwd-resolved), landing on `filePathLine` when given. */
  onOpenFile?: ((path: string, options?: OpenFileOptions) => void) | undefined;
  /** File gesture bindings supplied by the owning tool view. */
  fileContextMenuProps?: ContextMenuTriggerProps | undefined;
  /** URL gesture bindings supplied by the owning tool view. */
  urlContextMenuProps?: ContextMenuTriggerProps | undefined;
  /** Safe http(s) URL from tool args; when set, the summary renders as a link that opens it in a new tab. */
  href?: string | undefined;
  /** Jump to this call in the trajectory view: a hover-revealed Inspect pill
   * over the expanded body. Absent = no affordance. */
  inspect?: (() => void) | undefined;
}

/** Keep a summary link click from toggling the row; the browser still follows the link. */
function stopLinkClick(event: MouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation();
}

/** Visually hidden run-state label for color-only running and settlement cues. */
function stateStatus(state: ToolRowState): string | null {
  switch (state) {
    case 'preparing': return label('row.preparing');
    case 'running': return label('row.running');
    case 'error': return label('row.failed');
    case 'stopped': return label('row.stopped');
    default: return null;
  }
}

/**
 * Render one localized tool summary and lazily mounted result body.
 * @param props - tool state, summary, output, and navigation callbacks.
 * @returns the tool disclosure.
 */
export function ToolRow({
  variant,
  toolName,
  icon,
  title,
  summary,
  summarySuffix,
  bodyRaw,
  output,
  errorSummary,
  state,
  filePath,
  filePathLine,
  onOpenFile,
  fileContextMenuProps,
  urlContextMenuProps,
  href,
  inspect,
  useDisclosure,
}: ToolRowProps) {
  const { expanded, toggle: toggleExpand } = useDisclosure();
  const inputRaw = bodyRaw ?? null;
  const outputText = output ?? null;
  const expandable = state !== 'preparing' && (inputRaw !== null || outputText !== null);
  const open = expanded && expandable;
  const bodyText = React.useMemo(
    () => open && inputRaw !== null ? formatToolBody(variant, inputRaw) : null,
    [inputRaw, open, variant],
  );
  const status = stateStatus(state);
  const running = state === 'running' || state === 'preparing';
  const normalSummary = summary;
  // Generic failures retain their first result line.
  const failureLine = state === 'error' ? errorSummary ?? normalSummary : null;
  const summaryText = failureLine ?? normalSummary;
  const settledWithCue = state === 'error' || state === 'stopped';
  const suffix = settledWithCue ? null : summarySuffix ?? null;
  const openFile = React.useMemo(
    () => filePath !== undefined && onOpenFile !== undefined && !settledWithCue
      ? (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (filePathLine === undefined) onOpenFile(filePath);
        else onOpenFile(filePath, { line: filePathLine });
      }
      : undefined,
    [filePath, filePathLine, onOpenFile, settledWithCue],
  );
  const linkHref = settledWithCue ? undefined : href;
  // Keep Enter/Space on the focused path or URL link from bubbling to the row's
  // keydown handler, which would preventDefault() the key and toggle expand
  // instead of activating the link.
  const summaryLinkKeyDown = React.useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }, []);
  const cardBody = bodyText;
  const collapsedContent = React.useMemo(() => summaryText !== '' && (
    /* An empty summary drops the separator with it (a row that is only
       its title shows no trailing dot). */
    <>
      <span className={css.sep} data-shimmer-decoration aria-hidden />
      {openFile !== undefined ? (
        <button
          type="button"
          className={css.fileLink}
          {...fileContextMenuProps}
          onClick={openFile}
          onKeyDown={(event) => {
            summaryLinkKeyDown(event);
            fileContextMenuProps?.onKeyDown?.(event);
          }}
        >
          <TextShimmer>{summaryText}</TextShimmer>
        </button>
      ) : linkHref !== undefined ? (
        <a
          className={css.fileLink}
          href={linkHref}
          {...urlContextMenuProps}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopLinkClick}
          onKeyDown={(event) => {
            summaryLinkKeyDown(event);
            urlContextMenuProps?.onKeyDown?.(event);
          }}
        >
          <TextShimmer>{summaryText}</TextShimmer>
        </a>
      ) : (
        <span
          className={clsx(
            css.summary,
            state === 'error' && css.errorSummary,
            state === 'stopped' && css.stoppedSummary,
          )}
        >
          <TextShimmer>{summaryText}</TextShimmer>
        </span>
      )}
      {suffix !== null && (
        <TextShimmer className={css.summarySuffix}>{suffix}</TextShimmer>
      )}
    </>
  ), [summaryLinkKeyDown, fileContextMenuProps, urlContextMenuProps, linkHref, openFile, state, suffix, summaryText]);
  const expandedContent = React.useMemo(() => open ? (
    <div className={css.bodyWrap}>
      {(cardBody !== null || outputText !== null) && (
        <div className={css.ioCard}>
          {cardBody !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{label('row.input')}</span>
              <span className={css.ioText}>{cardBody}</span>
            </div>
          )}
          {cardBody !== null && outputText !== null && (
            <span className={css.ioDivider} aria-hidden />
          )}
          {outputText !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{label('row.output')}</span>
              <span className={css.ioText} data-error={state === 'error' || undefined}>
                {outputText}
              </span>
            </div>
          )}
        </div>
      )}
      {inspect !== undefined && (
        <button
          type="button"
          className={css.inspectButton}
          onClick={inspect}
        >
          <IconInspectOutlineRegular />
          {label('row.inspect')}
        </button>
      )}
    </div>
  ) : undefined, [open, inspect, cardBody, outputText, state]);
  return (
    <div className={css.root} data-variant={variant} data-tool={toolName} data-state={state}>
      {status !== null && <span className={css.visuallyHidden}>{status}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={icon}
        title={title}
        running={running}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggleExpand}
        collapsedContent={collapsedContent}
      >
        {expandedContent}
      </DisclosureRow>
    </div>
  );
}
