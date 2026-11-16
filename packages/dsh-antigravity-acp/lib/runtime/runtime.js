import { createRequire } from 'node:module';
import { createConnection, abortError, RpcError } from '../protocol/connection.js';
import { verifyCli } from './cli.js';
import { createIsolation, removeIsolation, runtimeEnvironment } from './isolation.js';
import { RuntimeError, stopManagedProcess } from './lifecycle.js';

const { version: CLIENT_VERSION } = createRequire(import.meta.url)('../../package.json');

function permissionResult(params, result) {
  if (result?.outcome?.outcome === 'cancelled') return { outcome: { outcome: 'cancelled' } };
  const optionId = result?.outcome?.optionId;
  const option = Array.isArray(params?.options) && params.options.find((candidate) => candidate.optionId === optionId);
  if (result?.outcome?.outcome !== 'selected' || !option || !['allow_once', 'reject_once'].includes(option.kind)) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId } };
}

/** Starts an isolated empirical CLI profile and initializes ACP, without generation. */
export async function startAgyRuntime({
  subprocess,
  cli,
  loginHome,
  bridge,
  bridgeTimeoutMs = 600_000,
  systemPrompt = '',
  onUpdate,
  onPermission,
  toolDeclaration = 'null',
  signal,
  timeoutMs = 15_000,
} = {}) {
  if (!subprocess?.spawn) throw new TypeError('A DSH subprocess service is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
  if (onUpdate !== undefined && typeof onUpdate !== 'function') throw new TypeError('onUpdate must be a function');
  if (onPermission !== undefined && typeof onPermission !== 'function') throw new TypeError('onPermission must be a function');
  if (signal?.aborted) throw abortError();
  await verifyCli(cli, signal);
  const isolation = await createIsolation({ bridge, bridgeTimeoutMs, systemPrompt, toolDeclaration });
  let handle;
  let connection;
  let closePromise;
  let stderrTail = '';
  let fatal;
  const onAbort = () => { fail(abortError()); };
  const onStderrError = () => { fail(new RuntimeError('ACP stderr transport failed', 'ACP_TRANSPORT_ERROR')); };
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      signal?.removeEventListener('abort', onAbort);
      connection?.close(fatal);
      if (handle) await stopManagedProcess(handle);
      if (handle?.stderr) {
        handle.stderr.off('data', onStderr);
        handle.stderr.off('error', onStderrError);
      }
      stderrTail = '';
      await removeIsolation(isolation, { exited: true });
    })();
    return closePromise;
  };
  function fail(error) {
    if (!fatal) fatal = error;
    connection?.close(fatal);
    // The same rejected close promise is returned to the owner; failure never authorizes deletion.
    void close().catch(() => {});
  }
  function onStderr(chunk) {
    // Never persist or surface official stderr: it can contain account details.
    stderrTail = (stderrTail + Buffer.from(chunk).toString('utf8')).slice(-8192);
    if (/agent[^\r\n]{0,300}(?:not found|failed to load)[^\r\n]{0,300}(?:fall(?:ing)? back|default)/i.test(stderrTail) || /falling back to (?:the )?default agent/i.test(stderrTail)) fail(new RuntimeError('Configured ACP agent was unavailable; default-agent fallback is forbidden', 'ACP_DEFAULT_AGENT_FALLBACK'));
  }
  try {
    if (signal?.aborted) throw abortError();
    handle = subprocess.spawn({
      argv: [cli.path, 'acp', '--stdio', '--gemini-dir', isolation.geminiDir, '--app-data-dir', isolation.appDataDir, '--include-default-customizations=false', '--disable-telemetry', '--agent', isolation.agentName],
      cwd: isolation.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 1000,
      signal,
      env: runtimeEnvironment({ temporaryDirectory: isolation.temporaryDirectory, loginHome }),
    });
    void Promise.resolve(handle.done).then(
      () => { if (!closePromise) fail(new RuntimeError('ACP command exited', 'ACP_PROCESS_EXITED')); },
      () => { if (!closePromise) fail(new RuntimeError('ACP managed subprocess failed', 'ACP_PROCESS_FAILED')); },
    );
    if (!handle.stdin || !handle.stdout || !handle.stderr) throw new RuntimeError('ACP managed subprocess must expose piped stdio', 'ACP_TRANSPORT_ERROR');
    connection = createConnection({ input: handle.stdout, output: handle.stdin, defaultTimeoutMs: timeoutMs });
    connection.setRequestHandler(async (method, params) => {
      if (method === 'session/request_permission') {
        const response = onPermission ? await onPermission(params) : { outcome: { outcome: 'cancelled' } };
        return permissionResult(params, response);
      }
      // No native fs or terminal callback is exposed, even if the server asks anyway.
      throw new RpcError(-32601, 'Native ACP client operations are disabled');
    });
    connection.onNotification((method, params) => {
      if (method === 'session/update' && onUpdate) return onUpdate(params);
      return undefined;
    });
    void connection.closed.then(({ error }) => { if (!closePromise) fail(error); });
    handle.stderr.on('data', onStderr);
    handle.stderr.on('error', onStderrError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) throw abortError();
    const initializeResult = await connection.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'dsh-antigravity-acp', version: CLIENT_VERSION },
    }, { signal, timeoutMs });
    if (!initializeResult || initializeResult.protocolVersion !== 1) throw new RuntimeError('ACP protocol version 1 was not negotiated', 'ACP_PROTOCOL_VERSION_UNSUPPORTED');
    if (fatal || connection.isClosed) throw fatal || new RuntimeError('ACP connection closed during initialization');
    return { connection, initializeResult, isolation, close };
  } catch (error) {
    if (!fatal) fatal = error;
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'ACP startup failed; managed cleanup could not be confirmed'); }
    throw error;
  }
}
