import React,{ useMemo, useStore } from '../../runtime';
import type { RelayFidelity, Workbench } from '../../types';
import { Icon } from '../../components/common';
import { FuzzyMultiSelect, type FuzzyOption } from '../../components/FuzzyMultiSelect';
import { useDismissablePopover } from '../../components/useDismissablePopover';
import { RELAY_COLUMNS, RelayTable } from './RelayTable';
import { RelayDetail } from './RelayDetail';
import { RelayFavorites } from './RelayFavorites';
import { CURRENCY_LABELS } from '../../components/price';

function statusText(state: string, progress: number, pages: number): string {
  if (state === 'ready') return '快照就绪';
  if (state === 'building') return `读取渠道快照 ${progress}/${pages || '?'} 页`;
  if (state === 'error') return '快照失败';
  return '尚未读取';
}

const FIDELITY: {value: RelayFidelity; label: string; mark: string; title: string}[] = [
  {value: 'all', label: '全部', mark: '', title: '显示所有渠道'},
  {value: 'guaranteed', label: '保真', mark: '◆', title: '仅显示有保真认证的渠道'},
  {value: 'direct', label: '直连', mark: '→', title: '仅显示官方直连渠道'},
];

export function RelayPage({ store }: { store: Workbench }) {
  const sites=useStore(store.relay,state => state.sites);
  const sorts=useStore(store.relay,state => state.sorts);
  const siteId=useStore(store.relay,state => state.siteId);
  const status=useStore(store.relay,state => state.status);
  const brands=useStore(store.relay,state => state.brands);
  const models=useStore(store.relay,state => state.models);
  const total=useStore(store.relay,state => state.total);
  const filter=useStore(store.relay,state => state.filter);
  const menu=useStore(store.relay,state => state.menu);
  const columns=useStore(store.relay,state => state.columns);
  const columnsOpen=useStore(store.relay,state => state.columnsOpen);
  const detail=useStore(store.relay,state => state.detail);
  const error=useStore(store.relay,state => state.error);
  const loading=useStore(store.relay,state => state.loading);
  const view=useStore(store.relay,state => state.view);
  const currency=useStore(store.relay,state => state.currency);
  const retrying=useStore(store.relay,state => state.retrying);
  const favoriteCount=useStore(store.relay,state => state.partitions.find(partition => partition.id==='favorites')?.items.length??0);
  const chooser=useDismissablePopover(columnsOpen,() => store.actions.toggleRelayColumns());
  const site=sites.find(item => item.id===siteId);
  const brandOptions=useMemo<FuzzyOption[]>(() => brands.map(brand => ({value: brand.name, label: brand.name, count: brand.count})),[brands]);
  const modelOptions=useMemo<FuzzyOption[]>(() => {
    const scope=filter.brands.length? new Set(filter.brands):null;
    const merged=new Map<string,FuzzyOption>();
    for (const facet of models) {
      if (scope&&!scope.has(facet.brand)) continue;
      const existing=merged.get(facet.name);
      if (existing) {
        existing.count=(existing.count??0)+facet.count;
        if (existing.hint&&facet.brand&&!existing.hint.split(' · ').includes(facet.brand)) existing.hint=`${existing.hint} · ${facet.brand}`;
      } else merged.set(facet.name,{value: facet.name, label: facet.name, count: facet.count, hint: facet.brand||undefined});
    }
    return [...merged.values()];
  },[models,filter.brands]);
  return <div className={detail? 'mit-relay-page has-detail':'mit-relay-page'}>
    <aside className="mit-relay-sites" aria-label="适配站点">
      <p className="mit-kicker">SOURCES</p>
      <strong>适配站点</strong>
      {sites.map(item => <button type="button" key={item.id} className={`mit-relay-site ${item.id===siteId? 'is-active':''}`} onClick={() => store.actions.relaySite(item.id)}>
        <span>{item.label}</span>
        <small>{item.anonymous? '匿名只读' : '需要登录'}</small>
      </button>)}
      <p className="mit-relay-note">{site?.note ?? '读取站点公开数据。'}</p>
      <a className="mit-relay-docs" href={site?.docsUrl} target="_blank" rel="noreferrer">开发者文档</a>
    </aside>
    <section className="mit-relay-main">
      <header className="mit-relay-heading">
        <div>
          <p className="mit-kicker">RELAY ADAPTER / {site?.name ?? '—'}</p>
          <h1>中转站来源适配</h1>
          <p className="mit-muted">按渠道挂载展示公开模型列表；字段与官方页面一一对应，不做聚合改写。</p>
        </div>
        <button type="button" className="mit-text-button" onClick={store.actions.relayRefresh} disabled={loading}>
          <Icon name="refresh" size={14} />{status.stale? '快照已过期 · 刷新' : '刷新快照'}
        </button>
      </header>
      <div className="mit-relay-viewbar">
        <div className="mit-relay-segment" role="tablist" aria-label="页面">
          <button type="button" role="tab" aria-selected={view==='list'} className={view==='list'? 'is-active':''} onClick={() => store.actions.relayView('list')}>渠道列表</button>
          <button type="button" role="tab" aria-selected={view==='favorites'} className={view==='favorites'? 'is-active':''} onClick={() => store.actions.relayView('favorites')}>收藏 · {favoriteCount}</button>
        </div>
        <div className="mit-relay-segment" role="radiogroup" aria-label="价格单位">
          {(['usd','cny'] as const).map(unit => <button type="button" role="radio" aria-checked={currency===unit} key={unit} className={currency===unit? 'is-active':''} onClick={() => store.actions.relayCurrency(unit)}>{CURRENCY_LABELS[unit]}</button>)}
        </div>
      </div>
      {view==='favorites'? <RelayFavorites store={store} />:<>
      <div className="mit-relay-filterbox" role="group" aria-label="筛选">
        <div className="mit-relay-frow">
          <span className="mit-relay-flabel">提供商</span>
          <FuzzyMultiSelect label="提供商" placeholder="全部提供商" emptyText="没有匹配的提供商"
            options={brandOptions} selected={filter.brands} open={menu.open==='brand'} query={menu.brandQuery}
            onOpen={() => store.actions.relayMenu('brand')} onClose={() => store.actions.relayMenu(null)}
            onQuery={query => store.actions.relayMenuQuery('brand',query)} onToggle={store.actions.relayToggleBrand}
            onClear={() => store.actions.relayClearFilter('brand')} />
        </div>
        <div className="mit-relay-frow">
          <span className="mit-relay-flabel">模型</span>
          <FuzzyMultiSelect label="模型" placeholder={filter.brands.length? `已选提供商下的全部模型（${modelOptions.length}）`:'全部模型'} emptyText="没有匹配的模型"
            options={modelOptions} selected={filter.models} open={menu.open==='model'} query={menu.modelQuery}
            onOpen={() => store.actions.relayMenu('model')} onClose={() => store.actions.relayMenu(null)}
            onQuery={query => store.actions.relayMenuQuery('model',query)} onToggle={store.actions.relayToggleModel}
            onClear={() => store.actions.relayClearFilter('model')} />
        </div>
        <div className="mit-relay-frow">
          <span className="mit-relay-flabel">保真</span>
          <div className="mit-relay-segment" role="radiogroup" aria-label="保真">
            {FIDELITY.map(option => <button type="button" role="radio" aria-checked={filter.fidelity===option.value} key={option.value} title={option.title}
              className={filter.fidelity===option.value? 'is-active':''} onClick={() => store.actions.relayFidelity(option.value)}>
              {option.mark&&<i className={`is-${option.value}`} aria-hidden="true">{option.mark}</i>}{option.label}
            </button>)}
          </div>
        </div>
        <div className="mit-relay-frow">
          <span className="mit-relay-flabel">排序</span>
          <div className="mit-relay-segment is-sort" role="radiogroup" aria-label="排序">
            {sorts.map(sort => <button type="button" role="radio" aria-checked={filter.sort===sort.id} key={sort.id}
              className={filter.sort===sort.id? 'is-active':''} onClick={() => store.actions.relaySort(sort.id)}>{sort.label}</button>)}
          </div>
          <div className="mit-relay-ftools">
            <div className="mit-relay-columns" ref={chooser}>
              <button type="button" className="mit-text-button" aria-expanded={columnsOpen} onClick={store.actions.toggleRelayColumns}>
                <Icon name="settings" size={14} />列（{columns.length}）
              </button>
              {columnsOpen&&<div className="mit-relay-column-menu mit-frosted" role="dialog" aria-label="选择列">
                {RELAY_COLUMNS.map(column => <label key={column.id}>
                  <input type="checkbox" checked={columns.includes(column.id)} onChange={() => store.actions.toggleRelayColumn(column.id)} />
                  {column.label}
                </label>)}
              </div>}
            </div>
          </div>
        </div>
      </div>
      <div className="mit-relay-countbar">
        <span className="mit-relay-count"><b>{total.toLocaleString('zh-CN')}</b> 条渠道 · {statusText(status.state,status.progress,status.pages)}</span>
      </div>
      {status.state==='building'&&<div className="mit-relay-progress" role="status">
        <span style={{width:`${Math.max(4,Math.round(status.progress/Math.max(1,status.pages)*100))}%`}} />
        <em>正在读取公开渠道快照。首次读取需要逐页拉取，之后 10 分钟内直接使用缓存。</em>
      </div>}
      {(error||status.error)&&<p className="mit-relay-error" role="alert">{error||status.error}
        {status.partial&&<button type="button" className="mit-text-button" disabled={retrying} onClick={store.actions.relayRetryMissing}>{retrying? '补抓中…':`补抓失败页（${status.missingPages??0}）`}</button>}
        <button type="button" className="mit-text-button" onClick={store.actions.relayRefresh}>重新读取</button>
      </p>}
      {status.missing&&status.missing.length>0&&<details className="mit-relay-missing"><summary>失败页明细（{status.missing.length}）</summary>
        <ul>{status.missing.map(page => <li key={page.page}>第 {page.page} 页 · {page.status? `HTTP ${page.status}`:page.code} · {page.message}</li>)}</ul>
      </details>}
      <RelayTable store={store} />
      </>}
      <p className="mit-relay-foot">价格单位：{currency==='cny'? `人民币 / 百万 Token（按上游实时汇率 ${(status.exchangeRate??6.7).toFixed(2)} 换算）`:'美元 / 百万 Token'}；成功率与缓存命中来自中转站公开统计；实时柱为最近 10 个采样桶。固定商家、加入路由和模型检测需要登录，请在设置「API 适配站点」填写系统访问令牌与用户 ID。</p>
    </section>
    {detail&&<RelayDetail store={store} row={detail} key={detail.rowKey} />}
  </div>;
}
