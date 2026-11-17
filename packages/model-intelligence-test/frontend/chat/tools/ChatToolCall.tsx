/**
 * One recorded tool call, rendered with the DSH tool-call row layer.
 *
 * Collapsed it is a single summary line (leading icon, tool title, one-line
 * summary, state); expanding it shows the argument JSON and the recorded result
 * through the same disclosure and IN/OUT card DSH uses for tools without a
 * keyed card.
 */

import React from '../../runtime';
import { GenericToolCard } from './GenericToolCard';
import { useDisclosure } from './useDisclosure';

/** One recorded tool call of the mirrored session. */
export interface ChatToolCallProps {
  /** Wire tool name, for example `sandbox_writeFile`. */
  name: string;
  /** Recorded lifecycle state. */
  status: 'running' | 'ok' | 'error';
  /** Formatted argument JSON text, or null before arguments were recorded. */
  arguments: string | null;
  /** Recorded result text or JSON, or null while running. */
  content: string | null;
}

/**
 * Render one tool call as a collapsed summary row with an expandable body.
 * @param props - recorded tool name, state, arguments and result.
 * @returns the tool-call row.
 */
export function ChatToolCall({ name, status, arguments: argsRaw, content }: ChatToolCallProps): React.JSX.Element {
  return (
    <GenericToolCard
      name={name}
      status={status}
      arguments={argsRaw}
      content={content}
      useDisclosure={useDisclosure}
    />
  );
}
