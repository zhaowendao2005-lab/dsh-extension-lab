import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
const catalogSchema = z.object({ providers: z.array(z.object({
  id: z.string(), name: z.string(), models: z.array(z.object({id: z.string(), name: z.string(), description: z.string().optional()})), error: z.string().optional(),
})) });
const concurrency = z.number().int().min(1).max(6);
const timeoutMs = z.number().int().min(30_000).max(1_800_000);
const startSchema = z.strictObject({
  models: z.array(z.strictObject({provider: z.string().min(1).max(128), id: z.string().min(1).max(256)})).min(1).max(64),
  concurrency: concurrency.optional(),
  timeoutMs: timeoutMs.optional(),
});
const configureSchema = z.strictObject({
  jobId: z.string().min(1).max(128),
  concurrency: concurrency.optional(),
  timeoutMs: timeoutMs.optional(),
});
const retrySchema = z.strictObject({
  jobId: z.string().min(1).max(128),
  model: z.strictObject({provider: z.string().min(1).max(128), id: z.string().min(1).max(256)}),
});
const statusSchema = z.strictObject({jobId: z.string().min(1).max(128), revision: z.number().int().min(0).optional()});
const cancelSchema = z.strictObject({jobId: z.string().min(1).max(128)});
const json = (symbol) => ({mode: 'strict', typeSymbol: `model-intelligence-test#${symbol}`, create: () => z.json()});
const input = (symbol, schema) => {
  const codec = {mode: 'strict', typeSymbol: `model-intelligence-test#${symbol}`, create: () => schema};
  return [{name: 'request', source: 'json', codec, strictCodec: codec}];
};
// Wire-only schema shared by both faces. It imports neither backend nor frontend.
export const remoteInfo = createTypertRemoteInfo({
  package: 'model-intelligence-test',
  methods: {
    'modelIntelligence/catalog': {
      service: 'modelIntelligence',
      description: 'Read configured provider/model metadata; does not invoke inference or endpoint discovery.',
      invocation: {kind: 'direct'}, parameters: [],
      result: {mode: 'strict', typeSymbol: 'model-intelligence-test#catalog', create: () => catalogSchema},
    },
    'modelIntelligence/fingerprintStart': {
      service: 'modelIntelligence',
      description: 'Start a real lm-detector fingerprint job: 3 shared challenges sampled from each selected model via the runtime llm service. Model-slot concurrency and request deadline are optional.',
      invocation: {kind: 'direct'}, parameters: input('fingerprintStart:request', startSchema),
      result: json('fingerprintStart:result'),
    },
    'modelIntelligence/fingerprintConfigure': {
      service: 'modelIntelligence',
      description: 'Change model-slot concurrency or request deadline of a running job. Live and non-preemptive: lowering a limit never aborts in-flight requests.',
      invocation: {kind: 'direct'}, parameters: input('fingerprintConfigure:request', configureSchema),
      result: json('fingerprintConfigure:result'),
    },
    'modelIntelligence/fingerprintRetry': {
      service: 'modelIntelligence',
      description: 'Re-run the failed samples of one model in an existing job; finished samples of that model are kept.',
      invocation: {kind: 'direct'}, parameters: input('fingerprintRetry:request', retrySchema),
      result: json('fingerprintRetry:result'),
    },
    'modelIntelligence/fingerprintStatus': {
      service: 'modelIntelligence',
      description: 'Read the current state of a fingerprint job; returns {unchanged:true} when the revision has not moved.',
      invocation: {kind: 'direct'}, parameters: input('fingerprintStatus:request', statusSchema),
      result: json('fingerprintStatus:result'),
    },
    'modelIntelligence/fingerprintCancel': {
      service: 'modelIntelligence',
      description: 'Abort in-flight model requests of a fingerprint job.',
      invocation: {kind: 'direct'}, parameters: input('fingerprintCancel:request', cancelSchema),
      result: json('fingerprintCancel:result'),
    },
  },
}, z);
export const hostContribution = {package: remoteInfo.package, face: 'host', schemas: [], invocations: remoteInfo.descriptors, model: {symbols: [], exports: [], relations: []}};
