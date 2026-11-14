/**
 * Editor domain: the only place that reads and writes file text. Views render what is in
 * `state.tabs` and call these actions; nothing here touches CodeMirror.
 */
import { LIMITS } from '../../shared/contract.js';
import { languageForPath } from '../service/language.js';

const READ_CELLING = 8 * 1024 * 1024;
const PAGE = LIMITS.readLinesDefault;

export function createEditorDomain({ client, editor, files, notify, fail }) {
  const pending = new Map();

  function snapshot() {
    return editor.getSnapshot();
  }

  function patchTab(path, patch) {
    editor.set((state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)),
    }));
  }

  function tabOf(path) {
    return snapshot().tabs.find((tab) => tab.path === path) ?? null;
  }

  /** Read a whole text file in pages; the contract caps a single page, not the file. */
  async function readText(path) {
    const stat = await client.call('files.stat', { path });
    if (stat.type !== 'file') throw Object.assign(new Error('不是文件'), { code: 'E_INVALID_ARG' });
    if (stat.binary) return { stat, binary: true, text: '' };
    if ((stat.size ?? 0) > READ_CELLING) return { stat, tooLarge: true, text: '' };

    // Line offsets are 1-based on the wire (docs/remote-contract.md §2).
    let offset = 1;
    let text = '';
    for (;;) {
      const page = await client.call('files.read', { path, offset, limit: PAGE, expectedVersion: stat.version });
      text += page.text;
      if (page.eof || !page.text) break;
      offset = page.offset + (page.lines ?? 0);
      if (text.length > READ_CELLING) return { stat, tooLarge: true, text: '' };
    }
    return { stat, text, eol: stat.eol, bom: stat.bom };
  }

  const actions = {
    async openPath(path) {
      const existing = tabOf(path);
      const state = snapshot();
      const tabs = existing ? state.tabs : [...state.tabs, { path, title: path.split('/').pop() ?? path, dirty: false, mode: 'loading' }];
      editor.patch({ tabs, activePath: path });
      files.patch({ selected: path });
      if (existing && existing.mode === 'ready') return;
      if (pending.has(path)) return;
      const task = (async () => {
        try {
          const loaded = await readText(path);
          if (loaded.binary) {
            patchTab(path, { mode: 'binary', readOnly: true, error: '二进制文件不提供文本编辑' });
            return;
          }
          if (loaded.tooLarge) {
            patchTab(path, { mode: 'too-large', readOnly: true, text: '', error: '文件过大，未载入编辑器' });
            return;
          }
          patchTab(path, {
            mode: 'ready',
            readOnly: false,
            text: loaded.text,
            version: loaded.stat.version,
            size: loaded.stat.size,
            eol: loaded.eol ?? loaded.stat.eol,
            bom: loaded.bom ?? loaded.stat.bom,
            language: languageForPath(path),
            dirty: false,
            error: null,
          });
        } catch (error) {
          patchTab(path, { mode: 'error', error: error?.message ?? '无法读取文件' });
          fail(editor, error, '无法读取文件');
        } finally {
          pending.delete(path);
        }
      })();
      pending.set(path, task);
      await task;
    },

    /** Called on every keystroke: mark dirty only, the buffer is the source of truth. */
    updateText(path, text) {
      const tab = tabOf(path);
      if (!tab) return;
      if (tab.text === text && tab.dirty) return;
      patchTab(path, { text, dirty: true, mode: 'ready' });
    },

    async save(path) {
      const tab = tabOf(path);
      if (!tab || tab.readOnly) return false;
      try {
        const result = await client.call('files.write', {
          path,
          text: tab.text ?? '',
          expectedVersion: tab.version,
          force: false,
        });
        patchTab(path, { dirty: false, version: result?.version ?? tab.version, eol: result?.eol ?? tab.eol });
        notify('info', '已保存', { path });
        return true;
      } catch (error) {
        fail(editor, error, '保存失败');
        if (error?.code === 'E_VERSION_CONFLICT') {
          editor.set((state) => ({
            ...state,
            conflicts: [...state.conflicts, { path, at: Date.now() }],
          }));
        }
        return false;
      }
    },

    async revert(path) {
      const tab = tabOf(path);
      if (!tab) return;
      patchTab(path, { mode: 'loading', dirty: false, text: '' });
      await actions.reload(path);
    },

    /** Re-read from disk, keeping the tab identity (used by revert and by外部变更提示). */
    async reload(path) {
      try {
        const loaded = await readText(path);
        if (loaded.binary || loaded.tooLarge) {
          patchTab(path, {
            mode: loaded.binary ? 'binary' : 'too-large',
            readOnly: true,
            text: '',
            dirty: false,
            error: loaded.binary ? '二进制文件不提供文本编辑' : '文件过大，未载入编辑器',
          });
          return;
        }
        patchTab(path, {
          mode: 'ready',
          readOnly: false,
          text: loaded.text,
          version: loaded.stat.version,
          size: loaded.stat.size,
          eol: loaded.eol ?? loaded.stat.eol,
          bom: loaded.bom ?? loaded.stat.bom,
          language: languageForPath(path),
          dirty: false,
          error: null,
        });
      } catch (error) {
        patchTab(path, { mode: 'error', error: error?.message ?? '无法读取文件' });
        fail(editor, error, '无法读取文件');
      }
    },

    /** Close a tab; a dirty tab asks first (docs/ui-spec.md §7). */
    closeTab(path, { force = false } = {}) {
      const tab = tabOf(path);
      if (!tab) return { closed: true };
      if (tab.dirty && !force) return { closed: false, reason: 'dirty', path };
      const state = snapshot();
      const index = state.tabs.findIndex((item) => item.path === path);
      const tabs = state.tabs.filter((item) => item.path !== path);
      const activePath = state.activePath === path
        ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
        : state.activePath;
      editor.patch({ tabs, activePath, conflicts: state.conflicts.filter((item) => item.path !== path) });
      return { closed: true };
    },

    activateTab(path) {
      editor.patch({ activePath: path });
      files.patch({ selected: path });
      void actions.openPath(path);
    },

    /** Per-tab Markdown preview flag; the buffer keeps editing underneath. */
    togglePreview(path) {
      const state = snapshot();
      const previews = { ...(state.previews ?? {}) };
      previews[path] = !previews[path];
      editor.patch({ previews });
    },

    setCursor(path, position) {
      const tab = tabOf(path);
      if (!tab) return;
      patchTab(path, { cursor: position });
    },

    closeAll() {
      const state = snapshot();
      const dirty = state.tabs.filter((tab) => tab.dirty);
      if (dirty.length) return { closed: false, reason: 'dirty', paths: dirty.map((tab) => tab.path) };
      editor.patch({ tabs: [], activePath: null, conflicts: [] });
      return { closed: true };
    },

    resolveConflict(path) {
      editor.set((state) => ({ ...state, conflicts: state.conflicts.filter((item) => item.path !== path) }));
    },
  };

  return actions;
}
