import { h, useStore } from '../runtime.js';
import { Header } from './header/Header.js';
import { Toolbar } from './toolbar/Toolbar.js';
import { Body } from './body/Body.js';

/** Root of the right-pane page: header, toolbar, notices, then the split body. */
export function Panel({ store }) {
  const state = useStore(store);
  const snapshot = state.snapshot;
  const binding = snapshot?.binding;
  return h('div', { className: 'pds' },
    h(Header, { binding, onRefresh: () => { void store.refresh(); } }),
    h(Toolbar, {
      snapshot,
      busy: state.busy,
      onLaunch: () => { void store.launch(); },
      onStop: () => { void store.stop(); },
    }),
    !binding
      ? h('div', { className: 'pds-empty' }, state.loading
        ? '正在读取绑定…'
        : '当前会话尚未绑定插件。让 Agent 调用 plugin_dev 的 bind 绑定工作区内的插件目录。')
      : null,
    state.error ? h('div', { className: 'pds-alert', role: 'alert' }, state.error) : null,
    snapshot?.runtime?.error ? h('div', { className: 'pds-alert', role: 'alert' }, snapshot.runtime.error) : null,
    h(Body, { store, state }),
  );
}
