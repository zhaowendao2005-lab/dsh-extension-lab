# 参考资料与 DSH 插件开发入口

整理日期：2026-11-16。本轮重新核对官方工具、权限、子代理与 CLI 文档，并按固定提交审读官方 Python SDK 源码。没有运行真实 CLI 或模型。历史来源和本轮补证分别标注，详细结论见[SDK 与 CLI ACP 边界](SDK-CLI-BOUNDARY.md)。

## 1. Antigravity 与 ACP

| 资料 | 用途与边界 |
|---|---|
| [CLI ACP](https://antigravity.google/docs/cli/acp.md) | 官方本机 ACP 入口、登录复用；ACP 是 agent 协议，不是模型 API |
| [Other editors / ACP](https://antigravity.google/docs/ide/extensions/acp.md) | 启动、认证、flags、模型选项与编辑器限制；随版本变化 |
| [MCP](https://antigravity.google/docs/mcp.md) | 全局/工作区配置、逐工具 eager、懒加载和 call_mcp_tool |
| [Custom subagents](https://antigravity.google/docs/subagents.md) | agent frontmatter、tools、mainAgent、subagent、依赖 |
| [Agents 命令](https://antigravity.google/docs/cli/commands/agents.md) | agent 发现路径和主 agent 选择 |
| [CLI reference](https://antigravity.google/docs/cli/reference.md) | flags、toolPermission、参数支持范围 |
| [Settings](https://antigravity.google/docs/settings.md) | 用户配置与自定义目录说明 |
| [Permissions](https://antigravity.google/docs/permissions.md) | strict、deny/ask/allow 的文档语义；测试表现可能不同 |
| [Settings Schema](https://antigravity.google/schemas/v1/settings.json) | 配置键的公开 schema，不证明 ACP 所有读取路径 |
| [SDK tools](https://antigravity.google/docs/sdk/tools.md) | SDK capabilities 的模型上下文过滤语义，不直接适用于 CLI ACP |
| [官方 SDK 固定提交](https://github.com/google-antigravity/antigravity-sdk-python/tree/75ba22bd00afae2f46393ff31f30c3f0df52982f) | `0.1.23`；capabilities → localharness proto、manage_task 的命令/调度联动及公开观测边界 |
| [ACP 官网](https://agentclientprotocol.com) | 协议内容、会话、能力、取消和权限；区分稳定版本与草案 |

`excludeDefaultComponents` 的证据来自本机官方程序嵌入的更新记录和配置标签；不能仅因为公开子代理页没有列出就判断不存在，也不能把该页当成已承诺此字段稳定性的证明。

静态读取的更新记录片段：

> Added support for `excludeDefaultComponents: true` in custom agent Markdown frontmatter, allowing custom agents to opt out of default prompt sections and built-in tools while preserving post-invocation hooks.

它还明确保留 post-invocation hooks。需要继续查明残留组件和内部行为，不能把“退出默认组件”理解为整个 harness 已消失。

## 2. 参照仓库

[KouzakiUmi/dsh-antigravity-acp](https://github.com/KouzakiUmi/dsh-antigravity-acp)

- 此前审读版本：npm `dsh-bundle-antigravity-host` 0.1.38，Git 短 SHA d8d8469；本轮不重新拉取。
- 参考：桥的 park/回填、session reuse、模型设置、协议与生命周期测试。
- 不采用：proxy 模式、凭据导入、OAuth、官方 server 自动下载。
- 代码采用前重新核对 exact commit、LICENSE 与文件归属。当前没有复制其代码，不继承它的包名或自动安装行为。

参照实现自述的测试数、宽 peer 范围不等于本插件兼容性证明。

## 3. DSH Skill：当前可直接读取的工作区快照

当前会话的 [dsh-doc Skill](../../../.agents/skills/dsh-doc/SKILL.md) 所在目录：

```text
/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/
```

| 入口 | 用途 |
|---|---|
| [plugin-development](../../../.agents/skills/dsh-doc/references/plugin-development.md) | bundle 开发、安装和生效验证 |
| [host-plugin](../../../.agents/skills/dsh-doc/references/host-plugin.md) | manifest、patch、Host 生命周期与资源 |
| [practices](../../../.agents/skills/dsh-doc/references/practices.md) | 选择扩展点、上下文和 session 真相源 |
| [configuration](../../../.agents/skills/dsh-doc/references/configuration.md) | Config Editor、普通/volatile 字段 |
| [verification](../../../.agents/skills/dsh-doc/references/verification.md) | 页面/插件验收与未验证边界 |
| [ui-plugin](../../../.agents/skills/dsh-doc/references/ui-plugin.md) | Client loader、Slot 和依赖 |
| [mcp-bundle](../../../.agents/skills/dsh-doc/references/mcp-bundle.md) | DSH MCP 连接边界 |
| [upgrading](../../../.agents/skills/dsh-doc/references/upgrading.md) | DSH 升级检查 |
| [locate-docs](../../../.agents/skills/dsh-doc/references/locate-docs.md) | 当前安装文档定位 |
| [composition-reference](../../../.agents/skills/dsh-doc/references/composition-reference.md) | patch 语法 |
| [VERSION](../../../.agents/skills/dsh-doc/VERSION.md) | 快照版本与刷新方式 |

这些是本工作区的引用；脱离本仓库分发时可能不可用，不将机器绝对路径写进插件运行逻辑。

## 4. DSH 包级契约

| 资料 | 关键内容 |
|---|---|
| [dsh-llm](../../../.agents/skills/dsh-doc/packages/dsh-llm.zh.md) | adapter、GenerateOptions、计量与模型能力 |
| [dsh-agent](../../../.agents/skills/dsh-doc/packages/dsh-agent.zh.md) | Agent 句柄与工厂；不替换全局 driver |
| [dsh-agent-loop](../../../.agents/skills/dsh-doc/packages/dsh-agent-loop.zh.md) | step、消息派生、辅助调用 |
| [dsh-system-prompt](../../../.agents/skills/dsh-doc/packages/dsh-system-prompt.zh.md) | system 在 history 中、动态 user 快照 |
| [dsh-tool-skill](../../../.agents/skills/dsh-doc/packages/dsh-tool-skill.zh.md) | skill 目录、工具、手势注入和防重复加载 |
| [dsh-mcp-resources](../../../.agents/skills/dsh-doc/packages/dsh-mcp-resources.zh.md) | DSH 资源工具与可见服务器提示 |
| [dsh-acp](../../../.agents/skills/dsh-doc/packages/dsh-acp.zh.md) | DSH 作为 ACP server 的边界，不能混同客户端 |
| [subprocess 子系统](../../../.agents/skills/dsh-doc/dsh-docs/subsystems/subprocess.zh.md) | 受管进程、环境清理和退出 |
| [Config catalog](../../../.agents/skills/dsh-doc/dsh-docs/config-catalog.zh.md) | 包括官方 subagent-acp 配置参考 |

实现前先用 `cordis_inspect_list` 发现实际 provider，再按返回 schema 查询 Service/Event/Config；不能凭历史文档猜 Inspect 方法名，更不能把 Inspect 查询当业务服务调用。

## 5. 安装包历史定位

此前调查过的 DSH 安装根：

```text
/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/
```

其中常用相对路径：

```text
node_modules/@deepseek-ai/dsh-llm/src/types.ts
node_modules/@deepseek-ai/dsh-llm/src/index.ts
node_modules/@deepseek-ai/dsh-agent-loop/src/agent.ts
node_modules/@deepseek-ai/dsh-session/src/types.ts
node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/
```

asar 不能当普通文件夹交给系统工具；可读性以当前工具/运行环境为准。本会话优先工作区快照和运行时 Inspect，安装路径不是当前工作目录。

## 6. Google Cloud 背景参考

- [Gemini for Google Cloud 配额](https://docs.cloud.google.com/gemini/docs/quotas?hl=en)
- [Service Infrastructure 排障](https://docs.cloud.google.com/service-infrastructure/docs/troubleshooting)
- [IAM 重试原则](https://docs.cloud.google.com/iam/docs/retry-strategy)

这些资料仅支持通用配额/错误/退避背景，不承诺 Antigravity 私有接口的 credit 类型、请求信封、订阅权益或重试时长。相关历史调查见[旧直连归档](archive/README.md)。新插件不直接实现这些端点。
