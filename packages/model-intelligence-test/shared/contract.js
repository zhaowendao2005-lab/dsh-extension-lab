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
const relayRef = z.strictObject({ siteId, channelId: z.number().int().min(1), model: id(256), api: relayApi });
const modelRef = z.strictObject({ provider: id(128), id: id(256) });
const recordModel = z.strictObject({ provider: id(128), id: id(256), name: z.string().max(256).optional(), relay: relayRef.optional() });
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
  partitionSave: z.strictObject({ id: id(64).optional(), name: z.string().min(1).max(40) }),
  partitionDelete: z.strictObject({ partitionId: id(64) }),
  partitionItem: z.strictObject({
    partitionId: id(64).optional(), remove: z.boolean().optional(), tags: z.array(z.string().max(24)).max(12).optional(), api: relayApi.optional(),
    item: z.strictObject({
      key: id(128), siteId, channelId: z.number().int().min(0), model: z.string().max(256), brand: z.string().max(64),
      supplier: z.string().max(128), channelName: z.string().max(128), testEndpoint: z.string().max(16),
    }),
  }),
  relayAuthStatus: z.strictObject({ siteId }),
  relayAuthSet: z.strictObject({
    siteId, apiKey: z.string().max(512).nullable().optional(), accessToken: z.string().max(512).nullable().optional(), userId: z.string().max(12).nullable().optional(),
  }),
  relayAuthVerify: z.strictObject({ siteId }),
  relayProviderModel: z.strictObject({
    siteId, format: relayApi, model: id(256), name: z.string().max(120).optional(), remove: z.boolean().optional(),
    channelId: z.number().int().nonnegative().optional(), image: z.boolean().optional(), reasoning: z.boolean().optional(), contextWindow: z.number().int().positive().optional(),
  }),
  relayProvidersClear: z.strictObject({ siteId }),
  relaySnapshot: z.strictObject({ siteId, force: z.boolean().optional() }),
  relayRows: z.strictObject({
    siteId,
    brands: z.array(z.string().max(128)).max(64).optional(),
    models: z.array(z.string().max(256)).max(256).optional(),
    fidelity: z.enum(['all', 'guaranteed', 'direct']).optional(),
    sort: z.enum(['comprehensive', 'price_asc', 'price_desc', 'success_desc', 'p50_asc']).optional(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(20000),
  }),
  relayRow: z.strictObject({ siteId, rowKey: id() }),
  relayHistory: z.strictObject({ siteId, rowKey: id() }),
  relayConcurrency: z.strictObject({ siteId, rowKey: id() }),
  relaySvg: z.strictObject({ siteId, rowKey: id() }),
  relayResolve: z.strictObject({ siteId, refs: z.array(z.strictObject({ channelId: z.number().int().min(0), model: z.string().max(256) })).max(512) }),
  relayRetryMissing: z.strictObject({ siteId }),
  tagsSet: z.strictObject({ target: z.string().min(1).max(200), tags: z.array(z.string().min(1).max(80)).max(24) }),
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
  attemptConfigure: 'Change concurrency / request deadline of an attempt (live, non-preemptive) and the record defaults.',
  attemptRetry: 'Re-run failed samples of one model inside an attempt.',
  customSave: 'Persist the snapshot of a simulated custom attempt.',
  partitionsList: 'List channel partitions (favorites is the default partition).',
  partitionSave: 'Create or rename a partition.',
  partitionDelete: 'Delete a partition and its items.',
  partitionItem: 'Add, tag or remove one relay channel in a partition.',
  relayAuthStatus: 'Relay credential status (configured / verified), never the values.',
  relayAuthSet: 'Store or clear relay credentials in the Host credential store.',
  relayAuthVerify: 'Verify the relay system access token against the site.',
  relayProviderModel: 'Add or remove a relay model on a plugin-managed pi-ai provider route.',
  relayProvidersClear: 'Remove every plugin-managed pi-ai provider route of a site.',
  relayManagedRoutes: 'List provider route ids this plugin may manage (for read-only display).',
  relaySites: 'List adapted relay sites and their anonymous capabilities.',
  relaySnapshot: 'Read the status and facets of a relay channel snapshot, starting a background full fetch when needed.',
  relayRows: 'Read one filtered, sorted window of relay channel listings from the Host snapshot.',
  relayRow: 'Read one relay channel listing detail.',
  relayHistory: 'Fetch the 24h / 7d success series of one channel on demand.',
  relayConcurrency: 'Fetch the live concurrency sample of one channel (anonymous).',
  relaySvg: 'Fetch the latest SVG self-test of one channel (needs the relay access token).',
  relayResolve: 'Look up channel/model pairs in the relay snapshot: price and whether the channel still exists.',
  relayRetryMissing: 'Re-fetch only the snapshot pages that failed last time.',
  tagsList: 'Read the global tag map (target → tags) used by favorites, results and filters.',
  tagsSet: 'Replace the tags of one target (channel+model or DSH model); an empty list removes the entry.',
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
