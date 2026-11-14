/**
 * The single exit for `git` subprocesses (AGENTS.md → 命令集中在 backend/git/exec.js).
 * Every spawn goes through the hardening list owned by docs/security.md §3.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ideError } from '../../shared/errors.js';

const ENV = Object.freeze({
  LC_ALL: 'en_US.UTF-8',
  LANGUAGE: 'en',
  LANG: 'en_US.UTF-8',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GIT_CONFIG_NOSYSTEM: '',
});

/** Hooks must be unreachable: an empty directory we own for the plugin's lifetime. */
let hooksDir = null;

export async function ensureHooksDir() {
  if (!hooksDir) hooksDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-wid-hooks-'));
  return hooksDir;
}

export async function disposeHooksDir() {
  if (!hooksDir) return;
  const dir = hooksDir;
  hooksDir = null;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Read-only hardening: no optional locks, no pager, no external diff, no
 * credential or askpass helpers, no ssh command, no hooks, no fsmonitor.
 */
export function hardenArgs(hooks) {
  return [
    '--no-optional-locks',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.pager=cat',
    `-c`, `core.hooksPath=${hooks}`,
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'diff.external=',
    '-c', 'core.sshCommand=',
    '-c', 'protocol.ext.allow=never',
    '-c', 'advice.detachedHead=false',
  ];
}

/**
 * @param {string} cwd absolute path inside the repository (or the workspace root)
 * @param {string[]} args argv after the hardening list
 * @param {{timeoutMs?: number, input?: string, maxBytes?: number, env?: Record<string,string>}} [options]
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export async function runGit(cwd, args, options = {}) {
  const hooks = await ensureHooksDir();
  const argv = [...hardenArgs(hooks), ...args];
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;

  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', argv, {
        cwd,
        env: { ...process.env, ...ENV, ...(options.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      reject(ideError('E_GIT_MISSING', 'git 无法启动', { reason: String(error?.message ?? error) }));
      return;
    }

    const out = [];
    const err = [];
    let outBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(ideError('E_TIMEOUT', `git 超过 ${timeoutMs}ms 未返回`, { argv: redactArgv(argv) }));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    child.on('error', (error) => {
      const code = error && error.code === 'ENOENT' ? 'E_GIT_MISSING' : 'E_GIT_FAILED';
      finish(reject, ideError(code, code === 'E_GIT_MISSING' ? '系统里找不到 git' : 'git 启动失败', {
        reason: String(error?.message ?? error),
      }));
    });

    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length;
      if (outBytes > maxBytes) {
        child.kill('SIGKILL');
        finish(reject, ideError('E_TOO_LARGE', 'git 输出超过上限', { limit: maxBytes }));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => err.push(chunk));

    child.on('close', (code) => {
      finish(resolve, {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? -1,
      });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Paths in argv are workspace-relative already; keep the command but drop credentials. */
function redactArgv(argv) {
  return argv.filter((item) => !/^https?:\/\/|^ssh:\/\//.test(item)).slice(0, 24);
}

/**
 * Run git and translate a non-zero exit into `E_GIT_FAILED` with a redacted
 * stderr excerpt. `acceptCodes` lets callers treat specific codes as success
 * (`git diff --no-index` legitimately exits 1).
 */
export async function gitOrThrow(cwd, args, options = {}) {
  const result = await runGit(cwd, args, options);
  if (result.code === 0 || (options.acceptCodes ?? []).includes(result.code)) return result;
  const stderr = result.stderr.trim();
  const reason = classify(stderr);
  throw ideError('E_GIT_FAILED', `git ${args[0]} 失败`, {
    code: result.code,
    argv: redactArgv([args[0], ...args.slice(1, 8)]),
    stderr: stderr.split('\n').slice(0, 12).join('\n'),
    reason,
  });
}

function classify(stderr) {
  if (/not a git repository/i.test(stderr)) return 'not-a-repo';
  if (/unknown revision|bad revision|ambiguous argument/i.test(stderr)) return 'bad-revision';
  if (/would be overwritten|local changes/i.test(stderr)) return 'dirty-worktree';
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(stderr)) return 'auth';
  if (/Permission denied|Operation not permitted/i.test(stderr)) return 'permission';
  if (/index\.lock/i.test(stderr)) return 'index-lock';
  return 'git-error';
}
