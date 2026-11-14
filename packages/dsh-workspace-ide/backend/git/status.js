/**
 * `git status --porcelain=v2 -z --branch --untracked-files=all` parser
 * (docs/git-model.md §3). Pure function: text in, model out. No fs, no child_process.
 */

const CHANGE_STATUS = new Set(['M', 'A', 'D', 'R', 'C', 'T', 'U', 'X', '?']);

function normalizeStatus(char) {
  return CHANGE_STATUS.has(char) ? char : 'M';
}

function splitZ(text) {
  return text.split('\0');
}

/**
 * @param {string} text raw stdout (may be empty)
 * @returns {{branch: object, changes: any[], operation: string|null}}
 */
export function parseStatus(text) {
  const branch = {
    name: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    unborn: false,
    sha: null,
  };
  const staged = [];
  const working = [];
  const untracked = [];
  const conflicts = [];
  const tokens = splitZ(text);
  let operation = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const line = tokens[index];
    if (!line) continue;

    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') {
        if (value === '(initial)') branch.unborn = true;
        else branch.sha = value;
      } else if (key === 'branch.head') {
        if (value === '(detached)') branch.detached = true;
        else branch.name = value;
      } else if (key === 'branch.upstream') {
        branch.upstream = value;
      } else if (key === 'branch.ab') {
        const match = /^\+(-?\d+) -(-?\d+)$/.exec(value);
        if (match) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
        }
      }
      continue;
    }

    const kind = line[0];
    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const fields = splitFields(line, 8);
      if (!fields) continue;
      const change = {
        path: fields[8],
        origPath: null,
        status: normalizeStatus(fields[1][1]),
        isSubmodule: fields[2].startsWith('S'),
        mode: { head: fields[3], index: fields[4], worktree: fields[5] },
        renameScore: null,
        isUntracked: false,
      };
      pushGroups(fields[1], change, { staged, working });
      continue;
    }

    if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const fields = splitFields(line, 9);
      if (!fields) continue;
      const origPath = tokens[index + 1] ?? null;
      index += 1;
      const scoreToken = fields[8];
      const renameScore = Number(scoreToken.slice(1)) / 100;
      const change = {
        path: fields[9],
        origPath,
        status: normalizeStatus(fields[1][1]),
        isSubmodule: fields[2].startsWith('S'),
        mode: { head: fields[3], index: fields[4], worktree: fields[5] },
        renameScore: Number.isFinite(renameScore) ? renameScore : null,
        isUntracked: false,
      };
      pushGroups(fields[1], change, { staged, working });
      continue;
    }

    if (kind === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const fields = splitFields(line, 10);
      if (!fields) continue;
      conflicts.push({
        path: fields[10],
        origPath: null,
        status: 'U',
        isSubmodule: fields[2].startsWith('S'),
        mode: { base: fields[3], ours: fields[4], theirs: fields[5], worktree: fields[6] },
        stages: [fields[7], fields[8], fields[9]],
        renameScore: null,
        isUntracked: false,
      });
      continue;
    }

    if (kind === '?') {
      untracked.push({
        path: line.slice(2),
        origPath: null,
        status: '?',
        isSubmodule: false,
        mode: null,
        renameScore: null,
        isUntracked: true,
      });
      continue;
    }

    // '!' (ignored) is only present with --ignored; ignore defensively.
  }

  return {
    branch,
    changes: { staged, working, untracked, conflicts },
    operation,
  };
}

function splitFields(line, count) {
  const fields = [];
  let index = 0;
  for (let field = 0; field < count; field += 1) {
    const space = line.indexOf(' ', index);
    if (space === -1) return null;
    fields.push(line.slice(index, space));
    index = space + 1;
  }
  fields.push(line.slice(index));
  return fields;
}

function pushGroups(xy, change, groups) {
  const [x, y] = [xy[0], xy[1]];
  if (x !== '.' && x !== ' ') {
    groups.staged.push({ ...change, status: normalizeStatus(x) });
  }
  if (y !== '.' && y !== ' ') {
    groups.working.push({ ...change, status: normalizeStatus(y) });
  }
}

/** Sorted for display: conflicts first, then staged, then working, then untracked. */
export function orderGroups(changes) {
  return {
    conflicts: [...changes.conflicts].sort(byPath),
    staged: [...changes.staged].sort(byPath),
    working: [...changes.working].sort(byPath),
    untracked: [...changes.untracked].sort(byPath),
  };
}

function byPath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
