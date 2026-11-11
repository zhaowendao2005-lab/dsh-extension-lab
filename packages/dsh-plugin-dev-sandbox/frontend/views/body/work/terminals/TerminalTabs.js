import { h } from '../../../../runtime.js';
import { TerminalTab } from './TerminalTab.js';

/** Tab strip with the new-terminal button on the right. */
export function TerminalTabs({ terminals, activeId, canCreate, onSelect, onClose, onAdd }) {
  return h('div', { className: 'pds-termbar' },
    terminals.map((terminal, index) => h(TerminalTab, {
      key: terminal.id,
      terminal,
      index,
      selected: terminal.id === activeId,
      onSelect: () => onSelect(terminal.id),
      onClose: () => onClose(terminal.id),
    })),
    h('button', {
      type: 'button', className: 'pds-icon-button pds-term-add', title: '新建终端', 'aria-label': '新建终端',
      disabled: !canCreate, onClick: onAdd,
    }, '+'));
}
