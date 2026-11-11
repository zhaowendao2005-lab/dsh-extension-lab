import { h } from '../../../runtime.js';
import { activeTerminalOf } from '../../../service/terminal.service.js';
import { TerminalTabs } from './terminals/TerminalTabs.js';
import { TerminalView } from './terminals/TerminalView.js';

/** Right column: terminal tabs plus whichever terminal is active. */
export function WorkPane({ store, state }) {
  const snapshot = state.snapshot;
  const terminals = snapshot?.terminals ?? [];
  const active = activeTerminalOf(terminals, state.ui.activeTerminal);
  return h('section', { className: 'pds-work', 'aria-label': '终端' },
    h(TerminalTabs, {
      terminals,
      activeId: active?.id ?? null,
      canCreate: Boolean(snapshot?.binding) && !state.busy,
      onSelect: (id) => store.selectTerminal(id),
      onClose: (id) => { void store.closeTerminal(id); },
      onAdd: () => { void store.createTerminal(); },
    }),
    active
      ? h(TerminalView, { terminal: active, store })
      : h('div', { className: 'pds-term-empty' }, '还没有打开终端。点击 + 在当前插件目录启动一个独立 PTY；关闭标签会终止进程。'));
}
