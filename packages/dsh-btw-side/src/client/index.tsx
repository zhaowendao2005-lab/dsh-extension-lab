/**
 * Client entry: DSH ModuleLoader bootstrap for the BTW bar and its settings page.
 *
 * - mounts the hand-written strict Remote contract (`btwSide/watch|state|close|clear`);
 * - registers the dock bar (`conversation.input.dock`, id `btw-side`);
 * - keeps the side-command transcript row visible so `/btw` failures stay discoverable;
 * - registers the settings section + nav icon (`settings.section`, id `btw-side`).
 *
 * React comes from the host (`require('react')`); nothing React-related is bundled.
 */
import { setReact } from './runtime'
import type * as ReactTypes from 'react'
import { remoteInfo } from '../shared/contract'
import { NS, dictionaries } from './i18n'
import styles from './styles.css'
import { BtwStoreRegistry } from './store'
import { BtwBar } from './Bar'
import { SettingsPage, SettingsStore, SettingsIcon } from './Settings'

const ID = 'dsh-btw-side'
/** Dock registration id (also the settings section id). */
const ENTRY_ID = 'btw-side'
window.__ModuleLoader__?.load({
  id: ID,
  factory(require) {
    setReact(require('react') as typeof ReactTypes)
    return {
      name: ID,
      inject: ['slots', 'remote', 'locale', 'sessions', 'configForms'],
      async apply(ctx: any) {
        // Localized `t` for the registration label thunks; the slot kit injects
        // the same namespace-bound `t` prop into every registered component.
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, dictionaries), `${ID}.locale`)

        const unmount = await ctx.remote.$mount(remoteInfo)
        ctx.effect(() => unmount, `${ID}.remote`)

        ctx.effect(() => {
          const element = document.createElement('style')
          element.dataset.plugin = ID
          element.textContent = styles
          document.head.appendChild(element)
          return () => element.remove()
        }, `${ID}.styles`)

        // One store per session; its single watch consumer starts on mount and
        // stops with the plugin scope.
        const registry = new BtwStoreRegistry(ctx)
        ctx.effect(() => () => registry.dispose(), `${ID}.stores`)

        // Cordis forbids reading `ctx.remote.<ns>` outside an injected context;
        // resolve both namespaces once and hand them to the per-session stores.
        ctx.inject(['remote.btwSide', 'remote.commands'], (remoteCtx: any) => {
          registry.attachRemotes(remoteCtx.get('remote.btwSide'), remoteCtx.get('remote.commands'))
        })

        const sessionIdOf = (value: unknown): string => {
          if (typeof value === 'string') return value
          if (value !== null && typeof value === 'object') {
            const owner = value as { sessionId?: unknown; session?: { sessionId?: unknown } }
            if (typeof owner.sessionId === 'string') return owner.sessionId
            if (typeof owner.session?.sessionId === 'string') return owner.session.sessionId
          }
          return ''
        }

        // Collapsed strip / expanded panel above the composer. The bar renders
        // `null` while the session has no side questions.
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.dock', () =>
              ctx.slots.register(
                {
                  name: 'conversation.input.dock',
                  id: ENTRY_ID,
                  order: 0,
                  locale: NS,
                  label: () => t('bar.label'),
                  inject: (session: unknown) => {
                    const sessionId = sessionIdOf(session)
                    return { store: registry.storeFor(sessionId), sessionId }
                  },
                },
                BtwBar,
              ),
            ),
          `${ID}.dock`,
        )

        // Settings: the form store talks to the settings service through the
        // shared config forms; without that service the page degrades to a
        // read-only notice instead of breaking the section.
        const settingsStore = new SettingsStore(ctx)
        ctx.effect(() => () => settingsStore.dispose(), `${ID}.settings-store`)
        ctx.inject(['configForms'], (configCtx: any) => {
          const forms = configCtx.get?.('configForms')
          if (forms !== undefined && forms !== null) settingsStore.connect(forms)
        })

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: ENTRY_ID,
                  order: 50,
                  label: () => t('settings.nav'),
                  locale: NS,
                  inject: () => ({ store: settingsStore }),
                },
                SettingsPage,
              ),
            ),
          `${ID}.settings`,
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register(
                { name: 'settings.section.icon', id: ENTRY_ID, order: 50 },
                SettingsIcon,
              ),
            ),
          `${ID}.settings-icon`,
        )
      },
    }
  },
})
