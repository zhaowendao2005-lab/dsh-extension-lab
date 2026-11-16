import { StringDecoder } from 'node:string_decoder';

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export class ProtocolError extends Error {
  constructor(message, code = 'ACP_PROTOCOL_ERROR') {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export function abortError() {
  const error = new Error('ACP operation aborted');
  error.name = 'AbortError';
  return error;
}

function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id));
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Newline JSON-RPC over already-owned Node streams. Does not own their process. */
export function createConnection({
  input,
  output,
  maxFrameBytes = 8 * 1024 * 1024,
  maxPendingRequests = 128,
  maxInboundRequests = 64,
  defaultTimeoutMs = 30_000,
} = {}) {
  if (!input?.on || !output?.write) throw new TypeError('ACP requires readable input and writable output');
  for (const [name, value] of Object.entries({ maxFrameBytes, maxPendingRequests, maxInboundRequests, defaultTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  let nextId = 0;
  let stopped = false;
  let failure;
  let partial = Buffer.alloc(0);
  let queuedBytes = 0;
  let writeTail = Promise.resolve();
  let handler;
  const pending = new Map();
  const incoming = new Set();
  const retired = new Set();
  const listeners = new Set();
  const writes = new Set();
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  const ignoreLateError = () => {};
  function close(error = new ProtocolError('ACP connection closed', 'ACP_CLOSED')) {
    if (stopped) return;
    stopped = true;
    failure = error instanceof Error ? error : new ProtocolError('ACP connection closed');
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('error', onStreamError);
    input.off('close', onInputClose);
    output.off('error', onStreamError);
    output.off('close', onOutputClose);
    // Owned pipes may still emit EPIPE while their process is being torn down.
    input.on('error', ignoreLateError);
    output.on('error', ignoreLateError);
    partial = Buffer.alloc(0);
    for (const item of pending.values()) {
      item.cleanup();
      item.reject(failure);
    }
    pending.clear();
    for (const reject of writes) reject(failure);
    writes.clear();
    incoming.clear();
    listeners.clear();
    resolveClosed({ error: failure });
  }

  function remember(id) {
    retired.add(id);
    if (retired.size > 1024) retired.delete(retired.values().next().value);
  }

  function write(message, shouldWrite = () => true) {
    if (stopped) return Promise.reject(failure);
    let encoded;
    try { encoded = Buffer.from(`${JSON.stringify(message)}\n`); }
    catch { return Promise.reject(new ProtocolError('ACP message is not JSON serializable')); }
    if (encoded.length - 1 > maxFrameBytes) return Promise.reject(new ProtocolError('ACP outgoing frame exceeds byte limit', 'ACP_FRAME_LIMIT'));
    if (queuedBytes + encoded.length > maxFrameBytes * 4) {
      const error = new ProtocolError('ACP outgoing queue exceeds byte limit', 'ACP_QUEUE_LIMIT');
      close(error);
      return Promise.reject(error);
    }
    queuedBytes += encoded.length;
    let rejectOnClose;
    const interrupted = new Promise((_, reject) => { rejectOnClose = reject; writes.add(reject); });
    const work = Promise.race([writeTail.then(() => {
      if (stopped) throw failure;
      if (!shouldWrite()) return undefined;
      return new Promise((resolve, reject) => {
        try { output.write(encoded, (error) => error ? reject(error) : resolve()); }
        catch (error) { reject(error); }
      });
    }), interrupted]);
    writeTail = work.catch((error) => { close(error); });
    return work.finally(() => { queuedBytes -= encoded.length; writes.delete(rejectOnClose); });
  }

  function respond(id, result, error) {
    if (stopped) return;
    const message = error
      ? { jsonrpc: '2.0', id, error: { code: error instanceof RpcError ? error.code : -32603, message: error instanceof RpcError ? error.message : 'ACP request handler failed', ...(error instanceof RpcError && error.data !== undefined ? { data: error.data } : {}) } }
      : { jsonrpc: '2.0', id, result: result === undefined ? null : result };
    void write(message).catch(close);
  }

  function dispatch(message) {
    if (!record(message) || message.jsonrpc !== '2.0') throw new ProtocolError('Invalid ACP JSON-RPC envelope');
    const hasId = Object.hasOwn(message, 'id');
    const hasMethod = Object.hasOwn(message, 'method');
    if (hasMethod) {
      if (typeof message.method !== 'string' || !message.method || Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) throw new ProtocolError('Invalid ACP request envelope');
      if (message.params !== undefined && !record(message.params) && !Array.isArray(message.params)) throw new ProtocolError('Invalid ACP request parameters');
      if (hasId) {
        if (!validId(message.id)) throw new ProtocolError('Invalid ACP request ID');
        if (incoming.has(message.id)) throw new ProtocolError('Duplicate active ACP server request ID');
        if (incoming.size >= maxInboundRequests) throw new ProtocolError('ACP inbound request limit exceeded', 'ACP_REQUEST_LIMIT');
        incoming.add(message.id);
        Promise.resolve().then(() => {
          if (stopped) return undefined;
          if (!handler) throw new RpcError(-32601, 'ACP client method is not supported');
          return handler(message.method, message.params);
        }).then(
          (result) => { incoming.delete(message.id); respond(message.id, result); },
          (error) => { incoming.delete(message.id); respond(message.id, undefined, error); },
        );
      } else {
        for (const listener of listeners) {
          try { Promise.resolve(listener(message.method, message.params)).catch(close); }
          catch (error) { close(error); break; }
        }
      }
      return;
    }
    if (!hasId || !validId(message.id)) throw new ProtocolError('Invalid ACP response ID');
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    if (hasResult === hasError) throw new ProtocolError('ACP response requires exactly one result or error');
    if (hasError && (!record(message.error) || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string')) throw new ProtocolError('Invalid ACP error response');
    const item = pending.get(message.id);
    if (!item) {
      if (retired.has(message.id)) return; // A timed-out or cancelled request can still receive a late response.
      throw new ProtocolError('ACP response has an unknown request ID');
    }
    pending.delete(message.id);
    remember(message.id);
    item.cleanup();
    if (hasError) item.reject(new RpcError(message.error.code, message.error.message, message.error.data));
    else item.resolve(message.result);
  }

  function decodeFrame(frame) {
    if (!frame.length) return;
    // Reject malformed UTF-8 rather than letting replacement characters alter JSON strings.
    const decoder = new StringDecoder('utf8');
    const text = decoder.write(frame) + decoder.end();
    if (!Buffer.from(text).equals(frame)) throw new ProtocolError('ACP frame is not valid UTF-8');
    if (!text.trim()) return;
    let message;
    try { message = JSON.parse(text); }
    catch { throw new ProtocolError('Malformed ACP JSON frame'); }
    dispatch(message);
  }

  function onData(chunk) {
    if (stopped) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(10, start);
        const end = newline === -1 ? bytes.length : newline;
        const part = bytes.subarray(start, end);
        if (partial.length + part.length > maxFrameBytes) throw new ProtocolError('ACP incoming frame exceeds byte limit', 'ACP_FRAME_LIMIT');
        if (part.length) partial = partial.length ? Buffer.concat([partial, part]) : Buffer.from(part);
        if (newline === -1) break;
        decodeFrame(partial);
        partial = Buffer.alloc(0);
        if (stopped) break;
        start = newline + 1;
      }
    } catch (error) { close(error); }
  }

  function onEnd() {
    close(new ProtocolError(partial.length ? 'ACP stream ended inside a JSON frame' : 'ACP stream reached EOF', 'ACP_EOF'));
  }
  function onStreamError(error) { close(error); }
  function onInputClose() { close(new ProtocolError('ACP input stream closed', 'ACP_EOF')); }
  function onOutputClose() { close(new ProtocolError('ACP output stream closed', 'ACP_EOF')); }
  input.on('data', onData);
  input.on('end', onEnd);
  input.on('error', onStreamError);
  input.on('close', onInputClose);
  output.on('error', onStreamError);
  output.on('close', onOutputClose);

  return {
    closed,
    close,
    get isClosed() { return stopped; },
    request(method, params = {}, { signal, timeoutMs = defaultTimeoutMs } = {}) {
      if (stopped) return Promise.reject(failure);
      if (signal?.aborted) return Promise.reject(abortError());
      if (typeof method !== 'string' || !method) return Promise.reject(new TypeError('ACP method must be a non-empty string'));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new TypeError('ACP timeoutMs must be a positive integer'));
      if (pending.size >= maxPendingRequests) return Promise.reject(new ProtocolError('ACP pending request limit exceeded', 'ACP_REQUEST_LIMIT'));
      const id = `dsh-${++nextId}`;
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
        const fail = (error) => {
          if (!pending.delete(id)) return;
          remember(id);
          cleanup();
          reject(error);
        };
        const onAbort = () => fail(abortError());
        timer = setTimeout(() => fail(new ProtocolError(`ACP request timed out: ${method}`, 'ACP_TIMEOUT')), timeoutMs);
        pending.set(id, { resolve, reject, cleanup });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        void write({ jsonrpc: '2.0', id, method, params }, () => pending.has(id)).catch(fail);
      });
    },
    notify(method, params = {}) {
      if (typeof method !== 'string' || !method) return Promise.reject(new TypeError('ACP method must be a non-empty string'));
      return write({ jsonrpc: '2.0', method, params });
    },
    onNotification(listener) {
      if (typeof listener !== 'function') throw new TypeError('ACP notification listener must be a function');
      if (stopped) throw failure;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setRequestHandler(next) {
      if (next !== undefined && typeof next !== 'function') throw new TypeError('ACP request handler must be a function');
      handler = next;
    },
  };
}
