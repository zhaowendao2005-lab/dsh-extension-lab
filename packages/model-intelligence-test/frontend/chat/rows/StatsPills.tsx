// Composer statistics pills, each its own 'conversation.composer.dock' list
// entry (activity, usage) so a plugin can replace or add one pill by id.
// Compact keeps speed and cache hit as plain readings; Detailed adds counts,
// token totals, and click-open dialogs.
//
// Ported verbatim from ui-chat `chat/StatsPills.tsx`. The reference reads two
// live projections (`sessionStats`, `tokenUsage`) and the performance-usage
// seat through injected hooks; a read-only plugin mirror has no projection
// store, so the same figures arrive as plain props and the fold over paged
// snapshot nodes (`deriveStats`) is gone with them.

import React from '../../runtime';
import { memo } from '../lazy';
import { IconDatabaseOutlineRegular, IconGaugeOutlineRegular } from './icons';
import { Tooltip } from './Tooltip';
import { createPortal } from './react-dom';
import { formatTokensPerSecond } from './message-chrome';
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format';
import { useStatDialog } from './stat-dialog';
import { t as translate, type ChatTranslate } from './locale';
import { statDialogCss as dialogCss, statsCss as css } from './classes';

/** Compact trims a pill to one reading; detailed opens its dialog. */
export type PerformanceUsageMode = 'compact' | 'detailed';

/** Window-scoped totals folded from the session's assistant and tool nodes. */
export interface WindowStats {
  turns: number;
  steps: number;
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number;
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number;
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number;
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number;
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number;
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number;
}

/** Whole-session token accounting, one bucket per prompt-side billing class. */
export interface SessionTokenUsage {
  readonly uncachedInputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @param t - locale seat.
 * @returns display string.
 */
export function formatDuration(ms: number, t: ChatTranslate = translate): string {
  const s = ms / 1_000;
  if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 });
  const whole = Math.round(s);
  return t('duration.compactMinutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  });
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token usage.
 * @param t - locale seat.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
export function cacheHitPercent(usage: SessionTokenUsage, t: ChatTranslate = translate): string | null {
  const denominator = billedInputTokens(usage);
  return formatCacheHitPercent(usage.cacheReadTokens, denominator, 0);
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token usage.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: SessionTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

type Translate = ChatTranslate;

/** Props shared by every stats pill: the folded stats or usage plus the reading mode. */
export interface StatPillProps {
  /** Compact trims the pill to one reading; detailed opens its dialog. */
  mode: PerformanceUsageMode;
  /** The owning dock's locale seat. */
  t?: Translate;
}

/** Dock entry id carried as `data-composer-stat` on each pill. */
type StatId = 'activity' | 'usage';

interface PillContent {
  stat: StatId;
  icon: React.ReactNode;
  label: React.ReactNode;
  /** The full reading as plain text: the accessible name and the tooltip shown while the label is cut off. */
  text: string;
}

function exactCount(value: number, t: Translate): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) });
}

/** One or two reading segments, visually joined by a separator glyph. */
function reading(first: string, second: string | null): Pick<PillContent, 'label' | 'text'> {
  if (second === null) return { label: first, text: first };
  return {
    label: (
      <>
        {first}
        <span className={css.sep} aria-hidden>·</span>
        {second}
      </>
    ),
    text: `${first} · ${second}`,
  };
}

function decodeSpeed(stats: WindowStats, t: Translate): string {
  return t('message.tokensPerSecond', {
    tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
  });
}

/** The full reading above a pill, only while an ellipsis cuts its label; the delay matches the dock's context meter. */
const FULL_READING_TOOLTIP = { side: 'top', portal: true, delayMs: 200, onlyWhenClipped: true } as const;

/** A static reading: used when the pill has no dialog rows or the mode is Compact. */
function PlainPill({ stat, icon, label, text }: PillContent) {
  return (
    <span className={css.anchor} data-composer-stat={stat}>
      {/* No dialog carries a static reading, so a tap also pins the full text. */}
      <Tooltip label={text} {...FULL_READING_TOOLTIP} openOnClick>
        <span className={css.pill}>
          {icon}
          <span className={css.label}>{label}</span>
        </span>
      </Tooltip>
    </span>
  );
}

/**
 * A pill button opening its own portaled dialog. Each pill owns its open
 * state; useStatDialog closes it on Escape or an outside pointerdown or click,
 * so at most one dialog is open across the dock.
 */
function DialogPill({ stat, icon, label, text, title, titleValue, children }: PillContent & {
  title: string;
  titleValue?: string;
  children: React.ReactNode;
}) {
  const { open, setOpen, rootRef, panelRef, anchorName } = useStatDialog();
  return (
    <span ref={rootRef} style={{ anchorName } as React.CSSProperties} className={css.anchor} data-composer-stat={stat}>
      {/* The open dialog already shows every figure; a tooltip would cover it. */}
      <Tooltip label={text} {...FULL_READING_TOOLTIP} disabled={open}>
        <button
          type="button"
          className={css.pill}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={text}
          onClick={() => { setOpen(!open) }}
        >
          {icon}
          <span className={css.label}>{label}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={title}
          style={{ positionAnchor: anchorName } as React.CSSProperties}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              {icon}
              {title}
            </span>
            {titleValue !== undefined && <span className={dialogCss.titleValue}>{titleValue}</span>}
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}

/**
 * Turn and step counts with whole-session speed, opening the time and speed
 * dialog; Compact keeps only the speed reading.
 */
export const ActivityPill = memo(function ActivityPill({ stats, mode, t = translate }: StatPillProps & { stats: WindowStats }) {
  const speed = stats.decodeMs > 0 ? decodeSpeed(stats, t) : null;
  const icon = <IconGaugeOutlineRegular />;
  if (mode === 'compact') return speed === null ? null : <PlainPill stat="activity" icon={icon} {...reading(speed, null)} />;
  if (stats.steps === 0) return null;
  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps });
  const content: PillContent = { stat: 'activity', icon, ...reading(counts, speed) };
  // A window without one timed figure has no dialog rows to show, so the pill
  // stays a plain reading instead of a button opening an empty dialog.
  if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && speed === null) return <PlainPill {...content} />;
  return (
    // The counts head the dialog, so a cut-off reading stays complete once the dialog opens.
    <DialogPill {...content} title={t('stats.dialog.title')} titleValue={counts}>
      <dl className={dialogCss.details} data-session-stats-details>
        {stats.llmMs > 0 && (
          <>
            <dt>{t('stats.dialog.llmTime')}</dt>
            <dd>{formatDuration(stats.llmMs, t)}</dd>
          </>
        )}
        {stats.toolMs > 0 && (
          <>
            <dt>{t('stats.dialog.toolTime')}</dt>
            <dd>{formatDuration(stats.toolMs, t)}</dd>
          </>
        )}
        {stats.ttftSteps > 0 && (
          <>
            <dt>{t('stats.dialog.ttft')}</dt>
            <dd>{formatDuration(stats.ttftMs / stats.ttftSteps, t)}</dd>
          </>
        )}
        {speed !== null && (
          <>
            <dt>{t('stats.dialog.speed')}</dt>
            <dd>{speed}</dd>
          </>
        )}
      </dl>
    </DialogPill>
  );
});

/** Whole-log token total and cache hit; Compact keeps only the cache hit. */
export const UsagePill = memo(function UsagePill({ usage, mode, t = translate }: StatPillProps & { usage: SessionTokenUsage | undefined }) {
  // Gated on actual token activity: a session whose steps all settled without
  // billing (e.g. every request failed) shows no usage pill.
  if (usage === undefined || (billedInputTokens(usage) === 0 && usage.outputTokens === 0)) return null;
  const cacheHit = cacheHitPercent(usage, t);
  const cacheHitText = cacheHit !== null ? t('stats.cacheHit', { percent: cacheHit }) : null;
  const icon = <IconDatabaseOutlineRegular />;
  if (mode === 'compact') {
    return cacheHitText === null ? null : <PlainPill stat="usage" icon={icon} {...reading(cacheHitText, null)} />;
  }
  // Same aggregate as the Turn pill's totalTokens: every prompt-side billing bucket plus output.
  const total = billedInputTokens(usage) + usage.outputTokens;
  const totalText = t('message.turnUsage.count', { count: formatTokens(total, t) });
  return (
    <DialogPill
      stat="usage"
      icon={icon}
      {...reading(totalText, cacheHitText)}
      title={t('stats.dialog.usageTitle')}
      titleValue={exactCount(total, t)}
    >
      <dl className={dialogCss.details} data-session-stats-usage>
        {cacheHit !== null && (
          <>
            <dt>{t('message.turnUsage.cacheHit')}</dt>
            <dd>{`${cacheHit}%`}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.input')}</dt>
        <dd>{exactCount(usage.uncachedInputTokens, t)}</dd>
        <dt>{t('message.turnUsage.cacheRead')}</dt>
        <dd>{exactCount(usage.cacheReadTokens, t)}</dd>
        {usage.cacheWriteTokens !== 0 && (
          <>
            <dt>{t('message.turnUsage.cacheWrite')}</dt>
            <dd>{exactCount(usage.cacheWriteTokens, t)}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.output')}</dt>
        <dd>{exactCount(usage.outputTokens, t)}</dd>
      </dl>
    </DialogPill>
  );
});
