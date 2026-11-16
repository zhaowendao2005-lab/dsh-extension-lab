import React,{useStore} from '../../runtime';
import type {Evaluation,Workbench} from '../../types';
import {operationRowKey,operationTokenIssue} from '../../stores/a6insights.stores';

export function OperationKeyPicker({store,record}: {store:Workbench;record:Evaluation}) {
  const state = useStore(store.a6Insights, value => value);
  const config = useStore(store.a6, value => value.config);
  const view = state.operations;
  const query = state.query.trim().toLowerCase();
  const tokens = view?.tokens ?? [];
  const selected = tokens.find(token => token.id === view?.tokenId);
  const choices = tokens.filter(token => token.id === view?.tokenId || !query || `${token.name} ${token.id} ${token.maskedKey ?? ''}`.toLowerCase().includes(query));
  const busy = state.busy > 0;
  const current = Boolean(config?.configured && view?.accountId && config.userId === view.accountId);
  const leases = view?.legacyLeases.filter(lease => lease.recordId === record.id || lease.recordId === null && record.models.some(model => model.id === lease.model && model.a6api?.channelId === lease.channelId)) ?? [];
  const selectedIssue = view?.tokenId === null || view?.tokenId === undefined ? '' : operationTokenIssue(selected);
  return <section className="mit-a6-operation-key" aria-label="全局操作 Key" aria-busy={busy}>
    <div className="mit-label-row"><strong>操作 Key（所有渠道共用）</strong><span className="mit-muted">当前账号 {config?.userId || '未配置'}</span></div>
    <p className="mit-muted">从当前账号的全部 Key 中选择一个；选择按账号保存。下方“固定”和“加入路由”均作用于此 Key。</p>
    <div className="mit-a6-operation-controls">
      <label className="mit-field">搜索 Key<input type="search" value={state.query} placeholder="名称、Key ID 或掩码" disabled={!current || busy} onChange={event => store.actions.setA6OperationQuery(event.currentTarget.value)} /></label>
      <label className="mit-field">当前操作 Key<select value={view?.tokenId ?? ''} disabled={!current || busy || view?.tokensAt === null} onChange={event => store.actions.selectA6OperationToken(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))}>
        <option value="">请选择操作 Key</option>
        {view?.tokenId !== null && view?.tokenId !== undefined && !selected && <option value={view.tokenId} disabled>Key #{view.tokenId}（已失效，请重新选择）</option>}
        {choices.map(token => <option key={token.id} value={token.id} disabled={Boolean(operationTokenIssue(token))}>{token.name || '未命名 Key'} · #{token.id}{token.maskedKey ? ` · ${token.maskedKey}` : ''}{operationTokenIssue(token) ? ` · ${operationTokenIssue(token)}` : ''}</option>)}
      </select></label>
    </div>
    {query && !tokens.some(token => `${token.name} ${token.id} ${token.maskedKey ?? ''}`.toLowerCase().includes(query)) && <p className="mit-muted">未找到匹配的 Key；当前选择仍保留显示。</p>}
    {current && view?.tokensAt !== null && !view?.errors.tokens && !tokens.length && <p className="mit-muted">当前账号没有可选择的 Key。</p>}
    <div className="mit-a6-actions"><button type="button" className="mit-button" disabled={busy || !config?.configured} onClick={store.actions.refreshA6OperationTokens}>刷新 Key 列表</button><button type="button" className="mit-button" disabled={busy || !current || view?.tokenId === null} onClick={() => store.actions.refreshA6Relations('pins')}>刷新固定</button><button type="button" className="mit-button" disabled={busy || !current || view?.tokenId === null} onClick={() => store.actions.refreshA6Relations('routes')}>刷新路由</button></div>
    {busy && <p className="mit-muted" role="status">{state.loading ? '正在读取操作 Key 和关系…' : '正在执行渠道操作，操作 Key 暂不可切换…'}</p>}
    {!config?.configured && <p className="mit-error" role="alert">请先在功能中心配置并验证账号。</p>}
    {config?.configured && !view && !busy && !state.error && <p className="mit-muted">尚未读取操作状态，请刷新 Key 列表。</p>}
    {view && config?.configured && !current && <p className="mit-error" role="alert">账号状态不一致，请刷新账号信息后再操作。</p>}
    {view?.tokenId === null && <p className="mit-muted">尚未选择操作 Key；选择后读取固定与路由关系。</p>}
    {selectedIssue && <p className="mit-error" role="alert">{selectedIssue}</p>}
    {state.error && <p className="mit-error" role="alert">{state.error}</p>}
    {view?.errors.tokens && <p className="mit-error" role="alert">Key 列表：{view.errors.tokens}</p>}
    {view?.errors.pins && <p className="mit-error" role="alert">固定关系未确认：{view.errors.pins}</p>}
    {view?.errors.routes && <p className="mit-error" role="alert">路由关系未确认：{view.errors.routes}</p>}
    {state.feedback && <p className="mit-muted" role="status">{state.feedback}</p>}
    {view?.tokenId !== null && view?.tokenId !== undefined && <p className="mit-muted">Key #{view.tokenId} · 固定：{state.error || state.loading || view.loading.pins || view.pinsAt === null || view.errors.pins ? '尚未确认' : `已于 ${new Date(view.pinsAt).toLocaleString('zh-CN')} 读回`} · 路由：{state.error || state.loading || view.loading.routes || view.routesAt === null || view.errors.routes ? '尚未确认' : `已于 ${new Date(view.routesAt).toLocaleString('zh-CN')} 读回`}</p>}
    {!!leases.length && <details className="mit-a6-legacy-leases"><summary>旧版固定恢复（{leases.length}）</summary><p className="mit-muted">仅恢复旧版保存的固定租约。此入口使用每项列出的原 Key，不使用上方新选的操作 Key。</p>{leases.map(lease => {
      const key = operationRowKey(record.id,lease.model,lease.channelId);
      const feedback = state.results[key];
      return <div key={`${key}:${lease.tokenId}`} className="mit-a6-legacy-item"><span>{lease.model} · 渠道 #{lease.channelId} · 原 Key #{lease.tokenId} · {lease.stage}</span><button type="button" className="mit-button" disabled={busy || !current || config?.userId !== record.a6api?.accountId || Boolean(feedback?.pending)} onClick={() => store.actions.a6ResultAction({recordId:record.id,model:lease.model,channelId:lease.channelId,tokenId:lease.tokenId,operation:'restore'})}>恢复旧固定</button>{feedback?.error && <small className="mit-error" role="alert">{feedback.error}</small>}{feedback?.message && <small role="status">{feedback.message}</small>}</div>;
    })}</details>}
  </section>;
}
