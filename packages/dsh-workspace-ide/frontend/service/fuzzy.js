/**
 * Fuzzy matching for quick-open (docs/milestones.md M4-5).
 * Scored the way VS Code scores file names: a match on the basename beats a match that only
 * happens deep in the path, and runs of consecutive characters beat scattered ones. The
 * matcher is deliberately allocation-light — a 50k path index is filtered on every keystroke.
 */

const SEGMENT_BONUS = 12;
const CONSECUTIVE_BONUS = 6;
const BASENAME_BONUS = 20;
const START_BONUS = 10;

/**
 * @param {string} path workspace-relative path with `/` separators
 * @param {string} query already lower-cased, non-empty
 * @returns {number} score, or -1 when the query is not a subsequence of the path
 */
export function scorePath(path, query) {
  if (!query) return 0;
  const lower = path.toLowerCase();
  const baseStart = lower.lastIndexOf('/') + 1;
  let score = 0;
  let position = -1;
  let previous = -2;
  let firstIndex = -1;

  for (let i = 0; i < query.length; i += 1) {
    const found = lower.indexOf(query[i], position + 1);
    if (found === -1) return -1;
    if (firstIndex === -1) firstIndex = found;
    score += 1;
    if (found === previous + 1) score += CONSECUTIVE_BONUS;
    if (found === 0 || lower[found - 1] === '/' || lower[found - 1] === '.' || lower[found - 1] === '_' || lower[found - 1] === '-') {
      score += SEGMENT_BONUS;
    }
    if (found >= baseStart) score += 2;
    previous = found;
    position = found;
  }

  if (firstIndex >= baseStart) score += BASENAME_BONUS;
  if (firstIndex === baseStart) score += START_BONUS;
  // Shorter paths win ties: `a.ts` before `a/b/c/deep/a.ts`.
  score -= Math.min(40, path.length / 8);
  return score;
}

/**
 * Filter + rank a path list. Ties keep the original (git order) so results are stable.
 * @returns {Array<{path: string, score: number}>}
 */
export function rankPaths(paths, query, limit = 40) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    const head = [];
    for (let i = 0; i < paths.length && head.length < limit; i += 1) head.push({ path: paths[i], score: 0 });
    return head;
  }
  const scored = [];
  for (let i = 0; i < paths.length; i += 1) {
    const score = scorePath(paths[i], needle);
    if (score >= 0) scored.push([score, i, paths[i]]);
  }
  scored.sort((left, right) => (right[0] - left[0]) || (left[1] - right[1]));
  return scored.slice(0, limit).map(([score, , path]) => ({ path, score }));
}
