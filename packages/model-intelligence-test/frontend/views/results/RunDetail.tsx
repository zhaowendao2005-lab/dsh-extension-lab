import React,{ useEffect,useRef,useStore } from '../../runtime';
import type { Round,Step,Workbench } from '../../types';
import { Empty,Icon,MetricGrid,StageBadge } from '../../components/common';
import { ErrorStack,FingerprintDetail } from './FingerprintDetail';
function StepRow({ store,step }: {
  store: Workbench;
  step: Step;
}) {
  const expanded=useStore(store.presentation,state => state.expanded[step.id]??false);
  return <li>
    <button type="button" className="mit-step-heading" aria-expanded={expanded} aria-controls={`${store.sessionId}-mit-step-${step.id}`} onClick={() => store.actions.toggleRound(step.id,expanded)}>
      <span className={expanded? 'mit-chevron is-open':'mit-chevron'}>
        <Icon name="chevron" size={12} />
      </span>
      <strong>
        {step.title}
      </strong>
      <StageBadge stage={step.state} />
    </button>
    {expanded&&<div id={`${store.sessionId}-mit-step-${step.id}`}>
      <MetricGrid metrics={step.metrics} />
    </div>}
  </li>;
}
function RoundCard({ store,round,latest }: {
  store: Workbench;
  round: Round;
  latest: boolean;
}) {
  const expanded=useStore(store.presentation,state => state.expanded[round.id]??(state.followLatest&&latest));
  return <section className="mit-round">
    <button type="button" className="mit-round-heading" aria-expanded={expanded} aria-controls={`${store.sessionId}-mit-round-${round.id}`} onClick={() => store.actions.toggleRound(round.id,expanded)}>
      <span className={expanded? 'mit-chevron is-open':'mit-chevron'}>
        <Icon name="chevron" size={14} />
      </span>
      <strong>第
        {round.number} 轮
      </strong>
      <StageBadge stage={round.state} />
      {latest&&<span className="mit-muted">最新
      </span>}
    </button>
    {expanded&&<div className="mit-round-body" id={`${store.sessionId}-mit-round-${round.id}`}>
      <MetricGrid metrics={round.metrics} />
      <ol className="mit-steps">
        {round.steps.map(step => <StepRow key={step.id} store={store} step={step} />)}
      </ol>
    </div>}
  </section>;
}
function Artifact({ artifact }: {
  artifact: {
    type: 'svg'|'html';
    source: string;
    name: string;
  };
}) {
  // Only internally generated Mock artifacts reach this view. Inline drawing scripts
  // run in an opaque-origin sandbox; host access and all network IO remain blocked.
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const document=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;min-height:100%;font-family:system-ui}svg{max-width:100%;height:auto}a,form,input,button{pointer-events:none}</style></head><body>${artifact.source}</body></html>`;
  return <section className="mit-artifact">
    <div className="mit-label-row">
      <strong>
        {artifact.name}
      </strong>
      <span className="mit-badge">
        {artifact.type.toUpperCase()} · 模拟成果
      </span>
    </div>
    <p className="mit-muted">仅内置 Mock · 允许脚本绘制，网络与宿主隔离
    </p>
    <iframe title={`模拟成果预览：${artifact.name}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} />
    <details>
      <summary>查看成果源码
      </summary>
      <pre className="mit-output">
        {artifact.source}
      </pre>
    </details>
  </section>;
}
export function RunDetail({ store,id,custom }: {
  store: Workbench;
  id: string;
  custom: boolean;
}) {
  const run=useStore(store.evaluations,state => state.runs[id]);
  const navigation=useStore(store.workbench,state => state.navigation[state.activeTab]);
  const followLatest=useStore(store.presentation,state => state.followLatest);
  const output=useRef<HTMLPreElement>(null);
  useEffect(() => {
    if(followLatest&&output.current)
      output.current.scrollTop=output.current.scrollHeight;
  },[run?.output,followLatest]);
  if(!run)
    return <Empty title="运行记录不可用" />;
  return <section className="mit-run-detail">
    <div className="mit-label-row">
      <StageBadge stage={run.stage} />
      <label className="mit-checkbox">
        <input type="checkbox" checked={followLatest} onChange={store.actions.toggleFollow} />跟随最新进度
      </label>
    </div>
    {run.error&&<div className="mit-error-box" role="alert">
      <strong>运行未完成 ·
        <StageBadge stage={run.error.stage} />
      </strong>
      <p>
        {run.error.message}
      </p>
      <ErrorStack detail={run.error.detail} />
    </div>}
    {!custom? <FingerprintDetail store={store} run={run} />:<>
      <p className="mit-info mit-custom-disclaimer">Mock 自定义任务 · 执行过程、输出、用量、费用和成果均为模拟数据，不会发送真实模型请求。</p>
      <MetricGrid metrics={run.metrics} />
      <div className="mit-detail-section-title">
        <h4>Agent 执行过程 · Mock</h4>
        <span className="mit-muted">{run.rounds.length} 轮</span>
      </div>
      {run.rounds.length? run.rounds.map(round => <RoundCard key={round.id} store={store} round={round} latest={round.number===run.currentRound} />):<p className="mit-muted">等待首轮模拟执行…</p>}
      <div className="mit-detail-section-title">
        <h4>模型输出 · Mock</h4>
        <span className="mit-muted">纯文本 · 模拟流式输出</span>
      </div>
      <pre className="mit-output" ref={output} tabIndex={0}>{run.output||'等待模拟输出…'}</pre>
      {run.artifact&&<>
        <button type="button" className="mit-button" aria-expanded={Boolean(navigation?.artifact)} onClick={() => store.actions.navigate({ artifact: !navigation?.artifact })}>
          {navigation?.artifact? '收起成果预览':'查看模拟成果'}
        </button>
        {navigation?.artifact&&<Artifact artifact={run.artifact} />}
      </>}
    </>}
  </section>;
}
