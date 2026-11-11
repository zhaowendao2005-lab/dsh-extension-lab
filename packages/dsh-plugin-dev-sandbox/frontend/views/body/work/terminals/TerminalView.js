import { h, useEffect, useRef } from '../../../../runtime.js';

/**
 * One PTY surface. Focus and caret are presentation-only; the text comes from the
 * Host snapshot and every keystroke goes through the store.
 */
export function TerminalView({ terminal, output, draft, disabled, onDraft, onSubmit }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (terminal.state === 'running') inputRef.current?.focus();
  }, [terminal.id, terminal.state]);

  return h('div', { className: 'pds-terminal-content' },
    h('pre', {
      className: 'pds-term-output', 'aria-live': 'polite',
      onClick: () => inputRef.current?.focus(),
    },
      output || (terminal.state === 'error' ? terminal.error : ''),
      terminal.state === 'running' ? h('span', { className: 'pds-term-caret', 'aria-hidden': 'true' }) : null),
    h('form', {
      className: 'pds-term-input',
      onSubmit: (event) => { event.preventDefault(); onSubmit(); },
    },
      h('span', { className: 'pds-term-prompt' }, '>'),
      h('input', {
        ref: inputRef,
        value: draft,
        onChange: (event) => onDraft(event.target.value),
        'aria-label': '终端输入',
        placeholder: terminal.state === 'running' ? '输入命令后回车' : '终端已结束',
        disabled,
      })));
}
