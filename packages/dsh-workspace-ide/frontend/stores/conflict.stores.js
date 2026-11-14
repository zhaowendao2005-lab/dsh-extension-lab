/**
 * Conflict resolution domain (docs/milestones.md M4-2).
 * The Host owns the three index stages; this store only caches the last opened conflict so the
 * three panes can render without re-running `git show` on every keystroke elsewhere in the UI.
 */
import { createStore } from '../store.js';

export function createConflictDomain({ client, conflict, notify, fail, refreshScm, closePanel }) {
  async function open(path) {
    if (!path) return null;
    conflict.patch({ phase: 'loading', path, error: null });
    try {
      const data = await client.call('git.conflict', { path });
      conflict.patch({
        phase: 'ready',
        path,
        base: data.base ?? null,
        ours: data.ours ?? null,
        theirs: data.theirs ?? null,
        binary: Boolean(data.binary),
        truncated: Boolean(data.truncated),
        error: null,
      });
      return data;
    } catch (error) {
      conflict.patch({ phase: 'error', error: error?.message ?? '无法读取冲突', path });
      fail(conflict, error, '无法读取冲突');
      return null;
    }
  }

  function close() {
    conflict.patch({ phase: 'idle', path: null, base: null, ours: null, theirs: null, binary: false, truncated: false, error: null });
    // The editor area swaps its whole region while a conflict is open, so the panel flag has to
    // be cleared too or the area keeps showing an empty conflict frame after resolving.
    closePanel?.();
  }

  /**
   * `side` is ours/theirs/both/delete. Anything that changes the index also changes SCM, so the
   * caller gets a refreshed status; on failure the panes stay open for a second attempt.
   */
  async function resolve(side) {
    const path = conflict.getSnapshot().path;
    if (!path) return null;
    try {
      const result = await client.call('git.resolveConflict', { path, side });
      notify?.('info', `已解决冲突：${path}`, { side });
      close();
      await refreshScm();
      return result;
    } catch (error) {
      fail(conflict, error, '解决冲突失败');
      return null;
    }
  }

  /** Manual path: the user edits the file with markers and then marks it resolved. */
  async function markResolved() {
    const path = conflict.getSnapshot().path;
    if (!path) return null;
    try {
      await client.call('git.stage', { paths: [path] });
      notify?.('info', `已标记为已解决：${path}`, null);
      close();
      await refreshScm();
      return { path };
    } catch (error) {
      fail(conflict, error, '标记已解决失败');
      return null;
    }
  }

  return { open, close, resolve, markResolved };
}

/** Fresh store shape; exported so the workbench can own the instance. */
export function createConflictStore() {
  return createStore({
    phase: 'idle',
    path: null,
    base: null,
    ours: null,
    theirs: null,
    binary: false,
    truncated: false,
    error: null,
  });
}
