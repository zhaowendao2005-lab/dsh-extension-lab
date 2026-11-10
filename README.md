# dsh-extension-lab

Private extension source and catalog for DeepSeek Harness.

## Root commands

Run these from the repository root with Node.js 22.19+ and pnpm 12.15+:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build the plugin with the local development catalog. |
| `pnpm build` | Build the production bundle. |
| `pnpm test` | Run bundle, contrast, selector, and preview checks. |
| `pnpm release:check` | Check package/catalog version and release-ref consistency. |
| `pnpm release:prepare -- --version 2.0.0 --tag version-2` | Update package/catalog versions, build, and test a release. |
| `pnpm release:publish -- --tag version-2` | Re-test, commit, tag, push main and tag, and create a GitHub Release. |

Commit and push changes to this root command workflow before preparing a release. Start each release from a clean, up-to-date `main`; the publish command refuses unrelated working-tree changes. `gh` must be installed and authenticated. Review the prepared diff before running the publish command.

## Catalog format

Publish a root-level `marketplace.json` with this shape:

```json
{
  "schemaVersion": 1,
  "extensions": [
    {
      "name": "@acme/dsh-example",
      "title": "Example extension",
      "description": "A short description shown in the DSH market.",
      "version": "1.0.0",
      "path": "packages/dsh-example",
      "ref": "version-1"
    }
  ]
}
```

Each path must point to a standalone DSH bundle package with its own `package.json` containing a `dsh.bundle.patch` manifest entry, compatibility range, and built exports. `ref` is an optional Git branch, tag, or commit; it defaults to `main`. DSH users discover packages here and explicitly install them; listing an entry never installs or enables it.

Production market installs use the selected package subdirectory and `ref` from this Git repository. Keep package versions and catalog versions in sync. Do not put local paths or development-only entries in this file.

## Local development

Clone this repository to `/Volumes/Lenovo/dsh-extension-lab`. Develop the market plugin under `packages/dsh-ui-diy`: edit `src/`, then use the root `pnpm dev`, `pnpm build`, and `pnpm test` commands. Development catalog entries go in `packages/dsh-ui-diy/src/catalog.development.json`; they compile as `link:/Volumes/Lenovo/dsh-extension-lab/<path>`. The root `pnpm build` output is production mode and contains no local link paths. Refresh or restart DSH after rebuilding the linked plugin.
