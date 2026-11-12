import Schema from '@deepseek-ai/schemastery'
import { hostContribution } from '../shared/contract'
import { CaptureStore, installCapture } from './capture'
import { FrameBus, RunManager } from './run'
import { BtwSideService } from './service'
import { registerSideCommand } from './command'
import { normalizeConfig } from './types'

export const name = 'dsh-btw-side'
export const inject = ['commands', 'typert']

const stringEnum = (values: string[], fallback: string) => {
  const schema = (Schema.union as any)(values)
  return schema.default(fallback) as any
}

export const Config = Schema.object({
  commandName: Schema.string()
    .default('btw')
    .pattern(/^[A-Za-z][\w-]{0,31}$/)
    .description('旁路提问命令名；与其它插件冲突时按 onConflict 处理')
    .volatile(),
  onConflict: stringEnum(['rename', 'disable'], 'rename').description(
    '命令名冲突时的行为：rename=自动改用 btw2/btw-side，disable=放弃注册',
  ).volatile(),
  barForm: stringEnum(['dock', 'right-tab'], 'dock').description(
    '旁路栏形态：dock=输入框上方的栏，right-tab=右侧栏页签（P2）',
  ).volatile(),
  compression: stringEnum(['inherit', 'isolated', 'direct'], 'inherit').description(
    '侧问的压缩归因：inherit=沿用主会话（与压缩插件等价），isolated=完全独立的合成会话 id，direct=无归因',
  ).volatile(),
  maxTokens: Schema.number().min(64).max(8192).default(8192).description('侧问最大输出 tokens').volatile(),
  timeoutMs: Schema.number().min(1000).max(300000).default(120000).description('侧问超时（毫秒）').volatile(),
  maxConcurrent: Schema.number().min(1).max(16).default(3).description('全局并发侧问上限').volatile(),
  maxPerSession: Schema.number().min(1).max(20).default(20).description('每个会话保留的旁问条数').volatile(),
  showProvenance: Schema.boolean().default(true).description('是否在旁问卡片上显示上下文来源').volatile(),
})

export function apply(ctx: any, config: unknown): void {
  const cfg = normalizeConfig(config)
  if (typeof ctx?.commands?.register !== 'function' || typeof ctx?.typert?.register !== 'function') {
    console.warn('[dsh-btw-side] 缺少 commands/typert 服务，插件未启用')
    return
  }

  const bus = new FrameBus()
  const capture = new CaptureStore()
  const runs = new RunManager(ctx, cfg, capture, bus)
  // The service binds itself to the typert namespace in its constructor.
  // eslint-disable-next-line no-new
  new BtwSideService(ctx, { runs, bus })

  ctx.effect(() => ctx.typert.register(hostContribution), 'btw-side.remote')
  installCapture(ctx, capture)
  registerSideCommand(ctx, cfg, runs)
  ctx.effect(
    () =>
      ctx.on('session/disposed', (session: any) => {
        const sessionId = session?.id
        if (typeof sessionId === 'string') runs.clear(sessionId)
      }),
    'btw-side.session',
  )
  ctx.effect(() => () => runs.abortAll(), 'btw-side.cleanup')
}
