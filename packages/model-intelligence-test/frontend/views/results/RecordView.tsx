import React,{ useStore } from '../../runtime';
import type { Evaluation,Workbench } from '../../types';
import { Empty,Icon,MetricGrid,StageBadge } from '../../components/common';
import { MenuSelect } from '../../components/MenuSelect';
import type { MenuOption } from '../../components/MenuSelect';
import { FingerprintConfigPanel } from './FingerprintConfigPanel';
import { MonitorTable } from '../monitor/MonitorTable';
import { endedRunIds,isEndedStage } from './runOrder';
import { ATTEMPT_STATUS_LABELS,currentAttempt,modelLabel,providerLabel } from './modelLabel';

const VIEW_OPTIONS: MenuOption<'progress'|'results'>[] = [
  { value: 'progress',label: '实时进度' },
  { value: 'results',label: '测试结果' },
];

function ResultCard({ store,id }: {
  store: Workbench;
  id: string;
}) {
  const run=useStore(store.evaluations,state => state.runs[id]);
  if(!run)
    return null;
  const best=run.candidates.reduce<{
    name: string;
    score: number;
  }|undefined>((a,b) => !a||b.score>a.score? b:a,undefined);
  return <article className="mit-result-card">
    <div className="mit-label-row">
      <strong>
        {modelLabel(run.model)}
      </strong>
      <StageBadge stage={run.stage} />
    </div>
    <p className="mit-muted">
      {providerLabel(run.model)}
    </p>
    <MetricGrid metrics={run.metrics} />
    {best&&<div className="mit-result-match">
      <span className="mit-muted">最高模拟匹配 · Mock
      </span>
      <strong>
        {best.name}
      </strong>
      <span>
        RAW {best.score.toFixed(4)}
      </span>
    </div>}
    {run.error&&<p className="mit-error">
      {run.error.message}
    </p>}
    <button type="button" className="mit-button" onClick={() => store.actions.navigate({ runId: id,artifact: Boolean(run.artifact) })}>
      {run.artifact? '查看执行详情与成果':'查看完整详情'}
      <Icon name="chevron" size={14} />
    </button>
  </article>;
}
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
      <span aria-current="page" className="mit-tabular">请求 #{attempt.number}</span>
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
  const custom=record.kind==='custom';
  return <div className="mit-attempt-bar">
    <span className="mit-attempt-label">请求</span>
    <div className="mit-attempt-chips" role="tablist" aria-label="请求记录">
      {attempts.map(attempt => {
        const active=attempt.id===selected?.id;
        const summary=attempt.summary;
        return <button key={attempt.id} type="button" role="tab" aria-selected={active} className={`mit-attempt-chip is-${attempt.status}${active? ' is-active':''}`} title={attempt.error??`请求 #${attempt.number} · ${ATTEMPT_STATUS_LABELS[attempt.status]}`} onClick={() => store.actions.selectAttempt(record.id,attempt.id)}>
          <strong className="mit-tabular">#{attempt.number}</strong>
          <span className="mit-attempt-status">{ATTEMPT_STATUS_LABELS[attempt.status]}</span>
          {summary&&<small className="mit-tabular">{summary.ended}/{summary.total}{summary.failed? ` · ${summary.failed} 失败`:''}</small>}
        </button>;
      })}
      {!attempts.length&&<span className="mit-muted">暂无请求</span>}
    </div>
    <div className="mit-attempt-actions">
      {busy&&!custom&&<span className="mit-muted">将排队，在当前请求结束后开始</span>}
      <button type="button" className="mit-button" disabled={custom} title={custom? '自定义 Mock 测试不支持再次请求':'使用相同模型集合再次请求'} onClick={() => store.actions.rerunRecord(record.id)}>
        <Icon name="refresh" size={14} />再次请求
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
      else if(stage==='failed'||stage==='timeout'||stage==='cancelled')
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
function CustomResults({ store,record }: {
  store: Workbench;
  record: Evaluation;
}) {
  const rowIds=useStore(store.evaluations,state => endedRunIds(record.runIds,state.runs).join('\n'));
  const activeCount=useStore(store.evaluations,state => record.runIds.filter(id => {
    const run=state.runs[id];
    return run&&!isEndedStage(run.stage);
  }).length);
  const ids=rowIds? rowIds.split('\n'):[];
  return <>
    <div className="mit-result-note">
      <strong>测试结果</strong>
      <span className="mit-muted">仅显示已结束的
        {ids.length} 个模型
        {activeCount? ` · ${activeCount} 个仍在运行`:''}
      </span>
    </div>
    {ids.length? <div className="mit-results-grid">
      {ids.map(runId => <ResultCard key={runId} store={store} id={runId} />)}
    </div>:<Empty title="还没有可展示的结果">测试仍在运行，结束后会出现在这里。
    </Empty>}
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
          <h2>
            {record.name}
          </h2>
          <p className="mit-muted">
            {record.kind==='fingerprint'? '指纹测试':'自定义 Agent 测试'} ·
            {new Date(record.createdAt).toLocaleString('zh-CN')} ·
            {record.runIds.length} 个模型
          </p>
        </div>
        <span className="mit-badge">{record.kind==='fingerprint'? '真实指纹':'MOCK'}</span>
      </div>
      <Breadcrumb record={record} />
      <AttemptBar store={store} record={record} />
      {currentAttempt(record.attempts??[],record.attemptId)?.status==='interrupted'&&<p className="mit-attempt-note" role="note">运行时重启，请求已中断。</p>}
      <RecordSummary store={store} record={record} />
      {record.kind==='fingerprint'&&<div className="mit-reference-meta">
        <dl>
          <div><dt>任务状态</dt><dd>{record.fingerprint? ({ starting: '准备参考库与挑战',running: '真实采样中',done: '任务已结束',cancelled: '已取消',failed: '任务失败' }[record.fingerprint.status]):'指纹元数据不可用'}</dd></div>
          <div><dt>参考库版本</dt><dd>{record.fingerprint?.reference?.builtAt||'尚未取得'}</dd></div>
          <div><dt>分析 SDK</dt><dd>{record.fingerprint?.reference?.sdk||'等待加载 lmfpd-sdk'}</dd></div>
          <div><dt>共享挑战</dt><dd>{record.fingerprint?.challenges.length??0}/3 条 · 每模型 3 次真实请求</dd></div>
        </dl>
        {record.fingerprint?.error&&<div className="mit-error-box" role="alert"><strong>任务或连接信息</strong><p>{record.fingerprint.error}</p></div>}
      </div>}
      <div className="mit-record-toolbar">
        <div className="mit-record-controls">
          <MenuSelect label="查看" value={mode} options={VIEW_OPTIONS} open={viewOpen} onToggle={store.actions.toggleView} onClose={store.actions.toggleView} onChange={value => store.actions.navigate({ mode: value })} />
          {record.kind==='fingerprint'&&<FingerprintConfigPanel store={store} record={record} />}
        </div>
        <span className="mit-muted">{record.kind==='fingerprint'? '真实请求可能产生费用 · 概率仅限参考库闭集，不作身份或质量判定':'Mock 自定义任务 · 输出、用量、费用与成果均为模拟，不代表实际模型性能'}</span>
      </div>
    </header>
    <div className="mit-record-content">
      <div className="mit-record-main">
        {mode==='progress'? <MonitorTable store={store} record={record} />:record.kind==='fingerprint'? <MonitorTable store={store} record={record} results />:<CustomResults store={store} record={record} />}
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
