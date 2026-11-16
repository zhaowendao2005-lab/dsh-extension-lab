import React,{useStore} from '../../runtime';
import type {A6Execution,Evaluation,Run,Workbench} from '../../types';
import {ledgerKey} from '../../stores/a6insights.stores';

const count = (value: number|null|undefined): string => typeof value === 'number' ? value.toLocaleString('zh-CN') : '未知';
const cost = (value: number|null|undefined): string => typeof value === 'number' ? `¥${value.toLocaleString('zh-CN',{maximumFractionDigits:6})}` : '未知';
const BILLING: Record<string,string> = {pending:'待对账',querying:'查询中',reconciled:'已确认',observed:'已关联',ambiguous:'存在歧义', 'not-found-yet':'暂未查到',deferred:'稍后重查',unattributed:'未能归属',unavailable:'无法查询'};
const USAGE: Record<string,string> = {missing:'未知',stream:'流用量',billing:'账单用量'};
const EXECUTION: Record<string,string> = {dispatching:'已发出', 'response-received':'已收到响应',unknown:'状态未知',ended:'已结束',failed:'失败',timeout:'超时',cancelled:'已取消'};
function related(execution: A6Execution,run: Run): boolean { return execution.model === run.model.id && execution.intendedChannelId === run.model.a6api?.channelId; }
export function ActualCost({store,record,run}: {store:Workbench;record:Evaluation;run:Run}) {
  const scope = useStore(store.a6Insights,state => state.scopes[record.id] ?? 'attempt');
  const entry = useStore(store.a6Insights,state => state.ledgers[ledgerKey(record.id,scope === 'record' ? undefined : record.attemptId)]);
  const executions = entry?.view?.executions.filter(execution => related(execution,run)) ?? [];
  const known = executions.filter(execution => typeof execution.costCny === 'number');
  return <div className="mit-a6-market"><span className="mit-tabular">{known.length ? cost(known.reduce((sum,execution) => sum + (execution.costCny ?? 0),0)) : '未知'}</span><small className="mit-muted">{scope === 'record' ? '全记录' : '本轮'} · 有金额 {known.length}/{executions.length || '未知'} · 已结算 {executions.filter(execution => execution.billingState === 'reconciled').length}</small>{entry?.error && <small className="mit-error" title={entry.error}>对账读取失败</small>}</div>;
}
export function LedgerOverview({store,record}: {store:Workbench;record:Evaluation}) {
  const scope = useStore(store.a6Insights,state => state.scopes[record.id] ?? 'attempt');
  const entry = useStore(store.a6Insights,state => state.ledgers[ledgerKey(record.id,scope === 'record' ? undefined : record.attemptId)]);
  const config = useStore(store.a6,state => state.config);
  const summary = entry?.view?.summary;
  const executions = entry?.view?.executions ?? [];
  const historical = config?.userId !== record.a6api?.accountId;
  return <section className="mit-a6-ledger" aria-label="请求与账单概览" aria-busy={Boolean(entry?.loading)}>
    <div className="mit-label-row"><strong>请求与账单概览</strong><div className="mit-a6-actions"><label>统计范围 <select value={scope} onChange={event => store.actions.setA6LedgerScope(record.id,event.currentTarget.value as 'attempt'|'record')}><option value="attempt">当前测试轮次</option><option value="record">整条记录（全部轮次）</option></select></label><button type="button" className="mit-button" disabled={entry?.loading} onClick={() => store.actions.refreshA6Ledger(record.id)}>{entry?.loading ? '读取中…' : '刷新账单'}</button></div></div>
    <dl className="mit-a6-ledger-metrics">
      <div><dt>实际 API 请求</dt><dd>{count(summary?.requestCount)}</dd></div><div><dt>已知实际消费（CNY）</dt><dd>{cost(summary?.knownCostCny)}</dd></div><div><dt>完整结算 / 待对账</dt><dd>{summary ? `${summary.coverage.billingCompleteCount} / ${summary.pendingCount}` : '未知'}</dd></div><div><dt>已知输入 / 输出 Token</dt><dd>{count(summary?.inputTokens)} / {count(summary?.outputTokens)}</dd></div>
    </dl>
    <p className="mit-muted">{summary ? `覆盖：request-id ${summary.coverage.requestIdCount}/${summary.requestCount ?? '未知'} · 完整账单 ${summary.coverage.billingCompleteCount}/${summary.requestCount ?? '未知'} · 有用量 ${summary.coverage.usageCount}/${summary.requestCount ?? '未知'} · 输入/输出覆盖 ${summary.coverage.inputCount ?? '未知'}/${summary.coverage.outputCount ?? '未知'} · 未归属 ${summary.coverage.unattributedCount} · 歧义 ${summary.coverage.ambiguousCount ?? '未知'}` : '正在读取 Host 请求台账；未知请求数和费用不会按样本数估算。'}</p>
    {summary && <p className="mit-muted">{summary.requestCount === null ? '历史记录缺少 execution 台账，实际请求数、用量与消费未知。' : summary.coverage.legacy ? '记录包含缺少台账的旧轮次；旧轮次请求数、用量与消费未知，以上仅为有台账部分的合计。' : '只累计已关联账单的金额；有金额不代表已完整结算。覆盖不完整时为部分合计，后续对账可能更新。'} 失败重试产生新的 API 请求；测试轮次与 API 请求分开计数。</p>}
    {historical && <p className="mit-attempt-note" role="note">此记录属于账号 {record.a6api?.accountId}；当前账号不同，仅显示已存账单，待对账项目延后查询。</p>}
    {!config?.configured && <p className="mit-error" role="alert">当前未配置可用账号，无法查询新账单；已存台账仍可查看。</p>}
    {entry?.error && <p className="mit-error" role="alert">账单暂未更新：{entry.error}。可点击“刷新账单”重试。</p>}
    {!!executions.length && <details><summary>查看 {executions.length} 次 API 请求与对账状态</summary><div className="mit-table-scroll"><table className="mit-a6-executions"><thead><tr><th>模型 / 渠道</th><th>Request ID</th><th>请求 / 对账</th><th>输入 / 输出 Token</th><th>实际消费 CNY</th></tr></thead><tbody>{executions.map((execution,index) => <tr key={execution.id ?? `${execution.requestId ?? 'request'}-${index}`}><td>{execution.model}<small>渠道 #{execution.intendedChannelId ?? '未知'}{execution.channelMismatch ? ' · 实际渠道不符' : ''}</small></td><td>{execution.requestId || '未知'}</td><td>{EXECUTION[execution.state] ?? execution.state}<small>{BILLING[execution.billingState ?? ''] ?? '未知'} · {USAGE[execution.usageState ?? ''] ?? '未知'}{execution.accountState === 'historical' ? ' · 历史账号' : ''}</small></td><td>{count(execution.inputTokens)} / {count(execution.outputTokens)}</td><td>{cost(execution.costCny)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
