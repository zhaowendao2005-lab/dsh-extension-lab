import type { A6ResultActionInput, A6Target, ModelIntelligenceTransport } from '../types';

export const readProviderState = (transport: ModelIntelligenceTransport, options: {refresh?: boolean; scan?: boolean} = {}) => transport.a6ProviderState(options);
export const configureProviders = (transport: ModelIntelligenceTransport, providerIds: string[]) => transport.a6ProviderConfigure({providerIds});
export const saveTarget = (transport: ModelIntelligenceTransport, recordId: string, model: string, target: A6Target) => transport.a6TargetSave({recordId, model, ...target});
export const resultAction = (transport: ModelIntelligenceTransport, input: A6ResultActionInput) => transport.a6ResultAction(input);
export const readLedger = (transport: ModelIntelligenceTransport, recordId: string, attemptId?: string, refresh = false) => transport.a6LedgerView({recordId, ...(attemptId ? {attemptId} : {}), ...(refresh ? {refresh} : {})});
