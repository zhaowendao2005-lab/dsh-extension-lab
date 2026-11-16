import { abortError } from '../protocol/connection.js';

export class RuntimeError extends Error {
  constructor(message, code = 'ACP_RUNTIME_ERROR', options) {
    super(message, options);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

export async function bounded(operation, { timeoutMs, signal, message = 'ACP operation timed out' }) {
  if (signal?.aborted) throw abortError();
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RuntimeError(message, 'ACP_TIMEOUT')), timeoutMs);
        onAbort = () => reject(abortError());
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function waitForManagedExit(handle, timeoutMs) {
  const controller = new AbortController();
  try {
    return await bounded(() => handle.waitForExit(controller.signal), { timeoutMs, message: 'Cannot prove ACP managed process exit' });
  } finally {
    controller.abort();
  }
}

/** stdin EOF first, then the provider's termination ladder. No pid guessing. */
export async function stopManagedProcess(handle, { gracefulMs = 1000, terminateMs = 5000 } = {}) {
  if (!handle || typeof handle.waitForExit !== 'function' || typeof handle.terminate !== 'function') throw new RuntimeError('ACP subprocess does not expose managed exit observation', 'ACP_MANAGED_EXIT_UNAVAILABLE');
  // Observe rejection even when the managed range has already become empty.
  void Promise.resolve(handle.done).catch(() => {});
  if (handle.stdin && !handle.stdin.destroyed && !handle.stdin.writableEnded) handle.stdin.end();
  let gracefulError;
  try {
    if (await waitForManagedExit(handle, gracefulMs) === true) return;
  } catch (error) { gracefulError = error; }
  handle.terminate();
  try {
    if (await waitForManagedExit(handle, terminateMs) === true) return;
  } catch (error) {
    throw new RuntimeError('Cannot prove ACP managed process exit; owned profile retained', 'ACP_EXIT_UNVERIFIED', { cause: error });
  }
  throw new RuntimeError('ACP managed range did not confirm exit; owned profile retained', 'ACP_EXIT_UNVERIFIED', { cause: gracefulError });
}
