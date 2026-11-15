import { PACKAGE_ID, type UiEnhancementsConfig } from '../shared/contract'
import tokensCss from './styles/tokens.css'
import swissSettingsCss from './styles/swiss-settings.css'
import swissModalsCss from './styles/swiss-modals.css'
import swissPopoversCss from './styles/swiss-popovers.css'
import swissMarketCss from './styles/swiss-market.css'
import pluginUiCss from './styles/plugin-ui.css'

interface StyleBlock {
  id: string
  css: string
  enabled: (cfg: UiEnhancementsConfig) => boolean
}

const STYLE_BLOCKS: readonly StyleBlock[] = [
  {
    id: 'tokens',
    css: tokensCss,
    enabled: () => true,
  },
  {
    id: 'plugin-ui',
    css: pluginUiCss,
    enabled: () => true,
  },
  {
    id: 'swiss-settings',
    css: swissSettingsCss,
    enabled: (cfg) => cfg.enableSwissSettings,
  },
  {
    id: 'swiss-modals',
    css: swissModalsCss,
    enabled: (cfg) => cfg.enableSwissModals,
  },
  {
    id: 'swiss-popovers',
    css: swissPopoversCss,
    enabled: (cfg) => cfg.enableSwissPopovers,
  },
  {
    id: 'swiss-market',
    css: swissMarketCss,
    enabled: (cfg) => cfg.enableSwissMarket,
  },
]

/**
 * Hot-swappable stylesheet manager: mounts/unmounts each feature block's
 * `<style>` tag immediately when configuration changes, with zero page reload.
 */
export class FeatureStyleManager {
  private readonly mounted = new Map<string, HTMLStyleElement>()

  constructor() {
    // Clean up any stale tags from a previous HMR/unload cycle.
    for (const stale of document.querySelectorAll(`style[data-plugin="${PACKAGE_ID}"]`)) {
      stale.remove()
    }
  }

  apply(config: UiEnhancementsConfig): void {
    for (const block of STYLE_BLOCKS) {
      const shouldEnable = block.enabled(config)
      const existing = this.mounted.get(block.id)

      if (shouldEnable && !existing) {
        const tag = document.createElement('style')
        tag.dataset.plugin = PACKAGE_ID
        tag.dataset.feature = block.id
        tag.textContent = block.css
        document.head.appendChild(tag)
        this.mounted.set(block.id, tag)
      } else if (!shouldEnable && existing) {
        existing.remove()
        this.mounted.delete(block.id)
      }
    }
  }

  dispose(): void {
    for (const tag of this.mounted.values()) {
      tag.remove()
    }
    this.mounted.clear()
  }
}
