# extension-lab-manager

Standalone private extension catalog and installer for DeepSeek Harness. It owns the
Plugin Manager tab, catalog loading, GitHub install specs, and update/install actions.
The UI styling package is independent and is not required to open this tab.

## Install targets

Each entry in the root `marketplace.json` carries an explicit production `spec`.
Production entries use a pinned GitHub tag and repository subdirectory; the Host
plugin manager resolves that spec with `pnpm add` and records it in the active DSH
profile. Development builds replace the production spec with a portable `link:`
spec derived from the checkout root. Set `DSH_EXTENSION_LAB_ROOT` when building from
a wrapper or CI process whose working directory is not the repository.
