/**
 * Cross-platform sandbox filesystem helpers: path containment, Windows case-insensitive
 * canonical comparisons, and clearing DOS read-only attributes (`0o400`) before cleanup.
 */
import * as fs from 'node:fs/promises';
import path from 'node:path';

const RETRY_CODES = new Set(['EBUSY', 'EPERM']);

/** Case-aware canonical path comparison (`win32` ignores drive/directory letter case). */
export function samePath(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (platform === 'win32') {
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  }
  return path.normalize(left) === path.normalize(right);
}

/** Containment check via `path.relative` (safe for Windows drive roots and mixed casing). */
export function pathInside(root, target, strictChild = false, platform = process.platform) {
  if (typeof root !== 'string' || typeof target !== 'string' || !root || !target) return false;
  const api = platform === 'win32' ? path.win32 : path;
  const rel = api.relative(root, target);
  if (!rel) return !strictChild;
  return rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel);
}

/** Retry short-lived Windows file locks (`EBUSY` / `EPERM`) from indexers or scanners. */
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

/**
 * Node on Windows sets `FILE_ATTRIBUTE_READONLY` when files are created with `0o400`
 * (such as `RULES.md` and `input/task.json`). `fs.rm` fails with `EPERM` unless those
 * read-only attributes are cleared first without following symbolic links.
 */
export async function clearReadOnlyTree(target, { platform = process.platform } = {}) {
  if (platform !== 'win32') return;
  const info = await fs.lstat(target).catch(() => null);
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await fs.chmod(target, 0o700).catch(() => {});
    const dir = await fs.opendir(target).catch(() => null);
    if (!dir) return;
    for await (const entry of dir) {
      await clearReadOnlyTree(path.join(target, entry.name), { platform });
    }
    return;
  }
  if (info.isFile() && (info.mode & 0o200) === 0) {
    await fs.chmod(target, 0o600).catch(() => {});
  }
}

/** Remove an already-verified directory tree safely across POSIX and Windows. */
export async function removeDirectorySafe(root, { force = false, platform = process.platform } = {}) {
  await clearReadOnlyTree(root, { platform });
  await withFsRetry(() => fs.rm(root, { recursive: true, force }), { platform });
}
