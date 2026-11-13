import assert from 'node:assert/strict';
import test from 'node:test';
import { importDshLlm, importHostModule } from './helpers/load-host.mjs';

const translateMod = await importHostModule('src/host/translate.ts');
const replayMod = await importHostModule('src/host/replay.ts');
const identityMod = await importHostModule('src/host/identity.ts');
const dshLlm = await importDshLlm();

function makeMockReadableStream(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      }
      controller.close();
    },
  });
}

test('translate: exact v1internal key ordering, system freezing, and countTokens envelope', () => {
  const sysLead = dshLlm.createSystemMessage('Lead system instructions');
  const user1 = dshLlm.createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Read README' }],
  });
  // Mid-conversation system & developer messages must NOT overwrite systemInstruction
  const midSystem = dshLlm.createSystemMessage('Mid update </system-reminder> alert');
  const midDev = dshLlm.createDeveloperMessage({
    source: { kind: 'user' },
    content: [{ type: 'tool-addition', toolName: 'grep_search' }],
  });

  const builtNoTools = translateMod.buildAntigravityRequest({
    options: {
      provider: 'antigravity',
      model: 'gemini-3-flash',
      messages: [dshLlm.createSystemMessage('Hello sys'), dshLlm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hi' }] })],
      maxTokens: 1024,
      temperature: 0.2,
    },
    accountId: 'acc-1',
    accountEmail: 'alice@gmail.com',
    projectId: 'proj-alpha',
  });

  // Top-level key order without tools: omit requestType completely
  assert.deepEqual(Object.keys(builtNoTools.envelope), [
    'project',
    'requestId',
    'request',
    'model',
    'userAgent',
  ]);
  assert.equal(builtNoTools.hasToolActivity, false);
  assert.equal(builtNoTools.envelope.userAgent, 'antigravity');

  const builtWithTools = translateMod.buildAntigravityRequest({
    options: {
      provider: 'antigravity',
      model: 'gemini-3-pro-high', // normalizes to gemini-3.1-pro-high
      system: 'One-shot top system',
      messages: [sysLead, user1, midSystem, midDev],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            additionalProperties: false,
            $defs: {
              PosInt: { type: 'integer', exclusiveMinimum: 0 },
            },
            properties: {
              path: { type: 'string' },
              line: { $ref: '#/$defs/PosInt' },
              filter: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional filter' },
            },
            required: ['path'],
          },
        },
      ],
      reasoningEffort: dshLlm.ReasoningEffortId('high'),
      maxTokens: 4096,
    },
    accountId: 'acc-2',
    accountEmail: 'corp@company.com',
    projectId: 'proj-corp',
    sessionGeneration: 0,
  });

  // Top-level key order with tools includes `requestType: 'agent'` at end
  assert.deepEqual(Object.keys(builtWithTools.envelope), [
    'project',
    'requestId',
    'request',
    'model',
    'userAgent',
    'requestType',
  ]);
  assert.equal(builtWithTools.envelope.model, 'gemini-3.1-pro-high');
  assert.equal(builtWithTools.envelope.userAgent, 'jetski');
  assert.equal(builtWithTools.envelope.requestType, 'agent');

  const inner = builtWithTools.envelope.request;
  assert.deepEqual(Object.keys(inner), [
    'contents',
    'systemInstruction',
    'tools',
    'labels',
    'generationConfig',
    'sessionId',
  ]);

  // Leading systems merged into frozen systemInstruction; mid-convo wrapped into <system-reminder>
  assert.equal(
    inner.systemInstruction.parts[0].text,
    'One-shot top system\n\nLead system instructions',
  );
  // Consecutive user/midSystem/midDev merged into a single alternating 'user' turn
  assert.equal(inner.contents.length, 1);
  assert.equal(inner.contents[0].role, 'user');
  assert.equal(inner.contents[0].parts[0].text, 'Read README');
  assert.ok(inner.contents[0].parts[1].text.includes('<system-reminder>'));
  assert.ok(inner.contents[0].parts[1].text.includes('<\\/system-reminder>'));
  assert.ok(inner.contents[0].parts[2].text.includes('[tool-added: grep_search]'));

  // Cleaned schema types & stripped JSON Schema keywords
  const params = inner.tools[0].functionDeclarations[0].parameters;
  assert.equal(params.type, 'OBJECT');
  assert.equal(params.additionalProperties, undefined);
  assert.equal(params.$schema, undefined);
  assert.equal(params.$defs, undefined);
  assert.equal(params.properties.line.type, 'INTEGER');
  assert.equal(params.properties.line.exclusiveMinimum, undefined);
  assert.equal(params.properties.filter.type, 'STRING');
  assert.equal(params.properties.filter.nullable, true);

  // Gemini 3 uses thinkingLevel
  assert.deepEqual(inner.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'HIGH',
  });

  // countTokens envelope strips top-level metadata & safetySettings
  const ct = translateMod.buildCountTokensEnvelope({
    ...inner,
    safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }],
  });
  assert.deepEqual(Object.keys(ct), ['request']);
  assert.equal(ct.request.safetySettings, undefined);
});

test('translate + BlockAssembler + replay: streaming SSE decode, real BlockAssembler, and signature round-trip', async () => {
  const decoder = new translateMod.GeminiSseStreamDecoder(
    'gemini-3.1-pro-high',
    'acc-1',
    'agent-req-1',
  );
  const enc = new TextEncoder();

  // Split UTF-8 / SSE frames across odd byte boundaries, including reasoning + signature + text + functionCall + trailing empty text chunk
  const sseText =
    'data: ' +
    JSON.stringify({
      response: {
        responseId: 'resp-abc',
        candidates: [
          {
            content: {
              parts: [
                { text: 'Plan step 1', thought: true, thoughtSignature: 'sig_reason_123' },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 500, cachedContentTokenCount: 200 },
      },
    }) +
    '\n\n' +
    'data: ' +
    JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Checking file...' },
                {
                  functionCall: { id: 'fc_1', name: 'read_file', args: { path: 'README.md' } },
                  thoughtSignature: 'sig_fc_999',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { candidatesTokenCount: 40, thoughtsTokenCount: 60 },
      },
    }) +
    '\n\n' +
    // Gemini trailing empty filler part must not create a spurious empty block
    'data: ' +
    JSON.stringify({
      response: {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }],
      },
    }) +
    '\n\ndata: [DONE]\n\n';

  const bytes = enc.encode(sseText);
  const splitPoint = Math.floor(bytes.length / 2);

  const chunks = [
    ...decoder.feed(bytes.subarray(0, splitPoint)),
    ...decoder.feed(bytes.subarray(splitPoint)),
    ...decoder.finish().chunks,
  ];

  // Validate against the REAL @deepseek-ai/dsh-llm BlockAssembler
  const assembler = new dshLlm.BlockAssembler();
  for (const chunk of chunks) {
    assembler.push(chunk);
  }
  const assembled = assembler.assembled();

  assert.equal(assembled.blocks.length, 3);
  assert.deepEqual(
    assembled.blocks.map((b) => b.type),
    ['reasoning', 'text', 'tool-call'],
  );
  assert.equal(assembled.blocks[2].name, 'read_file');
  assert.equal(typeof assembled.blocks[2].arguments, 'string');
  assert.deepEqual(JSON.parse(assembled.blocks[2].arguments), { path: 'README.md' });
  assert.equal(assembler._finish.kind, 'tool-calls');
  assert.equal(assembled.replay?.blocks?.length, 3);

  // Round-trip assembled message back into next turn request
  const userMsg = dshLlm.createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Read README.md' }],
  });
  const assistantMsg = dshLlm.createAssistantMessage({
    content: assembled.blocks,
    source: {
      provider: 'antigravity',
      model: 'gemini-3.1-pro-high',
      replayState: assembled.replay,
    },
  });
  const toolResultMsg = dshLlm.createToolResultMessage({
    callId: assembled.blocks[2].id,
    content: [{ type: 'text', text: '# DSH Extension Lab' }],
    isError: false,
  });

  const roundTrip = translateMod.buildAntigravityRequest({
    options: {
      provider: 'antigravity',
      model: 'gemini-3.1-pro-high',
      messages: [userMsg, assistantMsg, toolResultMsg],
      tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
    },
    accountId: 'acc-1',
    projectId: 'proj-1',
  });

  const modelParts = roundTrip.envelope.request.contents[1].parts;
  assert.equal(modelParts[0].thought, true);
  assert.equal(modelParts[0].thoughtSignature, 'sig_reason_123');
  assert.equal(modelParts[2].functionCall.name, 'read_file');
  assert.equal(modelParts[2].thoughtSignature, 'sig_fc_999');

  // Tool result turn recovers tool function name & structured response
  const toolParts = roundTrip.envelope.request.contents[2].parts;
  assert.deepEqual(toolParts[0], {
    functionResponse: {
      id: assembled.blocks[2].id,
      name: 'read_file',
      response: { output: '# DSH Extension Lab' },
    },
  });
});

test('replay: unsigned functionCall gets sentinel strictly on first call', () => {
  const userMsg = dshLlm.createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Do two calls' }],
  });
  const call1 = dshLlm.ToolCallId('c1');
  const call2 = dshLlm.ToolCallId('c2');
  const unsignedAssistant = dshLlm.createAssistantMessage({
    content: [
      { type: 'reasoning', text: 'Some foreign reasoning' },
      { type: 'tool-call', id: call1, name: 'tool_a', arguments: '{"x":1}' },
      { type: 'tool-call', id: call2, name: 'tool_b', arguments: '{"y":2}' },
    ],
    source: {
      provider: 'antigravity',
      model: 'gemini-2.5-flash',
      // No signatures recorded (simulates foreign or degraded history)
    },
  });

  const req = translateMod.buildAntigravityRequest({
    options: {
      provider: 'antigravity',
      model: 'gemini-2.5-flash',
      messages: [userMsg, unsignedAssistant],
      tools: [
        { name: 'tool_a', description: 'A', parameters: { type: 'object' } },
        { name: 'tool_b', description: 'B', parameters: { type: 'object' } },
      ],
    },
    accountId: 'acc-1',
    projectId: 'proj-1',
  });

  const modelParts = req.envelope.request.contents[1].parts;
  // Reasoning has no fake signature; first functionCall has Base64 skip sentinel; second does not
  assert.equal(modelParts[0].thoughtSignature, undefined);
  assert.equal(modelParts[1].thoughtSignature, replayMod.GEMINI_SENTINEL_THOUGHT_SIGNATURE);
  assert.equal(modelParts[2].thoughtSignature, undefined);
  assert.equal(identityMod.deriveUpstreamSessionId('acc-1', undefined, 0).length > 0, true);
});

test('translate: empty SSE filler chunk reports hasOutput:false & stream errors throw AntigravityUpstreamError', () => {
  const emptyDec = new translateMod.GeminiSseStreamDecoder('gemini-3-flash');
  emptyDec.feed(
    new TextEncoder().encode(
      'data: ' + JSON.stringify({ response: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }] } }) + '\n\n',
    ),
  );
  const done = emptyDec.finish();
  assert.equal(done.hasOutput, false);

  const errDec = new translateMod.GeminiSseStreamDecoder('gemini-3-flash');
  assert.throws(
    () =>
      errDec.feed(
        new TextEncoder().encode(
          'data: ' + JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED: quota_exhausted' } }) + '\n\n',
        ),
      ),
    (err) => err.code === 'QUOTA',
  );
  assert.ok(makeMockReadableStream(['ok']));
});
