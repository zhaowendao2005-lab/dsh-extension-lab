import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { importDshLlm, importHostModule, pkgRoot } from './helpers/load-host.mjs';

const identity = await importHostModule('src/host/identity.ts');
const usageMod = await importHostModule('src/host/usage.ts');
const clientMod = await importHostModule('src/host/client.ts');
const dshLlm = await importDshLlm();

test('identity: Hub User-Agent defaults to active host platform, sanitization, and legacy floor', () => {
  const hostTags = identity.resolveHostPlatformTags();
  const defaultUa = identity.buildHubUserAgent();
  assert.equal(
    defaultUa,
    `antigravity/hub/2.28.0 (aidev_client; os_type=${hostTags.osType}; arch=${hostTags.arch}; cl=1008300195)`,
  );
  assert.deepEqual(identity.resolveHostPlatformTags('darwin', 'arm64'), {
    osType: 'darwin',
    arch: 'arm64',
  });
  assert.deepEqual(identity.resolveHostPlatformTags('win32', 'x64'), {
    osType: 'windows',
    arch: 'amd64',
  });
  assert.equal(
    identity.buildHubUserAgent({ osType: 'windows', arch: 'amd64' }),
    'antigravity/hub/2.28.0 (aidev_client; os_type=windows; arch=amd64; cl=1008300195)',
  );

  // Preserve custom Hub UA while stripping control characters
  assert.equal(
    identity.sanitizeUserAgent('antigravity/hub/2.29.0 (aidev_client; os_type=darwin)\n'),
    'antigravity/hub/2.29.0 (aidev_client; os_type=darwin)',
  );

  // Non-antigravity strings (e.g. DSH attribution) fallback cleanly to official Hub UA
  assert.equal(identity.sanitizeUserAgent('deepseek-harness/1.0'), defaultUa);
  assert.equal(identity.sanitizeUserAgent(''), defaultUa);

  // Legacy antigravity/X.Y.Z versions below 4.3.0 clamp up to 4.3.0
  assert.equal(identity.sanitizeUserAgent('antigravity/3.9.2 (foo)'), 'antigravity/4.3.0 (foo)');
  assert.equal(identity.sanitizeUserAgent('antigravity/4.5.1 (bar)'), 'antigravity/4.5.1 (bar)');
});

test('identity: buildOutboundHeaders strips conflicting & DSH attribution headers', () => {
  const internalSummary = identity.getInternalAttributionSummary();
  assert.ok(internalSummary['user-agent']?.includes('deepseek-harness'));

  const contentHeaders = identity.buildOutboundHeaders({
    accessToken: 'ya29.test-token',
    projectId: 'proj-123',
    isContentRequest: true,
    extraHeaders: {
      'User-Agent': internalSummary['user-agent'],
      'accept-encoding': 'identity',
      'x-goog-api-client': 'gl-node/22',
      'x-client-name': 'dsh',
      'x-session-id': 'abc',
      'x-machine-id': 'mach',
      'x-jeikcode-trace': 'leak',
      'X-Custom-Allowed': 'ok',
    },
  });

  assert.equal(contentHeaders['Authorization'], 'Bearer ya29.test-token');
  assert.equal(contentHeaders['Content-Type'], 'application/json');
  assert.equal(contentHeaders['Accept-Encoding'], 'gzip');
  assert.equal(contentHeaders['accept-encoding'], undefined);
  assert.equal(contentHeaders['User-Agent'], identity.DEFAULT_HUB_USER_AGENT);
  assert.equal(contentHeaders['x-goog-user-project'], undefined);
  assert.equal(contentHeaders['x-goog-api-client'], undefined);
  assert.equal(contentHeaders['x-client-name'], undefined);
  assert.equal(contentHeaders['x-session-id'], undefined);
  assert.equal(contentHeaders['x-machine-id'], undefined);
  assert.equal(contentHeaders['x-jeikcode-trace'], undefined);
  assert.equal(contentHeaders['X-Custom-Allowed'], 'ok');

  // Non-content requests MUST attach x-goog-user-project when projectId exists
  const metadataHeaders = identity.buildOutboundHeaders({
    accessToken: 'ya29.test-token',
    projectId: 'proj-123',
    isContentRequest: false,
  });
  assert.equal(metadataHeaders['x-goog-user-project'], 'proj-123');
});

test('identity: 64-bit signed FNV-1a sessionId, requestId, and workspace fingerprint', () => {
  const s0a = identity.deriveUpstreamSessionId('acc-1', 'sess-xyz', 0);
  const s0b = identity.deriveUpstreamSessionId('acc-1', 'sess-xyz', 0);
  const s1 = identity.deriveUpstreamSessionId('acc-1', 'sess-xyz', 1);
  const sOther = identity.deriveUpstreamSessionId('acc-2', 'sess-xyz', 0);

  assert.equal(s0a, s0b);
  assert.notEqual(s0a, s1);
  assert.notEqual(s0a, sOther);
  assert.match(s0a, /^-?\d+$/);

  const reqId = identity.buildOfficialRequestId('sess-xyz', 4);
  assert.match(reqId, /^agent\/[0-9a-f]{16}\/\d+\/[0-9a-f]{8}\/4$/);
  assert.equal(identity.extractTrajectoryId(reqId).length, 8);

  assert.deepEqual(identity.resolveOfficialFingerprint('user@gmail.com'), {
    envelopeUserAgent: 'antigravity',
    ideType: 'ANTIGRAVITY',
  });
  assert.deepEqual(identity.resolveOfficialFingerprint('dev@acme-corp.com'), {
    envelopeUserAgent: 'jetski',
    ideType: 'JETSKI',
  });
});

test('usage: disjoint mapUsage & incremental SSE mergeUsageMetadata invariant', () => {
  const merged = usageMod.mergeUsageMetadata(
    { promptTokenCount: 1000, cachedContentTokenCount: 600 },
    { candidatesTokenCount: 80, thoughtsTokenCount: 120, toolUsePromptTokenCount: 200 },
  );
  const mapped = usageMod.mapUsage(merged);

  // prompt = 1000 + 200 = 1200; cached = 600 => uncached input = 600
  // output = 80 + 120 = 200 (reasoning = 120)
  // total = 600 + 600 + 200 = 1400 (no cacheWriteTokens fabricated)
  assert.equal(mapped.inputTokens, 600);
  assert.equal(mapped.cacheReadTokens, 600);
  assert.equal(mapped.outputTokens, 200);
  assert.equal(mapped.reasoningTokens, 120);
  assert.equal(mapped.totalTokens, 1400);
  assert.equal(mapped.cacheWriteTokens, undefined);

  // When cacheRead is 0, cacheReadTokens stays explicit 0 (not undefined)
  const uncachedOnly = usageMod.mapUsage({ promptTokenCount: 50, candidatesTokenCount: 10 });
  assert.deepEqual(uncachedOnly, {
    inputTokens: 50,
    outputTokens: 10,
    totalTokens: 60,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  });

  const tracker = new usageMod.CacheTelemetryTracker();
  tracker.record({ model: 'gemini-3-flash', accountEmail: 'a@gmail.com', usage: mapped });
  const summary = tracker.summary();
  assert.equal(summary.turnCount, 1);
  assert.equal(summary.aggregateCacheHitRate, 0.5);
});

test('client: endpoint fallback policy, duration parsing, and error classification', () => {
  assert.equal(clientMod.shouldTryNextEndpoint(503, 'https://daily-cloudcode-pa.googleapis.com'), true);
  assert.equal(clientMod.shouldTryNextEndpoint(404, 'https://daily-cloudcode-pa.googleapis.com'), true);
  assert.equal(clientMod.shouldTryNextEndpoint(408, 'https://daily-cloudcode-pa.googleapis.com'), true);
  assert.equal(clientMod.shouldTryNextEndpoint(400, 'https://daily-cloudcode-pa.sandbox.googleapis.com'), true);
  assert.equal(clientMod.shouldTryNextEndpoint(400, 'https://daily-cloudcode-pa.googleapis.com'), false);
  assert.equal(clientMod.shouldTryNextEndpoint(429, 'https://daily-cloudcode-pa.googleapis.com'), false);
  assert.equal(clientMod.shouldTryNextEndpoint(401, 'https://cloudcode-pa.googleapis.com'), false);

  assert.equal(clientMod.parseDurationMs('1h2m3s'), 3_723_000);
  assert.equal(clientMod.parseRetryDelayMs(JSON.stringify({ details: [{ retryDelay: '12.5s' }] })), 12_700);
  assert.equal(clientMod.parseRetryDelayMs('Your quota will reset after 2m30s please wait'), 151_000);

  const authErr = clientMod.classifyUpstreamHttpError(401, '{"error":{"message":"UNAUTHENTICATED"}}');
  assert.equal(authErr.code, 'AUTH');
  assert.equal(authErr.category, 'AUTH');

  const rateLimit = clientMod.classifyUpstreamHttpError(429, '{"error":{"message":"rate limit"}}', '3');
  assert.equal(rateLimit.code, 'RATE_LIMIT');
  assert.equal(rateLimit.category, 'RATE_LIMIT');
  assert.equal(rateLimit.retryAfterMs, 3200);

  const quotaErr = clientMod.classifyUpstreamHttpError(
    429,
    '{"error":{"message":"RESOURCE_EXHAUSTED: quota_exhausted for model"}}',
  );
  assert.equal(quotaErr.code, 'QUOTA');
  assert.equal(quotaErr.category, 'QUOTA');

  const oneMErr = clientMod.classifyUpstreamHttpError(
    400,
    '{"error":{"message":"Input token count exceeds the maximum number of tokens allowed 1048576"}}',
  );
  assert.equal(oneMErr.code, dshLlm.CONTEXT_WINDOW_EXCEEDED_CODE);
  assert.equal(oneMErr.isOneMillionContextError, true);

  const sigErr = clientMod.classifyUpstreamHttpError(
    400,
    '{"error":{"message":"Invalid thoughtSignature on functionCall part"}}',
  );
  assert.equal(sigErr.code, 'INVALID_REQUEST');
  assert.equal(sigErr.isSignatureError, true);
});

test('build artifacts: generated lib/index.js & lib/client.js register cleanly in VM', () => {
  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.dsh?.client?.inject));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));

  const libIndex = readFileSync(path.join(pkgRoot, 'lib', 'index.js'), 'utf8');
  assert.ok(libIndex.includes('antigravity/hub/'));
  assert.ok(libIndex.includes('export {\n  Config,\n  apply,'));
  assert.ok(!libIndex.includes('as default'), 'Host entry must not export default apply without inject/Config');

  const en = JSON.parse(readFileSync(path.join(pkgRoot, 'locale', 'en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(path.join(pkgRoot, 'locale', 'zh-CN.json'), 'utf8'));
  assert.ok(en.antigravity?.sectionTitle);
  assert.ok(zh.antigravity?.sectionTitle);

  const clientCode = readFileSync(path.join(pkgRoot, 'lib', 'client.js'), 'utf8');
  let registeredPlugin = null;
  const appendedStyles = [];
  const fakeWindow = {
    __ModuleLoader__: {
      load(mod) {
        registeredPlugin = mod;
      },
    },
  };
  const fakeDocument = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head: {
      appendChild(el) {
        appendedStyles.push(el);
      },
    },
  };
  runInNewContext(clientCode, { window: fakeWindow, document: fakeDocument });
  assert.ok(registeredPlugin);
  assert.equal(registeredPlugin.id, 'dsh-antigravity');

  const pluginDef = registeredPlugin.factory(() => ({
    createElement: () => ({}),
    Fragment: Symbol('Fragment'),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }));
  assert.equal(pluginDef.name, 'dsh-antigravity');
  assert.deepEqual([...pluginDef.inject], ['slots', 'locale']);

  const slots = [];
  const locales = {};
  const disposers = [];
  pluginDef.apply({
    effect(fn) {
      const c = fn();
      if (typeof c === 'function') disposers.push(c);
    },
    locale: {
      register(ns, map) {
        locales[ns] = map;
      },
    },
    slots: {
      inject: (_name, fn) => fn(),
      register(meta) {
        slots.push(meta);
        return () => {};
      },
    },
  });

  assert.equal(appendedStyles.length, 1);
  assert.equal(appendedStyles[0].dataset.plugin, 'dsh-antigravity');
  assert.ok(locales.antigravity?.en && locales.antigravity?.['zh-CN']);
  assert.ok(slots.some((s) => s.name === 'settings.section' && s.id === 'antigravity'));
  assert.ok(slots.some((s) => s.name === 'settings.section.icon' && s.id === 'antigravity'));
  for (const d of disposers) d();
});

test('identity: omits x-goog-user-project for consumer sentinel project aicode-consumers', () => {
  const consumerHeaders = identity.buildOutboundHeaders({
    accessToken: 'tok-consumer',
    projectId: 'aicode-consumers',
    isContentRequest: false,
  });
  assert.equal(consumerHeaders['x-goog-user-project'], undefined);

  const customHeaders = identity.buildOutboundHeaders({
    accessToken: 'tok-custom',
    projectId: 'my-gcp-project-42',
    isContentRequest: false,
  });
  assert.equal(customHeaders['x-goog-user-project'], 'my-gcp-project-42');
});

test('catalog & quota: Gemini 4 series included with Pro/Ultra tier tags and nested summary groups parsed', async () => {
  const catalogMod = await importHostModule('src/host/catalog.ts');
  const quotaMod = await importHostModule('src/host/quota.ts');
  const configMod = await importHostModule('src/host/config.ts');

  const ids = catalogMod.STATIC_GEMINI_MODELS.map((m) => m.id);
  assert.ok(ids.includes('gemini-4-hydrogen-xhigh'));
  assert.ok(ids.includes('gemini-4-hydrogen-high'));
  assert.ok(ids.includes('gemini-4-argon-high'));
  assert.ok(ids.includes('gemini-4-carbon-high'));
  assert.ok(ids.includes('gemini-3.8-flash-high'));

  const cfg = configMod.normalizeConfig({});
  const catalog = new catalogMod.AntigravityCatalog(cfg);
  catalog.updateDynamicModels([
    { id: 'gemini-4-argon-high', displayName: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-hydrogen-xhigh', displayName: 'Gemini 4 Hydrogen (XHigh)' },
  ]);
  const merged = catalog.mergedCatalog();
  const xhigh = merged.find((m) => m.id === 'gemini-4-hydrogen-xhigh');
  const carbonHigh = merged.find((m) => m.id === 'gemini-4-carbon-high');
  const argonHigh = merged.find((m) => m.id === 'gemini-4-argon-high');
  const flash = merged.find((m) => m.id === 'gemini-3.8-flash-high');
  assert.equal(xhigh?.tierAccess, 'pro');
  assert.equal(xhigh?.isUpstreamAvailable, true);
  assert.equal(carbonHigh?.tierAccess, 'ultra');
  assert.equal(argonHigh?.tierAccess, 'pro');
  assert.equal(argonHigh?.isUpstreamAvailable, true);
  assert.equal(flash?.tierAccess, 'all');
  assert.equal(flash?.isUpstreamAvailable, false);

  const groups = quotaMod.buildQuotaGroups({
    models: [],
    summaryRaw: {
      groups: [
        {
          displayName: 'Gemini',
          buckets: [
            { bucketId: '5h', displayName: '5 小时', remainingFraction: 0.99, resetTime: '2026-11-13T21:00:00Z' },
            { bucketId: 'weekly', displayName: '每周', remainingFraction: 0.84, resetTime: '2026-11-20T02:02:30Z' },
          ],
        },
        {
          displayName: 'Argon',
          buckets: [
            { bucketId: 'weekly', displayName: '每周', remainingFraction: 0.98 },
          ],
        },
      ],
    },
    config: cfg,
  });
  assert.equal(groups.length, 3);
  assert.equal(groups[0].label, 'Gemini 5 小时');
  assert.equal(groups[0].windowType, 'daily');
  assert.equal(groups[0].remainingFraction, 0.99);
  assert.equal(groups[1].label, 'Gemini 每周');
  assert.equal(groups[1].windowType, 'weekly');
  assert.equal(groups[1].remainingFraction, 0.84);
  assert.equal(groups[2].label, 'Argon 每周');
  assert.equal(groups[2].windowType, 'weekly');
  assert.equal(groups[2].remainingFraction, 0.98);

  // Enum key normalization & deduplication (MODEL_GOOGLE_* -> canonical gemini-*).
  const parsedModels = quotaMod.parseAvailableModelsResponse({
    models: {
      MODEL_GOOGLE_GEMINI_2_5_FLASH: { displayName: 'Gemini 2.5 Flash' },
      MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING: { displayName: 'Gemini 2.5 Flash' },
      MODEL_GOOGLE_GEMINI_2_5_PRO: { displayName: 'Gemini 2.5 Pro' },
    },
  });
  assert.deepEqual(
    parsedModels.map((m) => m.id),
    ['gemini-2.5-flash', 'gemini-2.5-pro'],
  );

  // Generalized Gemini 3+/4+/5+ detection without hardcoding future codenames.
  assert.equal(catalogMod.isGemini3SeriesModel('gemini-5-neon-high'), true);
  assert.equal(catalogMod.isGemini3SeriesModel('gemini-2.5-pro'), false);

  // Upstream catalog persistence across restarts (catalog-cache.json).
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-antigravity-cat-'));
  try {
    const tmpCfg = configMod.normalizeConfig({ storageDir: tmpDir });
    const c1 = new catalogMod.AntigravityCatalog(tmpCfg);
    await c1.saveDynamicModels([
      { id: 'gemini-5-preview-high', displayName: 'Gemini 5 Preview (High)', maxTokens: 2_000_000 },
    ]);
    const c2 = new catalogMod.AntigravityCatalog(tmpCfg);
    await c2.ensureLoaded();
    const reloaded = c2.mergedCatalog();
    assert.equal(reloaded[0]?.id, 'gemini-5-preview-high');
    assert.equal(reloaded[0]?.isUpstreamAvailable, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
