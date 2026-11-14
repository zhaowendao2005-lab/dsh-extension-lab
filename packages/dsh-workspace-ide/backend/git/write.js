/**
 * Git write operations. Every function here mutates the repository, so the caller
 * (backend/git/index.js) runs them through a single serial queue and has already checked
 * that the workspace is trusted.
 *
 * Rules that matter (docs/security.md §4, docs/git-model.md §6):
 * - never `git clean -f`: untracked removal goes through `fs.rm` file by file, and a
 *   directory is refused rather than guessed at;
 * - never `git apply --cached --3way` for hunk staging: on failure git writes conflict
 *   markers into the index. `hash-object -w` + `update-index --cacheinfo` is atomic per hunk;
 * - never stash automatically before checkout: a dirty tree is a refusal, not a surprise;
 * - commit messages go through stdin (`-F -`) so hooks and quoting never see a shell.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../../shared/contract.js';
import { ideError } from '../../shared/errors.js';
import { gitOrThrow, runGit } from './exec.js';

/** Pathspec hardening: a literal `*` in a filename must never expand (docs/security.md §3). */
const LITERAL = Object.freeze({ GIT_LITERAL_PATHSPECS: '1' });

function assertPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw ideError('E_INVALID_ARG', '没有给出路径', { field: 'paths' });
  }
  for (const entry of paths) {
    if (typeof entry !== 'string' || entry === '' || entry.startsWith('/') || entry.includes('\0')) {
      throw ideError('E_INVALID_ARG', '路径必须是工作区相对路径', { field: 'paths' });
    }
    if (entry.split('/').includes('..')) {
      throw ideError('E_OUTSIDE_ROOT', '路径不能越过工作区根目录', { field: 'paths', path: entry });
    }
  }
  return paths;
}

export async function stageFiles(cwd, paths) {
  assertPaths(paths);
  await gitOrThrow(cwd, ['add', '--', ...paths], { env: LITERAL });
  return { paths, staged: paths.length };
}

/** Stage everything, including deletions and untracked files (`git add -A`). */
export async function stageAll(cwd) {
  await gitOrThrow(cwd, ['add', '-A', '--'], { env: LITERAL });
  return { staged: 'all' };
}

/** Reset the whole index back to HEAD. */
export async function unstageAll(cwd) {
  const result = await runGit(cwd, ['reset', '--quiet', 'HEAD', '--'], { env: LITERAL });
  if (result.code !== 0) {
    // Unborn HEAD: there is nothing to reset to, so the index is already "unstaged".
    return { unstaged: 'all' };
  }
  return { unstaged: 'all' };
}

export async function unstageFiles(cwd, paths) {
  assertPaths(paths);
  // `restore --staged` behaves the same on unborn HEAD (`reset` would need a commit).
  const result = await runGit(cwd, ['restore', '--staged', '--', ...paths], { env: LITERAL });
  if (result.code !== 0) {
    await gitOrThrow(cwd, ['reset', '--quiet', 'HEAD', '--', ...paths], { env: LITERAL });
  }
  return { paths, unstaged: paths.length };
}

/**
 * Discard worktree changes. Tracked files are restored from the index; untracked files are
 * deleted by us (after `lstat`), never by `git clean`.
 */
export async function discardFiles(cwd, paths, { untracked = [] } = {}) {
  assertPaths(paths);
  const tracked = paths.filter((entry) => !untracked.includes(entry));
  if (tracked.length) {
    const result = await runGit(cwd, ['checkout', '--', ...tracked], { env: LITERAL });
    if (result.code !== 0) {
      await gitOrThrow(cwd, ['restore', '--worktree', '--', ...tracked], { env: LITERAL });
    }
  }

  const removed = [];
  for (const entry of untracked) {
    const absolute = path.resolve(cwd, entry);
    if (!absolute.startsWith(`${path.resolve(cwd)}${path.sep}`)) {
      throw ideError('E_OUTSIDE_ROOT', '路径不能越过工作区根目录', { path: entry });
    }
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      throw ideError('E_INVALID_ARG', '未跟踪目录需要逐个文件确认，不能整体删除', { path: entry });
    }
    await fs.rm(absolute, { force: true });
    removed.push(entry);
  }
  return { paths, discarded: tracked.length, removed };
}

export async function createCommit(cwd, { message, all = false, amend = false } = {}) {
  const text = String(message ?? '');
  if (!text.trim()) throw ideError('E_INVALID_ARG', '提交信息不能为空', { field: 'message' });
  if (Buffer.byteLength(text) > 64 * 1024) {
    throw ideError('E_TOO_LARGE', '提交信息过长', { field: 'message', limit: 64 * 1024 });
  }

  const argv = ['commit', '-F', '-', '--cleanup=strip'];
  if (all) argv.push('--all');
  if (amend) argv.push('--amend');

  const { stdout } = await gitOrThrow(cwd, argv, { input: text, timeoutMs: LIMITS.gitTimeoutMs });
  const head = await gitOrThrow(cwd, ['rev-parse', 'HEAD'], { env: LITERAL });
  return { committed: true, hash: head.stdout.trim(), output: firstLine(stdout) };
}

export async function checkoutRef(cwd, { ref, force = false, create = false } = {}) {
  if (typeof ref !== 'string' || !ref.trim()) throw ideError('E_INVALID_ARG', '缺少目标引用', { field: 'ref' });
  if (!force) {
    const dirty = await runGit(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=no'], { env: LITERAL });
    if (dirty.code === 0 && dirty.stdout.trim() !== '') {
      throw ideError('E_GIT_FAILED', '工作区有未提交的更改，先提交或暂存再切换分支', {
        reason: 'dirty-worktree',
        stderr: '',
        argv: ['checkout', ref],
        code: dirty.code,
      });
    }
  }
  const argv = ['checkout', ...(create ? ['-b'] : []), ...(force ? ['--force'] : []), ref];
  await gitOrThrow(cwd, argv, { env: LITERAL });
  return { ref };
}

export async function manageBranch(cwd, { action, name, newName, startPoint, force = false } = {}) {
  const verb = action ?? 'create';
  if (verb === 'create') {
    if (!name) throw ideError('E_INVALID_ARG', '缺少分支名', { field: 'name' });
    const argv = ['branch', name, ...(startPoint ? [startPoint] : [])];
    await gitOrThrow(cwd, argv, { env: LITERAL });
    return { action: verb, name };
  }
  if (verb === 'delete') {
    if (!name) throw ideError('E_INVALID_ARG', '缺少分支名', { field: 'name' });
    await gitOrThrow(cwd, ['branch', force ? '-D' : '-d', name], { env: LITERAL });
    return { action: verb, name };
  }
  if (verb === 'rename') {
    if (!name || !newName) throw ideError('E_INVALID_ARG', '缺少原名或新名', { field: 'name' });
    await gitOrThrow(cwd, ['branch', '-m', name, newName], { env: LITERAL });
    return { action: verb, name, newName };
  }
  throw ideError('E_INVALID_ARG', '未知的分支操作', { field: 'action', action: verb });
}

export async function manageTag(cwd, { action, name, ref, message } = {}) {
  const verb = action ?? 'create';
  if (!name) throw ideError('E_INVALID_ARG', '缺少标签名', { field: 'name' });
  if (verb === 'create') {
    const argv = message ? ['tag', '-a', name, '-m', message, ...(ref ? [ref] : [])] : ['tag', name, ...(ref ? [ref] : [])];
    await gitOrThrow(cwd, argv, { env: LITERAL });
    return { action: verb, name };
  }
  if (verb === 'delete') {
    await gitOrThrow(cwd, ['tag', '-d', name], { env: LITERAL });
    return { action: verb, name };
  }
  throw ideError('E_INVALID_ARG', '未知的标签操作', { field: 'action', action: verb });
}

export async function stash(cwd, { action, index, message } = {}) {
  const verb = action ?? 'push';
  if (verb === 'push') {
    const argv = ['stash', 'push', ...(message ? ['-m', message] : [])];
    const { stdout } = await gitOrThrow(cwd, argv, { env: LITERAL });
    return { action: verb, output: firstLine(stdout) };
  }
  if (verb === 'list') {
    const { stdout } = await gitOrThrow(cwd, ['stash', 'list', '--format=%gd%x09%s'], { env: LITERAL });
    return {
      action: verb,
      entries: stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ref, subject] = line.split('\t');
          return { ref, subject: subject ?? '' };
        }),
    };
  }
  if (verb === 'pop' || verb === 'apply' || verb === 'drop') {
    const args = ['stash', verb, ...(index === undefined ? [] : [`stash@{${Number(index)}}`])];
    const { stdout } = await gitOrThrow(cwd, args, { env: LITERAL });
    return { action: verb, output: firstLine(stdout) };
  }
  throw ideError('E_INVALID_ARG', '未知的 stash 操作', { field: 'action', action: verb });
}

/**
 * Stage a single hunk by rebuilding the index blob from the hunk text.
 *
 * The new blob is written with `hash-object -w --path`, then the index entry is replaced by
 * CAS with `update-index --cacheinfo`. `--3way` is deliberately not used: a failed apply
 * leaves conflict markers in the index, which is worse than a clean error.
 */
export async function stageHunk(cwd, { path: filePath, hunk, expectedIndexSha } = {}) {
  assertPaths([filePath]);
  if (!hunk || typeof hunk !== 'object') throw ideError('E_INVALID_ARG', '缺少 hunk', { field: 'hunk' });

  const stagedText = hunk.stagedText;
  if (typeof stagedText !== 'string') {
    throw ideError('E_INVALID_ARG', 'hunk 必须带 stagedText（应用后的完整文件内容）', { field: 'hunk.stagedText' });
  }
  if (Buffer.byteLength(stagedText) > LIMITS.writeBytesMax) {
    throw ideError('E_TOO_LARGE', '文件超过写上限', { field: 'hunk.stagedText', limit: LIMITS.writeBytesMax });
  }

  const indexEntry = await readIndexEntry(cwd, filePath);
  if (expectedIndexSha && indexEntry && expectedIndexSha !== indexEntry.sha) {
    throw ideError('E_VERSION_CONFLICT', '索引已变化，请重新读取', {
      path: filePath,
      expected: expectedIndexSha,
      actual: indexEntry.sha,
    });
  }

  const mode = indexEntry?.mode ?? (await worktreeMode(cwd, filePath));
  const { stdout } = await gitOrThrow(cwd, ['hash-object', '-w', '--stdin', '--path', filePath], {
    input: stagedText,
    env: LITERAL,
  });
  const sha = stdout.trim();
  await gitOrThrow(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${filePath}`], { env: LITERAL });
  return { path: filePath, sha, mode };
}

/**
 * Resolve one conflicted path by taking a side (M4-2).
 * `ours`/`theirs` delegate to `git checkout --ours/--theirs`, which is exactly what the CLI
 * does and needs no content round-trip. `both` and `delete` are done by hand because git has
 * no equivalent, and `both` must not be mistaken for a merge.
 */
export async function resolveConflict(cwd, { path: filePath, side } = {}) {
  if (!['ours', 'theirs', 'both', 'delete'].includes(side)) {
    throw ideError('E_INVALID_ARG', 'side 必须是 ours/theirs/both/delete', { field: 'side' });
  }
  assertPaths([filePath]);
  if (side === 'delete') {
    await gitOrThrow(cwd, ['rm', '-f', '--', filePath], { env: LITERAL });
    return { path: filePath, side, resolved: true };
  }
  if (side === 'ours' || side === 'theirs') {
    await gitOrThrow(cwd, ['checkout', `--${side}`, '--', filePath], { env: LITERAL });
    await gitOrThrow(cwd, ['add', '--', filePath], { env: LITERAL });
    return { path: filePath, side, resolved: true };
  }
  const [ours, theirs] = await Promise.all([
    stageText(cwd, 2, filePath),
    stageText(cwd, 3, filePath),
  ]);
  if (ours === null && theirs === null) {
    throw ideError('E_NOT_FOUND', '该文件没有可合并的一侧', { path: filePath });
  }
  const joined = [ours, theirs].filter((text) => text !== null).join('');
  const absolute = path.resolve(cwd, filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, joined, 'utf8');
  await gitOrThrow(cwd, ['add', '--', filePath], { env: LITERAL });
  return { path: filePath, side, resolved: true };
}

async function stageText(cwd, stage, filePath) {
  const result = await runGit(cwd, ['show', `:${stage}:${filePath}`], { env: LITERAL });
  return result.code === 0 ? result.stdout : null;
}

export async function initRepo(cwd, { defaultBranch } = {}) {
  const branch = typeof defaultBranch === 'string' && /^[\w./-]{1,200}$/.test(defaultBranch) ? defaultBranch : 'main';
  await gitOrThrow(cwd, ['init', '-b', branch], { env: LITERAL });
  return { branch };
}

async function readIndexEntry(cwd, filePath) {
  const result = await runGit(cwd, ['ls-files', '--stage', '-z', '--', filePath], { env: LITERAL });
  if (result.code !== 0 || !result.stdout) return null;
  // "<mode> <sha> <stage>\t<path>\0"
  const record = result.stdout.split('\0')[0];
  if (!record) return null;
  const [meta] = record.split('\t');
  const [mode, sha] = meta.split(' ');
  return mode && sha ? { mode, sha } : null;
}

async function worktreeMode(cwd, filePath) {
  const absolute = path.resolve(cwd, filePath);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat) return '100644';
  return stat.mode & 0o111 ? '100755' : '100644';
}

function firstLine(text) {
  return String(text ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
}
