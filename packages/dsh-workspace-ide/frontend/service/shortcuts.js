/** Host-owned bindings. The plugin only describes registration and catalog state. */
export const SHORTCUT_COMMANDS = [
  { id: 'workspace-ide.explorer', label: '文件栏' },
  { id: 'workspace-ide.search', label: '工作区搜索' },
  { id: 'workspace-ide.scm', label: '打开改动' },
  { id: 'workspace-ide.graph', label: '提交图谱' },
  { id: 'workspace-ide.panel', label: '显示/隐藏终端' },
  { id: 'workspace-ide.quickOpen', label: '快速打开文件' },
  { id: 'workspace-ide.save', label: '保存当前文件' },
  { id: 'workspace-ide.saveAll', label: '保存全部文件' },
  { id: 'workspace-ide.nav', label: '收起/展开文件栏' },
  { id: 'workspace-ide.closeTab', label: '关闭当前标签' },
  { id: 'workspace-ide.fullview', label: '打开/关闭全视图' },
];

export function shortcutBindingLabel(catalog, status, id) {
  if (!status.available) return '快捷键服务不可用';
  if (status.failed?.includes(id)) return '注册失败';
  if (status.error) return '快捷键状态读取失败';
  const row = catalog.find((item) => item.id === id);
  if (!row) return '命令未注册';
  return row.keys?.length ? row.keys.join(' + ') : '未绑定';
}
