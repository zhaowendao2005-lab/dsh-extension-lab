# dsh-plugin-dev-sandbox

DSH 插件开发沙箱：给插件开发一个与真实 profile 隔离的运行目录，外加一个调试面板。

## 界面上在哪

| 位置 | 名称 | 内容 |
| --- | --- | --- |
| 插件页（左栏「插件」） | **开发沙箱** 标签页 | 沙箱路径、宿主 API 速查 |
| 右侧边栏「添加标签」菜单 | **Plugin Debug** | 同一份沙箱信息 |

两者都是只读的信息面板；真正的能力在宿主服务上（见下）。

## 宿主服务 `pluginDev`

任何宿主插件 `inject: ["pluginDev"]` 后可用：

```js
const info = await ctx.pluginDev.launch("exp-1");
// → { id, pid, dshHome }
ctx.pluginDev.status("exp-1"); // → { id, pid, running } | null
ctx.pluginDev.stop("exp-1");   // → true | false
ctx.pluginDev.home();          // → <workspace>/.dsh_plugin_dev
ctx.pluginDev.stopAll();
```

约束：

- `DSH_HOME` 固定指向 `<workspace>/.dsh_plugin_dev`（工作区内），不会污染真实 profile。
- `launch(id, home)` 的第二个参数可覆盖目录，但必须位于工作区内，否则抛
  `Invalid DSH_HOME: path must be inside the workspace`。
- 插件 dispose 时自动 `stopAll()`。

## 已知边界

`launch()` 起的子进程目前是一个占位的 Node 进程（`node -e "setInterval(...)"`），只保证
`DSH_HOME` 环境隔离与生命周期回收，**并不会真正启动一个 DSH 实例**。要接真实 launcher，
需要在宿主侧拿到官方启动入口后再替换 `createSandboxManager` 的 `command` / 参数。客户端暂时
没有 launch/stop 按钮，因为宿主服务尚未通过 remote 暴露给浏览器端。

## 结构

- `src/host.js`：`sandboxHome` / `resolveSandboxHome` / `createSandboxManager`（纯函数，有 `node:test` 覆盖）
- `src/index.js`：宿主入口，`apply(ctx, config)` 提供 `pluginDev`
- `src/client.template.js`：浏览器端，注册插件页标签与右侧调试标签
- `scripts/build.mjs`：把 `src/*.js` 全部拷进 `lib/`，并校验两端入口形态
