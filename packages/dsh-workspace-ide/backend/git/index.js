/**
 * Git domain entry point. Owns the per-repository serial queue, the status
 * sequence counter and the (M4) watcher. Nothing here trusts a path it did not
 * resolve through `workspace.resolvePath`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../../shared/contract.js';
import { ideError } from '../../shared/errors.js';
import { gitOrThrow, runGit } from './exec.js';
import { orderGroups, parseStatus } from './status.js';
import { fetchRefs } from './refs.js';
import { fetchLog } from './log.js';
import { layoutGraph } from './layout.js';
import { fetchDiff } from './diff.js';
import { fetchConflictStages } from './conflict.js';
import { createWatcher } from './watch.js';
import {
  checkoutRef,
  createCommit,
  discardFiles,
  initRepo,
  manageBranch,
  manageTag,
  resolveConflict as resolveConflictOp,
  stageAll,
  stageFiles,
  stageHunk,
  stash,
  unstageAll,
  unstageFiles,
} from './write.js';

const HUGE_UNTRACKED = 5000;

export function createGit(ctx, workspace) {
  let seq = 0;
  let disposed = false;
  const repoCache = new Map();
  /** Layout cache: paging appends rows, so the previous page's lane state is the seed. */
  const graphCache = new Map();

  const nextSeq = () => {
    seq += 1;
    return seq;
  };

  const watcher = createWatcher();
  const watched = {
    async start(payload = {}) {
      const root = workspace.requireRoot();
      const gitDir = await resolveGitDir(root);
      return watcher.start({ root, gitDir, kinds: payload.kinds });
    },
    async poll(payload = {}) {
      return watcher.poll(payload ?? {});
    },
    async stop(payload = {}) {
      return watcher.stop(payload?.token);
    },
  };

  async function repoInfo() {
    const root = workspace.requireRoot();
    const cached = repoCache.get(root);
    if (cached && Date.now() - cached.at < 2000) return cached.value;
    const value = await workspace.state();
    const value2 = { repoRoot: value.git?.worktree ?? root, isRepo: Boolean(value.git?.isRepo), git: value.git };
    repoCache.set(root, { at: Date.now(), value: value2 });
    return value2;
  }

  async function requireRepo() {
    const info = await repoInfo();
    if (!info.isRepo) throw ideError('E_NOT_A_REPO', '当前工作区不是 Git 仓库', { root: workspace.root });
    return info;
  }

  async function detectOperation(repoRoot) {
    const gitDir = await resolveGitDir(repoRoot);
    if (!gitDir) return null;
    const markers = [
      ['MERGE_HEAD', 'merging'],
      ['CHERRY_PICK_HEAD', 'cherry-picking'],
      ['REVERT_HEAD', 'reverting'],
      ['BISECT_LOG', 'bisecting'],
    ];
    for (const [file, kind] of markers) {
      if (await exists(path.join(gitDir, file))) return kind;
    }
    if (await exists(path.join(gitDir, 'rebase-merge'))) return 'rebasing';
    if (await exists(path.join(gitDir, 'rebase-apply'))) return 'rebasing';
    if (await exists(path.join(gitDir, 'sequencer'))) return 'sequencing';
    return null;
  }

  /** Stash entries from the reflog file: one read, no extra `git` process per poll. */
  async function stashCountOf() {
    const gitDir = await resolveGitDir(workspace.root);
    if (!gitDir) return 0;
    try {
      const text = await fs.readFile(path.join(gitDir, 'logs', 'refs', 'stash'), 'utf8');
      let count = 0;
      for (const line of text.split('\n')) if (line.trim()) count += 1;
      return count;
    } catch {
      return 0;
    }
  }

  async function status(payload) {
    const info = await requireRepo();
    const untracked = payload.untrackedMode ?? 'all';
    const args = ['status', '--porcelain=v2', '-z', '--branch'];
    if (untracked === 'all') args.push('--untracked-files=all');
    else if (untracked === 'normal') args.push('--untracked-files=normal');
    else args.push('--untracked-files=no');

    const started = Date.now();
    const result = await gitOrThrow(workspace.root, args, { timeoutMs: LIMITS.statusTimeoutMs });
    const parsed = parseStatus(result.stdout);
    const groups = orderGroups(parsed.changes);
    // Only the .git markers say whether an operation is in flight; `git status` cannot tell
    // a rebase from a plain dirty tree, and per-line modes must never be read as state.
    const operation = await detectOperation(workspace.root);
    const untrackedCount = groups.untracked.length + groups.conflicts.length;
    seq += 1;
    return {
      seq,
      root: workspace.root,
      branch: parsed.branch,
      staged: groups.staged,
      working: groups.working,
      untracked: groups.untracked,
      conflicts: groups.conflicts,
      operation,
      repoState: operation ? 'operation' : 'clean',
      stashCount: await stashCountOf(),
      untrackedMode: untracked,
      isHuge: untrackedCount > HUGE_UNTRACKED,
      counts: {
        staged: groups.staged.length,
        working: groups.working.length,
        untracked: groups.untracked.length,
        conflicts: groups.conflicts.length,
      },
      elapsedMs: Date.now() - started,
    };
  }

  async function refs(payload = {}) {
    await requireRepo();
    const repoRoot = workspace.requireRoot();
    return fetchRefs(repoRoot, { maxRefs: payload.maxRefs });
  }

  async function log(payload = {}) {
    const info = await requireRepo();
    const repoRoot = workspace.requireRoot();
    const maxCount = clampInt(payload.maxCount, LIMITS.logPageDefault, 1, LIMITS.logPageMax);
    const skip = clampInt(payload.skip, 0, 0, Number.MAX_SAFE_INTEGER);
    const refsArg = normalizeRefsArg(payload.refs);
    const { commits, hasMore } = await fetchLog(repoRoot, { maxCount, skip, refs: refsArg });
    return {
      commits: commits.map(toWireCommit),
      hasMore,
      skip,
      maxCount,
      totalKnown: skip + commits.length + (hasMore ? 1 : 0),
      repoEpoch: info.git?.repoEpoch ?? null,
      seq: nextSeq(),
    };
  }

  async function graph(payload = {}) {
    const info = await requireRepo();
    const repoRoot = workspace.requireRoot();
    const maxCount = clampInt(payload.maxCount, LIMITS.logPageDefault, 1, LIMITS.logPageMax);
    const skip = clampInt(payload.skip, 0, 0, Number.MAX_SAFE_INTEGER);
    const relPath = typeof payload.path === 'string' && payload.path ? payload.path : undefined;
    const refsArg = normalizeRefsArg(payload.refs);
    const key = [repoRoot, refsArg.join(','), relPath ?? '', maxCount, skip].join('|');

    const cached = graphCache.get(key);
    if (cached && Date.now() - cached.at < 5000) return cached.value;

    const started = Date.now();
    const { commits, hasMore } = await fetchLog(repoRoot, { maxCount, skip, refs: refsArg, path: relPath });
    // Only a cached page that ends exactly where this page starts can seed lane state.
    const seedKey = [repoRoot, refsArg.join(','), relPath ?? '', maxCount].join('|');
    const seed = skip > 0 ? graphCache.get(seedKey)?.stateAt : null;
    const layout = layoutGraph(commits, { state: seed ?? undefined, truncated: !hasMore });

    const value = {
      rows: layout.rows.map((row) => ({
        hash: row.hash,
        lane: row.lane,
        color: row.color,
        parents: row.parents ?? [],
        segments: row.segments,
        ...(row.degraded ? { degraded: true } : {}),
      })),
      commits: commits.map(toWireCommit),
      maxLane: layout.maxLane,
      layoutEpoch: layout.layoutEpoch,
      hasMore,
      skip,
      maxCount,
      totalKnown: skip + commits.length + (hasMore ? 1 : 0),
      repoEpoch: info.git?.repoEpoch ?? null,
      layoutMs: Date.now() - started,
      seq: nextSeq(),
    };
    graphCache.set(key, { at: Date.now(), value });
    if (skip === 0) graphCache.set(seedKey, { at: Date.now(), value, stateAt: layout.state });
    if (graphCache.size > 24) {
      const oldest = [...graphCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) graphCache.delete(oldest[0]);
    }
    return value;
  }


  /**
   * Write actions share one serial queue per repository: git's index is a single file and
   * two concurrent writers corrupt it. Reads stay parallel.
   */
  let writeChain = Promise.resolve();
  function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function showConflict(payload = {}) {
    await requireRepo();
    const info = await repoInfo();
    return { ...(await fetchConflictStages(info.repoRoot, payload.path)), seq: nextSeq() };
  }

  async function readDiff(payload = {}) {
    await requireRepo();
    const info = await repoInfo();
    const target = payload.target ?? { kind: 'working' };
    const result = await fetchDiff(info.repoRoot, target, {
      context: payload.context,
      ignoreWhitespace: payload.ignoreWhitespace,
    });
    return { ...result, seq: nextSeq() };
  }

  async function showCommit(payload = {}) {
    await requireRepo();
    const info = await repoInfo();
    const hash = String(payload.hash ?? '').trim();
    if (!/^[\w^~.@{}:/-]{1,120}$/.test(hash)) throw ideError('E_INVALID_ARG', '提交哈希不合法', { field: 'hash' });
    const head = await gitOrThrow(info.repoRoot, [
      'show',
      '-s',
      '--date=unix',
      '--format=%H%x09%P%x09%an%x09%ae%x09%at%x09%s%x09%b',
      '--decorate=short',
      hash,
    ]);
    const [raw] = head.stdout.split('\n');
    const [commitHash, parents, author, email, authoredAt, subject, body] = raw.split('\t');
    const stats = await runGit(info.repoRoot, ['show', '--numstat', '--format=', '-z', hash]);
    const files = stats.stdout
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [added, removed, file] = line.split('\t');
        return { path: file ?? '', additions: Number(added) || 0, deletions: Number(removed) || 0, binary: added === '-' };
      });
    return {
      hash: commitHash,
      parents: (parents ?? '').split(' ').filter(Boolean),
      author,
      email,
      authoredAt: Number(authoredAt) || 0,
      subject,
      body: body ?? '',
      files,
      seq: nextSeq(),
    };
  }

  async function requireRepoRoot() {
    const info = await requireRepo();
    return info.repoRoot;
  }

  async function requireTrust(reason) {
    await requireRepo();
    workspace.assertTrusted(reason);
    return workspace.requireRoot();
  }

  return {
    get seq() {
      return seq;
    },


    watch: watched,

    async dispatch(action, payload) {
      if (disposed) throw ideError('E_UNSUPPORTED', '插件已卸载', {});
      switch (action) {
        case 'git.status':
          return await status(payload ?? {});
        case 'git.refs':
          return refs(payload);
        case 'git.log':
          return log(payload);
        case 'git.graph':
          return graph(payload);
        case 'git.diff':
          return await readDiff(payload ?? {});
        case 'git.commit':
          return await showCommit(payload ?? {});
        case 'git.conflict':
          return await showConflict(payload ?? {});
        case 'git.resolveConflict':
          return await enqueueWrite(async () => {
            const cwd = await requireTrust('write');
            return { ...(await resolveConflictOp(cwd, payload ?? {})), seq: nextSeq() };
          });
        case 'git.stash':
          return payload?.action === 'list' || payload === undefined
            ? await stash(await requireRepoRoot(), { action: 'list' })
            : await enqueueWrite(async () => stash(await requireTrust('write'), payload ?? {}));
        case 'git.stage':
          return await enqueueWrite(async () => {
            const cwd = await requireTrust('write');
            return payload?.all ? stageAll(cwd) : stageFiles(cwd, payload?.paths ?? []);
          });
        case 'git.unstage':
          return await enqueueWrite(async () => {
            const cwd = await requireTrust('write');
            return payload?.all ? unstageAll(cwd) : unstageFiles(cwd, payload?.paths ?? []);
          });
        case 'git.discard':
          return await enqueueWrite(async () => {
            const trustedRoot = await requireTrust('write');
            if (payload?.all) {
              throw ideError('E_INVALID_ARG', '丢弃全部更改需要逐个文件确认', { field: 'all' });
            }
            return discardFiles(trustedRoot, payload?.paths ?? [], { untracked: payload?.untracked ?? [] });
          });
        case 'git.commitCreate':
          return await enqueueWrite(async () => createCommit(await requireTrust('write'), payload ?? {}));
        case 'git.checkout':
          return await enqueueWrite(async () => checkoutRef(await requireTrust('write'), payload ?? {}));
        case 'git.branch':
          return await enqueueWrite(async () => manageBranch(await requireTrust('write'), payload ?? {}));
        case 'git.tag':
          return await enqueueWrite(async () => manageTag(await requireTrust('write'), payload ?? {}));
        case 'git.init':
          return await enqueueWrite(async () => initRepo(await requireTrust('write'), payload ?? {}));
        case 'git.stageHunk':
          return await enqueueWrite(async () => stageHunk(await requireTrust('write'), payload ?? {}));
        case 'git.graph.search':
        case 'git.network':
          throw ideError('E_UNSUPPORTED', `${action} 尚未实现`, { reason: 'not-implemented', action });
        default:
          throw ideError('E_UNSUPPORTED', `未知动作 ${action}`, { action });
      }
    },

    async dispose() {
      disposed = true;
      watcher.dispose();
      repoCache.clear();
      graphCache.clear();
    },
  };
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return Math.min(Math.max(resolved, min), max);
}

function normalizeRefsArg(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => typeof entry === 'string' && /^[\w./@{}^~-]{1,200}$/.test(entry))
    .slice(0, 8);
}

function toWireCommit(commit) {
  const refs = commit.refs ?? {};
  const flat = [];
  for (const name of refs.local ?? []) flat.push({ name, type: 'branch', isHead: false });
  for (const name of refs.remote ?? []) flat.push({ name, type: 'branch', isHead: false });
  for (const name of refs.tags ?? []) flat.push({ name, type: 'tag', isHead: false });
  if (refs.head) {
    const index = flat.findIndex((entry) => entry.name === refs.head);
    if (index === -1) flat.push({ name: refs.head, type: 'branch', isHead: true });
    else flat[index] = { ...flat[index], isHead: true };
  }
  return {
    hash: commit.hash,
    parents: commit.parents ?? [],
    author: commit.author ?? null,
    email: commit.email ?? null,
    authoredAt: commit.authoredAt ?? 0,
    subject: commit.subject ?? '',
    refs: flat,
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveGitDir(repoRoot) {
  const dotGit = path.join(repoRoot, '.git');
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) return dotGit;
    if (stat.isFile()) {
      const text = await fs.readFile(dotGit, 'utf8');
      const match = /^gitdir:\s*(.+)$/m.exec(text);
      if (match) return path.resolve(repoRoot, match[1].trim());
    }
  } catch {
    return null;
  }
  return null;
}

export { runGit };
