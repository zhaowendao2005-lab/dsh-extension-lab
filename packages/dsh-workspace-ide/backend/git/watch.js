/**
 * Repository watcher. `git.status` polling is the correctness path (P0); this module only
 * makes refreshes feel immediate, so every failure mode degrades to "polling still works"
 * instead of breaking the panel (docs/git-model.md §7).
 *
 * Two observations are baked in:
 * - `.git` is watched **non-recursively** (its first level only): a recursive watch there
 *   pulls in every object file and floods the loop on large repos;
 * - on macOS a recursive watch reports nested edits as `rename`, which is fine for "something
 *   changed" but means the event kind is advisory, never authoritative.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ideError } from '../../shared/errors.js';

const DEBOUNCE_MS = 800;
const MAX_EVENTS = 500;
const MAX_TOKENS = 4;

export function createWatcher() {
  /** @type {Map<string, {handle: {close(): void}, events: object[], offset: number, stopped: string|null, timer: NodeJS.Timeout|null}>} */
  const tokens = new Map();
  let nextToken = 1;

  async function start({ root, gitDir }) {
    if (tokens.size >= MAX_TOKENS) {
      const oldest = tokens.keys().next().value;
      if (oldest) stop(oldest);
    }
    const token = `w${nextToken}`;
    nextToken += 1;

    const state = { handle: null, events: [], offset: 0, stopped: null, timer: null };
    tokens.set(token, state);

    try {
      const worktree = await fs.watch(root, { recursive: true, persistent: false });
      const handles = [worktree];
      if (gitDir) {
        // First level only: HEAD, index, refs/, MERGE_HEAD...  Not `objects/`.
        const meta = await fs.watch(gitDir, { persistent: false }).catch(() => null);
        if (meta) handles.push(meta);
      }
      state.handle = { close: () => handles.forEach((handle) => handle.close()) };
      for (const handle of handles) {
        handle.on('error', () => {
          state.stopped = 'error';
        });
        handle.on('change', (kind, file) => {
          if (state.stopped) return;
          const name = String(file ?? '');
          if (!name || name.includes('node_modules/') || name.startsWith('.git/objects')) return;
          schedule(state, { kind: 'worktree', path: name.replace(/\\/g, '/'), at: Date.now() });
        });
      }
      return { token, debounceMs: DEBOUNCE_MS, reasons: ['worktree', 'index'] };
    } catch (error) {
      // Recursive watch is unavailable on some filesystems/volumes: report it and let the
      // caller keep the polling path.
      state.stopped = error?.code === 'ENOSPC' ? 'limit' : 'fs-events-unsupported';
      tokens.delete(token);
      return { token: null, debounceMs: DEBOUNCE_MS, stopped: state.stopped };
    }
  }

  function schedule(state, event) {
    if (state.events.length >= MAX_EVENTS) state.events.shift();
    state.events.push(event);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      // Coalesce a burst into one synthetic event so the client refreshes once.
      const last = state.events[state.events.length - 1];
      state.events.push({ kind: 'flush', path: last?.path ?? '', at: Date.now() });
    }, DEBOUNCE_MS);
    state.timer.unref?.();
  }

  function poll({ token, offset = 0 }) {
    const state = tokens.get(token);
    if (!state) throw ideError('E_LIMIT', '监听令牌已失效', { token, field: 'token' });
    const from = Math.max(offset, state.offset);
    const dropped = from > state.offset + state.events.length;
    const events = state.events.slice(from - state.offset);
    return {
      events,
      offset: state.offset + state.events.length,
      dropped,
      stopped: Boolean(state.stopped),
      reason: state.stopped ?? undefined,
    };
  }

  function stop(token) {
    const state = tokens.get(token);
    if (!state) return { stopped: true };
    if (state.timer) clearTimeout(state.timer);
    try {
      state.handle?.close();
    } catch {
      // Closing an already-closed watcher is not an error worth surfacing.
    }
    tokens.delete(token);
    return { stopped: true };
  }

  function dispose() {
    for (const token of [...tokens.keys()]) stop(token);
  }

  return { start, poll, stop, dispose };
}
