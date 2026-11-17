/**
 * Local copy table for the vendored chat rows.
 *
 * The reference renderer received a `t` seat from the DSH locale bundle; a
 * plugin cannot reach that bundle, so the exact Chinese strings the DSH Chinese
 * locale (ui-chat `locale.ts` + the common `number.*` keys) publishes for these
 * keys live here verbatim and the same `t(key, params)` surface stays in place.
 * Swapping this table for a Host-provided one is a pure data change.
 */

/** Every message key the rows below can ask for. */
export type ChatLocaleKey =
  | 'copy'
  | 'copied'
  | 'row.running'
  | 'message.think'
  | 'message.stopped'
  | 'message.branch'
  | 'message.branchUnavailable'
  | 'message.taskStopped'
  | 'message.turnError'
  | 'message.maxTokens'
  | 'message.maxTokens.hint'
  | 'message.tokensPerSecond'
  | 'message.extraBlock'
  | 'message.unknownBlock'
  | 'message.referenceSummary'
  | 'message.referenceSeparator'
  | 'message.failure.auth'
  | 'message.failure.accountSignedOut'
  | 'message.failure.interrupted'
  | 'message.failure.accountSignInRequired'
  | 'message.failure.quota'
  | 'message.turnUsage.title'
  | 'message.turnUsage.consumed'
  | 'message.turnUsage.model'
  | 'message.turnUsage.cacheHit'
  | 'message.turnUsage.input'
  | 'message.turnUsage.cacheRead'
  | 'message.turnUsage.cacheWrite'
  | 'message.turnUsage.output'
  | 'message.turnUsage.reasoning'
  | 'message.turnUsage.count'
  | 'duration.compactSeconds'
  | 'duration.compactMinutes'
  | 'duration.milliseconds'
  | 'duration.secondUnit'
  | 'duration.minuteUnit'
  | 'duration.hourUnit'
  | 'stats.counts'
  | 'stats.cacheHit'
  | 'stats.dialog.title'
  | 'stats.dialog.usageTitle'
  | 'stats.dialog.llmTime'
  | 'stats.dialog.toolTime'
  | 'stats.dialog.ttft'
  | 'stats.dialog.speed'
  | 'number.thousand'
  | 'number.million'
  | 'number.groupSeparator'
  | 'json.truncated'
  | 'clock.md'
  | 'clock.ymd';

/** Placeholder values substituted into one message. */
export type ChatTranslateParams = Record<string, string | number>;

/** Locale seat shape shared by every vendored component. */
export type ChatTranslate = (key: ChatLocaleKey, params?: ChatTranslateParams) => string;

/** Chinese copy, verbatim from the DSH Chinese locale. */
const ZH: Record<ChatLocaleKey, string> = {
  copy: '复制',
  copied: '复制成功',
  'row.running': '运行中',
  'message.think': '思考',
  'message.stopped': '已停止',
  'message.branch': '在新对话中分支',
  'message.branchUnavailable': '仅可从已完成轮次的最后一条消息分支',
  'message.taskStopped': '任务已停止',
  'message.turnError': '本轮运行失败',
  'message.maxTokens': '已达到输出 token 上限',
  'message.maxTokens.hint': '回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
  'message.tokensPerSecond': '{tps} tok/s',
  'message.extraBlock': '附加内容块',
  'message.unknownBlock': '未知内容块',
  'message.referenceSummary': '引用会话 · {labels}',
  'message.referenceSeparator': '、',
  'message.failure.auth': 'API 密钥无效',
  'message.failure.accountSignedOut': '任务已因退出 DeepSeek 登录而停止。',
  'message.failure.interrupted': 'DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。',
  'message.failure.accountSignInRequired': '请先登录 DeepSeek，并确认请求地址支持账号认证。',
  'message.failure.quota': '当前请求的额度已用尽',
  'message.turnUsage.title': '本轮用量',
  'message.turnUsage.consumed': '用量 {total}',
  'message.turnUsage.model': '提供方 / 模型',
  'message.turnUsage.cacheHit': '缓存命中',
  'message.turnUsage.input': '未缓存输入',
  'message.turnUsage.cacheRead': '缓存读取',
  'message.turnUsage.cacheWrite': '缓存写入',
  'message.turnUsage.output': '输出',
  'message.turnUsage.reasoning': '（其中推理 {tokens}）',
  'message.turnUsage.count': '{count} tok',
  'duration.compactSeconds': '{seconds}秒',
  'duration.compactMinutes': '{minutes}分{seconds}秒',
  'duration.milliseconds': '{milliseconds}毫秒',
  'duration.secondUnit': '秒',
  'duration.minuteUnit': '分',
  'duration.hourUnit': '小时',
  'stats.counts': '{turns} 轮 {steps} 步',
  'stats.cacheHit': '缓存命中 {percent}%',
  'stats.dialog.title': '会话统计',
  'stats.dialog.usageTitle': 'Token 用量',
  'stats.dialog.llmTime': '模型用时',
  'stats.dialog.toolTime': '工具调用用时',
  'stats.dialog.ttft': '首 token 平均（TTFT）',
  'stats.dialog.speed': '输出速度（TPS）',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
  'number.groupSeparator': ',',
  'json.truncated': '… 已截断，共 {total} 字符',
  'clock.md': '{m}月{d}日',
  'clock.ymd': '{y}年{m}月{d}日',
};

/**
 * Resolve one message with `{name}` placeholders substituted.
 * @param key - message key.
 * @param params - placeholder values; unknown placeholders stay untouched.
 * @returns the final text.
 */
export const t: ChatTranslate = (key, params) => {
  const template = ZH[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
};
