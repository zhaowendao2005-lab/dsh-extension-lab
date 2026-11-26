import React from '../../runtime';
import type { CustomDetailTab, CustomErrorDetail, CustomFileReadResult, CustomOutputOpenResult, CustomRunDetail, CustomRunSummary, Model } from '../../types';
import { ChatFlowView } from '../../chatflow/ChatFlowView';
import { Empty, Icon } from '../../components/common';
import { CustomMetricsChart } from '../../components/CustomMetricsChart';
import { CustomOutputActions } from './CustomOutputActions';
import { count, decimal, millis, rate, cost, fileSize, clock, outputLabel, CustomPhaseBadge, CUSTOM_BILLING_LABELS } from './presentation';
import { CustomStepsView } from './CustomStepsView';

export interface CustomTaskViewProps {
  model: Model;
  summary: CustomRunSummary;
  detail?: CustomRunDetail;
  loading: boolean;
  error?: string;
  actionError?: string;
  cancelling?: boolean;
  activeTab: CustomDetailTab;
  file?: CustomFileReadResult;
  fileLoading: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canContinue?: boolean;
  continuing?: boolean;
  onContinue?(): void;
  onTabChange(tab: CustomDetailTab): void;
  onReadFile(path: string): void;
  onOpenOutput(mode: 'preview' | 'vscode' | 'reveal', application?: string): Promise<CustomOutputOpenResult>;
  onRetry(): void;
  retrying?: boolean;
  onCancel(): void;
  onClose?(): void;
  compact?: boolean;
}
const TABS: { id: CustomDetailTab; label: string }[] = [{ id: 'chat', label: 'Chat' }, { id: 'steps', label: '步骤' }, { id: 'files', label: '文件' }, { id: 'metrics', label: '指标' }, { id: 'billing', label: '账单' }, { id: 'permissions', label: '权限' }];
function Chat({ detail, summary }: { detail: CustomRunDetail; summary: CustomRunSummary }) {
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const stick = React.useRef(true);
  // Follow growth only while the reader sits near the bottom; scrolling up to read history is never yanked back.
  React.useEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [detail.revision]);
  if (!detail.events.length && !detail.requests.length && !summary.retryHistory?.length && !['queued', 'preparing', 'running', 'tooling', 'validating'].includes(summary.phase)) return <Empty title="暂无会话内容">会话开始后将在此按步骤展示模型的思考、输出与工具调用。</Empty>;
  return <div className="mit-chat-mirror" aria-label="会话记录" ref={scroller}
    onScroll={(event) => { const element = event.currentTarget; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }}>
    <ChatFlowView events={detail.events} requests={detail.requests} summary={summary} truncated={detail.eventsTruncated} />
  </div>;
}
/** Full failure detail: stack, cause chain, upstream HTTP status / body / request id. Native <details>, collapsed. */
export function ErrorDetailView({ detail }: { detail?: CustomErrorDetail | null }) {
  if (!detail) return null;
  const meta = [detail.status ? `HTTP ${detail.status}` : null, detail.requestId ? `请求 ID ${detail.requestId}` : null, detail.name || null].filter(Boolean).join(' · ');
  return <details className="mit-custom-error-detail">
    <summary>错误详情{meta ? <span> · {meta}</span> : null}</summary>
    {detail.message && <section><h5>消息</h5><pre>{detail.message}</pre></section>}
    {detail.body && <section><h5>上游响应</h5><pre>{detail.body}</pre></section>}
    {detail.stack && <section><h5>堆栈</h5><pre>{detail.stack}</pre></section>}
    {detail.causes?.map((cause, index) => <section key={index}><h5>Cause #{index + 1}{cause.name ? ` · ${cause.name}` : ''}{cause.code ? ` · ${cause.code}` : ''}</h5><pre>{[cause.message, cause.stack].filter(Boolean).join('\n\n')}</pre></section>)}
  </details>;
}
function Files({ detail, file, loading, onReadFile, summary, onOpenOutput }: { detail: CustomRunDetail; file?: CustomFileReadResult; loading: boolean; onReadFile(path: string): void; summary: CustomRunSummary; onOpenOutput: CustomTaskViewProps['onOpenOutput'] }) {
  const ready = summary.output.state === 'ready' && summary.output.validation === 'valid';
  return <div className="mit-custom-files">
    <div className="mit-custom-output-card"><div><strong>成果文件</strong><span className={`mit-custom-output-state is-${summary.output.state}`}>{outputLabel(summary)}</span></div><code>{summary.output.relativePath || '尚未声明成果路径'}</code><small>{summary.output.size === null ? '大小未知' : fileSize(summary.output.size)} · 由 Host 验证路径与格式</small><CustomOutputActions key={summary.id} ready={ready} path={summary.output.relativePath} onOpenOutput={onOpenOutput} /></div>
    <h4>沙箱文件 <span>{detail.files.length}</span></h4>
    {detail.files.length ? <ul className="mit-custom-file-list">{detail.files.map(item => <li key={item.path}><button type="button" aria-pressed={file?.path === item.path} disabled={loading} onClick={() => onReadFile(item.path)}><code>{item.path}</code><span>{fileSize(item.size)}</span></button></li>)}</ul> : <Empty title="暂无文件">文件写入后由 Host 列出。</Empty>}
    {loading && <p role="status" className="mit-custom-data-note">正在读取文件…</p>}
    {file && <section className="mit-custom-file-content" aria-label={`文件内容 ${file.path}`}><header><code>{file.path}</code><span>只读</span></header><pre>{file.text || '（空文件）'}</pre></section>}
  </div>;
}
function Metrics({ detail, summary }: { detail: CustomRunDetail; summary: CustomRunSummary }) {
  const metrics = summary.metrics;
  return <div className="mit-custom-metric-content"><dl className="mit-custom-metric-grid">
    <div><dt>TTFT</dt><dd>{millis(metrics.ttftMs)}</dd></div><div><dt>生成耗时</dt><dd>{millis(metrics.generationMs)}</dd></div><div><dt>端到端耗时</dt><dd>{millis(metrics.e2eMs)}</dd></div>
    <div><dt>模型吞吐</dt><dd>{decimal(metrics.modelTokensPerSecond)} <small>tok/s</small></dd></div><div><dt>端到端吞吐</dt><dd>{decimal(metrics.endToEndTokensPerSecond)} <small>tok/s</small></dd></div><div><dt>缓存率</dt><dd>{rate(metrics.cacheRate)}</dd></div>
  </dl><p className="mit-custom-data-note">横轴为真实请求顺序。模型吞吐使用生成耗时，端到端吞吐使用完整执行耗时；未知观测保留空缺。</p>
  {!detail.requests.length ? <Empty title="暂无请求指标">真实请求产生可观测指标后绘图。</Empty> : <>
    <section className="mit-custom-chart-card"><h4>吞吐 <span>tok/s</span></h4><CustomMetricsChart requests={detail.requests} kind="speed" /></section>
    <section className="mit-custom-chart-card"><h4>延迟与生成耗时 <span>ms</span></h4><CustomMetricsChart requests={detail.requests} kind="latency" /></section>
    <section className="mit-custom-chart-card"><h4>Token 用量</h4><CustomMetricsChart requests={detail.requests} kind="tokens" /></section>
    <section className="mit-custom-chart-card"><h4>缓存命中率 <span>%</span></h4><CustomMetricsChart requests={detail.requests} kind="cache" /></section>
  </>}
  </div>;
}
function Billing({ detail, summary }: { detail: CustomRunDetail; summary: CustomRunSummary }) {
  return <div className="mit-custom-billing"><div className="mit-custom-billing-total"><span>已知费用 · {CUSTOM_BILLING_LABELS[summary.usage.billingState]}</span><strong>{cost(summary.usage.cost, summary.usage.currency)}</strong><small>{count(summary.usage.requestCount)} 次请求 · 输入 {count(summary.usage.inputTokens)} / 输出 {count(summary.usage.outputTokens)} Token</small></div>
    <p className="mit-custom-data-note">费用仅展示 Host 回填值。未知账单不按零元计算，部分回填不代表最终账单。</p>
    {detail.requests.length ? <div className="mit-custom-request-scroll"><table className="mit-custom-request-table"><thead><tr><th scope="col">请求</th><th scope="col">输入 / 输出</th><th scope="col">费用</th><th scope="col">账单</th></tr></thead><tbody>{detail.requests.map((request, index) => <tr key={request.id}><th scope="row" title={request.requestId || '请求 ID 未提供'}>#{index + 1}<span className="mit-custom-cell-sub">{request.status === 'completed' ? '已完成' : request.status === 'failed' ? '失败' : request.status === 'cancelled' ? '已取消' : '请求中'}</span></th><td>{count(request.usage.inputTokens)}<span className="mit-custom-cell-sub">{count(request.usage.outputTokens)}</span></td><td>{cost(request.usage.cost, request.usage.currency)}</td><td>{CUSTOM_BILLING_LABELS[request.billingState]}{request.error && typeof request.error === 'object' ? <><span className="mit-custom-cell-sub is-error">{request.error.status ? `HTTP ${request.error.status} · ` : ''}{request.error.code || '失败'}</span><ErrorDetailView detail={request.error.detail} /></> : null}</td></tr>)}</tbody></table></div> : <Empty title="暂无请求账单">请求登记后在此显示账单状态。</Empty>}
  </div>;
}
function Permissions({ detail, summary }: { detail: CustomRunDetail; summary: CustomRunSummary }) {
  return <div className="mit-custom-permissions"><div className="mit-custom-permission-summary"><strong>本次运行权限</strong><span>沙箱：{{ preparing: '准备中', ready: '已就绪', failed: '准备失败', cleaning: '清理中', unknown: '未知' }[summary.sandboxState]}</span></div>
    <section><h4>已允许</h4>{detail.permissions.allowed.length ? <ul>{detail.permissions.allowed.map(name => <li key={name}><Icon name="check" size={13} /><code>{name}</code></li>)}</ul> : <p className="mit-custom-data-note">Host 未声明允许项。</p>}</section>
    <section><h4>已拒绝</h4>{detail.permissions.denied.length ? <ul className="is-denied">{detail.permissions.denied.map(name => <li key={name}><Icon name="close" size={13} /><code>{name}</code></li>)}</ul> : <p className="mit-custom-data-note">暂无已记录的拒绝项。</p>}</section><p className="mit-custom-data-note">权限由 Host 执行器控制，此处展示当前运行快照。</p>
  </div>;
}
export function CustomTaskView(props: CustomTaskViewProps) {
  const { model, summary, detail, loading, error, actionError, cancelling, activeTab, file, fileLoading, canRetry, retrying, canCancel, canContinue, continuing, onContinue, onTabChange, onReadFile, onOpenOutput, onRetry, onCancel, onClose } = props;
  const tab = TABS.find(item => item.id === activeTab) || TABS[0];
  return <section className="mit-custom-detail" aria-label="自定义执行详情" aria-busy={loading}>
    <header className="mit-custom-detail-heading">
      <div className="mit-custom-detail-lead">
        {onClose && <button type="button" className="mit-icon-button is-back" aria-label="返回执行概览" title="返回执行概览" onClick={onClose}><Icon name="chevron" /></button>}
        <div>
          <h3>{summary.target.displayName || model.name}</h3>
          <p>{summary.target.kind === 'a6api' ? `a6api · 渠道 #${summary.target.channelId ?? '—'}` : model.providerName || model.provider}<span> · {summary.sessionId || '会话待创建'}</span></p>
        </div>
      </div>
      <nav className="mit-custom-tabs" aria-label="执行详情分类">{TABS.map(item => <button type="button" key={item.id} aria-current={item.id === tab.id ? 'page' : undefined} className={item.id === tab.id ? 'is-active' : ''} onClick={() => onTabChange(item.id)}>{item.label}{item.id === 'files' && detail ? <span>{detail.files.length}</span> : null}</button>)}</nav>
      <div className="mit-custom-detail-actions">
        <CustomPhaseBadge phase={summary.phase} />
        <span>{count(summary.usage.requestCount)} 次请求</span>
        <span>{clock(summary.startedAt)} 开始</span>
      </div>
    </header>
    {summary.error && <div className="mit-custom-error" role="alert"><div className="mit-custom-error-head"><strong>{summary.error.code || '执行错误'}</strong>{canContinue && onContinue && <button type="button" className="mit-button mit-button-primary" disabled={continuing} onClick={onContinue}><Icon name="refresh" size={13} />{continuing ? '正在继续…' : '补发 continue'}</button>}</div><p>{summary.error.message}</p><ErrorDetailView detail={summary.error.detail} /></div>}
    {summary.resumeError && <div className="mit-custom-error" role="alert"><strong>继续会话未启动</strong><p>{summary.resumeError.message}</p><ErrorDetailView detail={summary.resumeError.detail} /></div>}
    {actionError && <div className="mit-custom-error" role="alert">{actionError}</div>}
    {error && <div className="mit-custom-error" role="alert">{error}</div>}
    <div className="mit-custom-detail-body" aria-label={tab.label}>{!detail ? !loading && <Empty title="详情暂不可用">{summary.phase === 'cancelled' ? '任务已取消，等待 Host 返回已保留的执行记录。' : '连接恢复后会继续读取已有运行数据。'}</Empty> : tab.id === 'chat' ? <Chat detail={detail} summary={summary} /> : tab.id === 'steps' ? <CustomStepsView requests={detail.requests} events={detail.events} summary={summary} truncated={detail.requestsTruncated} /> : tab.id === 'files' ? <Files detail={detail} file={file} loading={fileLoading} onReadFile={onReadFile} summary={summary} onOpenOutput={onOpenOutput} /> : tab.id === 'metrics' ? <Metrics detail={detail} summary={summary} /> : tab.id === 'billing' ? <Billing detail={detail} summary={summary} /> : <Permissions detail={detail} summary={summary} />}</div>
    <footer className="mit-custom-detail-footer"><span>{summary.output.relativePath ? outputLabel(summary) : '成果尚未就绪'}{summary.continuations ? ` · 已继续 ${summary.continuations} 次` : ''}{summary.retries ? ` · 已重试 ${summary.retries} 次` : ''}{loading ? ' · 正在更新详情…' : ''}</span><div>{canCancel && <button type="button" className="mit-button mit-danger-text" disabled={cancelling || continuing} onClick={onCancel}><Icon name="stop" size={13} />{cancelling ? '正在取消…' : '取消此模型'}</button>}{canContinue && onContinue && <button type="button" className="mit-button" disabled={continuing} onClick={onContinue} title="在同一 DSH 会话中发送 continue，保留已有上下文与沙箱">{continuing ? '正在继续…' : '继续会话'}</button>}{canRetry && <button type="button" className="mit-button" disabled={retrying || continuing} onClick={onRetry} title="开头就失败时使用：同一轮次原位从头运行，新会话与新沙箱；旧请求保留在账本中"><Icon name="refresh" size={13} />{retrying ? '正在重试…' : '从头重试'}</button>}</div></footer>
  </section>;
}
