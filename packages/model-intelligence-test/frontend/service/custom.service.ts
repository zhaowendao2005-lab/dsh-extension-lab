import type { A6Protocol, A6Channel, CustomRunSummary, Metrics, Model, ModelIntelligenceTransport, Preset, RecordModelRef, Run, StoredRecord } from '../types';
import { FIXED_FOOTER, FIXED_FOOTER_VERSION } from '../types';

export function applyCustomRun(previous: Run | undefined, summary: CustomRunSummary, recordId: string, model: Model): Run {
  const usage = summary.usage;
  const metrics = summary.metrics;
  const projected: Run = {
    id: summary.id,
    testId: recordId,
    sessionId: summary.sessionId,
    model,
    stage: summary.phase,
    output: '',
    metrics: {
      ...((usage.inputTotalTokens ?? usage.inputTokens) !== null && (usage.inputTotalTokens ?? usage.inputTokens) !== undefined ? { input: (usage.inputTotalTokens ?? usage.inputTokens)! } : {}),
      ...(usage.outputTokens !== null ? { output: usage.outputTokens } : {}),
      ...(usage.cacheReadTokens !== null ? { cache: usage.cacheReadTokens } : {}),
      ...(metrics.ttftMs !== null ? { ttft: metrics.ttftMs } : {}),
      ...(metrics.endToEndTokensPerSecond !== null ? { e2e: metrics.endToEndTokensPerSecond } : {}),
      ...(metrics.modelTokensPerSecond !== null ? { generation: metrics.modelTokensPerSecond } : {}),
      ...(usage.cost !== null && ['settled', 'observed', 'partial'].includes(usage.billingState) ? { cost: usage.cost } : {}),
      ...(metrics.e2eMs !== null ? { elapsed: metrics.e2eMs } : {}),
    } satisfies Metrics,
    candidates: [],
    rounds: [],
    currentRound: 0,
    custom: summary,
    ...(summary.error ? { error: { stage: summary.phase, message: summary.error.message } } : {}),
  };
  return previous?.custom && JSON.stringify(previous.custom) === JSON.stringify(summary) && previous.model === model ? previous : projected;
}

export interface CreateCustomTaskInput {
  selectionId?: string;
  sourceRecordId?: string;
  name: string;
  a6Models: A6Channel[];
  protocols?: Record<string, A6Protocol>;
  slots: {tokenId: number; name?: string}[];
  dshModels: RecordModelRef[];
  prompt: string;
  preset?: Preset | null;
  concurrency: number;
  timeoutMs: number;
  footerVersion?: string;
}
export async function createCustomTask(transport: ModelIntelligenceTransport, input: CreateCustomTaskInput): Promise<{record: StoredRecord; attemptId: string}> {
  const prompt = customPrompt(input.prompt);
  const common = { name: input.name, models: input.a6Models, slots: input.slots.map(({ tokenId }) => ({ tokenId })), dshModels: input.dshModels, kind: 'custom' as const, prompt, footerVersion: input.footerVersion ?? FIXED_FOOTER_VERSION, preset: input.preset ?? null, concurrency: input.concurrency, timeoutMs: input.timeoutMs };
  if (input.sourceRecordId && input.a6Models.length) return transport.a6CustomFromRecord({ recordId: input.sourceRecordId, name: input.name, models: input.a6Models.map(({ channelId, model }) => ({ channelId, model, ...(input.protocols?.[`${channelId}:${model}`] ? { api: input.protocols[`${channelId}:${model}`] } : {}) })), slots: input.slots.map(({ tokenId }) => ({ tokenId })), dshModels: input.dshModels, prompt, footerVersion: common.footerVersion, preset: input.preset ?? null, concurrency: input.concurrency, timeoutMs: input.timeoutMs });
  const protocols = input.a6Models.flatMap(({ channelId, model }) => { const api = input.protocols?.[`${channelId}:${model}`]; return api ? [{ channelId, model, api }] : []; });
  if (input.selectionId && input.a6Models.length) return transport.a6Create({ selectionId: input.selectionId, ...common, ...(protocols.length ? { protocols } : {}) });
  if (input.a6Models.length) throw new Error('a6api 目标必须来自一次有效网页选择或已有指纹结果');
  const models = input.dshModels.map(({ provider, id, name }) => ({ provider, id, name }));
  const result = await transport.recordCreate({ kind: 'custom', name: input.name, models, options: { concurrency: input.concurrency, timeoutMs: input.timeoutMs }, prompt, footerVersion: common.footerVersion, preset: input.preset ?? null });
  const attemptId = result.attemptId;
  if (typeof attemptId !== 'string' || !attemptId) throw new Error('Host 未为自定义任务创建测试轮次');
  return { record: result.record, attemptId };
}
export const readCustomRunDetail = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; revision?: number}) => transport.customRunDetail(request);
export const readCustomFile = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; path: string}) => transport.customFileRead(request);
export const openCustomOutput = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; mode?: 'preview' | 'vscode' | 'reveal' | 'browser' | 'webview'; application?: string; title?: string}) => transport.customOutputOpen(request);
export const continueCustomRun = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string}) => transport.customRunContinue(request);
export const cancelCustomRun = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string}) => transport.customRunCancel(request);
export const customPrompt = (body: string): string => body + FIXED_FOOTER;
export type CustomCreateResult = Awaited<ReturnType<typeof createCustomTask>>;
