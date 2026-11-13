import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Icon } from '../../components/common';

export function FeatureHub({ store }: { store: Workbench }) {
  const records=useStore(store.evaluations,state => state.records);
  return <div className="mit-feature-hub">
    <div className="mit-feature-head">
      <p className="mit-kicker">FEATURES</p>
      <h1>功能中心</h1>
      <p className="mit-muted">集中入口：真实模型指纹、任务评测，以及外部中转站来源适配。</p>
    </div>
    <div className="mit-feature-grid">
      <button type="button" className="mit-feature-card" onClick={() => store.actions.openDraft()}>
        <span className="mit-feature-index">01</span>
        <strong>模型智能测试</strong>
        <span className="mit-muted">lm-detector 真实数字指纹，或自定义 Agent 任务评测。全局 {records.length} 条记录。</span>
        <span className="mit-feature-action">打开工作台 <Icon name="chevron" size={12} /></span>
      </button>
      <button type="button" className="mit-feature-card" onClick={() => store.actions.openFeature('relay')}>
        <span className="mit-feature-index">02</span>
        <strong>中转站来源适配</strong>
        <span className="mit-muted">读取中转站公开渠道目录，按厂商、模型、成功率与价格筛选数万条渠道挂载。</span>
        <span className="mit-feature-action">进入来源适配 <Icon name="chevron" size={12} /></span>
      </button>
    </div>
  </div>;
}
