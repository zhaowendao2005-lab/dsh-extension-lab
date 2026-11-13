import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Empty,Icon } from '../../components/common';
import { RunDetail } from './RunDetail';
import { TagEditor } from '../tags/TagEditor';
import { modelTarget,relayTarget } from '../../components/tags';
import { currentAttempt,modelLabel,providerLabel } from './modelLabel';

export function RunDetailPage({ store,recordId,runId }: {
  store: Workbench;
  recordId: string;
  runId: string;
}) {
  const record=useStore(store.evaluations,state => state.records.find(item => item.id===recordId));
  const run=useStore(store.evaluations,state => state.runs[runId]);
  const back=(): void => store.actions.navigate({ runId: undefined,artifact: false });
  if(!record)
    return <Empty title="测试记录不存在">记录可能已删除，请创建新的测试。
    </Empty>;
  if(!run)
    return <Empty title="运行记录不可用">该模型的运行记录已不存在。
    </Empty>;
  const attempt=currentAttempt(record.attempts??[],record.attemptId);
  const provider=providerLabel(run.model);
  const relay=run.model.relay;
  const tagTarget=relay? relayTarget(relay.siteId,relay.channelId,relay.model):modelTarget(run.model.provider,run.model.id);
  const closeModels=(run.fingerprint?.analysis?.candidates??[]).slice(0,10).map(candidate => candidate.displayName||candidate.model);
  const model=modelLabel(run.model);
  return <div className="mit-detail-page">
    <nav className="mit-breadcrumb mit-detail-breadcrumb" aria-label="测试详情路径">
      <button type="button" className="mit-text-button" onClick={back}>测试记录
      </button>
      <Icon name="chevron" size={12} />
      <button type="button" className="mit-text-button" onClick={back}>
        {record.name}
      </button>
      {attempt&&<>
        <Icon name="chevron" size={12} />
        <button type="button" className="mit-text-button mit-tabular" onClick={back}>请求 #{attempt.number}
        </button>
      </>}
      <Icon name="chevron" size={12} />
      <span aria-current="page">
        {provider}/{model}
      </span>
    </nav>
    <header className="mit-detail-page-heading">
      <div>
        <h2>
          {model}
        </h2>
        <p className="mit-muted">
          {provider} · {run.model.relay? `${run.model.relay.api} 接口 · 中转渠道`:run.model.id}
          {attempt? ` · 请求 #${attempt.number}`:''}
        </p>
        <TagEditor store={store} target={tagTarget} closeModels={closeModels} />
      </div>
      <button type="button" className="mit-text-button" onClick={back}>返回模型列表
      </button>
    </header>
    {attempt?.status==='interrupted'&&<p className="mit-attempt-note" role="note">运行时重启，请求已中断。</p>}
    <RunDetail store={store} id={runId} custom={record.kind==='custom'} />
  </div>;
}
