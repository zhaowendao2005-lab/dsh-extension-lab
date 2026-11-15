/**
 * Drive the REAL dsh-antigravity plugin host code (same source the installed
 * v1.1.3 build was produced from: lib/index.js is byte-identical to
 * ~/.dsh/profiles/desktop/node_modules/dsh-antigravity/lib/index.js) so the
 * outbound Cloud Code request can be captured on the wire.
 *
 * Usage:
 *   node plugin-request.mjs [--model gemini-3.8-flash] [--effort low]
 *                           [--prompt "Reply with exactly: OK"] [--no-tools]
 *
 * Env (for capture): HTTPS_PROXY / HTTP_PROXY / NO_PROXY, NODE_USE_ENV_PROXY=1,
 * NODE_EXTRA_CA_CERTS=<mitmproxy-ca-cert.pem>. DSH_HOME selects credentials.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importHostModule } from '../packages/dsh-antigravity/test/helpers/load-host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const model = arg('model', 'gemini-3.8-flash');
const effort = arg('effort', 'low');
const prompt = arg('prompt', 'Reply with exactly: OK');
const withTools = !process.argv.includes('--no-tools');
const sessionId = arg('session', 'labcapture0000000000000000000001');

const { AntigravityService } = await importHostModule('src/host/adapter.ts');
const { normalizeConfig } = await importHostModule('src/host/config.ts');

// Defaults: storageDir = $DSH_HOME/antigravity (the host's real credentials).
const cfg = normalizeConfig({});
const service = new AntigravityService(cfg);

const tools = withTools
  ? [
      {
        name: 'noop',
        description: 'Does nothing. Use only if explicitly asked.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    ]
  : undefined;

const started = Date.now();
const chunks = [];
try {
  for await (const chunk of service.adapter.stream({
    provider: 'antigravity',
    model,
    reasoningEffort: effort,
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    tools,
    sessionId,
  })) {
    chunks.push(chunk);
  }
} catch (error) {
  console.error('STREAM ERROR:', error?.message ?? error);
}

const aux = {};
if (process.argv.includes('--aux')) {
  // The exact host-side refresh path (quota + dynamic catalog), same as the
  // profile's scheduled/mount refresh.
  const snapshot = await service.refreshQuotaAndModelsForAccount();
  aux.quotaSnapshotKeys = snapshot ? Object.keys(snapshot) : null;
  aux.models = (await service.adapter.listModels('antigravity')).length;
}

const text = chunks
  .filter((c) => c.type === 'text-delta')
  .map((c) => c.text)
  .join('');
const usageChunk = chunks.find((c) => c.type === 'finish' || c.usage);
const summary = {
  model,
  effort,
  prompt,
  sessionId,
  elapsedMs: Date.now() - started,
  chunkTypes: [...new Set(chunks.map((c) => c.type ?? 'usage'))],
  text,
  usage: usageChunk?.usage ?? usageChunk ?? null,
  aux,
};
console.log(JSON.stringify(summary, null, 2));
