/**
 * Inline shortcut recorder for the Host settings page (Settings → 工作台).
 *
 * The Host owns the binding document (`shortcuts.edit`, revision-checked). This module
 * only turns one physical key press into a candidate binding, describes it with the
 * Host's own validation (`describeBinding`), and reports the outcome. Recording state is
 * a store field because views must not keep React state.
 */

import { createStore } from '../store.js';

const STATE_IDLE = { recording: null, saving: null, error: null, notice: null };

const BARE_MODIFIER = /^(?:Control|Shift|Alt|Meta|AltGraph|OS|Super|Hyper)(?:Left|Right)?$/;

/** Physical keydown → Host binding candidate; bare modifier presses wait for the real key. */
export function bindingFromKeyEvent(event) {
  const code = typeof event?.code === 'string' ? event.code : '';
  if (!code || BARE_MODIFIER.test(code)) return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('control');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  if (event.metaKey) modifiers.push('meta');
  return { code, modifiers };
}

/** Host validation code → the sentence shown under the list. */
export function shortcutIssueText(issue) {
  if (issue === 'modifier-required') return '这个按键需要搭配 Mod/⌘/Ctrl、Alt 或 Shift 才能使用。';
  if (issue === 'reserved') return '这是宿主保留的组合，换一个按键吧。';
  if (issue === 'unsupported-browser') return '浏览器不支持这个组合，换一个按键吧。';
  if (issue === 'unsupported-key') return '这个按键不支持，请用字母、数字、功能键或方向键。';
  return '这个组合不能使用，换一个按键吧。';
}

/** Host save result → the sentence shown when the binding was not stored. */
export function shortcutSaveErrorText(status) {
  if (status === 'not-ready') return '宿主快捷键配置尚未就绪，请稍后再试。';
  if (status === 'unreadable') return '无法读取宿主快捷键配置，请刷新页面后重试。';
  if (status === 'write-failed') return '保存失败：宿主未能写入快捷键配置。';
  if (status === 'stale') return '快捷键配置已在别处更新，请重试一次。';
  return '保存快捷键失败，请重试。';
}

/** Catalog row label for a command id; conflicts may reference fixed commands too. */
export function catalogLabel(catalog, id) {
  const row = Array.isArray(catalog) ? catalog.find((item) => item && item.id === id) : null;
  return row?.label || id;
}

/**
 * One editor for the plugin lifetime: the settings section subscribes to `store`, the
 * Host shortcut service is attached when the shortcuts injection becomes available.
 */
export function createShortcutEditor() {
  const store = createStore({ ...STATE_IDLE });
  let shortcuts = null;
  let readCatalog = () => [];
  let nativeRecording = false;

  const setNativeRecording = (active) => {
    if (nativeRecording === active) return;
    nativeRecording = active;
    try {
      const pending = shortcuts?.recording?.(active);
      if (pending && typeof pending.catch === 'function') {
        pending.catch((error) => console.warn('[workspace-ide] shortcut recording failed', error));
      }
    } catch (error) {
      console.warn('[workspace-ide] shortcut recording failed', error);
    }
  };

  const currentRevision = () => {
    try {
      const snapshot = shortcuts?.config?.getSnapshot?.();
      return snapshot && snapshot.status === 'ready' ? snapshot.revision ?? null : null;
    } catch {
      return null;
    }
  };

  const describe = (binding) => {
    try {
      return shortcuts?.describeBinding?.(binding) ?? null;
    } catch {
      return null;
    }
  };

  const conflictText = (ids) => {
    const catalog = readCatalog();
    const labels = [...new Set(ids)].map((id) => catalogLabel(catalog, id));
    return `与「${labels.join('、')}」冲突，请先清除对方的按键。`;
  };

  const fail = (message) => {
    store.set({ ...STATE_IDLE, error: message });
  };

  const applyResult = (result, successText) => {
    if (!result) {
      fail(shortcutSaveErrorText('failed'));
      return;
    }
    if (result.status === 'saved') {
      store.set({ ...STATE_IDLE, notice: successText });
      return;
    }
    if (result.status === 'conflict') {
      fail(result.conflicts?.length ? conflictText(result.conflicts) : '与已有快捷键冲突，换一个组合吧。');
      return;
    }
    const suffix = result.issue ? ` ${shortcutIssueText(result.issue)}` : '';
    fail(shortcutSaveErrorText(result.status) + suffix);
  };

  /** Revision-checked save with exactly one stale retry, so a concurrent edit is not lost. */
  const save = async (edit) => {
    if (!shortcuts?.edit) return { outcome: 'unavailable' };
    let revision = currentRevision();
    if (revision == null) return { outcome: 'not-ready' };
    try {
      let result = await shortcuts.edit(edit, revision);
      if (result?.status === 'stale') {
        const fresh = currentRevision();
        if (fresh != null && fresh !== revision) result = await shortcuts.edit(edit, fresh);
      }
      return { outcome: 'result', result };
    } catch (error) {
      return { outcome: 'error', error };
    }
  };

  const commit = async (id, binding, successText) => {
    store.set({ recording: null, saving: id, error: null, notice: null });
    setNativeRecording(false);
    const outcome = await save({ type: 'set', id, binding });
    if (outcome.outcome === 'unavailable') {
      fail('宿主快捷键服务不可用，只能查看当前绑定。');
      return { status: 'unavailable' };
    }
    if (outcome.outcome === 'not-ready') {
      fail(shortcutSaveErrorText('not-ready'));
      return { status: 'not-ready' };
    }
    if (outcome.outcome === 'error') {
      console.error('[workspace-ide] shortcut edit failed', outcome.error);
      fail(shortcutSaveErrorText('failed'));
      return { status: 'failed' };
    }
    applyResult(outcome.result, successText);
    return { status: outcome.result?.status ?? 'failed' };
  };

  const actions = {
    /** Connect the Host service for this runtime; the settings section may exist earlier. */
    attach({ shortcuts: nextShortcuts, catalog } = {}) {
      shortcuts = nextShortcuts ?? null;
      readCatalog = typeof catalog === 'function' ? catalog : () => [];
      store.set({ ...STATE_IDLE });
    },

    detach() {
      setNativeRecording(false);
      shortcuts = null;
      readCatalog = () => [];
      store.set({ ...STATE_IDLE });
    },

    /** Start listening for one command; the section mounts the keydown capture listener. */
    begin(id) {
      if (!shortcuts?.edit) {
        fail('宿主快捷键服务不可用，无法在这里设置按键。');
        return false;
      }
      store.set({ recording: id, saving: null, error: null, notice: null });
      setNativeRecording(true);
      return true;
    },

    cancel() {
      const state = store.getSnapshot();
      if (state.recording == null && state.saving == null) return;
      setNativeRecording(false);
      store.set({ ...STATE_IDLE });
    },

    /** One captured keydown while recording: validate with the Host, then save. */
    async keydown(id, event) {
      if (store.getSnapshot().recording !== id) return { status: 'ignored' };
      if (event?.key === 'Escape') {
        actions.cancel();
        return { status: 'cancelled' };
      }
      const candidate = bindingFromKeyEvent(event);
      if (!candidate) return { status: 'pending' };
      const described = describe(candidate);
      // The Host reports a rejected candidate as binding:null plus an issue code, so the
      // issue has to be read first or every rejection turns into the generic sentence.
      if (described?.issue) {
        store.patch({ error: shortcutIssueText(described.issue) });
        return { status: 'invalid' };
      }
      if (!described?.binding) {
        store.patch({ error: '无法识别这个按键，请换一个组合。' });
        return { status: 'invalid' };
      }
      const conflicts = (described.conflicts ?? []).filter((conflict) => conflict !== id);
      if (conflicts.length) {
        store.patch({ error: conflictText(conflicts) });
        return { status: 'conflict' };
      }
      const keys = Array.isArray(described.keys) && described.keys.length ? described.keys.join(' + ') : null;
      return commit(id, described.binding, keys ? `已绑定 ${keys}` : '已绑定按键');
    },

    /** Remove the binding (explicit null override keeps the command unbound). */
    async clear(id) {
      return commit(id, null, '已清除按键');
    },

    /** Drop the user override and go back to the Host default (unbound for these commands). */
    async reset(id) {
      store.set({ recording: null, saving: id, error: null, notice: null });
      setNativeRecording(false);
      const outcome = await save({ type: 'reset', id });
      if (outcome.outcome === 'unavailable') {
        fail('宿主快捷键服务不可用，只能查看当前绑定。');
        return { status: 'unavailable' };
      }
      if (outcome.outcome === 'not-ready') {
        fail(shortcutSaveErrorText('not-ready'));
        return { status: 'not-ready' };
      }
      if (outcome.outcome === 'error') {
        console.error('[workspace-ide] shortcut reset failed', outcome.error);
        fail(shortcutSaveErrorText('failed'));
        return { status: 'failed' };
      }
      applyResult(outcome.result, '已恢复默认按键');
      return { status: outcome.result?.status ?? 'failed' };
    },

    dispose() {
      setNativeRecording(false);
      shortcuts = null;
      store.dispose();
    },
  };

  return { store, actions };
}
