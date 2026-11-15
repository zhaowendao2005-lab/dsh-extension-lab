# Antigravity Direct：DSH 桌面端 429 诊断与自有协议改造计划

> 状态：研究/计划稿，不包含生产代码改动  
> 日期：2026-11-15（Asia/Shanghai）  
> 适用环境：DeepSeek Harness 0.2.2-rc.3、`dsh-antigravity` 1.1.3、macOS arm64  
> 原则：先观测、后单变量验证、再改协议；不把 Google 服务故障当作默认解释。

## 1. 执行摘要

当前证据指向 DSH 与 `dsh-antigravity` 之间的请求协议边界，而不是账号没有额度或 Google 服务整体不可用。

已确认的现场事实：

1. 真实桌面会话选择 `antigravity/gemini-4-hydrogen` 后，在约 1–3 秒内连续返回三次 HTTP 429：`Resource has been exhausted (e.g. check quota).`。
2. 失败请求的 DSH `request/header` 明确包含：
   - `maxTokens: 262144`
   - `reasoningEffort: high`
   - `adapterDefaults.maxTokens: true`
   - 89 个工具，工具 schema JSON 约 99 KB。
3. 当前动态模型缓存中 Hydrogen High/XHigh 的上游能力值为：
   - `maxTokens: 1048576`
   - `maxOutputTokens: 262144`
4. 正常 DSH 调用链会把插件 catalog 的 `defaultMaxTokens` 自动物化为 `GenerateOptions.maxTokens`，插件再写入 Cloud Code 的 `request.generationConfig.maxOutputTokens`。
5. 既有成功抓包 harness 直接调用 `service.adapter.stream()`，绕过 DSH `LlmRuntime.prepareCall()`，所以成功样本没有携带正常桌面请求会出现的 `maxOutputTokens: 262144`。旧文档据此得出的“DSH 不会使用 defaultMaxTokens”结论不适用于真实桌面链路。
6. Antigravity CLI 成功请求含 `enabledCreditTypes: ["GOOGLE_ONE_AI"]`；插件未发送该字段，同时插件只保留 tier/project，未保留 `paidTier.availableCredits`。
7. 当前失败是插件收到并转译的原始 429，不是 `billion-context` 合成的本地 424；其他插件仍可能影响后续重试与恢复，但不是首个 429 的首要解释。
8. 插件配置还有一条独立风险：DSH 文档规定 `.volatile()` 字段运行时通过 `config.field.get()` 读取并可原位更新；当前插件却把整个 config 当普通对象交给 `normalizeConfig()`。这比“loader 把配置剥离”更准确，也能解释此前 endpoints/storageDir 覆盖不生效。实施前必须用 `Config.listConfigs` 和运行时脱敏类型检查确认实际形态。

当前最高优先级的**待验证假设**（不是已确认根因）：

- **H1：credit 路由缺失。** 插件没有按账户 entitlement 发送 `enabledCreditTypes`，真实请求可能落入不同资源池。证据：CLI wire 有该字段、插件无；反证：小型插件请求在缺失时也曾 200。
- **H2：能力上限被误作默认策略。** 上游声明的 `maxOutputTokensCapability=262144` 被直接用作每轮默认输出预算，可能结合 High reasoning、大历史和 89 个工具触发准入/容量预留型 429。证据：真实失败链路已确认发送 262144；反证：该值是上游公开 catalog 声明的能力上限，并非明显非法。
- **H3：H1 与 H2 共同触发。** 小探针因省略最大输出值、请求极小而成功，真实 DSH 请求则立即失败。反证条件：严格 Both A/B 仍稳定失败，或单变量复验无法重复。

服务端时序容量仍是未排除变量；计划不以“当前证据指向插件”替代严格因果验证。

## 2. 目标与非目标

### 2.1 目标

1. 在不记录凭证、提示词或工具结果的前提下，确认真实桌面请求的最终出站字段。
2. 用严格单变量 A/B 确认 429 与 `enabledCreditTypes`、`maxOutputTokens` 的因果关系。
3. 建立插件自有的 Cloud Code 协议层，分离：
   - 上游原始能力；
   - 账户 entitlement；
   - 插件请求策略；
   - DSH provider-neutral adapter；
   - Cloud Code wire envelope。
4. 修正 429 分类与退避，消除 600ms/1.2s 的快速重试放大。
5. 使用完整 DSH `ctx.llm.stream()`/Agent Loop 做回归，不再用低层 adapter 直调代表桌面行为。
6. 保留可快速回滚和可移除的诊断能力。

### 2.2 非目标

1. 不伪造 TLS/JA3/JA4 指纹。
2. 不实现或上传 CLI 的遥测、`play.log`、`recordTrajectoryAnalytics`。
3. 不记录 OAuth Bearer token、refresh token、完整 prompt、system prompt、工具参数或工具结果。
4. 不在未经单变量验证前同时更改 UA、credit、output cap、工具布局和重试。
5. 不把未公开的 `v1internal` 当作稳定公共 API；所有协议都必须有 fixture、版本标记和降级策略。

## 3. 建议的自有协议架构

### 3.1 Raw DTO 层

只忠实保存 Cloud Code 返回值及字段来源，不直接赋予 DSH 语义：

```ts
interface RawAvailableModelDTO {
  upstreamId: string;
  internalModelEnum?: string;
  maxTokens?: number;
  inputTokenLimit?: number;
  maxOutputTokens?: number;
  outputTokenLimit?: number;
  supportsThinking?: boolean;
  remainingFraction?: number;
}
```

规则：

- 只接收正 safe integer；非法值视为 absent 并写脱敏诊断。
- 保留每个 upstream variant 的数据，不只使用 family 的 `bucket.primary`。
- 保留 `MODEL_PLACEHOLDER_*` 作为观测/labels 元数据，但不用它替代 envelope 的 public model ID。

### 3.2 Normalized capabilities 层

```ts
interface ModelCapabilities {
  inputTokenLimit?: number;
  combinedContextWindow?: number;
  maxOutputTokensCapability?: number;
  source: 'upstream' | 'cache' | 'static';
}
```

关键约束：

- `inputTokenLimit` 不直接等同于 DSH 的 combined `contextWindow`。
- `maxOutputTokensCapability` 是能力上限，不是每轮默认请求值。
- 未知值保持 `undefined`，不要用 1M/65K 冒充已确认事实。

### 3.3 Account entitlement 层

```ts
interface AccountEntitlement {
  projectId: string;
  tierId?: string;
  tierLabel?: string;
  // undefined = 上游未返回或尚未解析；[] = 权威响应明确为空。
  availableCredits?: Array<{
    type: string;
    minimumAmountForUsage?: string;
  }>;
  source: 'loadCodeAssist';
  accountGeneration: number;
  fetchedAt: number;
}
```

规则：

- 先用 allowlist 脱敏 fixture 固化 `paidTier.availableCredits` 的真实元素形状，再实现 parser；不能先假定它是 `string[]`。
- 只有权威响应明确返回并包含 `GOOGLE_ONE_AI` 时，策略层才可序列化该 credit type。
- `undefined`、明确空数组和解析失败是三种不同状态；wire 中字段省略与 `[]` 也不得混用。
- Free、Enterprise、Workspace、自建 project 不做硬编码猜测。
- entitlement 缓存必须跟 account/token generation 绑定，登录/刷新/切号后失效。

### 3.4 Request policy 层

```ts
interface AntigravityRequestPolicy {
  defaultOutputTokens?: number;
  maximumOutputTokens?: number;
  enabledCreditTypes?: string[];
  retryClass: 'none' | 'short-rate-limit' | 'quota-reset';
}
```

建议初始策略：

- 已知 Gemini agent 模型：默认输出候选值 65,536；是否用于 Hydrogen 必须通过单变量 A/B 确认。
- `defaultOutputTokens <= maxOutputTokensCapability`。
- 用户显式 `maxTokens` 超过已确认 capability 时本地报错，不静默 clamp。
- 未知模型且无可靠策略时不设置 `defaultMaxTokens`，让服务端默认值生效。

### 3.5 DSH adapter 边界

`resolveModel()` 只把已经确认的语义映射为：

```ts
{
  context?: { contextWindow: number },
  defaultMaxTokens?: number,
  reasoning?: {...}
}
```

保留 DSH 的职责：

- 默认值物化；
- `adapterDefaults` provenance；
- `request/header` 持久化；
- `request/context` 上下文预算；
- 后续轮次重新解析动态默认。

### 3.6 Wire translator 层

`buildAntigravityRequest()` 保持纯映射：

```text
GenerateOptions + resolved upstream model + request policy
→ Cloud Code envelope
```

目标 envelope：

```json
{
  "project": "aicode-consumers",
  "requestId": "agent/.../.../.../...",
  "request": {
    "contents": [],
    "systemInstruction": {},
    "tools": [],
    "labels": {},
    "generationConfig": {
      "maxOutputTokens": 65536,
      "thinkingConfig": {}
    },
    "sessionId": "..."
  },
  "model": "gemini-4-hydrogen-high",
  "userAgent": "antigravity",
  "requestType": "agent",
  "enabledCreditTypes": ["GOOGLE_ONE_AI"]
}
```

注意：示例值不是无条件常量；`maxOutputTokens` 和 `enabledCreditTypes` 都由前述策略层决定。

## 4. 分阶段执行计划

### Gate R0 — 研究完成，等待实现批准

本文交付时停在此 Gate：只完成已有日志、源码、抓包和公开资料的只读审计。以下 Phase 0–8 都是**获用户明确批准后**才执行的实施计划。任何新建 fixture、修改文档/harness、创建或安装 bundle、改变 profile、发送线上 A/B 请求，均不属于当前研究阶段，必须在执行前再次确认；其中真实线上请求还需要单独确认请求预算。

## Phase 0 — 证据冻结与安全清理（获批后）

### 工作

1. 保存当前失败 session 的脱敏摘要：model、effort、maxTokens、工具数、时间、requestId hash、重试间隔和 status。
2. 固化当前安装插件与工作区构建产物的 SHA-256；当前已确认二者相同。
3. 对 `capture/*.jsonl` 和 `*.mitm` 做安全标记：它们含历史 Authorization access token，只能本地使用，不得打包或提交。
4. 保持 `.gitignore` 中 `capture/*.jsonl`、`*.mitm`、`capture/cli-prompt.txt` 的忽略规则。
5. 通过**结构化 allowlist 重建**脱敏 fixture，只从原始数据提取批准的字段名、数值、布尔值和枚举；不得采用“复制完整 body 后删除敏感字段”的 blacklist 方式。
6. fixture 添加 `schemaVersion`、采集来源、CLI/插件版本、字段 provenance；原始 capture 永不进入测试目录、构建产物或发布包。

### 交付物

- `test/fixtures/protocol/` 下的脱敏 CLI/插件请求 fixture。
- 一份 baseline JSON，记录当前失败元数据但不含内容。

### Gate

- 通用 secret scanner 与人工抽查都不得发现任何 OAuth/Cookie/JWT/client secret、邮箱、用户正文、工具内容或个人绝对路径；不只匹配 `ya29.`。

## Phase 1 — 修正调查方法与文档

### 工作

1. 修正 `ANTIGRAVITY-REQUEST-DIFF.md`：明确 raw `adapter.stream()` 与正常 DSH `ctx.llm.stream()` 的区别。
2. 将测试分成两层：
   - 经 `ctx.llm.stream()` 的 Runtime 测试，仅证明 adapter default 已物化并进入最终 `GenerateOptions`；
   - 经完整 Agent Loop 的持久化测试，证明 `request/header`、`adapterDefaults` 和 `request/context` 被正确写入 session log。
3. fixture 中同时保存：
   - `request/header.header.config.maxTokens`
   - `adapterDefaults.maxTokens`
   - `request/context.contextWindow`
   - 最终 wire `generationConfig.maxOutputTokens`
4. 禁止用低层 adapter 直调结果外推桌面行为。

### Gate

- 测试能证明 `defaultMaxTokens` 被 DSH 物化；contextWindow 与 maxTokens 保持独立。

## Phase 2 — 窄作用域脱敏诊断 seam（获批后）

### 设计决策

独立 bundle **不得 monkey-patch `globalThis.fetch`**。进程级包装会跨越所有 Host 插件，存在加载顺序、竞态和卸载时覆盖其他 wrapper 的风险，也无法安全保证恢复。

采用两级方案：

1. **DSH/llm 观察层（可选临时 bundle）**：实现前通过 Cordis Inspect 查询 `llm/stream` 的准确 waterfall contract；观察者不拥有决策，必须原样调用 `next()`，只记录 allowlist 元数据。它只能观察 provider-neutral options，不能声称看到了最终 wire envelope。
2. **Antigravity 内部诊断 seam（最终 wire 的权威观测点）**：在 `buildAntigravityRequest()` 之后、`AntigravityHttpClient.post()` 发送之前，调用一个依赖注入的 `ProtocolDiagnosticObserver`；响应返回后再记录脱敏 status/delay。默认使用 no-op observer，诊断构建或明确配置才启用。该 seam 只作用于 Antigravity 自己的请求，不接管全局 fetch。

如果 Cordis Inspect 发现已有更弱且准确的只读服务扩展点，优先使用该扩展点；否则不创建能读取最终 wire 的“纯独立 bundle”假象。

### 只允许记录

```json
{
  "schemaVersion": 1,
  "provider": "antigravity",
  "model": "gemini-4-hydrogen-high",
  "reasoningEffort": "high",
  "maxOutputTokens": 262144,
  "enabledCreditTypesState": "absent",
  "messageCount": 107,
  "toolCount": 89,
  "toolsBytes": 99093,
  "bodyBytes": 0,
  "structureHmac": "...",
  "endpointHost": "daily-cloudcode-pa.googleapis.com",
  "status": 429,
  "retryAfterMs": null,
  "elapsedMs": 3100
}
```

- `structureHmac` 只覆盖 allowlist 后的结构摘要，使用每次诊断运行随机生成、**不持久化**的 HMAC key；不保存完整 body 的裸 SHA-256。
- trace id 默认不持久化；若确需关联，仅在同次运行内使用随机 key HMAC。

### 禁止记录

- Authorization/Cookie/JWT/client secret；
- prompt/system/tool 文本与工具参数/结果；
- 图片内容；
- OAuth callback；
- 完整 request/response body；
- 账号邮箱、姓名和个人绝对路径。

### 数据与生命周期

- 诊断开关使用**普通 Config 字段**，启停时让插件重启并由 `apply()` 完整建立/拆除 observer；不使用捕获旧布尔值的 `.volatile()` 开关。
- 诊断数据默认写入经 Inspect 确认的 DSH/OS 私有插件存储，不写 workspace；目录权限 0700、文件 0600、拒绝 symlink。
- 日志有大小上限、轮转、TTL 和显式“清除诊断数据”操作；卸载代码与删除数据是两个独立动作。
- 若需要临时 Host bundle，包只创建在 workspace，使用 `plugin_manager install_bundle` 安装，不手写 profile 文件，不含 install scripts。
- 替换已安装 Host 包后按 Plugin Manager 返回的 `application/warnings` 处理；新 JavaScript generation 需要重启时不得声称已热生效。

### Gate

- 本地 sink 证明 observer 不改变 request body/status/时序；异常、禁用、卸载和 Host 重启后没有遗留 listener/observer；日志通过 allowlist/权限/轮转/TTL 检查。

## Phase 3 — 单变量离线请求生成

### 工作

从同一份真实 DSH GenerateOptions 生成以下 envelope，但先不发送：

| 组 | 唯一变化 |
|---|---|
| Baseline | 当前值：262144，无 credit 字段 |
| Credit | 只增加实际 entitlement 返回的 `enabledCreditTypes` |
| Output | 只把 262144 改为 65536 |
| Both | 同时启用 entitlement credit + 65536 |
| Server default | 只省略 maxOutputTokens |

对每组记录 JSON Pointer diff、body SHA-256 和字节数，确保没有隐藏变量。

### Gate

- 每个实验相对 Baseline 只能出现批准字段的差异。

## Phase 4 — 探索性最小线上 A/B（需单独确认）

### 前置安全 Gate

线上实验必须使用专门的 **no-retry/no-failover 实验通道**，不得直接通过当前 Agent Loop 重试链执行。执行前验证：

- DSH provider retry 为 0；
- 同账号 429 retry 为 0；
- 账号切换、variant fallback、endpoint fallback 全部关闭；
- 工具只声明不执行，使用无敏感正文和无副作用的结构等价请求；
- observer 计数证明每组恰好 1 个 `streamGenerateContent` content request；
- 响应字节、最长时长和成本设硬上限。

未满足任一项，不进行线上实验。

### 探索预算

第一轮最多 6 个真实 content requests。固定同一账号/project/endpoint、模型 variant/effort、prompt/system/tools/history 和 UA。实验顺序应随机或交错，并设置冷却，避免固定顺序把自然恢复误当成字段作用。

候选组：Baseline、Credit-only、Output-only、Both、Server-default；UA-only 仅当前述都不能解释时纳入。

### 结果解释

每组单次结果只能：

- “支持某假设”；
- “不支持某假设”；
- “因时序/容量噪声无法判断”。

不得用一次 200/429 宣称“锁定因果”。若某候选产生差异，需在新的独立时间窗口、交错顺序下再次获得授权复验；只有重复结果稳定且 observer 证明严格单变量，才进入因果结论。所有组 429 时才进入 tools/history/UA 层；所有组 200 时保留诊断等待自然复现，不做猜测性改动。

## Phase 5 — 正式协议实现

### 5.1 能力与策略分离

- 拆分 Raw DTO、Normalized capabilities、Catalog policy。
- 已知 family 的策略不再被动态 capability 无条件覆盖。
- variants 分别保存能力；family 聚合使用明确规则。

### 5.2 entitlement 与 credit

- 扩展 `CodeAssistTierInfo`，以 optional + provenance 形式保存 allowlist 解析后的 `availableCredits`，区分 absent、empty 和 parse-failed。
- account metadata 绑定 entitlement/account generation、source 与 fetchedAt；登录/刷新/切号并发场景必须使旧值失效。
- translator 只序列化策略层明确提供的 credit types；不把 absent 变成空数组。

### 5.3 max token 安全

- `defaultMaxTokens` 由 policy 决定，不等于 upstream capability。
- explicit maxTokens 必须为正 safe integer。
- 超 capability 本地返回明确 `INVALID_REQUEST`。
- 修复 `0.5 > 0 → Math.trunc() = 0` 的边界。

### 5.4 配置生命周期修正

实施前先通过 Cordis Inspect 读取当前插件的 Config schema，并对运行时 config 只做类型/键名诊断，不输出值或凭证。

依据 DSH 当前开发文档：

- 普通 Config 字段变更会重启插件，适合 endpoints、storageDir、timeout 这类构造期配置；
- `.volatile()` 字段不会重启插件，运行时应通过 `config.field.get()` 读取，并为变化建立响应逻辑；
- 当前插件将 volatile config 当作普通值一次性传给 `normalizeConfig()`，需要在两种方案中选一：
  1. 对构造期字段移除 `.volatile()`，让配置变更重启插件并重建 client/service（推荐）；
  2. 保持 `.volatile()`，但正确解引用并为 endpoint/client/account service 实现可验证的热更新。

不得直接编辑 profile 的 `cordis.patch.yml`；配置保存必须走 Config Editor。OAuth token 继续使用插件私有凭证/存储，不迁入 Config。

### 5.5 wire profile

优先对齐功能性字段：

1. project/model/requestType；
2. enabledCreditTypes；
3. generationConfig；
4. model internal enum/cascade labels（仅统计/诊断）；
5. UA A/B 只有在证据要求时才切换。

不优先处理：chunked vs content-length、undici 默认头、遥测缺失。

## Phase 6 — 429 分类与重试

### 当前问题

DSH provider retry policy 当前对 RATE_LIMIT 约 600ms、1.2s 后重试，真实截图与 session log已确认。这会在准入失败时快速重复同一大请求。

### 改造规则

1. 解析 `Retry-After`、结构化 `RetryInfo.retryDelay`、`quotaResetDelay`，并保留 raw status、结构化 details/type 和 message 的脱敏摘要。
2. 仅凭 `Resource has been exhausted` 不能判定 quota、admission、rate limit 或系统容量；无结构化证据时分类为 `RESOURCE_EXHAUSTED_UNKNOWN`/“未知且不可快速重试”，可以不自动重试，但不得伪装成已知 quota。
3. Google Service Infrastructure 文档中的“quota 429 最小 30 秒”针对 **Service Control API**，不是 Cloud Code `v1internal` 的服务承诺。本插件只可把 30 秒作为无上游 delay 时的保守自选 fallback；优先使用 Cloud Code 实际返回的 RetryInfo/Retry-After，否则直接向用户报告并停止自动放大。
4. 429 不切 endpoint，不盲目换号；只有明确账户额度耗尽且存在健康备用账号时才允许切换。
5. 408/404/5xx 才按现有 endpoint fallback。
6. 与 `billion-context` 的本地 throttle 分离：先记录原始上游 status，再允许外层 middleware 决策。

## Phase 7 — 测试矩阵

### 单元测试

- Raw catalog 数值校验：零、负数、小数、超 safe integer。
- 每 variant 的 capability 聚合。
- entitlement extraction：Pro/Free/Enterprise/无 credits。
- max token policy：default、explicit、超限、undefined。
- envelope snapshot：credit presence/absence、output cap、requestType。
- 429 body/header/RetryInfo 分类。

### DSH Runtime 集成测试

经 `ctx.llm.stream()`：

1. adapter default 被物化到最终 `GenerateOptions.maxTokens`；
2. explicit maxTokens 覆盖默认；
3. 配置值确实进入 runtime/client，而不只出现在 dump-config。

### Agent Loop 持久化测试

经完整 Agent Loop：

1. adapter default 进入 `request/header` 且 `adapterDefaults.maxTokens=true`；
2. contextWindow 只进入 `request/context`；
3. 后续轮次重新解析动态默认；
4. 完整工具列表不丢 schema；
5. replay/fork 后 request policy 稳定。

### 配置生命周期测试

1. 普通 Config 变更按预期重启并重建 client；若选择 volatile 方案，则通过 `.get()` 热更新且有完整响应/cleanup 测试；
2. endpoints/storageDir/timeout 的覆盖值进入实际运行时；
3. entitlement 在登录刷新、切号和并发 refresh 后不复用旧 generation。

### 本地 sink 测试

- 完整 request body 的键序、字段和 hash；
- 不出外网；
- 模拟 200 SSE、429 无 delay、429 RetryInfo、5xx、断流、空流。

### 干扰矩阵

核心协议通过后再测试：

| billion-context | dsh-cost-meter | dsh-btw-side | 目标 |
|---|---|---|---|
| off | off | off | 插件基线 |
| on | off | off | 429/424 行为 |
| on | on | off | fetch/计量包装 |
| on | on | on | 当前桌面实际组合 |

每组只用本地 sink；只有最终基线做最少真实请求。

## Phase 8 — 发布、回滚与观测

### 推荐交付节奏

1. 本地 private diagnostic build/seam：仅观测，不称为市场发布版。
2. `1.2.0-rc.1`：协议边界、credit、token policy、配置生命周期和 retry safety。
3. `1.2.0`：重复 A/B、完整测试矩阵与桌面新会话验证通过后发布。

每次安装/替换都读取 `plugin_manager` 的 `application` 与 `warnings`；替换已安装 Host 包通常需要重启加载新的 JavaScript generation。只有重启后的新会话验证通过，才能宣布生效。

### 回滚

- 保留 1.1.3 安装源和 SHA-256。
- 使用两个独立开关：
  - `wirePolicyV2` 控制 credit/output-cap/envelope 策略；
  - `retrySafetyV2` 控制“不快速放大 429”的安全策略。
- 回退 wire policy 时 **不回退 retry safety**。
- entitlement cache 带 schemaVersion/accountGeneration，可直接丢弃重建，不做旧格式就地猜测迁移。
- 回滚矩阵覆盖 Pro/Free/Enterprise/Workspace/自建 project；未知账号类型默认省略 credit 字段。
- 诊断代码移除和私有诊断数据清理分别验证。

### 验收标准

1. 同一桌面会话切换到 Hydrogen 不再立即 429；若上游真实限流，错误包含明确分类与合理等待信息。
2. 真实出站请求的 credit 类型与 account entitlement 一致。
3. 默认 maxOutputTokens 来自插件策略，不直接等于 capability maximum。
4. DSH request/header 与 wire request 可由脱敏诊断关联。
5. 无 OAuth/prompt 数据进入诊断日志。
6. 测试覆盖完整 DSH Runtime，不再只覆盖 raw adapter。
7. 其他插件 on/off 不改变主插件出站 body hash（允许额外外层计量，但不改协议字段）。

## 5. 参考信息

## 5.1 Antigravity CLI 与本地实证

### CLI

- 使用 `command -v agy` 定位本机二进制，不在报告中持久化个人绝对路径。
- 当前本机 `agy --version` 为 1.5.9；2026-11-14 既有抓包报告记录的采集时二进制为 1.5.8，而 wire HTTP UA 自称 `antigravity/cli/1.5.9`。二进制版本与 wire UA 必须分开记录。
- CLI 是闭源 Mach-O，`v1internal` 不是公开稳定协议，因此现有 MITM 抓包和脱敏行为 fixture 是当前最直接的协议证据。

### 项目调查文档

- `docs/ANTIGRAVITY-REQUEST-DIFF.md`：CLI 与插件同调用抓包差异。
- `docs/REPORT-DIFF.md`：差异汇总。
- `docs/ANTIGRAVITY-PLUGIN-ANALYSIS.md`：AGM/请求头/信封/重试和缓存设计研究。
- `docs/ANTIGRAVITY-PLUGIN-SURVEY.md`：其他 Antigravity 插件和调度方案调研。

### 抓包与分析工具

- `capture/dump_flows.py`：MITM flow → JSONL。
- `capture/compare.py`：请求差异比较。
- `capture/plugin-request.mjs`：低层 adapter harness；仅适合 raw adapter 测试，不能代表完整 DSH。
- `capture/*.mitm`、`capture/*.jsonl`：敏感本地证据，已由 `.gitignore` 排除，不得发布。

## 5.2 插件关键源码

- `src/host/quota.ts`：Cloud Code catalog/tier/quota 解析。
- `src/host/catalog.ts`：family/variant 合并、DSH model metadata。
- `src/host/adapter.ts`：DSH adapter、请求准备、账号/session、重试入口。
- `src/host/translate.ts`：DSH messages/tools → Cloud Code envelope；SSE decoder。
- `src/host/client.ts`：HTTP client、endpoint fallback、429 分类与 retry delay。
- `src/host/identity.ts`：UA、requestId、sessionId、headers。
- `src/host/accounts.ts`：账号粘性、失败与 quota 状态。
- `src/host/config.ts`：配置 schema 与 normalizeConfig。

## 5.3 DSH 插件开发 Skill 与本机文档路径

Skill 根目录：

```text
/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/
  node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/
```

本任务应优先阅读：

- `references/plugin-development.md`：持久插件开发、安装和验证总流程。
- `references/host-plugin.md`：Host bundle、manifest、patch、生命周期和 Plugin Manager 安装。
- `references/practices.md`：事件/服务扩展点、session log 真相源、waterfall listener 规则。
- `references/configuration.md`：Config editor、`.volatile()` 语义、凭证存储边界。
- `references/verification.md`：桌面页面/插件验证和不可验证项的报告方式。
- `references/locate-docs.md`：定位当前安装版本的文档和 package source。
- `references/upgrading.md`：随 DSH 版本升级的兼容性检查。
- `references/composition-reference.md`：`cordis.patch.yml` patch 语法。

实施时必须先用 Cordis Inspect：

1. `cordis_inspect_list`
2. `Service.listService`
3. `Event.listEvents`
4. `Config.listConfigs`

不要猜 `llm/stream` 的 listener 签名、mode 或插件 Config 的运行时形态。

## 5.4 DSH 当前版本核心源码

安装根：

```text
/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/
```

关键源码：

- `node_modules/@deepseek-ai/dsh-llm/src/types.ts`
  - `LlmResolvedModelInfo.defaultMaxTokens`
  - `GenerateOptions.maxTokens`
  - `LlmModelContext.contextWindow`
- `node_modules/@deepseek-ai/dsh-llm/src/index.ts`
  - model metadata 校验
  - `defaultMaxTokens` 物化
  - adapter default provenance
- `node_modules/@deepseek-ai/dsh-agent-loop/src/agent.ts`
  - `prepareCall()`
  - `request/header`
  - `request/context`
  - GenerateOptions 构造
- `node_modules/@deepseek-ai/dsh-session/src/types.ts`
  - EpochHeader 与 RequestContext 的持久化语义。

当前安装版本证据：`@deepseek-ai/dsh/package.json` 为 0.2.2-rc.3。

## 5.5 Google Cloud 官方参考

1. [Gemini for Google Cloud — Quotas and limits](https://docs.cloud.google.com/gemini/docs/quotas?hl=en)
   - 配额与系统限制用于公平分配和防止服务过载；
   - 文档描述 per-user/project 请求限制，以及 Google 产品中的 Gemini CLI/Code Assist agent mode 计数；
   - 这里的“Gemini CLI”不能外推为本计划研究的闭源 `agy` Antigravity CLI，也不能证明两者使用同一 credit/quota pool；本页仅作为 Google Cloud 一般配额背景。
2. [Google Cloud Service Infrastructure — Troubleshooting](https://docs.cloud.google.com/service-infrastructure/docs/troubleshooting)
   - 文档建议记录错误诊断并使用退避；
   - “quota 429 最小 30 秒”具体针对 Service Control API，不是 Cloud Code `v1internal` 的服务承诺；本插件只能把它当作保守 fallback 的参考。
3. [Google Cloud IAM — Retry strategy](https://docs.cloud.google.com/iam/docs/retry-strategy)
   - 指数退避与 jitter 的通用算法参考；最终仍优先使用 Cloud Code 实际返回的 RetryInfo/Retry-After。
4. `google.rpc.Code.RESOURCE_EXHAUSTED` 的 HTTP 映射是 429；它只表明某种资源耗尽，不能单凭状态码或通用 message 区分账号 quota、project quota、credit pool、模型 admission、瞬时 rate limit 或系统容量。

### 公开文档边界

`daily-cloudcode-pa.googleapis.com/v1internal:*` 是内部接口，Google Cloud 公共文档不会承诺其 envelope、credit 类型、实验字段或模型 placeholder 的稳定性。因此：

- CLI/IDE 实际抓包是协议行为证据；
- Google Cloud 公共文档主要用于错误语义、配额作用域和重试原则；
- 插件必须通过 fixture 和 feature flag 管理内部协议变动。

## 6. 决策点

实施前需要确认：

1. 是否批准先加入 Antigravity 内部的窄作用域只读诊断 seam，并在确有需要时再配套临时观察 bundle；推荐：是，不使用全局 fetch monkey-patch。
2. 是否在 no-retry/no-failover Gate 通过后，允许第一轮最多 6 个探索性真实请求；推荐：先离线确认 strict diff，再单独授权。
3. `enabledCreditTypes` 是否只在权威 `availableCredits` 明确返回时发送；推荐：是。
4. Hydrogen 默认输出候选是否把 65,536 作为 A/B 候选；推荐：是，但不先写死生产。
5. 是否将协议重构作为 1.2.0 RC；推荐：本地 diagnostic build 不发布，正式改造走 1.2.0 RC。
