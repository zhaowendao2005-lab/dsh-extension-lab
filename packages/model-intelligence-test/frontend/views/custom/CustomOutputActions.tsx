import React, { useEffect, useRef } from '../../runtime';
import type { CustomOutputOpenResult } from '../../types';
import { Icon } from '../../components/common';

const PLATFORM_HINT = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent) : '';
const FILE_MANAGER_LABEL = /Mac|iPhone|iPad|iPod/i.test(PLATFORM_HINT)
  ? '访达'
  : /Win/i.test(PLATFORM_HINT)
    ? '资源管理器'
    : '文件管理器';

export function CustomOutputActions({ ready, path, onOpenOutput }: { ready: boolean; path: string | null; onOpenOutput(mode: 'preview' | 'vscode' | 'reveal' | 'browser', application?: string): Promise<CustomOutputOpenResult> }) {
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
      if (!feedback.current?.isConnected) return;
      if (result.opened) { feedback.current.textContent = `已用 ${result.application?.name ?? '桌面应用'} 打开 ${result.path ?? ''}。`; return; }
      // No VS Code registered for this file: say so honestly and fall back to revealing the file.
      const names = (result.applications ?? []).map(item => item.name).join('、');
      const revealed = await onOpenOutput('reveal');
      if (feedback.current?.isConnected) feedback.current.textContent = `系统未登记可打开此文件的 VS Code${names ? `（可用：${names}）` : ''}；${revealed.opened ? `已在${FILE_MANAGER_LABEL}中显示该文件。` : `也未能在${FILE_MANAGER_LABEL}中显示。`}`;
    } catch (error) { if (feedback.current?.isConnected) feedback.current.textContent = error instanceof Error ? error.message : '打开成果失败。'; }
  };
  return <div className="mit-custom-output-actions">
    <button type="button" className="mit-button mit-button-primary" disabled={!ready} onClick={() => { void preview(); }}>预览成果</button>
    <button type="button" className="mit-button" disabled={!ready} onClick={() => { void openEditor(); }}>在 VS Code 打开</button>
    <button type="button" className="mit-button" disabled={!ready} onClick={() => { if (feedback.current) feedback.current.textContent = '正在请求浏览器打开成果…'; void onOpenOutput('browser').then(result => { if (!feedback.current?.isConnected) return; feedback.current.textContent = result.opened ? `已在${result.application?.name ?? '默认浏览器'}中打开 ${result.path ?? ''}。` : '未能在浏览器中打开成果。'; }, error => { if (feedback.current?.isConnected) feedback.current.textContent = error instanceof Error ? error.message : '浏览器打开成果失败。'; }); }}>在浏览器中打开</button>
    <button type="button" className="mit-button" disabled={!ready} onClick={() => { void onOpenOutput('reveal').then(result => { if (feedback.current?.isConnected) feedback.current.textContent = result.opened ? `已在${FILE_MANAGER_LABEL}中显示。` : '未能显示文件。'; }, error => { if (feedback.current?.isConnected) feedback.current.textContent = error instanceof Error ? error.message : '显示文件失败。'; }); }}>{`在${FILE_MANAGER_LABEL}中显示`}</button>
    <p className="mit-custom-action-feedback" aria-live="polite" ref={feedback} />
    <dialog className="mit-custom-preview" ref={modal} onClose={clear} onCancel={clear} aria-label="成果隔离预览">
      <header><div><strong>成果预览</strong><code ref={resultPath}>{path || 'output.html'}</code></div><span className="mit-custom-preview-head"><button type="button" className="mit-text-button" onClick={() => { if (!feedback.current) return; void onOpenOutput('browser').then(result => { if (feedback.current?.isConnected) feedback.current.textContent = result.opened ? `已在${result.application?.name ?? '默认浏览器'}中打开。` : '未能在浏览器中打开成果。'; }, error => { if (feedback.current?.isConnected) feedback.current.textContent = error instanceof Error ? error.message : '浏览器打开成果失败。'; }); }}>在浏览器中打开</button><button type="button" className="mit-icon-button" aria-label="关闭成果预览" onClick={() => modal.current?.close()}><Icon name="close" /></button></span></header>
      <p className="mit-custom-preview-notice">隔离执行 · 禁止访问 Host、网络与父页面</p>
      <p className="mit-custom-preview-status" role="status" ref={status} />
      <iframe ref={frame} title="自定义测试 HTML 成果" sandbox="allow-scripts" referrerPolicy="no-referrer" hidden />
    </dialog>
  </div>;
}
