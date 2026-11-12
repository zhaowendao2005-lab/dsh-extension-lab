export type TestKind = 'fingerprint' | 'custom';
export type Stage = 'queued' | 'waiting-first-token' | 'streaming' | 'finalizing' | 'analyzing' | 'completed' | 'failed' | 'timeout' | 'cancelled';
export interface Model { key: string; provider: string; providerName: string; id: string; name: string; search: string }
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
export interface FingerprintRunView { provider: string; model: string; stage: Stage; error: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null} | null; analysis: FingerprintAnalysis | null; samples: FingerprintSample[] }
export interface FingerprintLimits { maxConcurrency: number; maxConcurrentRequests: number; requestsPerModel: number; defaultConcurrency: number; defaultTimeoutMs: number; minTimeoutMs: number; maxTimeoutMs: number }
export interface FingerprintJobView { id: string; revision: number; status: 'running' | 'done' | 'cancelled'; createdAt: number; finishedAt: number | null; concurrency: number; timeoutMs: number; limits: FingerprintLimits; reference: {builtAt: string; source: string; sdk: string}; challenges: FingerprintChallenge[]; runs: FingerprintRunView[] }
export type FingerprintStatusView = FingerprintJobView | {id: string; revision: number; unchanged: true};
export interface FingerprintOptions { concurrency?: number; timeoutMs?: number }
export interface ModelIntelligenceTransport extends CatalogTransport {
 fingerprintStart(request: {models: {provider: string; id: string}[]} & FingerprintOptions): Promise<FingerprintJobView>;
 fingerprintConfigure(request: {jobId: string} & FingerprintOptions): Promise<FingerprintJobView>;
 fingerprintRetry(request: {jobId: string; model: {provider: string; id: string}}): Promise<FingerprintJobView>;
 fingerprintStatus(request: {jobId: string; revision?: number}): Promise<FingerprintStatusView>;
 fingerprintCancel(request: {jobId: string}): Promise<FingerprintJobView>;
}
export interface Preset { id: string; name: string; body: string }
export interface Metrics { input?: number; output?: number; cache?: number; ttft?: number; e2e?: number; generation?: number; cost?: number; elapsed?: number }
export interface Step { id: string; title: string; state: Stage; metrics: Metrics }
export interface Round { id: string; number: number; state: Stage; steps: Step[]; metrics: Metrics }
export interface Candidate { name: string; score: number; calibrated?: boolean; family?: string }
export interface Run { id: string; testId: string; sessionId: string; model: Model; stage: Stage; output: string; metrics: Metrics; candidates: Candidate[]; rounds: Round[]; currentRound: number; error?: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null}; artifact?: {type: 'svg' | 'html'; source: string; name: string}; fingerprint?: {samples: FingerprintSample[]; analysis: FingerprintAnalysis | null} }
export interface Evaluation { id: string; name: string; kind: TestKind; createdAt: number; runIds: string[]; prompt: string; footerVersion: string; preset?: Preset; fingerprint?: FingerprintRecord }
export interface FingerprintRecord { jobId?: string; status: 'starting' | 'running' | 'done' | 'cancelled' | 'failed'; reference?: {builtAt: string; sdk: string}; challenges: FingerprintChallenge[]; concurrency?: number; timeoutMs?: number; limits?: FingerprintLimits; busy?: 'configure' | 'retry'; error?: string }
export interface Tab { id: string; title: string; type: 'draft' | 'record'; recordId?: string }
export interface Navigation { mode: 'progress' | 'results'; runId?: string; artifact?: boolean }
export interface WorkbenchState { tabs: Tab[]; activeTab: string; sidebarCollapsed: boolean; navigation: Record<string, Navigation> }
export interface DraftState { name: string; kind: TestKind; selected: string[]; body: string; presetId?: string; dirty: boolean; pickerOpen: boolean; query: string; error?: string }
export interface ModelsState { items: Model[]; providers: Provider[]; loading: boolean; error?: string }
export interface PresetsState { items: Preset[]; error?: string; collapsed: boolean }
export interface EvaluationsState { records: Evaluation[]; runs: Record<string, Run> }
export interface PresentationState { columns: string[]; widths: Record<string, number>; expanded: Record<string, boolean>; followLatest: boolean; columnsOpen: boolean; viewOpen: boolean; configOpen: boolean; filter: string }
export interface Notice { title: string; message: string; choices: {id: string; label: string; danger?: boolean}[]; input?: string }
export interface Store<T> { getState(): T; subscribe(listener: () => void): () => void }
export interface Workbench {
 sessionId: string;
 workbench: Store<WorkbenchState>; draft: Store<DraftState>; models: Store<ModelsState>; presets: Store<PresetsState>; evaluations: Store<EvaluationsState>; presentation: Store<PresentationState>; notice: Store<Notice | null>;
 actions: {
  openDraft(): void; openRecord(id: string): void; activateTab(id: string): void; closeTab(id: string): void; toggleSidebar(): void; navigate(value: Partial<Navigation>): void;
  patchDraft(value: Partial<Pick<DraftState, 'name' | 'kind' | 'body' | 'pickerOpen' | 'query'>>): void; toggleModel(key: string): void; refreshModels(): void; submit(): void;
  selectPreset(id: string): void; addPreset(): void; renamePreset(id: string): void; deletePreset(id: string): void; savePreset(): void; togglePresets(): void;
  cancelRecord(id: string): void; deleteRecord(id: string): void; resetMocks(): void;
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
