import React,{ useMemo,useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { FuzzySelect,type FuzzyOption } from '../../components/FuzzySelect';
import { FIXED_TAGS,TAG_CATEGORIES,categoryOf,closeTag,tagColor,tagLabel } from '../../components/tags';

/** Chips + shared fuzzy menu (variant 2: category sidebar) for one tag target. `closeModels` adds 接近：<模型> choices. */
export function TagEditor({ store,target,closeModels = [] }: { store: Workbench; target: string; closeModels?: string[] }) {
  const map=useStore(store.tags,state => state.map);
  const menu=useStore(store.tags,state => state.menu);
  const query=useStore(store.tags,state => state.query);
  const category=useStore(store.tags,state => state.category);
  const current=map[target]??[];
  const open=menu===target;
  const options=useMemo<FuzzyOption[]>(() => {
    const seen=new Set<string>();
    const list: FuzzyOption[]=[];
    const add=(tag: string,cat: string) => {
      if(seen.has(tag))
        return;
      seen.add(tag);
      list.push({ value: tag,label: tagLabel(tag),category: cat,color: tagColor(tag) });
    };
    for(const fixed of FIXED_TAGS)
      add(fixed.tag,fixed.category);
    for(const model of closeModels)
      add(closeTag(model),'close');
    for(const tags of Object.values(map))
      for(const tag of tags)
        add(tag,categoryOf(tag)==='custom'? 'close':categoryOf(tag) as string);
    return list;
  },[closeModels,map]);
  return <div className="mit-tag-editor">
    {current.map(tag => <span className="mit-tag" key={tag} style={{ '--mit-tag': tagColor(tag) } as React.CSSProperties}>
      {tagLabel(tag)}
      <button type="button" aria-label={`移除标签 ${tagLabel(tag)}`} onClick={() => store.actions.tagsToggle(target,tag)}>×</button>
    </span>)}
    <FuzzySelect label="标签" buttonLabel="标签" trigger="button" placeholder="" emptyText="没有匹配的标签"
      options={options} selected={current} open={open} query={query} categories={TAG_CATEGORIES} category={category}
      onCategory={store.actions.tagsCategory} onOpen={() => store.actions.tagsMenu(target)} onClose={() => store.actions.tagsMenu(null)}
      onQuery={store.actions.tagsQuery} onToggle={tag => store.actions.tagsToggle(target,tag)} />
  </div>;
}

export function TagList({ store,target }: { store: Workbench; target: string }) {
  const tags=useStore(store.tags,state => state.map[target]);
  if(!tags?.length)
    return null;
  return <span className="mit-tag-list">
    {tags.map(tag => <span className="mit-tag" key={tag} style={{ '--mit-tag': tagColor(tag) } as React.CSSProperties}>{tagLabel(tag)}</span>)}
  </span>;
}
