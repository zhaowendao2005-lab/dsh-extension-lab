/**
 * Class-name tables for the vendored chat rows.
 *
 * Each object mirrors one CSS module of the reference renderer, keyed by the
 * module's own property names, so ported call sites keep reading `css.root`
 * unchanged while the real class text lives in `frontend/styles/chat-rows.css`.
 * The mapping is mechanical: `.foo` in `Bar.module.css` becomes
 * `.mit-chat-bar-foo` (plugin scope + component domain + original camelCase
 * suffix). Keep the keys and the stylesheet in sync.
 */

/** `ChatView.module.css` — flow container, row spacing and the slots inside it. */
export const chatviewCss = {
  column: 'mit-chat-chatview-column',
  flowItem: 'mit-chat-chatview-flowItem',
  turnSpacer: 'mit-chat-chatview-turnSpacer',
  textInteraction: 'mit-chat-chatview-textInteraction',
  older: 'mit-chat-chatview-older',
  running: 'mit-chat-chatview-running',
  runningDivider: 'mit-chat-chatview-runningDivider',
} as const;

/** `MessageItem.module.css` — user row, attachment cards, turn error row. */
export const messageCss = {
  userRow: 'mit-chat-message-userRow',
  userStack: 'mit-chat-message-userStack',
  attachmentRow: 'mit-chat-message-attachmentRow',
  fileCard: 'mit-chat-message-fileCard',
  fileIcon: 'mit-chat-message-fileIcon',
  fileContent: 'mit-chat-message-fileContent',
  fileName: 'mit-chat-message-fileName',
  fileMeta: 'mit-chat-message-fileMeta',
  referenceSummary: 'mit-chat-message-referenceSummary',
  contextRow: 'mit-chat-message-contextRow',
  inheritedHistoryRow: 'mit-chat-message-inheritedHistoryRow',
  inheritedHistoryLine: 'mit-chat-message-inheritedHistoryLine',
  inheritedHistoryCaption: 'mit-chat-message-inheritedHistoryCaption',
  inheritedHistoryIcon: 'mit-chat-message-inheritedHistoryIcon',
  inheritedHistoryLabel: 'mit-chat-message-inheritedHistoryLabel',
  compactionRow: 'mit-chat-message-compactionRow',
  compactionButton: 'mit-chat-message-compactionButton',
  compactionLeading: 'mit-chat-message-compactionLeading',
  compactionContextIcon: 'mit-chat-message-compactionContextIcon',
  compactionDisclosureIcon: 'mit-chat-message-compactionDisclosureIcon',
  compactionTitle: 'mit-chat-message-compactionTitle',
  compactionSep: 'mit-chat-message-compactionSep',
  compactionSummary: 'mit-chat-message-compactionSummary',
  compactionBody: 'mit-chat-message-compactionBody',
  retryRow: 'mit-chat-message-retryRow',
  retrySummary: 'mit-chat-message-retrySummary',
  retryText: 'mit-chat-message-retryText',
  retryDetails: 'mit-chat-message-retryDetails',
  retryDetailLabel: 'mit-chat-message-retryDetailLabel',
  turnErrorRow: 'mit-chat-message-turnErrorRow',
  turnErrorDot: 'mit-chat-message-turnErrorDot',
  turnErrorCopy: 'mit-chat-message-turnErrorCopy',
  turnErrorTitle: 'mit-chat-message-turnErrorTitle',
  turnErrorMessage: 'mit-chat-message-turnErrorMessage',
  turnErrorCode: 'mit-chat-message-turnErrorCode',
  maxTokensTitle: 'mit-chat-message-maxTokensTitle',
} as const;

/** `MessageIconActions.module.css` — copy / branch / clock row. */
export const actionsCss = {
  actions: 'mit-chat-actions-actions',
  action: 'mit-chat-actions-action',
  timeStart: 'mit-chat-actions-timeStart',
  timeEnd: 'mit-chat-actions-timeEnd',
  endInfo: 'mit-chat-actions-endInfo',
  visuallyHidden: 'mit-chat-actions-visuallyHidden',
} as const;

/** `AssistantMarkdown.module.css` — assistant block column. */
export const assistantCss = {
  root: 'mit-chat-assistant-root',
  body: 'mit-chat-assistant-body',
  stopped: 'mit-chat-assistant-stopped',
  actions: 'mit-chat-assistant-actions',
} as const;

/** `ReasoningRow.module.css` — thinking disclosure row. */
export const reasoningCss = {
  root: 'mit-chat-reasoning-root',
  row: 'mit-chat-reasoning-row',
  leading: 'mit-chat-reasoning-leading',
  title: 'mit-chat-reasoning-title',
  separator: 'mit-chat-reasoning-separator',
  summary: 'mit-chat-reasoning-summary',
  summaryText: 'mit-chat-reasoning-summaryText',
  thinkBody: 'mit-chat-reasoning-thinkBody',
} as const;

/** `TurnTailNodeView.module.css` — turn tail stack. */
export const turnTailCss = {
  root: 'mit-chat-turntail-root',
  actions: 'mit-chat-turntail-actions',
} as const;

/** `TurnUsagePanel.module.css` — turn usage trigger pill. */
export const usageCss = {
  root: 'mit-chat-usage-root',
  trigger: 'mit-chat-usage-trigger',
  label: 'mit-chat-usage-label',
} as const;

/** Plugin per-turn usage row (after `TurnUsagePanel.module.css` + `TurnTailNodeView.module.css`). */
export const turnUsageRowCss = {
  root: 'mit-chat-rows-turnusage-root',
  pill: 'mit-chat-rows-turnusage-pill',
  trigger: 'mit-chat-rows-turnusage-trigger',
  label: 'mit-chat-rows-turnusage-label',
} as const;

/** `StatsPills.module.css` — composer-dock stat pills. */
export const statsCss = {
  anchor: 'mit-chat-stats-anchor',
  pill: 'mit-chat-stats-pill',
  label: 'mit-chat-stats-label',
  sep: 'mit-chat-stats-sep',
} as const;

/** `stat-dialog.module.css` — shared stat dialog surface. */
export const statDialogCss = {
  panel: 'mit-chat-statdialog-panel',
  title: 'mit-chat-statdialog-title',
  titleRule: 'mit-chat-statdialog-titleRule',
  titleValue: 'mit-chat-statdialog-titleValue',
  titleLabel: 'mit-chat-statdialog-titleLabel',
  details: 'mit-chat-statdialog-details',
  route: 'mit-chat-statdialog-route',
  reasoning: 'mit-chat-statdialog-reasoning',
} as const;

/** `accessibility.module.css` — screen-reader-only text. */
export const a11yCss = {
  visuallyHidden: 'mit-chat-a11y-visuallyHidden',
} as const;

/** `DisclosureRow.module.css` (ui-primitives). */
export const disclosureCss = {
  root: 'mit-chat-disclosure-root',
  header: 'mit-chat-disclosure-header',
  row: 'mit-chat-disclosure-row',
  leading: 'mit-chat-disclosure-leading',
  iconIdle: 'mit-chat-disclosure-iconIdle',
  chevronHover: 'mit-chat-disclosure-chevronHover',
  title: 'mit-chat-disclosure-title',
} as const;

/** `TextShimmer.module.css` (ui-primitives). */
export const shimmerCss = {
  root: 'mit-chat-shimmer-root',
  content: 'mit-chat-shimmer-content',
  text: 'mit-chat-shimmer-text',
  decoration: 'mit-chat-shimmer-decoration',
  sweep: 'mit-chat-shimmer-sweep',
  highlight: 'mit-chat-shimmer-highlight',
} as const;

/** `StateDot.module.css` (ui-primitives). */
export const stateDotCss = {
  dot: 'mit-chat-statedot-dot',
  step: 'mit-chat-statedot-step',
  spinner: 'mit-chat-statedot-spinner',
  spinnerMotion: 'mit-chat-statedot-spinnerMotion',
  spinnerTrack: 'mit-chat-statedot-spinnerTrack',
  spinnerArc: 'mit-chat-statedot-spinnerArc',
} as const;

/** `UserMessageBubble.module.css` (ui-primitives). */
export const bubbleCss = {
  bubble: 'mit-chat-bubble-bubble',
} as const;

/** `Tooltip.module.css` (ui-primitives). */
export const tooltipCss = {
  bubble: 'mit-chat-tooltip-bubble',
  label: 'mit-chat-tooltip-label',
} as const;
