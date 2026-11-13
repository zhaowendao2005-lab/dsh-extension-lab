import React,{ useMemo,useStore } from '../../runtime';
import type { Model,Partition,PartitionItem,Workbench } from '../../types';
import { Icon } from '../../components/common';
import { TagList } from '../tags/TagEditor';
import { relayTarget } from '../../components/tags';
import { useDismissablePopover } from '../../components/useDismissablePopover';

const RELAY_PREFIX='relay:';

/** Relay chip label: `a6api #<channelId> · <model>`. */
function relayLabel(model: Model): string {
  const relay=model.relay;
  return relay? `${relay.siteId||'a6api'} #${relay.channelId} · ${relay.model}`:model.name;
}

/** PartitionItem behind a selected relay key; synthesized from the Model when it left every partition. */
function relayItemFor(key: string,model: Model,partitions: Partition[]): PartitionItem {
  const itemKey=key.startsWith(RELAY_PREFIX)? key.slice(RELAY_PREFIX.length):key;
  for(const partition of partitions) {
    const found=partition.items.find(item => item.key===itemKey);
    if(found)
      return found;
  }
  const relay=model.relay;
  return {
    key: itemKey,
    partitionId: '',
    tags: [],
    siteId: relay?.siteId??'a6api',
    channelId: relay?.channelId??0,
    model: relay?.model??model.id,
    brand: '',
    supplier: '',
    channelName: '',
    testEndpoint: '',
    api: relay?.api??null,
    addedAt: 0,
  };
}

function DshOptions({ store }: {
  store: Workbench;
}) {
  const draft=useStore(store.draft,value => value);
  const models=useStore(store.models,value => value);
  const groups=useMemo(() => {
    const query=draft.query.trim().toLocaleLowerCase();
    return models.providers.map(provider => ({ provider,items: models.items.filter(model => model.provider===provider.id&&(!query||model.search.includes(query))) })).filter(group => group.items.length||group.provider.error);
  },[draft.query,models.items,models.providers]);
  if(models.loading&&!models.items.length)
    return <p className="mit-muted">正在读取模型目录…</p>;
  if(!groups.length)
    return <p className="mit-muted">没有匹配的模型</p>;
  return <>
    {groups.map(({ provider,items }) => <section className="mit-model-group" key={provider.id}>
      <h4>
        {provider.name}
        <span>{items.length}</span>
      </h4>
      {provider.error&&<p className="mit-error">{provider.error}</p>}
      <div className="mit-model-options-grid">
        {items.map(model => <label key={model.key} className={`mit-model-option ${draft.selected.includes(model.key)? 'is-selected':''}`}>
          <input type="checkbox" checked={draft.selected.includes(model.key)} onChange={() => store.actions.toggleModel(model.key)} />
          <span>
            <strong>{model.name}</strong>
            <small>{model.id}</small>
          </span>
        </label>)}
      </div>
    </section>)}
  </>;
}

function PartitionOptions({ store,partition }: {
  store: Workbench;
  partition: Partition|undefined;
}) {
  const query=useStore(store.draft,value => value.query);
  const relaySelected=useStore(store.draft,value => value.relaySelected);
  const resolved=useStore(store.relay,value => value.resolved);
  const items=useMemo(() => {
    const q=query.trim().toLocaleLowerCase();
    const list=partition?.items??[];
    return q? list.filter(item => `${item.channelId} ${item.model} ${item.supplier} ${item.channelName} ${item.brand} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(q)):list;
  },[partition,query]);
  if(!partition)
    return <p className="mit-muted">请选择左侧的中转分区。</p>;
  if(!partition.items.length)
    return <div className="mit-picker-empty">
      <strong>{partition.name} 暂无渠道</strong>
      <p className="mit-muted">在「中转站来源适配」页把渠道收藏或加入分区。</p>
    </div>;
  if(!items.length)
    return <p className="mit-muted">没有匹配的渠道</p>;
  return <section className="mit-model-group">
    <h4>
      {partition.name}
      <span>{items.length}</span>
    </h4>
    <div className="mit-relay-options">
      {items.map(item => {
        const checked=Boolean(relaySelected[`${RELAY_PREFIX}${item.key}`]);
        const expired=resolved[`${item.channelId}|${item.model}`]?.found===false;
        return <label key={item.key} className={`mit-relay-option ${checked? 'is-selected':''} ${expired? 'is-expired':''}`}>
          <input type="checkbox" checked={checked} disabled={expired&&!checked} onChange={() => store.actions.toggleRelayItem(item)} />
          <span className="mit-relay-option-channel mit-tabular">#{item.channelId}</span>
          <span className="mit-relay-option-main">
            <strong>{item.model}</strong>
            <small>{item.supplier||item.channelName||'未知供应商'}</small>
          </span>
          <span className="mit-relay-option-tags">
            {item.tags.map(tag => <span key={tag} className="mit-relay-tag">{tag}</span>)}
            <TagList store={store} target={relayTarget(item.siteId,item.channelId,item.model)} />
            {expired&&<em className="mit-expired">已过期</em>}
            {expired&&<button type="button" className="mit-text-button is-danger" onClick={event => {
              event.preventDefault();
              store.actions.relayClearExpired(item.siteId,item.channelId,item.model);
            }}>清除</button>}
          </span>
          <span className={`mit-relay-api ${item.api? '':'is-missing'}`}>{item.api??'无接口'}</span>
        </label>;
      })}
    </div>
  </section>;
}

export function ModelPicker({ store }: {
  store: Workbench;
}) {
  const draft=useStore(store.draft,value => value);
  const models=useStore(store.models,value => value);
  const partitions=useStore(store.relay,value => value.partitions);
  const partitionsError=useStore(store.relay,value => value.partitionsError);
  const apiKeyMissing=useStore(store.settings,value => value.status?.apiKey.configured===false);
  const ordered=useMemo(() => [...partitions].sort((a,b) => Number(b.builtin)-Number(a.builtin)),[partitions]);
  const selected=useMemo(() => new Map(models.items.map(model => [model.key,model])),[models.items]);
  const relayEntries=Object.entries(draft.relaySelected);
  const total=draft.selected.length+relayEntries.length;
  const activePartition=draft.source==='partition'? ordered.find(partition => partition.id===draft.partitionId):undefined;
  const pickerRoot=useDismissablePopover(draft.pickerOpen,() => store.actions.patchDraft({ pickerOpen: false }));
  return <div className="mit-model-picker" ref={pickerRoot}>
    <div className="mit-label-row">
      <label id={`${store.sessionId}-mit-model-label`}>参测模型
        <span className="mit-muted">{total} 个已选</span>
      </label>
      <button type="button" className="mit-text-button" disabled={models.loading} onClick={store.actions.refreshModels}>
        <Icon name="refresh" />
        {models.loading? '加载中':'刷新目录'}
      </button>
    </div>
    <div className="mit-selected-models" aria-labelledby={`${store.sessionId}-mit-model-label`}>
      {draft.selected.map(key => <span className="mit-model-tag" key={key}>
        <span>{selected.get(key)?.providerName} / {selected.get(key)?.name||key}</span>
        <button type="button" className="mit-tag-remove" aria-label={`移除 ${selected.get(key)?.name||key}`} onClick={() => store.actions.toggleModel(key)}>
          <Icon name="close" size={12} />
        </button>
      </span>)}
      {relayEntries.map(([key,model]) => <span className="mit-model-tag is-relay" key={key}>
        <span>{relayLabel(model)}</span>
        <button type="button" className="mit-tag-remove" aria-label={`移除 ${relayLabel(model)}`} onClick={() => store.actions.toggleRelayItem(relayItemFor(key,model,partitions))}>
          <Icon name="close" size={12} />
        </button>
      </span>)}
      <button type="button" className="mit-picker-toggle" aria-expanded={draft.pickerOpen} aria-controls={`${store.sessionId}-mit-model-options`} onClick={() => store.actions.patchDraft({ pickerOpen: !draft.pickerOpen })}>
        <Icon name="plus" />
        {total? '添加模型':'选择一个或多个模型'}
      </button>
    </div>
    {models.error&&<p role="alert" className="mit-error">{models.error}</p>}
    {relayEntries.length>0&&apiKeyMissing&&<p className="mit-info mit-relay-hint">中转渠道需要在设置中配置 a6api API Key 后才能测试。</p>}

    {draft.pickerOpen&&<div className="mit-picker-popover mit-frosted mit-picker-split" id={`${store.sessionId}-mit-model-options`}>
      <nav className="mit-picker-sources" aria-label="模型来源">
        <button type="button" className={`mit-picker-source ${draft.source==='dsh'? 'is-active':''}`} aria-current={draft.source==='dsh'? 'true':undefined} onClick={() => store.actions.setDraftSource('dsh')}>
          DSH 模型
          <span className="mit-tabular">{draft.selected.length||''}</span>
        </button>
        <div className="mit-picker-source-group">
          <span className="mit-picker-source-title">中转渠道</span>
          {ordered.map(partition => {
            const count=partition.items.filter(item => draft.relaySelected[`${RELAY_PREFIX}${item.key}`]).length;
            const active=draft.source==='partition'&&draft.partitionId===partition.id;
            return <button key={partition.id} type="button" className={`mit-picker-source is-child ${active? 'is-active':''}`} aria-current={active? 'true':undefined} onClick={() => store.actions.setDraftSource('partition',partition.id)}>
              <span className="mit-picker-source-name">{partition.name}</span>
              <span className="mit-tabular">{count? `${count}/${partition.items.length}`:partition.items.length}</span>
            </button>;
          })}
          {!ordered.length&&<span className="mit-muted mit-picker-source-empty">暂无分区</span>}
          {partitionsError&&<span className="mit-error mit-picker-source-empty">{partitionsError}</span>}
        </div>
      </nav>
      <div className="mit-picker-main">
        <div className="mit-search">
          <Icon name="search" />
          <input autoFocus aria-label={draft.source==='dsh'? '搜索模型或供应商':'搜索渠道、模型或供应商'} placeholder={draft.source==='dsh'? '搜索模型、供应商、拼音或首字母…':'搜索渠道 ID、模型、供应商或标签…'} value={draft.query} onChange={event => store.actions.patchDraft({ query: event.currentTarget.value })} />
          <button type="button" className="mit-icon-button" aria-label="收起模型选择" onClick={() => store.actions.patchDraft({ pickerOpen: false })}>
            <Icon name="close" />
          </button>
        </div>
        {draft.source==='partition'&&apiKeyMissing&&<p className="mit-info mit-relay-hint">中转渠道使用 a6api API Key（按 sk-KEY-&lt;渠道ID&gt; 定向），请先在设置中配置。</p>}
        <div className="mit-picker-options">
          {draft.source==='dsh'? <DshOptions store={store} />:<PartitionOptions store={store} partition={activePartition} />}
        </div>
      </div>
    </div>}
  </div>;
}
