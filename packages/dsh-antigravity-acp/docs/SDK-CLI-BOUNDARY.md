# 官方 SDK 工具过滤与 CLI ACP 的边界

核对日期：2026-11-16。研究基线：官方 Python SDK `0.1.23`，仓库提交 `75ba22bd00afae2f46393ff31f30c3f0df52982f`。本次只读取公开源码和文档；没有运行 SDK、官方 CLI 或模型，也没有读写登录凭据。以下链接固定到该提交，避免把未来版本的变化混入结论。

## 已能确认的过滤语义

官方 [`CapabilitiesConfig`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/types.py#L696) 明确区分两种机制：

> A disabled tool is stripped from the model's context entirely — the model never sees it…

`enabled_tools` / `disabled_tools` 是模型上下文过滤；`hooks.policy.deny()` 保留模型可见声明，只在执行时拒绝。前一种语义符合本项目要求，后一种不足以满足要求。

字段类型为 `list[BuiltinTools] | None`，两者互斥。[`resolve_active_tools()`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/connection.py) 使用 `is not None` 判断：`None` 采用默认集合，显式 `enabled_tools=[]` 保持空集合；`BuiltinTools.none()` 返回 `[]`。这证明 SDK 的空数组语义，不能用来解释 CLI agent YAML 的 `tools: []` 或 ACP `_meta`。

## manage_task 的一条明确来源

[`LocalConnectionStrategy._to_harness_side_tools_proto()`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/local/local_connection.py#L1031) 写入：

```python
manage_task=localharness_pb2.ManageTaskToolConfig(
    enabled=(
        types.BuiltinTools.RUN_COMMAND in active_tools
        or types.BuiltinTools.SCHEDULE in active_tools
    )
)
```

| SDK 配置 | 写入的 `manage_task.enabled` |
|---|---|
| `enabled_tools=[]` | `false` |
| allowlist 只有 `VIEW_FILE` | `false` |
| 仅禁用 `RUN_COMMAND`，保留默认 `SCHEDULE` | `true` |
| 同时禁用 `RUN_COMMAND` 和 `SCHEDULE` | `false` |

官方 [`test_capabilities_config_disabled_tools`、`test_capabilities_config_disabled_tools_preserves_ask_question_disabled`、`test_capabilities_config_enabled_tools`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/local/local_connection_test.py#L2387) 断言了相关配置结果。本次阅读这些测试，没有运行。这里的证据止于公开 Python 层构造 proto；最终编译 runtime 是否生成相同模型声明，仍需要实际路径证据。

## 为什么尚不能用于 agy acp

两条公开调用链不同：

```text
SDK LocalAgentConfig.capabilities
  → LocalConnectionStrategy
  → HarnessConfig.harness_side_tools
  → localharness 编译程序
  → 长度前缀 protobuf 启动配置 + WebSocket JSON protobuf 事件

本项目
  → 本机 agy acp
  → stdio JSON-RPC
  → 官方 CLI 自行复用当前缓存登录
```

[`LocalAgentConfig.create_strategy()`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/local/local_connection_config.py) 将 capabilities 传入 strategy；[`_spawn_harness_and_connect_ws()` / `__aenter__()`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/local/local_connection.py#L1494) 展示 localharness 启动链。官方 [README](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/README.md) 的本地运行依赖 wheel 随附 binary，公开认证路径是 Gemini API key 或 Vertex / ADC。它没有证明该 SDK 可以复用用户当前 CLI 订阅登录，因此本项目不改为此路径。

[官方 CLI ACP 文档](https://antigravity.google/docs/ide/extensions/acp.md) 和 [CLI settings schema](https://antigravity.google/schemas/v1/settings.json) 没有公开全局 `enabled_tools` / `disabled_tools` 的用户提交入口，也未给出对应 ACP metadata 映射。不能把这些 SDK 字段直接放进 `_meta` 后当作已生效。

官方测试 `test_capabilities_config_run_command_sandbox_forwarded` 提到 “The ACP server sets run_command_config.enable_sandbox…”。这表明存在共享配置概念，但没有说明 CLI 用户如何提交 capabilities。schema 接受未知键也不能证明这些键被执行路径读取。

## 两个资源入口仍未解决

该提交的 [`BuiltinTools`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/types.py#L501) 没有 `list_resources` / `read_resource` 常量，也没有独立的 `manage_task` 常量。公开 [`HarnessSideTools` proto](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/proto/localharness.proto) 有 manage_task 配置，没有命名为这两个资源入口的开关。

[官方 MCP 文档](https://antigravity.google/docs/mcp.md) 的 `enabledTools` / `disabledTools` 只过滤某个 MCP server 提供的工具，不能据此过滤 Antigravity 额外注入的原生资源工具。清空服务器 resources 也不等于移除工具声明。

## 完整声明的观测缺口

已核对的公开接口没有提供最终模型请求的完整声明快照契约：

- [`Connection` / `DebugConfig`](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/connections/connection.py) 提供 tracing / logging 配置；没有完整 tools / system 导出方法。
- [`OutputEvent`、`InitializeConversationResponse` 和 hooks 参数](https://github.com/google-antigravity/antigravity-sdk-python/blob/75ba22bd00afae2f46393ff31f30c3f0df52982f/google/antigravity/proto/localharness.proto) 提供步骤、调用、历史、usage 等数据；没有保证这些数据等于最终请求声明。
- [ACP 文档](https://antigravity.google/docs/ide/extensions/acp.md) 公开调用与步骤，未承诺声明组合后的完整清单。

MCP `tools/list` 只能证明桥声明了什么；模型自述、权限请求、未发生原生调用也不能证明原生工具完全不可见。这里的结论是“尚未找到公开入口或观测契约”，不推导 CLI 内部绝不支持。

## 对当前实现的影响

1. 保持 `ACP_PURITY_UNVERIFIED`，不添加未经核验的 CLI 配置键或用户放行开关。
2. 后续定位 `manage_task` 时同时检查命令与调度组件，不能只关闭 `run_command`。
3. 保留 `list_resources` / `read_resource` 作为独立阻断项。
4. 只有找到明确 CLI 配置链和可靠声明证据，才能进行精确 profile 认证；SDK 单元测试不能替代它。
5. 当前 strict 权限候选仍保持不变。权限 allow/deny 与模型可见性分开验收，详见[研究结论](RESEARCH.md)与[测试计划](TEST-PLAN.md)。
