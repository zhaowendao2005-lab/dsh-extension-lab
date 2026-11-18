import type { ModelIntelligenceTransport } from '../types';
import { readCustomRunDetail, readCustomFile, openCustomOutput, continueCustomRun, cancelCustomRun } from '../service/custom.service';

export { applyCustomRun, createCustomTask, customPrompt } from '../service/custom.service';

export const loadRunDetail = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; revision?: number}) => readCustomRunDetail(transport, request);
export const readFile = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; path: string}) => readCustomFile(transport, request);
export const openOutput = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string; mode?: 'preview' | 'vscode' | 'reveal'; application?: string}) => openCustomOutput(transport, request);
export const continueRun = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string}) => continueCustomRun(transport, request);
export const cancelRun = (transport: ModelIntelligenceTransport, request: {attemptId: string; runId: string}) => cancelCustomRun(transport, request);
