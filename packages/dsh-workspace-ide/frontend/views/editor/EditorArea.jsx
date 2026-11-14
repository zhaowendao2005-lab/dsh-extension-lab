import { DiffView } from '../diff/DiffView.jsx';
import { ConflictView } from './ConflictView.jsx';
import { useStore, useEffect, useRef } from '../../runtime.js';
import { createEditor } from '../../editor/createEditor.js';
import { Icon } from '../common/Icon.jsx';
import { renderMarkdown } from '../../editor/markdown.js';

/** Editor region: tab strip plus one persistent CodeMirror view per open tab. */
export function EditorArea({ stores }) {
  // Every hook runs before any early return: swapping the whole region (diff / conflict / tabs)
  // must not change the hook order, or React tears the slot down with error #300.
  const ui = useStore(stores.ui);
  const editor = useStore(stores.editor);
  const workspace = useStore(stores.workspace);
  if (ui.conflictOpen) return <ConflictView stores={stores} />;
  if (ui.diffOpen) return <DiffView stores={stores} />;
  const active = editor.tabs.find((tab) => tab.path === editor.activePath) ?? null;

  async function requestClose(path) {
    const tab = editor.tabs.find((item) => item.path === path);
    if (!tab?.dirty) {
      stores.actions.closeTab(path);
      return;
    }
    const accepted = await stores.actions.confirm({
      title: '放弃未保存的更改？',
      body: `${tab.title} 有未保存的修改。`,
      detail: path,
      confirmLabel: '放弃并关闭',
      danger: true,
      irreversible: true,
    });
    if (accepted) stores.actions.closeTab(path, { force: true });
  }

  return (
    <main className="wid-editor" aria-label="编辑器">
      <div className="wid-editor__tabs" role="tablist">
        {editor.tabs.map((tab) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={tab.path === editor.activePath}
            data-active={String(tab.path === editor.activePath)}
            className="wid-editor__tab"
            title={tab.path}
            onClick={() => stores.actions.activateTab(tab.path)}
            onAuxClick={(event) => {
              if (event.button === 1) void requestClose(tab.path);
            }}
          >
            <span className="wid-editor__tab-title">
              {tab.title}
              {tab.dirty && <span className="wid-editor__dirty" aria-label="未保存">•</span>}
            </span>
            <button
              type="button"
              className="wid-icon-button wid-editor__tab-close"
              title="关闭"
              onClick={(event) => {
                event.stopPropagation();
                void requestClose(tab.path);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <span className="wid-editor__tabs-spacer" />
        {active?.language === 'markdown' && (
          <button
            type="button"
            className="wid-icon-button"
            title={(editor.previews ?? {})[active.path] ? '显示源码' : '预览 Markdown'}
            aria-pressed={Boolean((editor.previews ?? {})[active.path])}
            onClick={() => stores.actions.togglePreview(active.path)}
          >
            <Icon name="preview" size={14} />
          </button>
        )}
        {active && (
          <button
            type="button"
            className="wid-icon-button"
            title="保存（Cmd/Ctrl+S）"
            disabled={!active.dirty || active.readOnly}
            onClick={() => void stores.actions.save(active.path)}
          >
            <Icon name="check" size={14} />
          </button>
        )}
      </div>
      <div className="wid-editor__body">
        {editor.tabs.length === 0 && (
          <div className="wid-empty">
            <span className="wid-hint">
              {workspace.root ? '从资源管理器打开文件（双击）' : '请先选择工作区目录'}
            </span>
          </div>
        )}
        {editor.tabs.map((tab) => (
          <EditorPane
            key={tab.path}
            stores={stores}
            tab={tab}
            visible={tab.path === editor.activePath}
            prefs={ui.editor}
            reveal={editor.reveal}
            preview={Boolean((editor.previews ?? {})[tab.path])}
          />
        ))}
      </div>
    </main>
  );
}

function EditorPane({ stores, tab, visible, prefs, reveal, preview }) {
  const host = useRef(null);
  const handle = useRef(null);

  useEffect(() => {
    if (preview || tab.mode !== 'ready' || !host.current || handle.current) return undefined;
    const editor = createEditor({
      parent: host.current,
      doc: tab.text ?? '',
      languageId: tab.language ?? 'plaintext',
      readOnly: Boolean(tab.readOnly),
      prefs,
      onChange: (text) => stores.actions.updateText(tab.path, text),
      onCursor: (position) => stores.actions.setCursor(tab.path, position),
      onSave: () => void stores.actions.save(tab.path),
    });
    handle.current = editor;
    return () => {
      editor.destroy();
      handle.current = null;
    };
  }, [tab.mode, tab.path, tab.language, tab.readOnly, stores, preview]);

  // Revert / external reload replaces the buffer under the same view.
  useEffect(() => {
    if (!handle.current || tab.mode !== 'ready') return;
    if (handle.current.value() === (tab.text ?? '')) return;
    handle.current.reset(tab.text ?? '');
  }, [tab.text, tab.mode]);

  // Settings apply to every open editor immediately; remounting would lose the undo history.
  useEffect(() => {
    handle.current?.setPrefs(prefs);
  }, [prefs]);

  // A search hit (or any caller) asks for a specific line; `seq` makes repeats re-reveal.
  useEffect(() => {
    if (!reveal || reveal.path !== tab.path || !handle.current) return;
    handle.current.gotoLine(reveal.line, reveal.column ?? 1);
  }, [reveal, tab.path]);

  useEffect(() => {
    if (visible && handle.current) handle.current.focus();
  }, [visible]);

  if (tab.mode === 'loading') {
    return (
      <div className="wid-editor__pane" data-visible={String(visible)}>
        <div className="wid-empty"><span className="wid-hint">正在读取…</span></div>
      </div>
    );
  }

  if (tab.mode === 'binary' || tab.mode === 'too-large' || tab.mode === 'error') {
    return (
      <div className="wid-editor__pane" data-visible={String(visible)}>
        <div className="wid-empty">
          <span className="wid-hint">{tab.error ?? '无法打开该文件'}</span>
          <button type="button" className="wid-button" onClick={() => void stores.actions.reload(tab.path)}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wid-editor__pane" data-visible={String(visible)}>
      {preview ? (
        <div className="wid-md">{renderMarkdown(tab.text ?? '')}</div>
      ) : (
        <div ref={host} className="wid-editor__cm" />
      )}
    </div>
  );
}
