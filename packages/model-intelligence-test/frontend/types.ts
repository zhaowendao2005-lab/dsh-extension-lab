export type TestKind = 'fingerprint' | 'custom';
export type Stage = 'queued' | 'waiting-first-token' | 'streaming' | 'finalizing' | 'analyzing' | 'completed' | 'failed' | 'timeout' | 'cancelled';
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

export interface A6Channel { listingId: number; channelId: number; supplierId: number; model: string; supplierName?: string; channelName?: string; brand?: string }
export interface A6Token { id: number; name: string }
export interface A6Slot { tokenId: number; name?: string }
export interface A6Selection { id: string; accountId: string; siteOrigin: string; createdAt: number; models: A6Channel[]; tokens: A6Token[] }
/** Credential state as the panel sees it: the access token itself never leaves Host storage. */
export interface A6Config { configured: boolean; mask: string; userId: string; intakeToken: string; origin: string; link?: string }
export type A6SelectionsView = {revision: number; selections: A6Selection[]} | {revision: number; unchanged: true};
export interface A6CreateInput { selectionId: string; name: string; slots: A6Slot[]; timeoutMs?: number; models?: A6Channel[] }
export type A6Operation = 'pin' | 'restore';
export interface A6ActionInput { selectionId: string; tokenId: number; model: string; channelId: number; operation: A6Operation }
export interface A6Record { accountId: string; siteOrigin: string; selectionId: string; slots: A6Slot[] }
export interface A6Draft { name: string; models: A6Channel[]; tokens: number[]; timeoutMs?: number; creating: boolean; error?: string; feedback?: string; targetTokenId?: number; targetChannel?: string; pending?: A6Operation; result?: string }
export interface A6State { selections: A6Selection[]; drafts: Record<string, A6Draft>; loaded: boolean; error?: string; config: A6Config | null; configLoading: boolean; configError?: string; configFeedback?: string; form: {accessToken: string; userId: string}; saving: boolean; rotating: boolean; copying: boolean }
export type RelayApi = 'chat' | 'responses' | 'messages';
export interface RelayRef { siteId: string; channelId: number; model: string; api: RelayApi; listingId?: number; supplierId?: number }
export type AttemptStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'failed' | 'interrupted';
export interface AttemptSummary { id: string; recordId: string; number: number; status: AttemptStatus; createdAt: number; startedAt: number | null; finishedAt: number | null; error: string | null; summary: {total: number; ended: number; completed: number; failed: number} | null }
export interface RecordModelRef { provider: string; id: string; name?: string; relay?: RelayRef; a6api?: A6Channel }
export interface StoredRecord { id: string; name: string; kind: TestKind; createdAt: number; models: RecordModelRef[]; options: FingerprintOptions; prompt: string; footerVersion: string; preset: Preset | null; attempts: AttemptSummary[]; a6api?: A6Record }
export type RecordsListView = {revision: number; records: StoredRecord[]} | {revision: number; unchanged: true};
export type AttemptViewResult = (AttemptSummary & {view: FingerprintJobView | null; custom: {runs: unknown[]} | null; revision: number}) | {id: string; unchanged: true; revision: number};
export interface ModelIntelligenceTransport extends CatalogTransport {
 recordsList(request: {revision?: number}): Promise<RecordsListView>;
 recordCreate(request: {kind: TestKind; name: string; models: RecordModelRef[]; options?: FingerprintOptions; prompt?: string; footerVersion?: string; preset?: Preset | null}): Promise<{record: StoredRecord; attemptId: string | null}>;
 recordRerun(request: {recordId: string}): Promise<{attemptId: string}>;
 recordDelete(request: {recordId: string}): Promise<{ok: true}>;
 recordsClear(): Promise<{ok: true}>;
 attemptView(request: {attemptId: string; revision?: number}): Promise<AttemptViewResult>;
 attemptCancel(request: {attemptId: string}): Promise<AttemptViewResult>;
 attemptConfigure(request: {attemptId: string} & FingerprintOptions): Promise<AttemptViewResult>;
 attemptRetry(request: {attemptId: string; model: {provider: string; id: string}}): Promise<AttemptViewResult>;
 customSave(request: {recordId: string; snapshot: {ended: boolean; runs: unknown[]}}): Promise<{attemptId: string}>;
 a6Config(): Promise<A6Config>;
 a6ConfigSave(request: {accessToken?: string; userId?: string}): Promise<A6Config & {ok: true; account: {id: number; name: string}; pins: number}>;
 a6IntakeRotate(): Promise<A6Config>;
 a6Tokens(): Promise<{tokens: A6Token[]}>;
 a6Selections(request: {revision?: number}): Promise<A6SelectionsView>;
 a6Create(request: A6CreateInput): Promise<{record: StoredRecord; attemptId: string}>;
 a6Action(request: A6ActionInput): Promise<{ok: true; result?: object}>;
}
export interface Preset { id: string; name: string; body: string }
export interface Metrics { input?: number; output?: number; cache?: number; ttft?: number; e2e?: number; generation?: number; cost?: number; elapsed?: number }
export interface Step { id: string; title: string; state: Stage; metrics: Metrics }
export interface Round { id: string; number: number; state: Stage; steps: Step[]; metrics: Metrics }
export interface Candidate { name: string; score: number; calibrated?: boolean; family?: string }
export interface Run { id: string; testId: string; sessionId: string; model: Model; stage: Stage; output: string; metrics: Metrics; candidates: Candidate[]; rounds: Round[]; currentRound: number; routing?: A6Routing | null; callProvider?: string | null; slotTokenId?: number | null; error?: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null}; artifact?: {type: 'svg' | 'html'; source: string; name: string}; fingerprint?: {samples: FingerprintSample[]; analysis: FingerprintAnalysis | null} }
export interface Evaluation { id: string; name: string; kind: TestKind; createdAt: number; runIds: string[]; prompt: string; footerVersion: string; preset?: Preset; fingerprint?: FingerprintRecord;
 /** Host-persisted attempts (请求) of this record, oldest first; `attemptId` is the attempt currently shown. */
 attempts: AttemptSummary[]; attemptId?: string; models: RecordModelRef[]; options: FingerprintOptions; a6api?: A6Record }
export interface FingerprintRecord { jobId?: string; status: 'starting' | 'running' | 'done' | 'cancelled' | 'failed'; reference?: {builtAt: string; sdk: string}; challenges: FingerprintChallenge[]; concurrency?: number; timeoutMs?: number; slots?: number; limits?: FingerprintLimits; busy?: 'configure' | 'retry'; error?: string }
export interface Tab { id: string; title: string; type: 'draft' | 'record' | 'feature' | 'a6'; recordId?: string; feature?: 'hub'; selectionId?: string }
export interface Navigation { mode: 'progress' | 'results'; runId?: string; artifact?: boolean }
export interface WorkbenchState { tabs: Tab[]; activeTab: string; sidebarCollapsed: boolean; navigation: Record<string, Navigation> }
export interface DraftState { name: string; kind: TestKind; selected: string[]; body: string; presetId?: string; dirty: boolean; pickerOpen: boolean; query: string; error?: string }
export interface ModelsState { items: Model[]; providers: Provider[]; loading: boolean; error?: string }
export interface PresetsState { items: Preset[]; error?: string; collapsed: boolean }
export interface EvaluationsState { records: Evaluation[]; runs: Record<string, Run>; /** First Host list arrived. */ loaded: boolean; /** Host sync / action error banner. */ error?: string }
export interface PresentationState { columns: string[]; widths: Record<string, number>; expanded: Record<string, boolean>; followLatest: boolean; columnsOpen: boolean; viewOpen: boolean; configOpen: boolean; filter: string }
export interface Notice { title: string; message: string; choices: {id: string; label: string; danger?: boolean}[]; input?: string }
export interface Store<T> { getState(): T; subscribe(listener: () => void): () => void }
export interface Workbench {
 sessionId: string;
 workbench: Store<WorkbenchState>; draft: Store<DraftState>; models: Store<ModelsState>; presets: Store<PresetsState>; evaluations: Store<EvaluationsState>; presentation: Store<PresentationState>; a6: Store<A6State>; notice: Store<Notice | null>;
 actions: {
  openDraft(): void; openRecord(id: string): void; openFeature(feature: 'hub'): void; activateTab(id: string): void; closeTab(id: string): void; toggleSidebar(): void; navigate(value: Partial<Navigation>): void;
  patchDraft(value: Partial<Pick<DraftState, 'name' | 'kind' | 'body' | 'pickerOpen' | 'query'>>): void; toggleModel(key: string): void; refreshModels(): void; submit(): void;
  selectPreset(id: string): void; addPreset(): void; renamePreset(id: string): void; deletePreset(id: string): void; savePreset(): void; togglePresets(): void;
  cancelRecord(id: string): void; deleteRecord(id: string): void; resetMocks(): void; rerunRecord(id: string): void; selectAttempt(recordId: string, attemptId: string): void;
  openA6(selectionId: string): void; patchA6(selectionId: string, value: Partial<Pick<A6Draft, 'name' | 'timeoutMs' | 'targetTokenId' | 'targetChannel'>>): void;
  removeA6Model(selectionId: string, key: string): void; toggleA6Token(selectionId: string, tokenId: number): void;
  submitA6(selectionId: string): void; a6Action(selectionId: string, operation: A6Operation): void;
  loadA6Config(): void; patchA6Form(value: Partial<{accessToken: string; userId: string}>): void; saveA6Config(): void; rotateA6Intake(): void; copyA6Intake(): void;
  setFingerprintConfig(id: string, options: FingerprintOptions): void;
  retryFailedSample(id: string, runId: string): void;
  toggleColumn(id: string): void; resizeColumn(id: string, width: number): void; toggleColumns(): void; toggleView(): void; toggleConfig(): void; toggleRound(id: string, defaultExpanded: boolean): void; toggleFollow(): void; setFilter(value: string): void;
  answerNotice(choice: string): void; setNoticeInput(value: string): void;
 };
 dispose(): void;
}
export const FIXED_FOOTER_VERSION = 'delivery-v1';
export const FIXED_FOOTER = '\n\n【最终交付约束 · delivery-v1】\n优先完成任务本身，由 Agent 根据任务选择合适的成果类型，无需过度包装。若交付绘图，只使用 Canvas + HTML 或 SVG。当前阶段不启动服务、不配置启动命令或端口。提供清晰的结果说明与可检查的成果。';
export const STAGE_LABELS: Record<Stage, string> = {queued:'排队中', 'waiting-first-token':'等待首 Token', streaming:'生成中', finalizing:'收尾中', analyzing:'分析中', completed:'已完成', failed:'失败', timeout:'超时', cancelled:'已取消'};
export const COLUMN_LABELS: Record<string,string> = {stage:'状态', input:'输入 Token', output:'输出 Token', ttft:'TTFT', e2e:'端到端 tok/s', generation:'生成 tok/s', cost:'费用（模拟）', match:'最高匹配', round:'当前轮次'};
