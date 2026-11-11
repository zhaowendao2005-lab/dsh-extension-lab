import path from "node:path";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_LOG_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const FORBIDDEN_ENV = /(?:^DSH_|KEY|PASS(?:WORD|WD)?|SECRET|TOKEN|CREDENTIAL|AUTH|COOKIE|^NODE_(?:OPTIONS|PATH)$|^(?:BASH_ENV|ENV|NPM_CONFIG_USERCONFIG)$)/i;

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function inspect(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function directory(target, create = false) {
  let info = await inspect(target);
  if (!info && create) {
    try { await mkdir(target, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    info = await inspect(target);
  }
  if (info && (info.isSymbolicLink() || !info.isDirectory())) {
    throw new Error(`Unsafe sandbox directory (symlink or non-directory): ${target}`);
  }
  return Boolean(info);
}

async function regularFile(target) {
  const info = await inspect(target);
  if (info && (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)) {
    throw new Error(`Unsafe file (symlink, hard link, or non-file): ${target}`);
  }
  return info;
}

async function readJson(target, optional = false) {
  const info = await regularFile(target);
  if (!info) {
    if (optional) return null;
    throw new Error(`Required file does not exist: ${target}`);
  }
  if (info.size > MAX_MANIFEST_BYTES) throw new Error(`JSON file is too large: ${target}`);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.nlink !== 1 || current.size > MAX_MANIFEST_BYTES) throw new Error(`Unsafe JSON file: ${target}`);
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}

async function writeSafe(target, content, mode = 0o600) {
  await regularFile(target);
  // Never truncate before verifying the opened inode (including hard links).
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW || 0), mode);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Unsafe output file: ${target}`);
    await handle.truncate(0);
    await handle.writeFile(content, "utf8");
    // A pre-existing file keeps its mode; credentials-local refuses group/other bits.
    if ((info.mode & 0o077) !== 0) await handle.chmod(mode);
  } finally { await handle.close(); }
}

/** Credentials copied into the sandbox DSH home; values never leave the Host. */
function credentialsDocument(entries) {
  const refs = entries.filter((entry) => entry && typeof entry.ref === "string"
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.ref) && typeof entry.value === "string" && entry.value.length > 0);
  if (refs.length === 0) return null;
  const lines = refs.map(({ ref, value }) => `  ${ref}: ${JSON.stringify(value)}`);
  return `version: 1\nrefs:\n${lines.join("\n")}\n`;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function runtimeState(home = null) {
  return { state: "stopped", pid: null, url: null, error: null, exitCode: null, signal: null, dshHome: home };
}

function commandState() {
  return { state: "idle", id: null, pid: null, exitCode: null, signal: null, error: null };
}

function cleanEnvironment(source, home) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (!FORBIDDEN_ENV.test(key) && typeof value === "string") env[key] = value;
  }
  // A separate DSH_HOME is profile isolation, NOT an OS security sandbox.
  // Do not inherit the user's home/config directories or credential pointers.
  env.DSH_HOME = home;
  env.HOME = path.join(home, "home");
  env.USERPROFILE = env.HOME;
  env.XDG_CONFIG_HOME = path.join(home, "config");
  env.XDG_CACHE_HOME = path.join(home, "cache");
  env.XDG_DATA_HOME = path.join(home, "data");
  return env;
}

function terminalId(value) {
  if (typeof value !== "string" || !SESSION_ID.test(value)) {
    throw new TypeError("Invalid terminalId: use 1-128 letters, digits, underscores or hyphens, starting with a letter or digit");
  }
  return value;
}

function terminalDimension(value, fallback, name) {
  const dimension = positiveInteger(value, fallback, name);
  if (dimension > 1000) throw new TypeError(`${name} must not exceed 1000`);
  return dimension;
}

function terminalOverrides(env) {
  // The subprocess service merges overrides onto its own ambient environment.
  // Tombstones prevent that merge from restoring anything our scrub omitted
  // (notably NODE_OPTIONS, AUTH/COOKIE names, and the parent's DSH_* facts).
  // Apply the isolated environment last so our new DSH_HOME/HOME survive.
  const overrides = { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env };
  // Windows merges names case-insensitively. Put each isolated value after any
  // differently-cased tombstone, otherwise a later `home: undefined` could erase
  // HOME and let shell defaults point back to the user's profile.
  for (const name of ["DSH_HOME", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "PWD"]) {
    delete overrides[name];
    for (const key of Object.keys(overrides)) if (key.toUpperCase() === name) overrides[key] = undefined;
    overrides[name] = env[name];
  }
  return overrides;
}

function terminalArguments(shell, platform) {
  const name = (platform === "windows" ? path.win32 : path).basename(shell).toLowerCase().replace(/\.exe$/, "");
  if (name === "bash") return [shell, "--noprofile", "--norc", "-i"];
  if (name === "zsh") return [shell, "-f", "-i"];
  if (name === "fish") return [shell, "--no-config", "-i"];
  if (name === "pwsh" || name === "powershell") return [shell, "-NoLogo", "-NoProfile"];
  if (name === "cmd") return [shell, "/d", "/q"];
  return platform === "windows" ? [shell] : [shell, "-i"];
}

function commandArguments(shell, platform, command) {
  if (platform === "windows") return [shell, "/d", "/s", "/c", command];
  return [shell, "-c", command];
}

function exportedEntry(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(exportedEntry).find(Boolean);
  if (value && typeof value === "object") {
    for (const key of ["node", "import", "default"]) {
      const entry = exportedEntry(value[key]);
      if (entry) return entry;
    }
  }
  return null;
}

function validateSpec(spec) {
  if (!spec || typeof spec.command !== "string" || !spec.command || spec.command.includes("\0") ||
      !Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("Launch spec must be {command: non-empty string, args: string[]}");
  }
  return { command: spec.command, args: [...spec.args] };
}

/**
 * Dependency-free, session-scoped process manager. All methods are asynchronous.
 * Each operation requires {workspaceRoot: absolute path, sessionId}; bind also
 * takes pluginPath, run takes commandId (an exact package.json script key).
 *
 * bind/status/launch/run/stop/unbind return:
 * {binding: null|{sessionId,pluginPath,name}, commands:[{id,title,command}],
 *  runtime:{state,pid,url,error,exitCode,signal,dshHome},
 *  command:{state,id,pid,exitCode,signal,error},
 *  terminals:[{id,state,pid,exitCode,signal,error}],
 *  logs:[{time,source,stream,text,terminalId?}]}.
 * runtime states: stopped/starting/running/exited/error;
 * command states: idle/running/exited/error. dispose resolves undefined.
 * terminalCreate({...,terminalId?,rows?,cols?}), terminalWrite({...,terminalId,data})
 * and terminalClose({...,terminalId}) return that same snapshot. PTYs require
 * options.subprocess (the official ctx.subprocess service); there is no pipe or
 * child_process substitute. Terminal states: starting/running/exited/error/closed.
 *
 * options.launchSpec and options.commandSpec accept {command,args} or an async
 * function(context) returning it, for tests/explicit embedders only. The default
 * launcher ALWAYS starts real DSH; there is no Node placeholder fallback.
 * context: {workspaceRoot,sessionId,pluginPath,runtimeHome,overlayPath,env,commandId?}.
 * Other options: env (source to scrub), maxLogBytes, maxLogEntries, stopTimeoutMs.
 * This is profile/process isolation, not a boundary against malicious plugins.
 * Filesystem checks reject existing links, but cannot defeat hostile concurrent
 * filesystem mutations; untrusted code must use a real OS/container sandbox.
 */
export function createSandboxManager(options = {}) {
  const maxLogBytes = positiveInteger(options.maxLogBytes, DEFAULT_LOG_BYTES, "maxLogBytes");
  const maxLogEntries = positiveInteger(options.maxLogEntries, 400, "maxLogEntries");
  const stopTimeoutMs = positiveInteger(options.stopTimeoutMs, 1000, "stopTimeoutMs");
  const sessions = new Map();
  const queues = new Map();
  let disposed = false;
  let disposal;

  async function location(input) {
    if (!input || typeof input.workspaceRoot !== "string" || !path.isAbsolute(input.workspaceRoot)) {
      throw new TypeError("workspaceRoot must be an explicit absolute path");
    }
    if (typeof input.sessionId !== "string" || !SESSION_ID.test(input.sessionId)) {
      throw new TypeError("Invalid sessionId: use 1-128 letters, digits, underscores or hyphens, starting with a letter or digit");
    }
    const root = await realpath(input.workspaceRoot);
    if (!(await lstat(root)).isDirectory()) throw new Error("workspaceRoot must be a directory");
    const base = path.join(root, ".dsh", "plugin-dev", input.sessionId);
    return { workspaceRoot: root, sessionId: input.sessionId, base,
      bindingPath: path.join(base, "binding.json"), modelsPath: path.join(base, "models.json"),
      runtimeHome: path.join(base, "runtime"), credentialsPath: path.join(base, "runtime", ".credentials.yaml"),
      overlayPath: path.join(base, "overlay.yml"), key: JSON.stringify([root, input.sessionId]) };
  }

  async function checkPaths(loc, create = false) {
    for (const target of [path.join(loc.workspaceRoot, ".dsh"), path.join(loc.workspaceRoot, ".dsh", "plugin-dev"), loc.base]) {
      if (!inside(loc.workspaceRoot, target)) throw new Error("Sandbox path escapes workspace");
      if (!(await directory(target, create))) return;
    }
    await directory(loc.runtimeHome, create);
    for (const leaf of ["home", "config", "cache", "data"]) {
      if (await directory(loc.runtimeHome)) await directory(path.join(loc.runtimeHome, leaf), create);
    }
    await regularFile(loc.bindingPath);
    await regularFile(loc.modelsPath);
    await regularFile(loc.overlayPath);
  }

  function record(loc) {
    if (!sessions.has(loc.key)) sessions.set(loc.key, { loc, runtime: runtimeState(loc.runtimeHome), command: commandState(),
      runtimeProcess: null, commandProcess: null, terminals: new Map(), models: [], modelsLoaded: false,
      credentialRefs: [], logs: [], logBytes: 0, urlTail: "" });
    return sessions.get(loc.key);
  }

  async function serialized(input, action) {
    if (disposed) throw new Error("Sandbox manager is disposed");
    const loc = await location(input);
    if (disposed) throw new Error("Sandbox manager is disposed");
    const previous = queues.get(loc.key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => action(loc, record(loc)));
    queues.set(loc.key, current);
    try { return await current; }
    finally { if (queues.get(loc.key) === current) queues.delete(loc.key); }
  }

  async function plugin(loc, requested) {
    if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) throw new TypeError("pluginPath is required");
    const resolved = await realpath(path.resolve(loc.workspaceRoot, requested));
    if (!inside(loc.workspaceRoot, resolved)) throw new Error("pluginPath must resolve inside the workspace");
    if (!(await lstat(resolved)).isDirectory()) throw new Error("pluginPath must be a package directory");
    const manifest = await readJson(path.join(resolved, "package.json"));
    if (!manifest || Array.isArray(manifest) || typeof manifest !== "object" ||
        typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("Invalid package.json: a package name is required");
    if (manifest.scripts !== undefined && (!manifest.scripts || Array.isArray(manifest.scripts) || typeof manifest.scripts !== "object" ||
        Object.values(manifest.scripts).some((value) => typeof value !== "string"))) throw new Error("Invalid package.json scripts");
    const commands = Object.entries(manifest.scripts || {})
      .filter(([id]) => id && !id.startsWith("-") && !/[\0\r\n]/.test(id))
      .map(([id, command]) => ({ id, title: id, command }));
    return { binding: { sessionId: loc.sessionId, pluginPath: resolved, name: manifest.name }, commands, manifest };
  }

  async function binding(loc) {
    await checkPaths(loc);
    const saved = await readJson(loc.bindingPath, true);
    if (saved === null) return null;
    if (!saved || Array.isArray(saved) || typeof saved !== "object" || Object.keys(saved).length !== 1 ||
        typeof saved.pluginPath !== "string" || !path.isAbsolute(saved.pluginPath)) throw new Error("Invalid binding.json");
    return plugin(loc, saved.pluginPath);
  }

  function snapshot(item, bound) {
    return { binding: bound ? { ...bound.binding } : null,
      commands: bound ? bound.commands.map((command) => ({ ...command })) : [],
      runtime: { ...item.runtime }, command: { ...item.command },
      terminals: [...item.terminals.values()].map((terminal) => ({ ...terminal.state })),
      models: item.models.map((model) => ({ ...model })),
      credentials: item.credentialRefs.map((ref) => ({ ref })),
      logs: item.logs.map((line) => ({ ...line })) };
  }

  async function loadModels(loc, item) {
    if (item.modelsLoaded) return item.models;
    const saved = await readJson(loc.modelsPath, true);
    if (saved !== null) {
      if (!saved || Array.isArray(saved) || typeof saved !== "object" || Object.keys(saved).length !== 1 || !Array.isArray(saved.selected)) {
        throw new Error("Invalid models.json");
      }
      item.models = saved.selected
        .filter((entry) => entry && typeof entry === "object" && typeof entry.provider === "string" && typeof entry.model === "string")
        .map((entry) => ({ provider: entry.provider, model: entry.model }));
    }
    item.modelsLoaded = true;
    return item.models;
  }

  function log(item, source, stream, raw, terminalId) {
    let text = String(raw);
    if (Buffer.byteLength(text) > maxLogBytes) {
      text = Buffer.from(text).subarray(-maxLogBytes).toString("utf8");
      while (Buffer.byteLength(text) > maxLogBytes) text = text.slice(1);
    }
    if (!text) return;
    const entry = { time: new Date().toISOString(), source, stream, text, ...(terminalId === undefined ? {} : { terminalId }) };
    item.logs.push(entry);
    item.logBytes += Buffer.byteLength(text);
    while (item.logs.length > maxLogEntries || item.logBytes > maxLogBytes) {
      item.logBytes -= Buffer.byteLength(item.logs.shift().text);
    }
  }

  // Keep at most one screenful of scrollback per terminal; clients that fall
  // behind are told the earliest position they can still read.
  const maxTerminalChars = 256 * 1024;

  function appendTerminalOutput(terminal, chunk) {
    const text = String(chunk);
    if (!text) return;
    terminal.end += text.length;
    terminal.buffer += text;
    if (terminal.buffer.length > maxTerminalChars) terminal.buffer = terminal.buffer.slice(terminal.buffer.length - maxTerminalChars);
  }

  function captureUrl(item, text) {
    item.urlTail = (item.urlTail + text).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").slice(-8192);
    for (const match of item.urlTail.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      try {
        const url = new URL(match[0].replace(/[),.;]+$/, ""));
        if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && url.port !== "0") {
          item.runtime.url = url.href;
        }
      } catch { /* Incomplete lines and non-URLs are normal process output. */ }
    }
  }

  async function context(loc, bound, commandId) {
    await checkPaths(loc, true);
    return { workspaceRoot: loc.workspaceRoot, sessionId: loc.sessionId, pluginPath: bound.binding.pluginPath,
      runtimeHome: loc.runtimeHome, overlayPath: loc.overlayPath,
      env: cleanEnvironment(options.env || process.env, loc.runtimeHome), ...(commandId === undefined ? {} : { commandId }) };
  }

  async function overlay(loc, bound, modelPatches) {
    const manifest = bound.manifest;
    const exportsRoot = manifest.exports && typeof manifest.exports === "object" && !Array.isArray(manifest.exports) && Object.hasOwn(manifest.exports, ".")
      ? manifest.exports["."] : manifest.exports;
    const entry = exportedEntry(exportsRoot) || (typeof manifest.main === "string" ? manifest.main : "./index.js");
    const entryPath = await realpath(path.resolve(bound.binding.pluginPath, entry));
    if (!inside(bound.binding.pluginPath, entryPath) || !inside(loc.workspaceRoot, entryPath) || !(await lstat(entryPath)).isFile()) {
      throw new Error("Plugin entry must resolve to a file inside its package and workspace");
    }
    await checkPaths(loc, true);
    const lines = ["# Temporary plugin-dev overlay; never installed in the parent profile.",
      "- insert:", `    - id: ${JSON.stringify(`plugin-dev-${loc.sessionId}`)}`,
      `      name: ${JSON.stringify(pathToFileURL(entryPath).href)}`];
    // Flow-style JSON is also valid YAML; JSON.stringify keeps every value quoted safely.
    for (const patch of modelPatches ?? []) {
      if (!patch || typeof patch.id !== "string" || !patch.id) continue;
      lines.push(`- id: ${JSON.stringify(patch.id)}`, `  config: ${JSON.stringify(patch.config ?? {})}`);
    }
    await writeSafe(loc.overlayPath, `${lines.join("\n")}\n`);
  }

  async function start(item, kind, spec, ctx) {
    const state = item[kind];
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(spec.command, spec.args, { cwd: kind === "runtime" ? ctx.workspaceRoot : ctx.pluginPath,
          env: ctx.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        state.state = "error"; state.error = error.message; state.pid = null;
        log(item, kind, "system", error.message); resolve(); return;
      }
      let finish;
      const processRecord = { child, groupPid: child.pid || null, pluginPath: ctx.pluginPath, stopped: false, closed: false,
        done: new Promise((done) => { finish = done; }) };
      item[`${kind}Process`] = processRecord;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", (text) => {
          log(item, kind, stream, text);
          if (kind === "runtime" && !processRecord.stopped && state.state === "running") captureUrl(item, text);
        });
      }
      child.once("spawn", () => {
        processRecord.groupPid = child.pid;
        state.pid = child.pid; state.state = "running";
        resolve();
      });
      child.once("error", (error) => {
        state.pid = null;
        if (!processRecord.stopped) { state.state = "error"; state.error = error.message; }
        log(item, kind, "system", error.message);
        resolve();
      });
      child.once("exit", (code, signal) => {
        state.pid = null; state.exitCode = code; state.signal = signal;
        if (!processRecord.stopped && state.state !== "error") {
          state.state = code === 0 ? "exited" : "error";
          state.error = code === 0 ? null : `Process exited ${signal ? `with signal ${signal}` : `with code ${code}`}`;
        }
        if (kind === "runtime") state.url = null;
        log(item, kind, "system", `Process exited: ${code ?? signal ?? "unknown"}`);
      });
      child.once("close", () => {
        processRecord.closed = true;
        // Forget reaped groups promptly, so a later PID reuse cannot be killed.
        try { if (!groupAlive(processRecord)) processRecord.groupPid = null; }
        catch (error) { log(item, kind, "system", error.message); }
        finish(); resolve();
      });
    });
  }

  function groupAlive(proc) {
    if (!proc.groupPid) return false;
    try {
      process.kill(process.platform === "win32" ? proc.groupPid : -proc.groupPid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      // kill(0) may report EPERM while a macOS process group is exiting.
      // It is a liveness probe, not a request to signal: conservatively wait.
      if (error.code === "EPERM") return true;
      throw error;
    }
  }

  function signal(proc, name) {
    if (!proc.groupPid) return;
    try { process.kill(process.platform === "win32" ? proc.groupPid : -proc.groupPid, name); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  async function terminate(proc) {
    if (!proc) return;
    proc.stopped = true;
    signal(proc, "SIGTERM");
    if (groupAlive(proc)) {
      let timer;
      await Promise.race([proc.done, new Promise((resolve) => { timer = setTimeout(resolve, stopTimeoutMs); })]);
      clearTimeout(timer);
      // The group can outlive its leader (including when close already fired).
      if (groupAlive(proc)) signal(proc, "SIGKILL");
    }
    if (!proc.closed) {
      let timer;
      await Promise.race([proc.done, new Promise((resolve) => { timer = setTimeout(resolve, stopTimeoutMs); })]);
      clearTimeout(timer);
    }
  }

  function terminalFailure(item, terminal, error) {
    terminal.state.state = "error";
    terminal.state.error = error instanceof Error ? error.message : String(error);
    log(item, "terminal", "system", terminal.state.error, terminal.state.id);
  }

  async function terminalSpec(ctx, input) {
    const subprocess = options.subprocess;
    if (typeof subprocess?.spawnTerminal !== "function") {
      throw new Error("True PTY terminals require the official subprocess.spawnTerminal service");
    }
    const environment = typeof subprocess.terminalEnvironment === "function"
      ? await subprocess.terminalEnvironment() : {};
    const platform = environment.platform || (process.platform === "win32" ? "windows" : "posix");
    let shell = environment.defaultShell || (platform === "windows" ? ctx.env.ComSpec || "cmd.exe" : ctx.env.SHELL || "/bin/sh");
    if (typeof shell !== "string" || !shell || shell.includes("\0")) throw new Error("Invalid terminal default shell");
    const env = terminalOverrides({ ...ctx.env, PWD: ctx.pluginPath });
    if (typeof subprocess.resolveExecutable === "function") shell = await subprocess.resolveExecutable(shell, env);
    const argv = input.commandId === undefined
      ? terminalArguments(shell, platform)
      : commandArguments(shell, platform, `pnpm run ${input.commandId}`);
    validateSpec({ command: argv[0], args: argv.slice(1) });
    return { argv, cwd: ctx.pluginPath, env, rows: input.rows, cols: input.cols,
      terminalType: "xterm-256color", graceMs: stopTimeoutMs };
  }

  async function startTerminal(item, terminal, spec) {
    const handle = await options.subprocess.spawnTerminal(spec);
    terminal.handle = handle;
    terminal.state.pid = handle.pid ?? null;
    terminal.state.state = "running";
    // Attach a rejection handler immediately: provider/spawn failures may reject
    // done independently of the Readable's end/error events.
    terminal.done = Promise.resolve(handle.done).then((outcome) => {
      const state = terminal.state;
      state.pid = null;
      state.exitCode = outcome?.exitCode ?? null;
      state.signal = outcome?.signal ?? null;
      if (!terminal.stopping && state.state !== "error") {
        const success = state.exitCode === 0 && state.signal === null;
        state.state = success ? "exited" : "error";
        state.error = success ? null : `Terminal exited ${state.signal ? `with signal ${state.signal}` : `with code ${state.exitCode ?? "unknown"}`}`;
      }
      log(item, "terminal", "system", `Terminal exited: ${state.exitCode ?? state.signal ?? "unknown"}`, state.id);
    }, (error) => {
      terminal.state.pid = null;
      terminalFailure(item, terminal, error);
    });
    handle.output.setEncoding("utf8");
    terminal.outputDone = (async () => {
      try {
        // The official handle exposes a Node Readable (PassThrough), not events
        // from node-pty itself. Drain continuously; only our bounded log survives.
        for await (const chunk of handle.output) {
          appendTerminalOutput(terminal, chunk);
          log(item, "terminal", "stdout", chunk, terminal.state.id);
        }
      } catch (error) {
        terminalFailure(item, terminal, error);
        // Do not await here: termination itself waits for this reader to drain.
        void terminateTerminal(item, terminal).catch(() => {});
      }
    })();
    // A shell exit is not proof that every foreground/background member is gone.
    // Keep provider ownership until its awaited managed-range cleanup succeeds.
    void terminal.done.then(() => terminateTerminal(item, terminal)).catch(() => {});
  }

  async function terminateTerminal(item, terminal) {
    if (!terminal?.handle) return;
    if (terminal.cleanup) return terminal.cleanup;
    terminal.stopping = true;
    const cleanup = (async () => {
      try {
        await terminal.handle.terminate();
        await Promise.all([terminal.done, terminal.outputDone]);
        terminal.handle = null;
        terminal.state.pid = null;
        if (["starting", "running"].includes(terminal.state.state)) terminal.state.state = "closed";
      } catch (error) {
        terminalFailure(item, terminal, error);
        throw error;
      }
    })();
    terminal.cleanup = cleanup;
    try { await cleanup; }
    finally { if (terminal.cleanup === cleanup) terminal.cleanup = null; }
  }

  async function settleCleanup(operations) {
    const results = await Promise.allSettled(operations);
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Sandbox process cleanup failed");
  }

  async function stopItem(item) {
    await settleCleanup([terminate(item.runtimeProcess), terminate(item.commandProcess),
      ...[...item.terminals.values()].map((terminal) => terminateTerminal(item, terminal))]);
    item.runtimeProcess = null; item.commandProcess = null;
    item.runtime = runtimeState(item.loc.runtimeHome); item.command = commandState(); item.urlTail = "";
    item.terminals.clear();
    await clearCredentials(item);
  }

  // Copied secrets must not outlive the process that needed them.
  async function clearCredentials(item) {
    item.credentialRefs = [];
    const target = item.loc.credentialsPath;
    if (!inside(item.loc.workspaceRoot, target)) return;
    if (await regularFile(target)) await unlink(target);
  }

  return {
    async bind(input) {
      return serialized(input, async (loc, item) => {
        await checkPaths(loc);
        const bound = await plugin(loc, input.pluginPath);
        await stopItem(item);
        await checkPaths(loc, true);
        await writeSafe(loc.bindingPath, `${JSON.stringify({ pluginPath: bound.binding.pluginPath }, null, 2)}\n`);
        item.logs = []; item.logBytes = 0;
        return snapshot(item, bound);
      });
    },
    async status(input) {
      return serialized(input, async (loc, item) => {
        await loadModels(loc, item);
        return snapshot(item, await binding(loc));
      });
    },
    async saveModels(input) {
      return serialized(input, async (loc, item) => {
        const selected = Array.isArray(input.selectedModels) ? input.selectedModels : [];
        if (selected.some((entry) => !entry || typeof entry.provider !== "string" || typeof entry.model !== "string")) {
          throw new TypeError("selectedModels must be an array of {provider, model} strings");
        }
        await checkPaths(loc, true);
        await writeSafe(loc.modelsPath, `${JSON.stringify({ selected: selected.map(({ provider, model }) => ({ provider, model })) }, null, 2)}\n`);
        item.models = selected.map(({ provider, model }) => ({ provider, model }));
        item.modelsLoaded = true;
        return snapshot(item, await binding(loc));
      });
    },
    async launch(input) {
      return serialized(input, async (loc, item) => {
        const bound = await binding(loc);
        if (!bound) throw new Error("No plugin is bound to this session");
        await loadModels(loc, item);
        if (["starting", "running"].includes(item.runtime.state) && item.runtimeProcess?.pluginPath === bound.binding.pluginPath) {
          return snapshot(item, bound);
        }
        await terminate(item.runtimeProcess); item.runtimeProcess = null;
        item.runtime = { ...runtimeState(loc.runtimeHome), state: "starting" }; item.urlTail = "";
        try {
          const ctx = await context(loc, bound);
          await overlay(loc, bound, input.modelPatches);
          const document = credentialsDocument(Array.isArray(input.credentials) ? input.credentials : []);
          if (document) {
            await checkPaths(loc, true);
            await writeSafe(loc.credentialsPath, document, 0o600);
            item.credentialRefs = document.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*): /gm)?.map((line) => line.trim().slice(0, -1)) ?? [];
          } else {
            await clearCredentials(item);
          }
          // --patch belongs to the launcher; flags after --host are forwarded
          // to the web app, which rejects a trailing --patch as unknown.
          const spec = validateSpec(options.launchSpec === undefined
            ? { command: "dsh", args: ["web", "--patch", loc.overlayPath, "--host", "127.0.0.1", "--port", "0", "--no-open"] }
            : typeof options.launchSpec === "function" ? await options.launchSpec(ctx) : options.launchSpec);
          await start(item, "runtime", spec, ctx);
        } catch (error) { item.runtime.state = "error"; item.runtime.error = error.message; log(item, "runtime", "system", error.message); }
        return snapshot(item, bound);
      });
    },
    async run(input) {
      return serialized(input, async (loc, item) => {
        const bound = await binding(loc);
        if (!bound) throw new Error("No plugin is bound to this session");
        if (typeof input.commandId !== "string" || !bound.commands.some(({ id }) => id === input.commandId)) {
          throw new Error("commandId must be an exact package.json script key");
        }
        if (item.command.state === "running" && item.commandProcess?.pluginPath === bound.binding.pluginPath) {
          if (item.command.id !== input.commandId) throw new Error("A different command is already running in this session");
          return snapshot(item, bound);
        }
        await terminate(item.commandProcess); item.commandProcess = null;
        item.command = { ...commandState(), id: input.commandId, state: "running" };
        try {
          const ctx = await context(loc, bound, input.commandId);
          const spec = validateSpec(options.commandSpec === undefined
            ? { command: "pnpm", args: ["run", input.commandId] }
            : typeof options.commandSpec === "function" ? await options.commandSpec(ctx) : options.commandSpec);
          await start(item, "command", spec, ctx);
        } catch (error) { item.command.state = "error"; item.command.error = error.message; log(item, "command", "system", error.message); }
        return snapshot(item, bound);
      });
    },
    async terminalCreate(input) {
      return serialized(input, async (loc, item) => {
        const id = terminalId(input.terminalId ?? `terminal-${randomUUID()}`);
        const rows = terminalDimension(input.rows, 24, "rows");
        const cols = terminalDimension(input.cols, 80, "cols");
        const bound = await binding(loc);
        if (!bound) throw new Error("No plugin is bound to this session");
        if (input.commandId !== undefined
          && (typeof input.commandId !== "string" || !bound.commands.some(({ id: commandId }) => commandId === input.commandId))) {
          throw new Error("commandId must be an exact package.json script key");
        }
        // A manually replaced binding must not preserve terminals from the old
        // package, even if this request creates an unrelated new terminal id.
        await settleCleanup([...item.terminals.values()]
          .filter((terminal) => terminal.pluginPath !== bound.binding.pluginPath)
          .map((terminal) => terminateTerminal(item, terminal)));
        const previous = item.terminals.get(id);
        if (previous?.state.state === "running" && previous.pluginPath === bound.binding.pluginPath) {
          return snapshot(item, bound);
        }
        await terminateTerminal(item, previous);
        const terminal = { pluginPath: bound.binding.pluginPath, handle: null, cleanup: null, stopping: false,
          done: Promise.resolve(), outputDone: Promise.resolve(),
          // Raw PTY text for the inline terminal: `end` counts every character
          // ever emitted, so a client can resume from its own cursor.
          buffer: "", end: 0,
          state: { id, commandId: input.commandId ?? null, state: "starting", pid: null, exitCode: null, signal: null, error: null } };
        item.terminals.set(id, terminal);
        try {
          const ctx = await context(loc, bound);
          await startTerminal(item, terminal, await terminalSpec(ctx, { rows, cols, commandId: input.commandId }));
        } catch (error) {
          terminalFailure(item, terminal, error);
          // A provider may have allocated a PTY before stream setup fails. Never
          // discard that handle; cleanup failure stays visible and retryable.
          await terminateTerminal(item, terminal);
        }
        return snapshot(item, bound);
      });
    },
    async terminalWrite(input) {
      return serialized(input, async (loc, item) => {
        const id = terminalId(input.terminalId);
        if (typeof input.data !== "string" || Buffer.byteLength(input.data) > 64 * 1024) {
          throw new TypeError("Terminal data must be a string of at most 64 KiB");
        }
        const terminal = item.terminals.get(id);
        if (!terminal) throw new Error("Unknown terminalId for this session");
        const bound = await binding(loc);
        if (!bound || terminal.pluginPath !== bound.binding.pluginPath) {
          await terminateTerminal(item, terminal);
          throw new Error("Terminal does not belong to the current plugin binding");
        }
        if (!terminal.handle || terminal.stopping || terminal.state.state !== "running") {
          throw new Error("Terminal is not running");
        }
        try { await terminal.handle.write(input.data); }
        catch (error) {
          terminalFailure(item, terminal, error);
          await terminateTerminal(item, terminal);
        }
        return snapshot(item, bound);
      });
    },
    // Read PTY output from a character cursor. The UI polls this while a terminal
    // tab is open; the model tool uses status logs instead.
    async terminalPoll(input) {
      const id = terminalId(input.terminalId);
      const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
      return serialized(input, async (loc) => {
        const terminal = record(loc).terminals.get(id);
        if (!terminal) return { terminalId: id, offset, dropped: 0, data: "", state: "closed" };
        const start = terminal.end - terminal.buffer.length;
        const from = Math.max(offset, start);
        return { terminalId: id, offset: terminal.end, dropped: from - offset,
          data: terminal.buffer.slice(from - start), state: terminal.state.state };
      });
    },
    async terminalResize(input) {
      return serialized(input, async (loc, item) => {
        const id = terminalId(input.terminalId);
        const rows = terminalDimension(input.rows, 24, "rows");
        const cols = terminalDimension(input.cols, 80, "cols");
        const terminal = item.terminals.get(id);
        if (!terminal || !terminal.handle || typeof terminal.handle.resize !== "function") return snapshot(item, await binding(loc));
        try { await terminal.handle.resize(cols, rows); }
        catch (error) { terminalFailure(item, terminal, error); }
        return snapshot(item, await binding(loc));
      });
    },
    async terminalClose(input) {
      return serialized(input, async (loc, item) => {
        const id = terminalId(input.terminalId);
        const terminal = item.terminals.get(id);
        if (terminal) {
          // Clean up before reading a possibly deleted or corrupt manifest.
          await terminateTerminal(item, terminal);
          terminal.state.state = "closed";
          item.terminals.delete(id);
        }
        return snapshot(item, await binding(loc));
      });
    },
    async stop(input) {
      return serialized(input, async (loc, item) => {
        // Stop owned processes even if a plugin removed/corrupted its manifest.
        await stopItem(item);
        return snapshot(item, await binding(loc));
      });
    },
    async unbind(input) {
      return serialized(input, async (loc, item) => {
        await stopItem(item);
        await checkPaths(loc);
        if (await regularFile(loc.bindingPath)) {
          if (path.resolve(loc.bindingPath) !== path.join(loc.base, "binding.json") || !inside(loc.workspaceRoot, loc.bindingPath)) {
            throw new Error("Unsafe binding removal target");
          }
          await unlink(loc.bindingPath);
        }
        return snapshot(item, null);
      });
    },
    async dispose() {
      if (!disposal) {
        disposed = true;
        disposal = (async () => {
          await Promise.allSettled([...queues.values()]);
          await settleCleanup([...sessions.values()].map(stopItem));
          sessions.clear();
        })();
      }
      const current = disposal;
      try { await current; }
      catch (error) {
        // Keep new operations disabled, but allow a later dispose() to retry
        // provider cleanup that failed instead of losing the retained handles.
        if (disposal === current) disposal = undefined;
        throw error;
      }
    },
  };
}
