/** Turn-local actions tail, independent of assistant placement. */
import React from '../../runtime';
import { memo } from '../lazy';
import { turnTailCss as css } from './classes';
import { MessageIconActions } from './MessageIconActions';
import { TurnUsagePanel } from './TurnUsagePanel';
import type { TurnTokenUsage } from './usage-types';

/** Props of the turn tail row. */
export interface TurnTailProps {
  /** Turn number this tail closes. */
  turn: number;
  /** Unix epoch ms of the closing message. */
  time?: number | undefined;
  /** Plain text the copy action writes: the turn's assistant reply. */
  text?: string | undefined;
  /** Whether the tail ends with an assistant response, so its actions stay revealed. */
  endsWithResponse?: boolean | undefined;
  /** Branch callback; omission hides the branch control. */
  onBranch?: (() => void) | undefined;
  /** The turn is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined;
  /** Slot-rendered actions owned by independent plugins. */
  extraActions?: React.ReactNode;
  /** Token accounting to show as the usage pill; omitted when the turn reported none. */
  usage?: TurnTokenUsage | undefined;
}

/**
 * Render the actions that close one turn.
 *
 * The DSH original also filled `conversation.chat.turnTail` and
 * `conversation.chat.assistant-actions` from host slots; a plugin cannot render
 * host slots, so both arrive as ordinary optional props instead.
 * @param props - turn identity, copy text, branch wiring and usage buckets.
 * @returns the turn tail row.
 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  turn, time, text = '', endsWithResponse = true, onBranch, branchUnavailable = false, extraActions, usage,
}: TurnTailProps) {
  return (
    <div
      className={css.root}
      data-turn-tail={turn}
      data-actions-reveal={endsWithResponse ? 'always' : 'hover'}
    >
      <MessageIconActions
        text={text}
        time={time}
        clock="end"
        // The branch action owns boundary resolution: it sends the real
        // turn/end seq it already has, and the Host cuts exactly there.
        onBranch={onBranch}
        branchUnavailable={branchUnavailable}
        className={css.actions}
        extraActions={extraActions}
        usageAction={usage === undefined ? null : <TurnUsagePanel usage={usage} />}
      />
    </div>
  );
});
