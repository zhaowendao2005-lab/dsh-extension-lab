import React,{ useMemo,useStore } from '../../runtime';
import type { PartitionItem,RelayApi,Workbench } from '../../types';
import { formatPrice } from '../../components/price';
import { relayTarget } from '../../components/tags';
import { TagEditor } from '../tags/TagEditor';

const FORMATS: { id: RelayApi; label: string; hint: string }[] = [
  { id: 'chat',label: 'Chat Completions',hint: 'OpenAI 兼容 /v1/chat/completions' },
  { id: 'responses',label: 'Responses',hint: 'OpenAI Responses /v1/responses' },
  { id: 'messages',label: 'Messages',hint: 'Anthropic /v1/messages' },
];

function Row({ store,item,partitionId }: { store: Workbench; item: PartitionItem; partitionId: string }) {
  const currency=useStore(store.relay,state => state.currency);
  const rate=useStore(store.relay,state => state.status.exchangeRate);
  const resolved=useStore(store.relay,state => state.resolved[`${item.channelId}|${item.model}`]);
  const expired=resolved?.found===false;
  const price=resolved?.found? (resolved.chargeType&&resolved.inputPrice===null&&resolved.outputPrice===null
    ? `${formatPrice(resolved.perRequestPrice,currency,rate)} / 次`
    : `${formatPrice(resolved.inputPrice,currency,rate)} · ${formatPrice(resolved.outputPrice,currency,rate)}`):null;
  return <div className={`mit-fav-row ${expired? 'is-expired':''}`} role="row">
    <span className="mit-fav-main" role="cell">
      <strong>{item.model}</strong>
      <small>#{item.channelId} · {item.channelName||item.supplier||'未知渠道'}{item.brand? ` · ${item.brand}`:''}</small>
    </span>
    <span className="mit-fav-price" role="cell">
      {expired? <em className="mit-expired">已过期</em>:price??<span className="mit-muted">{resolved?.found===null? '查询中…':'—'}</span>}
    </span>
    <span className="mit-fav-tags" role="cell"><TagEditor store={store} target={relayTarget(item.siteId,item.channelId,item.model)} /></span>
    <span className="mit-fav-api" role="cell">{item.api? <span className="mit-relay-api">{item.api}</span>:<span className="mit-muted">未加入</span>}</span>
    <span className="mit-fav-actions" role="cell">
      {expired
        ? <button type="button" className="mit-text-button is-danger" onClick={() => store.actions.relayClearExpired(item.siteId,item.channelId,item.model)}>清除</button>
        : <button type="button" className="mit-text-button" onClick={() => store.actions.relayPoolOpen(partitionId,item.key)}>加入模型池</button>}
    </span>
  </div>;
}

export function RelayFavorites({ store }: { store: Workbench }) {
  const partitions=useStore(store.relay,state => state.partitions);
  const pool=useStore(store.relay,state => state.pool);
  const error=useStore(store.relay,state => state.partitionsError);
  const favorites=useMemo(() => partitions.find(partition => partition.id==='favorites'),[partitions]);
  const items=favorites?.items??[];
  return <section className="mit-fav-page" aria-label="收藏">
    {error&&<p className="mit-relay-error" role="alert">{error}</p>}
    {!items.length&&<div className="mit-picker-empty"><strong>还没有收藏的渠道</strong><p className="mit-muted">在「渠道列表」点击 ☆ 收藏渠道，再回到这里加标签或加入 DSH 模型池。</p></div>}
    {items.length>0&&<div className="mit-fav-table" role="table" aria-label="收藏的渠道">
      <div className="mit-fav-head" role="row">
        <span role="columnheader">模型 / 渠道</span><span role="columnheader">价格 / 1M（输入 · 输出）</span><span role="columnheader">标签</span><span role="columnheader">模型池</span><span role="columnheader">操作</span>
      </div>
      {items.map(item => <Row key={item.key} store={store} item={item} partitionId="favorites" />)}
    </div>}
    {pool&&<div className="mit-modal-backdrop" role="presentation" onClick={store.actions.relayPoolClose}>
      <div className="mit-modal mit-frosted" role="dialog" aria-modal="true" aria-label="选择协议" onClick={event => event.stopPropagation()}>
        <h3>加入模型池</h3>
        <p className="mit-muted">选择该渠道使用的接口协议，模型会出现在「设置 → API 适配站点 → 插件管理的提供商」。</p>
        <div className="mit-pool-formats" role="radiogroup" aria-label="接口协议">
          {FORMATS.map(format => <button type="button" role="radio" aria-checked={pool.format===format.id} key={format.id}
            className={pool.format===format.id? 'is-active':''} onClick={() => store.actions.relayPoolFormat(format.id)}>
            <strong>{format.label}</strong><small>{format.hint}</small>
          </button>)}
        </div>
        <div className="mit-modal-actions">
          <button type="button" className="mit-text-button" onClick={store.actions.relayPoolClose}>取消</button>
          <button type="button" className="mit-primary-button" onClick={store.actions.relayPoolConfirm}>加入模型池</button>
        </div>
      </div>
    </div>}
  </section>;
}
