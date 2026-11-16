import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abortError } from '../protocol/connection.js';
import { runtimeEnvironment } from './isolation.js';
import { bounded, RuntimeError, stopManagedProcess } from './lifecycle.js';

export const SUPPORTED_CLI_VERSION = '1.5.9';

export async function fingerprintExecutable(executable, signal) {
  if (signal?.aborted) throw abortError();
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) throw new TypeError('CLI path must be absolute');
  const canonical = await fs.realpath(executable);
  const before = await fs.stat(canonical);
  if (!before.isFile()) throw new RuntimeError('CLI executable must be a regular file', 'ACP_CLI_INVALID');
  const hash = createHash('sha256');
  const stream = createReadStream(canonical, { signal });
  for await (const chunk of stream) hash.update(chunk);
  const after = await fs.stat(canonical);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new RuntimeError('CLI executable changed while fingerprinting', 'ACP_CLI_CHANGED');
  return { path: canonical, sha256: hash.digest('hex') };
}

function parseVersion(text) {
  const match = /^(?:(?:antigravity(?: cli)?|agy)(?: version)?[ :]+)?v?(\d+\.\d+\.\d+)$/i.exec(text.trim());
  if (!match || match[1] !== SUPPORTED_CLI_VERSION) throw new RuntimeError(`Only the explicitly inspected Antigravity CLI ${SUPPORTED_CLI_VERSION} is supported`, 'ACP_CLI_VERSION_UNSUPPORTED');
  return match[1];
}

/** Runs only --version; no ACP initialization, login, or model request. */
export async function inspectCli({ subprocess, executable = 'agy', loginHome, signal, timeoutMs = 10_000 } = {}) {
  if (!subprocess?.resolveExecutable || !subprocess?.spawn) throw new TypeError('A DSH subprocess service is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
  const env = runtimeEnvironment({ loginHome });
  const resolved = await bounded(() => subprocess.resolveExecutable(executable, env, signal), { timeoutMs, signal, message: 'CLI executable resolution timed out' });
  const fingerprint = await fingerprintExecutable(resolved, signal);
  const handle = subprocess.spawn({
    argv: [fingerprint.path, '--version'],
    cwd: os.tmpdir(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 1024 } },
    graceMs: 1000,
    signal,
    env,
  });
  // A version probe still owns a managed range, not just its direct command.
  let outcome;
  let failure;
  try {
    outcome = await bounded(() => handle.done, { timeoutMs, signal, message: 'CLI version preflight timed out' });
  } catch (error) { failure = error; }
  try { await stopManagedProcess(handle); }
  catch (cleanupError) {
    if (failure) throw new AggregateError([failure, cleanupError], 'CLI preflight failed and managed exit is unverified');
    throw cleanupError;
  }
  if (failure) throw failure;
  if (outcome?.exitCode !== 0 || outcome.signal) throw new RuntimeError('CLI --version failed', 'ACP_CLI_PREFLIGHT_FAILED');
  const output = handle.collected?.stdout?.readFrom(0);
  if (!output || output.lossy || Buffer.byteLength(output.text) > 4096) throw new RuntimeError('CLI version output is unavailable or truncated', 'ACP_CLI_PREFLIGHT_FAILED');
  const version = parseVersion(output.text);
  // Fail if it was replaced between the version command and the returned proof.
  const finalFingerprint = await fingerprintExecutable(fingerprint.path, signal);
  if (finalFingerprint.sha256 !== fingerprint.sha256) throw new RuntimeError('CLI executable changed during preflight', 'ACP_CLI_CHANGED');
  return Object.freeze({ ...fingerprint, version });
}

export async function verifyCli(cli, signal) {
  if (!cli || cli.version !== SUPPORTED_CLI_VERSION || !/^[a-f0-9]{64}$/.test(cli.sha256)) throw new RuntimeError('A valid exact-version CLI preflight result is required', 'ACP_CLI_NOT_INSPECTED');
  const fingerprint = await fingerprintExecutable(cli.path, signal);
  if (fingerprint.path !== cli.path || fingerprint.sha256 !== cli.sha256) throw new RuntimeError('CLI executable changed since preflight', 'ACP_CLI_CHANGED');
  return fingerprint;
}
