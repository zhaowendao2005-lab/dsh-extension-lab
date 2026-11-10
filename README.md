# dsh-extension-lab

Private extension source and catalog for DeepSeek Harness.

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

Clone this repository to `/Volumes/Lenovo/dsh-extension-lab`. In the market plugin checkout, add development entries to `src/catalog.development.json`; those entries are compiled as `link:/Volumes/Lenovo/dsh-extension-lab/<path>`. Build with `npm run build:dev`. The normal `npm run build` output is production mode and contains no local link paths.
