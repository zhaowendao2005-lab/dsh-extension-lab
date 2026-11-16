import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSanitizingGateway } from '../src/runtime/gateway.js';

async function upstreamStub() {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { parsed = undefined; }
      seen.push({ url: req.url, body: parsed, raw: body.toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function post(url, body) {
  const answer = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: answer.status, json: await answer.json().catch(() => undefined) };
}

const declarations = (...names) => [{ functionDeclarations: names.map((name) => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {} } })) }];
const agentBody = (tools) => ({ model: 'test-model', project: 'test-project', request: { contents: [], tools, systemInstruction: { parts: [{ text: 'You are Antigravity.' }] } }, requestType: 'agent' });

test('gateway strips every declaration that is not a DSH bridge tool and replaces the vendor prompt', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  const answer = await post(`${gateway.endpoint}v1internal:streamGenerateContent?alt=sse`, agentBody(declarations('mcp_dsh-bridge_dsh_echo', 'list_resources', 'read_resource', 'manage_task')));
  assert.equal(answer.status, 200);
  assert.equal(upstream.seen.length, 1);
  const sent = upstream.seen[0].body;
  assert.deepEqual(sent.request.tools.flatMap((group) => group.functionDeclarations.map((item) => item.name)), ['mcp_dsh-bridge_dsh_echo']);
  assert.deepEqual(sent.request.systemInstruction, { parts: [{ text: 'DSH system' }] });
  assert.equal(sent.request.contents.length, 0);
  const attested = gateway.attested();
  assert.equal(attested.sanitizedAgentRequests, 1);
  assert.equal(attested.strippedDeclarations, 3);
  assert.equal(attested.systemRewritten, 1);
  assert.deepEqual(attested.lastStripped, ['list_resources', 'read_resource', 'manage_task']);
});

test('gateway drops the tools field entirely when nothing but DSH bridge tools remain', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  await post(`${gateway.endpoint}v1internal:streamGenerateContent`, agentBody(declarations('manage_task')));
  assert.equal('tools' in upstream.seen[0].body.request, false);
  assert.equal(gateway.attested().sanitizedAgentRequests, 1);
});

test('gateway passes non-generation traffic through untouched', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  const answer = await post(`${gateway.endpoint}v1internal:loadCodeAssist`, { metadata: { pluginType: 'GEMINI' } });
  assert.equal(answer.status, 200);
  assert.deepEqual(upstream.seen[0].body, { metadata: { pluginType: 'GEMINI' } });
  assert.equal(gateway.attested().generationRequests, 0);
});

test('gateway refuses unknown path tokens without touching upstream', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  const port = new URL(gateway.endpoint).port;
  const answer = await post(`http://127.0.0.1:${port}/wrong-token/v1internal:streamGenerateContent`, agentBody(declarations('manage_task')));
  assert.equal(answer.status, 404);
  assert.equal(upstream.seen.length, 0);
});

test('gateway fails closed on an unparseable agent request', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  const answer = await post(`${gateway.endpoint}v1internal:streamGenerateContent`, '{not json');
  // 4xx, not 502: a deterministic refusal must not look transient to the CLI.
  assert.equal(answer.status, 400);
  assert.equal(upstream.seen.length, 0);
  assert.equal(gateway.attested().refusals, 1);
  assert.equal(gateway.attested().sanitizedAgentRequests, 0);
});

test('gateway refuses an agent turn when no DSH system instruction is configured', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  const answer = await post(`${gateway.endpoint}v1internal:streamGenerateContent`, agentBody(declarations('mcp_dsh-bridge_dsh_echo')));
  assert.equal(answer.status, 400);
  assert.equal(upstream.seen.length, 0);
  assert.equal(gateway.attested().sanitizedAgentRequests, 0);
});

test('gateway strips tools from the title utility request without rewriting its prompt', async (t) => {
  const upstream = await upstreamStub();
  const gateway = await createSanitizingGateway({ upstream: upstream.base, systemInstruction: 'DSH system' });
  t.after(async () => { await gateway.close(); await upstream.close(); });
  await post(`${gateway.endpoint}v1internal:streamGenerateContent`, { request: { tools: declarations('manage_task') }, requestType: 'checkpoint' });
  assert.equal('tools' in upstream.seen[0].body.request, false);
  assert.equal(gateway.attested().sanitizedAgentRequests, 0);
  assert.equal(gateway.attested().generationRequests, 1);
});
