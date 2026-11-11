# dsh-ui-enhancements

Standalone DSH Client plugin for Swiss-modernist dialog and interface styling. It does
not register a Plugin Manager tab, fetch extension catalogs, or depend on the market
manager.

## Build

```sh
pnpm run build            # 生成 lib/client.js
pnpm run build -- --check # 只校验产物是否最新
```

`src/swiss.css` is the source of truth; `lib/client.js` is generated and committed so
the package can be composed without a build step. The plugin installs from
`cordis.patch.yml` and disposes its stylesheet on unload/HMR.

对比度、选择器、截图、preview 等检查脚本只在用户批准测试计划后使用（见仓库根 README「测试纪律」）。

## Install

```sh
dsh plugin install <本仓库>/packages/dsh-ui-enhancements
```
