/** Bounded workspace inventory and authoritative, read-only package script lookup. */
import path from 'node:path';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { ideError } from '../shared/errors.js';
import { LIMITS } from '../shared/contract.js';
import { runGit } from './git/exec.js';
import { pathInside, samePath, toPosix } from './platform.js';

const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', '.yarn', '.pnpm', '.pnpm-store', 'bower_components', 'vendor', '.venv', 'venv', '__pycache__', '.cache', '.npm', '.turbo', '.next', '.nuxt', '.output', '.parcel-cache', '.svelte-kit', '.gradle', 'dist', 'coverage']);
export const INVENTORY_LIMITS = Object.freeze({ directories: 10000, entries: 100000, depth: 40, results: 2000, durationMs: 8000 });
const MANIFEST_BYTES = 1024 * 1024;
const posix = toPosix;
const within = pathInside;

function relativePath(value, field) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) {
    throw ideError('E_INVALID_ARG', '必须使用工作区相对路径', { field });
  }
  return value;
}

/** Require a real directory with its own .git marker, never an enclosing repository. */
export async function repositoryRoot(root, relative, timeoutMs = LIMITS.statusTimeoutMs) {
  relativePath(relative, 'repositoryPath');
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute)) throw ideError('E_OUTSIDE_ROOT', '仓库在工作区之外', { path: relative });
  let real;
  try { real = await realpath(absolute); } catch (error) {
    throw ideError(error?.code === 'ENOENT' ? 'E_NOT_FOUND' : 'E_PERMISSION', '无法访问仓库目录', { path: relative });
  }
  if (!within(root, real)) throw ideError('E_OUTSIDE_ROOT', '仓库在工作区之外', { path: relative });
  let marker;
  try { marker = await lstat(path.join(real, '.git')); } catch (error) {
    if (error?.code !== 'ENOENT') throw ideError('E_PERMISSION', '无法访问仓库标记', { path: relative });
  }
  if (!marker || (!marker.isDirectory() && !marker.isFile())) throw ideError('E_NOT_A_REPO', '所选目录不是 Git 仓库根目录', { path: relative });
  const result = await runGit(real, ['rev-parse', '--show-toplevel'], { timeoutMs });
  if (result.code !== 0) throw ideError('E_NOT_A_REPO', '所选目录不是 Git 工作树', { path: relative });
  let top;
  try { top = await realpath(result.stdout.replace(/\r?\n$/, '')); } catch {
    throw ideError('E_NOT_A_REPO', '无法解析 Git 工作树根目录', { path: relative });
  }
  if (!samePath(top, real)) throw ideError('E_NOT_A_REPO', '所选目录不是 Git 仓库根目录', { path: relative });
  return real;
}

async function manifestAt(root, absolute) {
  let real;
  try { real = await realpath(absolute); } catch (error) {
    throw ideError(error?.code === 'ENOENT' ? 'E_NOT_FOUND' : 'E_PERMISSION', '无法访问 package.json', { path: posix(path.relative(root, absolute)) });
  }
  if (!within(root, real)) throw ideError('E_OUTSIDE_ROOT', 'package.json 在工作区之外', {});
  let handle;
  try {
    handle = await open(real, 'r');
    const info = await handle.stat();
    if (!info.isFile()) throw ideError('E_INVALID_ARG', 'package.json 必须是文件', { field: 'path' });
    if (info.size > MANIFEST_BYTES) throw ideError('E_TOO_LARGE', 'package.json 超过读取上限', { limit: MANIFEST_BYTES });
    const bytes = Buffer.alloc(MANIFEST_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MANIFEST_BYTES) throw ideError('E_TOO_LARGE', 'package.json 超过读取上限', { limit: MANIFEST_BYTES });
    let value;
    try { value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '')); } catch {
      throw ideError('E_INVALID_ARG', 'package.json 不是有效 JSON', { field: 'path' });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw ideError('E_INVALID_ARG', 'package.json 必须是对象', { field: 'path' });
    return value;
  } catch (error) {
    if (error?.code?.startsWith('E_')) throw error;
    throw ideError('E_PERMISSION', '无法读取 package.json', { syscall: error?.code ?? 'read' });
  } finally { await handle?.close(); }
}

export async function scanWorkspace(workspace) {
  const root = workspace.requireRoot();
  const started = Date.now();
  const repositories = [], packages = [], warnings = [];
  const counts = { directories: 0, entries: 0, repositories: 0, packages: 0 };
  let truncated = false;
  const warn = (message) => { if (warnings.length < 100 && !warnings.includes(message)) warnings.push(message); };
  const stop = (message) => { truncated = true; warn(message); };
  const pending = [{ absolute: root, depth: 0 }];
  while (pending.length) {
    if (Date.now() - started >= INVENTORY_LIMITS.durationMs) { stop('扫描达到时间上限'); break; }
    if (counts.directories >= INVENTORY_LIMITS.directories || counts.entries >= INVENTORY_LIMITS.entries) { stop('扫描达到目录或条目上限'); break; }
    const current = pending.pop();
    let directory;
    try {
      // Recheck every directory: never follow a symlink, including one replaced since readdir.
      if (!(await lstat(current.absolute)).isDirectory()) continue;
      const real = await realpath(current.absolute);
      if (!within(root, real)) { warn('跳过工作区外的目录'); continue; }
      directory = await opendir(real);
      counts.directories += 1;
      const children = [];
      for await (const entry of directory) {
        counts.entries += 1;
        if (counts.entries > INVENTORY_LIMITS.entries || Date.now() - started >= INVENTORY_LIMITS.durationMs) { stop('扫描达到条目或时间上限'); break; }
        const absolute = path.join(real, entry.name);
        const relative = posix(path.relative(root, absolute));
        if (entry.name === '.git' && (entry.isDirectory() || entry.isFile())) {
          try {
            const repo = await repositoryRoot(root, posix(path.relative(root, real)) || '.', Math.max(1, INVENTORY_LIMITS.durationMs - (Date.now() - started)));
            repositories.push({ path: posix(path.relative(root, repo)) || '.', name: path.basename(repo) || repo });
          } catch (error) {
            if (error?.code === 'E_TIMEOUT') stop('验证仓库达到时间上限');
            warn(relative + ': ' + (error?.message ?? '无法验证仓库'));
          }
        } else if (entry.name === 'package.json' && entry.isFile()) {
          try {
            const manifest = await manifestAt(root, absolute);
            packages.push({ path: relative, name: typeof manifest.name === 'string' && manifest.name ? manifest.name : path.basename(real) });
          } catch (error) {
            packages.push({ path: relative, name: path.basename(real) });
            warn(relative + ': ' + (error?.message ?? '无法读取包信息'));
          }
        }
        if (entry.isDirectory() && !SKIP.has(entry.name)) {
          if (current.depth >= INVENTORY_LIMITS.depth) stop('扫描达到目录深度上限');
          else if (pending.length + children.length >= INVENTORY_LIMITS.directories) stop('扫描达到待扫描目录上限');
          else children.push({ absolute, depth: current.depth + 1 });
        }
        if (repositories.length + packages.length >= INVENTORY_LIMITS.results) { stop('扫描达到结果数量上限'); break; }
      }
      children.sort((a, b) => b.absolute.localeCompare(a.absolute));
      pending.push(...children);
    } catch (error) {
      warn((posix(path.relative(root, current.absolute)) || '.') + ': ' + (error?.code ?? '无法访问目录'));
    }
    if (counts.entries >= INVENTORY_LIMITS.entries || repositories.length + packages.length >= INVENTORY_LIMITS.results) break;
  }
  repositories.sort((a, b) => a.path.localeCompare(b.path));
  packages.sort((a, b) => a.path.localeCompare(b.path));
  counts.repositories = repositories.length;
  counts.packages = packages.length;
  return { root, repositories, packages, truncated, warnings, counts, limits: INVENTORY_LIMITS };
}

/** Re-read on every call; script execution must use this same authority. */
export async function readPackageScripts(workspace, input) {
  const root = workspace.requireRoot();
  const relative = relativePath(input.path, 'path');
  if (path.posix.basename(relative) !== 'package.json') throw ideError('E_INVALID_ARG', '请选择 package.json 文件', { field: 'path' });
  const resolved = await workspace.resolvePath(relative);
  const manifest = await manifestAt(root, resolved.absolute);
  const cwd = path.dirname(resolved.absolute);
  let directory = cwd;
  let packageManager = null;
  const locks = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']];
  while (within(root, directory)) {
    let parent = manifest;
    if (directory !== cwd) {
      try { parent = await manifestAt(root, path.join(directory, 'package.json')); } catch (error) { if (error?.code !== 'E_NOT_FOUND') throw error; parent = {}; }
    }
    if (typeof parent.packageManager === 'string' && parent.packageManager) { packageManager = parent.packageManager; break; }
    for (const [file, manager] of locks) {
      try { if ((await lstat(path.join(directory, file))).isFile()) { packageManager = manager; break; } } catch (error) {
        if (error?.code !== 'ENOENT') throw ideError('E_PERMISSION', '无法读取包管理器锁文件', { syscall: error?.code ?? 'lstat' });
      }
    }
    if (packageManager || samePath(directory, root)) break;
    directory = path.dirname(directory);
  }
  packageManager ??= 'npm';
  const command = /^(npm|pnpm|yarn|bun)(?:@[^\s]+)?$/.exec(packageManager)?.[1];
  if (!command) throw ideError('E_UNSUPPORTED', '不支持 packageManager 声明', { packageManager });
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
    ? Object.entries(manifest.scripts).filter(([, value]) => typeof value === 'string').map(([name, value]) => ({ name, command: value })) : [];
  return { path: resolved.relative, cwd: posix(path.relative(root, cwd)) || '.', name: typeof manifest.name === 'string' && manifest.name ? manifest.name : path.basename(cwd), packageManager, scripts, runner: { command, args: ['run'] } };
}
