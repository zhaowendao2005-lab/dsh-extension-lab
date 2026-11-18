/**
 * Per-turn usage row, after DSH `chat/TurnUsagePanel.tsx` + `TurnTailNodeView`.
 *
 * DSH closes each turn with a tail whose usage pill (`TurnUsagePanel`) opens a
 * trigger-anchored stat dialog listing the turn's token buckets. This mirror
 * keeps that markup and behavior — one pill, a click-open portaled dialog with
 * outside-click / Escape dismissal through `useStatDialog`, and the shared
 * stat-dialog skin — but reads the plugin's `ChatTurnUsage`, whose buckets may
 * be unknown. An unknown bucket shows as 「未知」 instead of becoming 0.
 */
import React from '../../runtime';
import { statDialogCss as dialogCss, turnUsageRowCss as css } from './classes';
import { IconDatabaseOutlineRegular } from './icons';
import { t } from './locale';
import { createPortal } from './react-dom';
import { useStatDialog } from './stat-dialog';
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format';
import type { ChatTurnUsage } from '../model';

/** Exact count with the DSH `{count} tok` phrasing, or 「未知」. */
function exact(value: number | undefined): string {
  return value === undefined ? '未知' : t('message.turnUsage.count', { count: formatExactTokens(value, t) });
}

/** Compact count with the DSH `{count} tok` phrasing. */
function compact(value: number): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) });
}

/**
 * Turn usage pill plus its details dialog.
 * @param props.turn - turn number, carried as `data-turn-usage`.
 * @param props.usage - aggregated buckets; unknown buckets stay undefined.
 * @returns the pill and, while open, its portaled dialog.
 */
export function ChatTurnUsagePanel({ turn, usage }: { turn: number; usage: ChatTurnUsage }): React.JSX.Element {
  const { open, setOpen, rootRef, panelRef, anchorName } = useStatDialog();
  const total = usage.inputTokens !== undefined && usage.outputTokens !== undefined
    ? usage.inputTokens + usage.outputTokens
    : undefined;
  // DSH: cache hit = cacheRead / prompt input; our input already includes cache.
  const cacheHit = usage.cacheReadTokens !== undefined && usage.inputTokens !== undefined
    ? formatCacheHitPercent(Math.min(usage.cacheReadTokens, usage.inputTokens), usage.inputTokens, 1)
    : null;
  const label = total === undefined
    ? `请求数 ${usage.requests}`
    : t('message.turnUsage.consumed', { total: compact(total) });

  return (
    <div className={css.root} data-turn-usage={turn}>
      <span ref={rootRef} style={{ anchorName } as React.CSSProperties} className={css.pill}>
        <button
          type="button"
          className={css.trigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open); }}
        >
          <IconDatabaseOutlineRegular />
          <span className={css.label}>{label}</span>
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
              <span className={dialogCss.titleValue}>{exact(total)}</span>
            </div>
            <div className={dialogCss.titleRule} aria-hidden />
            <dl className={dialogCss.details} data-turn-usage-details>
              {cacheHit !== null && (
                <>
                  <dt>{t('message.turnUsage.cacheHit')}</dt>
                  <dd>{`${cacheHit}%`}</dd>
                </>
              )}
              <dt>输入</dt>
              <dd>{exact(usage.inputTokens)}</dd>
              <dt>缓存读取</dt>
              <dd>{exact(usage.cacheReadTokens)}</dd>
              <dt>输出</dt>
              <dd>{exact(usage.outputTokens)}</dd>
              <dt>推理 Token</dt>
              <dd>{exact(usage.reasoningTokens)}</dd>
              <dt>请求数</dt>
              <dd>{String(usage.requests)}</dd>
            </dl>
          </div>,
          document.body,
        )}
      </span>
    </div>
  );
}
