# agy ACP 工具收敛研究（第二轮）

日期：2026-11-15。程序：本机 `agy` 1.5.9（macOS arm64）。全部在临时目录 `/private/tmp/dsh-agy-isolation.MuAigf` 内完成，未改生产 profile、插件或 agy 全局配置。

本轮共 5 次 `session/prompt`。结论先行：**"移除原生工具"没有成功；"门控原生工具 + 保留 DSH 桥"已经跑通。**

## 一、本轮结论

| # | 结论 | 证据强度 |
|---|---|---|
| 1 | MCP 工具默认为懒加载，由内置工具 `call_mcp_tool` 调度；eager 时注册为 `mcp_<server>_<tool>` | 官方文档 + 实测 |
| 2 | 自定义 agent 的 `tools` 白名单不接受 `call_mcp_tool`，会直接让整轮失败 | 实测 |
| 3 | `toolPermission: "strict"` 可以强制原生读文件、执行命令先发权限请求 | 实测 |
| 4 | ACP 客户端拒绝这些请求后，原生读取拿不到内容、原生命令不产生副作用 | 实测 |
| 5 | 在 strict 下，DSH 的 MCP 桥**仍然可用**，能拿到真实工具返回值 | 实测（关键正向结果） |
| 6 | 隔离配置里的 `permissions.deny` 规则**没有生效** | 实测 |
| 7 | 自定义 agent 的 `tools: ["view_file"]` 没有阻止模型改用 `read_file` | 实测，方法存疑 |

## 二、关键发现：MCP 工具的两种形态

官方 [MCP 文档](https://antigravity.google/docs/mcp.md)说明：

- **懒加载（默认）**：连接后把每个工具的 schema 写到 `<app-data-dir>/mcp/<server>/<tool>.json`，系统提示里只列工具名；模型要先读 schema 文件，再用内置 `call_mcp_tool`（参数 `ServerName`/`ToolName`/`Arguments`）调用。
- **eager**：把完整声明注册成原生工具 `mcp_<serverName>_<toolName>`，一轮直接调用。

这解释了上一轮"自定义 agent 调不动桥"的原因：`tools: []` 把调度工具一起移除了。

同时产生一个重要推论：**懒加载依赖模型自己读 schema 文件**。在 strict 模式下那次读取也需要审批；我们作为客户端会拒绝所有非桥请求，所以懒加载必然失败。**生产接入必须用 eager。**

## 三、实测记录

每组独立空工作区、独立 `--gemini-dir`、`--app-data-dir dsh-acp-test`、`--include-default-customizations=false`；桥只暴露无副作用的 `dsh_echo`，返回随机回执。

| 用例 | 配置 | 结果 |
|---|---|---|
| custom-call-mcp-tool | 自定义 agent `tools: ["call_mcp_tool"]` + strict + deny | ❌ 整轮失败：`unknown component: tool "call_mcp_tool" not found in registry` |
| default-eager-deny | 默认 agent + strict + deny + **eager MCP**，只要求调桥 | ✅ 桥收到 `tools/call dsh_echo`，模型输出随机回执 |
| deny-only-read | 只配 `permissions.deny`（无 strict），要求读随机文件 | ❌ 读取完成，随机内容输出到回答里 → **deny 未生效** |
| strict-command | 只配 `toolPermission: strict`，要求创建标记文件 | ✅ 发出 `run_command` 权限请求；拒绝后工具 failed，标记文件未创建 |
| agent-whitelist-viewfile | 自定义 agent `tools: ["view_file"]` + strict，要求读文件 | ⚠️ 模型改用 `read_file` 并发起权限请求；无法确认白名单是否生效 |

`default-eager-deny` 的桥侧记录：`server/discover → initialize → notifications/initialized → tools/list → tools/call(dsh_echo)`，模型最终输出 `RECEIPT_...`，与桥返回的随机值一致。

## 四、对方案的影响

### 可以成立的架构（门控式）

```text
本机 agy acp（官方程序，复用当前登录）
  --gemini-dir <隔离目录>  --app-data-dir dsh-acp
  settings.json: {"toolPermission": "strict"}
  session/new:
    mcpServers: [ dsh 桥 (127.0.0.1 + Bearer) ]
    _meta.antigravity.eagerMcpServers: ["dsh-bridge"]   ← 必须 eager
  客户端: 仅放行名称匹配本桥的 session/request_permission，其余一律 reject
```

实际效果：

| 能力 | 状态 |
|---|---|
| 原生读文件 | 需要审批 → 客户端拒绝 → 拿不到内容 |
| 原生执行命令 | 需要审批 → 客户端拒绝 → 无副作用 |
| DSH 工具（MCP 桥） | 正常调用，结果回填 |
| 原生工具是否可见 | **仍可见**（模型会先尝试，被拒后可能改用桥工具） |

### 不能依赖的部分

- `permissions.deny`：实测无效，不能当作服务端保险。
- 自定义 agent 的白名单：当前没有可用的工具名写法，误写会直接让整轮失败。
- `enabledTools: []`：上一轮已证明挡不住原生读取。

### 仍未验证的风险

1. strict 是否覆盖**全部**原生路径：子代理、浏览器、内部压缩/标题生成、后台任务未测。
2. 门控不是沙箱。若存在任何不在 strict 询问范围内的原生动作，它会直接执行。
3. 原生工具仍可见，模型可能浪费轮次尝试，也可能在拒绝后行为不稳定。
4. 懒加载与 strict 冲突，必须 eager；eager 的 token 开销随工具数量线性增长。

## 五、下一步建议

1. **先确认产品边界**：能否接受"受限 Antigravity agent"（工具可见但被拒），而不是"纯模型"。这是本轮最重要的分歧点。
2. 若要继续，优先补两个低成本用例：子代理调用（`invoke_subagent`）是否也走 ACP 权限；内部压缩是否读文件。
3. 若要追求"工具不可见"，需查清 `tools` 白名单的准确命名空间（很可能只接受原生工具名 + 需要 `enable_mcp_tools` 之类的开关），但这属于 agy 私有不稳定面，建议不要作为主路径。
4. 生产接入前，把 strict 当作必要不充分条件，并在 DSH 侧保留自己的审批与沙箱。

## 六、清理与隔离

- 5 个用例目录、官方日志、随机秘密文件均已删除；临时根目录只保留探针脚本与脱敏结果 JSON（`results.json`、`round2-results.json`，权限 0600）。
- 所有官方进程在 `session/close` + stdin EOF 后以 code 0 退出。
- 未修改 `~/.gemini/antigravity-cli/settings.json` 或 `~/.gemini/config/mcp_config.json`；未触碰 DSH profile。
- 登录由官方程序自行通过系统钥匙串复用，探针不读取、不复制凭据。

## 七、参考

- ACP 文档：https://antigravity.google/docs/ide/extensions/acp.md
- MCP（懒加载 / eager / `call_mcp_tool`）：https://antigravity.google/docs/mcp.md
- 权限与 `toolPermission`：https://antigravity.google/docs/permissions.md
- 设置 schema：https://antigravity.google/schemas/v1/settings.json
- 自定义 agent 前置字段：https://antigravity.google/docs/subagents.md
- 第一轮报告：`docs/AGY-ACP-ISOLATED-TOOL-TEST-2026-11-15.md`
