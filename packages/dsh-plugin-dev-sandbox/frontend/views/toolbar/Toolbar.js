import { h } from '../../runtime.js';
import { canLaunch, canStop, runtimeLabel, runtimeState } from '../../service/debug.service.js';

/** Launch/stop live here; their enablement mirrors the same rules as the tree. */
export function Toolbar({ snapshot, busy, onLaunch, onStop }) {
  const state = runtimeState(snapshot);
  const runtime = snapshot?.runtime;
  const status = runtime?.pid ? `${runtimeLabel(state)} · PID ${runtime.pid}` : runtimeLabel(state);
  return h('div', { className: 'pds-toolbar' },
    h('button', { type: 'button', className: 'pds-button primary', disabled: !canLaunch(snapshot?.binding, snapshot, busy), onClick: onLaunch }, '▶ 启动'),
    h('button', { type: 'button', className: 'pds-button', disabled: busy || !canStop(snapshot), onClick: onStop }, '■ 停止'),
    h('span', { className: 'pds-status', 'data-state': state }, status),
    runtime?.url ? h('a', { className: 'pds-status', href: runtime.url, target: '_blank', rel: 'noreferrer' }, '打开实例 ↗') : null);
}
