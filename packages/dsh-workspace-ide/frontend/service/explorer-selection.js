/** The selection model follows the rendered tree, including per-directory pagination. */
export function visibleExplorerRows(files) {
  const rows = [];
  const expanded = new Set(files.expanded ?? []);
  function visit(parent, depth) {
    const entries = files.entries?.[parent]?.entries ?? [];
    const visible = entries.filter((entry) => entry.name !== '.git').slice(0, files.visible?.[parent] ?? 300);
    for (const entry of visible) {
      const path = parent ? parent + '/' + entry.name : entry.name;
      rows.push({ ...entry, path, depth });
      if (entry.type === 'directory' && expanded.has(path)) visit(path, depth + 1);
    }
  }
  visit('', 0);
  return rows;
}

export function explorerSelection(state, path, rows, { toggle = false, range = false, preserve = false } = {}) {
  const paths = rows.map((row) => row.path);
  const selectedSet = new Set(state.selected);
  if (!paths.includes(path)) return state;
  if (preserve && state.selected.includes(path)) return { ...state, focused: path, menu: null };
  if (range) {
    const anchor = paths.includes(state.anchor) ? state.anchor : (paths.includes(state.focused) ? state.focused : path);
    const first = paths.indexOf(anchor);
    const last = paths.indexOf(path);
    const interval = paths.slice(Math.min(first, last), Math.max(first, last) + 1);
    const intervalSet = new Set(interval);
    const selected = toggle ? paths.filter((item) => selectedSet.has(item) || intervalSet.has(item)) : interval;
    return { ...state, selected, focused: path, anchor, menu: null };
  }
  const selected = toggle
    ? paths.filter((item) => item === path ? !selectedSet.has(item) : selectedSet.has(item))
    : [path];
  return { ...state, selected, focused: path, anchor: path, menu: null };
}

/** Delete a selected directory once, never delete its selected descendants a second time. */
export function explorerDeletionPaths(entries) {
  const directories = entries.filter((entry) => entry.type === 'directory').map((entry) => entry.path);
  return [...new Set(entries.map((entry) => entry.path))]
    .filter((path) => !directories.some((parent) => path !== parent && path.startsWith(parent + '/')));
}
