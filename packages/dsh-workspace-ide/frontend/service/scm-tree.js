/** Pure SCM presentation model. No DOM, store, IO or platform path normalization. */
const FLAT_GROUPS = [
  ['conflicts', '合并冲突'], ['staged', '暂存的更改'],
  ['working', '更改'], ['untracked', '未跟踪'],
];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const nodeKey = (kind, bucket, path) => JSON.stringify([kind, bucket, path]);
export const SCM_ROW_HEIGHT = 22;

/** Keep rename pairs together; an M side may carry an unrelated index origPath. */
export function scmChangePaths(change) {
  return change.status === 'R' && change.origPath && change.origPath !== change.path
    ? [change.origPath, change.path] : [change.path];
}

function fileNode(change, bucket, group) {
  const slash = change.path.lastIndexOf('/');
  return {
    kind: 'file', key: JSON.stringify(['file', bucket, group, change.path]), bucket, group,
    path: change.path, label: change.path.slice(slash + 1),
    directory: slash < 0 ? '' : change.path.slice(0, slash), change,
    paths: scmChangePaths(change), count: 1, children: [],
  };
}

function sortChildren(children) {
  children.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file')
    || compare(a.label.toLowerCase(), b.label.toLowerCase())
    || compare(a.label, b.label) || compare(a.key, b.key));
}

/**
 * Build full directory nodes first, then compact only directories with one directory child.
 * Map keys are literal paths (including __proto__, quotes, backslashes and HTML-like text).
 * Paths are never folded, trimmed, URL-decoded or used as object property names.
 */
export function buildScmTree(status, view = 'tree') {
  const definitions = view === 'flat' ? FLAT_GROUPS : [['changes', '更改'], ['staged', '暂存']];
  const roots = [];
  for (const [bucket, label] of definitions) {
    const groups = bucket === 'changes' ? ['conflicts', 'working', 'untracked'] : [bucket];
    const root = { kind: 'group', key: bucket, bucket, path: '', label, children: [], paths: [], count: 0 };
    const directories = new Map([['', root]]);
    const seen = new Set();
    for (const group of groups) {
      for (const change of status?.[group] ?? []) {
        if (typeof change.path !== 'string' || !change.path) continue;
        const file = fileNode(change, bucket, group);
        if (seen.has(file.key)) continue;
        seen.add(file.key);
        let parent = root;
        if (view !== 'flat') {
          // Git always separates directories with '/'; a literal backslash is a filename.
          const segments = change.path.split('/');
          let prefix = '';
          for (let index = 0; index < segments.length - 1; index += 1) {
            prefix = index ? prefix + '/' + segments[index] : segments[index];
            let directory = directories.get(prefix);
            if (!directory) {
              directory = { kind: 'directory', key: nodeKey('directory', bucket, prefix),
                bucket, path: prefix, label: segments[index], children: [], paths: [], count: 0 };
              directories.set(prefix, directory);
              parent.children.push(directory);
            }
            parent = directory;
          }
        }
        parent.children.push(file);
      }
    }
    if (view === 'flat' && !root.children.length) continue;
    // Iterative postorder avoids recursion limits for deep (but valid) Git paths.
    const stack = [[root, false]];
    while (stack.length) {
      const [node, visited] = stack.pop();
      if (node.kind === 'file') continue;
      if (!visited) {
        stack.push([node, true]);
        for (const child of node.children) stack.push([child, false]);
        continue;
      }
      sortChildren(node.children);
      node.count = node.children.reduce((sum, child) => sum + child.count, 0);
      node.paths = [...new Set(node.children.flatMap((child) => child.paths))];
      node.children = node.children.map((child) => {
        if (child.kind !== 'directory') return child;
        let end = child;
        const labels = [child.label];
        const compactKeys = [...(child.compactKeys ?? [child.key])];
        while (end.children.length === 1 && end.children[0].kind === 'directory') {
          end = end.children[0];
          labels.push(end.label);
          compactKeys.push(...(end.compactKeys ?? [end.key]));
        }
        // Key stays attached to the first actual directory, independent of compression.
        return { ...child, path: end.path, label: labels.join('/'), children: end.children,
          compactKeys, compactPath: end.path };
      });
    }
    roots.push(root);
  }
  const byKey = new Map();
  const parents = new Map();
  const stack = roots.map((node) => [node, null]);
  while (stack.length) {
    const [node, parentKey] = stack.pop();
    byKey.set(node.key, node);
    parents.set(node.key, parentKey);
    for (const key of node.compactKeys ?? []) { if (key !== node.key) parents.set(key, node.key); }
    for (const child of node.children) stack.push([child, node.key]);
  }
  return { roots, byKey, parents };
}

export function isScmCollapsed(collapsed, key) {
  return collapsed instanceof Map ? collapsed.get(key) === true
    : Object.prototype.hasOwnProperty.call(collapsed ?? {}, key) && collapsed[key] === true;
}

/** Flat ARIA hierarchy for a virtualized DOM; parent/level/position survive window slicing. */
export function flattenScmTree(model, collapsed = {}) {
  const rows = [];
  const stack = [];
  for (let index = model.roots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: model.roots[index], level: 1, parentKey: null, posInSet: index + 1, setSize: model.roots.length });
  }
  while (stack.length) {
    const { node, ...aria } = stack.pop();
    const expanded = node.kind === 'file' ? undefined : !isScmCollapsed(collapsed, node.key);
    rows.push({ ...node, ...aria, expanded });
    if (!expanded) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index], level: aria.level + 1, parentKey: node.key,
        posInSet: index + 1, setSize: node.children.length });
    }
  }
  return rows;
}

/** Resolve a now-hidden focus to its nearest visible ancestor after collapse/status refresh. */
export function resolveScmFocus(model, rows, key) {
  const visible = new Set(rows.map((row) => row.key));
  while (key && !visible.has(key)) key = model.parents.get(key);
  return key || rows[0]?.key || null;
}

/** Return presentation instructions, leaving DOM focus and store writes to their owners. */
export function scmTreeNavigation(rows, focusedKey, key) {
  const index = Math.max(0, rows.findIndex((row) => row.key === focusedKey));
  const row = rows[index];
  if (!row) return null;
  let next = index;
  if (key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
  else if (key === 'ArrowUp') next = Math.max(0, index - 1);
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = rows.length - 1;
  else if (key === 'ArrowRight') {
    if (row.kind === 'file') return null;
    if (!row.expanded) return { toggleKey: row.key };
    if (rows[index + 1]?.parentKey === row.key) next = index + 1;
  } else if (key === 'ArrowLeft') {
    if (row.expanded) return { toggleKey: row.key };
    next = rows.findIndex((item) => item.key === row.parentKey);
    if (next < 0) next = index;
  } else return null;
  return { focusKey: rows[next].key, index: next };
}

export function scmVirtualWindow(count, top = 0, height = 360, rowHeight = SCM_ROW_HEIGHT, overscan = 12) {
  const viewport = Math.max(rowHeight, Number(height) || 360);
  const maxTop = Math.max(0, count * rowHeight - viewport);
  const scrollTop = Math.max(0, Math.min(Number(top) || 0, maxTop));
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end, scrollTop, viewport, totalHeight: count * rowHeight };
}

export function scmRevealScroll(index, top, height, rowHeight = SCM_ROW_HEIGHT) {
  const y = index * rowHeight;
  return y < top ? y : y + rowHeight > top + height ? y + rowHeight - height : top;
}

export function scmWriteReason({ busy }, count = 1) {
  if (busy) return '上一个写操作还在执行';
  if (!count) return '没有可操作的更改';
  return undefined;
}

export function scmOpenReason(row) {
  return row.change?.status === 'D' ? '文件已删除，请查看差异' : undefined;
}

export function scmDiscardReason(row) {
  if (row.kind !== 'file' || !['working', 'untracked'].includes(row.group)) return '此更改不支持丢弃';
  // Host restores tracked paths from the index; it cannot undo a worktree rename pair.
  if (row.change.status === 'R') return '重命名更改请先在文件管理器中还原';
  return undefined;
}
