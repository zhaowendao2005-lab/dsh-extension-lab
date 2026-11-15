import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { importHostModule, importDshLlm, pkgRoot } from './helpers/load-host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(pkgRoot, 'test', 'fixtures', 'protocol');

async function makeTempDir(t, prefix = 'dsh-antigravity-rem-') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function readFixtureJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('Phase 0: sanitized protocol fixtures contain zero PII, secrets, or personal paths', async () => {
  const files = await fsp.readdir(fixtureDir);
  assert.ok(files.includes('baseline-metadata.json'));
  assert.ok(files.includes('load-code-assist.sanitized.json'));
  assert.ok(files.includes('available-models.sanitized.json'));
  assert.ok(files.includes('stream-generate-content.sanitized.json'));
  assert.ok(files.includes('error-responses.sanitized.json'));

  const forbiddenPatterns = [
    /ya29\.[A-Za-z0-9._-]+/,
    /1\/\/[A-Za-z0-9._-]+/,
    /Bearer\s+[A-Za-z0-9._-]{12,}/i,
    /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|outlook|icloud|yahoo)\.[a-z]+/i,
    /\/Users\/[A-Za-z0-9._-]+/,
  ];

  for (const file of files) {
    const raw = await fsp.readFile(path.join(fixtureDir, file), 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed && typeof parsed === 'object', `${file} must be valid JSON`);
    for (const re of forbiddenPatterns) {
      assert.equal(
        re.test(raw),
        false,
        `${file} must not match sensitive pattern ${re}`,
      );
    }
  }
});

test('Phase 5.1: single-variable request variants isolate exact RFC 6901 JSON Pointer diffs', async () => {
  const { buildRequestVariants, summarizeVariantMatrix } = await importHostModule(
    'src/host/variants.ts',
  );

  const baseInput = {
    accountId: 'acc-var-1',
    accountEmail: 'tester@example.com',
    projectId: 'proj-var-1',
    sessionGeneration: 0,
    defaultThinkingEffort: 'high',
    options: {
      model: 'gemini-4-hydrogen',
      sessionId: 'sess-var-1',
      system: 'You are concise.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Inspect variant wiring.' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Checking step' },
            { type: 'tool-call', id: 'tc_1', name: 'read', arguments: '{"path":"a.ts"}' },
          ],
          source: {
            replayState: {
              provider: 'antigravity',
              model: 'gemini-4-hydrogen',
              blocks: [
                { index: 0, type: 'reasoning', thoughtSignature: 'c2lnLWE=' },
                { index: 1, type: 'tool-call', thoughtSignature: 'c2lnLWI=' },
              ],
            },
          },
        },
        {
          role: 'tool',
          toolCallId: 'tc_1',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        },
      ],
      tools: [
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    },
  };

  const variants = buildRequestVariants(baseInput);
  assert.deepEqual(variants.baseline.diffsFromBaseline, []);
  assert.deepEqual(variants.server_default.diffsFromBaseline, []);

  assert.deepEqual(
    variants.credit_only.diffsFromBaseline.map((d) => d.pointer),
    ['/enabledCreditTypes'],
  );
  assert.equal(variants.credit_only.diffsFromBaseline[0].kind, 'added');
  assert.deepEqual(variants.credit_only.diffsFromBaseline[0].right, ['GOOGLE_ONE_AI']);

  assert.deepEqual(
    variants.output_only_65536.diffsFromBaseline.map((d) => d.pointer),
    ['/request/generationConfig/maxOutputTokens'],
  );
  assert.equal(variants.output_only_65536.diffsFromBaseline[0].kind, 'added');
  assert.equal(variants.output_only_65536.diffsFromBaseline[0].right, 65536);

  const bothPointers = variants.both.diffsFromBaseline.map((d) => d.pointer).sort();
  assert.deepEqual(bothPointers, [
    '/enabledCreditTypes',
    '/request/generationConfig/maxOutputTokens',
  ]);
  assert.equal(variants.baseline.requestId, variants.both.requestId);
  assert.notEqual(variants.baseline.payloadSha256, variants.credit_only.payloadSha256);
  assert.notEqual(variants.baseline.payloadSha256, variants.output_only_65536.payloadSha256);
  assert.equal(variants.baseline.payloadSha256, variants.server_default.payloadSha256);

  const matrix = summarizeVariantMatrix(variants);
  assert.equal(matrix.length, 5);
});

test('Phase 2: JsonlDiagnosticSink enforces 0o700/0o600 permissions, zero secret leaks, rotation, TTL, symlink guard & clear', async (t) => {
  const { JsonlDiagnosticSink, sanitizeErrorDetailText } = await importHostModule(
    'src/host/diagnostics.ts',
  );
  const { configMod } = { configMod: await importHostModule('src/host/config.ts') };
  const dir = path.join(await makeTempDir(t, 'dsh-diag-'), 'diagnostics');

  const sink = new JsonlDiagnosticSink({
    diagnosticDir: dir,
    mode: 'metadata',
    retainDays: 7,
    maxFileBytes: 1200,
    maxFiles: 3,
  });

  const sink2 = new JsonlDiagnosticSink({
    diagnosticDir: dir,
    mode: 'metadata',
    retainDays: 7,
  });

  // Verify scrub helper strips tokens & emails
  const scrubbed = sanitizeErrorDetailText(
    'Failed with Bearer ya29.a0AbCdEfGhIjKlMnOp and sk-abc123456789012345 for alice@gmail.com',
  );
  assert.equal(scrubbed.includes('ya29.'), false);
  assert.equal(scrubbed.includes('sk-abc'), false);
  assert.equal(scrubbed.includes('alice@gmail.com'), false);

  const recA = sink.buildSanitizedRecord({
    requestId: 'req-1',
    sessionId: 'sess-secret-1',
    source: 'agent-loop',
    method: 'streamGenerateContent',
    attempt: 1,
    endpoint: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?key=secret',
    accountIdHash: 'acct-uuid-1',
    headers: {
      Authorization: 'Bearer ya29.super_secret_token_xyz',
      'User-Agent': 'antigravity/hub/2.28.0',
      'Content-Type': 'application/json',
    },
    body: {
      project: 'p1',
      requestId: 'req-1',
      request: {
        contents: [
          { role: 'user', parts: [{ text: 'SECRET_PROMPT_SHOULD_NEVER_HIT_DISK' }] },
        ],
        systemInstruction: { role: 'user', parts: [{ text: 'SECRET_SYSTEM_PROMPT' }] },
        tools: [
          {
            functionDeclarations: [
              { name: 'bash', parameters: { properties: { command: 'SECRET_ARG' } } },
            ],
          },
        ],
        labels: { trajectory_id: 'abc' },
        generationConfig: { maxOutputTokens: 65536 },
        sessionId: 'u-1',
      },
      model: 'gemini-4-hydrogen',
      userAgent: 'antigravity',
      enabledCreditTypes: ['GOOGLE_ONE_AI'],
    },
    byteLength: 420,
    httpStatus: 429,
    classifiedCode: 'QUOTA',
    classifiedSubType: 'resource_exhausted_unknown',
    errorDetailSummary: 'Resource exhausted ya29.another_leak alice@gmail.com',
    durationMs: 25,
  });

  // Per-process ephemeral HMAC matches within sink and differs across processes/sinks
  const recA2 = sink.buildSanitizedRecord({
    requestId: 'req-2',
    sessionId: 'sess-secret-1',
    source: 'agent-loop',
    method: 'streamGenerateContent',
    attempt: 1,
    endpoint: 'https://daily-cloudcode-pa.googleapis.com',
    accountIdHash: 'acct-uuid-1',
  });
  const recB = sink2.buildSanitizedRecord({
    requestId: 'req-1',
    sessionId: 'sess-secret-1',
    source: 'agent-loop',
    method: 'streamGenerateContent',
    attempt: 1,
    endpoint: 'https://daily-cloudcode-pa.googleapis.com',
    accountIdHash: 'acct-uuid-1',
  });
  assert.equal(recA.accountHash, recA2.accountHash);
  assert.equal(recA.sessionHash, recA2.sessionHash);
  assert.notEqual(recA.accountHash, recB.accountHash);
  assert.equal(recA.endpointOrigin, 'https://daily-cloudcode-pa.googleapis.com');

  // Persist enough records to trigger rotation
  for (let i = 0; i < 6; i++) {
    sink.record({
      requestId: `req-rot-${i}`,
      sessionId: 'sess-secret-1',
      source: 'direct-adapter',
      method: 'streamGenerateContent',
      attempt: 1,
      endpoint: 'https://daily-cloudcode-pa.googleapis.com',
      accountIdHash: 'acct-uuid-1',
      headers: { Authorization: 'Bearer ya29.super_secret_token_xyz', 'User-Agent': 'antigravity/hub/2.28.0' },
      body: {
        project: 'p1',
        requestId: `req-rot-${i}`,
        request: {
          contents: [{ role: 'user', parts: [{ text: 'SECRET_PROMPT_SHOULD_NEVER_HIT_DISK' }] }],
          generationConfig: { maxOutputTokens: 65536 },
        },
        model: 'gemini-4-hydrogen',
        userAgent: 'antigravity',
        enabledCreditTypes: ['GOOGLE_ONE_AI'],
      },
      httpStatus: 200,
    });
  }
  await sink.flush();

  const dirMode = (await fsp.stat(dir)).mode & 0o777;
  assert.equal(dirMode, 0o700);
  const files = await fsp.readdir(dir);
  assert.ok(files.some((f) => f === 'protocol-trace.jsonl'));
  assert.ok(files.length >= 2 && files.length <= 3, `expected rotation bounded <=3 files, got ${files.join(', ')}`);

  for (const name of files) {
    const full = path.join(dir, name);
    const st = await fsp.stat(full);
    assert.equal(st.mode & 0o777, 0o600);
    const raw = await fsp.readFile(full, 'utf8');
    assert.equal(raw.includes('SECRET_PROMPT'), false);
    assert.equal(raw.includes('SECRET_SYSTEM_PROMPT'), false);
    assert.equal(raw.includes('SECRET_ARG'), false);
    assert.equal(raw.includes('ya29.'), false);
    assert.equal(raw.includes('sess-secret-1'), false);
    assert.equal(raw.includes('acct-uuid-1'), false);
  }

  // Test TTL pruning on old rotated file
  const expiredRotated = path.join(dir, 'protocol-trace.jsonl.99');
  await fsp.writeFile(expiredRotated, '{"schemaVersion":1}\n', { mode: 0o600 });
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await fsp.utimes(expiredRotated, tenDaysAgo, tenDaysAgo);
  sink.record({
    requestId: 'req-after-ttl',
    source: 'aux',
    method: 'countTokens',
    attempt: 1,
    endpoint: 'https://daily-cloudcode-pa.googleapis.com',
  });
  await sink.flush();
  assert.equal(fs.existsSync(expiredRotated), false);

  const summaryBeforeClear = await sink.summarize();
  assert.equal(summaryBeforeClear.mode, 'metadata');
  assert.ok(summaryBeforeClear.recordCount > 0);
  assert.equal(summaryBeforeClear.writable, true);

  await sink.clear();
  const summaryAfterClear = await sink.summarize();
  assert.equal(summaryAfterClear.recordCount, 0);
  assert.equal(summaryAfterClear.fileBytes, 0);
  await sink.dispose();

  // Verify symlink target rejection
  const symDir = await makeTempDir(t, 'dsh-diag-sym-');
  const targetOutside = path.join(symDir, 'outside.jsonl');
  await fsp.writeFile(targetOutside, '', { mode: 0o600 });
  const diagSub = path.join(symDir, 'diag');
  await fsp.mkdir(diagSub, { mode: 0o700 });
  await fsp.symlink(targetOutside, path.join(diagSub, 'protocol-trace.jsonl'));

  const symSink = new JsonlDiagnosticSink({
    diagnosticDir: diagSub,
    mode: 'metadata',
  });
  symSink.record({
    requestId: 'req-sym',
    source: 'aux',
    method: 'countTokens',
    attempt: 1,
    endpoint: 'https://daily-cloudcode-pa.googleapis.com',
  });
  await symSink.flush();
  const symSummary = await symSink.summarize();
  assert.match(String(symSummary.lastError ?? ''), /symlink/i);
  assert.equal((await fsp.readFile(targetOutside, 'utf8')).length, 0);
  await symSink.dispose();

  // Verify config has no .volatile() fields and normalizes wrapped objects safely
  const schema = configMod.Config;
  assert.ok(schema?.dict);
  for (const [key, fieldSchema] of Object.entries(schema.dict)) {
    assert.notEqual(
      fieldSchema?.meta?.volatile,
      true,
      `Config field ${key} must not use .volatile()`,
    );
  }
  const normalizedWrapped = configMod.normalizeConfig({
    get: () => ({
      endpoints: { get: () => ['http://127.0.0.1:9999'] },
      wirePolicyV2: { get: () => false },
      retrySafetyV2: { get: () => true },
      diagnosticMode: { get: () => 'metadata' },
      diagnosticRetainDays: { get: () => 5 },
    }),
  });
  assert.deepEqual(normalizedWrapped.endpoints, ['http://127.0.0.1:9999']);
  assert.equal(normalizedWrapped.wirePolicyV2, false);
  assert.equal(normalizedWrapped.retrySafetyV2, true);
  assert.equal(normalizedWrapped.diagnosticMode, 'metadata');
  assert.equal(normalizedWrapped.diagnosticRetainDays, 5);
});

test('Phase 3: capability vs policy separation, local INVALID_REQUEST, entitlement state & independent flags', async (t) => {
  const { normalizeConfig } = await importHostModule('src/host/config.ts');
  const { parseAvailableModelsResponse } = await importHostModule('src/host/quota.ts');
  const { AntigravityService } = await importHostModule('src/host/adapter.ts');
  const { POLICY_DEFAULT_MAX_OUTPUT_TOKENS } = await importHostModule('src/host/catalog.ts');
  const { LlmError } = await importDshLlm();

  const lcaFixture = readFixtureJson('load-code-assist.sanitized.json');
  const modelsFixture = readFixtureJson('available-models.sanitized.json');

  const storageDir = await makeTempDir(t, 'dsh-policy-');
  const config = normalizeConfig({ storageDir });
  const service = new AntigravityService(config);
  t.after(() => service.dispose());

  const accA = await service.accounts.upsertAccountFromOAuth({
    email: 'pro-user@example.com',
    accessToken: 'tok-a',
    refreshToken: 'ref-a',
    expiresAt: Date.now() + 3600_000,
    projectId: 'proj-pro',
  });
  await service.accounts.ensureLoaded();
  const parsedModels = parseAvailableModelsResponse(modelsFixture.response);
  await service.catalog.saveDynamicModels(parsedModels);

  // Disabled model is excluded; hydrogen keeps 262144 capability while resolving 65536 policy default
  const catalogList = service.catalog.mergedCatalog();
  assert.equal(catalogList.some((m) => m.id === 'gemini-4-carbon-disabled'), false);

  const resolvedHydrogen = service.catalog.resolveModel('gemini-4-hydrogen');
  assert.equal(resolvedHydrogen.context.contextWindow, 1_048_576);
  assert.equal(resolvedHydrogen.defaultMaxTokens, POLICY_DEFAULT_MAX_OUTPUT_TOKENS);
  assert.equal(resolvedHydrogen.defaultMaxTokens, 65_536);
  assert.equal(
    service.catalog.getModelCapabilities('gemini-4-hydrogen').maxOutputTokensCapability,
    262_144,
  );

  // flash-lite clamps defaultMaxTokens to its 65535 capability
  const resolvedLite = service.catalog.resolveModel('gemini-3.1-flash-lite');
  assert.equal(resolvedLite.defaultMaxTokens, 65_535);

  // Invalid maxTokens fail locally BEFORE any network request
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not hit network');
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  for (const invalidVal of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 300_000]) {
    await assert.rejects(
      async () => {
        for await (const _chunk of service.adapter.stream({
          model: 'gemini-4-hydrogen',
          maxTokens: invalidVal,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        })) {
          // unreachable
        }
      },
      (err) => err instanceof LlmError && err.code === 'INVALID_REQUEST',
      `expected INVALID_REQUEST for maxTokens=${String(invalidVal)}`,
    );
  }
  await assert.rejects(
    async () => {
      for await (const _chunk of service.adapter.stream({
        model: 'gemini-3.1-flash-lite',
        maxTokens: 65_536,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        // unreachable
      }
    },
    (err) => err instanceof LlmError && err.code === 'INVALID_REQUEST',
  );
  assert.equal(fetchCalled, false);

  // Valid explicit maxTokens (131072 <= 262144) & loadCodeAssist entitlement states
  const { extractTierInfo } = await importHostModule('src/host/quota.ts');
  const g1Pro = extractTierInfo(lcaFixture.variants.g1ProWithGoogleOneAi);
  assert.equal(g1Pro.availableCreditsState, 'present');
  assert.deepEqual(g1Pro.enabledCreditTypes, ['GOOGLE_ONE_AI']);

  const freeTier = extractTierInfo(lcaFixture.variants.freeTierNoCreditsField);
  assert.equal(freeTier.availableCreditsState, 'absent');
  assert.equal(freeTier.enabledCreditTypes, undefined);

  const emptyCred = extractTierInfo(lcaFixture.variants.paidTierEmptyCredits);
  assert.equal(emptyCred.availableCreditsState, 'empty');

  const badShape = extractTierInfo(lcaFixture.variants.malformedCreditsShape);
  assert.equal(badShape.availableCreditsState, 'parse_failed');

  const badItem = extractTierInfo(lcaFixture.variants.invalidCreditElement);
  assert.equal(badItem.availableCreditsState, 'parse_failed');

  // Bind entitlement to accA, verify generation invalidation on OAuth re-upsert & project change
  const genBefore = service.accounts.getAccountById(accA.id).accountGeneration ?? 0;
  await service.accounts.updateAccountEntitlement(accA.id, g1Pro, 'loadCodeAssist');
  assert.equal(
    service.accounts.resolveTrustedEntitlement(accA.id)?.availableCreditsState,
    'present',
  );

  await service.accounts.upsertAccountFromOAuth({
    email: 'pro-user@example.com',
    accessToken: 'tok-a2',
    refreshToken: 'ref-a2',
    expiresAt: Date.now() + 3600_000,
    projectId: 'proj-pro',
  });
  const accAReauthed = service.accounts.getAccountById(accA.id);
  assert.equal(accAReauthed.accountGeneration, genBefore + 1);
  assert.equal(service.accounts.resolveTrustedEntitlement(accA.id), undefined);

  // Add second free account B and ensure credits never leak between accounts
  await service.accounts.updateAccountEntitlement(accA.id, g1Pro, 'loadCodeAssist');
  const accB = await service.accounts.upsertAccountFromOAuth({
    email: 'free-user@example.com',
    accessToken: 'tok-b',
    refreshToken: 'ref-b',
    expiresAt: Date.now() + 3600_000,
    projectId: 'proj-free',
  });
  await service.accounts.updateAccountEntitlement(accB.id, freeTier, 'loadCodeAssist');
  assert.equal(service.accounts.resolveTrustedEntitlement(accB.id)?.enabledCreditTypes, undefined);

  // Re-bind account B active; capture stream request body & assert NO enabledCreditTypes while 131072 honored
  await service.accounts.manualSwitchAccount(accB.id);
  const capturedBodies = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('writeTrajectoryAcls')) {
      return new Response('{}', { status: 200 });
    }
    capturedBodies.push(JSON.parse(init.body));
    const sse =
      'data: ' +
      JSON.stringify({
        response: {
          responseId: 'resp-131k',
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 },
        },
      }) +
      '\n\n';
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const outChunks = [];
  for await (const chunk of service.adapter.stream({
    model: 'gemini-4-hydrogen',
    maxTokens: 131_072,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  })) {
    outChunks.push(chunk);
  }
  assert.equal(capturedBodies.length, 1);
  assert.equal(capturedBodies[0].request.generationConfig.maxOutputTokens, 131_072);
  assert.equal('enabledCreditTypes' in capturedBodies[0], false);

  // Independent feature flag check: wirePolicyV2=false keeps retrySafetyV2=true
  const legacyWireCfg = normalizeConfig({
    storageDir,
    wirePolicyV2: false,
    retrySafetyV2: true,
  });
  const legacyService = new AntigravityService(legacyWireCfg);
  t.after(() => legacyService.dispose());
  await legacyService.accounts.ensureLoaded();
  await legacyService.catalog.saveDynamicModels(parsedModels);
  await legacyService.accounts.manualSwitchAccount(accA.id);
  // Restore trusted pro entitlement on accA
  await legacyService.accounts.updateAccountEntitlement(accA.id, g1Pro, 'loadCodeAssist');

  capturedBodies.length = 0;
  for await (const _chunk of legacyService.adapter.stream({
    model: 'gemini-4-hydrogen',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello legacy wire' }] }],
  })) {
    // consume
  }
  // wirePolicyV2=false omits enabledCreditTypes & falls back to dynamic defaultMaxTokens,
  // YET retrySafetyV2=true still omits RATE_LIMIT from providerRetryPolicy!
  assert.equal('enabledCreditTypes' in capturedBodies[0], false);
  const policyRetry = legacyService.adapter.providerRetryPolicy('antigravity');
  assert.equal(policyRetry.retryableCodes.includes('RATE_LIMIT'), false);
  assert.equal(policyRetry.retryableCodes.includes('SERVER'), true);
});

test('Phase 6: local node:http sink validates 429 RetryInfo/bare classification, no endpoint escalation, disableRetry & diagnostics/clear', async (t) => {
  const { normalizeConfig } = await importHostModule('src/host/config.ts');
  const { AntigravityService } = await importHostModule('src/host/adapter.ts');
  const { parseRetryDelayDetails, classifyUpstreamHttpError } = await importHostModule(
    'src/host/client.ts',
  );
  const { registerAntigravityWebApi } = await importHostModule('src/host/server.ts');

  const errFixture = readFixtureJson('error-responses.sanitized.json');
  const lcaFixture = readFixtureJson('load-code-assist.sanitized.json');

  // Verify HTTP-date Retry-After & quotaResetDelay unit parsing
  const futureDate = new Date(Date.now() + 4000).toUTCString();
  const dateParsed = parseRetryDelayDetails('rate limit', futureDate);
  assert.equal(dateParsed.delaySource, 'retry_after_header');
  assert.ok(dateParsed.retryAfterMs >= 2500 && dateParsed.retryAfterMs <= 6000);

  const longReset = classifyUpstreamHttpError(
    429,
    JSON.stringify(errFixture.cases.quotaExhaustedWithResetDelay.body),
    null,
    { retrySafetyV2: true },
  );
  assert.equal(longReset.code, 'QUOTA');
  assert.equal(longReset.subType, 'quota_exhausted');
  assert.equal(longReset.delaySource, 'quota_reset_delay');
  assert.ok(longReset.retryAfterMs >= 1_800_000);

  // Ensure remote non-TLS HTTP endpoints are still rejected while loopback test sinks are allowed
  const endpointCheck = normalizeConfig({
    endpoints: ['http://evil.example.com', 'http://127.0.0.1:4123/ep'],
  });
  assert.deepEqual(endpointCheck.endpoints, ['http://127.0.0.1:4123/ep']);

  // Dual-mode sink harness: uses real node:http TCP loopback when permitted,
  // and cleanly bridges fetch -> handler when running inside a network-isolated sandbox (EPERM).
  let mode = 'bare_429';
  const hitLog = [];
  let retryInfoCount = 0;

  const dispatchSink = async (method, urlPath, headers, bodyText) => {
    const parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
    hitLog.push({ method, url: urlPath, headers, body: parsedBody });

    if (urlPath.includes('loadCodeAssist')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lcaFixture.variants.g1ProWithGoogleOneAi),
      };
    }
    if (urlPath.includes('writeTrajectoryAcls')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      };
    }
    if (mode === 'bare_429') {
      return {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errFixture.cases.bare429ResourceExhausted.body),
      };
    }
    if (mode === 'retry_info_once') {
      retryInfoCount += 1;
      if (retryInfoCount === 1) {
        return {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(errFixture.cases.rateLimitWithRetryInfo.body),
        };
      }
      return {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body:
          'data: ' +
          JSON.stringify({
            response: {
              responseId: 'resp-retry-ok',
              candidates: [{ content: { parts: [{ text: 'recovered' }] }, finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14 },
            },
          }) +
          '\n\n',
      };
    }
    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errFixture.cases.overloaded503.body),
    };
  };

  let baseA = 'http://127.0.0.1:49999/ep-daily';
  let baseB = 'http://127.0.0.1:49999/ep-prod';
  let loopbackAvailable = false;

  const server = http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl === '/__probe') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const out = await dispatchSink(
      req.method || 'GET',
      reqUrl,
      req.headers,
      Buffer.concat(chunks).toString('utf8'),
    );
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    baseA = `http://127.0.0.1:${addr.port}/ep-daily`;
    baseB = `http://127.0.0.1:${addr.port}/ep-prod`;
    const probe = await fetch(`http://127.0.0.1:${addr.port}/__probe`);
    loopbackAvailable = probe.ok;
    t.after(() => new Promise((resolve) => server.close(() => resolve())));
  } catch {
    try {
      server.close();
    } catch {
      // Ignore unstarted server close.
    }
    loopbackAvailable = false;
  }

  if (!loopbackAvailable) {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      const out = await dispatchSink(
        init?.method || 'POST',
        `${u.pathname}${u.search}`,
        init?.headers ?? {},
        typeof init?.body === 'string' ? init.body : '',
      );
      return new Response(out.body, { status: out.status, headers: out.headers });
    };
    t.after(() => {
      globalThis.fetch = origFetch;
    });
  }

  const storageDir = await makeTempDir(t, 'dsh-http-sink-');
  const config = normalizeConfig({
    storageDir,
    endpoints: [baseA, baseB],
    diagnosticMode: 'metadata',
    wirePolicyV2: true,
    retrySafetyV2: true,
  });
  const service = new AntigravityService(config);
  t.after(() => service.dispose());

  // First connect account & resolve entitlement via real local loadCodeAssist call
  const acc = await service.accounts.upsertAccountFromOAuth({
    email: 'sink-tester@example.com',
    accessToken: 'tok-sink-1',
    refreshToken: 'ref-sink-1',
    expiresAt: Date.now() + 3600_000,
  });
  const proj = await service.ensureAccountProjectId(acc);
  assert.equal(proj, 'fixture-project-pro-001');
  assert.deepEqual(
    service.accounts.resolveTrustedEntitlement(acc.id)?.enabledCreditTypes,
    ['GOOGLE_ONE_AI'],
  );

  // Case A: bare 429 hits ONLY 1 endpoint ONCE, classified QUOTA, zero loop
  hitLog.length = 0;
  mode = 'bare_429';
  await assert.rejects(
    async () => {
      for await (const _chunk of service.adapter.stream({
        model: 'gemini-4-hydrogen',
        sessionId: 'sess-bare-429',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        // unreachable
      }
    },
    (err) =>
      err.code === 'QUOTA' &&
      err.classified?.subType === 'resource_exhausted_unknown',
  );
  const bareStreamHits = hitLog.filter((h) => h.url.includes('streamGenerateContent'));
  assert.equal(bareStreamHits.length, 1);
  assert.ok(bareStreamHits[0].url.startsWith('/ep-daily'));
  assert.deepEqual(bareStreamHits[0].body.enabledCreditTypes, ['GOOGLE_ONE_AI']);
  assert.equal(bareStreamHits[0].body.request.generationConfig.maxOutputTokens, 65_536);

  // Case B: explicit short RetryInfo 429 waits >=1000ms once on SAME endpoint and succeeds
  hitLog.length = 0;
  retryInfoCount = 0;
  mode = 'retry_info_once';
  const startedAt = Date.now();
  let text = '';
  for await (const ch of service.adapter.stream({
    model: 'gemini-4-hydrogen',
    sessionId: 'sess-retry-once',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  })) {
    if (ch.type === 'text-delta') text += ch.text;
  }
  const elapsedMs = Date.now() - startedAt;
  assert.equal(text, 'recovered');
  assert.ok(elapsedMs >= 950, `expected bounded >=1000ms wait, got ${elapsedMs}ms`);
  const retryStreamHits = hitLog.filter((h) => h.url.includes('streamGenerateContent'));
  assert.equal(retryStreamHits.length, 2);
  assert.ok(retryStreamHits.every((h) => h.url.startsWith('/ep-daily')));

  // Case C: disableRetry & disableAccountFailover strictly perform 1 request & never switch active account
  await service.accounts.upsertAccountFromOAuth({
    email: 'backup@example.com',
    accessToken: 'tok-sink-2',
    refreshToken: 'ref-sink-2',
    expiresAt: Date.now() + 3600_000,
    projectId: 'proj-backup',
  });
  await service.accounts.manualSwitchAccount(acc.id);
  hitLog.length = 0;
  mode = 'always_503';
  await assert.rejects(
    async () => {
      for await (const _chunk of service.adapter.stream({
        model: 'gemini-4-hydrogen',
        sessionId: 'sess-no-retry',
        disableRetry: true,
        disableAccountFailover: true,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'probe' }] }],
      })) {
        // unreachable
      }
    },
    (err) => err.code === 'SERVER',
  );
  assert.equal(
    hitLog.filter((h) => h.url.includes('streamGenerateContent')).length,
    1,
    'disableRetry probe must make strictly 1 request without endpoint fallback',
  );
  assert.equal(service.accounts.getActiveAccount().id, acc.id);

  // Verify web route POST /antigravity/api/diagnostics/clear clears diagnostic trace cleanly
  const routes = [];
  registerAntigravityWebApi(
    {
      inject(_deps, cb) {
        cb({
          effect: (fn) => fn(),
          webServer: { register: (r) => { routes.push(r); return () => {}; } },
        });
      },
    },
    service,
  );
  const invoke = async (method, urlPath) => {
    const req = Readable.from([]);
    req.method = method;
    req.url = urlPath;
    let statusCode = 0;
    let raw = '';
    const res = {
      writeHead(s) { statusCode = s; },
      end(b) { raw += b ? String(b) : ''; },
    };
    await routes[0].handler(req, res);
    return { statusCode, body: JSON.parse(raw) };
  };

  await service.diagnostics.flush();
  const statusBefore = await service.getStatusPayload();
  assert.ok(statusBefore.diagnostics.recordCount > 0);
  const clearRes = await invoke('POST', '/antigravity/api/diagnostics/clear');
  assert.equal(clearRes.statusCode, 200);
  assert.equal(clearRes.body.value.diagnostics.recordCount, 0);
});
