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
import { buildEnvOverrides, shellBasename } from './platform.js';

const MAX_CHARS = LIMITS.terminalBufferBytes; // one char ≈ one byte-of-budget for ASCII-heavy output
const GRACE_MS = 250;
const IDLE_CLOSE_MS = 30 * 60 * 1000;

const ENV_KEEP = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'ComSpec', 'SystemRoot', 'SystemDrive', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'HOMEDRIVE', 'HOMEPATH', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'PSModulePath', 'OS',
  'SSH_AUTH_SOCK', 'COLORTERM', 'ANDROID_HOME', 'JAVA_HOME', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME',
];

/**
 * Tombstone every ambient variable, then whitelist what a shell legitimately
 * needs. Without the tombstones the provider merge would restore the very
 * variables the scrub removed (`DSH_*`, `NODE_OPTIONS`, tokens, cookies).
 */
function terminalEnv(cwd, source = {}, platform = process.platform) {
  return buildEnvOverrides({
    ambientEnv: process.env,
    sourceEnv: source,
    keepKeys: ENV_KEEP,
    forced: {
      PWD: cwd,
      TERM: 'xterm-256color',
      LANG: source.LANG || process.env.LANG || 'en_US.UTF-8',
      COLORTERM: 'truecolor',
    },
    platform,
  });
}

function shellName(shell, platform) {
  return shellBasename(shell, platform).toLowerCase().replace(/\.exe$/, '');
}

export function shellArguments(shell, platform) {
  const name = shellName(shell, platform);
  if (name === 'bash' || name === 'zsh' || name === 'fish') return [shell, '-l', '-i'];
  if (name === 'pwsh' || name === 'powershell') return [shell, '-NoLogo'];
  if (name === 'cmd') return [shell, '/q'];
  return platform === 'windows' ? [shell] : [shell, '-l', '-i'];
}

/** Only fixed runner names and a manifest script key reach the shell, never its command value. */
export function packageScriptCommand(shell, platform, cwd, runner, script) {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(runner?.command)
    || !Array.isArray(runner.args) || runner.args.length !== 1 || runner.args[0] !== 'run'
    || typeof script !== 'string' || !script || script.startsWith('-')
    || /[\x00-\x1f\x7f]/.test(script) || /[\x00-\x1f\x7f]/.test(cwd)) {
    throw ideError('E_BAD_PAYLOAD', '脚本名称或运行器不受支持', {});
  }
  const name = shellName(shell, platform);
  const tokens = [runner.command, ...runner.args, script];
  if (name === 'pwsh' || name === 'powershell') {
    const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
    return 'Set-Location -LiteralPath ' + quote(cwd) + '; if ($?) { & ' + tokens.map(quote).join(' ') + ' }';
  }
  if (name === 'cmd') {
    // cmd expands percent and delayed-expansion variables even inside double quotes.
    if ([cwd, script].some((value) => /["%!]/.test(value))) {
      throw ideError('E_UNSUPPORTED', '此路径或脚本名称需要 PowerShell 终端才能安全运行', {});
    }
    const quote = (value) => '"' + value + '"';
    return 'cd /d ' + quote(cwd) + ' && ' + tokens.map(quote).join(' ');
  }
  if (!['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(name)) {
    throw ideError('E_UNSUPPORTED', '此终端外壳尚不支持安全执行 package scripts', {});
  }
  const quote = name === 'fish'
    ? (value) => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
    : (value) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
  return 'cd -- ' + quote(cwd) + ' && ' + tokens.map(quote).join(' ');
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
    const root = workspace.requireRoot();
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
    const env = terminalEnv(cwd, environment.env, platform === 'windows' ? 'win32' : process.platform);
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
      platform,
      cwd,
      handle,
      buffer: '',
      end: 0,
      lastActivity: Date.now(),
      cleanup: null,
      stopping: false,
      error: null,
      state: { state: 'running', pid: handle.pid ?? null, exitCode: null, signal: null },
      title: shellBasename(shell, platform),
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

    async runScript(input) {
      const manifest = await workspace.packageScripts({ path: input.path });
      if (!manifest.scripts.some((item) => item.name === input.script)) {
        throw ideError('E_BAD_PAYLOAD', '脚本已不存在，请刷新命令列表', { path: input.path });
      }
      const terminal = await spawn({ cwd: manifest.cwd });
      try {
        const command = packageScriptCommand(terminal.shell, terminal.platform, terminal.cwd, manifest.runner, input.script);
        if (command.length + 1 > LIMITS.terminalWriteChars) throw ideError('E_TOO_LARGE', '脚本命令过长', {});
        if (typeof terminal.handle?.write !== 'function' || terminal.state.state !== 'running') {
          throw ideError('E_TERMINAL_GONE', '终端已退出，无法运行脚本', {});
        }
        await terminal.handle.write(command + '\r');
        terminal.title = (manifest.name + ' · ' + input.script).slice(0, 200);
        return { terminalId: terminal.id, pid: terminal.state.pid, shell: terminal.shell, title: terminal.title, cols: 80, rows: 24 };
      } catch (error) {
        await api.close({ terminalId: terminal.id });
        throw error;
      }
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
