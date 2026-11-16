import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, CallToolResultSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { cloneJson, createToolRegistry } from './schema.js';

const BODY_LIMIT = 1024 * 1024;
const RESULT_LIMIT = 4 * 1024 * 1024;
const MAX_REQUESTS = 10000;
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

function boundedInteger(value, fallback, min, max, label) {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < min || actual > max) throw new TypeError(`Invalid ${label}`);
  return actual;
}

function reply(res, status, message) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
}

function oneHeader(req, name) {
  // Node normalizes/joins some duplicate headers. Check their raw occurrences
  // before reading the normalized value, including Authorization and Host.
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
  return count === 1 && typeof req.headers[name] === 'string' ? req.headers[name] : undefined;
}

function rpcKey(id) {
  if (typeof id === 'string' && id.length > 0 && id.length <= 128) return `s:${id}`;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return `n:${id}`;
  return undefined;
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * A single-generation MCP bridge. It never executes DSH tools itself.
 * onCall receives {id, name: originalDshName, arguments: JSON.stringify(args)}.
 * Only authenticated, schema-valid tools/call requests can reach onCall.
 */
export async function createToolBridge({ tools, onCall, maxPending, timeoutMs } = {}) {
  if (typeof onCall !== 'function') throw new TypeError('onCall must be a function');
  const capacity = boundedInteger(maxPending, 32, 1, 256, 'maxPending');
  const timeout = boundedInteger(timeoutMs, DEFAULT_TIMEOUT, 1, 30 * 60 * 1000, 'timeoutMs');
  const registry = createToolRegistry(tools);
  const token = randomBytes(32).toString('base64url');
  const authorization = Buffer.from(`Bearer ${token}`);
  const generation = randomBytes(16).toString('hex');
  const pending = new Map();
  const byRequest = new Map();
  const seenRequests = new Set();
  const sockets = new Set();
  let closed = false;
  let initializing = false;
  let sessionClosed = false;
  let closePromise;
  let host;
  let origin;

  const settle = (id, result) => {
    const call = pending.get(id);
    if (!call) return false;
    pending.delete(id);
    byRequest.delete(call.rpcKey);
    clearTimeout(call.timer);
    call.signal.removeEventListener('abort', call.abort);
    call.finish(result);
    return true;
  };
  const cancelAll = (message) => {
    for (const id of pending.keys()) settle(id, errorResult(message));
  };

  const sdk = new Server({ name: 'dsh-antigravity-acp-bridge', version: '0.1.0' }, {
    capabilities: { tools: {} }, enforceStrictCapabilities: true,
  });
  sdk.setRequestHandler(ListToolsRequestSchema, () => ({ tools: registry.list() }));
  sdk.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    if (closed || sessionClosed || extra.signal.aborted) throw new McpError(ErrorCode.InvalidRequest, 'Bridge generation is closed');
    const tool = registry.get(request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, 'Unknown bridge tool');
    // The JSON-RPC parser checks the outer object; Ajv checks exactly the
    // published tool schema without coercion, defaults, or property removal.
    const args = request.params.arguments ?? {};
    if (!tool.validate(args)) throw new McpError(ErrorCode.InvalidParams, 'Tool arguments do not match the published schema');
    if (pending.size >= capacity) throw new McpError(-32001, 'Bridge pending-call limit reached');
    const key = rpcKey(extra.requestId);
    if (!key || byRequest.has(key)) throw new McpError(ErrorCode.InvalidRequest, 'Duplicate or invalid request identity');
    const id = `dsh_${generation}_${randomBytes(16).toString('hex')}`;
    const promise = new Promise((finish) => {
      const abort = () => settle(id, errorResult('Bridge call was cancelled; execution may already have occurred'));
      const timer = setTimeout(() => settle(id, errorResult('Bridge call timed out; execution may already have occurred')), timeout);
      timer.unref?.();
      pending.set(id, { finish, timer, abort, signal: extra.signal, rpcKey: key });
      byRequest.set(key, id);
      extra.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      // The callback is an event delivery, not the actual tool execution.
      Promise.resolve(onCall(Object.freeze({ id, name: tool.originalName, arguments: JSON.stringify(args) })))
        .catch(() => settle(id, errorResult('DSH could not accept the bridge call')));
    } catch {
      settle(id, errorResult('DSH could not accept the bridge call'));
    }
    return promise;
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomBytes(32).toString('base64url'),
    enableJsonResponse: true,
    onsessionclosed: () => {
      sessionClosed = true;
      cancelAll('MCP session closed; execution may already have occurred');
    },
  });
  await sdk.connect(transport);

  const http = createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    // This wrapper only enforces HTTP trust/size/identity boundaries. All MCP
    // protocol processing is delegated to the official SDK transport.
    void (async () => {
      res.setHeader('Cache-Control', 'no-store');
      if (closed || sessionClosed) return reply(res, 410, 'Bridge generation is closed');
      if (req.socket.remoteAddress !== '127.0.0.1') return reply(res, 403, 'Loopback access required');
      if (oneHeader(req, 'host') !== host) return reply(res, 403, 'Invalid Host');
      if (req.headers.origin !== undefined && oneHeader(req, 'origin') !== origin) return reply(res, 403, 'Invalid Origin');
      if (req.url !== '/mcp') return reply(res, 404, 'Unknown endpoint');
      const header = oneHeader(req, 'authorization');
      const candidate = typeof header === 'string' ? Buffer.from(header) : Buffer.alloc(0);
      if (candidate.length !== authorization.length || !timingSafeEqual(candidate, authorization)) return reply(res, 401, 'Unauthorized');
      if (!['POST', 'GET', 'DELETE'].includes(req.method)) return reply(res, 405, 'Method not allowed');
      if (req.headers['content-encoding'] !== undefined) return reply(res, 415, 'Encoded bodies are unsupported');
      if (req.headers['last-event-id'] !== undefined) return reply(res, 400, 'Request replay is unsupported');
      const session = req.headers['mcp-session-id'] === undefined ? undefined : oneHeader(req, 'mcp-session-id');
      let body;
      let key;
      if (req.method === 'POST') {
        const contentType = oneHeader(req, 'content-type');
        if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return reply(res, 415, 'JSON body required');
        const length = req.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return reply(res, 413, 'Request body exceeds limit');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > BODY_LIMIT) return reply(res, 413, 'Request body exceeds limit');
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reply(res, 400, 'Invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(res, 400, 'A single MCP message is required');
        if (Object.hasOwn(body, 'id')) {
          key = rpcKey(body.id);
          if (!key) return reply(res, 400, 'Invalid request identity');
          if (seenRequests.has(key)) return reply(res, 409, 'Request identity has already been used');
          if (seenRequests.size >= MAX_REQUESTS) return reply(res, 429, 'Bridge request budget exhausted');
        }
        if (transport.sessionId === undefined) {
          if (initializing || session !== undefined || body.method !== 'initialize' || !key) return reply(res, 400, 'MCP initialization required');
          initializing = true;
        } else if (body.method === 'initialize') {
          return reply(res, 409, 'MCP session is already initialized');
        } else if (session !== transport.sessionId) {
          return reply(res, 404, 'Unknown MCP session');
        }
        if (key) seenRequests.add(key);
        if (body.method === 'tools/call' && key) {
          res.once('close', () => {
            if (!res.writableEnded) {
              const id = byRequest.get(key);
              if (id) settle(id, errorResult('MCP connection closed; execution may already have occurred'));
            }
          });
        }
      } else if (session !== transport.sessionId || !session) {
        return reply(res, 404, 'Unknown MCP session');
      }
      await transport.handleRequest(req, res, body);
    })().catch(() => reply(res, 400, 'Bridge request failed'));
  });
  http.maxConnections = 64;
  http.keepAliveTimeout = 5000;
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => {
      http.off('error', reject);
      resolve();
    });
  });
  host = `127.0.0.1:${http.address().port}`;
  origin = `http://${host}`;

  return Object.freeze({
    url: `${origin}/mcp`, token, toolNames: registry.toolNames,
    mappedName: (name) => registry.mappedName(name),
    get pendingCount() { return pending.size; },
    resolve(id, result) {
      if (closed || !pending.has(id)) return false;
      if (!result || typeof result !== 'object' || !Array.isArray(result.content) ||
        (result.isError !== undefined && typeof result.isError !== 'boolean')) throw new TypeError('Invalid MCP tool result');
      const payload = cloneJson({ content: result.content, ...(result.isError === undefined ? {} : { isError: result.isError }) });
      if (Buffer.byteLength(JSON.stringify(payload)) > RESULT_LIMIT || !CallToolResultSchema.safeParse(payload).success) {
        throw new TypeError('Unsupported or oversized MCP tool result');
      }
      return settle(id, payload);
    },
    close() {
      if (!closePromise) {
        closed = true;
        cancelAll('Bridge generation closed; execution may already have occurred');
        closePromise = (async () => {
          await sdk.close();
          await new Promise((resolve) => {
            http.close(resolve);
            for (const socket of sockets) socket.destroy();
          });
        })();
      }
      return closePromise;
    },
  });
}
