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

/**
 * Read PTY output from a character cursor while a tab is open. The cursor lives
 * here (business logic), never in a view: sessions poll independently and a slow
 * round trip cannot reorder bytes.
 */
export function createTerminalChannel({ poll, terminalId, onData, interval = 120 }) {
  let offset = 0;
  let stopped = false;
  let busy = false;
  let timer;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const chunk = await poll(terminalId, offset);
      if (stopped || !chunk) return;
      if (typeof chunk.offset === 'number') offset = chunk.offset;
      if (chunk.data) onData(chunk.data);
    } catch {
      // A missed poll is retried with the same cursor on the next tick.
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, interval);
  void tick();
  return {
    stop() { stopped = true; clearInterval(timer); },
    get offset() { return offset; },
  };
}

export function activeTerminalOf(terminals, activeId) {
  return terminals.find((terminal) => terminal.id === activeId) || terminals[0];
}
