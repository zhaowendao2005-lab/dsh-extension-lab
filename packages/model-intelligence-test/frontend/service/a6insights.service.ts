import type { A6RelationKind, A6ResultActionInput, ModelIntelligenceTransport } from '../types';

export const readOperationState = (transport: ModelIntelligenceTransport, options: {refreshTokens?: boolean; refreshRelations?: boolean} = {}) => transport.a6OperationState(options);
export const selectOperationToken = (transport: ModelIntelligenceTransport, tokenId: number | null) => transport.a6OperationSelect({tokenId});
export const refreshOperationRelations = (transport: ModelIntelligenceTransport, kind: A6RelationKind) => transport.a6OperationRefresh({kind});
export const resultAction = (transport: ModelIntelligenceTransport, input: A6ResultActionInput) => transport.a6ResultAction(input);
export const readLedger = (transport: ModelIntelligenceTransport, recordId: string, attemptId?: string, refresh = false) => transport.a6LedgerView({recordId, ...(attemptId ? {attemptId} : {}), ...(refresh ? {refresh} : {})});
