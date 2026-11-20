/**
 * Cross-platform Host compatibility helpers for the plugin-dev sandbox:
 * path containment, case-insensitive env isolation, shell/cmd script args,
 * and Windows `.cmd`/`.bat` executable preparation.
 */
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';

const WIN_BATCH_EXT = /\.(?:cmd|bat)$/i;
const CMD_UNSAFE = /["%!\r\n\0]/;

/** Case-aware canonical comparison (`win32` drives and NTFS folders ignore case). */
export function samePath(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (platform === 'win32') {
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  }
  return path.normalize(left) === path.normalize(right);
}

/** Containment check via `path.relative` (safe across drive roots and casing on Windows). */
export function pathInside(root, target, strictChild = false, platform = process.platform) {
  if (typeof root !== 'string' || typeof target !== 'string' || !root || !target) return false;
  const api = platform === 'win32' ? path.win32 : path;
  const rel = api.relative(root, target);
  if (!rel) return !strictChild;
  return rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel);
}

/** Extract lowercase shell executable stem without `.exe`. */
export function shellName(shell, platform = process.platform) {
  const api = platform === 'windows' || platform === 'win32' ? path.win32 : path;
  return api.basename(String(shell ?? '')).toLowerCase().replace(/\.exe$/, '');
}

/** Build interactive PTY shell launch argv without loading intrusive profiles when applicable. */
export function terminalArguments(shell, platform) {
  const name = shellName(shell, platform);
  if (name === 'bash') return [shell, '--noprofile', '--norc', '-i'];
  if (name === 'zsh') return [shell, '-f', '-i'];
  if (name === 'fish') return [shell, '--no-config', '-i'];
  if (name === 'pwsh' || name === 'powershell') return [shell, '-NoLogo', '-NoProfile'];
  if (name === 'cmd') return [shell, '/d', '/q'];
  return platform === 'windows' ? [shell] : [shell, '-i'];
}

/**
 * Build shell argv to execute a package script cleanly across cmd, PowerShell, and POSIX shells.
 * `scriptId` is quoted per shell dialect so spaces or metacharacters never inject commands.
 */
export function scriptCommandArguments(shell, platform, scriptId) {
  if (typeof scriptId !== 'string' || !scriptId || /[\r\n\0]/.test(scriptId)) {
    throw new TypeError('Invalid package script identifier');
  }
  const name = shellName(shell, platform);
  if (name === 'pwsh' || name === 'powershell') {
    const quoted = `'${scriptId.replace(/'/g, "''")}'`;
    return [shell, '-NoLogo', '-NoProfile', '-Command', `& pnpm run ${quoted}`];
  }
  if (name === 'cmd' || (platform === 'windows' && !['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(name))) {
    if (CMD_UNSAFE.test(scriptId)) {
      throw new Error('Package script name contains characters (", %, !) not safe for cmd.exe; use PowerShell');
    }
    return [shell, '/d', '/s', '/c', `pnpm run "${scriptId}"`];
  }
  if (name === 'fish') {
    const quoted = `'${scriptId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    return [shell, '-c', `pnpm run ${quoted}`];
  }
  const quoted = `'${scriptId.replace(/'/g, "'\"'\"'")}'`;
  return [shell, '-c', `pnpm run ${quoted}`];
}

function assignCaseAware(target, key, value, win) {
  if (value === undefined) return;
  if (win) {
    const upper = key.toUpperCase();
    for (const existing of Object.keys(target)) {
      if (existing.toUpperCase() === upper && existing !== key) delete target[existing];
    }
  }
  target[key] = value;
}

/**
 * Copy allowed variables from `source` and overwrite isolated profile directories
 * (including Windows `APPDATA` / `LOCALAPPDATA`) while deduplicating case variants on Windows.
 */
export function cleanIsolatedEnvironment(source, home, forbiddenPattern, platform = process.platform) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (!forbiddenPattern.test(key) && typeof value === 'string') env[key] = value;
  }
  const win = platform === 'win32' || platform === 'windows';
  const isolated = {
    DSH_HOME: home,
    HOME: path.join(home, 'home'),
    USERPROFILE: path.join(home, 'home'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    APPDATA: path.join(home, 'config'),
    LOCALAPPDATA: path.join(home, 'cache'),
  };
  for (const [key, value] of Object.entries(isolated)) assignCaseAware(env, key, value, win);
  return env;
}

/**
 * Merge isolated env onto ambient tombstones while preserving insertion order after any
 * differently-cased `undefined` entries (required by Windows case-insensitive merging).
 */
export function buildIsolatedTerminalOverrides(ambientEnv, isolatedEnv, forcedNames, platform = process.platform) {
  const win = platform === 'win32' || platform === 'windows';
  const overrides = {};
  for (const key of Object.keys(ambientEnv)) overrides[key] = undefined;

  const setLast = (key, value) => {
    if (win) {
      const upper = key.toUpperCase();
      for (const existing of Object.keys(overrides)) {
        if (existing.toUpperCase() === upper) overrides[existing] = undefined;
      }
    }
    delete overrides[key];
    overrides[key] = value;
  };

  for (const [key, value] of Object.entries(isolatedEnv)) setLast(key, value);
  for (const name of forcedNames) setLast(name, isolatedEnv[name]);
  return overrides;
}

async function fileExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readEnvCaseInsensitive(env, target) {
  if (!env || typeof env !== 'object') return undefined;
  if (typeof env[target] === 'string') return env[target];
  const upper = target.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && typeof value === 'string') return value;
  }
  return undefined;
}

/** Resolve Windows executable on PATH / PATHEXT when `resolveExecutable` is unavailable. */
export async function resolveWindowsCommand(command, env = process.env) {
  const pathextRaw = readEnvCaseInsensitive(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD';
  const exts = pathextRaw.split(';').map((ext) => ext.trim()).filter(Boolean);
  const candidatesFor = (base) => (path.win32.extname(base) ? [base] : [base, ...exts.map((ext) => `${base}${ext}`)]);

  if (command.includes('\\') || command.includes('/')) {
    for (const candidate of candidatesFor(command)) {
      if (await fileExists(candidate)) return candidate;
    }
    return null;
  }

  const pathValue = readEnvCaseInsensitive(env, 'PATH') || '';
  for (const dir of pathValue.split(';').map((part) => part.trim()).filter(Boolean)) {
    const cleanDir = dir.replace(/^"(.*)"$/, '$1');
    for (const candidate of candidatesFor(path.win32.join(cleanDir, command))) {
      if (await fileExists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Prepare `{ command, args, verbatim }` for `spawn(..., { shell: false })`.
 * Node 22+ rejects `.cmd`/`.bat` under `shell: false` (`EINVAL`), so batch shims on Windows
 * are wrapped via `ComSpec /d /s /c` with strict metacharacter validation and verbatim quoting.
 */
export async function prepareSpawnSpec(spec, { env = process.env, platform = process.platform, resolveExecutable } = {}) {
  if (platform !== 'win32') {
    return { command: spec.command, args: [...spec.args], verbatim: false };
  }

  let resolved = null;
  if (typeof resolveExecutable === 'function') {
    try { resolved = await resolveExecutable(spec.command, env); } catch { resolved = null; }
  }
  if (!resolved) resolved = await resolveWindowsCommand(spec.command, env);
  const target = resolved || spec.command;

  if (!WIN_BATCH_EXT.test(target)) {
    return { command: target, args: [...spec.args], verbatim: false };
  }

  const parts = [target, ...spec.args];
  for (const part of parts) {
    if (CMD_UNSAFE.test(part)) {
      throw new Error(`Windows batch wrapper cannot safely pass characters (", %, !) in: ${part}`);
    }
  }
  const cmdLine = `"${parts.map((part) => `"${part}"`).join(' ')}"`;
  const comspec = readEnvCaseInsensitive(env, 'ComSpec') || 'cmd.exe';
  return { command: comspec, args: ['/d', '/s', '/c', cmdLine], verbatim: true };
}
