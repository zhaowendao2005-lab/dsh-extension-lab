import path from "node:path";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

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

async function writeSafe(target, content) {
  await regularFile(target);
  // Never truncate before verifying the opened inode (including hard links).
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Unsafe output file: ${target}`);
    await handle.truncate(0);
    await handle.writeFile(content, "utf8");
  } finally { await handle.close(); }
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
 *  logs:[{time,source,stream,text}]}.
 * runtime states: stopped/starting/running/exited/error;
 * command states: idle/running/exited/error. dispose resolves undefined.
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
      bindingPath: path.join(base, "binding.json"), runtimeHome: path.join(base, "runtime"),
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
    await regularFile(loc.overlayPath);
  }

  function record(loc) {
    if (!sessions.has(loc.key)) sessions.set(loc.key, { loc, runtime: runtimeState(loc.runtimeHome), command: commandState(),
      runtimeProcess: null, commandProcess: null, logs: [], logBytes: 0, urlTail: "" });
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
      runtime: { ...item.runtime }, command: { ...item.command }, logs: item.logs.map((line) => ({ ...line })) };
  }

  function log(item, source, stream, raw) {
    let text = String(raw);
    if (Buffer.byteLength(text) > maxLogBytes) {
      text = Buffer.from(text).subarray(-maxLogBytes).toString("utf8");
      while (Buffer.byteLength(text) > maxLogBytes) text = text.slice(1);
    }
    if (!text) return;
    const entry = { time: new Date().toISOString(), source, stream, text };
    item.logs.push(entry);
    item.logBytes += Buffer.byteLength(text);
    while (item.logs.length > maxLogEntries || item.logBytes > maxLogBytes) {
      item.logBytes -= Buffer.byteLength(item.logs.shift().text);
    }
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

  async function overlay(loc, bound) {
    const manifest = bound.manifest;
    const exportsRoot = manifest.exports && typeof manifest.exports === "object" && !Array.isArray(manifest.exports) && Object.hasOwn(manifest.exports, ".")
      ? manifest.exports["."] : manifest.exports;
    const entry = exportedEntry(exportsRoot) || (typeof manifest.main === "string" ? manifest.main : "./index.js");
    const entryPath = await realpath(path.resolve(bound.binding.pluginPath, entry));
    if (!inside(bound.binding.pluginPath, entryPath) || !inside(loc.workspaceRoot, entryPath) || !(await lstat(entryPath)).isFile()) {
      throw new Error("Plugin entry must resolve to a file inside its package and workspace");
    }
    await checkPaths(loc, true);
    await writeSafe(loc.overlayPath, `# Temporary plugin-dev overlay; never installed in the parent profile.\n- insert:\n    - id: ${JSON.stringify(`plugin-dev-${loc.sessionId}`)}\n      name: ${JSON.stringify(pathToFileURL(entryPath).href)}\n`);
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

  async function stopItem(item) {
    await Promise.all([terminate(item.runtimeProcess), terminate(item.commandProcess)]);
    item.runtimeProcess = null; item.commandProcess = null;
    item.runtime = runtimeState(item.loc.runtimeHome); item.command = commandState(); item.urlTail = "";
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
      return serialized(input, async (loc, item) => snapshot(item, await binding(loc)));
    },
    async launch(input) {
      return serialized(input, async (loc, item) => {
        const bound = await binding(loc);
        if (!bound) throw new Error("No plugin is bound to this session");
        if (["starting", "running"].includes(item.runtime.state) && item.runtimeProcess?.pluginPath === bound.binding.pluginPath) {
          return snapshot(item, bound);
        }
        await terminate(item.runtimeProcess); item.runtimeProcess = null;
        item.runtime = { ...runtimeState(loc.runtimeHome), state: "starting" }; item.urlTail = "";
        try {
          const ctx = await context(loc, bound);
          await overlay(loc, bound);
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
          await Promise.all([...sessions.values()].map(stopItem));
          sessions.clear();
        })();
      }
      await disposal;
    },
  };
}
