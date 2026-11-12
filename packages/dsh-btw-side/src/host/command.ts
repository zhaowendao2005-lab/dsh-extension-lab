import type { BtwConfig } from './types'
import type { RunManager } from './run'
import { BtwError } from './payload'

function candidatesOf(base: string, onConflict: BtwConfig['onConflict']): string[] {
  const list = [base]
  if (onConflict === 'rename') {
    list.push(`${base}2`, `${base}-side`)
  }
  return [...new Set(list.filter((name) => name.length > 0))]
}

/**
 * Registers the side-ask command. DSH throws on duplicate names, so a conflict
 * is detected by trial registration and resolved with the alias chain
 * (btw -> btw2 -> btw-side). Never patches the command registry.
 */
export function registerSideCommand(ctx: any, config: BtwConfig, runs: RunManager): void {
  ctx.effect(() => {
    const candidates = candidatesOf(config.commandName, config.onConflict)
    let lastError: unknown
    for (const name of candidates) {
      try {
        const dispose = ctx.commands.register({
          name,
          description: '旁路提问：基于当前最新真实模型请求上下文独立回答，不打断主线',
          input: { hint: '<问题>' },
          recordInput: false,
          handler: async (invocation: any) => {
            try {
              runs.start(invocation?.agent?.session, String(invocation?.rawInput ?? ''))
              return { kind: 'success', text: '' }
            } catch (error) {
              if (error instanceof BtwError) return { kind: 'error', text: error.message }
              const message = error instanceof Error && error.message !== '' ? error.message : '旁路提问暂时不可用'
              return { kind: 'error', text: message }
            }
          },
        })
        runs.commandName = name
        return dispose
      } catch (error) {
        lastError = error
      }
    }
    console.warn(
      '[dsh-btw-side] 无法注册旁路提问命令（可能是命令名冲突）：',
      lastError instanceof Error ? lastError.message : lastError,
    )
    return () => {}
  }, 'btw-side.command')
}
