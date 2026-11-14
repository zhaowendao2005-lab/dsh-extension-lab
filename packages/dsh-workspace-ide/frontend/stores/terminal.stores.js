/**
 * Terminal tab state plus the poll channel (docs/terminal.md §3).
 * The offset returned by `terminal.poll` is the only cursor: never `offset += data.length`.
 */
import { createStore } from '../store.js';
import { LIMITS } from '../../shared/contract.js';

const POLL_MS = LIMITS.terminalPollMs;

export function createTerminalController({ client, store, notify }) {
  /** @type {Map<string, {offset:number, timer:any, listeners:Set<(event:any)=>void>, stopped:boolean}>} */
  const channels = new Map();
  let disposed = false;

  function channel(id) {
    let item = channels.get(id);
    if (!item) {
      item = { offset: 0, timer: null, listeners: new Set(), stopped: false };
      channels.set(id, item);
    }
    return item;
  }

  function emit(id, event) {
    const item = channels.get(id);
    if (!item) return;
    for (const listener of [...item.listeners]) listener(event);
  }

  async function poll(id) {
    const item = channel(id);
    if (item.stopped) return;
    try {
      const frame = await client.call('terminal.poll', { terminalId: id, offset: item.offset });
      if (frame.offset !== item.offset || frame.data) {
        item.offset = frame.offset;
        if (frame.data) emit(id, { type: 'data', data: frame.data });
      }
      if (frame.dropped) emit(id, { type: 'truncated' });
      if (frame.exited) {
        emit(id, { type: 'exit', exitCode: frame.exitCode });
        store.set((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => (tab.terminalId === id ? { ...tab, exited: true, exitCode: frame.exitCode } : tab)),
        }));
        stop(id);
      }
    } catch (error) {
      if (error?.code === 'E_TERMINAL_GONE') {
        emit(id, { type: 'gone' });
        stop(id);
        store.set((current) => ({ ...current, tabs: current.tabs.filter((tab) => tab.terminalId !== id) }));
        return;
      }
      emit(id, { type: 'error', error });
      notify?.('error', '终端读取失败', { code: error?.code });
      stop(id);
    }
  }

  function start(id) {
    const item = channel(id);
    if (item.timer || item.stopped) return;
    item.timer = setInterval(() => void poll(id), POLL_MS);
  }

  function stop(id) {
    const item = channels.get(id);
    if (!item) return;
    item.stopped = true;
    if (item.timer) clearInterval(item.timer);
    item.timer = null;
  }

  const controller = {
    store,

    /** Subscribe to a terminal's frames; starts polling on first subscriber. */
    attach(id, listener) {
      const item = channel(id);
      item.listeners.add(listener);
      start(id);
      return () => {
        item.listeners.delete(listener);
      };
    },

    async create({ cols = 80, rows = 24, shell } = {}) {
      store.set((current) => ({ ...current, phase: 'creating', error: null }));
      try {
        const created = await client.call('terminal.create', { cols, rows, ...(shell ? { shell } : {}) });
        const tab = {
          terminalId: created.terminalId,
          title: created.title || created.shell || 'shell',
          shell: created.shell,
          pid: created.pid,
          exited: false,
          exitCode: null,
        };
        store.set((current) => ({ ...current, tabs: [...current.tabs, tab], activeId: tab.terminalId, phase: 'ready', error: null }));
        return tab;
      } catch (error) {
        store.set((current) => ({ ...current, phase: 'error', error: error?.message ?? '无法创建终端' }));
        notify?.('error', error?.message ?? '无法创建终端', { code: error?.code });
        return null;
      }
    },

    async write(id, data) {
      if (!data) return;
      const item = channel(id);
      // Contract caps a single write at 65536 characters; shells never need more per keystroke batch.
      for (let index = 0; index < data.length; index += LIMITS.terminalWriteChars) {
        const slice = data.slice(index, index + LIMITS.terminalWriteChars);
        try {
          await client.call('terminal.write', { terminalId: id, data: slice });
        } catch (error) {
          if (error?.code === 'E_TERMINAL_GONE') {
            stop(id);
            return;
          }
          notify?.('error', '终端写入失败', { code: error?.code });
          return;
        }
        void item;
      }
    },

    /** Rename a tab: the Host keeps the custom title, so a reload keeps it too. */
    async rename(id, title) {
      const next = String(title ?? '').trim();
      if (!next) return null;
      try {
        const result = await client.call('terminal.rename', { terminalId: id, title: next.slice(0, 200) });
        store.set((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => (tab.terminalId === id ? { ...tab, title: result.title ?? next } : tab)),
        }));
        return result;
      } catch (error) {
        notify?.('error', error?.message ?? '无法重命名终端', { code: error?.code });
        return null;
      }
    },

    async resize(id, cols, rows) {
      if (!cols || !rows) return;
      try {
        await client.call('terminal.resize', { terminalId: id, cols, rows });
      } catch {
        // A resize on a dead terminal is not worth an error line.
      }
    },

    async close(id) {
      stop(id);
      channels.delete(id);
      store.set((current) => {
        const tabs = current.tabs.filter((tab) => tab.terminalId !== id);
        return { ...current, tabs, activeId: current.activeId === id ? (tabs[tabs.length - 1]?.terminalId ?? null) : current.activeId };
      });
      try {
        await client.call('terminal.close', { terminalId: id });
      } catch (error) {
        if (error?.code !== 'E_TERMINAL_GONE') notify?.('error', '关闭终端失败', { code: error?.code });
      }
    },

    activate(id) {
      store.set((current) => ({ ...current, activeId: id }));
    },

    /** After a browser refresh the Host may still own terminals: reconcile, don't recreate. */
    async reconcile() {
      try {
        const listing = await client.call('terminal.list', {});
        const known = new Set(store.getSnapshot().tabs.map((tab) => tab.terminalId));
        const adopted = (listing.terminals ?? [])
          .filter((item) => !known.has(item.terminalId))
          .map((item) => ({ ...item, title: item.title || item.shell || 'shell' }));
        if (adopted.length) {
          store.set((current) => ({ ...current, tabs: [...current.tabs, ...adopted] }));
        }
      } catch {
        // No host terminals is a normal first-run state.
      }
    },

    dispose() {
      disposed = true;
      for (const id of [...channels.keys()]) {
        stop(id);
        channels.delete(id);
        void client.call('terminal.close', { terminalId: id }).catch(() => {});
      }
      store.set({ tabs: [], activeId: null, phase: 'idle', error: null });
    },

    get disposed() {
      return disposed;
    },
  };

  return controller;
}
