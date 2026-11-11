/** PTY text and tab rules. Pure functions: no React, no store. */

/** Strip ANSI/OSC escape sequences and control bytes before rendering into <pre>. */
export function cleanTerminal(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function terminalText(snapshot, terminalId) {
  if (!terminalId) return '';
  const lines = (snapshot?.logs ?? []).filter((line) => line.source === 'terminal' && line.terminalId === terminalId);
  return cleanTerminal(lines.map((line) => line.text).join(''));
}

export function terminalTitle(terminal, index) {
  return terminal?.commandId || `终端 ${index + 1}`;
}

export function terminalStateGlyph(state) {
  if (state === 'running') return '●';
  if (state === 'starting') return '◌';
  if (state === 'error') return '✕';
  return '';
}

export function activeTerminalOf(terminals, activeId) {
  return terminals.find((terminal) => terminal.id === activeId) || terminals[0];
}
