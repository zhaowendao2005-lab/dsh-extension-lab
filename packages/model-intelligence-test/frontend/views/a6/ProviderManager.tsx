import React,{useStore} from '../../runtime';
import type {A6ProviderMatch,Workbench} from '../../types';

export const MATCH_LABELS: Record<A6ProviderMatch,string> = {exact:'已精确匹配',pending:'正在核对',stale:'待重新核对',ambiguous:'存在多个候选',unmatched:'未匹配',unsupported:'暂不支持此认证',error:'匹配失败'};
export function ProviderManager({store}: {store: Workbench}) {
  const state = useStore(store.a6Insights, value => value);
  const config = useStore(store.a6, value => value.config);
  const view = state.providers;
  const query = state.query.trim().toLowerCase();
  const providers = view?.providers.filter(provider => `${provider.name} ${provider.id}`.toLowerCase().includes(query)) ?? [];
  const unavailable = !config?.configured || !view?.accountId;
  const panelId = `${store.sessionId}-a6-provider-manager`;
  return <section className="mit-a6-provider-section" aria-label="a6api 提供商管理">
    <div className="mit-label-row"><button type="button" className="mit-button" aria-expanded={state.managerOpen} aria-controls={panelId} onClick={store.actions.toggleA6Providers}>管理 a6api 提供商</button>
      <span className="mit-muted" role="status">{state.loading ? '正在读取…' : view?.scanning ? '后台匹配中…' : view?.accountId ? `账号 ${view.accountId} · ${view.providers.filter(provider => provider.state === 'exact').length} 个已匹配` : '尚未加载匹配状态'}</span>
    </div>
    {state.managerOpen && <div id={panelId} className="mit-a6-provider-panel">
      <p className="mit-muted">搜索并勾选要参与匹配的 DSH 提供商；匹配和选择不会修改 DSH 配置。固定与加入路由需在结果行明确执行。</p>
      {!config?.configured && <p className="mit-error" role="alert">请先在功能中心配置并验证 a6api 账号。</p>}
      {config?.configured && <p className="mit-muted">当前账户：{config.userId} · {view?.tokens.length ?? 0} 个站点令牌</p>}
      <label className="mit-field">搜索 DSH 提供商<input type="search" value={state.query} placeholder="提供商名称或 ID" onChange={event => store.actions.setA6ProviderQuery(event.currentTarget.value)} /></label>
      <div className="mit-a6-provider-list" aria-busy={Boolean(state.loading || view?.scanning)}>{providers.map(provider => <label className="mit-a6-provider-item" key={provider.id}>
        <input type="checkbox" checked={state.selected.includes(provider.id)} disabled={state.saving || unavailable} onChange={() => store.actions.toggleA6Provider(provider.id)} />
        <span><strong>{provider.name || provider.id}</strong><small className="mit-muted">{provider.id} · {MATCH_LABELS[provider.state]}{provider.tokenIds.length ? ` · 令牌 ${provider.tokenIds.map(id => `#${id}`).join(', ')}` : ''}</small>{provider.error && <small className="mit-error">{provider.error}</small>}</span>
      </label>)}
        {!providers.length && <p className="mit-muted">{state.loading ? '正在读取提供商目录…' : query ? '没有匹配的提供商，试试名称或 ID。' : '没有可显示的 DSH 提供商。'}</p>}
      </div>
      <div className="mit-a6-actions"><button type="button" className="mit-button" disabled={state.saving || state.loading || unavailable} onClick={store.actions.saveA6Providers}>{state.saving ? '保存中…' : `保存选择（${state.selected.length}）`}</button><button type="button" className="mit-button" disabled={state.loading || state.saving || unavailable || Boolean(view?.scanning)} onClick={() => store.actions.refreshA6Providers(true)}>{view?.scanning ? '匹配进行中…' : '重新核对匹配'}</button></div>
      {(state.error || view?.error) && <p className="mit-error" role="alert">{state.error || view?.error}</p>}
      {state.feedback && <p className="mit-muted" role="status">{state.feedback}</p>}
    </div>}
  </section>;
}
