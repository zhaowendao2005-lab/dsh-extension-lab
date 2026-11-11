import { h } from '../../../../runtime.js';

/** Leaf row: a runtime action or one package script. */
export function DebugItem({ node, depth, selected, running, onSelect }) {
  return h('button', {
    type: 'button',
    className: 'pds-tree-row',
    style: { '--depth': depth },
    'aria-selected': selected,
    disabled: node.disabled,
    onClick: () => onSelect(node),
  },
    h('span', { className: 'pds-tree-caret' }, ''),
    h('span', { className: 'pds-tree-glyph' }, node.glyph || ''),
    h('span', { className: 'pds-tree-label' }, node.label),
    running ? h('span', { className: 'pds-tree-state' }, '●') : null);
}
