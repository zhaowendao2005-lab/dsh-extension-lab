import React,{ useMemo, useStore } from '../../runtime';
import type { RelayRow, Workbench } from '../../types';
import { formatPrice } from '../../components/price';
import { badgeText, duration, favoriteKeys, memberKey, pct, percentText, rateTone, ratioText, relative, routeLabel, statusOf } from './format';

export type RelayColumnId = 'favorite' | 'model' | 'brand' | 'channel' | 'price' | 'success' | 'success24h' | 'ttft' | 'throughput' | 'cache' | 'labels' | 'guarantee' | 'updated' | 'status' | 'ratio' | 'endpoint';

export const RELAY_COLUMNS: {id: RelayColumnId; label: string; width: number}[] = [
  {id: 'favorite', label: '收藏', width: 44},
  {id: 'model', label: '模型', width: 220},
  {id: 'brand', label: '模型厂商', width: 104},
  {id: 'channel', label: '渠道', width: 248},
  {id: 'price', label: '价格 / 1M（输入 · 输出）', width: 176},
  {id: 'success', label: '实时成功率', width: 150},
  {id: 'success24h', label: '24h', width: 76},
  {id: 'ttft', label: 'TTFT', width: 88},
  {id: 'throughput', label: '吞吐', width: 96},
  {id: 'cache', label: '缓存命中', width: 112},
  {id: 'labels', label: '路由标签', width: 168},
  {id: 'guarantee', label: '保真', width: 92},
  {id: 'updated', label: '最近成功', width: 96},
  {id: 'status', label: '状态', width: 80},
  {id: 'ratio', label: '实际倍率', width: 92},
  {id: 'endpoint', label: '测试端点', width: 104},
];

export const RELAY_ROW_HEIGHT = 58;
const OVERSCAN = 8;

function Buckets({ values }: { values: (number | null)[] }) {
  const recent = values.slice(-10);
  const padded: (number | null)[] = [...Array.from({length: Math.max(0, 10 - recent.length)}, () => null), ...recent];
  return <span className="mit-relay-buckets" aria-hidden="true">
    {padded.map((value, index) => <i key={index} className={`is-${rateTone(value)}`} title={value === null ? '无样本' : percentText(value)} />)}
  </span>;
}

function cell(row: RelayRow, id: RelayColumnId, favorite: boolean, now: number, onFavorite: () => void, price: (value: number | null) => string) {
  switch (id) {
    case 'favorite': return <button type="button" className={favorite ? 'mit-relay-star is-on' : 'mit-relay-star'} aria-pressed={favorite} aria-label={favorite ? '取消收藏' : '收藏'} title={favorite ? '取消收藏' : '加入收藏'} onClick={event => {
      event.stopPropagation();
      onFavorite();
    }}>{favorite ? '★' : '☆'}</button>;
    case 'model': return <span className="mit-relay-modelcell">
      <strong title={row.modelName}>{row.modelName}</strong>
      <small>{row.brand || '—'}{row.officialDirect && <em className="mit-relay-mark is-direct">直连</em>}</small>
    </span>;
    case 'brand': return <span className="mit-relay-brand">{row.brand || '—'}</span>;
    case 'channel': return <span className="mit-relay-channelcell" title={`${row.supplierName} · ${row.channelName}${row.description ? `\n${row.description}` : ''}`}>
      <span className="mit-relay-channel-line"><b>#{row.channelId}</b><span>{row.channelName || row.supplierName}</span></span>
      <span className="mit-relay-desc">{row.description || row.supplierName || '—'}</span>
    </span>;
    case 'price': {
      const ratio = ratioText(row.realtimeRatio);
      if (row.chargeType && row.perRequestPrice !== null && row.inputPrice === null && row.outputPrice === null) {
        return <span className="mit-relay-pricecell"><span className="mit-relay-num">{price(row.perRequestPrice)} / 次</span></span>;
      }
      return <span className="mit-relay-pricecell">
        <span className="mit-relay-num"><span>{price(row.inputPrice)}</span><i>·</i><span>{price(row.outputPrice)}</span></span>
        {ratio && <em className={`mit-relay-ratio ${row.priceDirection ? `is-${row.priceDirection}` : ''}`} title="实时倍率">{ratio}</em>}
      </span>;
    }
    case 'success': return <span className="mit-relay-ratecell">
      <span className={`mit-relay-rate-value is-${rateTone(row.successRate)}`}>{percentText(row.successRate)}</span>
      <Buckets values={row.buckets} />
    </span>;
    case 'success24h': return <span className={`mit-relay-num mit-relay-tone is-${rateTone(row.success24h)}`}>{percentText(row.success24h)}</span>;
    case 'ttft': return <span className="mit-relay-num">{duration(row.ttftMs)}</span>;
    case 'throughput': return <span className="mit-relay-num">{row.throughput === null ? '—' : `${row.throughput.toFixed(1)} t/s`}</span>;
    case 'cache': {
      const value = pct(row.cacheHitRate);
      return <span className="mit-relay-cachecell">
        <span className="mit-relay-cachebar" aria-hidden="true"><i style={{width: `${Math.max(0, Math.min(100, value ?? 0))}%`}} /></span>
        <span className="mit-relay-num">{percentText(row.cacheHitRate, 0)}</span>
      </span>;
    }
    case 'labels': return <span className="mit-relay-chips">
      {row.labels.map(label => {
        const meta = routeLabel(label);
        return <em key={label} className={`mit-relay-chip is-${meta.tone}`}>{meta.text}</em>;
      })}
      {!row.labels.length && <span className="mit-muted">—</span>}
    </span>;
    case 'guarantee': {
      const badge = badgeText(row.guaranteeBadge);
      if (!row.guaranteed && !badge) return <span className="mit-muted">—</span>;
      return <span className={`mit-relay-badge is-${badge ? row.guaranteeBadge.toLowerCase() : 'plain'}`} title="保真认证">
        {badge && <b>{badge}</b>}保真
      </span>;
    }
    case 'updated': return <span className="mit-relay-num" title={row.lastSuccessAt ? new Date((row.lastSuccessAt < 1e12 ? row.lastSuccessAt * 1000 : row.lastSuccessAt)).toLocaleString('zh-CN') : undefined}>{relative(row.lastSuccessAt ?? row.lastSampleAt, now)}</span>;
    case 'status': {
      const status = statusOf(row.routeStatus, row.listingAvailability);
      return <span className={`mit-relay-status is-${status.tone}`}><i aria-hidden="true" />{status.text}</span>;
    }
    case 'ratio': return <span className="mit-relay-num">{ratioText(row.realtimeRatio) ?? '—'}</span>;
    case 'endpoint': return <span className="mit-relay-num">{row.testEndpoint || '—'}</span>;
  }
}

export function RelayTable({ store }: { store: Workbench }) {
  const columns=useStore(store.relay,state => state.columns);
  const widths=useStore(store.relay,state => state.widths);
  const rows=useStore(store.relay,state => state.rows);
  const total=useStore(store.relay,state => state.total);
  const scrollTop=useStore(store.relay,state => state.scrollTop);
  const viewport=useStore(store.relay,state => state.viewportHeight);
  const loading=useStore(store.relay,state => state.loading);
  const partitions=useStore(store.relay,state => state.partitions);
  const active=useStore(store.relay,state => state.detail?.rowKey);
  const currency=useStore(store.relay,state => state.currency);
  const rate=useStore(store.relay,state => state.status.exchangeRate);
  const price=(value: number | null) => formatPrice(value,currency,rate);
  const favorites=useMemo(() => favoriteKeys(partitions),[partitions]);
  const visible=RELAY_COLUMNS.filter(column => columns.includes(column.id));
  const start=Math.max(0,Math.floor(scrollTop/RELAY_ROW_HEIGHT)-OVERSCAN);
  const end=Math.min(rows.length,Math.ceil((scrollTop+viewport)/RELAY_ROW_HEIGHT)+OVERSCAN);
  const slice=rows.slice(start,end);
  const template=visible.map(column => `${widths[column.id]??column.width}px`).join(' ');
  const width=visible.reduce((sum,column) => sum+(widths[column.id]??column.width),0);
  const now=Date.now();
  return <div className="mit-relay-table-scroll" onScroll={event => {
    const element=event.currentTarget;
    store.actions.relayScroll(element.scrollTop,element.clientHeight);
  }}>
    <div className="mit-relay-table" style={{width}} role="table" aria-label="中转站模型渠道" aria-rowcount={total}>
      <div className="mit-relay-head" role="row" style={{gridTemplateColumns:template}}>
        {visible.map(column => <div role="columnheader" key={column.id} className={`mit-relay-cell is-${column.id}`}>
          <span>{column.id==='favorite'? '☆':column.label}</span>
          <span className="mit-relay-resize" aria-hidden="true" onPointerDown={event => {
            event.preventDefault();
            event.stopPropagation();
            const startX=event.clientX;
            const startWidth=widths[column.id]??column.width;
            const move=(pointer:PointerEvent) => store.actions.resizeRelayColumn(column.id,startWidth+pointer.clientX-startX);
            const up=() => {
              window.removeEventListener('pointermove',move);
              window.removeEventListener('pointerup',up);
            };
            window.addEventListener('pointermove',move);
            window.addEventListener('pointerup',up);
          }} />
        </div>)}
      </div>
      <div className="mit-relay-body" style={{height:rows.length*RELAY_ROW_HEIGHT}}>
        {slice.map((row,index) => {
          const favorite=favorites.has(memberKey(row.channelId,row.modelName));
          return <div role="row" tabIndex={0} aria-selected={active===row.rowKey} key={row.rowKey}
            className={active===row.rowKey? 'mit-relay-row is-active':'mit-relay-row'}
            style={{gridTemplateColumns:template,height:RELAY_ROW_HEIGHT,transform:`translateY(${(start+index)*RELAY_ROW_HEIGHT}px)`}}
            onClick={() => store.actions.openRelayDetail(row.rowKey)}
            onKeyDown={event => {
              if (event.target!==event.currentTarget) return;
              if (event.key==='Enter'||event.key===' ') {
                event.preventDefault();
                store.actions.openRelayDetail(row.rowKey);
              }
            }}>
            {visible.map(column => <span role="cell" className={`mit-relay-cell is-${column.id}`} key={column.id}>{cell(row,column.id,favorite,now,() => store.actions.relayToggleFavorite(row.rowKey),price)}</span>)}
          </div>;
        })}
        {!loading&&!rows.length&&<p className="mit-relay-empty">没有符合当前筛选的渠道。</p>}
      </div>
    </div>
  </div>;
}
