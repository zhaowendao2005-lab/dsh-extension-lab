import { h } from '../runtime.js';

/** Collapsible sidebar section. Expansion state is owned by the store. */
export function Section({ id, title, count, expanded, onToggle, children }) {
  return h('section', { className: 'pds-section' },
    h('button', {
      type: 'button', className: 'pds-section-head', 'aria-expanded': expanded, 'aria-controls': `pds-${id}`, onClick: onToggle,
    },
      h('span', { className: 'pds-section-caret' }, expanded ? '⌄' : '›'),
      h('span', { className: 'pds-section-title' }, title),
      count === undefined ? null : h('span', { className: 'pds-section-count' }, count)),
    expanded ? h('div', { id: `pds-${id}` }, children) : null);
}
