import React, { useEffect, useRef, useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Icon } from '../../components/common';

/**
 * 成果隔离预览对话框。列表行的「可查看」现在走 WebView 路线打开，
 * 这里留给执行详情页的「预览成果」入口；iframe 与 Files 页保持同一隔离约定（无 same-origin）。
 */
export function CustomOutputPreview({ store }: { store: Workbench }) {
  const preview = useStore(store.custom, state => state.preview);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (preview.open && !element.open) element.showModal();
    if (!preview.open && element.open) element.close();
  }, [preview.open]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    element.srcdoc = preview.open && preview.html ? preview.html : '';
  }, [preview.open, preview.html]);

  useEffect(() => () => {
    const element = frame.current;
    if (element) element.srcdoc = '';
  }, []);

  const close = () => store.actions.dismissPreview();
  return <dialog className="mit-custom-preview" ref={dialog} onClose={close} onCancel={close} aria-label="成果隔离预览">
    <header>
      <div><strong>成果预览</strong><code>{preview.path || 'output.html'}</code></div>
      <button type="button" className="mit-icon-button" aria-label="关闭成果预览" onClick={close}><Icon name="close" /></button>
    </header>
    <p className="mit-custom-preview-notice">隔离执行 · 禁止访问 Host、网络与父页面</p>
    {preview.loading && <p className="mit-custom-preview-status" role="status">正在读取并验证成果…</p>}
    {preview.error && <p className="mit-custom-preview-status" role="alert">{preview.error}</p>}
    <iframe ref={frame} title="自定义测试 HTML 成果" sandbox="allow-scripts" referrerPolicy="no-referrer" hidden={!preview.html} />
  </dialog>;
}
