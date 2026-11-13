import React,{ useStore } from '../../runtime';
import type { Evaluation,Metrics,Run,Workbench } from '../../types';
import { COLUMN_LABELS } from '../../types';
import { Empty,formatMetric,Icon,StageBadge } from '../../components/common';
import { endedRunIds,isEndedStage } from '../results/runOrder';
import { useDismissablePopover } from '../../components/useDismissablePopover';
import { formatPrice } from '../../components/price';
import { modelLabel,providerLabel } from '../results/modelLabel';
import { FINGERPRINT_DECISIONS,formatRankingScore,hasCalibratedProbability,isSampleEnded } from '../results/fingerprintPresentation';

// Keep in sync with `.mit-table .mit-sticky-match { right: ... }` in styles.css.
const ACTION_COLUMN_WIDTH=144;

function columnLabel(column: string,custom: boolean): string {
  if(column==='cost')
    return custom? '费用（Mock）':'实际费用';
  if(column==='match')
    return custom? '最高匹配（Mock）':'最高匹配';
  return COLUMN_LABELS[column];
}
function CellValue({ run,column,custom }: {
  run: Run;
  column: string;
  custom: boolean;
}) {
  if(column==='stage') {
    if(custom)
      return <div className="mit-monitor-state"><StageBadge stage={run.stage} /></div>;
    const analysis=run.fingerprint?.analysis;
    const ended=run.fingerprint?.samples.filter(sample => isSampleEnded(sample.state)).length??0;
    const detail=run.stage==='completed'&&analysis? `已完成 · ${analysis.usedOutputs}/3 有效`:`样本 ${ended}/3 已结束`;
    return <div className="mit-monitor-state"><StageBadge stage={run.stage} /><span className="mit-muted">{detail}</span></div>;
  }
  if(column==='match') {
    if(!custom) {
      const analysis=run.fingerprint?.analysis;
      if(!analysis)
        return <span className="mit-muted">{isEndedStage(run.stage)? '无分析结果':'待分析'}</span>;
      if(analysis.decision==='not_model'||analysis.decision==='unscorable')
        return <span title={FINGERPRINT_DECISIONS[analysis.decision]}>{FINGERPRINT_DECISIONS[analysis.decision]}</span>;
      const calibrated=hasCalibratedProbability(analysis,analysis.probability);
      return <div className="mit-monitor-match" title={`${FINGERPRINT_DECISIONS[analysis.decision]} · ${calibrated? '参考库内闭集校准概率，不含库外模型':'原始排序分数，非概率'}`}>
        <strong>{analysis.predictionName||analysis.prediction||'—'}</strong>
        <span className="mit-tabular">{calibrated? `${((analysis.probability??0)*100).toFixed(1)}% · 库内概率`:`RAW ${formatRankingScore(analysis.rankingScore)}`}</span>
        {analysis.decision==='partial'&&<span className="mit-muted">部分样本 · {analysis.usedOutputs}/3 有效</span>}
      </div>;
    }
    const best=run.candidates.reduce<{ name: string; score: number }|undefined>((a,b) => !a||b.score>a.score? b:a,undefined);
    return best? <span title={`${best.name} · 模拟排序分数`}>{best.name} · RAW {formatRankingScore(best.score)} · Mock</span>:<span className="mit-muted">—</span>;
  }
  if(column==='round')
    return <span>{run.currentRound? `第 ${run.currentRound} 轮 · Mock`:'—'}</span>;
  if(column==='cost'&&!custom)
    return <span className="mit-muted" title="真实请求可能产生费用；当前无法取得实际账单，不显示模拟估价。">不可用</span>;
  return <span className="mit-tabular">{formatMetric(column,run.metrics[column as keyof Metrics])}</span>;
}
function RunRow({ store,record,id,columns,custom }: {
  store: Workbench;
  record: Evaluation;
  id: string;
  columns: string[];
  custom: boolean;
}) {
  const run=useStore(store.evaluations,state => state.runs[id]);
  const relayRef=run?.model.relay;
  const resolved=useStore(store.relay,state => relayRef? state.resolved[`${relayRef.channelId}|${relayRef.model}`]:undefined);
  const currency=useStore(store.relay,state => state.currency);
  const rate=useStore(store.relay,state => state.status.exchangeRate);
  const selected=useStore(store.workbench,state => state.navigation[state.activeTab]?.runId===id);
  if(!run)
    return null;
  const fingerprint=record.fingerprint;
  const failed=!custom&&Boolean(run.fingerprint?.samples.some(sample => sample.state==='failed'));
  const retryable=failed&&Boolean(fingerprint?.jobId)&&fingerprint?.status!=='cancelled';
  const settled=run.fingerprint?.samples.every(sample => isSampleEnded(sample.state))??false;
  const retryTitle=!settled? '该模型仍有样本未结束，结束后可重试；只重新请求失败的样本，已完成样本保留。':fingerprint?.busy? '正在应用配置或重试，请稍候；只重新请求该模型失败的样本，已完成样本保留。':'只重新请求该模型失败的样本；已完成样本保留，任务会短暂回到运行中。';
  return <tr className={selected? 'is-selected':''}>
    <th scope="row">
      <button type="button" className="mit-run-link" onClick={() => store.actions.navigate({ runId: id,artifact: false })}>
        <strong>
          {modelLabel(run.model)}
        </strong>
        <span className="mit-muted">
          {providerLabel(run.model)}
          {run.model.relay&&<span className="mit-relay-chip">中转</span>}
        </span>
        {run.model.relay&&<span className="mit-relay-priceline">
          {resolved?.found===false? <em className="mit-expired">已过期</em>
            :resolved?.found? (resolved.inputPrice===null&&resolved.outputPrice===null&&resolved.perRequestPrice!==null
              ? `${formatPrice(resolved.perRequestPrice,currency,rate)} / 次`
              : `${formatPrice(resolved.inputPrice,currency,rate)} · ${formatPrice(resolved.outputPrice,currency,rate)} / 1M`)
              :<span className="mit-muted">价格查询中…</span>}
        </span>}
      </button>
    </th>
    {columns.map(column => <td key={column} className={column==='match'? 'mit-sticky-match':''}>
      <CellValue run={run} column={column} custom={custom} />
    </td>)}
    <td className="mit-sticky-actions">
      <div className="mit-row-actions">
        <button type="button" className="mit-text-button" onClick={() => store.actions.navigate({ runId: id,artifact: false })}>详情
          <Icon name="chevron" size={12} />
        </button>
        {retryable&&<button type="button" className="mit-text-button mit-retry-button" title={retryTitle} disabled={Boolean(fingerprint?.busy)||!settled} onClick={() => store.actions.retryFailedSample(record.id,id)}>重试失败项</button>}
      </div>
    </td>
  </tr>;
}
function ResizeHandle({ store,column,width,label }: {
  store: Workbench;
  column: string;
  width: number;
  label: string;
}) {
  return <span role="separator" tabIndex={0} aria-label={`调整${label}列宽`} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={88} aria-valuemax={560} className="mit-column-resizer" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={event => {
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      store.actions.resizeColumn(column,Math.max(88,Math.min(560,width+event.movementX)));
  }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={event => {
    if(event.key==='ArrowLeft'||event.key==='ArrowRight') {
      event.preventDefault();
      store.actions.resizeColumn(column,Math.max(88,Math.min(560,width+(event.key==='ArrowRight'? 16:-16))));
    }
  }} />;
}
export function MonitorTable({ store,record,results=false }: {
  store: Workbench;
  record: Evaluation;
  results?: boolean;
}) {
  const presentation=useStore(store.presentation,value => value);
  const columns=presentation.columns.filter(column => column in COLUMN_LABELS&&(record.kind==='custom'||column!=='round'));
  const rowIds=useStore(store.evaluations,state => {
    const filtered=record.runIds.filter(id => {
      const run=state.runs[id];
      return run&&(!presentation.filter||`${run.model.name} ${providerLabel(run.model)} ${run.model.search}`.toLowerCase().includes(presentation.filter.toLowerCase()));
    });
    return (results? endedRunIds(filtered,state.runs):filtered).join('\n');
  });
  const activeCount=useStore(store.evaluations,state => record.runIds.filter(id => {
    const run=state.runs[id];
    return run&&!isEndedStage(run.stage);
  }).length);
  const columnRoot=useDismissablePopover(presentation.columnsOpen,store.actions.toggleColumns);
  const ids=rowIds? rowIds.split('\n'):[];
  return <section className="mit-monitor">
    <div className="mit-monitor-tools">
      <div className="mit-search mit-table-search">
        <Icon name="search" />
        <input aria-label="筛选参测模型" placeholder="筛选模型…" value={presentation.filter} onChange={event => store.actions.setFilter(event.currentTarget.value)} />
      </div>
      <div className="mit-column-picker" ref={columnRoot}>
        <button type="button" className="mit-button" aria-expanded={presentation.columnsOpen} aria-controls={`${store.sessionId}-mit-columns`} onClick={store.actions.toggleColumns}>
          <Icon name="settings" />显示列
        </button>
        {presentation.columnsOpen&&<div className="mit-column-menu mit-frosted" id={`${store.sessionId}-mit-columns`}>
          {Object.keys(COLUMN_LABELS).filter(id => record.kind==='custom'||id!=='round').map(id => <label key={id}>
            <input type="checkbox" checked={presentation.columns.includes(id)} onChange={() => store.actions.toggleColumn(id)} />
            {columnLabel(id,record.kind==='custom')}
          </label>)}
          <p className="mit-muted">拖动列分隔线调整宽度，或聚焦后使用左右键。
          </p>
        </div>}
      </div>
    </div>
    {results&&<div className="mit-result-note">
      <strong>测试结果</strong>
      <span className="mit-muted">仅显示已结束的
        {ids.length} 个模型
        {activeCount? ` · ${activeCount} 个仍在运行`:''}
      </span>
    </div>}
    <div className="mit-table-scroll">
      <table className="mit-table" style={{ width: (presentation.widths.model||224)+columns.reduce((sum,id) => sum+(presentation.widths[id]||144),0)+ACTION_COLUMN_WIDTH }}>
        <colgroup>
          <col style={{ width: presentation.widths.model||224 }} />
          {columns.map(id => <col key={id} style={{ width: presentation.widths[id]||144 }} />)}
          <col style={{ width: ACTION_COLUMN_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">参测模型
              <ResizeHandle store={store} column="model" width={presentation.widths.model||224} label="模型" />
            </th>
            {columns.map(id => <th scope="col" key={id} className={id==='match'? 'mit-sticky-match':''}>
              {columnLabel(id,record.kind==='custom')}
              <ResizeHandle store={store} column={id} width={presentation.widths[id]||144} label={columnLabel(id,record.kind==='custom')} />
            </th>)}
            <th scope="col" className="mit-sticky-actions">操作
            </th>
          </tr>
        </thead>
        <tbody>
          {ids.map(id => <RunRow store={store} record={record} key={id} id={id} columns={columns} custom={record.kind==='custom'} />)}
        </tbody>
      </table>
      {!ids.length&&<Empty title={results? '还没有可展示的结果':'没有匹配的模型'}>
        {results? '测试仍在运行，结束后会出现在这里。':'尝试清除筛选条件。'}
      </Empty>}
    </div>
  </section>;
}
