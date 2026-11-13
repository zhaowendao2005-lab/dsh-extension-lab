import React, { setReact } from './runtime';
import cssText from './styles.css';
import { AntigravitySettingsPanel } from './SettingsPanel';
import enLocale from '../../locale/en.json';
import zhLocale from '../../locale/zh-CN.json';

const PLUGIN_ID = 'dsh-antigravity';
const SECTION_ID = 'antigravity';
const LOCALE_NS = 'antigravity';

function installStyles(): () => void {
  const existing = document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`);
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.dataset.plugin = PLUGIN_ID;
  style.textContent = cssText;
  document.head.appendChild(style);
  return () => style.remove();
}

function AntigravityIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 16h-4l-4-8-4 8H4L12 3z" />
      <circle cx={12} cy={17} r={1.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

window.__ModuleLoader__?.load({
  id: PLUGIN_ID,
  factory(require) {
    setReact(require('react'));
    return {
      name: PLUGIN_ID,
      inject: ['slots', 'locale'],
      apply(ctx: any) {
        ctx.effect(() => installStyles(), `${PLUGIN_ID}.styles`);

        ctx.effect(() => {
          if (!ctx.locale || typeof ctx.locale.register !== 'function') return undefined;
          try {
            const dispose = ctx.locale.register(LOCALE_NS, {
              en: enLocale.antigravity,
              zh: zhLocale.antigravity,
              'zh-CN': zhLocale.antigravity,
            });
            return typeof dispose === 'function' ? dispose : undefined;
          } catch {
            // Best-effort locale registration.
            return undefined;
          }
        }, `${PLUGIN_ID}.locale`);

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: SECTION_ID,
                  order: 40,
                  label: () => 'Antigravity',
                },
                (props: Record<string, unknown>) => (
                  <AntigravitySettingsPanel {...props} ctx={ctx} />
                ),
              ),
            ),
          `${PLUGIN_ID}.settings`,
        );

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register(
                {
                  name: 'settings.section.icon',
                  id: SECTION_ID,
                  order: 40,
                },
                AntigravityIcon,
              ),
            ),
          `${PLUGIN_ID}.settings-icon`,
        );
      },
    };
  },
});
