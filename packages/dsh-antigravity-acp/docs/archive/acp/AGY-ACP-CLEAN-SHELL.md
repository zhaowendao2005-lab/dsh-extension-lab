> 历史研究存档，归档于 2026-11-15。原始来源：旧插件 docs/AGY-ACP-CLEAN-SHELL.md。
> 本文保留当时的判断，部分结论已被后续证据修正，旧链接和临时路径未必仍有效。
> **当前实现请以[研究勘误](../../RESEARCH.md)及[整体设计](../../DESIGN.md)为准，不要直接执行存档命令。**

# 纯净 Antigravity 外壳：让模型只看得到 DSH 工具（第三轮）

日期：2026-11-15。程序：本机 `agy` 1.5.9。全部在临时目录 `/private/tmp/dsh-agy-isolation.MuAigf` 内完成。

**结论：目标达成。** 找到一组配置，使 Antigravity 的内置工具（读文件、写文件、执行命令、搜索、浏览器、子代理、swarm 等）**完全不出现在模型的工具列表里**，同时 DSH 通过 MCP 桥提供的工具**正常工作**。效果等价于"直连模型 + 自定义工具"，只是借用了 agy 的登录与传输。

## 一、最终可用配置

```text
agy acp --stdio \
  --gemini-dir <隔离目录> \
  --app-data-dir dsh-acp \
  --include-default-customizations=false \
  --disable-telemetry \
  --agent dsh-model
```

### 1) 自定义 agent：`<gemini-dir>/config/agents/dsh-model/agent.md`

```yaml
---
name: dsh-model
description: DSH model shell.
mainAgent: true
subagent: false
hidden: true
excludeDefaultComponents: true
inheritMcp: true
skills: []
plugins: []
---
Answer the user directly and concisely. Use any tool provided to this session when useful.
```

关键两个字段：

- **`excludeDefaultComponents: true`** —— 官方更新记录原文："allow custom agents to opt out of default prompt sections and built-in tools"。这是移除内置工具和 Antigravity 默认提示段的开关。
- **`inheritMcp: true`** —— 让该 agent 继承 MCP 工具。

### 2) MCP 桥必须写在 **全局** 配置：`<gemini-dir>/config/mcp_config.json`

```json
{
  "mcpServers": {
    "dsh-bridge": {
      "serverUrl": "http://127.0.0.1:<port>/mcp",
      "headers": { "Authorization": "Bearer <token>" },
      "tools": { "<toolName>": { "eager": true } },
      "timeoutSeconds": 120
    }
  }
}
```

**必须 eager。** 懒加载依赖模型自己读 schema 文件，而纯净模式下没有读文件工具，懒加载必然失败。

### 3) ACP 会话

```text
session/new: mcpServers = []      ← 会话级 MCP 对自定义 agent 无效
```

### 4) 客户端

只放行名称匹配本桥的 `session/request_permission`，其余拒绝。另加 `toolPermission: strict` 作为纵深防御。

## 二、实测证据

最终用例 `clean-read-attempt`，同一轮里同时要求读文件与调桥：

```text
模型回答：
(1) CANNOT_READ
(2) RECEIPT_62e7b9e13e9a6b5831f1d673

协议事件：
  tool_call  "Run mcp_dsh-bridge_dsh_echo"  → completed
  session/request_permission: mcp_dsh-bridge_dsh_echo（仅此一条）
  bridge: server/discover → initialize → notifications/initialized
          → tools/list → tools/call(dsh_echo) → 返回随机回执
  secretRevealed = false
```

工具列表自述（上一用例 `global-mcp-clean2`）：

```text
manage_task
list_resources
read_resource
mcp_dsh-bridge_dsh_echo
```

对比默认 agent 的工具列表：

```text
read_file  write_file  edit_file  run_command  manage_task  ask_question
schedule  send_message  invoke_subagent  define_subagent  manage_subagents
search_web  run_workflow  swarm  list_resources  read_resource
```

→ 纯净模式下文件、命令、浏览器、子代理、工作流、swarm **全部消失**。

## 三、失败路径（避免重复踩坑）

| 尝试 | 结果 |
|---|---|
| `_meta.antigravity.enabledTools: []` | 无效，原生读文件仍成功 |
| `permissions.deny`（隔离 settings.json） | 无效，规则没被应用 |
| 会话级 `mcpServers` + 自定义 agent | 桥只被连接，工具不进入模型 |
| 工作区 `.agents/mcp_config.json` + 自定义 agent | 同上，工具不可见 |
| agent 前置 `mcpServers:` 列表 | 同上 |
| agent `tools: ["call_mcp_tool"]` | 整轮失败：`unknown component: tool ... not found in registry` |
| agent `tools: ["mcp_<server>_<tool>"]` | 同样整轮失败——白名单只认内置注册表 |

**重要**：自定义 agent 的 `tools` 白名单写错名字会**直接让整轮失败**，不是只忽略该项。

只有"全局 `mcp_config.json`"这一条路能让自定义 agent 拿到 MCP 工具。

## 四、仍需注意的边界

1. **仍剩 3 个基础设施工具**：`manage_task`、`list_resources`、`read_resource`。它们不碰文件/命令，但只要桥暴露 MCP resources，`read_resource` 就可读取。建议桥不暴露任何 resources。
2. **MCP 配置是进程级的**：`mcp_config.json` 在 agent 启动时读取，桥的端口与 token 必须先确定。因此每个 DSH 会话需要一个独立的 agy 进程 + 独立的 gemini 目录（可用 `--process-per-session`）。
3. **工具必须 eager**：所有给 agy 的 DSH 工具都会进每次请求的工具声明，token 开销随数量线性增长。建议只向 agy 暴露精心挑选的子集，而不是 DSH 全部工具。
4. **`excludeDefaultComponents` 属私有字段**：官方更新记录有说明，但不在公开 schema 里，版本升级需回归。
5. **未验证**：Antigravity 内部系统提示是否随 `excludeDefaultComponents` 一并移除；上下文压缩、标题生成等内部行为未测。
6. 门控与纯净配置互为补充：纯净配置移除工具，`strict` + 客户端拒绝兜底。

## 五、对插件架构的影响

```text
DSH session
  └─ 每个会话一个 agy acp 进程（隔离 gemini-dir + 独立桥 token）
       ├─ agent.md: excludeDefaultComponents + inheritMcp
       ├─ config/mcp_config.json: DSH 桥（eager，精选工具子集）
       ├─ settings.json: toolPermission=strict
       └─ session/new: mcpServers=[]
  └─ 客户端的权限应答只放行本桥工具
```

桥接仍然是"挂起 → 交给 DSH → 回填"，与之前设计一致；区别是模型现在**只看见** DSH 给的工具。

## 六、清理与隔离

- 本轮共发起 **13 次 `session/prompt`**（含 1 次因 agent.md 未写出而回退默认 agent 的无效用例）。
- 所有用例目录、官方日志、随机秘密文件已删除；临时根目录只保留探针脚本与脱敏的 `results.json`、`round2-results.json`、`clean-shell-results.json`（0600）。
- 未修改 `~/.gemini/antigravity-cli/`、`~/.gemini/config/` 或 DSH profile。
- 登录始终由官方程序自行通过系统钥匙串复用，探针不读取凭据。

## 七、参考

- 自定义 agent 与 `excludeDefaultComponents`：程序内嵌更新记录 + https://antigravity.google/docs/subagents.md
- MCP eager / 懒加载：https://antigravity.google/docs/mcp.md
- 权限与 strict：https://antigravity.google/docs/permissions.md
- ACP：https://antigravity.google/docs/ide/extensions/acp.md
