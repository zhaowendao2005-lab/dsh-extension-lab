import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_CONFIG,
  hostContribution,
  PACKAGE_ID,
  SERVICE_KEY,
  type CatalogProvider,
  type CatalogResult,
} from '../shared/contract'

export const name = PACKAGE_ID
export const inject = ['typert']

export const Config = Schema.object({
  enableSwissSettings: Schema.boolean()
    .default(DEFAULT_CONFIG.enableSwissSettings)
    .description('启用 Swiss 现代主义设置弹窗样式（80% 视口、序号导航栏、方正排版）')
    .volatile(),
  enableSwissModals: Schema.boolean()
    .default(DEFAULT_CONFIG.enableSwissModals)
    .description('启用通用模态框、归档管理器与开关控件的 Swiss 样式')
    .volatile(),
  enableSwissPopovers: Schema.boolean()
    .default(DEFAULT_CONFIG.enableSwissPopovers)
    .description('启用右键菜单与非模态浮层的直角化修正')
    .volatile(),
  enableSwissMarket: Schema.boolean()
    .default(DEFAULT_CONFIG.enableSwissMarket)
    .description('启用插件市场页面的 Swiss 主题适配')
    .volatile(),
  enableModelPicker: Schema.boolean()
    .default(DEFAULT_CONFIG.enableModelPicker)
    .description('启用「模型选择改善」面板（与输入框等宽、支持模糊搜索与提供商侧栏）')
    .volatile(),
  modelPickerShortcut: Schema.string()
    .default(DEFAULT_CONFIG.modelPickerShortcut)
    .description('打开/关闭模型选择面板的快捷键（如 Mod+Shift+M、Alt+M）')
    .volatile(),
})

const remoteInitializers: Array<() => void> = []

function markRemoteMethod(methodName: string, fn: unknown): void {
  ;(Remote as any)(methodName)(fn, {
    kind: 'method',
    name: methodName,
    static: false,
    addInitializer(init: () => void) {
      remoteInitializers.push(init)
    },
  })
}

export class UiEnhancementsService extends Service {
  typertRemote: any

  constructor(ctx: any) {
    super(ctx, SERVICE_KEY)
    this.typertRemote = bindTypertRemote(this, SERVICE_KEY)
    for (const init of remoteInitializers) init.call(this)
  }

  async catalog(): Promise<CatalogResult> {
    const llm = this.ctx.get('llm')
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      return { providers: [] }
    }
    let configuredProviders: any[] = []
    try {
      const raw = llm.listProviders()
      if (Array.isArray(raw)) configuredProviders = raw
    } catch {
      return { providers: [] }
    }

    const providers: CatalogProvider[] = await Promise.all(
      configuredProviders.map(async (provider) => {
        const id = typeof provider?.id === 'string' ? provider.id : ''
        const label = typeof provider?.name === 'string' ? provider.name : id
        if (!id) return { id: '', name: '', models: [] }
        try {
          const rawModels = await llm.listModels(id)
          const models = Array.isArray(rawModels)
            ? rawModels
                .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
                .map((m) => ({
                  id: m.id as string,
                  name: m.name as string,
                  ...(typeof m.description === 'string' ? { description: m.description } : {}),
                }))
            : []
          return { id, name: label, models }
        } catch {
          return {
            id,
            name: label,
            models: [],
            error: '此提供商的模型目录加载失败',
          }
        }
      }),
    )

    return { providers: providers.filter((p) => p.id !== '') }
  }
}

markRemoteMethod('catalog', UiEnhancementsService.prototype.catalog)

export function apply(ctx: any): void {
  // Instantiate host service so `remote.uiEnhancements` can serve model catalogs.
  // eslint-disable-next-line no-new
  new UiEnhancementsService(ctx)
  if (typeof ctx?.typert?.register === 'function') {
    ctx.effect(() => ctx.typert.register(hostContribution), `${PACKAGE_ID}.remote`)
  }
}
