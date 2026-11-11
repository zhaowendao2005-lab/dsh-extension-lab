import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { h, useEffect, useRef } from '../../../../runtime.js';
import { createTerminalChannel } from '../../../../service/terminal.service.js';

/**
 * One PTY surface rendered by xterm. Keystrokes go straight to the Host PTY and
 * bytes come back from a cursor-based poll, so typing happens inside the terminal
 * instead of a separate input row. The xterm instance is an imperative DOM surface
 * (like a canvas): no view state is kept here, only the store's terminal list.
 */
export function TerminalView({ terminal, store }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const term = new Terminal({
      fontSize: 11,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      cursorBlink: true,
      scrollback: 2000,
      theme: { background: '#ffffff', foreground: '#333333', cursor: '#333333', selectionBackground: '#cce8ff' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const applyFit = () => {
      try {
        fit.fit();
        void store.resizeTerminal(terminal.id, term.cols, term.rows);
      } catch { /* the pane can be measured before it is laid out */ }
    };
    applyFit();
    const keys = term.onData((data) => { void store.writeTerminal(terminal.id, data); });
    const channel = createTerminalChannel({
      poll: store.pollTerminal,
      terminalId: terminal.id,
      onData: (data) => term.write(data),
    });
    const observer = new ResizeObserver(applyFit);
    observer.observe(host);
    if (terminal.state === 'running') term.focus();
    return () => {
      channel.stop();
      keys.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [terminal.id]);

  return h('div', { className: 'pds-terminal-content' },
    h('div', {
      className: 'pds-term-host',
      ref: hostRef,
      onClick: () => hostRef.current?.querySelector('.xterm-helper-textarea')?.focus(),
    }),
    terminal.state === 'running' ? null
      : h('div', { className: 'pds-term-note' }, terminal.state === 'error' ? (terminal.error || '终端已结束') : '终端已结束'));
}
