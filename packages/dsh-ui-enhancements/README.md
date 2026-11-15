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

## 模型选择面板

快捷键默认 `Mod+Shift+M`（可在设置里改）。搜索框只接受英文（ASCII）字符：模型 id、
提供商名、模型名都是英文，输入法候选（中文/全角符号）不会被写入，也不会抢走用于
提交候选的 `Enter` 与用于选词的 `↑`/`↓`。选中模型是两段式确认：

1. 第一次 `Enter`（或点击行）勾上复选框，并在该行下面展开思考级别（Effort）行：
   `←` / `→` 调整级别，点击圆点或两侧箭头也可以；级别名与说明来自模型适配器。
   模型不支持思考时，该行显示「无法思考」。
2. 第二次 `Enter`（或再次点击该行）以当前级别确认，焦点回到输入框可以直接继续输入。

展开状态按 Esc 退出，`←` / `→` 恢复为左右栏切换；再按 Esc 关闭面板。
思考级别按模型记住，面板下次打开仍保留；当前会话已有的级别会同步回来。

## Install

```sh
dsh plugin install <本仓库>/packages/dsh-ui-enhancements
```
