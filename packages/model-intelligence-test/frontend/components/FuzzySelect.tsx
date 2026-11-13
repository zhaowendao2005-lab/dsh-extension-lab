import React, { useEffect, useMemo, useRef } from '../runtime';
import { Icon } from './common';
import { fuzzyRank } from './fuzzy';
import { useDismissablePopover } from './useDismissablePopover';

export interface FuzzyOption {
  value: string;
  label: string;
  count?: number;
  /** Secondary text, also searched (e.g. the brand of a model). */
  hint?: string;
  /** Category id, matched against `categories` in the sidebar variant. */
  category?: string;
  /** Optional swatch colour (tags). */
  color?: string;
}
export interface FuzzyCategory { id: string; label: string }

const LIST_LIMIT = 240;

function Highlight({ text,positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const marks = new Set(positions);
  const parts: { text: string; hit: boolean }[] = [];
  for (let index = 0; index<text.length; index += 1) {
    const hit = marks.has(index);
    const last = parts[parts.length-1];
    if (last&&last.hit===hit) last.text += text[index];
    else parts.push({ text: text[index],hit });
  }
  return <>{parts.map((part,index) => part.hit? <mark key={index}>{part.text}</mark>:<span key={index}>{part.text}</span>)}</>;
}

/**
 * Shared fuzzy select (controlled, holds no state).
 *  - mode `multi` (default): menu stays open, chips in the field trigger; `single`: picking closes the menu.
 *  - variant 1 (default): search + list. Variant 2: pass `categories` for a left category sidebar.
 *  - trigger `field` (chips, default) or `button` (compact action button, used for tags).
 */
export function FuzzySelect({ label,placeholder,emptyText,options,selected,open,query,mode = 'multi',trigger = 'field',buttonLabel,categories,category = 'all',onCategory,onOpen,onClose,onQuery,onToggle,onClear }: {
  label: string;
  placeholder: string;
  emptyText?: string;
  options: FuzzyOption[];
  selected: string[];
  open: boolean;
  query: string;
  mode?: 'multi' | 'single';
  trigger?: 'field' | 'button';
  buttonLabel?: string;
  categories?: FuzzyCategory[];
  category?: string;
  onCategory?(id: string): void;
  onOpen(): void;
  onClose(): void;
  onQuery(query: string): void;
  onToggle(value: string): void;
  onClear?(): void;
}) {
  const root = useDismissablePopover(open,onClose);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  },[open]);
  const scoped = useMemo(() => categories&&category!=='all'? options.filter(option => option.category===category):options,[options,categories,category]);
  const ranked = useMemo(() => open? fuzzyRank(scoped,query,option => option.label):[],[open,scoped,query]);
  const chosen = useMemo(() => new Set(selected),[selected]);
  const labelOf = (value: string) => options.find(option => option.value===value)?.label??value;
  const visible = ranked.slice(0,LIST_LIMIT);
  const multi = mode==='multi';
  const pick = (value: string) => {
    onToggle(value);
    if (!multi) onClose();
  };
  return <div className={`mit-fuzzy ${open? 'is-open':''} ${trigger==='button'? 'is-button':''}`} ref={root}>
    {trigger==='button'
      ? <button type="button" className="mit-fuzzy-add" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => open? onClose():onOpen()}>
        <Icon name="plus" size={12} />{buttonLabel??label}
      </button>
      : <div className="mit-fuzzy-trigger" role="button" tabIndex={0} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => open? onClose():onOpen()}
        onKeyDown={event => {
          if (event.key==='Enter'||event.key===' '||event.key==='ArrowDown') {
            event.preventDefault();
            onOpen();
          }
        }}>
        {selected.length? <span className="mit-fuzzy-chips">
          {selected.map(value => <span className="mit-fuzzy-chip" key={value}>
            <span>{labelOf(value)}</span>
            <button type="button" aria-label={`移除 ${labelOf(value)}`} onClick={event => {
              event.stopPropagation();
              onToggle(value);
            }}>×</button>
          </span>)}
        </span>:<span className="mit-fuzzy-placeholder">{placeholder}</span>}
        <span className="mit-fuzzy-tools">
          {selected.length>0&&onClear&&<button type="button" className="mit-fuzzy-clear" onClick={event => {
            event.stopPropagation();
            onClear();
          }}>清除</button>}
          <span className={open? 'mit-menu-chevron is-open':'mit-menu-chevron'}><Icon name="chevron" size={12} /></span>
        </span>
      </div>}
    {open&&<div className={`mit-fuzzy-popover mit-frosted ${categories? 'has-sidebar':''}`} role="dialog" aria-label={label}>
      {categories&&<nav className="mit-fuzzy-sidebar" aria-label="分类">
        {[{ id: 'all',label: '全部' },...categories].map(item => <button type="button" key={item.id} className={item.id===category? 'is-active':''} onClick={() => onCategory?.(item.id)}>
          {item.label}
        </button>)}
      </nav>}
      <div className="mit-fuzzy-body">
        <label className="mit-fuzzy-search">
          <Icon name="search" size={13} />
          <input ref={input} value={query} placeholder="模糊搜索，如 ds v3 / cl sonnet" aria-label={`${label}搜索`} onChange={event => onQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key==='Enter'&&visible[0]) {
                event.preventDefault();
                pick(visible[0].item.value);
              }
            }} />
          <span className="mit-fuzzy-total">{selected.length&&multi? `已选 ${selected.length}`:`${scoped.length}`}</span>
        </label>
        <div className="mit-fuzzy-list" role="listbox" aria-multiselectable={multi}>
          {visible.map(({ item,positions }) => {
            const active = chosen.has(item.value);
            return <button type="button" role="option" aria-selected={active} key={item.value} className={active? 'mit-fuzzy-option is-selected':'mit-fuzzy-option'} onClick={() => pick(item.value)}>
              <span className="mit-fuzzy-check" aria-hidden="true">{active&&<Icon name="check" size={11} />}</span>
              {item.color&&<i className="mit-fuzzy-swatch" style={{ background: item.color }} aria-hidden="true" />}
              <span className="mit-fuzzy-label"><Highlight text={item.label} positions={positions} /></span>
              {item.hint&&<span className="mit-fuzzy-hint">{item.hint}</span>}
              {item.count!==undefined&&<span className="mit-fuzzy-count">{item.count.toLocaleString('zh-CN')}</span>}
            </button>;
          })}
          {!visible.length&&<p className="mit-fuzzy-empty">{emptyText??'没有匹配项'}</p>}
          {ranked.length>LIST_LIMIT&&<p className="mit-fuzzy-more">另有 {ranked.length-LIST_LIMIT} 项，请继续输入缩小范围</p>}
        </div>
      </div>
    </div>}
  </div>;
}
