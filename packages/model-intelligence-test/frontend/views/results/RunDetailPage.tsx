import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Empty,Icon } from '../../components/common';
import { RunDetail } from './RunDetail';
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
        <button type="button" className="mit-text-button mit-tabular" onClick={back}>测试轮次 #{attempt.number}
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
          {provider} · {record.a6api? 'a6api 专项 · Host 直连采样':run.model.relay? `${run.model.relay.api} 接口 · 历史渠道记录`:run.model.id}
          {attempt? ` · 测试轮次 #${attempt.number}`:''}
        </p>
      </div>
      <button type="button" className="mit-text-button" onClick={back}>返回模型列表
      </button>
    </header>
    {attempt?.status==='interrupted'&&<p className="mit-attempt-note" role="note">运行时重启，测试轮次已中断。</p>}
    {record.a6api&&<p className="mit-attempt-note" role="status">
      {run.slotTokenId? `测试令牌 #${run.slotTokenId}`:'等待槽位分配'}
      {run.callProvider? ` · DSH 提供商 ${run.callProvider}`:''}
      {run.routing? ` · ${{'waiting-page':'等待原账号网页连接','pinning':'固定渠道并确认','sampling':'三条挑战采样中','restoring':'恢复原固定关系','restored':'固定关系已恢复','restore-failed':'恢复失败，本次测试已停止'}[run.routing]}`:''}
    </p>}
    <RunDetail store={store} id={runId} />
  </div>;
}
