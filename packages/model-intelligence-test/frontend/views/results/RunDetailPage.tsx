import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Empty,Icon } from '../../components/common';
import { RunDetail } from './RunDetail';

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
  return <div className="mit-detail-page">
    <nav className="mit-breadcrumb mit-detail-breadcrumb" aria-label="测试详情路径">
      <button type="button" className="mit-text-button" onClick={back}>测试记录
      </button>
      <Icon name="chevron" size={12} />
      <button type="button" className="mit-text-button" onClick={back}>
        {record.name}
      </button>
      <Icon name="chevron" size={12} />
      <span aria-current="page">
        {run.model.providerName} /
        {run.model.name}
      </span>
    </nav>
    <header className="mit-detail-page-heading">
      <div>
        <h2>
          {run.model.name}
        </h2>
        <p className="mit-muted">
          {run.model.providerName} ·
          {run.model.id}
        </p>
      </div>
      <button type="button" className="mit-text-button" onClick={back}>返回模型列表
      </button>
    </header>
    <RunDetail store={store} id={runId} custom={record.kind==='custom'} />
  </div>;
}
