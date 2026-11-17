/** Assistant message node view: the body column for one assistant row. */
import React from '../../runtime';
import { memo } from '../lazy';
import { AssistantMarkdown } from './AssistantMarkdown';

/** Props of the assistant row. */
export interface AssistantRowProps {
  /** Assistant text accumulated for the row. */
  text: string;
  /** Whether the row is the streaming tail. */
  running: boolean;
  /** The turn was interrupted: keep the partial text with a stopped marker. */
  interrupted?: boolean | undefined;
}

/**
 * Render one assistant row.
 *
 * The DSH original also folded turn-level process disclosures into this node
 * (`reasoningHidden` / `revealProcess`) and rendered the reasoning slot. A
 * mirrored transcript row presents reasoning as its own row, so no process
 * hiding applies here and the body renders unconditionally.
 * @param props - assistant text, stream state and interruption.
 * @returns the assistant row.
 */
export const AssistantNodeView = memo(function AssistantNodeView({
  text, running, interrupted,
}: AssistantRowProps) {
  return (
    <AssistantMarkdown
      text={text}
      streaming={running}
      textInteractionSource={!running}
      interrupted={interrupted}
    />
  );
});
