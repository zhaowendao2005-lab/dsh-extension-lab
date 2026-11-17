/**
 * The `conversation` namespace copy the vendored tool-call row reads.
 *
 * Verbatim from the DSH locale table (the default zh block of
 * ui-conversation/src/client/locales.ts). DSH resolves these through the
 * `TranslateNS<'conversation'>` seat; the plugin has no seat of its own, so the
 * row looks the same keys up here and falls back to the key itself.
 */

/** Locale key -> display copy, exactly as DSH ships it. */
export const CONVERSATION_LABELS: Record<string, string> = {
  'ask.rowTitle': '提问',
  'row.failed': '失败',
  'row.input': '输入',
  'row.inspect': '查看',
  'row.output': '输出',
  'row.preparing': '正在准备调用',
  'row.running': '运行中',
  'row.stopped': '已停止',
  'todo.rowTitle': '更新任务清单',
  'tool.title.applyPatch': '编辑',
  'tool.title.bash': '运行命令',
  'tool.title.closeTerminal': '关闭终端',
  'tool.title.code': '代码',
  'tool.title.createGoal': '创建目标',
  'tool.title.createSchedule': '创建自动化任务',
  'tool.title.createTeamTask': '创建团队任务',
  'tool.title.deleteSchedule': '删除自动化任务',
  'tool.title.edit': '编辑',
  'tool.title.editSchedule': '编辑自动化任务',
  'tool.title.findDefinition': '查找定义',
  'tool.title.findImplementation': '查找实现',
  'tool.title.findReferences': '查找引用',
  'tool.title.generic': '工具调用',
  'tool.title.getGoal': '查看目标',
  'tool.title.getTeamTask': '读取团队任务',
  'tool.title.glob': '查找文件',
  'tool.title.grep': '搜索文件内容',
  'tool.title.hoverSymbol': '查看符号信息',
  'tool.title.inspect': '查询 Cordis 环境',
  'tool.title.inspectPlugins': '检查动态插件',
  'tool.title.inspectProviders': '检查提供方',
  'tool.title.interruptAgent': '中断智能体',
  'tool.title.killJob': '取消后台任务',
  'tool.title.listAgents': '查看子智能体',
  'tool.title.listJobs': '查看后台任务',
  'tool.title.listModels': '查看可用模型',
  'tool.title.listSchedules': '查看自动化任务',
  'tool.title.listTeamTasks': '查看团队任务',
  'tool.title.listTerminals': '查看终端',
  'tool.title.lsp': '查询代码符号',
  'tool.title.officeConvert': '转换文档',
  'tool.title.officeRecalculate': '重算工作簿',
  'tool.title.officeRender': '渲染文档',
  'tool.title.openTerminal': '创建终端',
  'tool.title.pwsh': '运行命令',
  'tool.title.queryRuntime': '查询运行时',
  'tool.title.ralph': '运行循环工作流',
  'tool.title.read': '读取',
  'tool.title.readEvent': '读取事件',
  'tool.title.readImage': '读取图片',
  'tool.title.readJob': '读取任务输出',
  'tool.title.readTerminal': '读取终端',
  'tool.title.removeCordis': '移除 Cordis 插件',
  'tool.title.runCordis': '运行 Cordis 插件',
  'tool.title.search': '搜索',
  'tool.title.searchEvents': '搜索事件',
  'tool.title.searchSessions': '搜索会话',
  'tool.title.sendMessage': '发送消息',
  'tool.title.signalTerminal': '发送终端信号',
  'tool.title.spawnTeammate': '创建队友',
  'tool.title.stopCordis': '停止 Cordis 插件',
  'tool.title.subagent': '创建子智能体',
  'tool.title.subagentFork': '派生子智能体',
  'tool.title.traceEvent': '追踪事件',
  'tool.title.traceSession': '追踪会话',
  'tool.title.updateGoal': '更新目标',
  'tool.title.updateSchedule': '修改自动化任务',
  'tool.title.updateTeamTask': '更新团队任务',
  'tool.title.viewSchedule': '查看自动化任务详情',
  'tool.title.waitAgent': '等待消息…',
  'tool.title.webFetch': '网页获取',
  'tool.title.webSearch': '网页搜索',
  'tool.title.workflow': '运行工作流',
  'tool.title.write': '写入',
};

/**
 * Resolve one conversation-copy key.
 * @param key - locale key such as `row.input` or `tool.title.read`.
 * @returns the shipped copy, or the key when it is unknown.
 */
export function label(key: string): string {
  return CONVERSATION_LABELS[key] ?? key;
}
