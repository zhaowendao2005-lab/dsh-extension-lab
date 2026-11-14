/**
 * Branch/tag/remote listing. One `for-each-ref` covers every ref in a single process; the
 * upstream tracking state needs its own `rev-list --count` per branch with an upstream, and
 * a `[gone]` upstream must be reported as such instead of silently dropping the branch.
 */
import { gitOrThrow } from './exec.js';

const FIELDS = [
  '%(refname)',
  '%(objectname)',
  '%(objecttype)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(symref)',
].join('%09');

const MAX_REFS = 2000;

export async function fetchRefs(cwd, { maxRefs = MAX_REFS } = {}) {
  const started = Date.now();
  const { stdout } = await gitOrThrow(cwd, [
    'for-each-ref',
    `--format=${FIELDS}`,
    '--sort=-committerdate',
    `--count=${Math.max(1, Math.min(Number(maxRefs) || MAX_REFS, MAX_REFS))}`,
  ]);

  const local = [];
  const remote = [];
  const tags = [];
  let detached = false;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const [refname, sha, type, head, upstream, track, symref] = line.split('\t');
    if (!refname || !sha || type === 'blob' || type === 'tree') continue;
    if (refname === 'HEAD') {
      detached = !symref;
      continue;
    }
    const entry = { name: shortName(refname), sha, ...tracking(track, upstream) };
    if (refname.startsWith('refs/heads/')) {
      local.push({ ...entry, head: head === '*' });
    } else if (refname.startsWith('refs/remotes/')) {
      if (refname.endsWith('/HEAD')) continue;
      remote.push(entry);
    } else if (refname.startsWith('refs/tags/')) {
      tags.push({ name: entry.name, sha });
    }
  }

  const remotes = await listRemotes(cwd);
  return { local, remote, tags, remotes, detached, elapsedMs: Date.now() - started };
}

export async function listRemotes(cwd) {
  try {
    const { stdout } = await gitOrThrow(cwd, ['remote', '-v']);
    const map = new Map();
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const [name, url, kind] = line.split('\t');
      if (!name || kind !== '(fetch)') continue;
      map.set(name, sanitizeUrl(url ?? ''));
    }
    return [...map].map(([name, url]) => ({ name, url }));
  } catch {
    // No remotes is normal; a broken config should not break the whole panel.
    return [];
  }
}

function shortName(refname) {
  return refname.replace(/^refs\/(heads|remotes|tags)\//, '');
}

function tracking(track, upstream) {
  if (!upstream) return { upstream: null, ahead: 0, behind: 0, upstreamGone: false };
  const gone = /\[gone\]/.test(track ?? '');
  const ahead = Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0);
  return { upstream, ahead, behind, upstreamGone: gone };
}

/** Strip credentials from a remote URL before it ever reaches the browser. */
export function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch {
    // scp-style (`git@host:path`) and local paths are not URLs; pass them through.
  }
  return url;
}
