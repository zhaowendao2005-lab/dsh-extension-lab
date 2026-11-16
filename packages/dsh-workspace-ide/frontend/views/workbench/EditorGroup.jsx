import { useStore, useEffect, useRef } from '../../runtime.js';
import { TabStrip } from './TabStrip.jsx';
import { DropOverlay } from './DropOverlay.jsx';
import { WelcomeView } from './WelcomeView.jsx';
import { EditorPane } from '../editor/EditorPane.jsx';
import { DiffView } from '../diff/DiffView.jsx';
import { ConflictView } from '../editor/ConflictView.jsx';
import { GraphView } from '../graph/GraphView.jsx';
import { ScmView } from '../scm/ScmView.jsx';
import { RepositoryView } from '../repositories/RepositoryView.jsx';
import { CommandsView } from '../commands/CommandsView.jsx';
import { workbenchScale } from '../../service/geometry.js';

/** One editor group: tab row plus the active tab's content, with a drop overlay while dragging. */
export function EditorGroup({ stores, groupId }) {
  const layout = useStore(stores.layout);
  const body = useRef(null);
  const group = layout.groups[groupId];

  useEffect(() => {
    const node = body.current;
    if (!node) return undefined;
    const report = () => {
      const rect = node.getBoundingClientRect();
      const scale = workbenchScale(node);
      stores.actions.measureGroup(groupId, rect.width / scale, rect.height / scale);
    };
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [groupId, stores]);

  if (!group) return null;
  const active = group.active ? layout.tabs[group.active] : null;

  return (
    <section
      className="wid-group"
      data-wid-group={groupId}
      aria-label="编辑组"
      onPointerDownCapture={() => stores.actions.setActiveGroup(groupId)}
    >
      <TabStrip stores={stores} groupId={groupId} />
      <div className="wid-group__body" ref={body}>
        {active ? <TabContent stores={stores} tab={active} /> : <WelcomeView stores={stores} />}
        <DropOverlay stores={stores} groupId={groupId} />
      </div>
    </section>
  );
}

/** Dispatch one tab kind to its body. Every body is already a full-bleed component. */
function TabContent({ stores, tab }) {
  if (tab.kind === 'file') return <FileTab stores={stores} path={tab.path} />;
  if (tab.kind === 'diff') return <div className="wid-tabcontent"><DiffView stores={stores} /></div>;
  if (tab.kind === 'conflict') return <div className="wid-tabcontent"><ConflictView stores={stores} /></div>;
  if (tab.kind === 'graph') return <div className="wid-tabcontent"><GraphView stores={stores} /></div>;
  if (tab.kind === 'changes') return <div className="wid-tabcontent"><ScmView stores={stores} /></div>;
  if (tab.kind === 'repositories') return <div className="wid-tabcontent"><RepositoryView stores={stores} /></div>;
  if (tab.kind === 'commands') return <div className="wid-tabcontent"><CommandsView stores={stores} /></div>;
  return <div className="wid-empty"><span className="wid-hint">未知的标签类型</span></div>;
}

/** A file tab reads its buffer from the editor domain; the view never owns text. */
function FileTab({ stores, path }) {
  const editor = useStore(stores.editor);
  const ui = useStore(stores.ui);
  const tab = editor.tabs.find((item) => item.path === path);
  if (!tab) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">{path}</span>
      </div>
    );
  }
  return (
    <EditorPane
      stores={stores}
      tab={tab}
      visible
      prefs={ui.editor}
      reveal={editor.reveal}
      preview={Boolean((editor.previews ?? {})[path])}
    />
  );
}
