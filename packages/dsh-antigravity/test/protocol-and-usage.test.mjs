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
  assert.ok(ids.includes('gemini-4-hydrogen'));
  assert.ok(ids.includes('gemini-4-argon'));
  assert.ok(ids.includes('gemini-4-carbon'));
  assert.ok(ids.includes('gemini-3.8-flash'));
  assert.ok(!ids.includes('gemini-4-hydrogen-xhigh'));

  const cfg = configMod.normalizeConfig({});
  const catalog = new catalogMod.AntigravityCatalog(cfg);
  catalog.updateDynamicModels([
    { id: 'gemini-4-argon-high', displayName: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-hydrogen-xhigh', displayName: 'Gemini 4 Hydrogen (XHigh)' },
  ]);
  const merged = catalog.mergedCatalog();
  const hydrogen = merged.find((m) => m.id === 'gemini-4-hydrogen');
  const carbon = merged.find((m) => m.id === 'gemini-4-carbon');
  const argon = merged.find((m) => m.id === 'gemini-4-argon');
  const flash = merged.find((m) => m.id === 'gemini-3.8-flash');
  assert.equal(hydrogen?.tierAccess, 'pro');
  assert.equal(hydrogen?.isUpstreamAvailable, true);
  assert.deepEqual(hydrogen?.supportedEfforts, ['xhigh']);
  assert.equal(carbon?.tierAccess, 'ultra');
  assert.equal(argon?.tierAccess, 'pro');
  assert.equal(argon?.isUpstreamAvailable, true);
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

test('quota: parseAvailableModelsResponse prefers readable map keys over MODEL_PLACEHOLDER_*', async () => {
  const quotaMod = await importHostModule('src/host/quota.ts');
  const parsed = quotaMod.parseAvailableModelsResponse({
    models: {
      'gemini-4-hydrogen-high': {
        model: 'MODEL_PLACEHOLDER_M525',
        displayName: 'Gemini 4 Hydrogen (High)',
        supportsThinking: true,
      },
      'gemini-4-hydrogen-xhigh': {
        model: 'MODEL_PLACEHOLDER_M528',
        displayName: 'Gemini 4 Hydrogen (XHigh)',
        supportsThinking: true,
      },
      MODEL_PLACEHOLDER_M670: {
        model: 'MODEL_PLACEHOLDER_M670',
        displayName: 'Gemini 4 Carbon',
        supportsThinking: true,
      },
    },
  });

  assert.deepEqual(
    parsed.map((m) => m.id),
    ['gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh', 'MODEL_PLACEHOLDER_M670'],
  );
  assert.equal(parsed[0].model, 'MODEL_PLACEHOLDER_M525');
  assert.equal(parsed[2].displayName, 'Gemini 4 Carbon');
});

test('catalog: merges Gemini 4 & Claude 5.5 variants, keeps isolated gpt-oss-120b-medium, clamps efforts & migrates models.json', async () => {
  const catalogMod = await importHostModule('src/host/catalog.ts');
  const configMod = await importHostModule('src/host/config.ts');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-antigravity-merge-'));

  try {
    fs.writeFileSync(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({
        version: 1,
        enabledModelIds: [
          'gemini-4-hydrogen-xhigh',
          'gemini-4-hydrogen-high',
          'gemini-4-argon-medium',
          'claude-opus-5-5-high',
        ],
      }),
    );

    const cfg = configMod.normalizeConfig({
      storageDir: tmpDir,
      includeNonGeminiModels: true,
      defaultThinkingEffort: 'auto',
    });
    // Legacy 'auto' migrates cleanly to standard 'high'
    assert.equal(cfg.defaultThinkingEffort, 'high');

    const catalog = new catalogMod.AntigravityCatalog(cfg);
    await catalog.ensureLoaded();

    // Verify models.json was auto-migrated and deduplicated
    assert.deepEqual(catalog.getEnabledModelIds(), [
      'gemini-4-hydrogen',
      'gemini-4-argon',
      'claude-opus-5-5',
    ]);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'),
    );
    assert.deepEqual(persisted.enabledModelIds, [
      'gemini-4-hydrogen',
      'gemini-4-argon',
      'claude-opus-5-5',
    ]);

    await catalog.saveDynamicModels([
      { id: 'gemini-4-hydrogen-low', displayName: 'Gemini 4 Hydrogen (Low)', supportsThinking: true },
      { id: 'gemini-4-hydrogen-medium', displayName: 'Gemini 4 Hydrogen (Medium)', supportsThinking: true },
      { id: 'gemini-4-hydrogen-high', displayName: 'Gemini 4 Hydrogen (High)', supportsThinking: true },
      { id: 'gemini-4-hydrogen-xhigh', displayName: 'Gemini 4 Hydrogen (XHigh)', supportsThinking: true },
      { id: 'claude-opus-5-5-low', displayName: 'Claude Opus 5.5 (Low)', modelProvider: 'Anthropic', supportsThinking: true },
      { id: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5 (Medium)', modelProvider: 'Anthropic', supportsThinking: true },
      { id: 'claude-opus-5-5-high', displayName: 'Claude Opus 5.5 (High)', modelProvider: 'Anthropic', supportsThinking: true },
      { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', modelProvider: 'OpenAI', supportsThinking: true },
      { id: 'MODEL_PLACEHOLDER_M670', displayName: 'Gemini 4 Carbon', supportsThinking: true },
    ]);

    const merged = catalog.mergedCatalog();
    const hydrogen = merged.find((m) => m.id === 'gemini-4-hydrogen');
    const claudeOpus = merged.find((m) => m.id === 'claude-opus-5-5');
    const gptOss = merged.find((m) => m.id === 'gpt-oss-120b-medium');
    const carbon = merged.find((m) => m.id === 'gemini-4-carbon');

    assert.ok(hydrogen);
    assert.deepEqual(hydrogen.supportedEfforts, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(hydrogen.variantIds?.xhigh, 'gemini-4-hydrogen-xhigh');

    assert.ok(claudeOpus);
    assert.equal(claudeOpus.name, 'Claude Opus 5.5');
    assert.deepEqual(claudeOpus.supportedEfforts, ['low', 'medium', 'high']);
    assert.equal(claudeOpus.variantIds?.high, 'claude-opus-5-5-high');

    // Isolated suffixed model is NOT stripped
    assert.ok(gptOss);
    assert.equal(gptOss.id, 'gpt-oss-120b-medium');

    // Placeholder matched to Gemini 4 Carbon routes to MODEL_PLACEHOLDER_M670
    assert.ok(carbon);
    assert.equal(carbon.isUpstreamAvailable, true);
    const carbonDispatch = catalog.resolveUpstreamDispatch('gemini-4-carbon', 'high');
    assert.equal(carbonDispatch.upstreamModel, 'MODEL_PLACEHOLDER_M670');

    // Standard DSH resolveModel contract (no 'auto', exact efforts[], clamped defaultEffort)
    const resolvedHydrogen = catalog.resolveModel('gemini-4-hydrogen');
    assert.deepEqual(
      resolvedHydrogen.reasoning?.efforts.map((e) => e.id),
      ['low', 'medium', 'high', 'xhigh'],
    );
    assert.equal(resolvedHydrogen.reasoning?.defaultEffort, 'high');

    const resolvedClaude = catalog.resolveModel('claude-opus-5-5');
    assert.deepEqual(
      resolvedClaude.reasoning?.efforts.map((e) => e.id),
      ['low', 'medium', 'high'],
    );
    assert.equal(resolvedClaude.reasoning?.defaultEffort, 'high');

    // Legacy variant ID resolves cleanly and keeps legacy effort as default
    const resolvedLegacy = catalog.resolveModel('gemini-4-hydrogen-xhigh');
    assert.equal(resolvedLegacy.id, 'gemini-4-hydrogen');
    assert.equal(resolvedLegacy.reasoning?.defaultEffort, 'xhigh');

    // Dispatch resolution & fallback order
    const dispatchXhigh = catalog.resolveUpstreamDispatch('gemini-4-hydrogen', 'xhigh');
    assert.equal(dispatchXhigh.upstreamModel, 'gemini-4-hydrogen-xhigh');
    assert.equal(dispatchXhigh.effectiveEffort, 'xhigh');
    assert.deepEqual(dispatchXhigh.fallbackUpstreamModels, [
      'gemini-4-hydrogen-high',
      'gemini-4-hydrogen-medium',
      'gemini-4-hydrogen-low',
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('translate: routes (familyModel, reasoningEffort) to exact upstream variant ID & thinkingConfig including xhigh and legacy sessions', async () => {
  const translateMod = await importHostModule('src/host/translate.ts');

  const baseInput = {
    accountId: 'acc-1',
    accountEmail: 'user@example.com',
    projectId: 'proj-1',
    nowMs: 1_700_000_000_000,
    trajectoryId: '11111111-1111-4111-8111-111111111111',
  };

  // 1. Merged family + xhigh
  const resXhigh = translateMod.buildAntigravityRequest({
    ...baseInput,
    options: {
      model: 'gemini-4-hydrogen',
      reasoningEffort: 'xhigh',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  });
  assert.equal(resXhigh.canonicalModel, 'gemini-4-hydrogen');
  assert.equal(resXhigh.upstreamModel, 'gemini-4-hydrogen-xhigh');
  assert.equal(resXhigh.envelope.model, 'gemini-4-hydrogen-xhigh');
  assert.deepEqual(resXhigh.envelope.request.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'XHIGH',
  });

  // 2. Legacy suffixed session without explicit reasoningEffort preserves xhigh
  const resLegacy = translateMod.buildAntigravityRequest({
    ...baseInput,
    options: {
      model: 'gemini-4-hydrogen-xhigh',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  });
  assert.equal(resLegacy.envelope.model, 'gemini-4-hydrogen-xhigh');
  assert.deepEqual(resLegacy.envelope.request.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'XHIGH',
  });

  // 3. Explicit reasoningEffort overrides legacy suffix
  const resLegacyOverride = translateMod.buildAntigravityRequest({
    ...baseInput,
    options: {
      model: 'gemini-4-hydrogen-xhigh',
      reasoningEffort: 'low',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  });
  assert.equal(resLegacyOverride.envelope.model, 'gemini-4-hydrogen-low');
  assert.deepEqual(resLegacyOverride.envelope.request.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'LOW',
  });

  // 4. Claude family dispatched via upstreamModel sets claude labels properly
  const resClaude = translateMod.buildAntigravityRequest({
    ...baseInput,
    upstreamModel: 'claude-opus-5-5-high',
    effectiveEffort: 'high',
    options: {
      model: 'claude-opus-5-5',
      reasoningEffort: 'high',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  });
  assert.equal(resClaude.envelope.model, 'claude-opus-5-5-high');
  assert.equal(resClaude.envelope.request.labels.used_claude, 'true');
  assert.equal(resClaude.envelope.request.labels.used_non_gemini_model, 'true');
});

test('adapter: resolveImages passes positive integer width/height/maxBytes to readImageRequest and translates inlineData', async () => {
  const adapterMod = await importHostModule('src/host/adapter.ts');
  const configMod = await importHostModule('src/host/config.ts');
  const translateMod = await importHostModule('src/host/translate.ts');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-antigravity-img-'));

  try {
    const capturedTargets = [];
    const cfg = configMod.normalizeConfig({
      storageDir: tmpDir,
      requestImagePixelBudget: 1_000_000,
      requestImageMaxBytes: 2_000_000,
    });
    const service = new adapterMod.AntigravityService(cfg, {
      resolveAttachments: () => ({
        readImageRequest: async (ref, target) => {
          capturedTargets.push({ ref, target });
          return {
            data: new Uint8Array([137, 80, 78, 71]),
            mediaType: 'image/png',
            width: target.width,
            height: target.height,
          };
        },
      }),
    });

    const options = {
      model: 'gemini-4-hydrogen',
      reasoningEffort: 'high',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            {
              type: 'image',
              attachment: {
                attachmentId: 'att-large',
                mediaType: 'image/png',
                width: 4000,
                height: 2000,
                size: 1000,
              },
            },
            {
              type: 'image',
              attachment: {
                attachmentId: 'att-zero',
                mediaType: 'image/jpeg',
                width: 0,
                height: 120.7,
                size: 500,
              },
            },
          ],
        },
      ],
    };

    const images = await service.resolveImages(options);
    assert.equal(capturedTargets.length, 2);

    // Oversized image scaled down to positive integer dimensions within pixel budget
    const largeTarget = capturedTargets[0].target;
    assert.equal(Number.isSafeInteger(largeTarget.width) && largeTarget.width > 0, true);
    assert.equal(Number.isSafeInteger(largeTarget.height) && largeTarget.height > 0, true);
    assert.equal(Number.isSafeInteger(largeTarget.maxBytes) && largeTarget.maxBytes === 2_000_000, true);
    assert.equal(largeTarget.maxWidth, undefined);
    assert.equal(largeTarget.maxHeight, undefined);
    assert.ok(largeTarget.width * largeTarget.height <= 1_000_000);

    // Zero / float dimensions safely coerced to positive integers
    const zeroTarget = capturedTargets[1].target;
    assert.deepEqual(zeroTarget, { width: 1, height: 120, maxBytes: 2_000_000 });

    const built = translateMod.buildAntigravityRequest({
      options,
      images,
      accountId: 'acc-1',
      projectId: 'proj-1',
      nowMs: 1_700_000_000_000,
      trajectoryId: '11111111-1111-4111-8111-111111111111',
    });
    const parts = built.envelope.request.contents[0].parts;
    assert.ok(parts.some((p) => p.inlineData?.mimeType === 'image/png' && p.inlineData?.data === 'iVBORw=='));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('adapter: cools down endpoint and retries next endpoint on in-band SSE 503 before output', async () => {
  const adapterMod = await importHostModule('src/host/adapter.ts');
  const configMod = await importHostModule('src/host/config.ts');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-antigravity-sse503-'));

  const originalFetch = globalThis.fetch;
  try {
    const cfg = configMod.normalizeConfig({
      storageDir: tmpDir,
      endpoints: [
        'https://daily-cloudcode-pa.googleapis.com',
        'https://cloudcode-pa.googleapis.com',
      ],
    });
    const service = new adapterMod.AntigravityService(cfg);
    await service.accounts.upsertAccountFromOAuth({
      email: 'test@example.com',
      accessToken: 'tok-valid',
      refreshToken: 'ref-valid',
      expiresAt: Date.now() + 3_600_000,
      projectId: 'proj-1',
    });

    const calledUrls = [];
    const sseEncode = (obj) =>
      new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      calledUrls.push(urlStr);
      if (urlStr.includes('writeTrajectoryAcls')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.startsWith('https://daily-cloudcode-pa.googleapis.com')) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(
              sseEncode({
                error: {
                  code: 503,
                  message:
                    'upstream stream ended before a completion event; this turn may be incomplete',
                },
              }),
            );
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const okBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            sseEncode({
              response: {
                candidates: [
                  {
                    content: { parts: [{ text: 'recovered on prod' }] },
                    finishReason: 'STOP',
                  },
                ],
              },
            }),
          );
          controller.close();
        },
      });
      return new Response(okBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const chunks = [];
    for await (const ch of service.adapter.stream({
      model: 'gemini-4-hydrogen',
      reasoningEffort: 'high',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })) {
      chunks.push(ch);
    }

    const streamCalls = calledUrls.filter((u) => u.includes('streamGenerateContent'));
    assert.equal(streamCalls.length, 3);
    assert.ok(streamCalls[0].startsWith('https://daily-cloudcode-pa.googleapis.com'));
    assert.ok(streamCalls[1].startsWith('https://daily-cloudcode-pa.googleapis.com'));
    assert.ok(streamCalls[2].startsWith('https://cloudcode-pa.googleapis.com'));
    assert.ok(chunks.some((c) => c.type === 'text-delta' && c.text === 'recovered on prod'));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
