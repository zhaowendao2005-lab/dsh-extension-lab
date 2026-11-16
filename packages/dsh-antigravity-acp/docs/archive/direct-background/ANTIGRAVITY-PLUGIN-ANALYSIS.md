> 历史研究存档，归档于 2026-11-15。原始来源：旧插件 docs/ANTIGRAVITY-PLUGIN-ANALYSIS.md。
> 本文保留当时的判断，部分结论已被后续证据修正，旧链接和临时路径未必仍有效。
> **当前实现请以[研究勘误](../../RESEARCH.md)及[整体设计](../../DESIGN.md)为准，不要直接执行存档命令。**

# Antigravity 直连插件：进一步调查与实现分析

> 决策前提（按你 17:30 的定调）：**走直连派**；伪装参照 Antigravity-Manager；**只有一个或几个号、个人使用、不轮询**，只有「多次失败」或「额度不够」才切号；额度显示**真实值**；必须和 DSH 统计插件（截图那张表）以及其它内设监控**口径完全对齐**，展示最真实的缓存情况。
>
> 证据来源：① DSH 0.2.2-rc.2 安装包内源码（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/…`，行号为实测）；② Antigravity-Manager v5.0.3 源码（`/tmp/ag-research/agm/src-tauri/src`，行号为实测）；③ LiZhenNet `dsh-antigravity` 构建产物（`/tmp/ag-research/lizhen/lib/index.js`，行号为实测）。

---

## 0. 结论先行

1. **技术可行性没有疑问**。DSH 的 `LlmAdapter` 只需要实现一个 `stream()`，我们完全可以在插件里直连 `v1internal:streamGenerateContent?alt=sse`，把 Gemini 原生 SSE 翻译成 DSH 的 `StreamChunk`。
2. **「伪装」的正解比市面攻略说的更简单**。最新版 Antigravity-Manager 反而**主动删除**了 `x-client-name` / `x-client-version` / `x-machine-id` / `x-vscode-sessionid` 这些头——因为官方 Hub 出站只有 `Content-Type` + `Authorization` + `User-Agent`。身份全部压在 **UA** 这一件东西上。
3. **「缓存不真实」的根因大概率不是上游，而是 usage 记账**。DSH 三个 token 桶是**互不重叠**的，命中率 = `cacheRead / (input + cacheRead + cacheWrite)`；而 Gemini 的 `promptTokenCount` **包含** `cachedContentTokenCount`。少做一次减法，命中率就会被系统性腰斩（90% → 47%，还刚好触发表格里 `<50%` 的「缓存未命中」徽标）。这一条比任何伪装都重要。
4. **单号/少号不需要轮询**，但「切号」和「重连」都会让缓存整体作废。方案是**粘性账号 + 冻结前缀 + system 消息 in-history 化**，把「变化的东西」全部挪到缓存的尾巴上。
5. **额度**只信 `loadCodeAssist` + `retrieveUserQuotaSummary` 返回的 `remainingFraction` / `resetTime`，其余（响应头、估算、本地计数）一律不信。

---

## 1. DSH 侧契约（这决定我们怎么写，实测）

### 1.1 「统计」表是怎么算出来的

`dsh-experimental-client-ui-stats/src/client/stats-usage.ts`：

```ts
// :26-29  上下文 = 三个不重叠的桶相加
export function contextTokens(usage) {
  if (!reported(usage)) return null
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}
// :63-69  命中率 = 命中 / 上下文
export function cacheHitRate(usage) {
  const context = contextTokens(usage)
  if (context === null || context <= 0) return null
  const read = cacheReadTokens(usage)          // :45-47  usage?.cacheReadTokens ?? null
  if (read === null) return null
  return Math.min(1, read / context)
}
```

- 每一步的「缓存命中%」= 该步 assistant 消息上报的 usage 直接算出，**插件报什么就显示什么，UI 不做任何二次校正**。
- turn 级命中率是 **token 加权**的 `ΣcacheRead / ΣcacheContext`（`stats-aggregate.ts:55-69`），只有同时有 read 与 context 的步参与加权。
- 表格里 `cacheHit < 0.5` 会挂「缓存未命中」徽标（`StatsTable.tsx:663-669`），tooltip 原文：「这一步的提示词几乎没命中缓存：进程重启、会话恢复后的第一次请求都是这样，输入按全价计」。

> 也就是说：**我们上报的数字 = 用户看到的「真实缓存」**。没有上游 API 能独立核对，只能靠我们记账正确。

### 1.2 TokenUsage 契约（`dsh-llm/src/types.ts:174-196`，逐字）

```
Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
sum of the three). Adapters whose providers fold cache hits into a total
prompt count (DeepSeek's `prompt_tokens`) subtract them out.
```

字段：`inputTokens`、`outputTokens` 必填；`totalTokens?`、`cacheReadTokens?`、`cacheWriteTokens?`、`reasoningTokens?` 可选。

### 1.3 token-meter 的硬校验（`dsh-token-meter/src/turn-usage.ts:81-124`）

这一步**会静默丢数据**，格式不对的 usage 直接 `return undefined`，表现是统计表某几列变空/命中率变空，而不是报错：

| 我们上报的组合 | 结果 |
|---|---|
| input + output，无 total / 无 read / 无 write | **丢弃**（`:109` 要求 read 与 write 必须同时存在才能推导 total） |
| input + output + read + **total**（无 write） | 通过（`:103` 只要求 `total - output ≥ input + read`） |
| input + output + read + write + total，且 `total - output ≠ input + read + write` | **丢弃**（`:104`） |
| `reasoningTokens > outputTokens` | **丢弃**（`:88`） |

结论：**我们的适配器必须自己算 `totalTokens`**，不要直接透传上游的 `totalTokenCount`（Gemini 的 total 是否含 thoughts 依赖版本，一旦口径不一致就整条被丢）。

### 1.4 适配器要实现的接口（`dsh-llm/src/types.ts:223-318`）

- **必须**：`async *stream(options: GenerateOptions): AsyncIterable<StreamChunk>`，最后依次吐 `{type:'usage'}` 与 `{type:'finish', reason}`（usage 必须在 finish 之前）。
- **强烈建议**：`listModels()`（模型目录 → 设置页/模型选择器）、`resolveModel()`（返回 `contextWindow`、`defaultMaxTokens`、`reasoning.efforts`）。
- **关键可选能力**（直接影响缓存，见 §3.5）：
  - `systemPromptUpdate: 'in-history'` —— 声明「中途变更的 system 提示词会放在历史里，模型仍能读到」。
  - `toolUpdate: 'in-history' | 'addition-only'` —— 声明工具集变更的方式。
- `GenerateOptions` 里有 `sessionId`（`types.ts:564-606`），这是上游会话/缓存键的天然种子。

### 1.5 一个必须解决的冲突：归因头

`dsh-llm/src/attribution.ts` 规定「每个 provider 的 HTTP 请求都必须带 `attributionHeaders()`」，其唯一内容是
`user-agent: deepseek-harness/<ver> (+https://github.com/deepseek-ai/deepseek-harness)`。
而 Antigravity 上游的硬规则是 **UA 必须含 `antigravity`，否则 403**（AGM `constants.rs:248-310` 实测）。

→ 两者不能同时满足，必须显式选一个（见 §9 决策 1）。参考：LiZhenNet 选择了「UA 伪装 + 额外加归因头」，它的 README 自己写的是「transport compatibility，不保证不被封」。

---

## 2. 伪装规格（照抄 Antigravity-Manager v5.0.3 的实测结论）

### 2.1 身份 = User-Agent，一行搞定

`modules/hub_version.rs:110-125`：

```
antigravity/hub/2.28.0 (aidev_client; os_type=windows; arch=amd64; cl=1008300195)
```

- `2.28.0` 与 `1008300195`（`constants.rs:221/225`）是**成对实抓**的 Windows 客户端指纹，不要单独改其中一个、也不要随机化。
- 三个平台（windows/macos/linux）的指纹**不同构**，AGM 干脆固定成这一套，牺牲一点「本机一致性」换取「一定不 403」。
- 版本门禁三条（`constants.rs:248-310`）：
  1. UA 不含 `antigravity` → 上游 403；
  2. UA 版本 < `4.3.0` → 被钳到 4.3.0；
  3. 以 `antigravity/hub/` 开头的 UA 原样放行；`gemini-3.8-flash-{low,medium,high}` 这类分段模型在旧 UA 上直接 404。

### 2.2 出站请求头只留三个（`proxy/upstream/client.rs:1391-1466`）

```
Content-Type: application/json
Authorization: Bearer <access_token>
User-Agent: antigravity/hub/2.28.0 (aidev_client; os_type=windows; arch=amd64; cl=1008300195)
```

- `x-goog-user-project: <projectId>` **只加在非内容请求**上；`generateContent` / `streamGenerateContent` 会把它删掉。
- Claude 模型额外加 `anthropic-beta: claude-code-20250219`。

### 2.3 反直觉的一点：不要加「客户端伪头」

`client.rs:1427-1444` 显式剥离客户端传来的：`user-agent`、`x-session-id`、`x-client-name`、`x-client-version`、`x-machine-id`、`x-vscode-sessionid`、`x-jeikcode*`，注释是「严格过滤客户端特征伪头，确保出站请求头 100% 对齐官方 Antigravity Hub」。

→ 网上流传的「注入四个 X-Client-* 头」是**旧版做法**，v5 已经反过来了。**加得越多，越不像官方**。

### 2.4 请求信封与键序（`pipeline/inbound.rs:2549-2706`）

```
{ project: "aicode-consumers", requestId, request, model, userAgent: "antigravity", requestType: "agent" }
```

- 键序固定：`project → requestId → request → model → userAgent → requestType`（JSON 序列化顺序跟缓存无关，但和「像不像官方」有关，照抄即可）。
- `requestType: "agent"` 只在**带 tools 或存在工具交互**时出现；`countTokens` 请求只允许 `request` 一个键。

### 2.5 requestId 格式（`mappers/common_utils.rs:2228-2266`）

```
agent/{conversationId}/{unixMs}/{trajectoryId}/{step}
conversationId = sha256(sessionId)[:16]（hex）
trajectoryId   = uuid[:8]
unixMs         = 每次请求都不同
```

- 「每次请求都不同」是**故意的**：避免重试时命中上游缓存的旧 429/旧响应（幂等隔离）。
- 因此 **requestId 不能进 prompt、不能参与缓存键**，它只是请求标识。

### 2.6 端点顺序与重试语义（`proxy/upstream/client.rs`）

```
daily-cloudcode-pa.googleapis.com  →  daily-cloudcode-pa.sandbox.googleapis.com  →  cloudcode-pa.googleapis.com
```

- URL 构造：`{base}:{method}`，模型名放 body（不是路径）。
- **只有** 408 / 404 / 5xx 才换端点；400 / 401 / 403 / 429 **直接终止**（换端点只会让问题更糟）。
- AGM 另有 5xx 后 20s 隔离、解析 `quotaResetDelay`（毫秒）决定该号冷却时长。

### 2.7 我们**不**照抄的部分

- **JA3/JA4 TLS 指纹伪造**（AGM 用 `rquest` + BoringSSL 复刻 Chrome 123）：Node 的 `fetch`/`undici` 做不到，要上原生模块或换运行时，成本和风险都不划算。先不做，观察是否出现「同一 UA 下别的客户端能用、我们不能」的差异。
- **Docker 版指纹回落**：我们是本机桌面端，不需要。

---

## 3. 缓存：从「看起来掉」到「真的不掉」

### 3.1 Gemini 的 usage 语义（这是最容易错的一处）

`usageMetadata` 中：
- `promptTokenCount`：**整个 prompt**（含被缓存的部分）；
- `cachedContentTokenCount`：其中**命中缓存**的部分；
- `candidatesTokenCount`：输出（不含思考）；
- `thoughtsTokenCount`：思考 token（单独计）；
- `totalTokenCount`：总消耗。

映射到 DSH 的三桶（必须做减法 + 自算 total）：

```ts
function mapUsage(u: UsageMetadata): TokenUsage {
  const cached  = u.cachedContentTokenCount ?? 0
  const prompt  = u.promptTokenCount ?? 0
  const input   = Math.max(0, prompt - cached)        // ← 唯一的减法，别漏
  const thoughts = u.thoughtsTokenCount ?? 0
  const output  = (u.candidatesTokenCount ?? 0) + thoughts
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cached,                           // 0 也照报（见 §3.2）
    totalTokens: input + cached + output,              // 自算，保证与三桶自洽
    ...(thoughts > 0 ? { reasoningTokens: thoughts } : {}),
  }
}
```

- **不要**透传 `totalTokenCount`：万一它不含 thoughts，`totalTokens - outputTokens < input + cached` → 整条 usage 被丢（`turn-usage.ts:103`）。
- **不要**填 `cacheWriteTokens`：Gemini 没有「写缓存」计费桶，填 0 反而会触发 `:104` 的一致性校验。

### 3.2 错一次会怎样（真实数字）

假设 prompt 100,000、命中 90,000：

| 上报方式 | 上下文列 | 命中率 | 用户看到 |
|---|---|---|---|
| 正确（input 10k + read 90k） | 100k | **90%** | 正常 |
| 错误 A：`inputTokens = promptTokenCount`（190k 上下文） | 190k | **47.4%** | 挂着「缓存未命中」徽标（<50%），像是掉缓存了 |
| 错误 B：不报 `cacheReadTokens` | 100k | 空 | 这一列留白，turn 加权还少一步 |
| 错误 C：不报 totalTokens 且无 cacheWrite | 整条丢弃 | — | 「上下文/输出」直接空 |

**用户截图里那些「缓存未命中」，很可能一部分是记账错，而不是真掉缓存。** 这也是为什么你要求「最真实」。

`cacheReadTokens: 0` 的取舍：显式报 0 → 显示 0% 并挂徽标（真实但刺眼）；省略 → 单元格留白（`stats-usage.ts:45-47` 返回 null）。**建议显式报 0**，因为「真的没命中」和「没测到」是两件事，前者恰恰是你想看见的。

### 3.3 前缀稳定性检查清单（每条对应一个「掉缓存」的真实原因）

| # | 敌人 | 对策 | 依据 |
|---|---|---|---|
| 1 | 换号 | 粘性账号：`sessionId → accountId` 固定映射，只有 §5 的条件才切 | 换号＝换缓存域，必全冷 |
| 2 | 上游会话 id 每次新建 | 用 DSH 的 `options.sessionId` 派生 conversationId，**跨进程稳定** | AGM `conversationId=sha256(session_id)[:16]` |
| 3 | 中途 system 消息改写前缀 | `systemPromptUpdate:'in-history'` + 包成 `<system-reminder>` user 块 | AGM `common_utils.rs:2268` |
| 4 | 工具声明顺序抖动 | 严格按 DSH 给的 `tools` 顺序，不重排、不裁剪、不 pretty-print | 工具声明属于缓存前缀 |
| 5 | 往 prompt 里塞时间戳/随机数 | 时间由 DSH 的 `time-context` 以**user 消息**追加（已实测），适配器绝不碰 | `dsh-time-context/src/index.ts` |
| 6 | 每请求新建连接 | keep-alive 复用（顺带降 TTFT） | 连接重建不影响前缀，但影响首包 |
| 7 | 图片/附件编码不稳定 | 同一附件复用同一 base64（不做重复压缩/重编码） | — |
| 8 | 上下文压缩策略激进 | 只在 DSH 主动 compaction 时跟随；不要自己偷偷截断工具结果 | 截断＝改前缀 |
| 9 | 并行 subagent 抢同一号 | 少号时**串行**或让 subagent 复用主号（各自前缀不同，冷启动可接受） | — |
| 10 | 上报口径不一致 | read 只报 `cachedContentTokenCount`，绝不把 total 当 read | §3.1 |
| 11 | 重启进程 | 无法避免；首个请求冷启动是正常现象，tooltip 已这么解释 | `locales.ts:95-96` |
| 12 | 会话恢复后重发历史 | 恢复后首请求冷启动正常；不要为「预热」额外发请求 | — |

### 3.4 Antigravity-Manager 的三层缓存（可借鉴的只有第一层）

`cache_manager.rs`：L1 `systemInstruction` 清洗、L2 `tools` 处理、L3 prefix tracker + `cachedContent` 注入（TTL 30min/1h，LRU 200/100/500）。

但**全仓 grep 不到真正的 `cachedContent` 注入实现**——它实际仍靠「隐式前缀缓存」（即不改前缀，让 Google 自己命中）。真正的杀手锏是 L1 那条 `wrap_in_system_reminder`：

> 把对话中途出现的 system 级消息包成英文 `<system-reminder>…</system-reminder>` 的 user 块，注释写明「保证全局顶层 `systemInstruction` 保持绝对冻结以稳定 KV Cache」。

这正是 DSH 的 `systemPromptUpdate: 'in-history'` 想要的语义，我们直接照搬。

### 3.5 DSH 侧可用的两个「免掉缓存」杠杆

1. **`systemPromptUpdate: 'in-history'`**：声明后，DSH 遇到中途 system 变化会把新提示词作为历史块给出，而不是重写开头。我们必须声明，否则每次 plan 模式切换/技能加载都会把 message[0] 改掉 → 全量重算。
2. **`toolUpdate`**：`'in-history'` 或 `'addition-only'`。Gemini 的 `functionDeclarations` 是请求级声明，动态增删工具会改前缀 → 冷。建议一期就**冻结工具集**（把工具声明当常量），二期再考虑把新增工具描述写进 user 块。

---

## 4. 额度（要真实）

- `POST {base}:loadCodeAssist`，body `{metadata:{ideType:"ANTIGRAVITY"}}` → 返回 `cloudaicompanionProject`、`currentTier`、`paidTier`、`allowedTiers`。**这里拿 project 与套餐等级**。
- `POST {base}:retrieveUserQuotaSummary` → 结构（AGM `modules/quota.rs:78-105`）：

```json
{ "groups": [ { "displayName": "...", "description": "...",
  "buckets": [ { "bucketId": "5h", "window": "...", "remainingFraction": 0.62,
                 "resetTime": "2026-11-13T22:00:00Z", "displayName": "...", "description": "..." } ] } ] }
```

- 展示口径：**按 group 分组**（Gemini 池 / Claude+GPT 三方池是不同额度池，不能合并成一个百分比），每桶显示「剩余 %」+「重置倒计时」。
- 只在 `remainingFraction` **明确存在**时才显示数字；缺失就是未知，不要估算。
- 阈值：`< 15%` 警告、`≤ 5%` 视为不可用（与市面 `soft_quota_threshold_percent: 90`（已用 90%）等价，换算成剩余 10%）。
- 额度查询失败 **fail-open**：不阻塞对话，只在 UI 标「额度未知」。

---

## 5. 多账号：粘性，不轮询

状态机（每个 session 独立）：

```
选中账号 A  ──(连续 N 次同类失败 / 额度耗尽 / 用户手动)──→ 切换 B（记录原因+时间）
     ↑                                                      │
     └──────────(A 冷却结束 且 用户允许回切)─────────────────┘
```

- **不轮询**：正常请求永远打 A。单次 429 只做有限重试（≤2 次，指数退避），**不换号**——换号立刻丢缓存。
- 切号触发条件（三者之一）：
  1. 同一账号连续 3 次失败，且错误分类为 `AUTH` / `QUOTA_EXCEEDED` / `RATE_LIMIT`（`INVALID_REQUEST` 和 `TRANSPORT` 不换号）；
  2. 额度剩余 ≤ 5%（判定不可用）；
  3. 用户手动切换。
- 切号成本要在 UI 里明说：「切号后前几步缓存命中会掉到 0」，避免用户误以为是插件坏了。
- 每个账号独立存储：`refreshToken`、`projectId`、`email`、`disabled`、`lastUsed`、`cooldownUntil`。文件权限 0600，token 只进主进程内存。

---

## 6. 与 DSH 监控生态的兼容清单（你特别强调的那部分）

| 监控点 | 谁提供 | 我们要做什么 |
|---|---|---|
| 统计表「上下文 / 输出」 | adapter 的 `usage` | 按 §3.1 映射，三桶 disjoint + 自算 total |
| 统计表「缓存命中%」/ 徽标 | 同上 `cacheReadTokens` | 只在 `cacheReadTokens` 明确存在时报；0 也报 |
| turn 加权命中率 | `turn-usage.ts` | 保证每次 attempt 的 usage 都合法（否则该次被剔除，加权失真） |
| 首 token / 输出速度 / 模型用时 | DSH 自己计时 | 不用管；但**不要在 stream 里攒一大块再发**，会让首 token 时间虚高 |
| 上下文条 / 模型选择器 | `resolveModel().context` | 从 `fetchAvailableModels` 的 `maxTokens` 填 `contextWindow` |
| 思考强度选择 | `resolveModel().reasoning` | 把 `thinkingLevel`/`thinkingBudget` 映射成 `efforts` |
| 成本估算 | provider pricing | 可选：`imageRequestPricing` 之类，先不做 |
| 会话 replay / 工具签名 | `finish.replayState` | 必须回传 `thoughtSignature`/`textSignature`，否则下一轮工具调用 400 |

> 一句话：**统计插件不是「要适配的目标」，它是我们上报数据的一面镜子**。把它当验收标准，我们的 usage 就必须一个字都不差。

---

## 7. 实现方案

### 7.1 包结构

```
packages/dsh-antigravity/
  package.json            # @dsh-extension-lab/dsh-antigravity
  src/
    index.ts              # export function apply(ctx) { ctx.llm.registerAdapter(['antigravity'], new AntigravityAdapter(...)) }
    adapter.ts            # LlmAdapter：stream / listModels / resolveModel / prepareCall
    identity.ts           # UA 常量、header 组装、requestId、conversationId
    oauth.ts              # PKCE + loopback 回调 (127.0.0.1:51121)
    client.ts             # SSE 读取、端点回退、错误分类
    translate.ts          # GenerateOptions → v1internal body；SSE → StreamChunk
    usage.ts              # mapUsage（§3.1），单独成文件便于单测
    replay.ts             # thoughtSignature 存取
    catalog.ts            # fetchAvailableModels + 静态兜底
    quota.ts              # loadCodeAssist + retrieveUserQuotaSummary
    accounts.ts           # 账号存储、粘性选择、冷却、切换状态机
    settings.tsx          # 设置页：账号、额度、缓存命中趋势
```

### 7.2 里程碑（每步都能独立验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | OAuth + 非流式打通 + `mapUsage` 单测 | 一次对话能跑完；统计表「上下文/输出/缓存命中」三列**都有数**，且命中率与实际缓存量吻合 |
| M2 | SSE 流式 + `thoughtSignature` 回传 | 多轮工具调用不 400；首 token 时间正常 |
| M3 | 伪装对齐（UA/头/信封/requestId/端点回退） | 出站抓包与 §2 逐字节一致（除 token） |
| M4 | 额度 + 多账号 + 粘性切换 | 额度数字与官方面板一致；切号后 UI 有明确提示 |
| M5 | 设置页 + 缓存趋势 + 兼容性回归 | 统计表连续 5 轮命中率稳定在合理区间 |

### 7.3 测试策略（按仓库规矩，先报计划等你批）

> 计划：① `usage.ts` / `identity.ts` 纯函数单测（覆盖 §3 的 4 种错配与 §2 的 UA 规则）；② 用录制的 SSE fixture 跑 `translate.ts` 回归；③ 手动跑一轮真实对话，对照统计表截图验收。预计 1.5h，不动现有包。

---

## 8. 风险（不粉饰）

| 风险 | 说明 | 缓解 |
|---|---|---|
| 账号风险 | 直连私有端点 + 伪装 UA，属于明确违反 Google 条款；已有实现报告「影子封/封号」 | 只用于自己的号；失败即停，不做风控对抗 |
| 伪装失效 | 上游随时可能换指纹（AGM 每次更新都在追版本） | 把 UA 做成配置项 + 启动自检（403 时提示） |
| 归因冲突 | 伪装 UA 与 DSH 归因契约冲突 | §9 决策 1 显式选择 |
| 缓存不可控 | 隐式前缀缓存的上游实现不透明 | 只保证「前缀不变」，并如实展示命中率，不承诺命中有多少 |
| 统计口径漂移 | DSH 升级可能改 `TokenUsage` 语义 | `usage.ts` 单测 + 升级后跑一次对照 |

---

## 9. 需要你拍板的 4 件事

1. **归因头怎么处理？**
   - A：完全照 DSH 契约（带 `deepseek-harness` UA）→ 上游 403，不可行；
   - B（**建议**）：UA 用 Antigravity 指纹，另加一个独立归因头（LiZhenNet 做法），并在设置页写明「非官方通道」；
   - C：完全伪装，不加任何归因（最像官方，但违背 DSH 契约）。
2. **模型范围？** 建议一期只做 Gemini（协议最干净）；Claude/GPT 需要 `anthropic-beta`、schema 归一化、thoughtSignature 验签，二期再上。
3. **额度 UI 放哪？** 设置页内嵌（简单）还是状态栏常驻（需要 host 能力）？
4. **要不要做 TLS 指纹（JA3）？** 建议先不做，等出现「同 UA 别人能用我们不能」再考虑。

---

*本文所有「实测」行号均可在 `/tmp/ag-research/agm`（Antigravity-Manager 源码）与 DSH 安装包内对照复现；`/tmp` 会被清理，如需长期保留证据可移入仓库 `docs/research/`。*
