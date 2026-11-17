import { useRef, useEffect } from '../../runtime.js';
import { createEditor } from '../../editor/createEditor.js';
import { renderMarkdown } from '../../editor/markdown.js';
import { getEditorWrapState } from '../../editor/preferences.js';
import { formatMediaSize, previewKindForPath } from '../../service/preview.js';

/**
 * One CodeMirror view for one open file tab. The store holds the text, so the view can be
 * unmounted (tab hidden in another group) and rebuilt without losing unsaved changes.
 */
export function EditorPane({ stores, tab, visible, prefs, reveal, preview }) {
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

  useEffect(() => {
    handle.current?.setPrefs(prefs);
  }, [prefs, visible, preview, tab.mode, tab.path]);

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

  if (tab.mode === 'media') {
    const sizeText = formatMediaSize(tab.size);
    return (
      <div className="wid-editor__pane" data-visible={String(visible)}>
        <div className="wid-media" data-kind={tab.mediaKind}>
          <div className="wid-media__stage">
            {tab.mediaKind === 'video' ? (
              <video
                className="wid-media__video"
                controls
                playsInline
                preload="metadata"
                src={tab.mediaUrl}
                onError={(event) => {
                  const stage = event.currentTarget.parentElement;
                  if (stage) stage.dataset.mediaError = 'true';
                }}
              />
            ) : (
              <img
                className="wid-media__img"
                src={tab.mediaUrl}
                alt={tab.title}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  const meta = img.closest('.wid-media')?.querySelector('.wid-media__dims');
                  if (meta && img.naturalWidth > 0) meta.textContent = img.naturalWidth + ' × ' + img.naturalHeight;
                }}
                onError={(event) => {
                  const stage = event.currentTarget.parentElement;
                  if (stage) stage.dataset.mediaError = 'true';
                }}
              />
            )}
            <div className="wid-media__error wid-hint">
              {tab.mediaKind === 'video' ? '当前浏览器内核不支持该视频编码或文件无法解码' : '无法解码该图像文件'}
            </div>
          </div>
          <div className="wid-media__bar">
            <span>{tab.title}</span>
            <span className="wid-media__dims" />
            {tab.mediaMime && <span>{tab.mediaMime}</span>}
            {sizeText && <span>{sizeText}</span>}
          </div>
        </div>
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

  const wrap = getEditorWrapState(tab.text ?? '', prefs);
  const previewKind = preview ? previewKindForPath(tab.path) : null;
  const svgSrc = previewKind === 'image'
    ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tab.text ?? '')
    : null;
  return (
    <div className="wid-editor__pane" data-visible={String(visible)}>
      {previewKind === 'html' ? (
        <iframe
          className="wid-preview__frame"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={tab.path}
          srcDoc={tab.text ?? ''}
        />
      ) : svgSrc ? (
        <div className="wid-media" data-kind="image">
          <div className="wid-media__stage">
            <img className="wid-media__img" src={svgSrc} alt={tab.title} />
          </div>
          <div className="wid-media__bar">
            <span>{tab.title}</span>
            <span>image/svg+xml</span>
          </div>
        </div>
      ) : preview ? (
        <div className="wid-md">{renderMarkdown(tab.text ?? '')}</div>
      ) : (
        <>
          {wrap.reason && (
            <div className="wid-editor-wrap-notice" role="status">
              {wrap.reason}；已保留自动换行偏好
            </div>
          )}
          <div ref={host} className="wid-editor__cm" />
        </>
      )}
    </div>
  );
}
