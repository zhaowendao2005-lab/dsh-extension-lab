# dsh-ui-enhancements

Standalone DSH Client plugin for Swiss-modernist dialog and interface styling. It does
not register a Plugin Manager tab, fetch extension catalogs, or depend on the market
manager.

## Build and checks

```sh
npm run build
npm run build -- --check
npm run check:contrast
npm run check:selectors
npm run preview
npm run shots
npm test
```

`src/swiss.css` is the source of truth; `lib/client.js` is generated and committed so
the package can be composed without a build step. The plugin installs from
`cordis.patch.yml` and disposes its stylesheet on unload/HMR.

## Install

```sh
dsh plugin install /Volumes/Lenovo/dsh-extension-lab/packages/dsh-ui-enhancements
```
