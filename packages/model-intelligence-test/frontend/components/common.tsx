import React from '../runtime';
import type { ReactNode } from 'react';
import type { Metrics,Stage } from '../types';
import { STAGE_LABELS } from '../types';
export function Icon({ name,size=16 }: {
  name: 'plus'|'close'|'chevron'|'sidebar'|'search'|'settings'|'play'|'stop'|'trash'|'refresh'|'check';
  size?: number;
}) {
  const paths={ plus: 'M12 5v14M5 12h14',close: 'm6 6 12 12M6 18 18 6',chevron: 'm9 5 7 7-7 7',sidebar: 'M4 4h16v16H4zM9 4v16',search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',check: 'M20 6 9 17l-5-5',play: 'm8 5 11 7-11 7z',stop: 'M6 6h12v12H6z',trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-4l2 3M4 17l2 3a8 8 0 0 0 13-4' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}
export function StageBadge({ stage }: {
  stage: Stage;
}) {
  return <span className={`mit-status mit-status-${stage}`}>
    <span aria-hidden="true" className="mit-status-dot" />
    {STAGE_LABELS[stage]}
  </span>;
}
export function Empty({ title,children }: {
  title: string;
  children?: ReactNode;
}) {
  return <div className="mit-empty">
    <strong>
      {title}
    </strong>
    {children&&<div className="mit-muted">
      {children}
    </div>}
  </div>;
}
export function formatMetric(key: string,value: number|undefined) {
  if(value===undefined||!Number.isFinite(value))
    return '—';
  if(key==='cost')
    return `$${value.toFixed(4)}`;
  if(key==='ttft'||key==='elapsed')
    return `${(value/1000).toFixed(2)} s`;
  if(key==='e2e'||key==='generation')
    return `${value.toFixed(1)} tok/s`;
  return new Intl.NumberFormat('zh-CN',{ maximumFractionDigits: 0 }).format(value);
}
export function MetricGrid({ metrics,source='mock' }: {
  metrics: Metrics;
  source?: 'real'|'mock';
}) {
  const real=source==='real';
  const labels: Record<string,string>={ input: '输入 Token',output: '输出 Token',cache: '缓存 Token',ttft: real? '首可观测 Token（TTFT）':'首 Token 延迟',e2e: '端到端速率',generation: '生成速率',elapsed: '请求耗时',cost: real? '实际费用':'模拟费用（Mock）' };
  return <dl className="mit-metrics" aria-label={real? '真实请求指标':'模拟指标（Mock）'}>
    {Object.entries(labels).map(([key,label]) => <div key={key}>
      <dt>
        {label}
      </dt>
      <dd>
        {real&&key==='cost'? '不可用':formatMetric(key,metrics[key as keyof Metrics])}
      </dd>
    </div>)}
  </dl>;
}
