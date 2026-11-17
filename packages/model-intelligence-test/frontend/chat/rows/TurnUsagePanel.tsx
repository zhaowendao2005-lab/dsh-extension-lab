/** Completed-Turn token usage action and its accounting details dialog. */
import React from '../../runtime';
import { statDialogCss as dialogCss, usageCss as css } from './classes';
import { IconDatabaseOutlineRegular } from './icons';
import { t } from './locale';
import { createPortal } from './react-dom';
import { useStatDialog } from './stat-dialog';
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format';
import type { TurnTokenUsage } from './usage-types';

/** Props of the turn usage pill. */
export interface TurnUsagePanelProps {
  usage: TurnTokenUsage;
}

/** Compact token count phrased as one usage reading. */
function formatCompactCount(value: number): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) });
}

/** Exact token count phrased as one usage reading. */
function formatExactCount(value: number): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) });
}

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * @param props.usage - Turn usage buckets.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, anchorName } = useStatDialog();

  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1);
  const total = formatCompactCount(usage.totalTokens);
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? '';

  return (
    <span ref={rootRef} style={{ anchorName } as React.CSSProperties} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open); }}
      >
        <IconDatabaseOutlineRegular />
        <span className={css.label}>{t('message.turnUsage.consumed', { total })}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnUsage.title')}
          style={{ positionAnchor: anchorName } as React.CSSProperties}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutlineRegular />
              {t('message.turnUsage.title')}
            </span>
            <span className={dialogCss.titleValue}>{formatExactCount(usage.totalTokens)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-usage-details>
            {routes !== '' && (
              <>
                <dt>{t('message.turnUsage.model')}</dt>
                <dd className={dialogCss.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens)}
              {usage.reasoningTokens !== undefined && (
                <span className={dialogCss.reasoning}>
                  {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens) })}
                </span>
              )}
            </dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  );
}
