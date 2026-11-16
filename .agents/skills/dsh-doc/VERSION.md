# DSH 文档快照

这份目录由 `scripts/export-dsh-skill.mjs` 从**已安装的** DeepSeek Harness 导出，供 Antigravity CLI（`agy`）这类读不了 `app.asar` 的 agent 使用。

- DSH 版本：`0.2.2-rc.3`
- 导出时间：`2026-11-15T08:33:00.596Z`
- 安装根：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh`
- 文档：`/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/dsh-docs`（29 个顶层条目）
- 包参考：`/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/packages`（667 个 README）

## 需要当前进程事实时

快照只描述**安装时的代码与文档**，描述不了正在跑的进程。要看活实例（挂了哪些插件、某个 Service 的签名、某个 Slot 的占位），用 asar 感知的运行时直读：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e "console.log(require('node:fs').readFileSync(process.argv[1], 'utf8'))" \
  "<asar 内的绝对路径>"
```

## 刷新

DSH 升级后快照会过期。重新导出（覆盖同一目录）：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  scripts/export-dsh-skill.mjs
```

## 边界

- 这是**只读参考资料**，不是权限：导出不授权改动 DSH 安装、profile 或任何插件。
- 版本号对不上时以安装目录里的 `README`/源码为准，别拿快照当现行事实。
