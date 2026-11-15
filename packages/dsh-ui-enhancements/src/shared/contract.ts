import { z } from 'zod'

export const PACKAGE_ID = 'dsh-ui-enhancements'
export const SERVICE_KEY = 'uiEnhancements'
export const WIRE_NAMESPACE = 'uiEnhancements'

export interface UiEnhancementsConfig {
  enableSwissSettings: boolean
  enableSwissModals: boolean
  enableSwissPopovers: boolean
  enableSwissMarket: boolean
  enableModelPicker: boolean
  modelPickerShortcut: string
}

export const DEFAULT_CONFIG: UiEnhancementsConfig = {
  enableSwissSettings: true,
  enableSwissModals: true,
  enableSwissPopovers: true,
  enableSwissMarket: true,
  enableModelPicker: true,
  modelPickerShortcut: 'Mod+Shift+M',
}

export function normalizeConfig(raw: unknown): UiEnhancementsConfig {
  const input = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    enableSwissSettings:
      typeof input.enableSwissSettings === 'boolean'
        ? input.enableSwissSettings
        : DEFAULT_CONFIG.enableSwissSettings,
    enableSwissModals:
      typeof input.enableSwissModals === 'boolean'
        ? input.enableSwissModals
        : DEFAULT_CONFIG.enableSwissModals,
    enableSwissPopovers:
      typeof input.enableSwissPopovers === 'boolean'
        ? input.enableSwissPopovers
        : DEFAULT_CONFIG.enableSwissPopovers,
    enableSwissMarket:
      typeof input.enableSwissMarket === 'boolean'
        ? input.enableSwissMarket
        : DEFAULT_CONFIG.enableSwissMarket,
    enableModelPicker:
      typeof input.enableModelPicker === 'boolean'
        ? input.enableModelPicker
        : DEFAULT_CONFIG.enableModelPicker,
    modelPickerShortcut:
      typeof input.modelPickerShortcut === 'string' && input.modelPickerShortcut.trim() !== ''
        ? input.modelPickerShortcut.trim()
        : DEFAULT_CONFIG.modelPickerShortcut,
  }
}

export interface CatalogModel {
  id: string
  name: string
  description?: string
}

export interface CatalogProvider {
  id: string
  name: string
  models: CatalogModel[]
  error?: string
}

export interface CatalogResult {
  providers: CatalogProvider[]
}

const codec = (symbol: string, shape: () => z.ZodTypeAny) => ({
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_ID}#${symbol}`,
  create: shape,
})

const catalogResultCodec = codec('CatalogResult', () =>
  z.object({
    providers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        error: z.string().optional(),
        models: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
)

const endpoint = (method: string) => `${PACKAGE_ID}#${WIRE_NAMESPACE}/${method}`

export const DESCRIPTORS: any[] = [
  {
    id: endpoint('catalog'),
    service: SERVICE_KEY,
    namespace: WIRE_NAMESPACE,
    method: 'catalog',
    invocation: { kind: 'direct' },
    parameters: [],
    result: catalogResultCodec,
  },
]

export const remoteInfo = { package: PACKAGE_ID, descriptors: DESCRIPTORS }

export const hostContribution = {
  package: PACKAGE_ID,
  face: 'host' as const,
  schemas: [] as unknown[],
  invocations: DESCRIPTORS,
  model: { symbols: [] as unknown[], exports: [] as unknown[], relations: [] as unknown[] },
}
