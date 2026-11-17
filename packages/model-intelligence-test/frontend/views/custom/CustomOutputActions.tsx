import React, { useEffect, useRef } from '../../runtime';
import type { CustomOutputOpenResult } from '../../types';
import { Icon } from '../../components/common';

export function CustomOutputActions({ ready, path, onOpenOutput }: { ready: boolean; path: string | null; onOpenOutput(mode: 'preview' | 'vscode'): Promise<CustomOutputOpenResult> }) {
  const modal = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const resultPath = useRef<HTMLElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const clear = () => {
    if (frame.current) { frame.current.srcdoc = ''; frame.current.hidden = true; }
    if (modal.current) modal.current.dataset.request = String(Number(modal.current.dataset.request || '0') + 1);
    if (status.current) status.current.textContent = '';
  };
  useEffect(() => {
    const element = frame.current;
    return () => { if (element) element.srcdoc = ''; };
  }, []);
  const preview = async () => {
    const dialog = modal.current;
    if (!dialog) return;
    clear();
    const request = dialog.dataset.request;
    if (status.current) status.current.textContent = '正在读取并验证成果…';
    if (resultPath.current) resultPath.current.textContent = path || 'output.html';
    if (!dialog.open) dialog.showModal();
    try {
      const result = await onOpenOutput('preview');
      if (!dialog.isConnected || !dialog.open || dialog.dataset.request !== request) return;
      if (!result.html) throw new Error('Host 未返回可预览的 HTML。');
      if (frame.current) { frame.current.srcdoc = result.html; frame.current.hidden = false; }
      if (status.current) status.current.textContent = '';
      if (resultPath.current) resultPath.current.textContent = result.path || path || 'output.html';
    } catch (error) {
      if (dialog.open && dialog.dataset.request === request && status.current) status.current.textContent = error instanceof Error ? error.message : '成果预览失败。';
    }
  };
  const openEditor = async () => {
    if (feedback.current) feedback.current.textContent = '正在请求打开成果…';
    try {
      const result = await onOpenOutput('vscode');
      if (feedback.current?.isConnected) feedback.current.textContent = result.opened ? '已请求在 VS Code 中打开。' : 'Host 未确认打开，请稍后重试。';
    } catch (error) { if (feedback.current?.isConnected) feedback.current.textContent = error instanceof Error ? error.message : '打开成果失败。'; }
  };
  return <div className="mit-custom-output-actions">
    <button type="button" className="mit-button mit-button-primary" disabled={!ready} onClick={() => { void preview(); }}>预览成果</button>
    <button type="button" className="mit-button" disabled={!ready} onClick={() => { void openEditor(); }}>在 VS Code 打开</button>
    <p className="mit-custom-action-feedback" aria-live="polite" ref={feedback} />
    <dialog className="mit-custom-preview" ref={modal} onClose={clear} onCancel={clear} aria-label="成果隔离预览">
      <header><div><strong>成果预览</strong><code ref={resultPath}>{path || 'output.html'}</code></div><button type="button" className="mit-icon-button" aria-label="关闭成果预览" onClick={() => modal.current?.close()}><Icon name="close" /></button></header>
      <p className="mit-custom-preview-notice">隔离执行 · 禁止访问 Host、网络与父页面</p>
      <p className="mit-custom-preview-status" role="status" ref={status} />
      <iframe ref={frame} title="自定义测试 HTML 成果" sandbox="allow-scripts" referrerPolicy="no-referrer" hidden />
    </dialog>
  </div>;
}
