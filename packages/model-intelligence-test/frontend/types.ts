export type TestKind = 'fingerprint' | 'custom';
export type CustomRunPhase = 'queued' | 'preparing' | 'running' | 'tooling' | 'validating' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type Stage = 'queued' | 'waiting-first-token' | 'streaming' | 'finalizing' | 'analyzing' | CustomRunPhase | 'timeout';
export interface Model { key: string; provider: string; providerName: string; id: string; name: string; search: string; relay?: RelayRef; a6api?: A6Channel }
export interface Provider { id: string; name: string; models: {id: string; name: string; description?: string}[]; error?: string }
export interface Catalog { providers: Provider[] }
export interface CatalogTransport { catalog(): Promise<Catalog> }
export type SampleState = 'queued' | 'waiting' | 'streaming' | 'complete' | 'truncated' | 'failed' | 'cancelled';
export type FingerprintDecision = 'scored' | 'partial' | 'unscorable' | 'not_model';
export interface FingerprintErrorDetail { source: string | null; message: string | null; code: string | null; status: number | null; text: string | null; stack: string | null }
export interface FingerprintSample { index: number; state: SampleState; expectedCount: number; count: number; text: string; firstByteMs: number | null; firstTextMs?: number | null; generationMs?: number | null; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; finish: string | null; error: string | null; errorDetail?: FingerprintErrorDetail | null }
export interface FingerprintCandidate { model: string; displayName: string; family: string; familyName: string; score: number; probability: number | null }
export interface FingerprintAnalysis { decision: FingerprintDecision; prediction: string | null; predictionName: string | null; familyName: string | null; probability: number | null; probabilityStatus: string; rankingScore: number | null; usedOutputs: number; candidates: FingerprintCandidate[]; diagnostics: {index: number; parsed: number; minimum: number; accepted: boolean; outOfRange: number}[]; sequence: {autocorrelation: number; smallStepShare: number; modelLike: boolean} | null; method: string }
export interface FingerprintChallenge { id: string; expectedCount: number; prompt: string; language: string }
export type A6Routing = 'waiting-page' | 'pinning' | 'sampling' | 'restoring' | 'restored' | 'restore-failed';
export interface FingerprintRunView { provider: string; model: string; stage: Stage; error: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null} | null; analysis: FingerprintAnalysis | null; samples: FingerprintSample[]; relay?: RelayRef; routing?: A6Routing | null; callProvider?: string | null; slotTokenId?: number | null }
export interface FingerprintLimits { maxConcurrency: number; maxConcurrentRequests: number; requestsPerModel: number; defaultConcurrency: number; defaultTimeoutMs: number; minTimeoutMs: number; maxTimeoutMs: number }
export interface FingerprintJobView { id: string; revision: number; status: 'running' | 'done' | 'cancelled'; createdAt: number; finishedAt: number | null; concurrency: number; timeoutMs: number; limits: FingerprintLimits; slots: number; reference: {builtAt: string; source: string; sdk: string}; challenges: FingerprintChallenge[]; runs: FingerprintRunView[] }
export type FingerprintStatusView = FingerprintJobView | {id: string; revision: number; unchanged: true};
export interface FingerprintOptions { concurrency?: number; timeoutMs?: number }

export interface A6MarketSnapshot { capturedAt: number; chargeType?: string; currency?: string; unit?: string; inputPriceMicros?: number; outputPriceMicros?: number; cacheReadPriceMicros?: number; cacheWritePriceMicros?: number; perRequestPriceMicros?: number; exchangeRate?: number; cacheHitRate24h?: number; cacheHitState?: string }
export interface A6Channel { listingId: number; channelId: number; supplierId: number; model: string; supplierName?: string; channelName?: string; brand?: string; market?: A6MarketSnapshot }
export interface CustomA6ModelRef { channelId: number; model: string; api?: A6Protocol }
export interface A6OperationToken { id: number; name: string; maskedKey?: string; status?: number | string; expiredTime?: number }
export type A6RelationKind = 'pins' | 'routes' | 'all';
export interface A6OperationView { accountId: string; revision: number; tokenId: number | null; tokens: A6OperationToken[]; tokensAt: number | null; pins: {model: string; channelId: number; routeEffective: boolean; status: string}[]; routes: {model: string; channelIds: number[]}[]; pinsAt: number | null; routesAt: number | null; loading: {tokens: boolean; pins: boolean; routes: boolean}; errors: {tokens?: string; pins?: string; routes?: string}; legacyLeases: {recordId: string | null; tokenId: number; model: string; channelId: number; stage: string}[] }
export interface A6ResultActionInput { recordId: string; model: string; channelId: number; tokenId: number; operation: 'pin' | 'route' | 'restore' }
export interface A6ResultActionOutcome { ok: true; result?: {operation?: string; tokenId?: number; model?: string; channelId?: number; verified?: boolean; skipped?: boolean}; state: A6OperationView }
export interface A6LedgerSummary { requestCount: number | null; knownCostCny: number | null; billedCount: number; pendingCount: number; inputTokens?: number | null; outputTokens?: number | null; coverage: {requestIdCount: number; billingCompleteCount: number; usageCount: number; unattributedCount: number; inputCount?: number; outputCount?: number; ambiguousCount?: number; legacy?: boolean} }
export interface A6Execution { id?: string; model?: string; intendedChannelId?: number; channelId?: number; requestId?: string; state: string; usageState?: string; billingState?: string; quota?: number; costCny?: number | null; inputTokens?: number | null; outputTokens?: number | null; channelMismatch?: boolean; accountState?: 'current'|'historical' }
export interface A6LedgerView { executions: A6Execution[]; summary: A6LedgerSummary }
export interface A6LedgerEntry { view?: A6LedgerView; loading: boolean; error?: string }
export interface A6ResultFeedback { pending?: 'pin' | 'route' | 'restore'; message?: string; error?: string }
export interface A6InsightsState { operations: A6OperationView | null; loading: boolean; busy: number; query: string; error?: string; feedback?: string; results: Record<string,A6ResultFeedback>; ledgers: Record<string,A6LedgerEntry>; scopes: Record<string,'attempt'|'record'> }
export interface A6Token { id: number; name: string }
export interface A6Slot { tokenId: number; name?: string }
export interface A6Selection { id: string; accountId: string; siteOrigin: string; createdAt: number; kind?: TestKind; models: A6Channel[]; tokens: A6Token[] }
/** Credential state as the panel sees it: the access token itself never leaves Host storage. */
export interface A6Config { configured: boolean; mask: string; userId: string; intakeToken: string; origin: string; link?: string; userscript?: {version: string; protocolVersion: number; installUrl: string; updateUrl: string; networkInstallUrl?: string; networkUpdateUrl?: string; recent?: {version: string; protocolVersion: number | null; seenAt: number; accountId: string}} }
export type A6SelectionsView = {revision: number; selections: A6Selection[]} | {revision: number; unchanged: true};
export interface A6CreateInput { selectionId: string; name: string; slots: A6Slot[]; timeoutMs?: number; models?: A6Channel[]; kind?: TestKind; prompt?: string; footerVersion?: string; preset?: Preset | null; concurrency?: number; dshModels?: RecordModelRef[]; protocols?: {channelId: number; model: string; api: A6Protocol}[] }
export interface A6Record { accountId: string; siteOrigin: string; selectionId: string; slots: A6Slot[] }
export interface A6Draft { name: string; models: A6Channel[]; tokens: number[]; timeoutMs?: number; creating: boolean; error?: string; feedback?: string }
export interface A6State { selections: A6Selection[]; drafts: Record<string, A6Draft>; loaded: boolean; error?: string; config: A6Config | null; configLoading: boolean; configError?: string; configFeedback?: string; form: {accessToken: string; userId: string}; saving: boolean; rotating: boolean; copying: boolean }
export type RelayApi = 'chat' | 'responses' | 'messages' | A6Protocol;
/** DSH-native wire protocols (dsh-llm-pi-ai PROTOCOLS); legacy chat/messages are read-compatible aliases. */
export type A6Protocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
export const A6_PROTOCOLS: {id: A6Protocol; label: string}[] = [
  { id: 'openai-completions', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' },
  { id: 'google-generative-ai', label: 'Google Gemini' },
];
export function normalizeProtocol(api: string | null | undefined): A6Protocol {
  if (api === 'chat') return 'openai-completions';
  if (api === 'messages') return 'anthropic-messages';
  if (api === 'responses') return 'openai-responses';
  return A6_PROTOCOLS.some(item => item.id === api) ? api as A6Protocol : 'openai-completions';
}
/** Host-persisted sanitized failure: full message, stack, cause chain, upstream status/body. */
export interface CustomErrorDetail { name?: string; message?: string; stack?: string; status?: number; requestId?: string; body?: string; causes?: {name?: string; message?: string; code?: string; stack?: string}[] }
export interface RelayRef { siteId: string; channelId: number; model: string; api: RelayApi; listingId?: number; supplierId?: number }
export type AttemptStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'failed' | 'interrupted';
export interface AttemptSummary { id: string; recordId: string; number: number; status: AttemptStatus; createdAt: number; startedAt: number | null; finishedAt: number | null; error: string | null; summary: {total: number; ended: number; completed: number; failed: number} | null }
export interface RecordModelRef { provider: string; id: string; name?: string; relay?: RelayRef; a6api?: A6Channel }
export interface StoredRecord { id: string; name: string; kind: TestKind; createdAt: number; models: RecordModelRef[]; options: FingerprintOptions; prompt: string; footerVersion: string; preset: Preset | null; attempts: AttemptSummary[]; a6api?: A6Record }
export type RecordsListView = {revision: number; records: StoredRecord[]} | {revision: number; unchanged: true};
export type CustomBillingState = 'pending' | 'partial' | 'observed' | 'settled' | 'ambiguous' | 'unknown';
export interface CustomRunSummary {
 id: string;
 target: {kind: 'dsh' | 'a6api'; providerId?: string; modelId: string; displayName: string; channelId?: number; supplierId?: number; listingId?: number; marketSnapshot?: A6MarketSnapshot | null};
 phase: CustomRunPhase;
 sessionId: string | null;
 sandboxState: 'preparing' | 'ready' | 'failed' | 'cleaning' | 'unknown';
 eventCount: number;
 startedAt: number | null;
 updatedAt: number | null;
 finishedAt: number | null;
 output: {state: 'none' | 'writing' | 'ready' | 'invalid'; relativePath: string | null; size: number | null; modifiedAt: number | null; validation: 'pending' | 'valid' | 'invalid' | 'unknown'; format?: string; errors?: string[]; checkedAt?: number};
 usage: {requestCount: number | null; inputTokens: number | null; inputTotalTokens?: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; cost: number | null; currency: string | null; billingState: CustomBillingState};
 metrics: {ttftMs: number | null; generationMs: number | null; e2eMs: number | null; modelTokensPerSecond: number | null; endToEndTokensPerSecond: number | null; cacheRate: number | null};
 error: {code: string | null; message: string; phase: string; detail?: CustomErrorDetail | null} | null;
 resumeError?: CustomRunSummary['error'];
 canContinue?: boolean;
 cleanupPending?: boolean;
 continuations?: number;
}
export interface CustomEvent {
 id: string;
 type: 'message' | 'reasoning' | 'tool' | 'phase' | 'error';
 role?: string;
 text?: string;
 name?: string;
 status?: string;
 at: number;
 phase?: string | null;
 code?: string | null;
 callId?: string | null;
 executionId?: string | null;
 turn?: number | null;
 step?: number | null;
 index?: number | null;
 delta?: boolean;
 isError?: boolean;
 arguments?: string | null;
 content?: string | null;
 detail?: CustomErrorDetail | null;
}
export interface CustomRequestView {
 id: string;
 requestId: string | null;
 executionId?: string | null;
 status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
 streamUsage?: Record<string, unknown>;
 streamUsageFrames?: unknown[];
 startedAt: number | null;
 finishedAt: number | null;
 usage: {inputTokens: number | null; inputTotalTokens?: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; cost: number | null; currency: string | null};
 metrics: {ttftMs: number | null; generationMs: number | null; e2eMs: number | null; modelTokensPerSecond: number | null; endToEndTokensPerSecond: number | null; cacheRate: number | null};
 billingState: CustomBillingState;
 httpStatus?: number | null;
 /** Agent turn/step this request belongs to, when the Host observed one. */
 turn?: number | null;
 step?: number | null;
 /** Milliseconds from request start to the first streamed delta of any kind. */
 firstDeltaMs?: number | null;
 /** Host-observed timestamps in Unix milliseconds; absent on older requests. */
 timing?: {
  dispatchedAt?: number;
  firstTextAt?: number;
  firstOutputAt?: number;
  streamEndedAt?: number;
  cancelledAt?: number;
  toolsClosed?: true;
  tools: {startedAt: number; endedAt: number | null}[];
 };
 /** What prompted this step: a user message or the previous tool result. */
 trigger?: string | null;
 error?: string | {code?: string; message?: string; status?: number; detail?: CustomErrorDetail | null} | null;
}
export interface CustomFileView { path: string; size: number; modifiedAt: number }
export interface CustomRunDetail {
 run: CustomRunSummary;
 events: CustomEvent[];
 requests: CustomRequestView[];
 files: CustomFileView[];
 permissions: {allowed: string[]; denied: string[]};
 revision: number;
 metricBoundary?: string;
 eventsTruncated?: boolean;
 requestsTruncated?: boolean;
 unchanged?: true;
}
export type CustomRunDetailResult = CustomRunDetail | {runId: string; revision: number; unchanged: true};
export interface CustomFileReadResult { path: string; text: string; previewable: boolean }
export interface CustomOutputOpenResult { html?: string; path?: string; opened?: boolean; application?: {id: string; name: string} | null; applications?: {id: string; name: string}[] }
export type CustomDetailTab = 'chat' | 'steps' | 'files' | 'metrics' | 'billing' | 'permissions';
export interface CustomRunDetailEntry {
 loading: boolean;
 revision: number;
 detail?: CustomRunDetail;
 error?: string;
 file?: CustomFileReadResult;
 fileLoading?: boolean;
 previewOpen?: boolean;
 previewPath?: string;
 previewLoading?: boolean;
 action?: 'continue' | 'cancel';
 actionError?: string;
 cancelRequested?: boolean;
 tab: CustomDetailTab;
}
export interface CustomDraftState {
 sourceSelectionId?: string;
 sourceRecordId?: string;
 a6Models: A6Channel[];
 /** Per-channel wire protocol, keyed by `${channelId}:${model}`; missing = inferred default. */
 protocols: Record<string, A6Protocol>;
 a6Tokens: A6Token[];
 /** Derived at submit time: effective concurrency = min(allocated test tokens or targets, 6). */
 timeoutMs: number;
 creating: boolean;
 step: 1 | 2 | 3 | 4;
 tokens: number[];
 error?: string;
}
export interface CustomPreviewState { open: boolean; loading: boolean; html: string | null; path: string | null; label: string | null; error?: string }
export interface CustomState { draft: CustomDraftState; details: Record<string, CustomRunDetailEntry>; selectionRecordId?: string; selectedRunIds: string[]; preview: CustomPreviewState }
export type AttemptViewResult = (AttemptSummary & {view: FingerprintJobView | null; custom: {runs: CustomRunSummary[]; billingPending?: boolean} | null; billingPending?: boolean; revision: number}) | {id: string; unchanged: true; revision: number};
export interface ModelIntelligenceTransport extends CatalogTransport {
 recordsList(request: {revision?: number}): Promise<RecordsListView>;
 recordCreate(request: {kind: TestKind; name: string; models: RecordModelRef[]; options?: FingerprintOptions; prompt?: string; footerVersion?: string; preset?: Preset | null}): Promise<{record: StoredRecord; attemptId: string | null}>;
 recordRerun(request: {recordId: string}): Promise<{attemptId: string}>;
 recordRename(request: {recordId: string; name: string}): Promise<StoredRecord>;
 recordDelete(request: {recordId: string}): Promise<{ok: true}>;
 recordsClear(): Promise<{ok: true}>;
 attemptView(request: {attemptId: string; revision?: number}): Promise<AttemptViewResult>;
 attemptCancel(request: {attemptId: string}): Promise<AttemptViewResult>;
 attemptConfigure(request: {attemptId: string} & FingerprintOptions): Promise<AttemptViewResult>;
 attemptRetry(request: {attemptId: string; model: {provider: string; id: string}}): Promise<AttemptViewResult>;
 customRunDetail(request: {attemptId: string; runId: string; revision?: number}): Promise<CustomRunDetailResult>;
 customFileRead(request: {attemptId: string; runId: string; path: string}): Promise<CustomFileReadResult>;
 customOutputOpen(request: {attemptId: string; runId: string; mode?: 'preview' | 'vscode' | 'reveal' | 'browser'; application?: string}): Promise<CustomOutputOpenResult>;
 customRunContinue(request: {attemptId: string; runId: string}): Promise<CustomRunSummary>;
 customRunCancel(request: {attemptId: string; runId: string}): Promise<CustomRunSummary>;
 a6CustomFromRecord(request: {recordId: string; name: string; models: CustomA6ModelRef[]; slots?: A6Slot[]; dshModels?: RecordModelRef[]; prompt: string; footerVersion?: string; preset?: Preset | null; concurrency?: number; timeoutMs?: number}): Promise<{record: StoredRecord; attemptId: string}>;
 a6Config(): Promise<A6Config>;
 a6ConfigSave(request: {accessToken?: string; userId?: string}): Promise<A6Config & {ok: true; account: {id: number; name: string}; pins: number}>;
 a6IntakeRotate(): Promise<A6Config>;
 a6Tokens(): Promise<{tokens: A6Token[]}>;
 a6Selections(request: {revision?: number}): Promise<A6SelectionsView>;
 a6Create(request: A6CreateInput): Promise<{record: StoredRecord; attemptId: string}>;
 a6OperationState(request: {refreshTokens?: boolean; refreshRelations?: boolean}): Promise<A6OperationView>;
 a6OperationSelect(request: {tokenId: number | null}): Promise<A6OperationView>;
 a6OperationRefresh(request: {kind: A6RelationKind}): Promise<A6OperationView>;
 a6ResultAction(request: A6ResultActionInput): Promise<A6ResultActionOutcome>;
 a6LedgerView(request: {attemptId?: string; recordId?: string; refresh?: boolean}): Promise<A6LedgerView>;
}
export interface Preset { id: string; name: string; body: string }
export interface Metrics { input?: number; output?: number; cache?: number; ttft?: number; e2e?: number; generation?: number; cost?: number; elapsed?: number }
export interface Step { id: string; title: string; state: Stage; metrics: Metrics }
export interface Round { id: string; number: number; state: Stage; steps: Step[]; metrics: Metrics }
export interface Candidate { name: string; score: number; calibrated?: boolean; family?: string }
export interface Run { id: string; testId: string; sessionId: string | null; model: Model; stage: Stage; output: string; metrics: Metrics; candidates: Candidate[]; rounds: Round[]; currentRound: number; routing?: A6Routing | null; callProvider?: string | null; slotTokenId?: number | null; error?: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null}; artifact?: {type: 'svg' | 'html'; source: string; name: string}; fingerprint?: {samples: FingerprintSample[]; analysis: FingerprintAnalysis | null}; custom?: CustomRunSummary }
export interface Evaluation { id: string; name: string; kind: TestKind; createdAt: number; runIds: string[]; prompt: string; footerVersion: string; preset?: Preset; fingerprint?: FingerprintRecord;
 /** Host-persisted attempts (请求) of this record, oldest first; `attemptId` is the attempt currently shown. */
 attempts: AttemptSummary[]; attemptId?: string; models: RecordModelRef[]; options: FingerprintOptions; a6api?: A6Record; custom?: {busy?: 'configure' | 'retry'; error?: string} }
export interface FingerprintRecord { jobId?: string; status: 'starting' | 'running' | 'done' | 'cancelled' | 'failed'; reference?: {builtAt: string; sdk: string}; challenges: FingerprintChallenge[]; concurrency?: number; timeoutMs?: number; slots?: number; limits?: FingerprintLimits; busy?: 'configure' | 'retry'; error?: string }
export interface Tab { id: string; title: string; type: 'draft' | 'record' | 'feature' | 'a6'; recordId?: string; feature?: 'hub'; selectionId?: string }
export interface Navigation { mode: 'progress' | 'results'; runId?: string; artifact?: boolean }
export interface WorkbenchState { tabs: Tab[]; activeTab: string; sidebarCollapsed: boolean; navigation: Record<string, Navigation>; /** Rendered inside the dedicated full-screen window. */ fullscreen: boolean }
export interface DraftState { name: string; kind: TestKind; selected: string[]; body: string; presetId?: string; dirty: boolean; pickerOpen: boolean; query: string; error?: string }
export interface ModelsState { items: Model[]; providers: Provider[]; loading: boolean; error?: string }
export interface PresetsState { items: Preset[]; error?: string; collapsed: boolean }
export interface EvaluationsState { records: Evaluation[]; runs: Record<string, Run>; /** First Host list arrived. */ loaded: boolean; /** Host sync / action error banner. */ error?: string }
export type SortDirection = 'asc'|'desc';
export interface ColumnSort { column: string; direction: SortDirection }
export interface PresentationState { columns: string[]; widths: Record<string, number>; expanded: Record<string, boolean>; followLatest: boolean; columnsOpen: boolean; viewOpen: boolean; configOpen: boolean; filter: string; /** Per-record column sort chosen by the user; missing = default match order. */ sorts: Record<string, ColumnSort> }
export interface Notice { title: string; message: string; choices: {id: string; label: string; danger?: boolean}[]; input?: string }
export interface Store<T> { getState(): T; subscribe(listener: () => void): () => void }
export interface Workbench {
 sessionId: string;
 workbench: Store<WorkbenchState>; draft: Store<DraftState>; models: Store<ModelsState>; presets: Store<PresetsState>; evaluations: Store<EvaluationsState>; presentation: Store<PresentationState>; a6: Store<A6State>; notice: Store<Notice | null>;
 a6Insights: Store<A6InsightsState>; custom: Store<CustomState>;
 actions: {
  openDraft(): void; openRecord(id: string): void; openFeature(feature: 'hub'): void; activateTab(id: string): void; closeTab(id: string): void; toggleSidebar(): void; navigate(value: Partial<Navigation>): void; openFullscreen(): void; closeFullscreen(): void;
  patchDraft(value: Partial<Pick<DraftState, 'name' | 'kind' | 'body' | 'pickerOpen' | 'query'>>): void; toggleModel(key: string): void; refreshModels(): void; submit(): void;
  selectPreset(id: string): void; addPreset(): void; renamePreset(id: string): void; deletePreset(id: string): void; savePreset(): void; togglePresets(): void;
  cancelRecord(id: string): void; renameRecord(id: string): void; deleteRecord(id: string): void; resetRecords(): void; rerunRecord(id: string): void; selectAttempt(recordId: string, attemptId: string): void;
  beginCustomFromFingerprint(recordId: string, runId?: string | string[]): void; startCustomSelection(recordId: string): void; toggleCustomRunSelection(recordId: string, runId: string): void; cancelCustomSelection(): void; createCustomFromSelection(recordId: string): void;
  patchCustom(value: Partial<Pick<CustomDraftState, 'timeoutMs' | 'step'>>): void; removeCustomA6Model(key: string): void; setCustomProtocol(key: string | null, api: A6Protocol): void; toggleCustomToken(id: number): void; resetCustomSource(): void;
  setCustomDetailTab(runId: string, tab: CustomDetailTab): void; readCustomFile(runId: string, path: string): void; openCustomOutput(runId: string, mode: 'preview' | 'vscode' | 'reveal' | 'browser', application?: string): Promise<CustomOutputOpenResult>; dismissPreview(): void; continueCustomRun(runId: string): void; cancelCustomRun(runId: string): void;
  openA6(selectionId: string): void; patchA6(selectionId: string, value: Partial<Pick<A6Draft, 'name' | 'timeoutMs'>>): void;
  removeA6Model(selectionId: string, key: string): void; toggleA6Token(selectionId: string, tokenId: number): void;
  submitA6(selectionId: string): void;
  loadA6Config(): void; patchA6Form(value: Partial<{accessToken: string; userId: string}>): void; saveA6Config(): void; rotateA6Intake(): void; copyA6Intake(): void;
  loadA6Operations(): void; setA6OperationQuery(query: string): void; selectA6OperationToken(tokenId: number | null): void; refreshA6OperationTokens(): void; refreshA6Relations(kind: A6RelationKind): void;
  a6ResultAction(input: A6ResultActionInput): void;
  setA6LedgerScope(recordId: string, scope: 'attempt'|'record'): void; refreshA6Ledger(recordId: string): void;
  setFingerprintConfig(id: string, options: FingerprintOptions): void;
  retryFailedSample(id: string, runId: string): void;
  toggleSort(recordId: string, column: string): void; toggleColumn(id: string): void; resizeColumn(id: string, width: number): void; toggleColumns(): void; toggleView(): void; toggleConfig(): void; toggleRound(id: string, defaultExpanded: boolean): void; toggleFollow(): void; setFilter(value: string): void;
  answerNotice(choice: string): void; setNoticeInput(value: string): void;
 };
 dispose(): void;
}
export const FIXED_FOOTER_VERSION = 'delivery-v3';
export const FIXED_FOOTER = '\n\n【最终交付约束 · delivery-v3】\n先读取沙箱规则与任务输入，仅使用允许的沙箱文件工具完成任务。将最终成果写入 output/ 并使用 declareOutput 声明一个有效输出文件，只有通过验证的声明成果才可打开。不访问网络、工作区、凭据，不启动服务。提供清晰的结果说明。';
export const STAGE_LABELS: Record<Stage, string> = {queued:'排队中', 'waiting-first-token':'等待首 Token', streaming:'生成中', finalizing:'收尾中', analyzing:'分析中', completed:'已完成', failed:'失败', timeout:'超时', cancelled:'已取消', preparing:'准备沙箱', running:'运行中', tooling:'工具调用', validating:'验证输出', interrupted:'已中断'};
export const COLUMN_LABELS: Record<string,string> = {stage:'状态', input:'输入 Token', output:'输出 Token', ttft:'TTFT', e2e:'端到端 tok/s', generation:'生成 tok/s', cost:'费用', price:'渠道报价（CNY）', cache24h:'渠道 24h 缓存率', target:'渠道操作', match:'最高匹配', round:'当前轮次'};
