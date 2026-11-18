import React,{useStore} from '../../runtime';
import type {Evaluation,Model,Workbench} from '../../types';
import {operationRowKey,operationTokenIssue} from '../../stores/a6insights.stores';

/** Relationship highlights are derived only from a successful Host readback for the selected Key. */
export function ResultTarget({store,record,model}: {store:Workbench;record:Evaluation;model:Model}) {
  const view = useStore(store.a6Insights,state => state.operations);
  const loading = useStore(store.a6Insights,state => state.loading);
  const error = useStore(store.a6Insights,state => state.error);
  const feedback = useStore(store.a6Insights,state => state.results[operationRowKey(record.id,model.id,model.a6api?.channelId ?? 0)]);
  const config = useStore(store.a6,state => state.config);
  const channel = model.a6api;
  if (!channel || !record.a6api) return null;
  const accountMatches = Boolean(config?.configured && view?.accountId && view.accountId === record.a6api.accountId && config.userId === record.a6api.accountId);
  const tokenId = view?.tokenId;
  const token = view?.tokens.find(item => item.id === tokenId);
  const selected = tokenId !== null && tokenId !== undefined;
  const usable = accountMatches && selected && !error && !operationTokenIssue(token) && view?.tokensAt !== null && !view?.loading.tokens && !view?.errors.tokens;
  const modelPins = view?.pins.filter(item => item.model === model.id) ?? [];
  const pinsConflict = modelPins.length > 1;
  const pinsKnown = usable && !loading && view?.pinsAt !== null && !view?.loading.pins && !view?.errors.pins && !pinsConflict;
  const routesKnown = usable && !loading && view?.routesAt !== null && !view?.loading.routes && !view?.errors.routes;
  const pin = modelPins.length === 1 ? modelPins[0] : undefined;
  const pinned = Boolean(pinsKnown && pin?.channelId === channel.channelId && pin.routeEffective === true);
  const routed = Boolean(routesKnown && view?.routes.some(item => item.model === model.id && item.channelIds.includes(channel.channelId)));
  const pending = Boolean(feedback?.pending);
  const act = (operation: 'pin'|'route'): void => {
    if (tokenId !== null && tokenId !== undefined) store.actions.a6ResultAction({recordId:record.id,model:model.id,channelId:channel.channelId,tokenId,operation});
  };
  return <div className="mit-a6-row-operations" aria-busy={pending}>
    <div className="mit-a6-actions">
      <button type="button" className={`mit-button${pinned ? ' is-confirmed' : ''}`} aria-pressed={pinned} disabled={!pinsKnown || pending || pinned} title={pinned ? `Key #${tokenId} 已读回固定此渠道；再次点击不会解除` : `将 Key #${tokenId ?? '未选择'} 的 ${model.id} 固定至渠道 #${channel.channelId}，关闭智能兜底`} onClick={() => act('pin')}>固定</button>
      <button type="button" className={`mit-button${routed ? ' is-confirmed' : ''}`} aria-pressed={routed} disabled={!routesKnown || pending || routed} title={routed ? `Key #${tokenId} 的此渠道已在路由中；再次点击不会移除` : `将渠道 #${channel.channelId} 加入 Key #${tokenId ?? '未选择'} 的 ${model.id} 路由`} onClick={() => act('route')}>加入路由</button>
    </div>
    {!accountMatches ? <small className="mit-error">{!config?.configured ? '请先配置并验证账号' : view?.accountId ? '当前账号与此记录不符' : '操作状态尚未读取'}</small> : !selected ? <small className="mit-muted">请在上方选择操作 Key</small> : !usable ? <small className="mit-error">操作 Key 尚未确认或不可用，请在上方刷新或重选</small> : <>
      <small className="mit-muted">Key #{tokenId} · {pinsKnown ? pin ? pin.routeEffective ? `当前固定：渠道 #${pin.channelId}` : `固定尚未生效：渠道 #${pin.channelId}` : '此模型未固定' : pinsConflict ? '固定关系冲突，请刷新核对' : '固定关系未知，请刷新'}</small>
      <small className="mit-muted">{routesKnown ? routed ? '此渠道已加入路由' : '此渠道尚未加入路由' : '路由关系未知，请刷新'}</small>
    </>}
    {pending && <small role="status">{feedback?.pending === 'pin' ? '固定并读取确认中…' : feedback?.pending === 'route' ? '加入路由并读取确认中…' : '恢复旧固定中…'}</small>}
    {feedback?.error && <small className="mit-error" role="alert">{feedback.error}</small>}
    {feedback?.message && <small role="status">{feedback.message}</small>}
  </div>;
}
