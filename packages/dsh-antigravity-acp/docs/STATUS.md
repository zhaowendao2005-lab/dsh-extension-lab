# 实现状态：0.1 系列开发预览

更新时间：2026-11-16。通过 Git 市场分发的开发预览；生成门禁仍然关闭，发布动作不安装或改写生产 DSH profile。

## 当前可交付范围

已从文档目录推进为可构建的 Host bundle，provider 为 `antigravity-acp`。入口、普通 Config、locale、原创 SVG 图标、bundle patch、锁定依赖及构建脚本已落地。旧 `dsh-antigravity` 不在本次改动范围内。

**生成仍被 `ACP_PURITY_UNVERIFIED` 阻断。** `VERIFIED_PROFILES` 为空，Config 没有放行开关。版本和 SHA-256 检查用于发现程序变化，不等于工具纯净认证。开发测试通过依赖注入使用假 CLI；该注入不是用户配置项。

| 模块 | 已实现 | 验证边界 |
|---|---|---|
| 官方 CLI 发现 | DSH subprocess 查找路径、`--version`、精确 1.5.9 和 SHA-256、启动前重新校验 | 离线验证；诊断期间真实 CLI 检查通过 |
| 隔离 runtime | 独立根、空 cwd、0700 目录/0600 文件、配置全部先于 spawn、环境白名单；仅 CLI 子进程使用 OS 用户目录或显式 loginHome | 假进程与真实临时文件；真实 provider 的 HOME 对照诊断；没有 OS 沙箱保证 |
| 生命周期 | 取消、EOF、fallback 失败、受管范围退出证明、晚到初始化资源清理、卸载等待构造完成 | 离线验证；退出无法证明时保留私有根并报告错误 |
| JSON-RPC | 有界分帧、UTF-8、请求身份、取消、超时、背压、异步错误 | 假双向流 |
| MCP 桥 | 官方 SDK、仅 loopback、随机 token、Host/Origin/path/session 校验、Ajv schema、结果只回填一次 | 真实 HTTP 与官方 MCP SDK；CLI 一端为假协议端 |
| 工具循环 | ACP prompt 挂起 → DSH tool-call → DSH 执行 → 同一 prompt 回填；无自动重试或回退 | 覆盖并行 MCP 调用、过期/重复结果、取消和改写历史 |
| 上下文 | 最新完整 system、来源和有序消息记录、skill 目录/内容、文件 handle、重建、追加运行时上下文 | 结构和状态机离线验证；未证明模型理解与直连等价 |
| 模型目录 | 从当前 session 公布的 configOptions 选择精确 ID，返回值确认选择 | 假 catalog；不捏造上下文、计量或额度 |
| DSH Runtime | 真实 Cordis 注册、llm.prepareCall/stream、工具/文件投影、ALS 请求分类、生产门禁和 Host disposer | CLI/桥为夹具；主循环标记主动设置；未运行完整 agent-loop |
| DSH UI | provider/模型警示、配置 metadata 和图标资源 | 调试沙箱已加载并定位 HOME 认证失败；修复后的完整界面验收尚未进行 |

## 调试沙箱登录目录修复

沙箱故障诊断使用安装中的真实 DSH subprocess provider、官方 agy 1.5.9 和同一套 ACP 代码，仅改变子进程 HOME：沙箱目录与系统用户目录均通过版本检查和 initialize；前者在 session/new 返回认证错误 -32000，后者返回 7 个模型。两组均未调用 session/prompt，受管进程退出和私有目录清理已完成。该对照定位了登录目录差异，不是工具纯净性或生成验收。

发布实现新增普通配置 `loginHome`：留空解析当前 OS 用户主目录，显式配置必须为绝对路径；只覆盖官方 CLI 子进程的 HOME（适用时同步 USERPROFILE），不修改 DSH、沙箱或生产配置。独立 gemini-dir、app-data-dir 和空 cwd 保持不变。ACP 的 AUTH_REQUIRED（-32000）映射为静态 `ACP_AUTH_REQUIRED` 文案，不把上游消息、凭据或 RPC data 写入错误记录。此次发布仅构建，没有追加运行包测试或真实模型请求。

## DSH Runtime 边界修正

运行安装的 `dsh-llm` 在 adapter 之前会投影文件、图片与工具更新，也可能创建新的 request 对象。实现据此作了三项明确处理：

1. **工具只声明当前可执行集合。** 不声明 `toolUpdate: 'in-history'`，避免 Runtime 把历史已移除 schema 作为 native 历史声明传入 eager MCP 桥。DSH 保留完整日志；Runtime 按该能力约定投影当前工具。系统提示仍声明 `systemPromptUpdate: 'in-history'`，适配器取最后一份非空完整版本，空历史表示清除。
2. **只有主 Agent Loop 可挂起。** 在 `llm/stream` waterfall 的原始 envelope 上读取公开的 `isAgentLoopRequest`，并要求无辅助 purpose；通过 AsyncLocalStorage 只传递布尔分类，跨 Runtime 克隆保持它。每次 iterator 创建、next、return、throw 均进入同一作用域。辅助调用即使带 sessionId 也不能等待工具续轮。
3. **图片明确拒绝。** 当前只公布文本能力。Host 在核心转换图片占位文本之前返回 `ACP_IMAGE_UNVERIFIED`，原始 adapter 调用也拒绝图片；不读取附件或把未核验的图片发送到 CLI。文件在正常 DSH 路径由核心转成文件 handle；原始 adapter 另保留同一 handle 接口。

挂起期间新增的 DSH user/context 记录可随工具结果续传。工具原始结果保留；新增记录在最后一份 MCP 结果中用独立 `dsh-continuation` 文本信封承载，带原始 role/source 和顺序表，不新增 ACP prompt、不重复载入 skill。**这是带来源的文本投影，MCP 的物理消息角色仍是 tool，不宣称原生角色或模型语义等价。** 已有前缀、system、工具集合或模型发生变化则取消，不重放不明副作用。

## 仍然阻断的事项

- `manage_task`、`list_resources`、`read_resource` 的模型可见性未有完整上游声明证据。模型自述和版本哈希都不足以放行。
- 当前候选隔离配置继续使用 `toolPermission: strict` 和默认取消权限回调。它会询问 MCP；没有已核验的规范权限身份就拒绝。故即使移除纯净门禁，也不能把当前候选当成已经跑通的 CLI 工具产品。
- 官方权限语法是 `mcp(server/tool)` / `mcp(server/*)`；strict 即使命中 allow 仍询问，且 Ask 高于 Allow。后续可研究 `request-review` + `mcp(dsh-bridge/*)` 的 allow，但历史 deny-only-read 反例尚未解释，**本次没有切换到该候选**。
- 二进制字符串 `manage_task_force_disable` 没有已确认的 CLI 可配置入口。官方 SDK `0.1.23` 的公开源码确认了 `manage_task.enabled = RUN_COMMAND OR SCHEDULE`，但该配置走 localharness proto，尚未连通 CLI ACP。SDK 的 `enabled_tools` / `disabled_tools` 也未擅自映射到 ACP metadata；固定源码与限制见[SDK 与 CLI ACP 边界](SDK-CLI-BOUNDARY.md)。
- 未找到官方支持的 ACP 完整工具声明/system prompt 导出接口。`excludeDefaultComponents` 的 changelog 说明仍不足以认证本 profile。
- `maxTokens`、`temperature`、`stop`、独立 reasoningEffort 尚不能确认有效，显式请求会报 `ACP_CONTROL_UNSUPPORTED`；选择 CLI 公布的精确模型变体。
- 没有计费 usage、额度、持久 resume、CLI 内部请求/重试计数或跨平台兼容的实测承诺。

## 构建与验证

在本包目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm probe
```

包内单独声明 workspace 配置，关闭自动 peer 安装；兼容配置对旧版包管理器也设置相同值。Cordis `4.1.0`、dsh-llm / dsh-error `0.2.2-rc.3`、Schemastery `3.19.0` 作为精确 devDependencies 固定真实 Runtime 测试环境，不依赖某次 `pnpm` 命令隐式装入 Host peers。已在 pnpm `11.28.5` 使用本地缓存离线安装验证，不改变仓库其他包的依赖。

`build` 只做静态检查并把源码复制至 `lib/`，不运行测试、不启动 CLI。`probe` 仅输出离线状态，不发现登录、不创建 ACP session、不生成内容。按仓库测试纪律，后续新增测试和线上调用仍应遵循用户已批准的范围和预算。

本轮最终验证通过：**128/128 项测试，0 失败**；17 个源码模块静态检查及构建通过，离线 `probe` 返回 `verifiedProfiles: 0` / `ACP_PURITY_UNVERIFIED`。其中新增 9 项真实 Cordis / LlmRuntime 验证，覆盖注册、当前工具投影、WeakSet 克隆后的 ALS 分类、辅助请求、附件通道、生产门禁和 disposer 释放断言。其余测试使用真实 loopback MCP SDK、假 CLI/进程与真实临时目录。没有运行完整 agent-loop / GUI，没有执行真实 `session/prompt`，没有安装或修改生产 profile。

配置根会包含 MCP 临时 bearer token、系统提示，以及官方 CLI 可能写入的会话/缓存。插件不持久化原始 stdout/stderr；只有受管进程范围退出已确认且所有权标记仍一致时才清理目录。无法退出或标记异常时保留目录并报告，不能承诺所有异常下零残留。

## 下一道验收门槛

继续解决纯净性与权限身份，取得可靠证据后再增加精确 CLI profile。随后才做有独立预算的官方 CLI 端到端与隔离 DSH 验收。当前不得把离线通过称为已满足“只保留 DSH 工具”的最终产品要求。

参考：[整体设计](DESIGN.md)、[上下文映射](CONTEXT-MCP-SKILLS.md)、[测试计划](TEST-PLAN.md)、[官方资料与 DSH Skill 路径](REFERENCES.md)。
