/**
 * Public entry point of the vendored chat rows.
 *
 * The markup lives in `views.tsx` (JSX) because this file must stay a plain
 * `.ts` entry point; every view is re-exported here, so importers use
 * `chat/rows` and never reach into an implementation module.
 */
export {
  ChatUserRowView,
  ChatAssistantRowView,
  ChatReasoningRowView,
  ChatErrorRowView,
  ChatTurnRowView,
  ChatFlow,
} from './views';

export { chatRowActions, setChatRowActions, type ChatRowActions } from './actions';

export { ReasoningRow } from './ReasoningRow';
export { AssistantMarkdown, type AssistantMarkdownProps } from './AssistantMarkdown';
export { AssistantNodeView, type AssistantRowProps } from './AssistantNodeView';
export { UserMessageNodeView, TurnErrorItem, type UserRowProps, type TurnErrorNode } from './MessageItem';
export { UserContent, type UserContentData } from './UserContent';
export { MessageIconActions, type MessageIconActionsProps } from './MessageIconActions';
export { TurnTailNodeView, type TurnTailProps } from './TurnTailNodeView';
export { TurnUsagePanel, type TurnUsagePanelProps } from './TurnUsagePanel';
export { ActivityPill, UsagePill, formatDuration, cacheHitPercent, billedInputTokens } from './StatsPills';
export type { PerformanceUsageMode, SessionTokenUsage, StatPillProps, WindowStats } from './StatsPills';
export type { TurnTokenUsage, TurnTokenUsageRoute } from './usage-types';
export { t as chatTranslate, type ChatLocaleKey, type ChatTranslate, type ChatTranslateParams } from './locale';
export { presentation, usePresentation, type PresentationPolicy, type UseDisclosure } from './presentation';
