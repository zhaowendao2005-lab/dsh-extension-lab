import { useRef } from '../../runtime.js';
import { EditorGroup } from './EditorGroup.jsx';

/** Recursive renderer for the split tree: leaves are editor groups, splits are rows/columns. */
export function SplitTree({ stores, node, path = [] }) {
  if (!node) return null;
  if (node.kind === 'group') {
    return <EditorGroup stores={stores} groupId={node.id} />;
  }
  return (
    <div className="wid-splitnode" data-dir={node.dir}>
      <div className="wid-splitnode__pane" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <SplitTree stores={stores} node={node.a} path={[...path, 'a']} />
      </div>
      <SplitHandle stores={stores} dir={node.dir} path={path} />
      <div className="wid-splitnode__pane" style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <SplitTree stores={stores} node={node.b} path={[...path, 'b']} />
      </div>
    </div>
  );
}

/** 4px resize handle between two children of one split. Double-click restores 50/50. */
function SplitHandle({ stores, dir, path }) {
  const node = useRef(null);

  function begin(event) {
    event.preventDefault();
    const parent = node.current ? node.current.parentElement : null;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    function move(moveEvent) {
      const ratio = dir === 'row'
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      stores.actions.resizeSplit(path, ratio);
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  return (
    <div
      ref={node}
      className="wid-splithandle"
      data-dir={dir}
      role="separator"
      aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
      onPointerDown={begin}
      onDoubleClick={() => stores.actions.resizeSplit(path, 0.5)}
    />
  );
}
