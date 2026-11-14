import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useStore, useEffect, useRef } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

/**
 * Bottom panel: one xterm per tab, mounted once and merely hidden when inactive
 * (docs/ui-spec.md §9). Only the tab's ✕ kills the PTY.
 */
export function TerminalPanel({ stores }) {
  const state = useStore(stores.terminal);
  const workspace = useStore(stores.workspace);
  const tabs = state.tabs;
  const activeId = state.activeId;

  useEffect(() => {
    if (!workspace.root) return;
    if (tabs.length === 0 && state.phase === 'idle') {
      void stores.terminals.create({ cols: 80, rows: 20 });
    }
  }, [workspace.root, tabs.length, state.phase, stores]);

  return (
    <div className="wid-term">
      <div className="wid-term__tabs" role="tablist" aria-label="终端">
        {tabs.map((tab) => (
          <div
            key={tab.terminalId}
            className="wid-term__tab"
            role="tab"
            aria-selected={tab.terminalId === activeId}
            data-active={String(tab.terminalId === activeId)}
            onClick={() => stores.terminals.activate(tab.terminalId)}
            onDoubleClick={async () => {
              const title = await stores.actions.prompt({
                title: '重命名终端',
                message: '标签名只影响显示，不会改变正在运行的 shell。',
                submitLabel: '重命名',
                input: { label: '名称', value: tab.title },
              });
              if (title) void stores.terminals.rename(tab.terminalId, title);
            }}
          >
            <span className="wid-term__tab-title" title={tab.title}>
              {tab.title}
              {tab.exited && <span className="wid-hint">退出码 {tab.exitCode ?? '?'}</span>}
            </span>
            <button
              type="button"
              className="wid-icon-button wid-term__close"
              title="关闭该终端（会结束进程）"
              onClick={(event) => {
                event.stopPropagation();
                void stores.terminals.close(tab.terminalId);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="wid-icon-button"
          title="新建终端"
          onClick={() => void stores.terminals.create({ cols: 80, rows: 20 })}
        >
          <Icon name="plus" size={14} />
        </button>
        <div className="wid-term__spacer" />
        {state.error && <span className="wid-hint">{state.error}</span>}
      </div>
      <div className="wid-term__body">
        {tabs.length === 0 && (
          <div className="wid-empty">
            <span className="wid-hint">{state.phase === 'creating' ? '正在创建终端…' : '没有终端'}</span>
          </div>
        )}
        {tabs.map((tab) => (
          <TerminalView
            key={tab.terminalId}
            stores={stores}
            tab={tab}
            visible={tab.terminalId === activeId}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalView({ stores, tab, visible }) {
  const host = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);

  useEffect(() => {
    if (!host.current || term.current) return undefined;
    const terminal = new Terminal({
      fontSize: 12,
      lineHeight: 1.2,
      fontFamily: 'var(--ds-font-family-code)',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 2000,
      allowProposedApi: false,
      theme: readTheme(host.current),
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host.current);
    term.current = terminal;
    fit.current = fitAddon;

    const unsubscribe = stores.terminals.attach(tab.terminalId, (event) => {
      if (event.type === 'data') terminal.write(event.data);
      else if (event.type === 'truncated') terminal.write('\r\n[输出过快，部分内容已丢弃]\r\n');
      else if (event.type === 'exit') terminal.write(`\r\n[进程已退出，退出码 ${event.exitCode ?? '?'}]\r\n`);
      else if (event.type === 'gone') terminal.write('\r\n[终端已关闭]\r\n');
    });

    const disposeData = terminal.onData((data) => void stores.terminals.write(tab.terminalId, data));

    const observer = new ResizeObserver(() => {
      if (!host.current) return;
      try {
        fit.current?.fit();
      } catch {
        // A zero-sized host (hidden tab) cannot be fitted; the next show retries.
      }
      const size = term.current;
      if (size && size.cols && size.rows) void stores.terminals.resize(tab.terminalId, size.cols, size.rows);
    });
    observer.observe(host.current);

    return () => {
      observer.disconnect();
      disposeData.dispose();
      unsubscribe();
      terminal.dispose();
      term.current = null;
      fit.current = null;
    };
  }, [stores, tab.terminalId]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      try {
        fit.current?.fit();
        const size = term.current;
        if (size && size.cols && size.rows) void stores.terminals.resize(tab.terminalId, size.cols, size.rows);
        term.current?.focus();
      } catch {
        // Focus is best effort; the terminal still works without it.
      }
    }, 16);
    return () => clearTimeout(timer);
  }, [visible, stores, tab.terminalId]);

  return <div ref={host} className="wid-term__host" data-visible={String(visible)} />;
}

/** Read the host's tokens once per mount: xterm needs concrete colours, not var(). */
function readTheme(element) {
  const style = window.getComputedStyle(element);
  // No hard-coded fallbacks: an empty value lets xterm keep its own default.
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    background: read('--dsw-alias-bg-base'),
    foreground: read('--dsw-alias-label-primary'),
    cursor: read('--dsw-alias-label-primary'),
    selectionBackground: read('--dsw-alias-bg-document-selection'),
  };
}
