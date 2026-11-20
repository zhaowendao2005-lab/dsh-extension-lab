/**
 * Cross-platform Host compatibility primitives (paths, env overrides, shell names, FS retries).
 * Kept child_process-free so static rule R11 remains intact across every caller.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const RETRY_CODES = new Set(['EBUSY', 'EPERM']);

/** Convert native path separators to POSIX `/` for manifests, watchers, and esbuild keys. */
export function toPosix(value) {
  return String(value ?? '').replaceAll('\\', '/');
}

/** Case-aware canonical comparison (`win32` drives and NTFS folders ignore case). */
export function samePath(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (platform === 'win32') {
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  }
  return path.normalize(left) === path.normalize(right);
}

/**
 * Containment check using `path.relative` rather than string prefixes so Windows drive
 * roots (`C:\`), mixed drive casing, and sibling-prefix paths (`/ws` vs `/ws2`) work alike.
 */
export function pathInside(root, target, strictChild = false, platform = process.platform) {
  if (typeof root !== 'string' || typeof target !== 'string' || !root || !target) return false;
  const api = platform === 'win32' ? path.win32 : path;
  const rel = api.relative(root, target);
  if (!rel) return !strictChild;
  return rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel);
}

/** Extract shell executable basename using platform path rules. */
export function shellBasename(shell, platform = process.platform) {
  const api = platform === 'windows' || platform === 'win32' ? path.win32 : path;
  return api.basename(String(shell ?? ''));
}

/** Build whitelisted env overrides; clears differently-cased tombstones before assigning on Windows. */
export function buildEnvOverrides({ ambientEnv = process.env, sourceEnv = {}, keepKeys = [], forced = {}, platform = process.platform } = {}) {
  const overrides = {};
  for (const key of new Set([...Object.keys(ambientEnv), ...Object.keys(sourceEnv)])) {
    overrides[key] = undefined;
  }

  const indexUpper = (obj) => {
    const map = new Map();
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) map.set(key.toUpperCase(), value);
    }
    return map;
  };
  const win = platform === 'win32' || platform === 'windows';
  const sourceUpper = win ? indexUpper(sourceEnv) : null;
  const ambientUpper = win ? indexUpper(ambientEnv) : null;

  const assign = (key, value) => {
    if (value === undefined) return;
    if (win) {
      const upper = key.toUpperCase();
      for (const existing of Object.keys(overrides)) {
        if (existing.toUpperCase() === upper) overrides[existing] = undefined;
      }
      delete overrides[key];
    }
    overrides[key] = value;
  };

  for (const key of keepKeys) {
    const value = win
      ? (sourceEnv[key] ?? sourceUpper.get(key.toUpperCase()) ?? ambientEnv[key] ?? ambientUpper.get(key.toUpperCase()))
      : (sourceEnv[key] ?? ambientEnv[key]);
    assign(key, value);
  }
  for (const [key, value] of Object.entries(forced)) {
    assign(key, value);
  }
  return overrides;
}

/** Retry short-lived Windows antivirus/indexer locks (`EBUSY` / `EPERM`). */
export async function withFsRetry(operation, { platform = process.platform, retries = 3, baseDelayMs = 25 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (platform !== 'win32' || !RETRY_CODES.has(error?.code) || attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

async function isCaseOnlyTarget(source, target, platform) {
  if (platform !== 'win32' && platform !== 'darwin') return false;
  if (source === target || source.toLowerCase() !== target.toLowerCase()) return false;
  try {
    const [srcStat, dstStat] = await Promise.all([fs.lstat(source), fs.lstat(target)]);
    return srcStat.ino !== 0 ? (srcStat.dev === dstStat.dev && srcStat.ino === dstStat.ino) : true;
  } catch {
    return false;
  }
}

/** Rename supporting case-only changes on NTFS/APFS and transient Windows file-lock retries. */
export async function renameCaseSafe(source, target, { platform = process.platform } = {}) {
  let conflict = false;
  try {
    await fs.access(target);
    conflict = !(await isCaseOnlyTarget(source, target, platform));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (conflict) {
    const error = new Error('Target already exists');
    error.code = 'EEXIST';
    throw error;
  }

  try {
    await withFsRetry(() => fs.rename(source, target), { platform });
  } catch (error) {
    if (error?.code === 'EPERM' && (platform === 'darwin' || platform === 'win32')) {
      const staging = `${source}.dsh-wid-case-${Date.now()}`;
      await withFsRetry(() => fs.rename(source, staging), { platform });
      await withFsRetry(() => fs.rename(staging, target), { platform });
      return;
    }
    throw error;
  }
}
