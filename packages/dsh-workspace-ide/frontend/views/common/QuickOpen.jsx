import { useStore, useEffect, useMemo, useRef } from '../../runtime.js';
import { rankPaths } from '../../service/fuzzy.js';

const MAX_ROWS = 40;

/**
 * Quick open (docs/milestones.md M4-5). One input, one ranked list, keyboard only:
 * ↑/↓ move, Enter opens, Esc closes. The path index comes from the Host (`files.index`,
 * `git ls-files` fast path) so this stays instant on a 50k-file repository.
 */
export function QuickOpen({ stores }) {
  const ui = useStore(stores.ui);
  const quick = useStore(stores.quick);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const activeRef = useRef(0);
  const closeRef = useRef(() => {});

  const query = ui.quickQuery ?? '';
  const results = useMemo(() => rankPaths(quick.paths, query, MAX_ROWS), [quick.paths, query]);
  activeRef.current = Math.min(activeRef.current, Math.max(0, results.length - 1));
  closeRef.current = () => {
    activeRef.current = 0;
    stores.actions.setQuickQuery('');
    stores.actions.closeQuick();
  };

  useEffect(() => {
    if (!ui.quickOpen) return undefined;
    activeRef.current = 0;
    const node = inputRef.current;
    if (node) {
      node.value = query;
      node.focus();
    }
    return undefined;
  }, [ui.quickOpen]);

  useEffect(() => {
    if (!ui.quickOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = Math.min(Math.max(0, activeRef.current + delta), Math.max(0, results.length - 1));
        activeRef.current = next;
        // The active row is view state, so nudge a re-render through the shared ui store.
        stores.actions.setQuickActive(next);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = results[activeRef.current];
        if (chosen) {
          closeRef.current();
          void stores.actions.openFile(chosen.path);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ui.quickOpen, results]);

  useEffect(() => {
    const node = listRef.current;
    const active = node?.querySelector('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [ui.quickActive, results.length]);

  if (!ui.quickOpen) return null;

  const activeIndex = Math.min(ui.quickActive ?? 0, Math.max(0, results.length - 1));

  return (
    <div className="wid-quickwrap" role="dialog" aria-label="快速打开文件" aria-modal="true">
      <div className="wid-quick" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="wid-quick__input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="按文件名搜索（支持路径片段，如 fe/src/ap）"
          value={query}
          onChange={(event) => {
            stores.actions.setQuickQuery(event.target.value);
            stores.actions.setQuickActive(0);
            activeRef.current = 0;
          }}
        />
        <ul className="wid-quick__list" ref={listRef} role="listbox">
          {quick.phase === 'loading' && <li className="wid-quick__hint">正在建立文件索引…</li>}
          {quick.phase === 'error' && <li className="wid-quick__hint">{quick.error}</li>}
          {quick.phase === 'ready' && !results.length && <li className="wid-quick__hint">没有匹配的文件</li>}
          {results.map((result, index) => (
            <li
              key={result.path}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex ? 'true' : undefined}
              className="wid-quick__item"
              onMouseMove={() => stores.actions.setQuickActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                closeRef.current();
                void stores.actions.openFile(result.path);
              }}
            >
              <Highlighted path={result.path} query={query} />
            </li>
          ))}
        </ul>
        <div className="wid-quick__footer">
          <span className="wid-hint">
            {quick.phase === 'ready'
              ? `${results.length} / ${quick.total} 个文件${quick.engine ? ` · ${quick.engine}` : ''}${quick.truncated ? ' · 已达到索引上限' : ''}`
              : '↑↓ 选择 · Enter 打开 · Esc 关闭'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Marks the matched characters so the eye can jump straight to them. */
function Highlighted({ path, query }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <span className="wid-quick__path">{path}</span>;
  const lower = path.toLowerCase();
  const marks = new Set();
  let at = -1;
  for (const char of needle) {
    at = lower.indexOf(char, at + 1);
    if (at === -1) break;
    marks.add(at);
  }
  const pieces = [];
  let buffer = '';
  let bufferMarked = false;
  for (let i = 0; i < path.length; i += 1) {
    const marked = marks.has(i);
    if (marked !== bufferMarked && buffer) {
      pieces.push({ text: buffer, marked: bufferMarked });
      buffer = '';
    }
    bufferMarked = marked;
    buffer += path[i];
  }
  if (buffer) pieces.push({ text: buffer, marked: bufferMarked });
  return (
    <span className="wid-quick__path">
      {pieces.map((piece, index) => (piece.marked
        ? <mark key={index} className="wid-quick__match">{piece.text}</mark>
        : <span key={index}>{piece.text}</span>))}
    </span>
  );
}
