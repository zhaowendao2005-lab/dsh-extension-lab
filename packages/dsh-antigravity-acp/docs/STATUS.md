# 实现状态：0.1 系列开发预览

更新时间：2026-11-16。通过 Git 市场分发的开发预览；生成门禁由**本地净化网关**机械执行，`0.1.1` 起不再有静态 `VERIFIED_PROFILES` 放行表。

## 当前可交付范围

provider 为 `antigravity-acp`。入口、普通 Config、locale、原创 SVG 图标、bundle patch、锁定依赖及构建脚本已落地。旧 `dsh-antigravity` 不在本次改动范围内。

**纯净性保证方式（0.1.1 起）**：官方 CLI 被强制使用 `--cloud_code_endpoint` 指向本进程的 loopback 净化网关。网关在每次 `streamGenerateContent` 转发前解析请求体：

1. 只保留 DSH 桥接工具声明（`mcp_dsh-bridge_` 前缀且属于本单元已公布的工具名），其余 `functionDeclarations` 全部删除；删空后整个 `tools` 字段移除。
2. agent 轮把 `systemInstruction` 重写成本轮 DSH 系统提示；`requestType: "checkpoint"`（CLI 自动生成会话标题）保持原样不发。
3. 解析失败、工具结构异常、缺少 DSH 系统提示、网关自身异常一律**不转发**，返回 4xx（不是 5xx：5xx 会被 CLI 当成瞬时错误重试 8 次，实测如此）。

CLI 看不到网关之外的出口：请求体不落盘、不记录 body/token，只累计声明名数量。适配器在 emit 任何 finish 之前调用 `requireGatewayPurity(attestation)`：本轮没有经过网关净化（`sanitizedAgentRequests < 1`）就抛 `ACP_PURITY_UNVERIFIED` 并关闭该单元，不保留续轮。

| 模块 | 已实现 | 验证边界 |
|---|---|---|
| 官方 CLI 发现 | DSH subprocess 查找路径、`--version`、精确 1.5.9 和 SHA-256、启动前重新校验 | 真实 CLI 检查通过 |
| 隔离 runtime | 独立根、空 cwd、0700 目录/0600 文件、配置全部先于 spawn、环境白名单；仅 CLI 子进程使用 OS 用户目录或显式 loginHome | 真实临时文件与真实 CLI 启动；没有 OS 沙箱保证 |
| 净化网关 | loopback `127.0.0.1:0` + 24 字节随机路径令牌、只改生成请求、fail-closed、无常驻 body | 真实 CLI 全链路（见下） |
| 生命周期 | 取消、EOF、fallback 失败、受管范围退出证明、晚到初始化资源清理、卸载等待构造完成 | 离线验证；退出无法证明时保留私有根并报告错误 |
| JSON-RPC | 有界分帧、UTF-8、请求身份、取消、超时、背压、异步错误 | 假双向流 + 真实 CLI |
| MCP 桥 | 官方 SDK、仅 loopback、随机 token、Host/Origin/path/session 校验、Ajv schema、结果只回填一次 | 真实 HTTP、官方 MCP SDK、真实 CLI 工具往返 |
| 工具循环 | ACP prompt 挂起 → DSH tool-call → DSH 执行 → 同一 prompt 回填；无自动重试或回退 | 真实 CLI 全程跑通 |
| 权限 | 只批准本单元公布过的桥接工具（`mcp_dsh-bridge_` + 已声明名）；其它一律取消并报 `ACP_PERMISSION_UNVERIFIED` | 单测覆盖允许/拒绝，真实 CLI 批准过 |
| 上下文 | 最新完整 system、来源和有序消息记录、skill 目录/内容、文件 handle、重建、追加运行时上下文 | 结构和状态机离线验证；未证明模型理解与直连等价 |
| 模型目录 | 从当前 session 公布的 configOptions 选择精确 ID，返回值确认选择 | 真实 catalog（7 个模型） |
| DSH Runtime | 真实 Cordis 注册、llm.prepareCall/stream、工具/文件投影、ALS 请求分类、网关门禁和 Host disposer | CLI/桥为真实；主循环标记主动设置；未运行完整 agent-loop / GUI |
| DSH UI | provider/模型警示改为“经本地网关净化 · 原生工具不外发” | 调试沙箱已加载；修复后的界面验收仍待做 |

## 真实 CLI 端到端结果（2026-11-16）

用**生产代码路径**（`AcpEngine` → `startAgyRuntime` → 真实 `agy 1.5.9` → 真实网关 → 真实上游）跑了两轮：

- 轮 1：提示要求模型调用 `dsh_echo` 一次；结果 `finish: tool-calls`，工具名 `dsh_echo`，模型没有看到任何原生声明。
- 轮 2：回填工具结果后 `finish: stop`，模型文本 `DONE`。
- 网关取证：`sanitizedAgentRequests: 2`、`strippedDeclarations: 6`、`systemRewritten: 2`、`upstreamDeclarationsForwarded: false`。

同一次运行里还可能看到 `FAILED_PRECONDITION (code 400): User location is not supported for the API use`：这是 CLI 自动生成会话标题的 checkpoint 请求，走 `requestType: "checkpoint"`，网关按设计不重写、不阻断，失败只影响标题。**该错误不是本插件产生的**：用官方 CLI 自己的 `agy -p` 打印模式对 Gemini 模型同样报这个错误，而 Claude 模型正常返回。因此本轮验收用的是 `claude-sonnet-5-5`。

发布后又用**安装到 profile 的 0.1.1 构建产物**（`lib/`，不是工作区源码）跑了一次同样的端到端：模型徽章为「经本地网关净化 · 原生工具不外发」，两轮工具往返得到 `DONE`，`sanitizedAgentRequests: 2`、`strippedDeclarations: 6`、`systemRewritten: 2`。**该验证发生在 DSH 进程之外**：插件 Host 代码在应用启动时加载，覆盖安装后必须重启 DeepSeek Harness 才会换成新版本，只刷新页面仍跑旧代码。

## 调试沙箱登录目录修复

沙箱故障诊断使用安装中的真实 DSH subprocess provider、官方 agy 1.5.9 和同一套 ACP 代码，仅改变子进程 HOME：沙箱目录与系统用户目录均通过版本检查和 initialize；前者在 session/new 返回认证错误 -32000，后者返回 7 个模型。该对照定位了登录目录差异。

发布实现新增普通配置 `loginHome`：留空解析当前 OS 用户主目录，显式配置必须为绝对路径；只覆盖官方 CLI 子进程的 HOME（适用时同步 USERPROFILE），不修改 DSH、沙箱或生产配置。独立 gemini-dir、app-data-dir 和空 cwd 保持不变。ACP 的 AUTH_REQUIRED（-32000）映射为静态 `ACP_AUTH_REQUIRED` 文案，不把上游消息、凭据或 RPC data 写入错误记录。

## DSH Runtime 边界修正

运行安装的 `dsh-llm` 在 adapter 之前会投影文件、图片与工具更新，也可能创建新的 request 对象。实现据此作了三项明确处理：

1. **工具只声明当前可执行集合。** 不声明 `toolUpdate: 'in-history'`，避免 Runtime 把历史已移除 schema 作为 native 历史声明传入 eager MCP 桥。DSH 保留完整日志；Runtime 按该能力约定投影当前工具。系统提示仍声明 `systemPromptUpdate: 'in-history'`，适配器取最后一份非空完整版本，空历史表示清除。
2. **只有主 Agent Loop 可挂起。** 在 `llm/stream` waterfall 的原始 envelope 上读取公开的 `isAgentLoopRequest`，并要求无辅助 purpose；通过 AsyncLocalStorage 只传递布尔分类，跨 Runtime 克隆保持它。每次 iterator 创建、next、return、throw 均进入同一作用域。辅助调用即使带 sessionId 也不能等待工具续轮。
3. **图片明确拒绝。** 当前只公布文本能力。Host 在核心转换图片占位文本之前返回 `ACP_IMAGE_UNVERIFIED`，原始 adapter 调用也拒绝图片；不读取附件或把未核验的图片发送到 CLI。文件在正常 DSH 路径由核心转成文件 handle；原始 adapter 另保留同一 handle 接口。

挂起期间新增的 DSH user/context 记录可随工具结果续传。工具原始结果保留；新增记录在最后一份 MCP 结果中用独立 `dsh-continuation` 文本信封承载，带原始 role/source 和顺序表，不新增 ACP prompt、不重复载入 skill。**这是带来源的文本投影，MCP 的物理消息角色仍是 tool，不宣称原生角色或模型语义等价。**

## 仍然限制或未核验的事项

- **纯净性只在网关这一跳成立。** 模型收到的 system/tools 由网关重写保证；CLI 内部是否另有旁路（例如不经过 `--cloud_code_endpoint` 的请求）尚无权威导出手段，故只声明“出口请求被净化”，不声明“CLI 内部零原生能力”。
- **Gemini 模型当前被上游按地区拒绝**（`FAILED_PRECONDITION`，官方 CLI 同样复现）；Claude 模型可用。插件不吞这个错误，原样上报。
- `maxTokens`、`temperature`、`stop`、独立 reasoningEffort 尚不能确认有效，显式请求会报 `ACP_CONTROL_UNSUPPORTED`；选择 CLI 公布的精确模型变体。
- 没有计费 usage、额度、持久 resume、CLI 内部请求/重试计数或跨平台兼容的实测承诺。
- CLI 版本硬钉 1.5.9；`_meta.antigravity` 只认 `systemPrompt`，我们早期用的 `enabledTools` / `eagerMcpServers` 键会被静默忽略，已从文档纠偏。

## 构建与验证

在本包目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm probe
```

包内单独声明 workspace 配置，关闭自动 peer 安装。Cordis `4.1.0`、dsh-llm / dsh-error `0.2.2-rc.3`、Schemastery `3.19.0` 作为精确 devDependencies 固定真实 Runtime 测试环境。`build` 只做静态检查并把源码复制至 `lib/`；`probe` 仅输出离线状态。

本轮验证通过：**139/139 项测试，0 失败**（新增 7 项网关测试、1 项门禁顺序测试、2 项权限允许/拒绝测试），17 个源码模块静态检查及构建通过。另有一次真实 CLI 端到端（上述两轮，1 个模型、2 次生成请求）。没有安装或修改生产 profile，没有运行完整 agent-loop / GUI。

配置根会包含 MCP 临时 bearer token、系统提示，以及官方 CLI 可能写入的会话/缓存。插件不持久化原始 stdout/stderr；只有受管进程范围退出已确认且所有权标记仍一致时才清理目录。无法退出或标记异常时保留目录并报告，不能承诺所有异常下零残留。

## 下一道验收门槛

1. 在隔离 DSH 实例里跑完整 agent-loop，确认 GUI 下工具往返、取消、续轮与错误投影。
2. 用官方 SDK 或 CLI 后续版本取得“CLI 内所有模型请求都走同一出口”的权威说明，才能把“出口净化”升级为“全链纯净”。
3. 逐步放开 `maxTokens` 等控制项前，需要能证明 ACP 侧确实生效的手段。

参考：[整体设计](DESIGN.md)、[上下文映射](CONTEXT-MCP-SKILLS.md)、[研究记录](RESEARCH.md)、[测试计划](TEST-PLAN.md)、[官方资料与 DSH Skill 路径](REFERENCES.md)。
