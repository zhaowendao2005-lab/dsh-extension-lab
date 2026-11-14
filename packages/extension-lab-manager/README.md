# extension-lab-manager

Standalone private extension catalog and installer for DeepSeek Harness. It owns the
Plugin Manager tab, catalog loading, GitHub install specs, and update/install actions.
The UI styling package is independent and is not required to open this tab.

## Index Specification

This manager supports DSH Plugin Market Format 1 (JSON Schema). The root `marketplace.json` must
adhere to the `{ format: 1, title: LocalizedText, metadata: MarketIndexMetadata, plugins: MarketPlugin[] }` structure.

## Install targets

Each entry in `marketplace.json` must define `versions` and `metadata`. Example:
```json
{
  "name": "dsh-workspace-ide",
  "metadata": { "keywords": ["ide"], "labels": [], "sortKeys": {} },
  "versions": [
    {
      "version": "1.0.0",
      "publishTimestamp": 1794669000,
      "source": { "type": "git", "url": "...", "commit": "...", "path": "..." },
      "engines": { "dsh": ">=0.2.0" }
    }
  ]
}
```
Production entries use a pinned GitHub tag and repository subdirectory; the Host
plugin manager resolves the `spec` generated from this metadata with `pnpm add`.
Development builds use `link:` specs derived from the checkout root.
