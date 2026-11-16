/** A deterministic directory hierarchy for workspace-relative POSIX paths. No IO. */
export function normalizeTreePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/')) return null;
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/') || '.';
}

/** Nodes keep the original entry at its endpoint; directories may also have an entry. */
export function buildPathTree(entries, { rootName = '工作区', rootPath = '.' } = {}) {
  const root = { id: 'path:' + rootPath, path: rootPath, name: rootName, entry: null, children: [] };
  const nodes = new Map([['.', root]]);
  for (const entry of entries ?? []) {
    const path = normalizeTreePath(entry?.path);
    if (path === null) continue;
    if (path === '.') {
      root.entry = entry;
      continue;
    }
    let parent = root;
    let current = '';
    for (const part of path.split('/')) {
      current = current ? current + '/' + part : part;
      let node = nodes.get(current);
      if (!node) {
        node = { id: 'path:' + current, path: current, name: part, entry: null, children: [] };
        nodes.set(current, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.entry = entry;
  }
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    node.children.sort((a, b) => Number(b.children.length > 0) - Number(a.children.length > 0)
      || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path));
    pending.push(...node.children);
  }
  return root;
}
