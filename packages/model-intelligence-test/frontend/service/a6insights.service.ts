import type { A6RelationKind, A6ResultActionInput, ModelIntelligenceTransport } from '../types';

export const readOperationState = (transport: ModelIntelligenceTransport, options: {refreshTokens?: boolean; refreshRelations?: boolean} = {}) => transport.a6OperationState(options);
export const selectOperationToken = (transport: ModelIntelligenceTransport, tokenId: number | null) => transport.a6OperationSelect({tokenId});
export const refreshOperationRelations = (transport: ModelIntelligenceTransport, kind: A6RelationKind) => transport.a6OperationRefresh({kind});
export const resultAction = (transport: ModelIntelligenceTransport, input: A6ResultActionInput) => transport.a6ResultAction(input);
export const readLedger = (transport: ModelIntelligenceTransport, recordId: string, attemptId?: string, refresh = false) => transport.a6LedgerView({recordId, ...(attemptId ? {attemptId} : {}), ...(refresh ? {refresh} : {})});
export const keyChannels = (transport: ModelIntelligenceTransport, tokenId: number, refresh = false) => transport.a6KeyChannels({tokenId, ...(refresh ? {refresh} : {})});
export const removeRoute = (transport: ModelIntelligenceTransport, input: {tokenId: number; model: string; channelId: number}) => transport.a6RemoveRoute(input);
export const unpinChannel = (transport: ModelIntelligenceTransport, input: {tokenId: number; model: string; channelId: number}) => transport.a6Unpin(input);
export const pinChannel = (transport: ModelIntelligenceTransport, input: {tokenId: number; model: string; channelId: number}) => transport.a6KeyPin(input);
export const keyChannelPrices = (transport: ModelIntelligenceTransport, tokenId: number, refresh = false) => transport.a6KeyChannelPrices({tokenId, ...(refresh ? {refresh} : {})});
export const channelTests = (transport: ModelIntelligenceTransport, model: string, channelId: number, limit = 20) => transport.channelTests({model, channelId, limit});
