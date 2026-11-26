import React from '../../runtime';
import type { ReactNode } from 'react';
import type { A6MarketSnapshot, CustomOutputOpenResult, Evaluation, Model, CustomRunSummary } from '../../types';
import { Empty, Icon } from '../../components/common';
import { ColumnResizer } from '../../components/ColumnResizer';
import { modelLabel, providerLabel } from '../results/modelLabel';
import { marketCacheCell, marketPriceCell, marketTitle } from '../a6/MarketSnapshot';
import { count, decimal, millis, rate, cost, outputLabel, ended, CustomPhaseBadge, CUSTOM_BILLING_LABELS, observed } from './presentation';

export interface CustomMonitorRow { id: string; model: Model; summary: CustomRunSummary }
export interface CustomMonitorViewProps {
  record: Evaluation;
  rows: CustomMonitorRow[];
  selectedRunId?: string;
  resultOnly: boolean;
  filter: string;
  onFilter(value: string): void;
  onSelectRun(runId: string): void;
  onRetry(runId: string): void;
  /** Runs with a retry/continue/cancel request in flight; their row actions stay disabled. */
  pendingRunIds?: string[];
  onOpenOutput?(runId: string, mode: 'preview' | 'vscode' | 'reveal' | 'browser' | 'webview', application?: string, title?: string): Promise<CustomOutputOpenResult>;
  renderChannelActions?(model: Model): ReactNode;
  widths?: Record<string, number>;
  onResize?(column: string, width: number): void;
}
const marketOf = (model: Model, summary: CustomRunSummary): A6MarketSnapshot | undefined => summary.target.marketSnapshot ?? model.a6api?.market;
// Defaults mirror `.mit-col-*` in styles/custom.css so a fresh table matches the previous layout.
const CUSTOM_WIDTHS: Record<string, number> = { model: 185, 'channel-actions': 216, phase: 105, req: 48, tokens: 80, ttft: 95, 'model-tps': 95, e2e: 95, cache: 65, 'input-price': 92, 'output-price': 92, cache24h: 92, cost: 105, output: 92, actions: 100 };
const columnWidth = (widths: Record<string, number> | undefined, column: string): number => widths?.[`custom:${column}`] ?? CUSTOM_WIDTHS[column];
export function CustomMonitorView({ record, rows, selectedRunId, resultOnly, filter, onFilter, onSelectRun, onRetry, pendingRunIds, onOpenOutput, renderChannelActions, widths, onResize }: CustomMonitorViewProps) {
  const needle = filter.trim().toLowerCase();
  const visible = rows.filter(row => (!resultOnly || ended(row.summary.phase)) && (!needle || `${modelLabel(row.model)} ${providerLabel(row.model)} ${row.summary.target.displayName} ${row.summary.target.channelId ?? ''}`.toLowerCase().includes(needle)));
  const active = rows.filter(row => !ended(row.summary.phase)).length;
  const completed = rows.filter(row => row.summary.phase === 'completed').length;
  const knownRequests = rows.filter(row => observed(row.summary.usage.requestCount));
  const requestCount = knownRequests.reduce((sum, row) => sum + (row.summary.usage.requestCount ?? 0), 0);
  // a6api channels carry the page's own price/cache snapshot; native DSH targets do not.
  const withMarket = rows.some(row => Boolean(marketOf(row.model, row.summary)));
  const columns = ['model', ...(renderChannelActions ? ['channel-actions'] : []), 'phase', 'req', 'tokens', 'ttft', 'model-tps', 'e2e', 'cache', ...(withMarket ? ['input-price', 'output-price', 'cache24h'] : []), 'cost', 'output', 'actions'];
  const totalWidth = columns.reduce((sum, column) => sum + columnWidth(widths, column), 0);
  // 成果/操作两列吸附在右侧；成果列的偏移跟随可调整的操作列宽。
  const actionsWidth = columnWidth(widths, 'actions');
  const minWidth = renderChannelActions ? (withMarket ? 1796 : 1526) : (withMarket ? 1580 : 1310);
  const resizer = (column: string, label: string) => onResize ? <ColumnResizer width={columnWidth(widths, column)} label={label} min={40} onResize={width => onResize(`custom:${column}`, width)} /> : null;
  return <section className="mit-custom-monitor" aria-label="自定义测试实时监控">
    <div className="mit-custom-monitor-tools">
      <label className="mit-search mit-table-search"><Icon name="search" /><input aria-label="筛选自定义测试模型" placeholder="筛选模型、提供商或渠道…" value={filter} onChange={event => onFilter(event.currentTarget.value)} /></label>
      <span className="mit-muted">{completed}/{rows.length} 完成 · {active} 运行中 · {knownRequests.length ? `${count(requestCount)}${knownRequests.length < rows.length ? '+' : ''} 次请求` : '请求数待回填'}</span>
    </div>
    {resultOnly && <div className="mit-custom-result-note" role="status">已结束 {rows.filter(row => ended(row.summary.phase)).length} 个模型{active ? ` · ${active} 个仍在运行` : ''}</div>}
    <div className="mit-custom-table-scroll">
      <table className={`mit-custom-table${withMarket ? ' has-market' : ''}${renderChannelActions ? ' has-channel-actions' : ''}`} style={{ width: Math.max(totalWidth, minWidth) }}>
        <colgroup>
          {columns.map(column => <col key={column} style={{ width: columnWidth(widths, column) }} />)}
        </colgroup>
        <caption className="mit-custom-sr-only">{record.name} · 真实自定义测试。未知数据以破折号显示，费用依 Host 账单回填。</caption>
        <thead><tr>
          <th scope="col" className="mit-col-model">参测模型{resizer('model', '参测模型')}</th>
          {renderChannelActions && <th scope="col" className="mit-col-channel-actions">渠道操作{resizer('channel-actions', '渠道操作')}</th>}
          <th scope="col" className="mit-col-phase">状态{resizer('phase', '状态')}</th>
          <th scope="col" className="mit-col-req">请求{resizer('req', '请求')}</th>
          <th scope="col" className="mit-col-tokens">输入 / 输出{resizer('tokens', '输入 / 输出')}</th>
          <th scope="col" className="mit-col-metric" title="首 Token 时延">TTFT{resizer('ttft', 'TTFT')}</th>
          <th scope="col" className="mit-col-metric" title="输出 Token ÷ 模型生成耗时">模型 tok/s{resizer('model-tps', '模型 tok/s')}</th>
          <th scope="col" className="mit-col-metric" title="输出 Token ÷ 端到端执行耗时，含工具及等待">端到端 tok/s{resizer('e2e', '端到端 tok/s')}</th>
          <th scope="col" className="mit-col-cache" title="本轮请求的缓存读取 Token ÷ 总输入 Token">实测缓存率{resizer('cache', '实测缓存率')}</th>
          {withMarket && <th scope="col" className="mit-col-price" title="渠道网页报价快照 · 人民币/百万 Token，不等于实际消费">输入价{resizer('input-price', '输入价')}</th>}
          {withMarket && <th scope="col" className="mit-col-price" title="渠道网页报价快照 · 人民币/百万 Token，不等于实际消费">输出价{resizer('output-price', '输出价')}</th>}
          {withMarket && <th scope="col" className="mit-col-price" title="渠道近 24 小时缓存率，站点统计口径，非本轮测试命中率">渠道 24h 缓存{resizer('cache24h', '渠道 24h 缓存')}</th>}
          <th scope="col" className="mit-col-cost">费用{resizer('cost', '费用')}</th>
          <th scope="col" className="mit-col-output mit-sticky-output" style={{ right: actionsWidth }}>成果{resizer('output', '成果')}</th>
          <th scope="col" className="mit-col-actions mit-sticky-actions">操作{resizer('actions', '操作')}</th>
        </tr></thead>
        <tbody>{visible.map(({ id, model, summary }) => {
          const market = marketOf(model, summary);
          return <tr key={id} className={selectedRunId === id ? 'is-selected' : ''} aria-selected={selectedRunId === id}>
          <th scope="row" className="mit-col-model"><button type="button" className="mit-custom-model-button" aria-label={`查看 ${modelLabel(model)} 的执行详情`} onClick={() => onSelectRun(id)}><strong>{summary.target.displayName || modelLabel(model)}</strong><span>{summary.target.kind === 'a6api' ? `a6api · 渠道 #${summary.target.channelId ?? '—'}` : providerLabel(model)}</span></button></th>
          {renderChannelActions && <td className="mit-col-channel-actions">{renderChannelActions(model) ?? '—'}</td>}
          <td className="mit-col-phase"><CustomPhaseBadge phase={summary.phase} />{summary.error && <span className="mit-custom-row-error" title={summary.error.message}>{summary.error.message}</span>}</td>
          <td className="mit-col-req">{count(summary.usage.requestCount)}</td>
          <td className="mit-col-tokens"><span>{count(summary.usage.inputTokens)}</span><span className="mit-custom-cell-sub">{count(summary.usage.outputTokens)}</span></td>
          <td className="mit-col-metric">{millis(summary.metrics.ttftMs)}</td><td className="mit-col-metric">{decimal(summary.metrics.modelTokensPerSecond)}</td><td className="mit-col-metric">{decimal(summary.metrics.endToEndTokensPerSecond)}</td>
          <td className="mit-col-cache">{rate(summary.metrics.cacheRate)}</td>
          {withMarket && <td className="mit-col-price" title={marketTitle(market, '输入价')}>{marketPriceCell(market, 'input')}</td>}
          {withMarket && <td className="mit-col-price" title={marketTitle(market, '输出价')}>{marketPriceCell(market, 'output')}</td>}
          {withMarket && <td className="mit-col-price" title={marketTitle(market, '渠道近 24h 缓存率')}>{marketCacheCell(market)}</td>}
          <td className="mit-col-cost"><span>{cost(summary.usage.cost, summary.usage.currency)}</span><span className="mit-custom-cell-sub">{CUSTOM_BILLING_LABELS[summary.usage.billingState]}</span></td>
          <td className="mit-col-output mit-sticky-output" style={{ right: actionsWidth }}>{summary.output.state === 'ready' && summary.output.validation === 'valid' && onOpenOutput ? <button type="button" className="mit-custom-output-button" title={summary.output.relativePath ? `在 WebView 中查看 ${summary.output.relativePath}` : '在 WebView 中查看成果'} onClick={() => { onOpenOutput(id, 'webview', undefined, `${summary.target.kind === 'a6api' ? `a6api #${summary.target.channelId ?? ''}` : providerLabel(model)}-${summary.target.displayName || modelLabel(model)}`).catch(() => {}); }}>可查看<Icon name="chevron" size={12} /></button> : <span className={`mit-custom-output-state is-${summary.output.state}`}>{outputLabel(summary)}</span>}</td>
          <td className="mit-col-actions mit-sticky-actions"><div className="mit-custom-row-actions"><button type="button" className="mit-text-button" onClick={() => onSelectRun(id)}>详情<Icon name="chevron" size={12} /></button>{['failed', 'cancelled', 'interrupted'].includes(summary.phase) && <button type="button" className="mit-text-button" disabled={pendingRunIds?.includes(id)} title={summary.retries ? `原位从头重试（已重试 ${summary.retries} 次）；旧请求保留在账本中` : '原位从头重试：同一轮次、新会话与沙箱；旧请求保留在账本中'} onClick={() => onRetry(id)}>{pendingRunIds?.includes(id) ? '重试中…' : '重试'}</button>}</div></td>
        </tr>;})}</tbody>
      </table>
      {!visible.length && <Empty title={filter ? '没有匹配的模型' : resultOnly ? '还没有已结束的运行' : '等待运行摘要'}>{filter ? '调整筛选条件后查看。' : resultOnly ? '运行结束后会出现在这里。' : '摘要由 Host 返回，连接恢复后会继续更新。'}</Empty>}
    </div>
    <p className="mit-custom-monitor-note">模型吞吐仅计算生成时间；端到端吞吐包含工具和等待。缺失用量保持未知，费用可能延迟回填。{withMarket ? '输入价/输出价与渠道 24h 缓存率来自网页报价快照，不是实际消费。' : ''}</p>
  </section>;
}
