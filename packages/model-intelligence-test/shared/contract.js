import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';

const catalogSchema = z.object({ providers: z.array(z.object({
  id: z.string(), name: z.string(), models: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })), error: z.string().optional(),
})) });

const id = (max = 128) => z.string().min(1).max(max);
const siteId = id(64);
const concurrency = z.number().int().min(1).max(6);
const timeoutMs = z.number().int().min(30_000).max(1_800_000);
const relayApi = z.enum(['chat', 'responses', 'messages']);
const relayRef = z.strictObject({ siteId, channelId: z.number().int().min(1), model: id(256), api: relayApi, listingId: z.number().int().min(0).optional(), supplierId: z.number().int().min(0).optional() });
const modelRef = z.strictObject({ provider: id(128), id: id(256) });
const recordModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional(), relay: relayRef.optional() });
const a6Channel = z.strictObject({ listingId: z.number().int().nonnegative(), channelId: z.number().int().positive(), supplierId: z.number().int().nonnegative(), model: id(256), supplierName: z.string().max(256).optional(), channelName: z.string().max(256).optional(), brand: z.string().max(256).optional() });
const a6Slots = z.array(z.strictObject({ tokenId: z.number().int().positive(), provider: id(128) })).min(1).max(8);
const options = z.strictObject({ concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() });

const schemas = {
  recordsList: z.strictObject({ revision: z.number().int().min(0).optional() }),
  recordCreate: z.strictObject({
    kind: z.enum(['fingerprint', 'custom']), name: z.string().max(120),
    models: z.array(recordModel).min(1).max(64), options: options.optional(),
    prompt: z.string().max(200_000).optional(), footerVersion: z.string().max(40).optional(),
    preset: z.strictObject({ id: z.string().max(128), name: z.string().max(120), body: z.string().max(200_000) }).nullable().optional(),
  }),
  recordRerun: z.strictObject({ recordId: id() }),
  recordDelete: z.strictObject({ recordId: id() }),
  attemptView: z.strictObject({ attemptId: id(), revision: z.number().int().min(0).optional() }),
  attemptCancel: z.strictObject({ attemptId: id() }),
  attemptConfigure: z.strictObject({ attemptId: id(), concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() }),
  attemptRetry: z.strictObject({ attemptId: id(), model: modelRef }),
  customSave: z.strictObject({ recordId: id(), snapshot: z.strictObject({ ended: z.boolean(), runs: z.array(z.json()).max(64) }) }),
  a6Selections: z.strictObject({ revision: z.number().int().nonnegative().optional() }),
  a6Preferences: z.strictObject({ selectionId: id() }),
  a6PreferencesSave: z.strictObject({ selectionId: id(), slots: a6Slots, timeoutMs: timeoutMs.optional() }),
  a6Create: z.strictObject({ selectionId: id(), name: z.string().max(120), slots: a6Slots, timeoutMs: timeoutMs.optional(), models: z.array(a6Channel).min(1).max(64).optional() }),
  a6Action: z.strictObject({ selectionId: id(), tokenId: z.number().int().positive(), model: id(256), channelId: z.number().int().positive(), operation: z.enum(['pin', 'route', 'restore']) }),
};

const DESCRIPTIONS = {
  catalog: 'Read configured provider/model metadata; does not invoke inference or endpoint discovery.',
  recordsList: 'List persisted test records with attempt summaries; {unchanged:true} when the revision has not moved.',
  recordCreate: 'Create a test record; fingerprint records immediately start their first attempt (real model requests).',
  recordRerun: 'Re-request a fingerprint record with its fixed model set; queued behind a running attempt.',
  recordDelete: 'Delete a record and its attempts, cancelling running requests.',
  recordsClear: 'Delete every record and attempt.',
  attemptView: 'Read one attempt: live engine view or persisted snapshot.',
  attemptCancel: 'Cancel a queued or running attempt.',
  attemptConfigure: 'Change concurrency / request deadline / channel lane of an attempt (live, non-preemptive) and the record defaults.',
  attemptRetry: 'Re-run the failed samples of one model; completed samples are kept.',
  customSave: 'Persist a simulated custom-task snapshot; no inference is performed.',
  a6BridgeInfo: 'Read the owner-only loopback pairing configuration and account-bound page connection status.',
  a6Selections: 'Read selections sent by the paired a6api userscript. Does not start inference.',
  a6Preferences: 'Read account-scoped test-token to DSH-provider mappings chosen by the user.',
  a6PreferencesSave: 'Save the user-selected token/provider mappings for this account and runtime profile.',
  a6Create: 'Create an a6api-specific fingerprint attempt using user-selected test token/provider slots (real inference).',
  a6Action: 'Execute one explicit pin, route-add or restore action for a selected test token through the paired page.',
};

const json = (symbol) => ({ mode: 'strict', typeSymbol: `model-intelligence-test#${symbol}`, create: () => z.json() });
const input = (symbol, schema) => {
  const codec = { mode: 'strict', typeSymbol: `model-intelligence-test#${symbol}`, create: () => schema };
  return [{ name: 'request', source: 'json', codec, strictCodec: codec }];
};

const methods = {};
for (const [name, description] of Object.entries(DESCRIPTIONS)) {
  methods[`modelIntelligence/${name}`] = {
    service: 'modelIntelligence', description, invocation: { kind: 'direct' },
    parameters: schemas[name] ? input(`${name}:request`, schemas[name]) : [],
    result: name === 'catalog' ? { mode: 'strict', typeSymbol: 'model-intelligence-test#catalog', create: () => catalogSchema } : json(`${name}:result`),
  };
}

// Wire-only schema shared by both faces. It imports neither backend nor frontend.
export const REMOTE_METHOD_NAMES = Object.keys(DESCRIPTIONS);
export const remoteInfo = createTypertRemoteInfo({ package: 'model-intelligence-test', methods }, z);
export const hostContribution = { package: remoteInfo.package, face: 'host', schemas: [], invocations: remoteInfo.descriptors, model: { symbols: [], exports: [], relations: [] } };
