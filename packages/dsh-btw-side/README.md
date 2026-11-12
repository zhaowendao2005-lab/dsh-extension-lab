# dsh-btw-side

旁路提问（BTW）：在**不打断主线**的前提下，基于当前会话**最新一次真实模型请求**的上下文独立回答一个问题。

```
/btw 这个仓库的构建命令是什么？
```

- **取真实的请求记录**：在 `llm/stream` 的 prepend/global 钩子上只读捕获最近一次真实请求的 provider/model/system/tools；提问时用 `session.deriveMessages()` 取**当前**消息面（已提交的压缩结果会自然生效），再追加旁问。
- **独立运行**：侧问直接用 `ctx.llm.stream()` 回放一次，不创建 session / agent，不写入主线历史；工具只保留定义、不执行。
- **独立展示**：输入框上方的 BTW 栏（`conversation.input.dock`），通过手写 Typert stream Remote（`btwSide/watch`）实时接收 accepted / delta / status / done / error / cancelled 帧。
- **共存**：命令名与其它插件冲突时自动降级为 `btw2` / `btw-side`；不改写命令表、不占用别人的 slot id。

## 构建

```bash
cd packages/dsh-btw-side
node scripts/build.mjs     # tsc --noEmit + esbuild host/client
```

要求 Node `>=22.19.0`、DSH `>=0.2.2-rc.1 <0.3.0-0`。

## 配置

设置中心新增「旁路提问」分页（`settings.section`，namespace `btw-side`）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `commandName` | `btw` | 命令名；冲突时按 `onConflict` 处理 |
| `onConflict` | `rename` | `rename`=自动改用 btw2/btw-side，`disable`=放弃注册 |
| `barForm` | `dock` | `dock`=输入框上方的栏（P1）；`right-tab`=右侧栏页签（P2） |
| `compression` | `inherit` | `inherit`=沿用主会话压缩归因；`isolated`=独立合成会话 id；`direct`=无归因 |
| `maxTokens` | `8192` | 侧问最大输出 tokens |
| `timeoutMs` | `120000` | 侧问超时（毫秒） |
| `maxConcurrent` | `3` | 全局并发上限 |
| `maxPerSession` | `20` | 每个会话保留的旁问条数 |
| `showProvenance` | `true` | 是否显示上下文来源（模型/消息数/时间） |

## 开发沙箱

插件已绑定到当前会话的插件沙箱（`.dsh/plugin-dev/<sessionId>/binding.json`）：

1. 右栏「插件沙箱」→ 运行时「启动」；
2. 在「提供商与模型」勾选要注入的模型；
3. 浏览器打开沙箱 URL，沙箱内即可用 `/btw` 与 BTW 栏调试。

> 沙箱内设置分页为**只读**：插件是通过命令行 `--patch` overlay 注入的，Harness 的配置编辑器会以「overridden by a home patch or command-line overlay」拒绝写入（这是沙箱的安全设计，不是插件 bug）。安装到正式 profile 后设置即可保存。

## 设计

完整设计见 `design/btw/DESIGN.md`（捕获、payload 组装、压缩等价性、帧协议、UI、冲突矩阵、验证清单）。

P1 限制：无 markdown 渲染、无跨刷新持久化、侧问不执行工具、右侧栏页签为 P2；命令行保留在转录中（用于让 `/btw` 的失败原因可见，DESIGN §5.6 的 commandview 隐藏列为 P2）。
