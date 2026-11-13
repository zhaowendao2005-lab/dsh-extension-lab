import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { importDshLlm, importHostModule } from './helpers/load-host.mjs';

const configMod = await importHostModule('src/host/config.ts');
const accountsMod = await importHostModule('src/host/accounts.ts');
const quotaMod = await importHostModule('src/host/quota.ts');
const catalogMod = await importHostModule('src/host/catalog.ts');
const adapterMod = await importHostModule('src/host/adapter.ts');
const indexMod = await importHostModule('src/host/index.ts');
const dshLlm = await importDshLlm();

async function withTempStorage(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-antigravity-acct-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeAccountInput(email, tokenSuffix, quotaFrac) {
  return {
    email,
    accessToken: `access-${tokenSuffix}`,
    refreshToken: `refresh-${tokenSuffix}`,
    expiresAt: Date.now() + 3600_000,
    quotaFrac,
  };
}

test('accounts: sticky selection, strict category filtering, threshold failover & private permissions', async (t) => {
  const storageDir = await withTempStorage(t);
  const config = configMod.normalizeConfig({
    storageDir,
    failureSwitchThreshold: 3,
    quotaExhaustedThreshold: 0.05,
  });

  const mgr = new accountsMod.AntigravityAccountManager(config);
  const a1 = await mgr.upsertAccountFromOAuth(makeAccountInput('primary@gmail.com', '1', 0.9));
  const a2 = await mgr.upsertAccountFromOAuth(makeAccountInput('backup@gmail.com', '2', 0.8));

  // Ensure primary stays first active account and dismiss initial notice if any
  await mgr.manualSwitchAccount(a1.id, 'sess-1');
  mgr.dismissColdNotice();

  // Verify accounts.json written with strict 0o600 permissions
  const fileStat = await stat(path.join(storageDir, 'accounts.json'));
  assert.equal(fileStat.mode & 0o777, 0o600);

  // Sticky invariant on same session
  assert.equal(mgr.selectAccountForSession('sess-1', 'gemini-pro').account.id, a1.id);

  // Non-sticky error categories MUST NOT count toward failure streak
  for (const cat of ['INVALID_REQUEST', 'TRANSPORT', 'CONTEXT_LENGTH', 'SERVER']) {
    const sw = mgr.recordFailure({
      accountId: a1.id,
      sessionKey: 'sess-1',
      category: cat,
      message: `non-sticky-${cat}`,
      pool: 'gemini-pro',
    });
    assert.equal(sw, undefined);
  }
  assert.equal(mgr.selectAccountForSession('sess-1', 'gemini-pro').account.id, a1.id);

  // Threshold=3 sticky failures on AUTH switch to healthy alternative
  assert.equal(mgr.selectAccountForSession('sess-auth', 'gemini-pro').account.id, a1.id);
  assert.equal(
    mgr.recordFailure({ accountId: a1.id, sessionKey: 'sess-auth', category: 'AUTH', message: 'fail-1', pool: 'gemini-pro' }),
    undefined,
  );
  assert.equal(
    mgr.recordFailure({ accountId: a1.id, sessionKey: 'sess-auth', category: 'AUTH', message: 'fail-2', pool: 'gemini-pro' }),
    undefined,
  );
  const switched = mgr.recordFailure({
    accountId: a1.id,
    sessionKey: 'sess-auth',
    category: 'AUTH',
    message: 'fail-3',
    pool: 'gemini-pro',
  });
  assert.ok(switched);
  assert.equal(switched.fromAccountId, a1.id);
  assert.equal(switched.toAccountId, a2.id);
  assert.equal(switched.reason, 'streak');
  assert.ok(mgr.getColdNotice()?.toAccountId === a2.id);

  // Reloading manager from disk restores accounts & active selection
  const reloaded = new accountsMod.AntigravityAccountManager(config);
  await reloaded.ensureLoaded();
  assert.equal(reloaded.listAccounts().length, 2);
});

test('quota & catalog: pool separation, Gemini-first filtering & LlmModelBadge', async (t) => {
  const storageDir = await withTempStorage(t);
  const config = configMod.normalizeConfig({ storageDir, includeNonGeminiModels: false });

  const tier = quotaMod.extractTierInfo({
    cloudaicompanionProject: { id: 'cloud-proj-99' },
    paidTier: { id: 'google-ai-pro', name: 'Google AI Pro Tier' },
  });
  assert.equal(tier.projectId, 'cloud-proj-99');
  assert.equal(tier.tierLabel, 'Pro');

  const rawModels = {
    models: {
      'gemini-3.1-pro-high': {
        displayName: 'Gemini 3.1 Pro (High)',
        quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-13T15:00:00Z' },
        maxTokens: 1048576,
      },
      'gemini-3-flash': {
        displayName: 'Gemini 3 Flash',
        quotaInfo: { remainingFraction: 0.08 },
      },
      'claude-sonnet-4-5': {
        displayName: 'Claude Sonnet 4.5 (3P)',
        modelProvider: 'Anthropic',
        quotaInfo: { remainingFraction: 0.45 },
      },
    },
  };
  const parsed = quotaMod.parseAvailableModelsResponse(rawModels);
  const groups = quotaMod.buildQuotaGroups({
    models: parsed,
    config,
  });
  const snapshot = {
    accountId: 'acc-1',
    email: 'user@gmail.com',
    fetchedAt: Date.now(),
    degraded: false,
    groups,
  };

  // UI quota snapshot still includes Claude / 3P pool separately from Gemini pools
  const pools = snapshot.groups.map((g) => g.pool);
  assert.ok(pools.includes('gemini-pro'));
  assert.ok(pools.includes('gemini-flash'));
  assert.ok(pools.includes('claude-3p'));
  assert.equal(snapshot.groups.find((g) => g.pool === 'gemini-flash')?.isLow, true);

  const catalog = new catalogMod.AntigravityCatalog(config);
  catalog.updateDynamicModels(parsed);
  const models = await catalog.listModels(snapshot);

  // includeNonGeminiModels=false MUST exclude Claude/3P from routed adapter catalog
  assert.equal(models.some((m) => m.id.includes('claude')), false);
  const flashInfo = models.find((m) => m.id === 'gemini-3-flash');
  assert.deepEqual(flashInfo?.badge, { text: '8%', tone: 'warning' });

  // includeNonGeminiModels=true exposes dynamic 3P models when enabled
  const configAll = configMod.normalizeConfig({ storageDir, includeNonGeminiModels: true });
  const catalogAll = new catalogMod.AntigravityCatalog(configAll);
  catalogAll.updateDynamicModels(parsed);
  await catalogAll.setEnabledModelIds(['gemini-3-flash', 'claude-sonnet-4-5']);
  const exposedAll = await catalogAll.listModels(snapshot);
  assert.equal(exposedAll.some((m) => m.id === 'claude-sonnet-4-5'), true);
});

test('adapter + web API: endpoint fallback (503->400 sandbox->200), 1M bump retry & HTTP routes', async (t) => {
  const storageDir = await withTempStorage(t);
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const requestedUrls = [];
  const requestedHeaders = [];
  const requestedBodies = [];
  let streamCallCount = 0;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    requestedUrls.push(u);
    requestedHeaders.push(init?.headers ?? {});
    requestedBodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);

    if (u.includes('loadCodeAssist')) {
      return new Response(
        JSON.stringify({
          cloudaicompanionProject: 'resolved-proj-id',
          paidTier: { id: 'pro', name: 'Google AI Pro' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (u.includes('fetchAvailableModels')) {
      return new Response(
        JSON.stringify({
          models: {
            'gemini-3-flash': { displayName: 'Gemini 3 Flash', quotaInfo: { remainingFraction: 0.9 } },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (u.includes('retrieveUserQuota')) {
      return new Response(JSON.stringify({ buckets: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (u.includes('writeTrajectoryAcls')) {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (u.includes('streamGenerateContent')) {
      streamCallCount += 1;
      // 1st attempt on Daily -> 503 triggers fallback to Sandbox
      if (streamCallCount === 1) {
        return new Response('{"error":{"message":"backend busy"}}', { status: 503 });
      }
      // 2nd attempt on Sandbox -> 400 triggers fallback to Prod
      if (streamCallCount === 2) {
        return new Response('{"error":{"message":"User location is not supported"}}', { status: 400 });
      }
      // 3rd attempt on Prod -> 1M context error triggers upstream sessionId generation bump
      if (streamCallCount === 3) {
        return new Response(
          '{"error":{"message":"Input token count exceeds the maximum number of tokens allowed 1048576"}}',
          { status: 400 },
        );
      }
      // 4th attempt succeeds with SSE response
      const sseBody =
        'data: ' +
        JSON.stringify({
          response: {
            responseId: 'resp-ok-1',
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Hello from Cloud Code!' }] } }],
            usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 5 },
          },
        }) +
        '\n\n';
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sseBody));
            c.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  const config = configMod.normalizeConfig({ storageDir });
  const service = new adapterMod.AntigravityService(config);
  const acc = await service.accounts.upsertAccountFromOAuth(makeAccountInput('tester@gmail.com', 't1', 0.9));

  const prepared = await service.adapter.prepareCall('antigravity', 'gemini-3-flash');
  assert.equal(prepared.model.id, 'gemini-3-flash');
  assert.equal(prepared.model.systemPromptUpdate, 'in-history');

  const assembler = new dshLlm.BlockAssembler();
  for await (const chunk of prepared.stream({
    provider: 'antigravity',
    model: 'gemini-3-flash',
    sessionId: 'dsh-sess-99',
    messages: [
      dshLlm.createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Say hello' }],
      }),
    ],
  })) {
    assembler.push(chunk);
  }

  const out = assembler.assembled();
  assert.equal(out.blocks[0].type, 'text');
  assert.equal(out.blocks[0].text, 'Hello from Cloud Code!');
  assert.equal(assembler._usage.inputTokens, 60);
  assert.equal(assembler._usage.cacheReadTokens, 40);
  assert.equal(assembler._usage.outputTokens, 5);
  assert.equal(service.telemetry.summary().turnCount, 1);

  // Verify upstream session generation bumped from 0 to 1 after 1M error
  assert.equal(service.accounts.getUpstreamSessionGeneration(acc.id, 'dsh-sess-99'), 1);

  // Verify trajectory ACL pre-registration ran once before streamGenerateContent with matching trajectoryId
  const aclIndex = requestedUrls.findIndex((u) => u.includes('writeTrajectoryAcls'));
  const firstStreamIndex = requestedUrls.findIndex((u) => u.includes('streamGenerateContent'));
  assert.ok(aclIndex >= 0 && aclIndex < firstStreamIndex);
  assert.equal(requestedUrls.filter((u) => u.includes('writeTrajectoryAcls')).length, 1);
  const aclTrajectoryId = requestedBodies[aclIndex]?.trajectoryId;
  assert.match(String(aclTrajectoryId ?? ''), /^[0-9a-f]{8}$/);
  assert.ok(String(requestedBodies[firstStreamIndex]?.requestId ?? '').includes(`/${aclTrajectoryId}/`));

  // Verify fallback hit Daily -> Sandbox -> Prod -> Prod (retried)
  const streamUrls = requestedUrls.filter((u) => u.includes('streamGenerateContent'));
  assert.equal(streamUrls.length, 4);
  assert.ok(streamUrls[0].startsWith('https://daily-cloudcode-pa.googleapis.com'));
  assert.ok(streamUrls[1].startsWith('https://daily-cloudcode-pa.sandbox.googleapis.com'));
  assert.ok(streamUrls[2].startsWith('https://cloudcode-pa.googleapis.com'));
  assert.ok(streamUrls[3].startsWith('https://cloudcode-pa.googleapis.com'));

  // Verify no DSH attribution UA leaked and Accept-Encoding: gzip is set on outbound calls
  for (const hdr of requestedHeaders) {
    assert.ok(String(hdr['User-Agent'] ?? '').startsWith('antigravity/hub/'));
    assert.equal(hdr['Accept-Encoding'], 'gzip');
  }

  // Test Cordis plugin apply() + registered Web API & Command routes
  const registeredRoutes = [];
  const registeredCommands = [];
  const disposers = [];
  let adaptersUpdatedCount = 0;

  const mockCtx = {
    llm: {
      registerAdapter(providers, adapter) {
        assert.deepEqual(providers, ['antigravity']);
        assert.ok(adapter);
        return () => {};
      },
    },
    emit(evt) {
      if (evt === 'llm/adapters-updated') adaptersUpdatedCount += 1;
    },
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') disposers.push(cleanup);
    },
    inject(deps, cb) {
      if (deps.includes('webServer')) {
        cb({
          effect: (fn) => {
            const c = fn();
            if (typeof c === 'function') disposers.push(c);
          },
          webServer: {
            register(route) {
              registeredRoutes.push(route);
              return () => {};
            },
          },
        });
      }
      if (deps.includes('commands')) {
        cb({
          effect: (fn) => {
            const c = fn();
            if (typeof c === 'function') disposers.push(c);
          },
          commands: {
            register(cmd) {
              registeredCommands.push(cmd);
              return () => {};
            },
          },
        });
      }
    },
  };

  indexMod.apply(mockCtx, { storageDir });
  assert.equal(registeredRoutes.length, 1);
  assert.equal(registeredRoutes[0].path, '/antigravity/api');
  assert.ok(registeredCommands.some((c) => c.name === 'antigravity-status'));

  const statusCmd = registeredCommands.find((c) => c.name === 'antigravity-status');
  const cmdOut = await statusCmd.handler({});
  assert.equal(cmdOut.kind, 'success');
  assert.ok(cmdOut.text.includes('Antigravity'));

  const invokeRoute = async (method, urlPath, bodyObj) => {
    const req = Readable.from(bodyObj ? [Buffer.from(JSON.stringify(bodyObj))] : []);
    req.method = method;
    req.url = urlPath;
    let statusCode = 0;
    let rawBody = '';
    const res = {
      writeHead(s) {
        statusCode = s;
      },
      end(chunk) {
        rawBody += chunk ? String(chunk) : '';
      },
    };
    await registeredRoutes[0].handler(req, res);
    return { statusCode, body: JSON.parse(rawBody) };
  };

  const statusRes = await invokeRoute('GET', '/antigravity/api/status');
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.ok, true);
  assert.equal(statusRes.body.value.providerId, 'antigravity');
  assert.equal(statusRes.body.value.unofficialChannel, true);

  const doctorRes = await invokeRoute('GET', '/antigravity/api/doctor');
  assert.equal(doctorRes.statusCode, 200);
  assert.equal(doctorRes.body.ok, true);
  assert.ok(Array.isArray(doctorRes.body.value.checks));

  const modelsRes = await invokeRoute('POST', '/antigravity/api/models', {
    enabledModelIds: ['gemini-3.1-pro-high', 'gemini-3-flash'],
  });
  assert.equal(modelsRes.statusCode, 200);
  assert.equal(modelsRes.body.ok, true);
  assert.ok(adaptersUpdatedCount >= 1);

  for (const d of disposers) d();
});
