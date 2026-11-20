import React,{ useStore } from '../../runtime';
import type { Evaluation,Metrics,Run,Workbench } from '../../types';
import { COLUMN_LABELS } from '../../types';
import { Empty,formatMetric,Icon,StageBadge } from '../../components/common';
import { endedRunIds,isEndedStage,sortRunIds } from '../results/runOrder';
import { useDismissablePopover } from '../../components/useDismissablePopover';
import { modelLabel,providerLabel } from '../results/modelLabel';
import {MarketPrice,MarketCache} from '../a6/MarketSnapshot';
import {ResultTarget} from '../a6/ResultTarget';
import {ActualCost} from '../a6/LedgerOverview';
import { FINGERPRINT_DECISIONS,formatRankingScore,hasCalibratedProbability,isSampleEnded } from '../results/fingerprintPresentation';

// Keep in sync with `.mit-table .mit-sticky-match { right: ... }` in styles.css.
const ACTION_COLUMN_WIDTH=208;
// Standalone selection column, only rendered in bulk-selection mode.
const SELECT_COLUMN_WIDTH=46;
const A6_COLUMNS = new Set(['price','cache24h','target']);
const defaultWidth = (column: string): number => column === 'target' ? 236 : column === 'price' ? 228 : 144;
const supportsColumn = (column: string,record: Evaluation): boolean => column in COLUMN_LABELS && (record.kind === 'custom' || column !== 'round') && (Boolean(record.a6api) || !A6_COLUMNS.has(column));

function columnLabel(column: string): string {
  if(column==='cost')
    return '实际费用';
  if(column==='match')
    return '最高匹配';
  return COLUMN_LABELS[column];
}
function CellValue({ run,column,custom,store,record }: {
  store: Workbench;
  record: Evaluation;
  run: Run;
  column: string;
  custom: boolean;
}) {
  if(column==='price') return <MarketPrice market={run.model.a6api?.market} />;
  if(column==='cache24h') return <MarketCache market={run.model.a6api?.market} />;
  if(column==='target') return <ResultTarget store={store} record={record} model={run.model} />;
  if(column==='cost' && record.a6api) return <ActualCost store={store} record={record} run={run} />;
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
    return <span className="mit-muted">不适用</span>;
  }
  if(column==='round')
    return <span>{run.currentRound? `第 ${run.currentRound} 轮`:'—'}</span>;
  if(column==='cost'&&!custom)
    return <span className="mit-muted" title="真实请求可能产生费用；当前无法取得实际账单，不显示模拟估价。">不可用</span>;
  return <span className="mit-tabular">{formatMetric(column,run.metrics[column as keyof Metrics])}</span>;
}
function RunRow({ store,record,id,columns,custom,results,selecting,checked }: {
  store: Workbench;
  record: Evaluation;
  id: string;
  columns: string[];
  custom: boolean;
  results: boolean;
  selecting: boolean;
  checked: boolean;
}) {
  const run=useStore(store.evaluations,state => state.runs[id]);
  const selected=useStore(store.workbench,state => state.navigation[state.activeTab]?.runId===id);
  if(!run)
    return null;
  const fingerprint=record.fingerprint;
  const failed=!custom&&Boolean(run.fingerprint?.samples.some(sample => sample.state==='failed'));
  const retryable=failed&&Boolean(fingerprint?.jobId)&&fingerprint?.status!=='cancelled';
  const settled=run.fingerprint?.samples.every(sample => isSampleEnded(sample.state))??false;
  const retryTitle=!settled? '该模型仍有样本未结束，结束后可重试；只重新请求失败的样本，已完成样本保留。':fingerprint?.busy? '正在应用配置或重试，请稍候；只重新请求该模型失败的样本，已完成样本保留。':'只重新请求该模型失败的样本；已完成样本保留，任务会短暂回到运行中。';
  const selectable=selecting&&Boolean(run.model.a6api&&run.stage==='completed');
  // The whole row is a selection target; interactive children keep their own behaviour.
  const toggle=(event: React.MouseEvent<HTMLTableRowElement>): void => {
    if(!selectable||(event.target as HTMLElement).closest('button,input,a,label'))
      return;
    store.actions.toggleCustomRunSelection(record.id,id);
  };
  return <tr className={`${selected? 'is-selected':''}${selectable? ' is-selectable':''}`} onClick={selecting? toggle:undefined}>
    {selecting&&<td className="mit-select-col">
      <input type="checkbox" className="mit-custom-row-check" aria-label={`选择 ${modelLabel(run.model)} 创建自定义测试`} checked={checked} disabled={!run.model.a6api||run.stage!=='completed'} onClick={event => event.stopPropagation()} onChange={() => store.actions.toggleCustomRunSelection(record.id,id)} />
    </td>}
    <th scope="row">
      <button type="button" className="mit-run-link" onClick={() => store.actions.navigate({ runId: id,artifact: false })}>
        <strong>
          {modelLabel(run.model)}
        </strong>
        <span className="mit-muted">
          {providerLabel(run.model)}
          {run.model.relay&&<span className="mit-relay-chip">a6api</span>}
        </span>
      </button>
    </th>
    {columns.map(column => <td key={column} className={column==='match'? 'mit-sticky-match':''}>
      <CellValue run={run} column={column} custom={custom} store={store} record={record} />
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
function SortButton({ store,record,column,label,sort }: {
  store: Workbench;
  record: Evaluation;
  column: string;
  label: string;
  sort?: { column: string; direction: 'asc' | 'desc' };
}) {
  const active=sort?.column===column;
  return <button type="button" className={`mit-sort-button${active? ` is-${sort?.direction}`:''}`} title={active? `按${label}${sort?.direction==='desc'? '升序':'降序'}，再次点击恢复匹配排序`:`按${label}降序排序`} onClick={() => store.actions.toggleSort(record.id,column)}>
    {label}
    <span className="mit-sort-icon" aria-hidden="true" />
  </button>;
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
  const selectionRecordId=useStore(store.custom,state => state.selectionRecordId);
  const selectedRunIds=useStore(store.custom,state => state.selectedRunIds);
  const selecting=selectionRecordId===record.id;
  const columns=presentation.columns.filter(column => supportsColumn(column,record));
  const custom=record.kind==='custom';
  const sort=presentation.sorts[record.id];
  // Market snapshots are channel quotes, not per-run measurements, so only measured columns are sortable.
  const sortable=(column: string): boolean => !custom&&column!=='target'&&column!=='price'&&column!=='cache24h';
  const rowIds=useStore(store.evaluations,state => {
    const filtered=record.runIds.filter(id => {
      const run=state.runs[id];
      return run&&(!presentation.filter||`${run.model.name} ${providerLabel(run.model)} ${run.model.search}`.toLowerCase().includes(presentation.filter.toLowerCase()));
    });
    const ordered=results? endedRunIds(filtered,state.runs):filtered;
    return (sort&&sortable(sort.column)? sortRunIds(ordered,state.runs,sort):ordered).join('\n');
  });
  const activeCount=useStore(store.evaluations,state => record.runIds.filter(id => {
    const run=state.runs[id];
    return run&&!isEndedStage(run.stage);
  }).length);
  const columnRoot=useDismissablePopover(presentation.columnsOpen,store.actions.toggleColumns);
  const ids=rowIds? rowIds.split('\n'):[];
  const selectableCount=useStore(store.evaluations,state => ids.filter(id => { const run=state.runs[id]; return Boolean(run?.model.a6api&&run.stage==='completed'); }).length);
  return <section className={`mit-monitor${selecting ? ' is-bulk-selecting' : ''}`}>
    <div className="mit-monitor-tools">
      <div className="mit-search mit-table-search">
        <Icon name="search" />
        <input aria-label="筛选参测模型" placeholder="筛选模型…" value={presentation.filter} onChange={event => store.actions.setFilter(event.currentTarget.value)} />
      </div>
      <div className="mit-monitor-bulk-actions">
        {record.kind==='fingerprint'&&!selecting&&selectableCount>0&&<button type="button" className="mit-button" onClick={() => store.actions.startCustomSelection(record.id)}>自定义测试</button>}
        {selecting&&<><span className="mit-bulk-selection-count" role="status">已选择 {selectedRunIds.length} 个模型</span><button type="button" className="mit-button mit-primary" disabled={!selectedRunIds.length} onClick={() => store.actions.createCustomFromSelection(record.id)}>用所选模型创建</button><button type="button" className="mit-text-button" onClick={store.actions.cancelCustomSelection}>取消</button></>}
      </div>
      <div className="mit-column-picker" ref={columnRoot}>
        <button type="button" className="mit-button" aria-expanded={presentation.columnsOpen} aria-controls={`${store.sessionId}-mit-columns`} onClick={store.actions.toggleColumns}>
          <Icon name="settings" />显示列
        </button>
        {presentation.columnsOpen&&<div className="mit-column-menu mit-frosted" id={`${store.sessionId}-mit-columns`}>
          {Object.keys(COLUMN_LABELS).filter(id => supportsColumn(id,record)).map(id => <label key={id}>
            <input type="checkbox" checked={presentation.columns.includes(id)} onChange={() => store.actions.toggleColumn(id)} />
            {columnLabel(id)}
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
      <table className="mit-table" style={{ width: (presentation.widths.model||224)+columns.reduce((sum,id) => sum+(presentation.widths[id]||defaultWidth(id)),0)+ACTION_COLUMN_WIDTH+(selecting? SELECT_COLUMN_WIDTH:0) }}>
        <colgroup>
          {selecting&&<col style={{ width: SELECT_COLUMN_WIDTH }} />}
          <col style={{ width: presentation.widths.model||224 }} />
          {columns.map(id => <col key={id} style={{ width: presentation.widths[id]||defaultWidth(id) }} />)}
          <col style={{ width: ACTION_COLUMN_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            {selecting&&<th scope="col" className="mit-select-col"><span className="mit-custom-sr-only">选择</span></th>}
            <th scope="col" aria-sort={sort?.column==='model'? (sort.direction==='asc'? 'ascending':'descending'):undefined}>参测模型
              {sortable('model')&&<SortButton store={store} record={record} column="model" label="模型" sort={sort} />}
              <ResizeHandle store={store} column="model" width={presentation.widths.model||224} label="模型" />
            </th>
            {columns.map(id => <th scope="col" key={id} className={id==='match'? 'mit-sticky-match':''} aria-sort={sort?.column===id? (sort.direction==='asc'? 'ascending':'descending'):undefined}>
              {sortable(id)? <SortButton store={store} record={record} column={id} label={columnLabel(id)} sort={sort} />:columnLabel(id)}
              <ResizeHandle store={store} column={id} width={presentation.widths[id]||defaultWidth(id)} label={columnLabel(id)} />
            </th>)}
            <th scope="col" className="mit-sticky-actions">操作
            </th>
          </tr>
        </thead>
        <tbody>
          {ids.map(id => <RunRow store={store} record={record} key={id} id={id} columns={columns} custom={record.kind==='custom'} results={results} selecting={selecting} checked={selectedRunIds.includes(id)} />)}
        </tbody>
      </table>
      {!ids.length&&<Empty title={results? '还没有可展示的结果':'没有匹配的模型'}>
        {results? '测试仍在运行，结束后会出现在这里。':'尝试清除筛选条件。'}
      </Empty>}
    </div>
  </section>;
}
