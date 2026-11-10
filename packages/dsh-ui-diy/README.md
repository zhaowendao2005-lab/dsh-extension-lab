# dsh-ui-diy — private DSH market and Swiss dialogs

A DSH Client plugin that preserves the Swiss-modernist dialog stylesheet and adds a
**专属扩展** tab to the Plugin Manager. The market reads its production catalog from
[`dsh-extension-lab`](https://github.com/zhaowendao2005-lab/dsh-extension-lab); each
entry is installed only after the user presses **安装**, through the Plugin Manager's
normal install flow.

## Source modes

- `npm run build` (or `npm run build:production`) creates the production bundle. It fetches the catalog from GitHub and creates GitHub subdirectory install specs. No local development path is embedded.
- `npm run build:dev` creates a development bundle from `src/catalog.development.json`; entries resolve to `link:/Volumes/Lenovo/dsh-extension-lab/<path>`.
- The production GitHub catalog is `marketplace.json` at the repository root. Catalog entries may include a Git `ref`; this package is published from the `version-1` tag.

Catalog entries need `name`, `title`, `description`, `version`, and `path` (a package path under `packages/`). The package should be a normal DSH bundle with a manifest, compatibility range, and built exports. Keep the catalog version equal to the package version. See the repository README for the schema.


## What changes

| Surface | Before | After |
| --- | --- | --- |
| Settings dialog (`data-shortcut-modal="settings"`) | 800 × 800 px, 28 px radius, soft elevation | 80 vw × 80 vh, square, hairline border, no shadow |
| Shared confirmation modal (`Modal` primitive) | 380 / 440 px card, 28 px radius | same width, square, hairline, flat paper |
| Archive-manager dialog (`.dsham_modalDialog`) | inline 560 px, 28 px radius | 80 vw wide, ≤ 80 vh tall, square |
| Dialog scrim | translucent + `--dsw-mask-blur` | flat translucent fill, no blur |
| Nav / cards / inputs / switches / tabs / menus | rounded, layered shadows | square, hairline, accent-tinted states |

The swatch is deliberately small: paper `#faf9f6`, ink `#0a0a0b`, hairline
`#d8d6cf`, accent `#9ccc65` (dark theme: `#121213` / `#f4f3ef` / `#33332f` /
`#a5d6a7`). Every text/background pair used by the stylesheet is asserted to pass
WCAG AA (see `npm run check:contrast`).

### Deliberately untouched

- The full-screen account/platform overlay (`PlatformOverlay`) is portaled straight
  onto `<body>`; it is a full-bleed surface, not a dialog, and is excluded.
- The mobile sidebar drawer carries `role="dialog"` on the sidebar column itself,
  without a `role="presentation"` parent, so the generic rule never reaches it.
- The plugin-market full-screen view keeps its own 100 vw / 100 vh handling
  (`[data-dsh-market-fullscreen="true"]` is re-exempted).
- Small non-modal popovers (`role="menu"`, context meters, usage popovers) only get
  radius-0 / hairline treatment, they keep their own geometry.
- Any dialog below 900 px wide viewport switches to the full-bleed layout instead
  of a cramped 80% panel; below 640 px the settings grid becomes a single column.

## Install

```sh
# from this workspace directory
dsh plugin install /Volumes/Lenovo/dsh-extension-lab/packages/dsh-ui-diy
# or install it from the DSH Plugin Manager market after publishing
```

The desktop profile reads the bundle from `cordis.patch.yml`
(`- insert: - id: ui-swiss-dialogs`), so the plugin loads with the next
composition — refresh the window after installing. To remove it, uninstall the
bundle; the injected `<style>` tag is disposed by its `ctx.effect` cleanup.

Installing a *changed* copy of an already-installed bundle is rejected while HMR is
active: uninstall first, then install again.

## Develop

```sh
npm run build            # src/swiss.css + src/client.template.js → lib/client.js
npm run build -- --check # fail if lib/client.js is stale
npm run check:contrast   # WCAG AA assertions for every palette pair
npm run check:selectors  # assert the DOM hooks still exist in the installed app
npm run preview          # build a local, offline rendering of the real dialog DOM
npm run shots            # screenshot preview/out (needs the bundled Chromium)
npm test                 # build --check + contrast + selectors + preview + shots
```

`src/swiss.css` is the single source of truth; `lib/client.js` is generated and
committed so the bundle works without a build step. The preview harness
(`scripts/preview.mjs`, `scripts/shots.mjs`) extracts the real component CSS from the
installed app and the profile's plugins, renders the real DOM shapes, and captures
light/dark, desktop/compact, settings/confirm/archive/menu variants. It is a
development aid only — it is not shipped.

## How the selectors stay stable

Everything keys off semantic hooks the app already guarantees, never off hashed
class names:

- `[data-shortcut-modal="settings"]` — the settings dialog element itself
- `div[role="presentation"] > div[role="dialog"][aria-modal="true"]` — every centred
  modal panel (settings, confirmations, archive); excludes body-level full-screen
  layers and drawers by construction
- `.dsham_modalDialog` — archive manager's own dialog (documented plugin hook)
- `:has(> [data-shortcut-modal="settings"])` — the settings overlay, to respect the
  macOS frame's top clearance (`--dsh-frame-overlay-top`)
- `:has([data-dsh-market-fullscreen="true"])` — market full-screen exemption

`npm run check:selectors` greps the installed `app.asar` (string search, not
unpacking) and the profile's plugin bundles for those hooks so a DSH upgrade that
renames them fails loudly instead of silently un-styling the dialogs.

## Limits

- Styling only: dialogs keep their original open/close animation, focus trap, and
  shortcut handling. The visible result is also limited by the app's own inline
  styles on a few components (e.g. the archive dialog's inline `width: 560px` is
  overridden with `!important`, which is why the 80% rule is scoped to that exact
  class instead of a wildcard).
- The 80% geometry is in CSS viewport units, i.e. it tracks the window, matching the
  request "occupy 80% of the application window".
- Tested against DSH `0.2.2-rc.1` (`engines.dsh: >=0.2.0-rc.1 <0.3.0-0`).
