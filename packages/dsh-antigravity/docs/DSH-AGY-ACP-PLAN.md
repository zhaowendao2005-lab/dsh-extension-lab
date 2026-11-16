# dsh-agy-acp：把 Antigravity 当作纯模型使用的方案

状态：仅为计划，尚未实现。日期：2026-11-15。
参照实现：[KouzakiUmi/dsh-antigravity-acp](https://github.com/KouzakiUmi/dsh-antigravity-acp) 0.1.38（MIT）。只借鉴它的 ACP 模式；**代理模式、OAuth、凭据文件、二进制下载全部舍弃**。
本文取代 `ACP-REARCHITECTURE-RESEARCH.md` 中“保留 Antigravity 能力”的方向。

---

## 1. 目标与非目标

**目标**：在 DSH 里以最低风险使用你的 Antigravity 订阅额度。Antigravity 只提供**模型**；工具、审批、上下文、skill、MCP 与界面全部归 DSH。

**非目标（明确不做）**

- 不自己登录：不做 OAuth、不调用 ACP `authenticate`、不读写任何 token 或凭据文件。
- 不直连 Cloud Code / `v1internal`，不伪装 CLI 的 User-Agent，不做代理模式。
- 不使用 Antigravity 的能力：内置工具、浏览器、subagent / teamwork / swarm、斜杠命令、它的 skill / rules / 插件 / 记忆、它自己的 MCP 配置。
- 不下载任何程序。

---

## 2. 本机验证结果（2026-11-15，未发送模型请求）

| # | 验证项 | 结果 |
|---|---|---|
| V1 | `agy acp` 是否复用 CLI 当前登录 | ✅ 日志 `ChainedAuth: authenticated via keyring`：直接读 macOS 钥匙串，插件不参与 |
| V2 | 账号档位与模型 | ✅ `session/new` 返回 18 个模型和 `g1-pro-tier` |
| V3 | 本机回环 HTTP MCP + Bearer token | ✅ agy 1.5.9 依次调用 `server/discover → initialize → notifications/initialized → tools/list`，每个 POST 都带正确 token |
| V4 | `eagerMcpServers` 预加载 | ✅ 日志 `Preloading 1 MCP servers of the session`，建会话时就拉取工具列表 |
| V5 | `_meta.antigravity.enabledTools: []` | ✅ 能传入、不报错。⚠️ **自带工具是否真的消失未验证** |
| V6 | `--app-data-dir <相对名称>` 隔离 | ✅ 仍走钥匙串登录，历史写入 `~/.gemini/<名称>/`，与 CLI 分开；绝对路径会被拒绝 |
| V7 | `_meta.antigravity.systemPrompt.append` | ✅ 能传入、不报错。⚠️ 模型能否看到未验证 |

注意：`--log-file` 会把账号邮箱写进日志，插件默认不开启。测试目录和日志已清理。

---

## 3. 整体架构

```
DSH agent-loop ──LlmAdapter.stream(messages, tools)──▶ dsh-agy-acp
   ▲                                                    │ stdio ACP v1
   │ text / reasoning / tool-call / finish              ▼
   │                                  本机 agy acp（官方程序，钥匙串登录，
   │                                  独立 --app-data-dir，自带工具关闭）
   │                                                    │ eager MCP（127.0.0.1 + Bearer）
   └── DSH 校验 / 审批 / 执行 ◀──── 挂起 ──── 回环 MCP 桥 "dsh"
```

DSH 每一步调用 `LlmAdapter.stream()` 时都会给出完整的 `messages`（含系统提示）和 `tools`。插件把这两样拆进 Antigravity 的三个“槽”：**上下文槽**、**MCP / 工具槽**、**skill 槽**。

---

## 4. 上下文槽：DSH 的上下文怎么进入 Antigravity

### 4.1 DSH 一次请求里有什么

| DSH 内容 | 在 `messages` 中的形态 | 来源 |
|---|---|---|
| 系统提示（身份、persona、工具指导、MCP resource 服务器名、AGENTS.md 指令等） | 开头的 `system` 角色消息 | `dsh-system-prompt` 装配 |
| 动态上下文（时间、工作目录、运行时信息） | 带 `source.kind` 的 `user` 角色快照 | time-context / runtime-context |
| skill 目录 | 持久的 `user` 角色 `<available_skills>` 消息 | `dsh-tool-skill` |
| 用户输入 | `user`，`source.kind === 'user'` 或无 source | 用户 |
| 助手输出、工具调用 | `assistant` | 上一步 |
| 工具结果 | `tool`（带 `toolCallId`、`isError`） | DSH 工具执行 |
| 图片 | content 中的 image 块（附件引用） | 附件服务 |

### 4.2 映射规则

| DSH 内容 | Antigravity 槽 | 规则 |
|---|---|---|
| system 消息 | `session/new._meta.antigravity.systemPrompt.append` | **只在建会话时写入**。之后每步计算 system 文本哈希，变化就关闭会话并重建 |
| 动态上下文 / skill 目录 | `session/prompt` 的文本块 | 按 `source.kind` 分类，未变化的不重复发；变化了就重新发最新版本 |
| 用户输入 | `session/prompt` 的文本块 | 每次都发 |
| 图片 | `session/prompt` 的 image 块 | 前提是 `promptCapabilities.image = true`，且附件服务可读；只读附件，不抓 URL |
| assistant 和工具调用 | 不发送 | 由 ACP 会话自己持有（它就是这些内容的产生方） |
| 工具结果 | 不进 prompt，直接作为挂起的 MCP `tools/call` 的返回值 | 详见第 5 节 |

### 4.3 会话复用（借鉴参照实现 `session-reuse.ts`）

- 一个 DSH sessionId 对应一个 ACP 会话，映射存在插件自己的存储里。
- 插件每步记录“已交付给 ACP 的 DSH 消息前缀”和“上一步的实际输出”。新请求的 `messages` 必须以该前缀开头，插件只发增量。
- **以下情况全量重建**（关闭旧会话，新建会话，把完整历史编码成一条重放 prompt）：
  - DSH 做了压缩、回退、编辑或分叉，前缀对不上；
  - system 哈希变化；
  - 工具集合变化（见 5.4）；
  - 模型或思考强度变化，而 `set_config_option` 失败；
  - ACP 进程崩溃或会话恢复失败。
- 重放格式：每条消息编码成 `<dsh-message role=…>` 信封，最后单独强调“当前要回应的最新用户消息”，沿用参照实现的做法。
- DSH 始终是历史的权威方。ACP 会话只是缓存，丢了就重建。

### 4.4 模型参数

- DSH 的 `provider/model` + `reasoningEffort` 通过 `session/set_config_option` 映射到 ACP 的 `model` + `thought_level`。
- `maxTokens`、`temperature`、`stop` 忽略并记警告。输出上限由官方程序决定，这样也避开了之前 262144 的问题。
- 上下文用量来自 `usage_update.used/size`，写入 DSH 的上下文容量。

---

## 5. MCP / 工具槽：DSH 的工具和 MCP 怎么交给 Antigravity

### 5.1 原则：只有一个入口

**DSH 的所有工具，包括 DSH 里配置的 MCP 服务器工具，统一通过一个回环 MCP 桥交给 Antigravity。** 插件不会把 DSH 的 MCP 服务器配置直接转给 agy。原因：

1. DSH 的 MCP 工具已经在 `tools` 列表里，比如 `mcp__blender__execute_blender_code`，和内置工具一视同仁；
2. 只走一个入口，就保证每次调用都经过 DSH 的校验、审批、沙箱和审计；
3. 不会重复启动 MCP 服务器进程，也不会出现两套凭据。

### 5.2 桥的实现

| 项目 | 设计 |
|---|---|
| 传输 | Streamable HTTP MCP，只监听 `127.0.0.1`，随机端口 |
| 鉴权 | 每个 ACP 会话一个 32 字节随机 Bearer token，用常数时间比较；重建会话时更换 |
| 注册 | `session/new.mcpServers = [{type:"http", name:"dsh", url, headers}]` 加 `_meta.antigravity.eagerMcpServers: ["dsh"]` |
| 工具清单 | `tools/list` 返回 DSH 本步 `tools` 的 name / description / inputSchema。schema 先做兼容化：展开本地 `$ref`、补空 properties、去掉 agy 不认的关键字 |
| 名称 | 原样保留 DSH 工具名；agy 给模型看的前缀名，回来时按映射还原 |
| 调用 | `tools/call` 到达后挂起，见 5.3 |
| 参数修正 | 只修正无歧义的常见别名，如 `path`→`file_path`；缺必填项立刻返回错误和正确签名，不进 DSH |

### 5.3 挂起与回填（同一轮 ACP prompt 内）

```
agy:   tools/call(name, args, id=X)  ──▶ 桥挂起 X
插件:  stream 输出 tool-call(id=X) + finish('tool-calls')     ← 本步结束
DSH:   校验 → 审批卡片 → 执行 → 下一步 stream(messages + tool(X) 结果)
插件:  从新 messages 里取出 tool(X) 结果 → 交给挂起的 X（带 isError）
agy:   在同一个 prompt 里继续输出文本或下一个 tools/call
```

- 同一批里有多个调用时，等 agy 把这一批发完（短窗口聚合）再一起交给 DSH。结果乱序回来也支持。
- 用户取消或 DSH 拒绝时，挂起的调用返回 `isError: true` 和拒绝原因，不能悬空。
- ACP 的 `session/request_permission`：只有来自 `dsh` 桥的调用才回 `allow_once`（真正的审批在 DSH 那边）；其他一律 `reject`。
- 标题生成、压缩这类一次性请求不回喂工具结果，所以这类请求一旦收到工具调用，就立即以错误结束。

### 5.4 工具集合变化

DSH 的工具可能中途变化（MCP 服务器连上或断开、skill 激活、权限预设改变）。处理办法：

- 每步计算 `tools` 的指纹（名称 + schema 哈希）。
- 指纹变了：优先给桥发 `notifications/tools/list_changed`。**agy 是否响应这条通知还需要在 P0 验证**；不响应就重建会话。
- 第一版先实现“变化即重建”，稳妥优先。

### 5.5 Antigravity 自带的 MCP

你在 `agy mcp` 里配的服务器（比如 `tavily-proxy`）属于 agy 的全局配置。独立的 `--app-data-dir` 能不能把它隔离掉，**需要在 P0 验证**。如果隔离不掉，就由插件在建会话时检查 `available_commands_update` 和日志，发现额外的 MCP 就报警告，或者拒绝运行。

---

## 6. skill 槽：DSH 的 skill 怎么交给 Antigravity

DSH 的 skill 由三部分组成，全部能放进上面两个槽，**不需要用 Antigravity 自己的 skill 系统**：

| DSH skill 组成 | 形态 | 映射 |
|---|---|---|
| skill 目录 `<available_skills>` | 持久的 user 角色消息，变化时追加替换版本 | 上下文槽：作为普通上下文块发送，按内容去重 |
| `skill` 工具（模型主动加载） | DSH 工具 | 工具槽：经桥暴露，结果 `<skill_content>` 作为工具返回值回填 |
| `/name` 手势注入 | user 角色注入块，含完整 `<skill_content>` | 上下文槽：随当前用户输入一起发送 |
| skill 附带的资源文件 | 模型用 DSH 文件工具读取 | 工具槽：通过 DSH 的 read / bash 工具 |

关键点：

- Antigravity 自己的 skill（如 `browser-use`、`antigravity-guide`）通过独立数据目录和 `--include-default-customizations=false` 关掉，防止两套 skill 混在一起。这一步需要在 P0 验证是否生效。
- 在追加的系统提示里加一句约束：“只使用随会话提供的工具；skill 只能通过 `skill` 工具或上下文中的 `<skill_content>` 使用”。

---

## 7. 保留与去除

| 类别 | 内容 | 处理 |
|---|---|---|
| **无法去除** | agy 的内部系统提示和 agent 循环外壳 | 只负责驱动模型、调用 MCP；额外 token 开销未知 |
| 去除 | 内置工具、浏览器、subagent、swarm、workflow | `enabledTools: []`（P0 验证） |
| 去除 | ACP fs / terminal 委托 | 声明不支持，来了就拒绝 |
| 去除 | agy 的 MCP、skill、rules、插件、记忆 | `--app-data-dir antigravity-dsh` 加 `--include-default-customizations=false`（P0 验证） |
| 去除 | 斜杠命令 | 不转发 |
| 去除 | 登录、token 文件、OAuth、代理模式、程序下载 | 完全不实现 |
| 保留（DSH） | 系统提示、工具、MCP、skill、审批、沙箱、压缩、回退、界面、模型选择 | 原样 |

---

## 8. 风险评估

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 伪装官方客户端导致封号 | **消除** | 所有上游请求都由官方程序自己发，插件不做网络请求 |
| 凭据泄露 | **消除** | 插件不接触 token |
| 私有扩展字段失效 | 中 | `enabledTools`、`eagerMcpServers`、`systemPrompt.append` 都没有文档。启动时自检，不满足就拒绝运行 |
| agy 升级导致行为变化 | 中 | 要求最低版本；版本变化时重新自检并提示 |
| 额度消耗 | 中 | 建议在 DSH 里把标题生成和压缩改用别的模型 |
| 每一步实际是 agy 的一整轮 | 中 | 工具结果回填在同一 prompt 内完成，额度按 agy 内部的模型调用计算；界面要说明 |
| 桥被本机其他进程访问 | 低 | 127.0.0.1、随机端口、每会话轮换 token |
| 隔离目录中的历史 | 低 | `~/.gemini/antigravity-dsh/` 只有当前用户可读；提供清理操作 |

---

## 9. 从参照实现借鉴

| 借鉴（改写） | 舍弃 |
|---|---|
| `bridge/mcp-bridge.ts`（桥 + 挂起） | `proxy/` 全部 |
| `adapter/prompt-turn.ts`、`session-reuse.ts`、`continuation-state.ts`、`prompt-transcript.ts` | `runtime/credentials.ts`、`proxy/oauth.ts` |
| `protocol/agent-link.ts`（单帧上限、容错） | `runtime/binary.ts`、`integrity.ts` |
| `adapter/permission-handoff.ts`、`tool-args.ts`、`image-content.ts` | `quota/quota-remote.ts` |
| `adapter/model-catalog.ts`、`model-settings.ts` | `client.js` 中代理与登录相关部分 |
| `pool/pooled-adapter.ts`（worker 池，可后做） | |

保留原 MIT 许可声明，并在 README 注明来源。

和参照实现的不同：

1. system 走 `systemPrompt.append`，不塞进用户消息；
2. 使用本机 `agy acp`，不用下载的 `agy_acp_server` 1.4.0；
3. 零凭据处理；
4. 数据目录隔离，并关闭默认自定义。

---

## 10. 分阶段实施

| 阶段 | 内容 | 请求消耗 | 验收 |
|---|---|---|---|
| **P0** | 探针：1 次真实 `session/prompt`，让模型列出可用工具，复述追加提示里的标记，并调用一次 `dsh_echo` | **1–2 次** | 只出现 `dsh_echo`，没有内置工具；标记可见；`tools/call` 到达桥；同时检查 `--include-default-customizations=false` 后 agy 的 skill / MCP 是否消失 |
| P1 | 新包 `dsh-agy-acp`：找到 agy 程序、登录自检（建会话成功即通过）、进程管理、模型目录 | 0 | DSH 模型选择器出现 `agy/*` |
| P2 | 上下文槽：system append、增量发送、重建规则、流式输出文本和思考、取消 | 少量 | 主对话多轮对话正常；回退后会重建 |
| P3 | MCP / 工具槽：桥、挂起回填、权限转交、工具集合变化即重建 | 少量 | DSH 工具（含 DSH 的 MCP 工具）能弹审批并回填结果 |
| P4 | skill 槽：目录去重、`skill` 工具、`/name` 注入 | 少量 | 用 skill 工具加载一个 skill 并按它执行 |
| P5 | 设置页（程序路径、隔离目录名、并发）；可选额度显示（`agy -p /usage`，先确认它不消耗模型请求） | 0 | — |
| P6 | 安装到 `desktop` profile，在新会话中验收；移除旧 `dsh-antigravity` | — | 真实界面验收 |

---

## 11. 参考

- ACP 规范：https://agentclientprotocol.com
- DSH LLM 请求契约：`@deepseek-ai/dsh-llm/src/types.ts:564-605`（`messages`、`tools`、`sessionId`、`signal`）
- DSH 系统提示装配（system 消息 + 带来源的 user 快照）：`.agents/skills/dsh-doc/packages/dsh-system-prompt.zh.md` 约第 140 行
- DSH skill 目录、`skill` 工具、`/name` 注入：`.agents/skills/dsh-doc/packages/dsh-tool-skill.zh.md` 第 112–250 行
- DSH MCP resources 工具：`.agents/skills/dsh-doc/packages/dsh-mcp-resources.zh.md` 第 88–108 行
- DSH 插件开发：`.agents/skills/dsh-doc/references/plugin-development.md`、`host-plugin.md`、`practices.md`、`configuration.md`、`verification.md`
- 参照实现：`/tmp/ext-review/repo`（临时克隆）
