import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BRIDGE_TOOL_PREFIX } from '../purity.js';

// The CLI declares native tools (manage_task always, plus MCP session helpers)
// that no configuration key can remove. This gateway is the mechanical answer:
// the CLI child is pointed at a loopback endpoint, every model call is parsed
// before it leaves the process, and any declaration that is not a DSH bridge
// tool is removed. The same pass replaces the vendor system prompt with the DSH
// one. Failure is closed: an unparseable agent request is never forwarded.
export const DEFAULT_UPSTREAM = 'https://daily-cloudcode-pa.googleapis.com';
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const GENERATION_PATH = /streamGenerateContent/;
const REQUEST_HEADERS_DROPPED = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);
const RESPONSE_HEADERS_DROPPED = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export class GatewayError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'GatewayError';
    this.code = code;
  }
}

function json(res, status, code) {
  const payload = JSON.stringify({ error: { code, message: 'The local Antigravity purity gateway refused this request.' } });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sanitizeDeclarations(tools, keep) {
  const stripped = [];
  const groups = [];
  for (const group of tools) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.functionDeclarations)) {
      throw new GatewayError('ACP_GATEWAY_TOOLS_MALFORMED', 'A tool group is not a declaration list.');
    }
    const kept = [];
    for (const declaration of group.functionDeclarations) {
      if (declaration && typeof declaration === 'object' && typeof declaration.name === 'string' && keep(declaration.name)) kept.push(declaration);
      else stripped.push(declaration && typeof declaration === 'object' && typeof declaration.name === 'string' ? declaration.name : '<unnamed>');
    }
    if (kept.length) groups.push({ ...group, functionDeclarations: kept });
  }
  return { groups, stripped };
}

/**
 * Starts a loopback sanitizing gateway for one CLI child.
 * The endpoint carries a random path token, so only the child holding the argv
 * can use it. No request or response body is ever persisted.
 */
export async function createSanitizingGateway({ upstream = DEFAULT_UPSTREAM, systemInstruction = '', bridgeToolPrefix = BRIDGE_TOOL_PREFIX, timeoutMs = 600_000 } = {}) {
  if (typeof systemInstruction !== 'string' || systemInstruction.includes('\0')) throw new GatewayError('ACP_GATEWAY_SYSTEM_INVALID', 'The DSH system instruction must be a string without NUL bytes.');
  if (typeof bridgeToolPrefix !== 'string' || !bridgeToolPrefix.length) throw new GatewayError('ACP_GATEWAY_PREFIX_INVALID', 'A bridge tool prefix is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 1_800_000) throw new GatewayError('ACP_GATEWAY_TIMEOUT_INVALID', 'The gateway timeout is out of range.');
  let target;
  try { target = new URL(upstream); } catch { throw new GatewayError('ACP_GATEWAY_UPSTREAM_INVALID', 'The upstream endpoint must be an absolute URL.'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new GatewayError('ACP_GATEWAY_UPSTREAM_INVALID', 'The upstream endpoint must be a plain HTTP(S) origin.');
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const token = randomBytes(24).toString('hex');
  const prefix = `/${token}/`;
  const sockets = new Set();
  const state = { requests: 0, generationRequests: 0, sanitizedAgentRequests: 0, forwardedDeclarations: 0, strippedDeclarations: 0, systemRewritten: 0, refusals: 0, lastStripped: [] };
  // The CLI retries an upstream refusal in-process and reports it as text only
  // after every attempt. A repeated agent-turn refusal is surfaced immediately so
  // a dead request does not hold the turn for minutes.
  let resolveFailure;
  const failure = new Promise((resolve) => { resolveFailure = resolve; });
  let agentFailures = 0; let notified = false;

  const forward = (req, res, body, path, agentTurn = false) => {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) if (!REQUEST_HEADERS_DROPPED.has(key) && value !== undefined) headers[key] = value;
    const options = { hostname: target.hostname, port: target.port || undefined, method: req.method, path, headers, timeout: timeoutMs };
    const upstream = transport(options, (answer) => {
      if (agentTurn && answer.statusCode === 429) {
        agentFailures += 1;
        if (agentFailures >= 2 && !notified) { notified = true; resolveFailure({ status: 429, attempts: agentFailures }); }
      }
      const responseHeaders = {};
      for (const [key, value] of Object.entries(answer.headers)) if (!RESPONSE_HEADERS_DROPPED.has(key) && value !== undefined) responseHeaders[key] = value;
      res.writeHead(answer.statusCode ?? 502, responseHeaders);
      answer.pipe(res);
      answer.on('error', () => res.destroy());
    });
    upstream.on('timeout', () => upstream.destroy(new GatewayError('ACP_GATEWAY_UPSTREAM_TIMEOUT', 'The upstream endpoint did not answer in time.')));
    upstream.on('error', (error) => {
      if (!res.headersSent) json(res, 502, 'ACP_GATEWAY_UPSTREAM_FAILED');
      else res.destroy();
      void error;
    });
    req.on('aborted', () => upstream.destroy());
    upstream.end(body);
  };

  const sanitize = (req, res, body, turn = {}) => {
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); }
    catch { throw new GatewayError('ACP_GATEWAY_UNPARSEABLE_REQUEST', 'The agent request is not JSON.'); }
    if (!payload || typeof payload !== 'object' || !payload.request || typeof payload.request !== 'object') throw new GatewayError('ACP_GATEWAY_UNPARSEABLE_REQUEST', 'The agent request has no request object.');
    const request = payload.request;
    const requestType = typeof payload.requestType === 'string' ? payload.requestType : 'agent';
    const agentTurn = requestType !== 'checkpoint';
    turn.agent = agentTurn;
    let stripped = [];
    if (request.tools !== undefined) {
      if (!Array.isArray(request.tools)) throw new GatewayError('ACP_GATEWAY_TOOLS_MALFORMED', 'The tool list is not an array.');
      const outcome = sanitizeDeclarations(request.tools, (name) => name.startsWith(bridgeToolPrefix));
      stripped = outcome.stripped;
      request.tools = outcome.groups;
      if (!outcome.groups.length) delete request.tools;
    }
    if (agentTurn) {
      if (!systemInstruction) throw new GatewayError('ACP_GATEWAY_SYSTEM_UNAVAILABLE', 'No DSH system instruction is configured for this session.');
      request.systemInstruction = { parts: [{ text: systemInstruction }] };
      state.systemRewritten += 1;
    }
    state.generationRequests += 1;
    if (agentTurn) state.sanitizedAgentRequests += 1;
    state.forwardedDeclarations += (request.tools ?? []).reduce((total, group) => total + group.functionDeclarations.length, 0);
    state.strippedDeclarations += stripped.length;
    state.lastStripped = stripped;
    return Buffer.from(JSON.stringify(payload), 'utf8');
  };

  const handler = (req, res) => {
    state.requests += 1;
    if (typeof req.url !== 'string' || !req.url.startsWith(prefix)) return json(res, 404, 'ACP_GATEWAY_UNKNOWN_PATH');
    const path = `/${req.url.slice(prefix.length)}`;
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { tooLarge = true; json(res, 413, 'ACP_GATEWAY_BODY_TOO_LARGE'); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      if (tooLarge) return;
      const body = Buffer.concat(chunks);
      try {
        if (!GENERATION_PATH.test(path)) return forward(req, res, body, path);
        const turn = { agent: false };
        forward(req, res, sanitize(req, res, body, turn), path, turn.agent);
      } catch (error) {
        state.refusals += 1;
        if (res.writableEnded || res.destroyed) return;
        // Deterministic contract refusals are not transient: answer 4xx so the CLI
        // fails fast instead of retrying a request that must never reach upstream.
        if (error instanceof GatewayError) return json(res, 400, error.code);
        json(res, 400, 'ACP_GATEWAY_FAILED');
        void error;
      }
    });
  };

  const server = createServer(handler);
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const { port } = server.address();
  let closed;
  return Object.freeze({
    endpoint: `http://127.0.0.1:${port}${prefix}`,
    systemInstruction,
    failure,
    attested() { return { ...state, lastStripped: [...state.lastStripped] }; },
    close() {
      closed ??= (async () => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        await new Promise((resolve) => server.close(() => resolve()));
      })();
      return closed;
    },
  });
}
