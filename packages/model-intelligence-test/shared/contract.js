import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { marketSchema } from './market.js';

const catalogSchema = z.object({ providers: z.array(z.object({
  id: z.string(), name: z.string(), models: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })), error: z.string().optional(),
})) });

const id = (max = 128) => z.string().min(1).max(max);
const siteId = id(64);
const concurrency = z.number().int().min(1).max(6);
const timeoutMs = z.number().int().min(30_000).max(1_800_000);
// DSH-native wire protocols (dsh-llm-pi-ai PROTOCOLS); chat/responses/messages stay readable for old records.
export const A6_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];
const protocol = z.enum(A6_PROTOCOLS);
const relayApi = z.enum(['chat', 'responses', 'messages', ...A6_PROTOCOLS]);
const protocolEntry = z.strictObject({ channelId: z.number().int().positive(), model: id(256), api: protocol });
const relayRef = z.strictObject({ siteId, channelId: z.number().int().min(1), model: id(256), api: relayApi, listingId: z.number().int().min(0).optional(), supplierId: z.number().int().min(0).optional() });
const modelRef = z.strictObject({ provider: id(128), id: id(256) });
const a6Channel = z.strictObject({ listingId: z.number().int().nonnegative(), channelId: z.number().int().positive(), supplierId: z.number().int().nonnegative(), model: id(256), supplierName: z.string().max(256).optional(), channelName: z.string().max(256).optional(), brand: z.string().max(256).optional(), market: marketSchema.optional() });
const recordModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional(), relay: relayRef.optional(), a6api: a6Channel.optional() });
const nativeModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional() });
const preset = z.strictObject({ id: z.string().max(128), name: z.string().max(120), body: z.string().max(200_000) });
const customPrompt = { prompt: z.string().max(200_000).optional(), footerVersion: z.string().max(40).optional(), preset: preset.nullable().optional(), concurrency: concurrency.optional(), dshModels: z.array(nativeModel).max(64).optional() };
const customRun = { attemptId: id(), runId: id() };
// A slot is one test token: the Host pins it to a channel, so no provider mapping is involved.
const a6Slots = z.array(z.strictObject({ tokenId: z.number().int().positive() })).min(1);
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
  recordRename: z.strictObject({ recordId: id(), name: z.string().trim().min(1).max(120) }),
  recordDelete: z.strictObject({ recordId: id() }),
  attemptView: z.strictObject({ attemptId: id(), revision: z.number().int().min(0).optional() }),
  attemptCancel: z.strictObject({ attemptId: id() }),
  attemptConfigure: z.strictObject({ attemptId: id(), concurrency: concurrency.optional(), timeoutMs: timeoutMs.optional() }),
  attemptRetry: z.strictObject({ attemptId: id(), model: modelRef }),
  customRunDetail: z.strictObject({ ...customRun, revision: z.number().int().nonnegative().optional() }),
  customFileRead: z.strictObject({ ...customRun, path: z.string().min(1).max(512) }),
  customOutputOpen: z.strictObject({ ...customRun, mode: z.enum(['preview', 'vscode', 'reveal', 'browser', 'webview']).optional(), application: z.string().min(1).max(512).optional(), title: z.string().min(1).max(256).optional() }),
  customRunContinue: z.strictObject({ ...customRun }),
  customRunCancel: z.strictObject({ ...customRun }),
  a6ConfigSave: z.strictObject({ accessToken: z.string().max(512).optional(), userId: z.string().max(40).optional() }),
  a6Selections: z.strictObject({ revision: z.number().int().nonnegative().optional() }),
  a6Create: z.strictObject({ selectionId: id(), kind: z.enum(['fingerprint', 'custom']).optional(), ...customPrompt, name: z.string().max(120), slots: a6Slots, timeoutMs: timeoutMs.optional(), models: z.array(a6Channel).min(1).max(64).optional(), protocols: z.array(protocolEntry).max(64).optional() }),
  a6CustomFromRecord: z.strictObject({ recordId: id(), name: z.string().max(120), models: z.array(z.strictObject({channelId:z.number().int().positive(), model:id(256), api: protocol.optional()})).min(1).max(64).optional(), slots: a6Slots.optional(), ...customPrompt, timeoutMs: timeoutMs.optional() }),
  a6OperationState: z.strictObject({ refreshTokens: z.boolean().optional(), refreshRelations: z.boolean().optional() }),
  a6OperationSelect: z.strictObject({ tokenId: z.number().int().positive().nullable() }),
  a6OperationRefresh: z.strictObject({ kind: z.enum(['pins', 'routes', 'all']) }),
  a6ResultAction: z.strictObject({ recordId: id(), model: id(256), channelId: z.number().int().positive(), tokenId: z.number().int().positive(), operation: z.enum(['pin', 'route', 'restore']) }),
  a6LedgerView: z.strictObject({ attemptId: id().optional(), recordId: id().optional(), refresh: z.boolean().optional() }).refine(value => value.attemptId || value.recordId, '缺少测试记录或轮次 ID'),
  a6KeyChannels: z.strictObject({ tokenId: z.number().int().positive(), refresh: z.boolean().optional() }),
  a6RemoveRoute: z.strictObject({ tokenId: z.number().int().positive(), model: id(256), channelId: z.number().int().positive() }),
  channelTests: z.strictObject({ model: id(256), channelId: z.number().int().positive(), limit: z.number().int().min(1).max(100).optional() }),
};

const DESCRIPTIONS = {
  catalog: 'Read configured provider/model metadata; does not invoke inference or endpoint discovery.',
  recordsList: 'List persisted test records with attempt summaries; {unchanged:true} when the revision has not moved.',
  recordCreate: 'Create a test record; records immediately start their first Host-owned attempt (real model requests).',
  recordRerun: 'Re-request a test record with its fixed model set; queued behind a running attempt.',
  recordRename: 'Rename a saved test record; attempts and historical snapshots stay unchanged.',
  recordDelete: 'Delete a record and its attempts, cancelling running requests.',
  recordsClear: 'Delete every record and attempt.',
  attemptView: 'Read one attempt: live engine view or persisted snapshot.',
  attemptCancel: 'Cancel a queued or running attempt.',
  attemptConfigure: 'Change concurrency / request deadline / channel lane of an attempt (live, non-preemptive) and the record defaults.',
  attemptRetry: 'Re-run the failed samples of one model; completed samples are kept.',
  customRunDetail: 'Read bounded events, requests and sandbox metadata for a custom run belonging to an attempt.',
  customFileRead: 'Read a bounded relative file inside a verified custom-run sandbox.',
  customOutputOpen: 'Preview a validated output, or open that exact file with the discovered VS Code application, a browser, or the desktop file manager.',
  customRunContinue: 'Queue a failed, cancelled or interrupted custom run to resume its original DSH session and send a continue message (real inference).',
  customRunCancel: 'Cancel only the specified queued or running custom model; leave the other runs in its attempt alone.',
  a6CustomFromRecord: 'Create custom sessions from channels of an existing fingerprint record; uses its account and dedicated test slots.',
  a6Config: 'Read a6api credential state (masked access token, intake token, loopback origin); never returns the access token.',
  a6ConfigSave: 'Verify and store the a6api access token plus user id in Host storage.',
  a6IntakeRotate: 'Rotate the intake token the userscript uses; received selections stay valid.',
  a6Tokens: 'List the account test tokens from a6api (id and name only, no key material).',
  a6Selections: 'Read selections sent by the a6api userscript. Does not start inference.',
  a6Create: 'Create an a6api fingerprint or custom attempt using user-selected test token slots (real inference).',
  a6OperationState: 'Read account token metadata and selected-key pin/route snapshots; only initial load or explicit refresh contacts the site.',
  a6OperationSelect: 'Persist the account-wide operation key and read its pin and route state. No key plaintext is read.',
  a6OperationRefresh: 'Explicitly refresh selected-key pins, routes, or both from the site.',
  a6ResultAction: 'Set a recorded channel pin or add it to routing under the global operation key; read back state. Restore handles legacy leases only.',
  a6LedgerView: 'Read durable executions and known billing totals for a record or attempt; refresh schedules reconciliation, never inference.',
  a6KeyChannels: 'Read the pins and routing channels bound to one a6api key; read-only, never changes the operation key.',
  a6RemoveRoute: 'Remove one channel from a model routing pool on the a6api site and verify the result by reading it back.',
  channelTests: 'List historical fingerprint and custom test runs for one model channel, newest first.',
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
