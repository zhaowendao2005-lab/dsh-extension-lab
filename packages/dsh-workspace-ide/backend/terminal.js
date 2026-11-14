/**
 * PTY terminals on top of the host `subprocess.spawnTerminal` service.
 * Copied from packages/dsh-plugin-dev-sandbox/backend/manager.js (terminal part)
 * and reduced to what this panel needs; that package is never imported.
 *
 * Channel: Host-side ring buffer + UTF-16 character offset. The client passes
 * back the offset it received, never `+= data.length` (docs/terminal.md §3).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { LIMITS } from '../shared/contract.js';
import { ideError } from '../shared/errors.js';

const MAX_CHARS = LIMITS.terminalBufferBytes; // one char ≈ one byte-of-budget for ASCII-heavy output
const GRACE_MS = 250;
const IDLE_CLOSE_MS = 30 * 60 * 1000;

const ENV_KEEP = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'SSH_AUTH_SOCK', 'COLORTERM', 'ANDROID_HOME', 'JAVA_HOME', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME',
];

/**
 * Tombstone every ambient variable, then whitelist what a shell legitimately
 * needs. Without the tombstones the provider merge would restore the very
 * variables the scrub removed (`DSH_*`, `NODE_OPTIONS`, tokens, cookies).
 */
function terminalEnv(cwd) {
  const overrides = {};
  for (const key of Object.keys(process.env)) overrides[key] = undefined;
  for (const key of ENV_KEEP) {
    if (process.env[key] !== undefined) overrides[key] = process.env[key];
  }
  overrides.PWD = cwd;
  overrides.TERM = 'xterm-256color';
  overrides.LANG = process.env.LANG || 'en_US.UTF-8';
  overrides.COLORTERM = 'truecolor';
  return overrides;
}

function shellArguments(shell, platform) {
  const name = (platform === 'windows' ? path.win32 : path).basename(shell).toLowerCase().replace(/\.exe$/, '');
  if (name === 'bash') return [shell, '--noprofile', '--norc', '-i'];
  if (name === 'zsh') return [shell, '-f', '-i'];
  if (name === 'fish') return [shell, '--no-config', '-i'];
  if (name === 'pwsh' || name === 'powershell') return [shell, '-NoLogo', '-NoProfile'];
  if (name === 'cmd') return [shell, '/d', '/q'];
  return platform === 'windows' ? [shell] : [shell, '-i'];
}

function stripTitles(text) {
  // OSC 0/2 carry window titles; they are the terminal's business, not the panel's.
  return text.replace(/\u001b\][02];[^\u0007\u001b]*(\u0007|\u001b\\)/g, '');
}

export function createTerminals(ctx, workspace) {
  /** @type {Map<string, any>} */
  const terminals = new Map();
  let disposed = false;

  function subprocess() {
    const service = ctx.get('subprocess');
    if (!service || typeof service.spawnTerminal !== 'function') {
      throw ideError('E_UNSUPPORTED', '当前宿主不提供真 PTY 终端', { reason: 'terminal-unavailable' });
    }
    return service;
  }

  function record(id) {
    const terminal = terminals.get(id);
    if (!terminal) throw ideError('E_TERMINAL_GONE', '终端已关闭', { terminalId: id });
    return terminal;
  }

  function bufferSpan(terminal) {
    return { start: terminal.end - terminal.buffer.length, end: terminal.end };
  }

  function append(terminal, chunk) {
    const text = stripTitles(String(chunk));
    if (!text) return;
    terminal.end += text.length;
    terminal.buffer += text;
    if (terminal.buffer.length > MAX_CHARS) terminal.buffer = terminal.buffer.slice(terminal.buffer.length - MAX_CHARS);
    terminal.lastActivity = Date.now();
  }

  async function terminate(terminal) {
    if (terminal.cleanup) return await terminal.cleanup;
    const cleanup = (async () => {
      try {
        await terminal.handle?.terminate?.();
        await Promise.race([
          Promise.allSettled([terminal.done, terminal.outputDone]),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (error) {
        terminal.error = String(error?.message ?? error);
      } finally {
        terminal.handle = null;
        if (['starting', 'running'].includes(terminal.state.state)) terminal.state.state = 'closed';
      }
    })();
    terminal.cleanup = cleanup;
    try {
      await cleanup;
    } finally {
      if (terminal.cleanup === cleanup) terminal.cleanup = null;
    }
  }

  async function spawn(input) {
    if (disposed) throw ideError('E_UNSUPPORTED', '插件已卸载', {});
    const root = workspace.assertTrusted('terminal');
    const service = subprocess();
    const environment = typeof service.terminalEnvironment === 'function' ? await service.terminalEnvironment() : {};
    const platform = environment.platform || (process.platform === 'win32' ? 'windows' : 'posix');

    let cwd = root;
    if (input.cwd) {
      const resolved = await workspace.resolvePath(input.cwd);
      cwd = resolved.absolute;
    }

    let shell = typeof input.shell === 'string' && input.shell ? input.shell : environment.defaultShell;
    if (typeof shell !== 'string' || !shell || shell.includes('\0')) {
      throw ideError('E_UNSUPPORTED', '找不到可用的 shell', { reason: 'shell-unavailable' });
    }
    const env = terminalEnv(cwd);
    if (typeof service.resolveExecutable === 'function') shell = await service.resolveExecutable(shell, env);

    const rows = input.rows ?? 24;
    const cols = input.cols ?? 80;
    const handle = await service.spawnTerminal({
      argv: shellArguments(shell, platform),
      cwd,
      env,
      rows,
      cols,
      terminalType: 'xterm-256color',
      graceMs: GRACE_MS,
    });

    const terminal = {
      id: randomUUID(),
      shell,
      cwd,
      handle,
      buffer: '',
      end: 0,
      lastActivity: Date.now(),
      cleanup: null,
      stopping: false,
      error: null,
      state: { state: 'running', pid: handle.pid ?? null, exitCode: null, signal: null },
      title: path.basename(shell),
    };

    terminal.done = Promise.resolve(handle.done).then((outcome) => {
      terminal.state.pid = null;
      terminal.state.exitCode = outcome?.exitCode ?? null;
      terminal.state.signal = outcome?.signal ?? null;
      if (!terminal.stopping && terminal.state.state !== 'error') terminal.state.state = 'exited';
    }, (error) => {
      terminal.state.pid = null;
      terminal.state.state = 'error';
      terminal.error = String(error?.message ?? error);
    });

    handle.output?.setEncoding?.('utf8');
    terminal.outputDone = (async () => {
      try {
        for await (const chunk of handle.output) append(terminal, chunk);
      } catch (error) {
        terminal.error = String(error?.message ?? error);
      }
    })();

    void terminal.done.then(() => terminate(terminal)).catch(() => {});
    terminals.set(terminal.id, terminal);
    return terminal;
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const terminal of terminals.values()) {
      if (terminal.state.state === 'running' && now - terminal.lastActivity > IDLE_CLOSE_MS) {
        void api.close({ terminalId: terminal.id }).catch(() => {});
      }
    }
  }, 60_000);
  sweeper.unref?.();

  const api = {
    async create(input = {}) {
      const terminal = await spawn(input);
      return { terminalId: terminal.id, pid: terminal.state.pid, shell: terminal.shell, title: terminal.title, cols: input.cols ?? 80, rows: input.rows ?? 24 };
    },

    async write(input) {
      const terminal = record(input.terminalId);
      if (typeof input.data !== 'string' || input.data.length > LIMITS.terminalWriteChars) {
        throw ideError('E_TOO_LARGE', '单次写入过长', { limit: LIMITS.terminalWriteChars });
      }
      if (terminal.state.state !== 'running') return { terminalId: terminal.id, accepted: false };
      await terminal.handle?.write?.(input.data);
      return { terminalId: terminal.id, accepted: true };
    },

    async resize(input) {
      const terminal = record(input.terminalId);
      if (typeof terminal.handle?.resize === 'function') {
        try {
          await terminal.handle.resize(input.cols, input.rows);
        } catch {
          // A shell that cannot be resized keeps its size; not an error the UI can act on.
        }
      }
      return { terminalId: terminal.id, cols: input.cols, rows: input.rows };
    },

    async poll(input) {
      const terminal = record(input.terminalId);
      const { start, end } = bufferSpan(terminal);
      const from = Math.max(input.offset, start);
      return {
        terminalId: terminal.id,
        offset: end,
        dropped: from > input.offset,
        data: from >= start ? terminal.buffer.slice(from - start) : '',
        exited: terminal.state.state === 'exited' || terminal.state.state === 'error' || terminal.state.state === 'closed',
        exitCode: terminal.state.exitCode,
        title: terminal.title,
        pid: terminal.state.pid,
      };
    },

    async close(input) {
      const terminal = record(input.terminalId);
      terminal.stopping = true;
      await terminate(terminal);
      terminals.delete(terminal.id);
      return { terminalId: terminal.id, closed: true };
    },

    async list() {
      return {
        terminals: [...terminals.values()].map((terminal) => ({
          terminalId: terminal.id,
          pid: terminal.state.pid,
          shell: terminal.shell,
          title: terminal.title,
          exited: terminal.state.state !== 'running',
          exitCode: terminal.state.exitCode,
        })),
      };
    },

    async rename(input) {
      const terminal = record(input.terminalId);
      terminal.title = input.title;
      return { terminalId: terminal.id, title: terminal.title };
    },

    async dispose() {
      disposed = true;
      clearInterval(sweeper);
      const all = [...terminals.values()];
      terminals.clear();
      await Promise.allSettled(all.map((terminal) => {
        terminal.stopping = true;
        return terminate(terminal);
      }));
    },
  };

  return api;
}
