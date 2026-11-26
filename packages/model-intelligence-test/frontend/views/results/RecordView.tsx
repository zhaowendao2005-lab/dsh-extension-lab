import React,{ useStore } from '../../runtime';
import type { CustomRunDetailEntry,Evaluation,Workbench } from '../../types';
import { Empty,Icon } from '../../components/common';
import { MenuSelect } from '../../components/MenuSelect';
import type { MenuOption } from '../../components/MenuSelect';
import { FingerprintConfigPanel } from './FingerprintConfigPanel';
import { MonitorTable } from '../monitor/MonitorTable';
import {LedgerOverview} from '../a6/LedgerOverview';
import {OperationKeyPicker} from '../a6/OperationKeyPicker';
import {ResultTarget} from '../a6/ResultTarget';
import { ATTEMPT_STATUS_LABELS,currentAttempt } from './modelLabel';
import { CustomMonitorView, type CustomMonitorRow } from '../custom/CustomMonitorView';
import { CustomOutputPreview } from '../custom/CustomOutputPreview';

const EMPTY_IDS: string[] = [];
const pendingCache=new Map<string,string[]>();
/** Run ids of one attempt with an in-flight row action; the cached array keeps useStore snapshots stable. */
function pendingOf(details: Record<string,CustomRunDetailEntry>,attemptId: string): string[] {
  const prefix=`${attemptId}:`;
  const ids=Object.entries(details).filter(([key,entry]) => key.startsWith(prefix)&&entry.action).map(([key]) => key.slice(prefix.length));
  const previous=pendingCache.get(attemptId);
  if(previous&&previous.length===ids.length&&previous.every((id,index) => id===ids[index])) return previous;
  const next=ids.length? ids:EMPTY_IDS;
  pendingCache.set(attemptId,next);
  return next;
}
const VIEW_OPTIONS: MenuOption<'progress'|'results'>[] = [
  { value: 'progress',label: '实时进度' },
  { value: 'results',label: '测试结果' },
];

function Breadcrumb({ record }: {
  record: Evaluation;
}) {
  const attempt=currentAttempt(record.attempts??[],record.attemptId);
  return <nav className="mit-breadcrumb" aria-label="测试详情路径">
    <span>测试记录
    </span>
    <Icon name="chevron" size={12} />
    <span aria-current={attempt? undefined:'page'}>
      {record.name}
    </span>
    {attempt&&<>
      <Icon name="chevron" size={12} />
      <span aria-current="page" className="mit-tabular">测试轮次 #{attempt.number}</span>
    </>}
  </nav>;
}
function AttemptBar({ store,record }: {
  store: Workbench;
  record: Evaluation;
}) {
  const attempts=record.attempts??[];
  const selected=currentAttempt(attempts,record.attemptId);
  const busy=attempts.some(attempt => attempt.status==='running'||attempt.status==='queued');
  return <div className="mit-attempt-bar">
    <span className="mit-attempt-label">测试轮次</span>
    <div className="mit-attempt-chips" role="tablist" aria-label="测试轮次记录">
      {attempts.map(attempt => {
        const active=attempt.id===selected?.id;
        const summary=attempt.summary;
        return <button key={attempt.id} type="button" role="tab" aria-selected={active} className={`mit-attempt-chip is-${attempt.status}${active? ' is-active':''}`} title={attempt.error??`测试轮次 #${attempt.number} · ${ATTEMPT_STATUS_LABELS[attempt.status]}`} onClick={() => store.actions.selectAttempt(record.id,attempt.id)}>
          <strong className="mit-tabular">#{attempt.number}</strong>
          <span className="mit-attempt-status">{ATTEMPT_STATUS_LABELS[attempt.status]}</span>
          {summary&&<small className="mit-tabular">{summary.ended}/{summary.total}{summary.failed? ` · ${summary.failed} 失败`:''}</small>}
        </button>;
      })}
      {!attempts.length&&<span className="mit-muted">暂无测试轮次</span>}
    </div>
    <div className="mit-attempt-actions">
      {busy&&<span className="mit-muted">将排队，在当前测试轮次结束后开始</span>}
      <button type="button" className="mit-button" disabled={busy} title="使用相同模型集合再次执行" onClick={() => store.actions.rerunRecord(record.id)}>
        <Icon name="refresh" size={14} />再次测试
      </button>
    </div>
  </div>;
}
function RecordSummary({ store,record }: {
  store: Workbench;
  record: Evaluation;
}) {
  const counts=useStore(store.evaluations,state => {
    let done=0,failed=0,active=0; for(const id of record.runIds) {
      const stage=state.runs[id]?.stage;
      if(stage==='completed')
        done++;
      else if(stage==='failed'||stage==='timeout'||stage==='cancelled'||stage==='interrupted')
        failed++;
      else
        active++;
    } return `${done}:${failed}:${active}`;
  });
  const [done,failed,active]=counts.split(':').map(Number);
  return <div className="mit-record-summary">
    <progress value={done+failed} max={record.runIds.length||1} aria-label="整体测试完成进度" />
    <span>
      {done+failed}/
      {record.runIds.length} 已结束
    </span>
    <span className="mit-muted">
      {done} {record.kind==='fingerprint'? '完成执行':'成功'} ·
      {active} 运行中
      {failed? ` · ${failed} 未完成`:''}
    </span>
    {active>0&&<button type="button" className="mit-text-button mit-danger-text" onClick={() => store.actions.cancelRecord(record.id)}>
      <Icon name="stop" size={14} />取消测试
    </button>}
  </div>;
}
function CustomResults({ store,record,resultOnly }: {
  store: Workbench;
  record: Evaluation;
  resultOnly: boolean;
}) {
  const filter=useStore(store.presentation,state => state.filter);
  const widths=useStore(store.presentation,state => state.widths);
  const rows=useStore(store.evaluations,state => record.runIds.flatMap(id => {
    const run=state.runs[id]; return run?.custom? [{id,model:run.model,summary:run.custom}]:[];
  }));
  const pendingRunIds=useStore(store.custom,state => record.attemptId? pendingOf(state.details,record.attemptId):EMPTY_IDS);
  // Selecting a row only records navigation; Panel renders the run as its own content sub-page.
  return <>
    <CustomMonitorView record={record} rows={rows} resultOnly={resultOnly} filter={filter} widths={widths} onResize={store.actions.resizeColumn} onFilter={store.actions.setFilter} onSelectRun={runId => store.actions.navigate({runId})} onRetry={runId => store.actions.retryFailedSample(record.id,runId)} pendingRunIds={pendingRunIds} onOpenOutput={store.actions.openCustomOutput} renderChannelActions={record.a6api ? model => model.a6api ? <ResultTarget store={store} record={record} model={model} /> : null : undefined} />
    <CustomOutputPreview store={store} />
  </>;
}
export function RecordView({ store,id }: {
  store: Workbench;
  id: string;
}) {
  const record=useStore(store.evaluations,state => state.records.find(item => item.id===id));
  const mode=useStore(store.workbench,state => state.navigation[state.activeTab]?.mode??'progress');
  const viewOpen=useStore(store.presentation,state => state.viewOpen);
  if(!record)
    return <Empty title="测试记录不存在">记录可能已删除，请创建新的测试。
    </Empty>;
  return <div className="mit-record">
    <header className="mit-record-heading">
      <div className="mit-title-row">
        <div>
          <h2 className="mit-record-title" title="双击重命名" onDoubleClick={() => store.actions.renameRecord(record.id)}>
            {record.name}
            <button type="button" className="mit-icon-button mit-record-rename" aria-label={`重命名测试 ${record.name}`} title="重命名测试" onClick={() => store.actions.renameRecord(record.id)}>
              <Icon name="edit" size={14} />
            </button>
          </h2>
          <p className="mit-muted">
            {record.kind==='fingerprint'? record.a6api? 'a6api 专项指纹测试':'指纹测试':record.a6api? 'a6api 混合自定义测试':'自定义 Agent 测试'} ·
            {new Date(record.createdAt).toLocaleString('zh-CN')} ·
            {record.runIds.length} 个模型
          </p>
        </div>
        <span className="mit-badge">{record.kind==='fingerprint'? record.a6api? 'a6api 专项':'真实指纹':record.a6api? 'a6api 自定义':'Host 自定义任务'}</span>
      </div>
      <Breadcrumb record={record} />
      <AttemptBar store={store} record={record} />
      {currentAttempt(record.attempts??[],record.attemptId)?.status==='interrupted'&&<p className="mit-attempt-note" role="note">运行时重启，测试轮次已中断。</p>}
      <RecordSummary store={store} record={record} />
      {record.kind==='fingerprint'&&<div className="mit-reference-meta">
        <dl>
          <div><dt>任务状态</dt><dd>{record.fingerprint? ({ starting: '准备参考库与挑战',running: '真实采样中',done: '任务已结束',cancelled: '已取消',failed: '任务失败' }[record.fingerprint.status]):'指纹元数据不可用'}</dd></div>
          <div><dt>参考库版本</dt><dd>{record.fingerprint?.reference?.builtAt||'尚未取得'}</dd></div>
          <div><dt>分析 SDK</dt><dd>{record.fingerprint?.reference?.sdk||'等待加载 lmfpd-sdk'}</dd></div>
          <div><dt>共享挑战</dt><dd>{record.fingerprint?.challenges.length??0}/3 条 · 每模型 3 条并行挑战{record.a6api? '（实际请求数见台账）':''}</dd></div>
        </dl>
        {record.fingerprint?.error&&<div className="mit-error-box" role="alert"><strong>任务或连接信息</strong><p>{record.fingerprint.error}</p></div>}
      </div>}
      {record.a6api&&<><LedgerOverview store={store} record={record} /><OperationKeyPicker store={store} record={record} /></>}
      <div className="mit-record-toolbar">
        <div className="mit-record-controls">
          <MenuSelect label="查看" value={mode} options={VIEW_OPTIONS} open={viewOpen} onToggle={store.actions.toggleView} onClose={store.actions.toggleView} onChange={value => store.actions.navigate({ mode: value })} />
          {record.kind==='fingerprint'&&<FingerprintConfigPanel store={store} record={record} />}
        </div>
        <span className="mit-muted">{record.kind==='fingerprint'? '真实请求可能产生费用 · 概率仅限参考库闭集，不作身份或质量判定':'Host 独立 Agent 会话 · 受限文件工具（非 OS 容器） · 网络、外部工作区与凭据默认不可用 · 费用以账单回填为准'}</span>
      </div>
    </header>
    <div className="mit-record-content">
      <div className="mit-record-main">
        {record.kind==='custom'? <CustomResults store={store} record={record} resultOnly={mode==='results'} />:<MonitorTable store={store} record={record} results={mode==='results'} />}
        {record.kind==='custom'&&<details className="mit-prompt-snapshot">
          <summary>查看本次任务提示词与固定约束快照
          </summary>
          <pre className="mit-output">
            {record.prompt}
          </pre>
          <small className="mit-muted">固定约束版本：
            {record.footerVersion}
          </small>
        </details>}
      </div>
    </div>
  </div>;
}
