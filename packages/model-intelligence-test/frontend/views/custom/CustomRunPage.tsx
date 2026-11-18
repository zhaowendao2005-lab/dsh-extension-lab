import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Empty,Icon } from '../../components/common';
import { currentAttempt,modelLabel,providerLabel } from '../results/modelLabel';
import { CustomTaskView } from './CustomTaskView';
import { CustomOutputPreview } from './CustomOutputPreview';

const TERMINAL=['completed','failed','cancelled','interrupted'];
const CONTINUABLE=['failed','cancelled','interrupted'];

/** One custom model run as an independent sub-page of the active panel content. */
export function CustomRunPage({ store,recordId,runId }: {
  store: Workbench;
  recordId: string;
  runId: string;
}) {
  const record=useStore(store.evaluations,state => state.records.find(item => item.id===recordId));
  const run=useStore(store.evaluations,state => state.runs[runId]);
  const entry=useStore(store.custom,state => record?.attemptId? state.details[`${record.attemptId}:${runId}`]:undefined);
  const back=(): void => store.actions.navigate({ runId: undefined,artifact: false });
  if(!record)
    return <Empty title="测试记录不存在">记录可能已删除，请创建新的测试。</Empty>;
  if(!run?.custom||!record.attemptId)
    return <div className="mit-detail-page">
      <Empty title="运行记录不可用">该模型运行已不在当前测试轮次。</Empty>
      <button type="button" className="mit-text-button" onClick={back}>返回模型列表</button>
    </div>;
  const attempt=currentAttempt(record.attempts??[],record.attemptId);
  const summary=run.custom;
  const phase=summary.phase;
  return <div className="mit-detail-page mit-custom-run-page">
    <nav className="mit-breadcrumb mit-detail-breadcrumb" aria-label="测试详情路径">
      <button type="button" className="mit-text-button" onClick={back}>测试记录</button>
      <Icon name="chevron" size={12} />
      <button type="button" className="mit-text-button" onClick={back}>{record.name}</button>
      {attempt&&<>
        <Icon name="chevron" size={12} />
        <button type="button" className="mit-text-button mit-tabular" onClick={back}>测试轮次 #{attempt.number}</button>
      </>}
      <Icon name="chevron" size={12} />
      <span aria-current="page">{providerLabel(run.model)}/{modelLabel(run.model)}</span>
    </nav>
    <CustomTaskView model={run.model} summary={summary} detail={entry?.detail} loading={entry?.loading??true} error={entry?.error}
      activeTab={entry?.tab??'chat'} file={entry?.file} fileLoading={Boolean(entry?.fileLoading)}
      canRetry={CONTINUABLE.includes(phase)} canCancel={!TERMINAL.includes(phase)}
      canContinue={CONTINUABLE.includes(phase)&&Boolean(summary.sessionId)} continuing={Boolean(entry?.continuing)}
      onTabChange={tab => store.actions.setCustomDetailTab(runId,tab)}
      onReadFile={path => store.actions.readCustomFile(runId,path)}
      onOpenOutput={mode => store.actions.openCustomOutput(runId,mode)}
      onRetry={() => store.actions.retryFailedSample(record.id,runId)}
      onContinue={() => store.actions.continueCustomRun(runId)}
      onCancel={() => store.actions.cancelRecord(record.id)}
      onClose={back} />
    <CustomOutputPreview store={store} />
  </div>;
}
