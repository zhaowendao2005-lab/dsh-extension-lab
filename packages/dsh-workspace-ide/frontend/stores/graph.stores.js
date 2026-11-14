/**
 * Commit graph domain: paged history, immutable layout rows computed by the Host and a
 * local text filter that only hides rows (it never re-lays the graph, docs/graph.md §7).
 */
import { LIMITS } from '../../shared/contract.js';

const PAGE = LIMITS.logPageDefault;

export function createGraphDomain({ client, graph, fail }) {
  let epoch = 0;

  async function load({ reset = true } = {}) {
    const state = graph.getSnapshot();
    const skip = reset ? 0 : state.rows.length;
    const requestEpoch = epoch + 1;
    epoch = requestEpoch;
    graph.patch({ phase: reset ? 'loading' : state.phase, error: null, loadingMore: !reset });
    try {
      const page = await client.call('git.graph', { maxCount: PAGE, skip, ...(state.filterRef ? { refs: [state.filterRef] } : {}) });
      // A stale response must never overwrite a newer layout.
      if (requestEpoch !== epoch) return null;
      const rows = reset ? page.rows : [...graph.getSnapshot().rows, ...page.rows];
      const commits = reset ? page.commits : [...graph.getSnapshot().commits, ...page.commits];
      graph.patch({
        phase: 'ready',
        error: null,
        rows,
        commits,
        maxLane: page.maxLane,
        hasMore: page.hasMore,
        loadingMore: false,
        layoutMs: page.layoutMs,
      });
      return page;
    } catch (error) {
      if (requestEpoch !== epoch) return null;
      graph.patch({ phase: 'error', error: error?.message ?? '读取提交历史失败', loadingMore: false });
      fail(graph, error, '读取提交历史失败');
      return null;
    }
  }

  async function loadMore() {
    const state = graph.getSnapshot();
    if (!state.hasMore || state.loadingMore) return null;
    return load({ reset: false });
  }

  async function loadRefs() {
    try {
      const refs = await client.call('git.refs', {});
      graph.patch({ refs });
      return refs;
    } catch (error) {
      if (error?.code !== 'E_NOT_A_REPO') fail(graph, error, '读取分支失败');
      return null;
    }
  }

  return {
    load,
    loadMore,
    loadRefs,
    setFilter(text) {
      graph.patch({ filter: text });
    },
    setFilterRef(name) {
      graph.patch({ filterRef: name ?? null });
      return load({ reset: true });
    },
    select(hash) {
      graph.patch({ selected: hash ?? null });
    },
    reset() {
      epoch += 1;
      graph.patch({ phase: 'idle', rows: [], commits: [], hasMore: false, filter: '', selected: null });
    },
  };
}
