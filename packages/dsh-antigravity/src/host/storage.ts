import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Resolve DSH home directory matching `@deepseek-ai/dsh-home-paths`:
 * `$DSH_HOME` if non-empty, otherwise `~/.dsh`.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return path.join(homedir(), '.dsh');
}

export function resolveAntigravityStorageDir(overrideDir?: string): string {
  if (overrideDir && overrideDir.trim() !== '') {
    return path.resolve(overrideDir.trim());
  }
  return path.join(resolveDshHome(), 'antigravity');
}

export function resolveLegacyCredentialCandidates(): string[] {
  return [
    path.join(resolveDshHome(), 'credentials', 'antigravity.json'),
    path.join(homedir(), '.deepseek-harness', 'antigravity', 'credentials.json'),
  ];
}

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await chmod(dirPath, 0o700);
  } catch {
    // Best-effort on filesystems that do not support POSIX chmod bits.
  }
}

/**
 * Atomically write JSON file with strict 0o600 permissions.
 */
export async function writePrivateJsonFile(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensurePrivateDir(dir);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(tmpPath, 0o600);
  } catch {
    // Ignore unsupported chmod platforms.
  }
  await rename(tmpPath, filePath);
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Ignore unsupported chmod platforms.
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return undefined;
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
}
