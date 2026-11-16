import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';
import { FileIcon } from '../common/FileIcon.jsx';

/**
 * Recursive file tree. Each directory renders at most `DIR_PAGE` rows until the user asks for
 * more: a 20k-entry directory then costs one page of components instead of twenty thousand
 * (docs/ui-spec.md §4.3). Keyboard focus stays on the selected row.
 */
export function FileTree({ stores }) {
  const files = useStore(stores.files);
  const workspace = useStore(stores.workspace);
  const rootEntries = files.entries['']?.entries ?? null;

  if (!workspace.root) return null;
  if (!rootEntries) {
    return <div className="wid-empty"><span className="wid-hint">{files.loading.includes('') ? '读取目录…' : '目录为空'}</span></div>;
  }

  return (
    <div className="wid-tree" role="tree" aria-label="文件">
      <DirRows stores={stores} entries={rootEntries} parent="" depth={0} files={files} />
      {files.entries['']?.truncated && (
        <div className="wid-tree__truncated wid-hint">目录条目超过上限，未完整显示</div>
      )}
    </div>
  );
}

function DirRows({ stores, entries, parent, depth, files }) {
  const limit = files.visible[parent] ?? 300;
  // `.git` is metadata, not workspace content (docs/files.md §10.3): the Host still lists it
  // with `ignored: true` so `files.read`/git can reach it, but the tree never shows it.
  const visibleEntries = entries.filter((entry) => entry.name !== '.git');
  const rows = visibleEntries.slice(0, limit);
  const rest = visibleEntries.length - rows.length;
  return (
    <>
      {rows.map((entry) => (
        <TreeRow
          key={entry.name}
          stores={stores}
          entry={entry}
          path={parent ? `${parent}/${entry.name}` : entry.name}
          depth={depth}
          files={files}
        />
      ))}
      {rest > 0 && (
        <button
          type="button"
          className="wid-tree__more"
          style={{ paddingInlineStart: `${8 + 12 * depth}px` }}
          onClick={() => stores.actions.showMoreEntries(parent)}
        >
          显示更多（还有 {rest} 项）
        </button>
      )}
    </>
  );
}

function TreeRow({ stores, entry, path, depth, files }) {
  const isDir = entry.type === 'directory';
  const expanded = isDir && files.expanded.includes(path);
  const selected = files.selected === path;
  const children = files.entries[path]?.entries ?? null;

  return (
    <>
      <div
        className="wid-tree__row"
        data-ignored={entry.ignored ? 'true' : undefined}
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        style={{ paddingInlineStart: `${8 + 12 * depth}px` }}
        onClick={() => (isDir ? stores.actions.toggleDir(path) : stores.actions.selectFile(path))}
        onDoubleClick={() => (!isDir ? stores.actions.openFile(path) : stores.actions.toggleDir(path))}
      >
        <span className="wid-tree__chevron">
          {isDir ? <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} /> : null}
        </span>
        <span className="wid-tree__icon">
          {isDir ? <Icon name="folder" size={12} /> : <FileIcon name={entry.name} size={14} />}
        </span>
        <span className="wid-tree__name" title={path}>{entry.name}</span>
        <span className="wid-tree__actions">
          {isDir && (
            <button
              type="button"
              className="wid-icon-button"
              title="在此新建文件"
              onClick={(event) => {
                event.stopPropagation();
                void stores.actions.createEntry(path, 'file');
              }}
            >
              +
            </button>
          )}
          <button
            type="button"
            className="wid-icon-button"
            title="重命名"
            onClick={(event) => {
              event.stopPropagation();
              void stores.actions.renameEntry(path);
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="wid-icon-button wid-icon-button--danger"
            title="删除"
            onClick={(event) => {
              event.stopPropagation();
              void stores.actions.deleteEntry(path);
            }}
          >
            <Icon name="trash" size={12} />
          </button>
        </span>
      </div>
      {expanded && children && (
        <DirRows stores={stores} entries={children} parent={path} depth={depth + 1} files={files} />
      )}
      {expanded && !children && (
        <div className="wid-tree__row wid-hint" style={{ paddingInlineStart: `${8 + 12 * (depth + 1)}px` }}>
          {files.loading.includes(path) ? '读取中…' : '空目录'}
        </div>
      )}
    </>
  );
}
