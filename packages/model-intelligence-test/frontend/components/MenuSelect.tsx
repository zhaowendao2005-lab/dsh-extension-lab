import React from '../runtime';
import { Icon } from './common';
import { useDismissablePopover } from './useDismissablePopover';

export interface MenuOption<T extends string> {
  value: T;
  label: string;
}

export function MenuSelect<T extends string>({ label,value,options,open,onToggle,onClose,onChange }: {
  label: string;
  value: T;
  options: MenuOption<T>[];
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onChange(value: T): void;
}) {
  const root = useDismissablePopover(open,onClose);
  const current = options.find(option => option.value===value);
  return <div className="mit-menu-select" ref={root}>
    <span className="mit-menu-select-label">{label}</span>
    <button type="button" className="mit-menu-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}>
      <span>{current?.label??value}</span>
      <span className={open? 'mit-menu-chevron is-open':'mit-menu-chevron'}>
        <Icon name="chevron" size={12} />
      </span>
    </button>
    {open&&<div className="mit-menu-popover mit-frosted" role="listbox" aria-label={label}>
      {options.map(option => <button type="button" role="option" aria-selected={option.value===value} className={option.value===value? 'is-selected':''} key={option.value} onClick={() => {
        onChange(option.value);
        onClose();
      }}>
        <span>{option.label}</span>
        {option.value===value&&<Icon name="check" size={12} />}
      </button>)}
    </div>}
  </div>;
}
