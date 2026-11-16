import { useStore, useEffect, useRef } from '../../runtime.js';
import { matchPieces } from '../../service/quick-access.js';
import { FileIcon } from './FileIcon.jsx';
import { Icon } from './Icon.jsx';

/** One shared panel. Query, result ranking, active selection and IO belong to the domain. */
export function QuickOpen({ stores }) {
  const quick = useStore(stores.quickAccess);
  const actions = stores.quickAccessActions;
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!quick.open) return undefined;
    previousFocus.current = inputRef.current?.getRootNode()?.activeElement ?? document.activeElement;
    inputRef.current?.focus();
    return () => {
      const target = previousFocus.current;
      if (target?.isConnected && typeof target.focus === 'function') target.focus();
    };
  }, [quick.open]);
  useEffect(() => {
    if (quick.open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [quick.open, quick.active, quick.results]);
  useEffect(() => {
    if (quick.open) inputRef.current?.focus();
  }, [quick.mode]);

  if (!quick.open) return null;
  const commands = quick.mode === 'commands';
  const content = quick.mode === 'content';
  const placeholder = commands ? '/ 输入命令名称、英文或拼音首字母' : content ? '搜索文件内容…' : '按文件名或路径模糊搜索…';
  const optionId = (index) => 'wid-quick-option-' + index;
  const onKeyDown = (event) => {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); actions.close(); return; }
    if (event.key === 'Tab') {
      const root = inputRef.current?.getRootNode();
      const nodes = [...(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])];
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = root?.activeElement ?? document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (!event.composedPath?.().includes(inputRef.current) && event.target !== inputRef.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation(); actions.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void actions.choose(); }
  };
  return (
    <div className="wid-quickwrap" role="dialog" aria-label="快速访问工作台" aria-modal="true" onKeyDown={onKeyDown}
      onMouseDown={(event) => { if (event.target === event.currentTarget) actions.close(); }}>
      <div className="wid-quick" ref={panelRef}>
        <div className="wid-quick__header">
          <div className="wid-quick__modes" role="group" aria-label="搜索类型">
            <button type="button" aria-pressed={!commands && !content} onClick={() => actions.setMode('files')}>文件</button>
            <button type="button" aria-pressed={content} onClick={() => actions.setMode('content')}>内容</button>
            <button type="button" aria-pressed={commands} onClick={() => actions.setMode('commands')}>/ 命令</button>
          </div>
          <button type="button" className="wid-quick__close" aria-label="关闭快速访问" title="关闭（Esc）" onClick={actions.close}><Icon name="close" size={14} /></button>
        </div>
        <input ref={inputRef} className="wid-quick__input" type="text" autoComplete="off" spellCheck={false}
          aria-label={commands ? '搜索命令' : content ? '搜索文件内容' : '搜索文件'}
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="wid-quick-results"
          aria-activedescendant={quick.results.length ? optionId(quick.active) : undefined}
          placeholder={placeholder} value={quick.query} onChange={(event) => actions.setQuery(event.target.value)} />
        {!commands && <div className="wid-quick__filters">
          <label><span>包含文件</span><input aria-label="包含文件 glob" placeholder="例如 src/**, **/*.{ts,tsx}" value={quick.include} onChange={(event) => actions.setFilter('include', event.target.value)} /></label>
          <label><span>排除文件</span><input aria-label="排除文件 glob" placeholder="例如 dist, **/*.min.js" value={quick.exclude} onChange={(event) => actions.setFilter('exclude', event.target.value)} /></label>
          <label className="wid-quick__ignore"><input type="checkbox" checked={quick.useIgnoreFiles} onChange={(event) => actions.setFilter('useIgnoreFiles', event.target.checked)} />遵循 .gitignore / .ignore</label>
        </div>}
        <div className="wid-quick__status" role="status" aria-live="polite">
          {quick.phase === 'loading' ? (content ? '正在搜索内容…' : '正在读取文件索引…')
            : quick.error || (!quick.results.length ? (content && !quick.query.trim() ? '输入内容开始搜索' : commands ? '没有匹配的命令' : content ? '没有匹配的内容' : '没有匹配的文件')
              : commands ? quick.results.length + ' 个命令' : quick.results.length + (content ? ' 处匹配' : ' 个文件') + (quick.truncated ? ' · 已达到搜索上限' : ''))}
        </div>
        <ul className="wid-quick__list" id="wid-quick-results" ref={listRef} role="listbox" aria-label="快速访问结果" aria-busy={quick.phase === 'loading'}>
          {quick.results.map((result, index) => (
            <li key={result.id} role="presentation">
              {commands && (index === 0 || quick.results[index - 1].group !== result.group) && <div className="wid-quick__group">{result.group}</div>}
              <div id={optionId(index)} role="option" aria-selected={index === quick.active} aria-disabled={result.disabled || undefined}
                data-active={index === quick.active ? 'true' : undefined} className="wid-quick__item" title={result.reason || result.detail || result.path}
                onMouseEnter={() => actions.setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => { void actions.choose(index); }}>
                {commands ? <Icon name={result.icon} size={14} /> : <FileIcon name={result.path} size={14} />}
                <div className="wid-quick__rowtext">
                  <div className="wid-quick__path"><Highlighted text={result.label} query={commands ? quick.query.replace(/^\s*\//, '') : content ? '' : quick.query} />{content && <span className="wid-quick__location">:{result.line}:{result.column}</span>}</div>
                  {content ? <div className="wid-quick__snippet"><Snippet hit={result} /></div>
                    : commands && <div className="wid-quick__detail">{result.reason || result.detail}</div>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {quick.warnings.length > 0 && <div className="wid-quick__warnings" role="status">{quick.warnings.join(' · ')}</div>}
        <div className="wid-quick__footer"><span>↑↓ 选择 · Enter {commands ? '执行' : '打开'} · Esc 关闭 · / 命令</span>
          {!commands && <button type="button" onClick={() => { void actions.refresh(); }} disabled={quick.phase === 'loading'}>刷新</button>}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ text, query }) {
  return matchPieces(text, query).map((piece, index) => piece.marked
    ? <mark key={index} className="wid-quick__match">{piece.text}</mark> : <span key={index}>{piece.text}</span>);
}
function Snippet({ hit }) {
  const text = String(hit.text ?? '');
  const start = Math.max(0, Number(hit.matchStart) || 0);
  const end = Math.max(start, Number(hit.matchEnd) || start);
  return <span>{hit.snippetStart > 0 ? '…' : ''}{text.slice(0, start)}{end > start && <mark className="wid-quick__match">{text.slice(start, end)}</mark>}{text.slice(end)}</span>;
}
