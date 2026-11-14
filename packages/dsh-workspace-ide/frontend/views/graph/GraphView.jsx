import { useStore, useRef, useEffect, useMemo } from '../../runtime.js';
import { createStore } from '../../store.js';
import { Icon } from '../common/Icon.jsx';

const LANE_W = 12;
const ROW_H = 28;
const DOT_R = 3.5;
const OVERSCAN = 12;

/**
 * Commit graph. Layout rows come from the Host (`git.graph`), so this view only paints
 * them: one fixed-height row, one SVG cell per row, virtualised so 50k commits stay cheap
 * (docs/graph.md §5). Filtering hides rows but never re-lays the graph.
 */
export function GraphView({ stores }) {
  const graph = useStore(stores.graph);
  const workspace = useStore(stores.workspace);
  const scrollRef = useRef(null);
  // Windowing is a view-local concern, so it lives in its own tiny store rather than in
  // the Host snapshot: scroll position is worthless after a reload.
  const viewport = useRef(null);
  if (!viewport.current) viewport.current = createStore({ scrollTop: 0, height: 640 });
  const view = useStore(viewport.current);

  useEffect(() => {
    if (!workspace.git?.isRepo) return;
    if (graph.phase === 'idle') void stores.graphActions.load({ reset: true });
    if (!graph.refs) void stores.graphActions.loadRefs();
  }, [workspace.git?.isRepo, graph.phase, graph.refs]);

  const rows = graph.rows;
  const visible = useMemo(() => {
    const needle = graph.filter.trim().toLowerCase();
    if (!needle) return rows.map((_, index) => index);
    const result = [];
    for (let index = 0; index < rows.length; index += 1) {
      const commit = graph.commits[index];
      if (!commit) continue;
      if (
        commit.subject.toLowerCase().includes(needle)
        || commit.hash.startsWith(needle)
        || (commit.author ?? '').toLowerCase().includes(needle)
        || (commit.refs ?? []).some((ref) => ref.name.toLowerCase().includes(needle))
      ) {
        result.push(index);
      }
    }
    return result;
  }, [rows, graph.commits, graph.filter]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const measure = () => viewport.current.patch({ height: node.clientHeight || 640 });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const windowItems = useMemo(() => {
    if (!visible.length) return [];
    const first = Math.max(0, Math.floor(view.scrollTop / ROW_H) - OVERSCAN);
    const span = Math.ceil(view.height / ROW_H) + OVERSCAN * 2;
    const last = Math.min(visible.length, first + span);
    const items = [];
    for (let position = first; position < last; position += 1) items.push(position);
    return items;
  }, [visible, view.scrollTop, view.height]);

  if (!workspace.git?.isRepo) {
    return (
      <div className="wid-empty">
        <span className="wid-hint">当前目录不是 Git 仓库</span>
      </div>
    );
  }

  const graphWidth = Math.max(1, Math.min(graph.maxLane + 1, 12)) * LANE_W + 8;

  return (
    <div className="wid-graph">
      <div className="wid-graph__bar">
        <select
          className="wid-graph__refs"
          value={graph.filterRef ?? ''}
          onChange={(event) => void stores.graphActions.setFilterRef(event.target.value || null)}
          title="只看某个引用"
        >
          <option value="">所有引用</option>
          {(graph.refs?.local ?? []).map((branch) => (
            <option key={`l:${branch.name}`} value={branch.name}>
              {branch.head ? '● ' : ''}
              {branch.name}
            </option>
          ))}
          {(graph.refs?.tags ?? []).map((tag) => (
            <option key={`t:${tag.name}`} value={tag.name}>
              ⌂ {tag.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="wid-graph__search"
          placeholder="过滤提交（消息 / 作者 / 哈希）"
          value={graph.filter}
          onChange={(event) => stores.graphActions.setFilter(event.target.value)}
        />
        <button
          type="button"
          className="wid-icon-button"
          title="刷新"
          onClick={() => void stores.graphActions.load({ reset: true })}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {graph.error && <div className="wid-graph__error">{graph.error}</div>}

      <div className="wid-graph__scroll" ref={scrollRef} onScroll={handleScroll}>
        {!rows.length && graph.phase === 'loading' && <div className="wid-empty"><span className="wid-hint">正在读取提交…</span></div>}
        {!rows.length && graph.phase !== 'loading' && <div className="wid-empty"><span className="wid-hint">没有提交</span></div>}
        <div className="wid-graph__canvas" style={{ height: `${visible.length * ROW_H}px` }}>
          {windowItems.map((position) => {
            const index = visible[position];
            const row = rows[index];
            const commit = graph.commits[index];
            if (!row || !commit) return null;
            const selected = graph.selected === row.hash;
            return (
              <div
                key={`${row.hash}:${position}`}
                className="wid-graph__row"
                data-selected={selected ? 'true' : undefined}
                style={{ transform: `translateY(${position * ROW_H}px)`, height: `${ROW_H}px` }}
                onClick={() => stores.graphActions.select(row.hash)}
                onDoubleClick={() => void stores.actions.openDiff({ kind: 'commit', hash: row.hash }, null)}
                title={`${row.hash.slice(0, 12)} ${commit.subject} · 双击查看该提交的改动`}
              >
                <GraphCell row={row} width={graphWidth} />
                <RefBadges refs={commit.refs} />
                <span className="wid-graph__subject">{commit.subject}</span>
                <span className="wid-graph__meta">{commit.author}</span>
                <span className="wid-graph__date">{formatDate(commit.authoredAt)}</span>
              </div>
            );
          })}
        </div>
        {graph.hasMore && (
          <button
            type="button"
            className="wid-graph__more"
            disabled={graph.loadingMore}
            onClick={() => void stores.graphActions.loadMore()}
          >
            {graph.loadingMore ? '载入中…' : '载入更多'}
          </button>
        )}
      </div>

      <div className="wid-graph__footer">
        <span className="wid-hint">
          {rows.length} / {graph.hasMore ? `${graph.totalKnown ?? '?'}+` : rows.length} 行
          {graph.filter.trim() ? ` · 命中 ${visible.length}` : ''}
          {graph.layoutMs ? ` · 布局 ${graph.layoutMs}ms` : ''}
        </span>
      </div>
    </div>
  );

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    viewport.current.patch({ scrollTop: node.scrollTop });
    if (!graph.hasMore || graph.loadingMore) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - ROW_H * 8) {
      void stores.graphActions.loadMore();
    }
  }
}

/**
 * One row of lanes: passthrough lines run the full height, merges come in from the top
 * half, forks leave in the bottom half (docs/graph.md §6).
 */
function GraphCell({ row, width }) {
  const x = (lane) => lane * LANE_W + LANE_W / 2 + 2;
  const color = `var(--wid-lane-${row.color % 8})`;
  const dotX = x(row.lane);
  return (
    <svg className="wid-graph__cell" width={width} height={ROW_H} aria-hidden="true">
      {row.segments.map((segment, index) => {
        const from = x(segment.from);
        const to = x(segment.to);
        if (segment.kind === 'passthrough' && from === to) {
          return <line key={index} x1={from} y1={0} x2={to} y2={ROW_H} stroke={color} strokeWidth={1.5} />;
        }
        if (segment.kind === 'merge') {
          return (
            <path
              key={index}
              d={`M ${from} 0 C ${from} ${ROW_H / 2}, ${to} ${ROW_H / 2}, ${to} ${ROW_H / 2}`}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
            />
          );
        }
        if (segment.kind === 'fork') {
          return (
            <path
              key={index}
              d={`M ${from} ${ROW_H / 2} C ${to} ${ROW_H / 2}, ${to} ${ROW_H / 2}, ${to} ${ROW_H}`}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
            />
          );
        }
        return (
          <path
            key={index}
            d={`M ${from} 0 C ${from} ${ROW_H / 2}, ${to} ${ROW_H / 2}, ${to} ${ROW_H}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          />
        );
      })}
      <circle cx={dotX} cy={ROW_H / 2} r={DOT_R} fill={color} stroke="var(--dsw-alias-bg-base)" strokeWidth={1} />
    </svg>
  );
}

function RefBadges({ refs }) {
  if (!refs?.length) return null;
  // Two chips at most: the row has to leave room for the subject, and a commit that
  // carries five refs is better summarised as "+3" than five ellipses.
  const shown = refs.slice(0, 2);
  const rest = refs.length - shown.length;
  return (
    <span className="wid-graph__badges">
      {shown.map((ref) => (
        <span
          key={`${ref.type}:${ref.name}`}
          className="wid-graph__badge"
          data-kind={ref.type}
          data-head={ref.isHead ? 'true' : undefined}
          title={ref.name}
        >
          {ref.name}
        </span>
      ))}
      {rest > 0 && (
        <span className="wid-graph__badge" title={refs.slice(2).map((ref) => ref.name).join(', ')}>+{rest}</span>
      )}
    </span>
  );
}

function formatDate(seconds) {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const now = Date.now();
  const age = (now - date.getTime()) / 1000;
  if (age < 60) return '刚刚';
  if (age < 3600) return `${Math.floor(age / 60)} 分钟前`;
  if (age < 86400) return `${Math.floor(age / 3600)} 小时前`;
  if (age < 86400 * 30) return `${Math.floor(age / 86400)} 天前`;
  return date.toLocaleDateString();
}
