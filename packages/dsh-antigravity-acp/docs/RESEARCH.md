# 研究结论、证据等级与勘误

整理日期：2026-11-16。主线：本机官方 `agy acp`、当前活跃登录、DSH 掌握上下文和工具、模型不可见 agy 原生工具。实现与离线测试状态见[实现状态](STATUS.md)；历史在线用例与本轮离线验证分开记录。

## 1. 当前判断

**存在值得继续验证的候选配置，不等于已证明纯模型等价。** 最后两次留存用例中，隔离的自定义 agent 能调用测试 MCP 桥；文件读取挑战没有返回测试秘密，也没有记录到原生读工具事件。工具清单由模型自述，仍列出三个原生入口。

因此：私有 Host adapter、桥与隔离 runtime 已实现，真实 DSH Runtime 的离线调用链也已有验证；**真实生成仍须先补纯净性证据、精确配置复现和残留工具处理**。现阶段不安装生产、不删除旧插件。

## 2. 证据等级

| 等级 | 含义 | 可以支持什么 |
|---|---|---|
| A：实际协议与结果 | 鉴权桥收到了 tools/call、随机回执被模型使用；真实工具执行事件 | 该次调用真实发生 |
| B：重复行为观测 | 特定操作被拒、输出未含秘密、事件中没有原生调用 | 该版本该配置该挑战的行为 |
| C：静态资料 | 官方文档、CLI 帮助、程序嵌入字段和更新记录 | 字段存在和设计意图；不保证生效路径 |
| D：模型自述 | 列出工具、说 CANNOT_READ、描述自身能力 | 线索，不是完整工具声明的权威清单 |
| U：未验证 | 没有对应实验或保留证据不充分 | 不能作实现或发布承诺 |

ACP session/update 是执行与展示流，不是上游每次请求的完整 functionDeclarations。不能从没有看到工具事件推出模型没有看到该工具。

## 3. 调查脉络

| 阶段 | 主要发现 | 当前处理 |
|---|---|---|
| 旧直连研究 | DSH 默认输出预算链路、小探针与真实桌面调用差异、credit 字段差异 | 作为转向 ACP 的背景，根因不写死 |
| 初期 ACP 方案 | 官方登录复用、模型目录、system append、MCP 可接入 | 保留；“完整外部 agent”定位已被用户否决 |
| 外部首轮报告 | 原生读取绕过客户端 fs=false；MCP 可调用 | B05 漏传 enabledTools，不能单独否决该字段 |
| 本机第一轮 | enabledTools=[] 仍读成功；strict 读取门控；自定义 agent 无桥调用 | enabledTools 不是有效核心开关 |
| 第二轮 | strict 原生命令门控，eager 桥正向调用；deny-only 未阻止读 | 仅作为纵深策略；不满足工具不可见要求 |
| 第三轮 | excludeDefaultComponents、inheritMcp 与隔离“全局” eager 桥组合取得正向结果 | 候选基线，需精确复现；不能宣称完全等价直连 |

历史文件入口见[归档目录](archive/README.md)，现存结果见[证据目录](evidence/README.md)。

## 4. 已有事实与适用边界

| 结论 | 等级 | 限制 |
|---|---|---|
| 官方进程可复用当前 macOS keyring 登录并实际生成 | A/B | 不保证所有平台、账号或热切换行为 |
| 普通会话中 systemPrompt.append 能影响回复 | B | 与纯净自定义 agent 的组合未测；不等于 system 完整替换 |
| MCP 桥真实调用成功 | A | 是测试桥，不是完整 DSH 执行/审批集成 |
| fs=false、terminal=false 不禁止 agy 自身工具 | A/B | 这些客户端能力只控制 ACP 回调 |
| `_meta.antigravity.enabledTools: []` 在本次 1.5.9 测试不足以禁用原生读取 | A/B | 不断言它在所有 ACP 实现中均无效 |
| strict 加客户端拒绝挡住测试读和命令 | A/B | 没覆盖浏览器、后台任务、子代理等全部路径 |
| deny-only 在测试中未阻止读 | A/B | 不证明 deny 引擎普遍无效；可能涉及 ACP 配置路径或实际应用范围 |
| 二进制更新记录有 excludeDefaultComponents | C | 有退出默认提示段/工具的设计意图，真实声明仍待核验 |
| 自定义 agent 配合隔离全局 MCP 能调用桥 | A | 成功用例含 tools:null，且配置写入时序存在竞态 |
| 模型报告工具清单缩减 | D + B | 不能由自述证明所有原生工具均不可见 |

## 5. 候选配置与成功用例

关键字段：`excludeDefaultComponents: true`、`inheritMcp: true`，CLI 用 `--agent dsh-model`，MCP 写到隔离 gemini 根的 `config/mcp_config.json`，逐工具 eager。

留存的 `global-mcp-clean2` 与 `clean-read-attempt`：

- 桥完成发现，并收到一次 `dsh_echo` 调用；随机回执被最终输出使用。
- `clean-read-attempt` 的 `secretRevealed=false`；其记录只有桥工具事件，没有原生 read 事件。
- 同期工具清单自述为 `manage_task / list_resources / read_resource / mcp_dsh-bridge_dsh_echo`。

这支持“减少干扰的候选路径 + 真实桥可用”，不支持“只有 DSH 工具”或“没有隐藏读取路径”的全称断言。

## 6. 必须携带的勘误

### E01：成功 YAML 实际包含 tools:null

历史探针先做 `JSON.parse(argv)`，随后却用 `TOOLS === 'null'` 判断是否省略。输入 JSON null 解析成 JavaScript null，与字符串不等，最终输出 `tools: null`。

历史第三轮报告的示例省略了 tools；该示例与成功用例不完全相同。需对“字段省略 / YAML null / 空数组”做独立消歧。当前设计保留实际候选值并明确其未认证状态。

### E02：部分用例没有写出 agent.md

探针中出现过仅定义 writeAgent、条件不满足就不写出的路径；默认 agent 回退已实际被观察到。没有可核验的 agent 加载证据的运行不能用来比较自定义配置。未来缺 agent 或无法确认加载就停止，不接受静默默认回退。

### E03：模型自述不等于工具声明

“所有原生工具消失”“效果等价直连”“目标达成”均超出了留存证据。用户不接受三个原生工具的残留豁免；它们仍是阻断项，也没有证据证明 manage_task 无副作用。

### E04：tools 白名单错误不一定等于所有名称机制不可行

`call_mcp_tool` 和某些 MCP 名称曾产生 unknown component。另一些留存用例只有 end_turn 和无调用，诊断字段已在清理时删除。结论应限定为已测配置，不泛化为所有白名单路径失败。

`view_file` 与实际调用的 read_file 也可能存在别名/注册组件映射，不能直接认定 agent 绕过白名单。

### E05：“只有全局路径可用”“懒加载必然失败”需收窄

当前正向证据来自隔离全局配置；其他路径存在配置时序、agent 文件缺失等干扰，没有严格排除所有替代方式。eager 是当前设计选择；不是通过现有用例证明的唯一理论实现。

### E06：统计单位与次数

一条 session/prompt 可能含多次底层模型请求、内部安全检查、标题生成和重试。不能把 prompt 数当成上游请求数或计费数。

| 原记录 | 记录口径 | 可复核程度 |
|---|---|---|
| 外部首轮 | 报告称 5 个 prompt | 仅报告与部分脚本，未保留逐次请求账本 |
| 本机第一轮 | 4 个 prompt | 有 4 条生成用例和 1 条预检摘要 |
| 第二轮 | 5 个 prompt | 有 5 条用例摘要；含 executor 构造失败，不保证都请求过模型 |
| 第三轮 | 报告称 13 个 prompt | 只留 8 个不同用例结果；同名目录被覆盖、一次输出被丢弃，无法独立核对 13 |

不把三轮数字相加后写成权威总计。新测试使用不可覆盖的 run ID 与账本。

### E07：隐私、认证和隔离不能作绝对承诺

官方程序仍会访问当前登录，可能刷新 keyring；插件不读 token 降低了凭据暴露面，但不是“风险消除”。官方路径也不能保证零账号风险或零 429。

早期只设置 app-data-dir 的探针可能与生产配置共用来源；后期才同时隔离 gemini-dir。归档要保留此区别。父进程正常退出也不等于逐一证明所有后代退出。

### E08：MCP 加载前写配置

成功脚本在 spawn 之后、session/new 之前才写 agent/MCP 配置。文件读取时序可能影响结果；生产设计改为全部写入并核验后再启动，不保留此竞态。

### E09：旧直连 429 归因

确认的是请求差异与 Runtime 默认值路径，不是已完成严格 A/B 的根因。缺少 credit 字段、较大输出预算仍是历史假设；ACP 不重写 envelope 并不自动证明它“修复了根因”。

## 7. 参照仓库的取舍

参照 [KouzakiUmi/dsh-antigravity-acp](https://github.com/KouzakiUmi/dsh-antigravity-acp)，此前审读版本 0.1.38、提交 d8d8469（短 SHA）。本轮不重新联网或执行其代码。

| 借鉴 | 不纳入本项目 |
|---|---|
| 工具挂起/回填、会话复用边界、协议生命周期、假 ACP 测试方法 | proxy 模式、私有接口直连、凭据导入/OAuth、二进制下载 |
| 测试覆盖清单、模型目录与请求用途分区 | 将隔离测试通过数视为真实 Desktop 验收 |

此前复核记录为 47 个文件、843 项测试通过；本轮未重跑。采用代码时逐文件核对 MIT 许可并保留版权。本包已有独立实现，没有复制该仓库源码。

## 8. 2026-11-16 官方 SDK 源码补证

官方 Python SDK `0.1.23`、提交 `75ba22bd00afae2f46393ff31f30c3f0df52982f` 明确规定：`CapabilitiesConfig.enabled_tools` / `disabled_tools` 从模型上下文移除工具；执行期 policy deny 仍保留声明。显式 `enabled_tools=[]` 不回退默认工具。

SDK 的 `_to_harness_side_tools_proto()` 仅在 `RUN_COMMAND` **或** `SCHEDULE` 仍激活时设置 `manage_task.enabled=true`。因此在该 SDK 路径中仅禁用命令并不足以关闭任务管理。该结论来自公开 Python 配置构造代码与测试，尚不是 CLI ACP 的实际模型声明证据。

SDK 经 `HarnessConfig.harness_side_tools` 启动 localharness；CLI 则经 `agy acp` 使用 stdio JSON-RPC 和当前缓存登录。公开 CLI 文档没有给出对应 capabilities 入口，两个资源工具也没有找到可用关闭开关或完整声明观测契约。不映射未知 `_meta` 字段；取而代之的出口净化方案见 §10。固定提交、逐层链接与限制见[SDK 与 CLI ACP 边界](SDK-CLI-BOUNDARY.md)。

## 9. 下一步必须补的证据

1. tools 三态、配置写入顺序、agent 选中证明的精确复现。
2. 完整模型可见工具与提示的可靠观测机制；先找官方可用诊断，不默认抓取带凭据和正文的 HTTP。
3. 三个残留工具的去除方式与真实边界（已由 §10 的网关方案在出口层解决，CLI 内部仍待权威说明）。
4. excludeDefaultComponents 与 DSH system 注入、动态 skill、工具快照更新的组合。
5. 完整 agent-loop 与官方 CLI 组合的挂起续轮、拒绝、取消、不确定副作用测试。假 ACP、真实 MCP 桥和真实 DSH Runtime 的离线层已经验证；这没有替代完整 agent-loop 或在线验收。

## 10. 2026-11-16 出口观测与净化网关（结论修订）

### 10.1 观测手段

- **TLS 中间人**：`mitmdump` 监听 loopback，CLI 子进程只带 `HTTPS_PROXY` 与 `SSL_CERT_FILE`；代理在未放行时对 `streamGenerateContent` 直接返回 400，因此纯采样不消耗额度。用于取得 7 组配置的声明矩阵。
- **CLI 自带的出口重定向**：`agy acp --cloud_code_endpoint http://127.0.0.1:<port>` 被接受，CLI 会把**真实 Authorization 头**发到这个地址，路径前缀原样保留。这条路径不需要 TLS 拦截，也不需要证书，因此成为产品机制的基础。

### 10.2 声明矩阵（纯采样，零额度）

| 配置 | 线上 functionDeclarations |
|---|---|
| 无桥 | `manage_task` |
| 桥 + `tools: null` + `excludeDefaultComponents: true` | 桥工具、`list_resources`、`read_resource`、`manage_task` |
| 同上但 `tools: []` | 完全相同四项 |
| 显式把 MCP 名写进 agent `tools` | 没有产生带工具的请求（该名称不是合法组件） |
| 默认 agent（不用定制 agent） | 17 组：read_file、run_command、write_file、edit_file、search_web、run_workflow、swarm、ask_question、schedule、invoke_subagent、define_subagent、manage_subagents、send_message、manage_task、桥、`list_resources`、`read_resource` |
| 默认 agent 且无桥 | 14 组，含 `manage_task`，不含两个资源工具 |
| `--sandbox` 或 deny-all 权限（含 `mcp(*)`） | 与基线完全相同四项 |

结论：`excludeDefaultComponents` 去掉了 14 个原生声明中的 13 个；`manage_task` 在 CLI ACP 中**无条件注入**；两个资源工具只在配置了 MCP 服务器时出现；操作系统沙箱和权限规则只改执行、不改可见性。

### 10.3 提示层残留

即使 `excludeDefaultComponents: true`，agent 请求的 `systemInstruction` 仍是完整 Antigravity 身份提示（`<identity> … designed by the Google Deepmind team` 以及 `<artifacts>` 段落）。CLI 还会注入 `requestType: "checkpoint"` 的会话标题请求（内容以 ` You are a conversation title generator.` 开头、无工具）。所以只删工具声明仍然不够，必须同时重写系统提示。

### 10.4 已核验的 `_meta` 与配置键（修订 E03/E04）

二进制诊断字符串显示 ACP 的 `_meta.antigravity` **只支持 `systemPrompt`**：

- `Ignoring invalid systemPrompt in _meta.antigravity: missing 'append' key`
- `'append' key must be a string, got %T`
- `Ignoring unsupported systemPrompt format in _meta.antigravity (expected object, got %T)`

`eagerMcpServers`、`enabledTools`、`harnessSideTools` 在我们的请求里**没有对应解析**，属于被静默忽略的字段；早期把效果归因给它们是错的。桥工具之所以 eager，是因为 `mcp_config.json` 里写了 `tools.<name>.eager`。`settings.json` schema（`https://antigravity.google/schemas/v1/settings.json`）没有任何控制 `manage_task` 的键，`hideActiveItems` 只是 UI。

### 10.5 净化网关的实测结果

生产代码路径（`AcpEngine` → `startAgyRuntime` → 真实 `agy 1.5.9` → 网关 → 真实上游）：

- 轮 1 触发工具调用，轮 2 回填后模型回复 `DONE`；网关记录 `sanitizedAgentRequests: 2`、`strippedDeclarations: 6`、`systemRewritten: 2`、`upstreamDeclarationsForwarded: false`。
- 早期的原型网关（只删工具、不改提示）也单独跑通过 `OK` 与 `ping → DONE`，说明桥接与流式协议不受改写影响。
- **失败即关闭**：请求体不是 JSON、工具结构异常、没有 DSH 系统提示、网关内部异常，四种情况都返回 4xx 且不连接上游。实测把这类错误做成 5xx 时，CLI 会把同一条请求重试 8 次（全程被网关拒绝，未消耗上游额度），所以改成 4xx 让它快速失败。
- **权限**：CLI 会对桥工具发起 `session/request_permission`（`toolCall.name = mcp_dsh-bridge_dsh_0_dsh_echo`，选项含 `allow_once`/`reject_once`）。适配器只批准“名字以 `mcp_dsh-bridge_` 开头且属于本单元已公布工具”的请求，其它一律取消并报 `ACP_PERMISSION_UNVERIFIED`。

### 10.6 环境侧观测（与插件无关）

2026-11-16 当天，Gemini 模型经官方 CLI 直接调用也返回 `FAILED_PRECONDITION (code 400): User location is not supported for the API use`，而同一账号的 Claude 模型正常；`agy models` 仍能列出全部模型。因此该错误属于上游/地区策略，不能归因到本插件，也不能拿它做纯净性结论。验收因此使用 `claude-sonnet-5-5`。

### 10.7 修正后的产品声明

- 声明：**模型收到的 system 与 tools 由本地网关在出口处重写，非 DSH 声明不会离开本机。**
- 不声明：CLI 内部不存在其它出口、与直连 Google Cloud 行为等价、或“零原生能力”。后者需要官方权威说明才能升级。
