import { h } from '../../../../runtime.js';
import { terminalStateGlyph, terminalTitle } from '../../../../service/terminal.service.js';

/** One tab: glyph, title (command id or 终端 N), state dot, close button. */
export function TerminalTab({ terminal, index, selected, onSelect, onClose }) {
  const title = terminalTitle(terminal, index);
  return h('div', {
    role: 'tab', tabIndex: 0, className: 'pds-terminal-tab',
    'aria-selected': selected,
    onClick: onSelect,
    onKeyDown: (event) => { if (event.key === 'Enter') onSelect(); },
  },
    h('span', null, '›_'),
    h('span', { className: 'pds-terminal-tab-label' }, title),
    h('span', { className: 'pds-term-state' }, terminalStateGlyph(terminal.state)),
    h('button', {
      type: 'button', className: 'pds-icon-button', title: '关闭并终止终端', 'aria-label': `关闭终端 ${title}`,
      onClick: (event) => { event.stopPropagation(); onClose(); },
    }, '×'));
}
