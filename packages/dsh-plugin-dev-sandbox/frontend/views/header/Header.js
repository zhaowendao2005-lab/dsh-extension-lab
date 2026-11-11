import { h } from '../../runtime.js';

/** Title shows the bound plugin; the meta line shows the workspace-relative path. */
export function Header({ binding, onRefresh }) {
  return h('header', { className: 'pds-head' },
    h('span', { className: 'pds-head-title' }, binding?.name || '插件沙箱'),
    h('span', { className: 'pds-head-meta' }, binding?.pluginPath || '未绑定插件'),
    h('button', { type: 'button', className: 'pds-head-button', title: '刷新状态', onClick: onRefresh }, '↻'));
}
