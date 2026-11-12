import React,{ useMemo,useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { Icon } from '../../components/common';
import { useDismissablePopover } from '../../components/useDismissablePopover';
export function ModelPicker({ store }: {
  store: Workbench;
}) {
  const draft=useStore(store.draft,value => value);
  const models=useStore(store.models,value => value);
  const groups=useMemo(() => {
    const query=draft.query.trim().toLocaleLowerCase();
    return models.providers.map(provider => ({ provider,items: models.items.filter(model => model.provider===provider.id&&(!query||model.search.includes(query))) })).filter(group => group.items.length||group.provider.error);
  },[draft.query,models.items,models.providers]);
  const selected=useMemo(() => new Map(models.items.map(model => [model.key,model])),[models.items]);
  const pickerRoot=useDismissablePopover(draft.pickerOpen,() => store.actions.patchDraft({ pickerOpen: false }));
  return <div className="mit-model-picker" ref={pickerRoot}>
    <div className="mit-label-row">
      <label id={`${store.sessionId}-mit-model-label`}>参测模型
        <span className="mit-muted">
          {draft.selected.length} 个已选
        </span>
      </label>
      <button type="button" className="mit-text-button" disabled={models.loading} onClick={store.actions.refreshModels}>
        <Icon name="refresh" />
        {models.loading? '加载中':'刷新目录'}
      </button>
    </div>
    <div className="mit-selected-models" aria-labelledby={`${store.sessionId}-mit-model-label`}>

      {draft.selected.map(key => <span className="mit-model-tag" key={key}>
        <span>
          {selected.get(key)?.providerName} /
          {selected.get(key)?.name||key}
        </span>
        <button type="button" className="mit-tag-remove" aria-label={`移除 ${selected.get(key)?.name||key}`} onClick={() => store.actions.toggleModel(key)}>
          <Icon name="close" size={12} />
        </button>
      </span>)}

      <button type="button" className="mit-picker-toggle" aria-expanded={draft.pickerOpen} aria-controls={`${store.sessionId}-mit-model-options`} onClick={() => store.actions.patchDraft({ pickerOpen: !draft.pickerOpen })}>
        <Icon name="plus" />
        {draft.selected.length? '添加模型':'选择一个或多个模型'}
      </button>
    </div>

    {models.error&&<p role="alert" className="mit-error">
      {models.error}
    </p>}

    {draft.pickerOpen&&<div className="mit-picker-popover mit-frosted" id={`${store.sessionId}-mit-model-options`}>
      <div className="mit-search">
        <Icon name="search" />
        <input autoFocus aria-label="搜索模型或供应商" placeholder="搜索模型、供应商、拼音或首字母…" value={draft.query} onChange={event => store.actions.patchDraft({ query: event.currentTarget.value })} />
        <button type="button" className="mit-icon-button" aria-label="收起模型选择" onClick={() => store.actions.patchDraft({ pickerOpen: false })}>
          <Icon name="close" />
        </button>
      </div>
      <div className="mit-picker-options">
        {models.loading&&!models.items.length? <p className="mit-muted">正在读取模型目录…
        </p>:groups.length===0? <p className="mit-muted">没有匹配的模型
        </p>:groups.map(({ provider,items }) => <section className="mit-model-group" key={provider.id}>
          <h4>
            {provider.name}
            <span>
              {items.length}
            </span>
          </h4>
          {provider.error&&<p className="mit-error">
            {provider.error}
          </p>}
          <div className="mit-model-options-grid">
            {items.map(model => <label key={model.key} className={`mit-model-option ${draft.selected.includes(model.key)? 'is-selected':''}`}>
              <input type="checkbox" checked={draft.selected.includes(model.key)} onChange={() => store.actions.toggleModel(model.key)} />
              <span>
                <strong>
                  {model.name}
                </strong>
                <small>
                  {model.id}
                </small>
              </span>
            </label>)}
          </div>
        </section>)}
      </div>
    </div>}

  </div>;
}
