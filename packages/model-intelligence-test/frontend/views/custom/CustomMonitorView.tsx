import React from '../../runtime';
import type { Evaluation, Model, CustomRunSummary } from '../../types';
import { Empty, Icon } from '../../components/common';
import { modelLabel, providerLabel } from '../results/modelLabel';
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
}
export function CustomMonitorView({ record, rows, selectedRunId, resultOnly, filter, onFilter, onSelectRun, onRetry }: CustomMonitorViewProps) {
  const needle = filter.trim().toLowerCase();
  const visible = rows.filter(row => (!resultOnly || ended(row.summary.phase)) && (!needle || `${modelLabel(row.model)} ${providerLabel(row.model)} ${row.summary.target.displayName} ${row.summary.target.channelId ?? ''}`.toLowerCase().includes(needle)));
  const active = rows.filter(row => !ended(row.summary.phase)).length;
  const completed = rows.filter(row => row.summary.phase === 'completed').length;
  const knownRequests = rows.filter(row => observed(row.summary.usage.requestCount));
  const requestCount = knownRequests.reduce((sum, row) => sum + (row.summary.usage.requestCount ?? 0), 0);
  return <section className="mit-custom-monitor" aria-label="自定义测试实时监控">
    <div className="mit-custom-monitor-tools">
      <label className="mit-search mit-table-search"><Icon name="search" /><input aria-label="筛选自定义测试模型" placeholder="筛选模型、提供商或渠道…" value={filter} onChange={event => onFilter(event.currentTarget.value)} /></label>
      <span className="mit-muted">{completed}/{rows.length} 完成 · {active} 运行中 · {knownRequests.length ? `${count(requestCount)}${knownRequests.length < rows.length ? '+' : ''} 次请求` : '请求数待回填'}</span>
    </div>
    {resultOnly && <div className="mit-custom-result-note" role="status">已结束 {rows.filter(row => ended(row.summary.phase)).length} 个模型{active ? ` · ${active} 个仍在运行` : ''}</div>}
    <div className="mit-custom-table-scroll">
      <table className="mit-custom-table">
        <caption className="mit-custom-sr-only">{record.name} · 真实自定义测试。未知数据以破折号显示，费用依 Host 账单回填。</caption>
        <thead><tr><th scope="col">参测模型</th><th scope="col">状态</th><th scope="col">请求</th><th scope="col">输入 / 输出</th><th scope="col">TTFT</th><th scope="col" title="输出 Token ÷ 模型生成耗时">模型 tok/s</th><th scope="col" title="输出 Token ÷ 端到端执行耗时，含工具及等待">端到端 tok/s</th><th scope="col">缓存率</th><th scope="col">费用</th><th scope="col">成果</th><th scope="col">操作</th></tr></thead>
        <tbody>{visible.map(({ id, model, summary }) => <tr key={id} className={selectedRunId === id ? 'is-selected' : ''} aria-selected={selectedRunId === id}>
          <th scope="row"><button type="button" className="mit-custom-model-button" aria-label={`查看 ${modelLabel(model)} 的执行详情`} onClick={() => onSelectRun(id)}><strong>{summary.target.displayName || modelLabel(model)}</strong><span>{summary.target.kind === 'a6api' ? `a6api · 渠道 #${summary.target.channelId ?? '—'}` : providerLabel(model)}</span></button></th>
          <td><CustomPhaseBadge phase={summary.phase} />{summary.error && <span className="mit-custom-row-error" title={summary.error.message}>{summary.error.message}</span>}</td>
          <td>{count(summary.usage.requestCount)}</td>
          <td><span>{count(summary.usage.inputTokens)}</span><span className="mit-custom-cell-sub">{count(summary.usage.outputTokens)}</span></td>
          <td>{millis(summary.metrics.ttftMs)}</td><td>{decimal(summary.metrics.modelTokensPerSecond)}</td><td>{decimal(summary.metrics.endToEndTokensPerSecond)}</td><td>{rate(summary.metrics.cacheRate)}</td>
          <td><span>{cost(summary.usage.cost, summary.usage.currency)}</span><span className="mit-custom-cell-sub">{CUSTOM_BILLING_LABELS[summary.usage.billingState]}</span></td>
          <td><span className={`mit-custom-output-state is-${summary.output.state}`}>{outputLabel(summary)}</span></td>
          <td><div className="mit-custom-row-actions"><button type="button" className="mit-text-button" onClick={() => onSelectRun(id)}>详情<Icon name="chevron" size={12} /></button>{['failed', 'cancelled', 'interrupted'].includes(summary.phase) && <button type="button" className="mit-text-button" onClick={() => onRetry(id)}>重试</button>}</div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <Empty title={filter ? '没有匹配的模型' : resultOnly ? '还没有已结束的运行' : '等待运行摘要'}>{filter ? '调整筛选条件后查看。' : resultOnly ? '运行结束后会出现在这里。' : '摘要由 Host 返回，连接恢复后会继续更新。'}</Empty>}
    </div>
    <p className="mit-custom-monitor-note">模型吞吐仅计算生成时间；端到端吞吐包含工具和等待。缺失用量保持未知，费用可能延迟回填。</p>
  </section>;
}
