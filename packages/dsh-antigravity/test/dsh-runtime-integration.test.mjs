import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  importHostModule,
  importDshPackage,
  importHostModuleFromExtracted,
  importExtractedPackage,
  pkgRoot,
} from './helpers/load-host.mjs';

const fixtureDir = path.join(pkgRoot, 'test', 'fixtures', 'protocol');

async function makeTempDir(prefix = 'dsh-antigravity-int-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function readFixtureJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

async function seedMockAccount(storageDir, extra = {}) {
  const accPath = path.join(storageDir, 'accounts.json');
  await fsp.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const account = {
    id: 'acc-int-1',
    email: 'integration@example.com',
    accessToken: 'tok-int-1',
    refreshToken: 'ref-int-1',
    expiresAt: Date.now() + 3600_000,
    projectId: 'fixture-project-pro-001',
    needsReauth: false,
    addedAt: Date.now(),
    accountGeneration: 0,
    ...extra,
  };
  await fsp.writeFile(
    accPath,
    JSON.stringify({ version: 1, activeAccountId: account.id, accounts: [account] }, null, 2),
    { mode: 0o600 },
  );
  return account;
}

function makeSseResponse(parts, usageMetadata, finishReason = 'STOP', responseId = 'resp-1') {
  const payload = {
    response: {
      responseId,
      candidates: [
        {
          content: { role: 'model', parts },
          finishReason,
        },
      ],
      usageMetadata,
    },
  };
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('Layer 1: real dsh-llm LlmRuntime materializes 65536 (not 262144), honors Config reload, and coexists with llm/stream observers', async (t) => {
  const { Context } = await importDshPackage('@deepseek-ai/cordis');
  const { LlmRuntime, LlmError } = await importDshPackage('@deepseek-ai/dsh-llm');
  const plugin = await importHostModule('src/host/index.ts');

  const lcaFixture = readFixtureJson('load-code-assist.sanitized.json');
  const modelsFixture = readFixtureJson('available-models.sanitized.json');
  const errFixture = readFixtureJson('error-responses.sanitized.json');

  const storageDir = await makeTempDir('dsh-l1-');
  await seedMockAccount(storageDir);

  const capturedStreams = [];
  let streamMode = 'ok';
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('loadCodeAssist')) {
      return new Response(JSON.stringify(lcaFixture.variants.g1ProWithGoogleOneAi), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('fetchAvailableModels')) {
      return new Response(JSON.stringify(modelsFixture.response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('retrieveUserQuotaSummary')) {
      return new Response(JSON.stringify({ buckets: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('writeTrajectoryAcls')) {
      return new Response('{}', { status: 200 });
    }
    if (u.includes('streamGenerateContent')) {
      capturedStreams.push(JSON.parse(init.body));
      if (streamMode === 'bare_429') {
        return new Response(JSON.stringify(errFixture.cases.bare429ResourceExhausted.body), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return makeSseResponse(
        [{ text: 'Layer1 verified' }],
        { promptTokenCount: 20, cachedContentTokenCount: 5, candidatesTokenCount: 3 },
      );
    }
    throw new Error(`Unexpected URL in L1 test: ${u}`);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  // Verify dsh-antigravity NEVER monkey-patches globalThis.fetch on load or mount
  const fetchBeforeMount = globalThis.fetch;

  const ctx = new Context();
  const llmFork = ctx.plugin(LlmRuntime);
  const fork = ctx.plugin(plugin, { storageDir, diagnosticMode: 'off' });
  await Promise.all([llmFork.await(), fork.await()]);
  t.after(async () => {
    await fork.dispose().catch(() => {});
    await llmFork.dispose().catch(() => {});
    globalThis.fetch = origFetch;
    await fsp.rm(storageDir, { recursive: true, force: true });
  });

  assert.equal(globalThis.fetch, fetchBeforeMount);

  // Allow startup async refresh (loadCodeAssist + fetchAvailableModels) to settle
  for (let i = 0; i < 40; i++) {
    const info = await ctx.llm.resolveModelInfo('antigravity', 'gemini-4-hydrogen');
    if (info.context?.contextWindow === 1_048_576 && info.defaultMaxTokens === 65_536) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  // Ensure entitlement populated from startup loadCodeAssist
  await new Promise((r) => setTimeout(r, 50));

  const resolvedInfo = await ctx.llm.resolveModelInfo('antigravity', 'gemini-4-hydrogen');
  assert.equal(resolvedInfo.context.contextWindow, 1_048_576);
  assert.equal(resolvedInfo.defaultMaxTokens, 65_536);

  // Register non-mutating synchronous llm/stream waterfall observer matching billion-context/btw pattern
  const observedStreamCalls = [];
  ctx.on('llm/stream', (payload, next) => {
    observedStreamCalls.push(payload?.model ?? 'unknown');
    return next();
  });

  // LlmRuntime defaults resolve 65536 (never 262144) + trusted GOOGLE_ONE_AI credits
  const chunks = [];
  for await (const chunk of ctx.llm.stream({
    provider: 'antigravity',
    model: 'gemini-4-hydrogen',
    sessionId: 'l1-sess-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Ping' }] }],
  })) {
    chunks.push(chunk);
  }
  assert.deepEqual(observedStreamCalls, ['gemini-4-hydrogen']);
  assert.ok(chunks.some((c) => c.type === 'text-delta' && c.text === 'Layer1 verified'));
  assert.equal(capturedStreams.length, 1);
  assert.equal(capturedStreams[0].request.generationConfig.maxOutputTokens, 65_536);
  assert.deepEqual(capturedStreams[0].enabledCreditTypes, ['GOOGLE_ONE_AI']);

  // Caller explicit 131072 succeeds; 300000 or 0.5 emits terminal error finish INVALID_REQUEST BEFORE fetch
  capturedStreams.length = 0;
  for await (const _chunk of ctx.llm.stream({
    provider: 'antigravity',
    model: 'gemini-4-hydrogen',
    maxTokens: 131_072,
    sessionId: 'l1-sess-2',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Higher output' }] }],
  })) {
    // consume
  }
  assert.equal(capturedStreams[0].request.generationConfig.maxOutputTokens, 131_072);

  capturedStreams.length = 0;
  for (const badMax of [0.5, 300_000]) {
    const errChunks = [];
    for await (const chunk of ctx.llm.stream({
      provider: 'antigravity',
      model: 'gemini-4-hydrogen',
      maxTokens: badMax,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Bad' }] }],
    })) {
      errChunks.push(chunk);
    }
    const finish = errChunks.find((c) => c.type === 'finish');
    assert.equal(finish?.reason?.kind, 'error');
    assert.equal(finish?.reason?.failure?.code, 'INVALID_REQUEST');
  }
  assert.equal(capturedStreams.length, 0);

  // Bare 429 through LlmRuntime stops after 1 attempt with terminal QUOTA finish chunk
  streamMode = 'bare_429';
  const quotaChunks = [];
  for await (const chunk of ctx.llm.stream({
    provider: 'antigravity',
    model: 'gemini-4-hydrogen',
    sessionId: 'l1-sess-429',
    messages: [{ role: 'user', content: [{ type: 'text', text: '429 test' }] }],
  })) {
    quotaChunks.push(chunk);
  }
  const quotaFinish = quotaChunks.find((c) => c.type === 'finish');
  assert.equal(quotaFinish?.reason?.kind, 'error');
  assert.equal(quotaFinish?.reason?.failure?.code, 'QUOTA');
  assert.equal(capturedStreams.length, 1);

  // Config reload without .volatile(): toggle wirePolicyV2=false & diagnosticMode='metadata' cleanly
  streamMode = 'ok';
  capturedStreams.length = 0;
  await fork.update({ storageDir, wirePolicyV2: false, retrySafetyV2: true, diagnosticMode: 'metadata' });
  await fork.await();
  await new Promise((r) => setTimeout(r, 80));

  for await (const _chunk of ctx.llm.stream({
    provider: 'antigravity',
    model: 'gemini-4-hydrogen',
    sessionId: 'l1-sess-reloaded',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'After config update' }] }],
  })) {
    // consume
  }
  assert.equal(capturedStreams.length, 1);
  assert.equal('enabledCreditTypes' in capturedStreams[0], false);
  const tracePath = path.join(storageDir, 'diagnostics', 'protocol-trace.jsonl');
  assert.equal(fs.existsSync(tracePath), true);
  assert.equal(globalThis.fetch, fetchBeforeMount);
});

test('Layer 2: real AgentLoop + Session + JSONL Persistence + dsh-llm-retry + TokenMeter + resume/fork', async (t) => {
  const { Context } = await importExtractedPackage('@deepseek-ai/cordis');
  const { LlmRuntime, createUserMessage } = await importExtractedPackage('@deepseek-ai/dsh-llm');
  const { SessionProjectionRegistry } = await importExtractedPackage('@deepseek-ai/dsh-session-projection');
  const { SessionStore } = await importExtractedPackage('@deepseek-ai/dsh-session');
  const JsonlPersistence = await importExtractedPackage('@deepseek-ai/dsh-session-persistence-jsonl');
  const { SystemPrompt } = await importExtractedPackage('@deepseek-ai/dsh-system-prompt');
  const { ToolRuntime, defineTool } = await importExtractedPackage('@deepseek-ai/dsh-tools');
  const NativeExecutor = await importExtractedPackage('@deepseek-ai/dsh-tool-executor-native');
  const { TokenMeter } = await importExtractedPackage('@deepseek-ai/dsh-token-meter');
  const { AgentRegistry } = await importExtractedPackage('@deepseek-ai/dsh-agent');
  const { AgentLoop } = await importExtractedPackage('@deepseek-ai/dsh-agent-loop');
  const LlmRetry = await importExtractedPackage('@deepseek-ai/dsh-llm-retry');
  const antigravityPlugin = await importHostModuleFromExtracted('src/host/index.ts');

  const lcaFixture = readFixtureJson('load-code-assist.sanitized.json');
  const modelsFixture = readFixtureJson('available-models.sanitized.json');
  const errFixture = readFixtureJson('error-responses.sanitized.json');

  const rootDir = await makeTempDir('dsh-l2-');
  const storageDir = path.join(rootDir, 'antigravity');
  const sessionsDir = path.join(rootDir, 'sessions');
  await fsp.mkdir(sessionsDir, { recursive: true });
  await seedMockAccount(storageDir);

  let scenario = 'tool_roundtrip';
  let stepCounter = 0;
  let retry503Count = 0;
  const streamPayloads = [];

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('loadCodeAssist')) {
      return new Response(JSON.stringify(lcaFixture.variants.g1ProWithGoogleOneAi), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('fetchAvailableModels')) {
      return new Response(JSON.stringify(modelsFixture.response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('retrieveUserQuotaSummary')) {
      return new Response(JSON.stringify({ buckets: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('writeTrajectoryAcls')) {
      return new Response('{}', { status: 200 });
    }
    if (u.includes('streamGenerateContent')) {
      streamPayloads.push(JSON.parse(init.body));

      if (scenario === 'tool_roundtrip') {
        stepCounter += 1;
        if (stepCounter === 1) {
          return makeSseResponse(
            [
              { text: 'Thinking first', thought: true, thoughtSignature: 'c2lnLXR1cm4tMQ==' },
              {
                functionCall: {
                  id: 'fc_echo_1',
                  name: 'echo_tool',
                  args: { value: 'hello-loop' },
                },
              },
            ],
            { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 15, thoughtsTokenCount: 5 },
            'STOP',
            'resp-step-1',
          );
        }
        return makeSseResponse(
          [{ text: 'Tool result confirmed.' }],
          { promptTokenCount: 150, cachedContentTokenCount: 80, candidatesTokenCount: 10 },
          'STOP',
          'resp-step-2',
        );
      }

      if (scenario === 'bare_429') {
        return new Response(JSON.stringify(errFixture.cases.bare429ResourceExhausted.body), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (scenario === '503_then_200') {
        retry503Count += 1;
        if (retry503Count === 1) {
          return new Response(JSON.stringify(errFixture.cases.overloaded503.body), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return makeSseResponse(
          [{ text: 'Recovered via dsh-llm-retry' }],
          { promptTokenCount: 30, candidatesTokenCount: 5 },
          'STOP',
          'resp-503-ok',
        );
      }

      return makeSseResponse(
        [{ text: 'Resumed or forked turn complete.' }],
        { promptTokenCount: 40, candidatesTokenCount: 6 },
        'STOP',
        'resp-resumed',
      );
    }
    throw new Error(`Unexpected URL in L2 test: ${u}`);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const ctx = new Context();
  const forks = [
    ctx.plugin(SessionProjectionRegistry),
    ctx.plugin(SessionStore),
    ctx.plugin(JsonlPersistence, { root: sessionsDir, compression: 'none' }),
    ctx.plugin(SystemPrompt),
    ctx.plugin(ToolRuntime),
    ctx.plugin(NativeExecutor),
    ctx.plugin(LlmRuntime),
    ctx.plugin(TokenMeter),
    ctx.plugin(AgentRegistry),
    ctx.plugin(AgentLoop),
    ctx.plugin(LlmRetry),
    ctx.plugin(antigravityPlugin, {
      storageDir,
      endpoints: ['https://daily-cloudcode-pa.googleapis.com'],
      wirePolicyV2: true,
      retrySafetyV2: true,
    }),
  ];

  await Promise.all(forks.map((f) => f.await()));
  t.after(async () => {
    for (const f of [...forks].reverse()) {
      await f.dispose().catch(() => {});
    }
    globalThis.fetch = origFetch;
    await fsp.rm(rootDir, { recursive: true, force: true });
  });

  // Wait for antigravity startup loadCodeAssist + catalog load
  await new Promise((r) => setTimeout(r, 80));

  ctx.tools.register(
    defineTool({
      name: 'echo_tool',
      description: 'Echoes input value cleanly',
      parameters: {
        value: { type: 'string', description: 'value to echo', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { echoed: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, val) => [{ type: 'text', text: JSON.stringify(val) }],
      },
      execute: async (args) => ({ echoed: args.value }),
    }),
  );

  // 1. Multi-step tool turn + thoughtSignature replay + JSONL persistence
  const handle = await ctx.agents.create({
    sessionId: 'agent-sess-1',
    agentOptions: {
      provider: 'antigravity',
      model: 'gemini-4-hydrogen',
    },
  });
  const agent = handle.agent;

  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'Run echo_tool please.' }],
      source: { kind: 'user' },
    }),
  );
  await agent.whenIdle();
  await ctx.sessions.flush(agent.session);

  assert.equal(streamPayloads.length, 2);
  // Step 1 & Step 2 both send 65536 (never 262144) & GOOGLE_ONE_AI
  for (const body of streamPayloads) {
    assert.equal(body.request.generationConfig.maxOutputTokens, 65_536);
    assert.deepEqual(body.enabledCreditTypes, ['GOOGLE_ONE_AI']);
  }
  // Step 2 replayed thoughtSignature from Step 1 alongside functionResponse!
  const step2ModelTurn = streamPayloads[1].request.contents.find((c) => c.role === 'model');
  assert.ok(step2ModelTurn);
  assert.equal(step2ModelTurn.parts[0].thoughtSignature, 'c2lnLXR1cm4tMQ==');

  // Inspect real persisted JSONL file on disk (compression: 'none')
  const jsonlFiles = [];
  const walk = async (dir) => {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.name.endsWith('.jsonl')) jsonlFiles.push(full);
    }
  };
  await walk(sessionsDir);
  assert.ok(jsonlFiles.length >= 1);
  const events = fs
    .readFileSync(jsonlFiles[0], 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const reqHeader = events.find((e) => e.type === 'request/header');
  const reqContext = events.find((e) => e.type === 'request/context');
  assert.ok(reqHeader, 'persisted JSONL must record request/header');
  assert.equal(reqHeader.data.header.config.model, 'gemini-4-hydrogen');
  assert.equal(reqHeader.data.header.config.maxTokens, 65_536);
  assert.equal(reqHeader.data.header.adapterDefaults?.maxTokens, true);
  assert.equal(reqContext?.data?.contextWindow, 1_048_576);

  // Verify TokenMeter disjoint measurement works cleanly
  const meter = ctx.tokenMeter.measure(agent.session);
  assert.ok(meter && typeof meter.totalTokens === 'number' && meter.totalTokens > 0);

  // 2. Real dsh-llm-retry MUST NOT retry bare 429 (QUOTA)
  scenario = 'bare_429';
  streamPayloads.length = 0;
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'Trigger bare 429' }],
      source: { kind: 'user' },
    }),
  );
  await agent.whenIdle();
  await ctx.sessions.flush(agent.session);
  assert.equal(streamPayloads.length, 1, 'dsh-llm-retry must not retry QUOTA / bare 429');

  const eventsAfter429 = fs
    .readFileSync(jsonlFiles[0], 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(eventsAfter429.filter((e) => e.type === 'llm/retry').length, 0);

  // 3. Real dsh-llm-retry DOES retry transient 503 (SERVER) and persists llm/retry
  scenario = '503_then_200';
  streamPayloads.length = 0;
  retry503Count = 0;
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'Trigger 503 recovery' }],
      source: { kind: 'user' },
    }),
  );
  await agent.whenIdle();
  await ctx.sessions.flush(agent.session);
  assert.equal(streamPayloads.length, 2, 'dsh-llm-retry recovers after 503 on second attempt');

  const eventsAfter503 = fs
    .readFileSync(jsonlFiles[0], 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(eventsAfter503.filter((e) => e.type === 'llm/retry').length, 1);

  // 4. Real Session fork & resume preserve model header and wire policy
  const forkedSession = ctx.sessions.fork(agent.session, undefined, 'agent-sess-forked');
  assert.equal(forkedSession.id, 'agent-sess-forked');
  await handle.dispose();

  scenario = 'resume_ok';
  streamPayloads.length = 0;
  const resumed = await ctx.agents.resume({
    resumeSessionId: 'agent-sess-1',
    agentOptions: {
      provider: 'antigravity',
      model: 'gemini-4-hydrogen',
    },
  });
  resumed.agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'After resume' }],
      source: { kind: 'user' },
    }),
  );
  await resumed.agent.whenIdle();
  assert.equal(streamPayloads.length, 1);
  assert.equal(streamPayloads[0].request.generationConfig.maxOutputTokens, 65_536);
  await resumed.dispose();
});
