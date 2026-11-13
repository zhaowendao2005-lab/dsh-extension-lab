/**
 * Pure fuzzy ranking modelled on fzf's FuzzyMatchV2 (Smith–Waterman style
 * optimal alignment of an ordered subsequence). No environment dependencies.
 */

const SCORE_MATCH = 16;
const BONUS_WHITESPACE = 10;
const BONUS_DELIMITER = 9;
const BONUS_BOUNDARY = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 4;
const GAP_START = -3;
const GAP_EXTENSION = -1;
const FIRST_CHAR_MULTIPLIER = 2;
const BAG_FACTOR = 0.42;
const ALIAS_FACTOR = 0.96;

export const FUZZY_ALIASES: Record<string, string> = {
  ds: 'deepseek',
  oai: 'openai',
  cl: 'claude',
  gm: 'gemini',
  qw: 'qwen',
  kimi: 'moonshot',
};

export interface FuzzyHit<T> { item: T; score: number; positions: number[] }
interface Match { score: number; positions: number[] }

const DELIMITERS = new Set(['-', '_', '/', '.', ':', ' ']);

function isWhitespace(ch: string): boolean { return /\s/.test(ch); }
function isLower(ch: string): boolean { return ch !== ch.toUpperCase() && ch === ch.toLowerCase(); }
function isUpper(ch: string): boolean { return ch !== ch.toLowerCase() && ch === ch.toUpperCase(); }
function isDigit(ch: string): boolean { return ch >= '0' && ch <= '9'; }
function isLetter(ch: string): boolean { return isLower(ch) || isUpper(ch); }
function isWord(ch: string): boolean { return isLetter(ch) || isDigit(ch) || /[\u3400-\u9fff]/.test(ch); }

function bonusAt(text: string, index: number): number {
  if (index === 0) return BONUS_WHITESPACE;
  const prev = text[index - 1];
  const cur = text[index];
  if (!isWord(cur)) return 0;
  if (isWhitespace(prev)) return BONUS_WHITESPACE;
  if (DELIMITERS.has(prev)) return BONUS_DELIMITER;
  if (!isWord(prev)) return BONUS_BOUNDARY;
  if (isLower(prev) && isUpper(cur)) return BONUS_CAMEL;
  if (isLetter(prev) && isDigit(cur)) return BONUS_CAMEL;
  return 0;
}

/** Optimal ordered-subsequence alignment; null if the query is not a subsequence. */
function alignOrdered(text: string, query: string): Match | null {
  const n = text.length;
  const m = query.length;
  if (!m) return {score: 0, positions: []};
  if (m > n) return null;
  const lower = text.toLowerCase();
  // Quick subsequence check.
  let probe = 0;
  for (let j = 0; j < n && probe < m; j += 1) if (lower[j] === query[probe]) probe += 1;
  if (probe < m) return null;

  const bonus = new Array<number>(n);
  for (let j = 0; j < n; j += 1) bonus[j] = bonusAt(text, j);
  const NEG = -Infinity;
  const score: Float64Array[] = [];
  const back: Int32Array[] = [];
  for (let i = 0; i < m; i += 1) {
    const row = new Float64Array(n).fill(NEG);
    const from = new Int32Array(n).fill(-1);
    const qc = query[i];
    if (i === 0) {
      for (let j = 0; j < n; j += 1) if (lower[j] === qc) row[j] = SCORE_MATCH + bonus[j] * FIRST_CHAR_MULTIPLIER;
    } else {
      const prev = score[i - 1];
      // best (prev[k] + k) for k <= j-2 → gap transition value = best - j - 1 (+ gap start/extension)
      let bestGap = NEG;
      let bestGapIndex = -1;
      for (let j = 0; j < n; j += 1) {
        const k = j - 2;
        if (k >= 0 && prev[k] !== NEG && prev[k] + k > bestGap) { bestGap = prev[k] + k; bestGapIndex = k; }
        if (lower[j] !== qc) continue;
        let best = NEG;
        let origin = -1;
        if (j > 0 && prev[j - 1] !== NEG) {
          best = prev[j - 1] + SCORE_MATCH + Math.max(bonus[j], BONUS_CONSECUTIVE);
          origin = j - 1;
        }
        if (bestGapIndex >= 0) {
          // gap g = j-k-1 ≥ 1 costs GAP_START + GAP_EXTENSION*(g-1) = k - j - 1 with the constants above.
          // With GAP_EXTENSION = -1: prev[k] + GAP_START + GAP_EXTENSION*(j-k-2) = (prev[k]+k) - j + GAP_START - 2*GAP_EXTENSION.
          const value = bestGap - j + GAP_START - 2 * GAP_EXTENSION + SCORE_MATCH + bonus[j];
          if (value > best) { best = value; origin = bestGapIndex; }
        }
        row[j] = best;
        from[j] = origin;
      }
    }
    score.push(row);
    back.push(from);
  }
  const last = score[m - 1];
  let end = -1;
  let raw = NEG;
  for (let j = 0; j < n; j += 1) if (last[j] > raw) { raw = last[j]; end = j; }
  if (end < 0) return null;
  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i -= 1) {
    positions[i] = j;
    j = back[i][j];
  }
  const normalized = raw / (m * (SCORE_MATCH + BONUS_WHITESPACE));
  const span = positions[m - 1] - positions[0] + 1;
  const compactness = (m / span) * 0.08;
  const lengthPenalty = Math.min(0.12, Math.max(0, n - m) * 0.003);
  return {score: Math.max(0.001, normalized + compactness - lengthPenalty), positions};
}

/** Unordered character-bag fallback; requires most characters to be present. */
function bagMatch(text: string, query: string): Match | null {
  const lower = text.toLowerCase();
  const used = new Set<number>();
  const positions: number[] = [];
  let hits = 0;
  for (const ch of query) {
    let found = -1;
    for (let j = 0; j < lower.length; j += 1) if (!used.has(j) && lower[j] === ch) { found = j; break; }
    if (found >= 0) { used.add(found); positions.push(found); hits += 1; }
  }
  const coverage = hits / query.length;
  if (coverage < 0.75) return null;
  positions.sort((a, b) => a - b);
  const lengthPenalty = Math.min(0.12, Math.max(0, lower.length - query.length) * 0.003);
  return {score: Math.max(0.001, (coverage - lengthPenalty) * BAG_FACTOR), positions};
}

function matchToken(text: string, token: string): Match | null {
  const ordered = alignOrdered(text, token);
  if (ordered) return ordered;
  return token.length >= 2 ? bagMatch(text, token) : null;
}

function aliasVariants(token: string): {token: string; factor: number}[] {
  const variants = [{token, factor: 1}];
  for (const [alias, target] of Object.entries(FUZZY_ALIASES)) {
    if (token === alias || (token.startsWith(alias) && token.length > alias.length)) {
      variants.push({token: target + token.slice(alias.length), factor: ALIAS_FACTOR});
    }
  }
  return variants;
}

function matchText(text: string, tokens: string[]): Match | null {
  let total = 0;
  const positions = new Set<number>();
  for (const token of tokens) {
    let best: Match | null = null;
    for (const variant of aliasVariants(token)) {
      const hit = matchToken(text, variant.token);
      if (hit && (!best || hit.score * variant.factor > best.score)) best = {score: hit.score * variant.factor, positions: hit.positions};
    }
    if (!best) return null;
    total += best.score;
    for (const position of best.positions) positions.add(position);
  }
  return {score: total / tokens.length, positions: [...positions].sort((a, b) => a - b)};
}

/** Rank items by fuzzy score (desc). Empty query returns every item in original order. */
export function fuzzyRank<T>(items: T[], query: string, text: (t: T) => string): {item: T; score: number; positions: number[]}[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return items.map(item => ({item, score: 0, positions: []}));
  const hits: (FuzzyHit<T> & {order: number})[] = [];
  items.forEach((item, order) => {
    const hit = matchText(text(item), tokens);
    if (hit) hits.push({item, score: hit.score, positions: hit.positions, order});
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.map(({item, score, positions}) => ({item, score, positions}));
}
