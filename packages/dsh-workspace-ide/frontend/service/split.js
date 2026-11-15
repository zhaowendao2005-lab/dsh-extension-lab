/**
 * Pure split-tree + drop-zone helpers for the internal workbench. No DOM, no IO:
 * layout.stores.js is the only caller that mutates, SplitTree only renders.
 *
 * Tree shape: { kind: 'group', id } | { kind: 'split', dir: 'row'|'column', ratio, a, b }.
 * Groups hold tab ids; the tree only holds structure, so moving/closing a tab never
 * rebuilds the tree.
 */

export const MAX_GROUPS = 4;
export const MIN_GROUP_W = 180;
export const MIN_GROUP_H = 140;
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/** A leaf pointing at one group. */
export function groupLeaf(id) {
  return { kind: 'group', id };
}

/** Every leaf in visual order, with the path of 'a'/'b' steps that reaches it. */
export function leafEntries(tree, path = [], out = []) {
  if (!tree) return out;
  if (tree.kind === 'group') {
    out.push({ id: tree.id, path });
    return out;
  }
  leafEntries(tree.a, [...path, 'a'], out);
  leafEntries(tree.b, [...path, 'b'], out);
  return out;
}

/** Group ids in visual order. */
export function groupIds(tree) {
  return leafEntries(tree).map((entry) => entry.id);
}

/** Find one group's leaf entry. */
export function findLeaf(tree, groupId) {
  return leafEntries(tree).find((entry) => entry.id === groupId) ?? null;
}

/** Replace a group leaf with a split; 'first' puts the new group before the existing one. */
export function splitLeaf(tree, groupId, { dir, first, newGroupId, ratio = 0.5 }) {
  if (!tree) return tree;
  if (tree.kind === 'group') {
    if (tree.id !== groupId) return tree;
    const leaf = groupLeaf(newGroupId);
    return {
      kind: 'split',
      dir,
      ratio,
      a: first ? leaf : tree,
      b: first ? tree : leaf,
    };
  }
  const a = splitLeaf(tree.a, groupId, { dir, first, newGroupId, ratio });
  if (a !== tree.a) return { ...tree, a };
  const b = splitLeaf(tree.b, groupId, { dir, first, newGroupId, ratio });
  if (b !== tree.b) return { ...tree, b };
  return tree;
}

/** Remove a leaf; the surviving sibling takes the parent's place. Returns null when empty. */
export function removeLeaf(tree, groupId) {
  if (!tree) return tree;
  if (tree.kind === 'group') return tree.id === groupId ? null : tree;
  const a = removeLeaf(tree.a, groupId);
  if (a !== tree.a) return a === null ? tree.b : { ...tree, a };
  const b = removeLeaf(tree.b, groupId);
  if (b !== tree.b) return b === null ? tree.a : { ...tree, b };
  return tree;
}

/** Write one split's ratio; path is the 'a'/'b' route to the split node. */
export function updateRatio(tree, path, ratio) {
  if (!tree) return tree;
  if (path.length === 0) {
    if (tree.kind !== 'split') return tree;
    return { ...tree, ratio: clampRatio(ratio) };
  }
  const [head, ...rest] = path;
  const child = tree[head];
  const next = updateRatio(child, rest, ratio);
  if (next === child) return tree;
  return { ...tree, [head]: next };
}

/** Keep the tree's leaves exactly where groups exist; drop empty/removed groups. */
export function pruneTree(tree, keep) {
  if (!tree) return null;
  if (tree.kind === 'group') return keep.has(tree.id) ? tree : null;
  const a = pruneTree(tree.a, keep);
  const b = pruneTree(tree.b, keep);
  if (a && b) return { ...tree, a, b };
  return a ?? b ?? null;
}

/** Clamp a user-dragged split ratio. */
export function clampRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, number));
}

/**
 * Which fifth of a group the pointer is in. Edges are relative bands; the band with the
 * smallest normalized distance wins so corners are stable.
 */
export function zoneAt(rect, x, y, edge = 0.25) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top) / rect.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  const bands = [];
  if (rx < edge) bands.push({ zone: 'left', distance: rx });
  if (rx > 1 - edge) bands.push({ zone: 'right', distance: 1 - rx });
  if (ry < edge) bands.push({ zone: 'top', distance: ry });
  if (ry > 1 - edge) bands.push({ zone: 'bottom', distance: 1 - ry });
  if (bands.length === 0) return 'center';
  bands.sort((left, right) => left.distance - right.distance);
  return bands[0].zone;
}

/** Split direction for a zone (left/right spl... a row, up/down a column). */
export function dirOf(zone) {
  return zone === 'left' || zone === 'right' ? 'row' : 'column';
}

/** Whether the new group is the first child. */
export function firstOf(zone) {
  return zone === 'left' || zone === 'top';
}

/** Can a group of this measured size be split toward the zone? */
export function canSplit(rect, zone, minW = MIN_GROUP_W, minH = MIN_GROUP_H) {
  if (!rect || !zone || zone === 'center') return false;
  if (zone === 'left' || zone === 'right') return rect.width / 2 >= minW;
  return rect.height / 2 >= minH;
}

/** Zone used by the tab context menu 'split' items. */
export function splitZoneLabel(zone) {
  if (zone === 'left') return '向左拆分';
  if (zone === 'right') return '向右拆分';
  if (zone === 'top') return '向上拆分';
  return '向下拆分';
}
