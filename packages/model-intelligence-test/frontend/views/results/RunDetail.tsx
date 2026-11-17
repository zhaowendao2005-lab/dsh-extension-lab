import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Empty,StageBadge } from '../../components/common';
import { ErrorStack,FingerprintDetail } from './FingerprintDetail';

export function RunDetail({ store,id }: {
  store: Workbench;
  id: string;
}) {
  const run=useStore(store.evaluations,state => state.runs[id]);
  const followLatest=useStore(store.presentation,state => state.followLatest);
  if(!run)
    return <Empty title="运行记录不可用" />;
  if(!run.fingerprint)
    return <Empty title="自定义任务详情在记录监控面板中查看">会话事件、文件和账单由 Host 详情提供。</Empty>;
  return <section className="mit-run-detail">
    <div className="mit-label-row">
      <StageBadge stage={run.stage} />
      <label className="mit-checkbox">
        <input type="checkbox" checked={followLatest} onChange={store.actions.toggleFollow} />跟随最新进度
      </label>
    </div>
    {run.error&&<div className="mit-error-box" role="alert">
      <strong>运行未完成 · <StageBadge stage={run.error.stage} /></strong>
      <p>{run.error.message}</p>
      <ErrorStack detail={run.error.detail} />
    </div>}
    <FingerprintDetail store={store} run={run} />
  </section>;
}
