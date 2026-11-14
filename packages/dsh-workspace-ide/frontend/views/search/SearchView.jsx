import { useStore } from '../../runtime.js';
import { Icon } from '../common/Icon.jsx';

/** Workspace text search: one query, one flat hit list, click to open at the line. */
export function SearchView({ stores }) {
  const search = useStore(stores.search);
  const workspace = useStore(stores.workspace);

  if (!workspace.root) return null;

  return (
    <div className="wid-search">
      <div className="wid-search__box">
        <input
          className="wid-search__input"
          type="search"
          placeholder="搜索工作区（至少 2 个字符）"
          value={search.query}
          onChange={(event) => stores.actions.setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void stores.actions.runSearch(search.query);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              stores.actions.clearSearch();
            }
          }}
        />
        {search.query && (
          <button type="button" className="wid-icon-button" title="清除" onClick={() => stores.actions.clearSearch()}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      <div className="wid-search__meta wid-hint">
        {search.phase === 'loading' && '搜索中…'}
        {search.phase === 'error' && (search.error ?? '搜索失败')}
        {search.phase === 'ready' && (
          <>
            {search.hits.length} 个结果 · {search.elapsedMs} ms · {search.engine ?? 'js'}
            {search.truncated && ' · 结果已截断'}
          </>
        )}
      </div>

      <ul className="wid-search__list">
        {search.hits.map((hit) => (
          <li key={`${hit.path}:${hit.line}:${hit.column}`}>
            <button
              type="button"
              className="wid-search__hit"
              title={`${hit.path}:${hit.line}`}
              onClick={() => void stores.actions.openAt(hit.path, hit.line, hit.column)}
            >
              <span className="wid-search__hit-path">{hit.path}</span>
              <span className="wid-search__hit-line wid-mono">:{hit.line}</span>
              <span className="wid-search__hit-text wid-mono">{hit.text}</span>
            </button>
          </li>
        ))}
      </ul>

      {search.phase === 'ready' && search.hits.length === 0 && (
        <div className="wid-empty"><span className="wid-hint">没有匹配</span></div>
      )}
    </div>
  );
}
