import { h } from '../../../../runtime.js';
import { DebugItem } from './DebugItem.js';

/** One plugin-script group row plus its script rows. */
export function DebugGroup({ group, open, selected, runningCommandId, onToggle, onSelect }) {
  const isRuntime = group.id === 'runtime';
  return h('div', null,
    h('button', {
      type: 'button', className: 'pds-tree-row', style: { '--depth': 0 }, 'aria-expanded': open, onClick: onToggle,
    },
      h('span', { className: 'pds-tree-caret' }, open ? '⌄' : '›'),
      h('span', { className: 'pds-tree-glyph' }, group.glyph),
      h('span', { className: 'pds-tree-label' }, group.label),
      !isRuntime && group.items.length ? h('span', { className: 'pds-tree-state' }, group.items.length) : null),
    open ? group.items.map((node) => h(DebugItem, {
      key: node.id, node, depth: 1, selected: selected === node.id,
      running: Boolean(node.commandId) && runningCommandId === node.commandId,
      onSelect,
    })) : null,
    !isRuntime && open && group.items.length === 0 ? h('div', { className: 'pds-model-hint' }, '没有匹配的脚本') : null);
}
