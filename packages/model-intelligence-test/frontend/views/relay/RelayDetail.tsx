import type { ReactNode } from 'react';
import React,{ useMemo, useStore } from '../../runtime';
import type { RelayBucket, RelayRow, Workbench } from '../../types';
import { Icon } from '../../components/common';
import { formatPrice } from '../../components/price';
import { useDismissablePopover } from '../../components/useDismissablePopover';
import { badgeText, chargeText, duration, favoriteKeys, limitState, memberKey, pct, percentText, qualityText, rateTone, ratioText, relative, routeLabel, sampleState, stamp, statusOf } from './format';

function BarChart({ title,buckets,unit }: { title: string; buckets: RelayBucket[]; unit: 'hour' | 'day' }) {
  if (!buckets.length) return <p className="mit-muted">{title}：暂无数据</p>;
  return <figure className="mit-relay-chart">
    <figcaption>{title}</figcaption>
    <div className="mit-relay-chart-bars" role="img" aria-label={title}>
      {buckets.map((bucket,index) => {
        const rate=pct(bucket.rate);
        const when=bucket.at===null? `#${index+1}`:new Date(bucket.at<1e12? bucket.at*1000:bucket.at).toLocaleString('zh-CN',unit==='hour'? {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit'});
        const tip=`${when} · 成功率 ${rate===null? '—':`${rate.toFixed(1)}%`} · ${bucket.requests} 次请求${bucket.latencyMs!==null? ` · 延迟 ${duration(bucket.latencyMs)}`:''}${bucket.firstMs!==null? ` · 首字 ${duration(bucket.firstMs)}`:''}`;
        return <span key={index} className="mit-relay-chart-col" title={tip}>
          <i className={`is-${rateTone(bucket.rate)}`} style={{height:`${rate===null? 6:Math.max(6,rate)}%`}} />
        </span>;
      })}
    </div>
  </figure>;
}

function Section({ title,action,loading,loaded,onLoad,children }: { title: string; action: string; loading: boolean; loaded: boolean; onLoad(): void; children?: ReactNode }) {
  return <section className="mit-relay-dsection">
    <header>
      <h3>{title}</h3>
      <button type="button" className="mit-relay-load" onClick={onLoad} disabled={loading}>
        {loading? '读取中…':loaded? <><Icon name="refresh" size={12} />重新读取</>:action}
      </button>
    </header>
    {children}
  </section>;
}

function Facts({ row,price }: { row: RelayRow; price: (value: number | null) => string }) {
  const ratio=ratioText(row.realtimeRatio);
  const badge=badgeText(row.guaranteeBadge);
  const status=statusOf(row.routeStatus,row.listingAvailability);
  return <dl className="mit-relay-facts">
    <div><dt>供应商</dt><dd>{row.supplierName||'—'}</dd></div>
    <div><dt>挂载 ID</dt><dd>{row.listingId}</dd></div>
    <div><dt>输入 / 1M</dt><dd>{price(row.inputPrice)}<small>官方 {price(row.officialInputPrice)}</small></dd></div>
    <div><dt>输出 / 1M</dt><dd>{price(row.outputPrice)}<small>官方 {price(row.officialOutputPrice)}</small></dd></div>
    {(row.cacheReadPrice!==null||row.cacheWritePrice!==null)&&<div><dt>缓存读 / 写</dt><dd>{price(row.cacheReadPrice)} · {price(row.cacheWritePrice)}</dd></div>}
    {row.perRequestPrice!==null&&<div><dt>按次</dt><dd>{price(row.perRequestPrice)}{row.chargeType&&<small>{chargeText(row.chargeType)}</small>}</dd></div>}
    <div><dt>实时倍率</dt><dd>{ratio??'—'}</dd></div>
    <div><dt>实时成功率</dt><dd className={`mit-relay-tone is-${rateTone(row.successRate)}`}>{percentText(row.successRate,2)}{row.sampleCount!==null&&<small>{row.sampleCount} 样本</small>}</dd></div>
    <div><dt>24h 成功率</dt><dd className={`mit-relay-tone is-${rateTone(row.success24h)}`}>{percentText(row.success24h,2)}</dd></div>
    <div><dt>TTFT</dt><dd>{duration(row.ttftMs)}</dd></div>
    <div><dt>近期 P50</dt><dd>{duration(row.recentP50Ms)}</dd></div>
    <div><dt>吞吐</dt><dd>{row.throughput===null? '—':`${row.throughput.toFixed(1)} tok/s`}</dd></div>
    <div><dt>缓存命中</dt><dd>{percentText(row.cacheHitRate)}</dd></div>
    <div><dt>保真</dt><dd>{row.guaranteed||badge? <span className={`mit-relay-badge is-${badge? row.guaranteeBadge.toLowerCase():'plain'}`}>{badge&&<b>{badge}</b>}保真</span>:'否'}{row.officialDirect&&<em className="mit-relay-mark is-direct">直连</em>}</dd></div>
    <div><dt>路由标签</dt><dd className="mit-relay-chips">{row.labels.length? row.labels.map(label => {
      const meta=routeLabel(label);
      return <em key={label} className={`mit-relay-chip is-${meta.tone}`}>{meta.text}</em>;
    }):'—'}</dd></div>
    <div><dt>状态</dt><dd><span className={`mit-relay-status is-${status.tone}`}><i aria-hidden="true" />{status.text}</span></dd></div>
    <div><dt>最近成功</dt><dd>{relative(row.lastSuccessAt)}<small>{stamp(row.lastSuccessAt)}</small></dd></div>
    <div><dt>最近失败</dt><dd>{row.lastFailureAt? <>{relative(row.lastFailureAt)}<small>{row.lastFailureCode||'—'}</small></>:'—'}</dd></div>
    <div><dt>测试端点</dt><dd>{row.testEndpoint||'—'}</dd></div>
    <div><dt>模型检测</dt><dd>{row.modelDetection? '支持':'不支持'}</dd></div>
  </dl>;
}

export function RelayDetail({ store,row }: { store: Workbench; row: RelayRow }) {
  const detailLoading=useStore(store.relay,state => state.detailLoading);
  const currency=useStore(store.relay,state => state.currency);
  const rate=useStore(store.relay,state => state.status.exchangeRate);
  const price=(value: number | null) => formatPrice(value,currency,rate);
  const history=useStore(store.relay,state => state.history[row.rowKey]);
  const concurrency=useStore(store.relay,state => state.concurrency[row.rowKey]);
  const svg=useStore(store.relay,state => state.svg[row.rowKey]);
  const partitions=useStore(store.relay,state => state.partitions);
  const partitionsError=useStore(store.relay,state => state.partitionsError);
  const menuOpen=useStore(store.relay,state => state.partitionMenu===row.rowKey);
  const menu=useDismissablePopover(menuOpen,() => store.actions.relayPartitionMenu(null));
  const favorite=useMemo(() => favoriteKeys(partitions).has(memberKey(row.channelId,row.modelName)),[partitions,row.channelId,row.modelName]);
  const key=memberKey(row.channelId,row.modelName);
  const h=history?.value;
  const c=concurrency?.value;
  const s=svg?.value;
  return <aside className="mit-relay-detail mit-relay-drawer" aria-label="渠道详情">
    <header className="mit-relay-drawer-head">
      <div>
        <p className="mit-kicker">CHANNEL #{row.channelId}</p>
        <strong>{row.modelName}</strong>
        <small>{row.brand||'—'} · {row.channelName||row.supplierName}</small>
      </div>
      <button type="button" className="mit-icon-button" aria-label="关闭渠道详情" onClick={store.actions.closeRelayDetail}><Icon name="close" size={14} /></button>
    </header>
    <div className="mit-relay-drawer-actions">
      <button type="button" className={favorite? 'mit-relay-action is-on':'mit-relay-action'} aria-pressed={favorite} onClick={() => store.actions.relayToggleFavorite(row.rowKey)}>{favorite? '★ 已收藏':'☆ 收藏'}</button>
      <div className="mit-relay-assign" ref={menu}>
        <button type="button" className="mit-relay-action" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => store.actions.relayPartitionMenu(menuOpen? null:row.rowKey)}>
          <Icon name="plus" size={12} />加入分区
        </button>
        {menuOpen&&<div className="mit-relay-assign-menu mit-frosted" role="menu" aria-label="选择分区">
          {partitions.map(partition => {
            const member=partition.items.some(item => memberKey(item.channelId,item.model)===key);
            return <button type="button" role="menuitemcheckbox" aria-checked={member} key={partition.id} className={member? 'is-member':''} onClick={() => store.actions.relayAssign(row.rowKey,partition.id)}>
              <span className="mit-relay-assign-check" aria-hidden="true">{member&&<Icon name="check" size={11} />}</span>
              <span>{partition.name}</span>
              <small>{partition.items.length}</small>
            </button>;
          })}
          {!partitions.length&&<p className="mit-muted">暂无分区</p>}
          {partitionsError&&<p className="mit-relay-derror">{partitionsError}</p>}
        </div>}
      </div>
    </div>
    <div className="mit-relay-drawer-body">
      {detailLoading&&<p className="mit-muted">正在读取最新详情…</p>}
      {row.description&&<p className="mit-relay-drawer-desc">{row.description}</p>}
      <Facts row={row} price={price} />
      <Section title="成功率历史" action="24 小时 / 7 天成功率" loading={!!history?.loading} loaded={!!h} onLoad={() => store.actions.relayLoadHistory(row.rowKey)}>
        {history?.error&&<p className="mit-relay-derror" role="alert">{history.error}</p>}
        {h&&<div className="mit-relay-history">
          <div className="mit-relay-history-sum">
            <span><small>24h</small><b className={`mit-relay-tone is-${rateTone(h.success24h)}`}>{percentText(h.success24h,2)}</b>{h.state24h&&<em>{sampleState(h.state24h)}</em>}</span>
            <span><small>7 天</small><b className={`mit-relay-tone is-${rateTone(h.success7d)}`}>{percentText(h.success7d,2)}</b>{h.state7d&&<em>{sampleState(h.state7d)}</em>}</span>
          </div>
          <BarChart title="24 小时（按小时）" buckets={h.hours} unit="hour" />
          <BarChart title="7 天（按日）" buckets={h.days} unit="day" />
          <dl className="mit-relay-facts is-compact">
            <div><dt>最近成功</dt><dd>{stamp(h.lastSuccessAt)}</dd></div>
            <div><dt>最近失败</dt><dd>{stamp(h.lastFailureAt)}<small>{h.lastFailureCode||'—'}</small></dd></div>
          </dl>
          {h.recent.length>0&&<div className="mit-relay-recent">
            <small>最近样本窗口</small>
            <ol>{h.recent.map((item,index) => <li key={index} className={`is-${rateTone(item.rate)}`} title={`${item.success}/${item.samples} 成功`}>
              <b>{percentText(item.rate,0)}</b><span>{item.success}/{item.samples}</span>
            </li>)}</ol>
          </div>}
          <p className="mit-relay-stamp">读取于 {stamp(h.fetchedAt)}</p>
        </div>}
      </Section>
      <Section title="实时并发" action="读取实时并发" loading={!!concurrency?.loading} loaded={!!c} onLoad={() => store.actions.relayLoadConcurrency(row.rowKey)}>
        {concurrency?.error&&<p className="mit-relay-derror" role="alert">{concurrency.error}</p>}
        {c&&<div className="mit-relay-concurrency">
          <div className="mit-relay-meter" aria-hidden="true"><i style={{width:`${c.active!==null&&c.limit? Math.min(100,c.active/c.limit*100):0}%`}} /></div>
          <dl className="mit-relay-facts is-compact">
            <div><dt>当前并发</dt><dd>{c.active??'—'}<small>/ {c.limit??'∞'}</small></dd></div>
            <div><dt>限额状态</dt><dd>{limitState(c.limitState)}</dd></div>
            <div><dt>质量</dt><dd>{qualityText(c.quality)}</dd></div>
            <div><dt>采样时间</dt><dd>{stamp(c.sampledAt)}</dd></div>
          </dl>
        </div>}
      </Section>
      <Section title="SVG 检测" action="读取 SVG 检测" loading={!!svg?.loading} loaded={!!s} onLoad={() => store.actions.relayLoadSvg(row.rowKey)}>
        {svg?.error&&<p className="mit-relay-derror" role="alert">{svg.error}</p>}
        {s&&(s.svg? <figure className="mit-relay-svg">
          <img alt="模型生成的 SVG 检测图" src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s.svg)} />
          <figcaption>生成于 {stamp(s.createdAt)}</figcaption>
        </figure>:<p className="mit-muted">该渠道暂无 SVG 检测结果。</p>)}
      </Section>
      <p className="mit-relay-stamp">详情来自匿名公开接口；不包含登录后的固定或路由操作。</p>
    </div>
  </aside>;
}
