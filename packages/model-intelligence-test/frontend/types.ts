export type TestKind = 'fingerprint' | 'custom';
export type Stage = 'queued' | 'waiting-first-token' | 'streaming' | 'finalizing' | 'analyzing' | 'completed' | 'failed' | 'timeout' | 'cancelled';
export interface Model { key: string; provider: string; providerName: string; id: string; name: string; search: string; relay?: RelayRef }
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
export interface RelaySite { id: string; name: string; label: string; webUrl: string; docsUrl: string; anonymous: boolean; note: string }
export interface RelaySort { id: string; label: string }
export type RelayState = 'idle' | 'building' | 'ready' | 'error';
export interface RelayMissingPage { page: number; status: number; code: string; message: string }
export interface RelayStatus { state: RelayState; progress: number; pages: number; total: number; fetchedAt: number | null; stale: boolean; error: string | null; partial?: boolean; missingPages?: number; missing?: RelayMissingPage[]; exchangeRate?: number }
export type Currency = 'usd' | 'cny';
/** Presence + price of a channel/model pair looked up in the relay snapshot; found:null = snapshot cannot answer yet. */
export interface RelayResolved { channelId: number; model: string; found: boolean | null; rowKey: string | null; inputPrice: number | null; outputPrice: number | null; perRequestPrice: number | null; chargeType: string }
export type TagMap = Record<string, string[]>
export interface TagsState { map: TagMap; loaded: boolean; error?: string; /** Target whose tag menu is open. */ menu: string | null; query: string; category: string }
export interface RelayBrand { id: string; name: string; count: number }
export interface RelayModelFacet { brand: string; name: string; count: number }
export interface RelayRow { rowKey: string; listingId: number; channelId: number; supplierId: number; supplierName: string; channelName: string; modelName: string; brand: string; inputPrice: number | null; outputPrice: number | null; cacheReadPrice: number | null; cacheWritePrice: number | null; officialInputPrice: number | null; officialOutputPrice: number | null; successRate: number | null; success24h: number | null; success7d: number | null; success7dState: string; ttftMs: number | null; recentP50Ms: number | null; throughput: number | null; cacheHitRate: number | null; guaranteed: boolean; labels: string[]; testEndpoint: string; modelDetection: boolean; listingAvailability: number; lastSuccessAt: number | null; lastSampleAt: number | null; priceDirection: string; realtimeRatio: number | null; description: string; guaranteeBadge: string; officialDirect: boolean; success24hState: string; sampleCount: number | null; buckets: (number | null)[]; lastFailureAt: number | null; lastFailureCode: string; routeStatus: string; chargeType: string; perRequestPrice: number | null }
export interface RelaySnapshotView { site: RelaySite; status: RelayStatus; brands: RelayBrand[]; models: RelayModelFacet[]; sorts: RelaySort[] }
export interface RelayRowsView { status: RelayStatus; rows: RelayRow[]; total: number; offset: number }
export type RelayFidelity = 'all' | 'guaranteed' | 'direct';
export interface RelayFilter { brands: string[]; models: string[]; fidelity: RelayFidelity; sort: string }
export interface RelayBucket { at: number | null; requests: number; rate: number | null; latencyMs: number | null; firstMs: number | null; cacheRate: number | null }
export interface RelayHistory { rowKey: string; success24h: number | null; success7d: number | null; state24h: string; state7d: string; hours: RelayBucket[]; days: RelayBucket[]; lastSuccessAt: number | null; lastFailureAt: number | null; lastFailureCode: string; recent: {samples: number; success: number; rate: number | null}[]; fetchedAt: number }
export interface RelayConcurrency { rowKey: string; active: number | null; limit: number | null; limitState: string; quality: string; sampledAt: number }
export interface RelaySvg { rowKey: string; svg: string | null; createdAt: number | string | null }
export type RelayApi = 'chat' | 'responses' | 'messages';
export interface RelayRef { siteId: string; channelId: number; model: string; api: RelayApi }
export interface PartitionItem { key: string; partitionId: string; tags: string[]; siteId: string; channelId: number; model: string; brand: string; supplier: string; channelName: string; testEndpoint: string; api: RelayApi | null; addedAt: number }
export interface Partition { id: string; name: string; createdAt: number; builtin: boolean; items: PartitionItem[] }
export interface PartitionsView { revision: number; partitions: Partition[] }
export interface PartitionItemInput { partitionId?: string; remove?: boolean; tags?: string[]; api?: RelayApi; item: {key: string; siteId: string; channelId: number; model: string; brand: string; supplier: string; channelName: string; testEndpoint: string} }
export interface CredentialState { configured: boolean; source: string | null; writable: boolean }
export interface ManagedModel { id: string; name: string | null; channelId?: number; image?: boolean; reasoning?: boolean; contextWindow?: number }
export interface ManagedRoute { id: string; format: RelayApi; api: string; label: string; present: boolean; models: ManagedModel[]; source: 'config' | 'registry' }
/** Result of adding a relay model as a DSH provider: `applied:false` means the runtime owns the config and the snippet has to be pasted by hand. */
export interface ProviderWriteResult { providers: ManagedRoute[]; applied: boolean; reason?: string; snippet: string; cleared?: number }
export interface RelayAuthStatus { siteId: string; apiKey: CredentialState; accessToken: CredentialState; userId: {configured: boolean; value: string | null}; apiKeyRef: string; verified: {username: string | null; displayName: string | null; at: number} | null; providers: ManagedRoute[]; apis: RelayApi[] }
export interface RelayStoreState { sites: RelaySite[]; sorts: RelaySort[]; siteId: string; status: RelayStatus; brands: RelayBrand[]; models: RelayModelFacet[]; rows: RelayRow[]; total: number; loading: boolean; error?: string; filter: RelayFilter; columns: string[]; widths: Record<string, number>; columnsOpen: boolean; detail?: RelayRow; detailLoading: boolean; scrollTop: number; viewportHeight: number;
 /** Fuzzy multi-select menus (provider / model): which is open and its query text. */
 menu: {open: 'brand' | 'model' | null; brandQuery: string; modelQuery: string};
 history: Record<string, {loading: boolean; value?: RelayHistory; error?: string}>; concurrency: Record<string, {loading: boolean; value?: RelayConcurrency; error?: string}>; svg: Record<string, {loading: boolean; value?: RelaySvg; error?: string}>;
 partitions: Partition[]; partitionsError?: string; partitionMenu: string | null;
 /** Relay tab content: the channel list or the favorites page. */
 view: 'list' | 'favorites'; currency: Currency;
 /** Lookup of every channel/model referenced anywhere (results, partitions, picker), keyed `${channelId}|${model}`. */
 resolved: Record<string, RelayResolved>;
 /** 加入模型池 dialog: which partition item and which protocol. */
 pool: {partitionId: string; key: string; format: RelayApi} | null; retrying: boolean }
export type AttemptStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'failed' | 'interrupted';
export interface AttemptSummary { id: string; recordId: string; number: number; status: AttemptStatus; createdAt: number; startedAt: number | null; finishedAt: number | null; error: string | null; summary: {total: number; ended: number; completed: number; failed: number} | null }
export interface RecordModelRef { provider: string; id: string; name?: string; relay?: RelayRef }
export interface StoredRecord { id: string; name: string; kind: TestKind; createdAt: number; models: RecordModelRef[]; options: FingerprintOptions; prompt: string; footerVersion: string; preset: Preset | null; attempts: AttemptSummary[] }
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
 partitionsList(): Promise<PartitionsView>;
 partitionSave(request: {id?: string; name: string}): Promise<PartitionsView>;
 partitionDelete(request: {partitionId: string}): Promise<PartitionsView>;
 partitionItem(request: PartitionItemInput): Promise<PartitionsView>;
 relayAuthStatus(request: {siteId: string}): Promise<RelayAuthStatus>;
 relayAuthSet(request: {siteId: string; apiKey?: string | null; accessToken?: string | null; userId?: string | null}): Promise<RelayAuthStatus>;
 relayAuthVerify(request: {siteId: string}): Promise<RelayAuthStatus>;
 relayProviderModel(request: {siteId: string; format: RelayApi; model: string; name?: string; remove?: boolean; channelId?: number; image?: boolean; reasoning?: boolean; contextWindow?: number}): Promise<ProviderWriteResult>;
 relayProvidersClear(request: {siteId: string}): Promise<ProviderWriteResult>;
 relayManagedRoutes(): Promise<{routes: string[]}>;
 relaySites(): Promise<{sites: RelaySite[]; sorts: RelaySort[]}>;
 relaySnapshot(request: {siteId: string; force?: boolean}): Promise<RelaySnapshotView>;
 relayRows(request: {siteId: string; brands?: string[]; models?: string[]; fidelity?: RelayFidelity; sort?: string; offset: number; limit: number}): Promise<RelayRowsView>;
 relayRow(request: {siteId: string; rowKey: string}): Promise<{row: RelayRow; status: RelayStatus}>;
 relayHistory(request: {siteId: string; rowKey: string}): Promise<RelayHistory>;
 relayConcurrency(request: {siteId: string; rowKey: string}): Promise<RelayConcurrency>;
 relaySvg(request: {siteId: string; rowKey: string}): Promise<RelaySvg>;
 relayResolve(request: {siteId: string; refs: {channelId: number; model: string}[]}): Promise<{status: RelayStatus; items: RelayResolved[]}>;
 relayRetryMissing(request: {siteId: string}): Promise<{status: RelayStatus}>;
 tagsList(): Promise<{revision: number; tags: TagMap}>;
 tagsSet(request: {target: string; tags: string[]}): Promise<{revision: number; tags: TagMap}>;
}
export interface Preset { id: string; name: string; body: string }
export interface Metrics { input?: number; output?: number; cache?: number; ttft?: number; e2e?: number; generation?: number; cost?: number; elapsed?: number }
export interface Step { id: string; title: string; state: Stage; metrics: Metrics }
export interface Round { id: string; number: number; state: Stage; steps: Step[]; metrics: Metrics }
export interface Candidate { name: string; score: number; calibrated?: boolean; family?: string }
export interface Run { id: string; testId: string; sessionId: string; model: Model; stage: Stage; output: string; metrics: Metrics; candidates: Candidate[]; rounds: Round[]; currentRound: number; error?: {stage: Stage; message: string; detail?: FingerprintErrorDetail | null}; artifact?: {type: 'svg' | 'html'; source: string; name: string}; fingerprint?: {samples: FingerprintSample[]; analysis: FingerprintAnalysis | null} }
export interface Evaluation { id: string; name: string; kind: TestKind; createdAt: number; runIds: string[]; prompt: string; footerVersion: string; preset?: Preset; fingerprint?: FingerprintRecord;
 /** Host-persisted attempts (请求) of this record, oldest first; `attemptId` is the attempt currently shown. */
 attempts: AttemptSummary[]; attemptId?: string; models: RecordModelRef[]; options: FingerprintOptions }
export interface FingerprintRecord { jobId?: string; status: 'starting' | 'running' | 'done' | 'cancelled' | 'failed'; reference?: {builtAt: string; sdk: string}; challenges: FingerprintChallenge[]; concurrency?: number; timeoutMs?: number; limits?: FingerprintLimits; busy?: 'configure' | 'retry'; error?: string }
export interface Tab { id: string; title: string; type: 'draft' | 'record' | 'feature'; recordId?: string; feature?: 'hub' | 'relay' }
export interface Navigation { mode: 'progress' | 'results'; runId?: string; artifact?: boolean }
export interface WorkbenchState { tabs: Tab[]; activeTab: string; sidebarCollapsed: boolean; navigation: Record<string, Navigation> }
export interface DraftState { name: string; kind: TestKind; selected: string[]; body: string; presetId?: string; dirty: boolean; pickerOpen: boolean; query: string; error?: string;
 /** Model picker source sidebar: DSH configured models, or one relay partition (favorites = default). */
 source: 'dsh' | 'partition'; partitionId: string;
 /** Relay channels chosen into the draft, keyed `relay:<partition item key>`. */
 relaySelected: Record<string, Model> }
export interface ModelsState { items: Model[]; providers: Provider[]; loading: boolean; error?: string }
export interface PresetsState { items: Preset[]; error?: string; collapsed: boolean }
export interface EvaluationsState { records: Evaluation[]; runs: Record<string, Run>; /** First Host list arrived. */ loaded: boolean; /** Host sync / action error banner. */ error?: string }
export interface PresentationState { columns: string[]; widths: Record<string, number>; expanded: Record<string, boolean>; followLatest: boolean; columnsOpen: boolean; viewOpen: boolean; configOpen: boolean; filter: string }
export interface RelaySettingsState { siteId: string; status?: RelayAuthStatus; loading: boolean; error?: string; message?: string; busy?: 'save' | 'verify' | 'provider' | 'clear'; drafts: {apiKey: string; accessToken: string; userId: string}; addFormat: RelayApi; addModel: string; managedRoutes: string[]; /** True when the runtime owns llm-pi-ai, so adding a model yields a config snippet instead of a write. */ managedReadOnly: boolean; managedSnippet: string; managedReason?: string; /** Inline confirmation for the provider cleanup (the Settings dialog cannot show the pane's notice modal). */ confirmClear: boolean }
export interface Notice { title: string; message: string; choices: {id: string; label: string; danger?: boolean}[]; input?: string }
export interface Store<T> { getState(): T; subscribe(listener: () => void): () => void }
export interface Workbench {
 sessionId: string;
 workbench: Store<WorkbenchState>; draft: Store<DraftState>; models: Store<ModelsState>; presets: Store<PresetsState>; evaluations: Store<EvaluationsState>; presentation: Store<PresentationState>; relay: Store<RelayStoreState>; settings: Store<RelaySettingsState>; tags: Store<TagsState>; notice: Store<Notice | null>;
 actions: {
  openDraft(): void; openRecord(id: string): void; openFeature(feature: 'hub' | 'relay'): void; activateTab(id: string): void; closeTab(id: string): void; toggleSidebar(): void; navigate(value: Partial<Navigation>): void;
  patchDraft(value: Partial<Pick<DraftState, 'name' | 'kind' | 'body' | 'pickerOpen' | 'query'>>): void; toggleModel(key: string): void; refreshModels(): void; submit(): void;
  selectPreset(id: string): void; addPreset(): void; renamePreset(id: string): void; deletePreset(id: string): void; savePreset(): void; togglePresets(): void;
  cancelRecord(id: string): void; deleteRecord(id: string): void; resetMocks(): void; rerunRecord(id: string): void; selectAttempt(recordId: string, attemptId: string): void;
  setDraftSource(source: 'dsh' | 'partition', partitionId?: string): void; toggleRelayItem(item: PartitionItem): void;
  setFingerprintConfig(id: string, options: FingerprintOptions): void;
  retryFailedSample(id: string, runId: string): void;
  toggleColumn(id: string): void; resizeColumn(id: string, width: number): void; toggleColumns(): void; toggleView(): void; toggleConfig(): void; toggleRound(id: string, defaultExpanded: boolean): void; toggleFollow(): void; setFilter(value: string): void;
  relayRefresh(): void; relaySite(id: string): void; relaySort(id: string): void; toggleRelayColumn(id: string): void; resizeRelayColumn(id: string, width: number): void; toggleRelayColumns(): void; relayScroll(top: number, viewportHeight: number): void; openRelayDetail(rowKey: string): void; closeRelayDetail(): void;
  relayMenu(open: 'brand' | 'model' | null): void; relayMenuQuery(kind: 'brand' | 'model', query: string): void; relayToggleBrand(name: string): void; relayToggleModel(name: string): void; relayClearFilter(kind: 'brand' | 'model'): void; relayFidelity(value: RelayFidelity): void;
  relayView(view: 'list' | 'favorites'): void; relayCurrency(value: Currency): void; relayRetryMissing(): void; relayClearExpired(siteId: string, channelId: number, model: string): void;
  relayPoolOpen(partitionId: string, key: string): void; relayPoolFormat(format: RelayApi): void; relayPoolClose(): void; relayPoolConfirm(): void;
  tagsMenu(target: string | null): void; tagsQuery(query: string): void; tagsCategory(category: string): void; tagsToggle(target: string, tag: string): void; tagsSet(target: string, tags: string[]): void; tagsLoad(): void;
  relayLoadHistory(rowKey: string): void; relayLoadConcurrency(rowKey: string): void; relayLoadSvg(rowKey: string): void;
  relayToggleFavorite(rowKey: string): void; relayPartitionMenu(rowKey: string | null): void; relayAssign(rowKey: string, partitionId: string): void;
  partitionCreate(): void; partitionRename(id: string): void; partitionDelete(id: string): void; partitionRemoveItem(partitionId: string, key: string): void; partitionTags(partitionId: string, key: string): void; partitionApi(partitionId: string, key: string, api: RelayApi): void;
  settingsLoad(): void; settingsDraft(field: 'apiKey' | 'accessToken' | 'userId', value: string): void; settingsSave(): void; settingsClear(field: 'apiKey' | 'accessToken' | 'userId'): void; settingsVerify(): void; settingsAddForm(value: {format?: RelayApi; model?: string}): void; settingsAddModel(): void; settingsRemoveModel(format: RelayApi, model: string, channelId?: number): void; settingsToggleTrait(format: RelayApi, model: ManagedModel, trait: 'image' | 'reasoning'): void; settingsRequestClear(): void;
 settingsCancelClear(): void;
 settingsClearProviders(): void;
 settingsCopySnippet(): void;
  answerNotice(choice: string): void; setNoticeInput(value: string): void;
 };
 dispose(): void;
}
export const FIXED_FOOTER_VERSION = 'delivery-v1';
export const FIXED_FOOTER = '\n\n【最终交付约束 · delivery-v1】\n优先完成任务本身，由 Agent 根据任务选择合适的成果类型，无需过度包装。若交付绘图，只使用 Canvas + HTML 或 SVG。当前阶段不启动服务、不配置启动命令或端口。提供清晰的结果说明与可检查的成果。';
export const STAGE_LABELS: Record<Stage, string> = {queued:'排队中', 'waiting-first-token':'等待首 Token', streaming:'生成中', finalizing:'收尾中', analyzing:'分析中', completed:'已完成', failed:'失败', timeout:'超时', cancelled:'已取消'};
export const COLUMN_LABELS: Record<string,string> = {stage:'状态', input:'输入 Token', output:'输出 Token', ttft:'TTFT', e2e:'端到端 tok/s', generation:'生成 tok/s', cost:'费用（模拟）', match:'最高匹配', round:'当前轮次'};
