/**
 * Repository watcher. `git.status` polling is the correctness path; this module only makes
 * refreshes feel immediate, so every failure mode degrades to "polling still works".
 *
 * The Host queue is a bounded log with a monotonic cursor: consumers pass the cursor they
 * last saw and receive the events after it. Trimming never rewrites that cursor, otherwise a
 * slow consumer would silently read the wrong slice forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ideError } from '../../shared/errors.js';

const DEBOUNCE_MS = 800;
const MAX_EVENTS = 500;
const MAX_TOKENS = 4;

export function createWatcher() {
  /** @type {Map<string, {handle: fs.FSWatcher[]|null, events: object[], offset: number, stopped: string|null, timer: NodeJS.Timeout|null}>} */
  const tokens = new Map();
  let nextToken = 1;

  async function start({ root, gitDir }) {
    if (tokens.size >= MAX_TOKENS) {
      const oldest = tokens.keys().next().value;
      if (oldest) stop(oldest);
    }
    const token = 'w' + nextToken;
    nextToken += 1;

    const state = { handle: null, events: [], offset: 0, stopped: null, timer: null };
    tokens.set(token, state);

    const opened = [];
    try {
      const worktree = fs.watch(root, { recursive: true, persistent: false });
      opened.push(worktree);
      if (gitDir) {
        // First level only: HEAD, index, refs/, MERGE_HEAD...  Not `objects/`.
        try {
          opened.push(fs.watch(gitDir, { persistent: false }));
        } catch {
          // A missing git dir is fine: the worktree watch still reports changes.
        }
      }
      state.handle = opened;
      for (const handle of opened) {
        handle.on('error', () => {
          state.stopped = 'error';
        });
        handle.on('change', (kind, file) => {
          if (state.stopped) return;
          const name = String(file ?? '');
          if (!name || name.includes('node_modules/') || name.startsWith('.git/objects')) return;
          append(state, { kind: 'worktree', path: name.replace(/\\/g, '/'), at: Date.now() });
        });
      }
      return { token, debounceMs: DEBOUNCE_MS, reasons: ['worktree', 'index'] };
    } catch (error) {
      for (const handle of opened) {
        try { handle.close(); } catch { /* already closed */ }
      }
      state.stopped = error?.code === 'ENOSPC' ? 'limit' : 'fs-events-unsupported';
      tokens.delete(token);
      return { token: null, debounceMs: DEBOUNCE_MS, stopped: state.stopped };
    }
  }

  function push(state, event) {
    state.events.push(event);
    while (state.events.length > MAX_EVENTS) {
      state.events.shift();
      state.offset += 1;
    }
  }

  function append(state, event) {
    push(state, event);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      // Coalesce a burst into one synthetic event, and never schedule another flush here.
      const last = state.events[state.events.length - 1];
      push(state, { kind: 'flush', path: last?.path ?? '', at: Date.now() });
    }, DEBOUNCE_MS);
    state.timer.unref?.();
  }

  function poll({ token, offset = 0 }) {
    const state = tokens.get(token);
    if (!state) throw ideError('E_LIMIT', '监听令牌已失效', { token, field: 'token' });
    const end = state.offset + state.events.length;
    const from = Math.max(offset, state.offset);
    const dropped = offset < state.offset;
    const events = state.events.slice(from - state.offset);
    return {
      events,
      offset: end,
      dropped,
      stopped: Boolean(state.stopped),
      reason: state.stopped ?? undefined,
    };
  }

  function stop(token) {
    const state = tokens.get(token);
    if (!state) return { stopped: true };
    if (state.timer) clearTimeout(state.timer);
    for (const handle of state.handle ?? []) {
      try { handle.close(); } catch { /* already closed */ }
    }
    tokens.delete(token);
    return { stopped: true };
  }

  function dispose() {
    for (const token of [...tokens.keys()]) stop(token);
  }

  return { start, poll, stop, dispose };
}
