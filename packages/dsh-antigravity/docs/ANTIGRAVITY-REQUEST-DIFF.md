# Antigravity Direct 插件 vs Antigravity CLI：同一次模型调用的请求差异（MITM 实证）

> 抓包时间 2026-11-14 23:25–23:35（Asia/Shanghai）｜环境 macOS arm64｜账号 `zhangxh573@gmail.com`｜project `aicode-consumers`
> 上游端点：`https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
> 机器生成的逐项对照：[REPORT-DIFF.md](REPORT-DIFF.md)｜原始 flow（本地忽略）：`capture/flows-cli.mitm`、`capture/flows-plugin.mitm`、`capture/flows-plugin-aux.mitm`、`capture/flows-cli2.mitm`

---

## 0. 结论先行

两条路走的是**同一个端点、同一套 envelope、同样的 SSE 响应**，都拿到 `200`，`modelVersion` 都是 `gemini-3.8-flash-n`。
也就是说：**协议骨架是兼容的，差异全部落在"身份/元数据"层，不在"请求能力"层。**

差异按重要性排：

| # | 差异 | 方向 | 本次是否仍 200 |
|---|---|---|---|
| 1 | User-Agent 自称不同：CLI `antigravity/cli/1.5.9 … auth_method=consumer` vs 插件 `antigravity/hub/2.28.0 …`（无 `auth_method`） | 插件冒充 IDE 侧 hub | ✅ |
| 2 | 插件多出 4 个 fetch/undici 默认头（`accept`、`accept-language`、`sec-fetch-mode: cors`、`connection: keep-alive`）；CLI 一个都没有 | 运行时指纹 | ✅ |
| 3 | 请求体 framing：CLI `Transfer-Encoding: chunked`，插件 `content-length` | 运行时指纹 | ✅ |
| 4 | envelope 少 `enabledCreditTypes: ["GOOGLE_ONE_AI"]` | 计费/credit 归类 | ✅ |
| 5 | `labels` 少 `cascade_id` / `root_cascade_id`；`model_enum` 发公开 id 而非 `MODEL_PLACEHOLDER_M320` | 观测/路由元数据 | ✅（路由未受影响） |
| 6 | `generationConfig` 少 `maxOutputTokens: 65536`（插件只有调用方传 `maxTokens` 才发） | 输出上限，改由服务端默认值决定 | ✅ |
| 7 | `sessionId` 取值不同：CLI 是**常量** `-3750763034362895579`（= FNV-1a64("")），插件是 `FNV-1a64(accountId\|sessionId\|0)` | 会话标识 | ✅ |
| 8 | `requestId` 里 conversation/trajectory 段：CLI 用 UUID，插件用 sha256 截断的 16hex/8hex | 会话标识 | ✅ |
| 9 | 辅助端点：CLI 还发 `fetchUserInfo`/`fetchAdminControls`/`listExperiments`/`aicode:fetchConfig`/`recordTrajectoryAnalytics`/`play.log`；插件只发 4 个必要端点 | 埋点/实验 | 未发即无 |

**唯一可能被服务端真正区别对待的是第 1 项（UA 自称 hub 而非 cli）和第 4 项（credit 类型）**；其余属于"格式不同但被接受"。

---

## 1. 实验设置（含诚实边界）

### 1.1 为什么不是"真跑一个 DSH 会话"

- 当前宿主 DSH 的 `desktop` profile 被 Electron 独占（`dsh --profile desktop headless` 直接报 `profile "desktop" is managed exclusively by the Electron application`）；
- `web` profile（`~/.dsh/profiles/web`）**没有安装** `dsh-antigravity`，起 headless web 宿主发不出 Antigravity 请求。

因此改用 **harness 直接加载插件宿主源码**驱动：`capture/plugin-request.mjs` 用 `packages/dsh-antigravity/test/helpers/load-host.mjs`（esbuild 现场编译 `src/host/*.ts`）加载 `AntigravityService`，调用与 DSH 宿主完全相同的入口：

```js
const service = new AntigravityService(normalizeConfig({}));
for await (const chunk of service.adapter.stream({ provider:'antigravity', model, reasoningEffort, system, messages, tools, sessionId })) …
```

依据：`packages/dsh-antigravity/lib/index.js`（160739 B）与已安装副本 `~/.dsh/profiles/desktop/node_modules/dsh-antigravity/lib/index.js` **字节完全相同**，即 harness 驱动的就是宿主实际跑的代码。凭证直接复用 `~/.dsh/antigravity/accounts.json`（同一账号、同一 access token 体系）。

> 边界：抓的是"插件代码真实发出的线上请求"，不是"某次 dsh 会话的完整上下文"。systemPrompt/工具集由 harness 给定，与真实 dsh 会话的 prompt 内容不同（不影响本次要对比的协议字段）。

### 1.2 三条抓包链路

| 链路 | 客户端 | 代理方式 |
|---|---|---|
| CLI | `~/.local/bin/agy` 1.5.8（UA 自称 1.5.9） | `HTTPS_PROXY` + `SSL_CERT_FILE=<mitm CA>`（Go net/http 原生支持） |
| 插件 | `node capture/plugin-request.mjs` | `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1` + `NODE_EXTRA_CA_CERTS=<mitm CA>`（Node 24 全局 fetch/undici） |
| 抓包器 | mitmproxy 12.3.1，`:8899`，`confdir=$HOME/.mitmproxy` | — |

### 1.3 样本

| 样本 | 命令 | 结果 |
|---|---|---|
| CLI #1 | `agy -p "Reply with exactly: OK" --model gemini-3.8-flash-low --output-format json` | `SUCCESS`，in 9568 / out 1 |
| CLI #2 #3 | 同上，prompt 换 `RUN1`/`RUN2` | `SUCCESS`，用于验证 `sessionId` 是否为常量 |
| 插件 | `node plugin-request.mjs --model gemini-3.8-flash --effort low --prompt "Reply with exactly: OK"` | `OK`，in 41 / out 1 |

型号对齐：插件 `model=gemini-3.8-flash` + `reasoningEffort=low` → 上行 `model=gemini-3.8-flash-low`（`src/host/catalog.ts:207`），与 CLI `--model gemini-3.8-flash-low` 完全一致，这是能对比的前提。

---

## 2. 端点全景

| endpoint | CLI | 插件 |
|---|---|---|
| `GET www.googleapis.com/oauth2/v2/userinfo` | 2× | — |
| `GET aicode.googleapis.com/v1alpha:fetchConfig` | 3× | — |
| `POST …:loadCodeAssist` | 4× / 38 B | 1× / **83 B** |
| `POST …:fetchAdminControls` | 1× / 30 B | — |
| `POST …:retrieveUserQuotaSummary` | 4× / 30 B | 1× / 30 B |
| `POST …:fetchUserInfo` | 2× / 30 B | — |
| `POST …:fetchAvailableModels` | 1× / 30 B | 1× / 30 B |
| `POST …:listExperiments` | 1× / 30 B | — |
| `POST …:writeTrajectoryAcls` | 1× / 55 B | 2× / **27 B** |
| `POST …:streamGenerateContent?alt=sse` | 1× / 41 933 B | 2× / 846 B |
| `POST …:recordTrajectoryAnalytics` | 1× / 116 041 B | — |
| `POST play.googleapis.com/log`（遥测） | 4×（最大 569 156 B） | — |

> 计数说明：插件侧 `streamGenerateContent` / `writeTrajectoryAcls` 各 2×，是两次 harness 运行（内容请求一次 + `--aux` 刷新一次）叠加，不是重试。

结论：**插件只实现了"能跑通模型调用"的最小端点集**；CLI 是一个完整 agent 运行时，带实验开关、admin controls、轨迹分析上报和 GFE 遥测。

---

## 3. 传输层（HTTP）

| 项 | CLI | 插件 | 说明 |
|---|---|---|---|
| method / path / query | `POST /v1internal:streamGenerateContent?alt=sse` | 同 | 完全一致 |
| 主机 | `daily-cloudcode-pa.googleapis.com` | 同 | 都命中第一个端点，没触发 fallback 链 |
| HTTP 版本 | `HTTP/1.1` | `HTTP/1.1` | 一致 |
| `Content-Type` | `application/json` | 同 | 一致 |
| `Accept-Encoding` | `gzip` | 同 | 一致 |
| `Authorization` | `Bearer ya29…`（267 字符） | 同量级 | 同账号体系 |
| `User-Agent` | `antigravity/cli/1.5.9 (aidev_client; os_type=darwin; arch=arm64; cl=1021519450; auth_method=consumer)` | `antigravity/hub/2.28.0 (aidev_client; os_type=darwin; arch=arm64; cl=1008300195)` | **自称客户端类型不同**：`cli` vs `hub`；`cl` 值不同；CLI 多 `auth_method=consumer` |
| 额外头 | 无 | `accept: */*`、`accept-language: *`、`sec-fetch-mode: cors`、`connection: keep-alive` | undici/fetch 默认头，Go 客户端不发 |
| body framing | `Transfer-Encoding: chunked`（无 content-length） | `content-length: 846` | Go 边编码边发 vs fetch 一次性发送 |
| `x-goog-user-project` | 无 | 无 | 两边都因为 project=`aicode-consumers` 而省略（`src/host/identity.ts:145` 的 buildOutboundHeaders 只在非内容请求且 project 不同才加） |

UA 相关实现：`src/host/identity.ts:10-11` 定义 `OFFICIAL_HUB_VERSION='2.28.0'`、`OFFICIAL_HUB_CL='1008300195'`；`:77` `buildHubUserAgent()`。插件**没有** cli 指纹与 `auth_method` 字段。

---

## 4. envelope 层（request 之外的顶层键）

| 字段 | CLI | 插件 | 备注 |
|---|---|---|---|
| `project` | `aicode-consumers` | 同 | ✅ |
| `requestId` | `agent/f6407b90-7118-40d2-8dc1-571351abb5cc/1794670464635/8ea57ba3-80c0-41a4-9c42-43e27d0e2fb9/1` | `agent/3a99bf60c029e97f/1794670158541/b1347d0f/1` | **5 段结构一致**；段 2/4 形态不同（UUID vs 16hex/8hex） |
| `model` | `gemini-3.8-flash-low` | 同 | ✅ |
| `userAgent` | `antigravity` | 同 | ✅（注意这里是 envelope 里的短标识，与 HTTP 头 UA 无关） |
| `requestType` | `agent` | 同 | ✅ |
| `enabledCreditTypes` | `["GOOGLE_ONE_AI"]` | **缺失** | 插件 src 里 grep 不到该键 |

`requestId` 生成逻辑：`src/host/identity.ts:219-233` `buildOfficialRequestId()` → `agent/{sha256(sessionId)[0:16]}/{Date.now()}/{sha256[0:8]}/{step}`。CLI 侧用会话 UUID。

---

## 5. request 层（字段级）

`request` 的键序与键集**完全一致**：`contents, systemInstruction, tools, labels, generationConfig, sessionId`。

### 5.1 `labels`

```jsonc
// CLI
{ "cascade_id": "f6407b90-7118-40d2-8dc1-571351abb5cc",
  "last_step_index": "0",
  "model_enum": "MODEL_PLACEHOLDER_M320",
  "request_id": "8ea57ba3-80c0-41a4-9c42-43e27d0e2fb9-0",
  "root_cascade_id": "f6407b90-7118-40d2-8dc1-571351abb5cc",
  "trajectory_id": "8ea57ba3-80c0-41a4-9c42-43e27d0e2fb9",
  "used_claude": "false", "used_claude_conservative": "false", "used_non_gemini_model": "false" }

// 插件（src/host/translate.ts:577-586）
{ "last_step_index": "0",
  "model_enum": "gemini-3.8-flash-low",
  "request_id": "b1347d0f-0",
  "trajectory_id": "b1347d0f",
  "used_claude": "false", "used_claude_conservative": "false", "used_non_gemini_model": "false" }
```

- 插件**缺** `cascade_id` / `root_cascade_id`（源码里无此键）；
- `model_enum`：CLI 发上游内部枚举 `MODEL_PLACEHOLDER_M320`，插件发公开 id。插件在 `catalog.ts:74` 主动过滤 `MODEL_PLACEHOLDER_*`，全 src 搜不到该枚举，属有意设计；
- 但**路由未受影响**：两路响应 `modelVersion` 都是 `gemini-3.8-flash-n`。

### 5.2 `generationConfig`

| 键 | CLI | 插件 |
|---|---|---|
| `maxOutputTokens` | `65536` | **缺失** |
| `thinkingConfig` | `{"includeThoughts":true,"thinkingLevel":"LOW"}` | 完全相同 |

原因在 `src/host/translate.ts:591-592`：只有调用方传了 `options.maxTokens` 才写 `maxOutputTokens`。DSH 宿主在本次调用里没传（harness 也未传），所以线上没有。插件目录里其实有 `defaultMaxTokens=65_536`（`catalog.ts:675`）但没用于请求。

### 5.3 `sessionId`

两边都是 int64 十进制字符串，但来源完全不同：

| | 值 | 含义 |
|---|---|---|
| CLI | `-3750763034362895579`（3 次独立会话**全部相同**） | 恰好等于 `0xCBF29CE484222325` = **FNV-1a 64 位 offset basis** → 说明 CLI 对**空字符串**做哈希（`-p` 一次性模式下无持久会话种子） |
| 插件 | `5690180753864177140` | 已数值验证 = `FNV-1a64("020c3454-…fe73\|labcapture…0001\|0")`，即 `accountId\|sessionId\|generation`（`src/host/identity.ts:240-264`） |

值得注意：**两边用的是同一套 FNV-1a 64 算法（同 offset basis、同 prime 1099511628211）**，插件是把 CLI/AGM 的算法照搬过来的，只是种子不同。CLI 在一次性模式下种子为空，插件用 DSH 会话 id 做种子（每个 DSH 会话一个稳定值）。

### 5.4 `contents` / `systemInstruction` / `tools`（结构同、内容不同）

| 项 | CLI | 插件 |
|---|---|---|
| `contents` 结构 | `[{role:"user", parts:[{text}]}]` | 同 |
| user 文本 | 外面包了 `<USER_REQUEST>…</USER_REQUEST>` + `<ADDITIONAL_METADATA>`（本地时间）+ `<USER_SETTINGS_CHANGE>` 脚手架 | 原样透传调用方文本 |
| `systemInstruction` | `{role:"user", parts:[{text: ≈20 KB}]}`（Antigravity 自身系统提示，含 workspace/会话 id/appdata 路径等 `<user_information>`） | `{role:"user", parts:[{text}]}`，本次 69 B |
| `tools` | **14 个** `{functionDeclarations:[单个]}` 对象，共 20 925 B | **1 个** `{functionDeclarations:[…]}`，176 B（`translate.ts:279-287` 把所有工具合并进一个对象） |
| schema 类型大小写 | `OBJECT/STRING/INTEGER`（大写） | 同（`cleanJsonSchemaForGemini`，`translate.ts:157`，把 `object` 归一为大写 `OBJECT`） |

这些差异是"prompt/工具集不同"，不是协议差异；但直接导致 token 数不可比（CLI 9568 vs 插件 41）。

---

## 6. 响应层：完全一致

| 项 | CLI | 插件 |
|---|---|---|
| status | `200` | `200` |
| 响应头 | `Content-Type: text/event-stream`、`Content-Disposition: attachment`、三组 `Vary`、`Server: ESF`、`Alt-Svc: h3…` | **逐项相同**，仅 `date` 与 `server-timing` 数值不同 |
| SSE 帧 | 2 帧：`{response:{candidates:[{content:{role:"model",parts:[{text:"OK"}]}}],usageMetadata,modelVersion,responseId}, traceId, metadata:{}}` + 一帧 `thoughtSignature`（`finishReason:"STOP"`） | **同结构、同帧数** |
| `modelVersion` | `gemini-3.8-flash-n` | `gemini-3.8-flash-n` |
| usage | prompt 9568 / candidates 1 / total 9569 | prompt 41 / candidates 1 / total 42 |

→ 上游对两路的处理路径没有可见差异。

---

## 7. 辅助端点差异

| endpoint | 请求体对比 |
|---|---|
| `loadCodeAssist` | CLI `{"metadata":{"ideType":"ANTIGRAVITY"}}`（38 B）<br>插件 `{"cloudaicompanionProject":"aicode-consumers","metadata":{"ideType":"ANTIGRAVITY"}}`（**83 B，多带 project**） |
| `fetchAvailableModels` | 两边都是 `{"project":"aicode-consumers"}` |
| `retrieveUserQuotaSummary` | 两边都是 `{"project":"aicode-consumers"}` |
| `writeTrajectoryAcls` | CLI `{"trajectoryId":"8ea57ba3-80c0-41a4-9c42-43e27d0e2fb9"}`（UUID）<br>插件 `{"trajectoryId":"b1347d0f"}`（8 hex） |
| 仅 CLI | `oauth2 userinfo`、`fetchUserInfo`、`fetchAdminControls`、`listExperiments`、`aicode:v1alpha:fetchConfig`、`recordTrajectoryAnalytics`（116 KB）、`play.googleapis.com/log`（4 次，最大 569 KB） |

CLI 的 `fetchConfig`/`listExperiments`/`fetchAdminControls` 是功能开关与实验分组；`recordTrajectoryAnalytics` + `play.log` 是轨迹与 GFE 埋点。插件全都没有。

---

## 8. 风险与判断

1. **UA 是最大的"身份差异"**。插件自称 `antigravity/hub/2.28.0`（AGM 系客户端的指纹），CLI 自称 `antigravity/cli/1.5.9 … auth_method=consumer`。若服务端按 client 类型发放能力/限流/credit，这是最可能被区别对待的点。本次 `gemini-3.8-flash-low` 两路均可用，**未观察到差别对待**。
2. **`enabledCreditTypes` 缺失**：CLI 明确声明走 `GOOGLE_ONE_AI` credit。缺这个字段是否影响计费归类/额度扣减口径，本次无证据（usage 正常返回）。
3. **`labels.model_enum` 用公开 id**：已验证不改变路由（同 `modelVersion`），但后台统计里会把两路归到不同 model 维度。
4. **`sessionId` 语义不同**：CLI 一次性模式发常量（空种子哈希），插件发每会话稳定哈希。若服务端用它做隐式缓存/粘性，插件的行为其实更"正常"，但仍与 CLI 不一致——CLI 的常量更像"没有会话上下文"的退化值，不宜照抄。
5. **`recordTrajectoryAnalytics`/`play.log` 缺失**：纯埋点，无功能影响证据；但会让后台看不到插件的轨迹分析数据。
6. **多出的 fetch 默认头 + chunked 差异**：可被指纹识别为"非 Go 官方客户端"，但不会被业务拒绝（200 正常）。

## 9. 如果要把插件调得更像 CLI（可选，按性价比排序）

1. `identity.ts:77 buildHubUserAgent()` 增加 `cli` 指纹 + `auth_method=consumer` 变体（一行常量的事，收益最大）；
2. `client.ts` 发请求时剥掉 undici 默认头 `accept` / `accept-language` / `sec-fetch-mode`（`connection` 可留），并可选改成 chunked 上传；
3. `translate.ts:577-586` 的 labels 补 `cascade_id` / `root_cascade_id`；`model_enum` 若要完全对齐需在 catalog 里保留 `MODEL_PLACEHOLDER_*` 映射（当前被 `catalog.ts:74` 主动丢弃）；
4. envelope 补 `enabledCreditTypes:["GOOGLE_ONE_AI"]`（需按 tier 判断，Free 账号多半不同）；
5. `translate.ts:591` 默认用 `defaultMaxTokens`（65536）填充 `maxOutputTokens`，与 CLI 一致。

（是否值得做取决于目标是"兼容可用"还是"指纹级仿真"；当前证据下，除非要绕风控，前 2 条收益最高、风险最低。）

## 10. 复现

```bash
# 0) 起抓包器（顺序敏感：先 rm 再起，mitmdump 启动即打开 -w 文件）
~/.local/bin/mitmdump --listen-port 8899 --set confdir=$HOME/.mitmproxy -w capture/flows-x.mitm --flow-detail 0

# 1) CLI
HTTPS_PROXY=http://127.0.0.1:8899 HTTP_PROXY=http://127.0.0.1:8899 NO_PROXY=127.0.0.1,localhost \
SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \
~/.local/bin/agy -p "Reply with exactly: OK" --model gemini-3.8-flash-low --output-format json

# 2) 插件宿主代码
HTTPS_PROXY=http://127.0.0.1:8899 HTTP_PROXY=http://127.0.0.1:8899 NO_PROXY=127.0.0.1,localhost \
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \
node capture/plugin-request.mjs --model gemini-3.8-flash --effort low --prompt "Reply with exactly: OK" [--aux]

# 3) 导出 + 对照
~/.local/share/uv/tools/mitmproxy/bin/python capture/dump_flows.py capture/flows-x.mitm --full --out capture/x-flows.jsonl
python3 capture/compare.py > capture/REPORT-DIFF.md
```

| 产物 | 内容 |
|---|---|
| [capture/plugin-request.mjs](capture/plugin-request.mjs) | 驱动真实插件宿主代码的 harness（`--aux` 触发 quota/catalog 刷新端点） |
| [capture/dump_flows.py](capture/dump_flows.py) | `.mitm` → JSONL（含完整请求/响应体，已处理孤立 surrogate） |
| [capture/compare.py](capture/compare.py) | 机器对照：头矩阵 / envelope / labels / generationConfig / 端点矩阵 / 同名端点请求体 |
| [capture/REPORT-DIFF.md](capture/REPORT-DIFF.md) | 本报告的机器生成版（数字全部来自它） |
| [capture/cli-flows.jsonl](capture/cli-flows.jsonl) · [capture/cli2-flows.jsonl](capture/cli2-flows.jsonl) | CLI 3 次运行的全部 flow |
| [capture/plugin-flows.jsonl](capture/plugin-flows.jsonl) · [capture/plugin-aux-flows.jsonl](capture/plugin-aux-flows.jsonl) | 插件内容请求 / 辅助端点 flow |

---

## 11. 本报告未覆盖

- **Antigravity IDE 本身**的请求未抓（插件自称 `hub/2.28.0` 是按 AGM 的 hub 指纹做的，真实 IDE UA/头未实测）；
- token 过期后的 refresh 流程、端点 fallback（`daily → sandbox → cloudcode-pa`）、限流/429 重试路径未触发；
- `recordTrajectoryAnalytics` 缺失是否有服务端副作用（如某类能力统计门槛）无法从客户端侧判定；
- 非 `aicode-consumers` project（如自建 project + `x-goog-user-project`）场景未测。


---

## Clarification & Remediation Update (Phase 1 Baseline Alignment)

### 1. Why `capture/plugin-flows.jsonl` Omitted `maxOutputTokens` While Real DSH Emitted `262144`
- `capture/plugin-request.mjs` called `service.adapter.stream(...)` directly **without** `maxTokens` in `GenerateOptions`, so `translate.ts` left `generationConfig.maxOutputTokens` unset.
- Real DSH user sessions do **not** call `adapter.stream()` directly; they run through `LlmRuntime.prepareCall()` / `LlmRuntime.resolveCallWithInfo()` (`@deepseek-ai/dsh-llm`) inside `@deepseek-ai/dsh-agent-loop`.
- Whenever caller `GenerateOptions.maxTokens` is omitted, `LlmRuntime.resolveCallWithInfo()` materializes `info.defaultMaxTokens` (obtained from `adapter.resolveModel()`) into `resolvedConfig.maxTokens` and records `adapterDefaults.maxTokens = true` in durable `request/header` session events.
- In `v1.1.3`, `catalog.ts` copied upstream descriptor `dyn.maxOutputTokens` (`262144` for `gemini-4-hydrogen-*`) directly into DSH `defaultMaxTokens`, causing real DSH sessions on Hydrogen to emit `generationConfig.maxOutputTokens: 262144`, whereas official Antigravity CLI 1.5.9 emitted `generationConfig.maxOutputTokens: 65536`.

### 2. Additional Root Causes Verified in Baseline Code
1. **Conflated capability vs default request policy**: Upstream `maxOutputTokens` (`262144`) is a capability ceiling, not an automatic per-turn request default. Explicit caller `maxTokens` must also validate integer/positive boundaries (preventing `0.5 -> Math.trunc(0.5) = 0`) and reject `> maxOutputTokensCapability` locally with `INVALID_REQUEST`.
2. **Account entitlement omission (`enabledCreditTypes`)**: Official `loadCodeAssist` (`paidTier.availableCredits`) returned `[{ "creditType": "GOOGLE_ONE_AI", "minimumCreditAmountForUsage": "50" }]`. Official CLI serialized `enabledCreditTypes: ["GOOGLE_ONE_AI"]` on `streamGenerateContent` requests, whereas `v1.1.3` discarded `availableCredits`.
3. **Config `.volatile()` lifecycle bug**: Every field in `src/host/config.ts` used `.volatile()`, causing Cordis/Schemastery to pass volatile reference wrappers (`{ get(), set() }`) to `normalizeConfig()`, silently falling back to defaults.
4. **429 double-layer retry amplification**: Bare `429: Resource has been exhausted.` lacked explicit rate-limit delay metadata, yet was classified as `RATE_LIMIT` and retried rapidly via DSH `providerRetryPolicy` (`600ms` initial backoff, `maxRetries: 2`).

### 3. Two-Layer Verification Standard
All protocol remediation tests cover both:
1. **Runtime Layer (`ctx.llm.stream()` + `LlmRuntime.prepareCall()`)**: Verifies actual DSH `resolveModel()` default materialization, explicit `maxTokens` pass-through/rejection, capability preservation, and single-variable outbound wire bodies.
2. **Full Agent Loop Layer (`@deepseek-ai/dsh-agent-loop` + `@deepseek-ai/dsh-session`)**: Verifies persisted `request/header` (`adapterDefaults.maxTokens`), `request/context` (`contextWindow`), multi-turn tool calls with `thoughtSignature` replay, session fork/resume, and `dsh-llm-retry` error behavior.
