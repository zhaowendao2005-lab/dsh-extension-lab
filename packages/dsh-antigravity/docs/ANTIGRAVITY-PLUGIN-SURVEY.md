# Antigravity 插件生态调研（DSH + 站外）

> 调研时间：2026-11-13。数据来源：dshmarket.com / awesome-dsh-plugin.com 详情页、各仓库 README、npm 包页。
> 说明：**功能描述基本来自作者自述**，只有端点名、配置键、额度字段这类在多份实现中重复出现的才可视为交叉验证；「95% 缓存命中」这类数字是宣传口径，未实测。

---

## 0. 一句话结论

生态已经分成三条完全不同的技术路线，**不存在既安全又完全伪装的路**：

| 路线 | 做法 | 代表 | 风险 | 能力上限 |
|---|---|---|---|---|
| **A 直连私有 API** | 自己实现 OAuth + 打 `cloudcode-pa.googleapis.com`，自造客户端指纹 | LiZhenNet、suntianc、Jaylor-Wang、ALAMBICCO、Antigravity-Manager | 高（ToS + 指纹被识别） | 最高：完全控制 header、缓存、调度 |
| **B 包装官方 CLI/ACP** | 调本机 `agy` 或 Google 官方 ACP server，登录态复用系统 keyring | dsh-agy-link、dsh-agy-safe、dsh-antigravity-acp | 低（就是官方客户端在跑） | 中：受 CLI 能力/参数限制，但**天然「官方途径」** |
| **C 多厂商聚合** | 订阅池里 Antigravity 只是其中一路 | V1ki、GooDAnDReaDY | 中 | 中：通用调度，缺少 Antigravity 专属优化 |

你想要的「伪装成官方 Antigravity 途径」在 A 路线里是**自己伪造**（UA/header/JA3），在 B 路线里是**本来就是官方途径**——两种「伪装」的含金量和封号风险差一个量级。这是挑选时第一个要拍板的点。

---

## 1. 总表

星级/下载量为调研时市场页数字，仅作热度参考。

### A. 直连私有 API（DSH 原生 LlmAdapter，provider route = `antigravity`）

| 插件 | 热度 | 多账号 | 额度检查 | 缓存相关 | 身份/伪装 | 特色 |
|---|---|---|---|---|---|---|
| **LiZhenNet/dsh-antigravity** | ★32 / 1.2k | ✗ 单账号 | ✅ 5h + weekly，按 Gemini 池 / Claude&GPT 3P 池分色 | — | 无（裸 OAuth + 默认 DSH 归因头） | **这个品类的鼻祖**，被 fork 出十几个；`fetchAvailableModels` 实时目录 + 静态兜底；中英双语设置页；凭证 `$DSH_HOME/storages/antigravity-oauth.json` |
| **almost-nowhere/dsh-antigravity** | 新 | ✅ 号池 | ✅ 全约束判定 | ✅ 会话亲和 | 无 | 基于 LiZhenNet 加号池；**调度算法写得最清楚**：按「有效余额/(1+在途数)」排序 + 低负载/LRU 平局 + 余额<10% 会话间隙平滑让出 + 429 有界重试转移；有 `QUOTA-SCHEDULING.md` 对比了 CLIProxyAPI / Antigravity-Manager 的选号算法 |
| **WiseXin/dsh-antigravity** | ★1 | ✅ | ✅ | — | 无 | 沙箱端点容灾、Gemini 3.8 Flash；「旗舰版」定位 |
| **Lukeknow0/dsh-antigravity** | 新 | ✅ | ✅ 实时 | — | 无 | 动态 reasoning effort 路由；v0.1.7 去掉「账号级全局暂停」，改成同账号同端点 429 重试一次（**这个思路值得抄**：全局暂停会把好账号一起冻住） |
| **suntianc/dsh-antigravity-auth** | ★28 / 2.1k | ✅ 但**手动切换**，同时只一个活动号 | ✅ 5h + weekly 面板 | — | **明确不伪装**：保留真实 `X-DeepSeek-Harness-Attribution`，README 原话「transport compatibility, not protection from account restrictions」 | 工具面最宽：`web_search` provider、`generate_image`/`list_images`、`analyze_video`（MP4 ≤32MiB）；`/anti status\|login\|accounts\|switch\|logout\|remove`；PKCE S256 + 127.0.0.1:51121；**明确拒绝自动轮转绕限额**（合规姿态最正） |
| **Jaylor-Wang/dsh-tool-antigravity** | ★22 / 4.2k | ✅ 池 + 额度故障转移 | ✅ SWR 容错 | ✅ TLS 连接池 + session resumption（降 TTFT）；Buffer 级 SSE 滑窗解析 | ✅ **唯一在 DSH 市场里公开打「Wire Identity」旗号的**：`antigravity/cli/1.1.24` 版客户端头 + 归因元数据 | 首字节前幂等重试 3 次（TLS RST/502/503/504 指数退避）；thinking low/med/high；Claude `anyOf/oneOf` schema 归一化修 400（`PROTOCOL_DRIFT`）；Windows 文件锁 PID 探活 |
| **ALAMBICCO/dsh-subagent-antigravity** | ★0 | ✗ | ✅ ~200ms HTTPS 直查，5 分钟缓存，`?force=1` 穿透 | ✅✅ **缓存做得最细** | 无 | 专攻 `subagent_fork`：包 `ctx.subagents.startActivation` 把子会话钉到 `antigravity/<model>`；**prefill cache warm-up gating**；Gemini 3.x `thoughtSignature` 落盘 `~/.dsh/antigravity/tool-signatures.json`（上限 600 条）并重放；双向 tool call（JSON Schema→Gemini 大写 Schema 子集、并行 functionCall/Response 配对、tool 结果里的图拆到后续 user turn）；loopback OpenAI 代理 `127.0.0.1:8791/v1`；右缘竖排胶囊 UI + effort 抽屉；走 `daily-cloudcode-pa.googleapis.com` |

> 这一族的 fork 还有 OpenSaozi、Miyamiz39、dsh-antigravity（npm 0.0.9）等，基本都是 LiZhenNet 的换皮/小改，**挑一个读源码即可，不必逐个看**。

### B. 包装官方 CLI / 官方 ACP

| 插件 | 热度 | 多账号 | 额度 | 缓存 | 身份 | 特色 |
|---|---|---|---|---|---|---|
| **amlyczz/dsh-agy-link** | ★171 / **19.5k（市场内最热）** | ✅ 池，sequential drain / round-robin，**每账号隔离 HOME/代理/凭证** | ✅ 三桶：5h + 7d + Argon weekly，倒计时 + 冷却态 | ✅ 完整映射 Gemini 原生上下文缓存：`cache_read_tokens`、1M 上下文 | **不伪装**：跑的是未修改的官方 `agy` | 每轮一个短命进程 `agy -p --output-format stream-json`（NDJSON）；`--conversation` 会话绑定（历史交给 agy，每轮只发增量）；Jitter-Safe Auth（用 keyring 证据区分网络抖动 vs 真登出）；429/配额/区域/鉴权**分类冷却**；Windows 凭证槽租约；in-GUI OAuth + headless 粘 URL；`/tsl` 翻译、`dsh-agy-image`；设置页内嵌控制台、<680px 抽屉 |
| **Jonah-Wu23/dsh-agy-safe** | 小 | ✗ | — | 常驻长连接 + 哈希分叉重建 | 官方会话 | 合规卖点最硬：「只用自己账号在本机登录的官方 agy 会话」，无共享号/中转；把 agy headless 桥成一级 provider，主对话 + 子代理都能用 |
| **ZEM17/dsh-subagent-agy** | ★4 | ✗ | — | — | 官方 CLI | 只做 subagent 工具：`model gemini-3.1-pro-high`、effort、前台 5min / 后台 1h 超时、`--add-dir`、按路径识图、弹窗登录 |
| **dannndouglas/dsh-antigravity-acp** | 新 | ✗（无选号 UI） | ✗（官方只给 usage_update 上下文占用，不编造账单） | 保留 2 个热进程 5 分钟复用；无工具请求可借壳空 session | ✅✅ **真·官方途径**：从 dl.google.com 拉官方 `agy_acp_server` 1.3.0，走 ACP v1 / stdio，**不碰任何私有 Google 端点** | 私有 loopback MCP bridge 把 Antigravity 的工具请求转成 DSH 工具调用（权限仍归 DSH）；文档极其克制，明确列出 UNSUPPORTED_OPTION、无 durable resume、原生工具会 cancel 等限制 |

### C. 多厂商订阅聚合（Antigravity 只是其中一路）

| 插件 | 多账号 | 额度 | 特色 |
|---|---|---|---|
| **V1ki/dsh-plugin-subscriptions** | ✅ | ✅ 优先 `retrieveUserQuotaSummary`，只用服务端明确的共享限额 | 额度胶囊 80% 警告 / 95% 严重；endpoint 回退 daily→production 仅在传输失败或 404/502/503/504；模型池取各账号目录并集、按最小上下文窗口收敛；Low/Med/High 变体合并 |
| **GooDAnDReaDY/dsh-subscriptions** | ✅ Pool + Rotate | ✅ 429 冷却、按模型家族冷却 | 账号级代理；`ctx.subscriptions` 共享给 `dsh-image-gen`；Antigravity 走 `/v1/loadCodeAssist` + `/v1:streamGenerateContent` |
| **randomix777/dsh-plugin-subs** | ✅ | ✅ | 9 家 OAuth；Antigravity 静态目录，需 `ANTIGRAVITY_CLIENT_ID/SECRET` |
| **lninghaha/dsh-coding-subscription-oauth** | — | — | **反面参照**：README 明确「不支持批量账号、额度转售、远程 relay、付费墙绕过、客户端伪装」，商用建议官方 API key |

### D. 站外重量级参考（不是 DSH 插件，但实现最深）

| 项目 | 形态 | 可抄的点 |
|---|---|---|
| **lbjlaq/Antigravity-Manager**（Antigravity Tools v5.0.3） | Tauri v2 + Rust + React 桌面端，CC BY-NC-SA 4.0（**禁商用，不能直接抄代码**） | **伪装与缓存的天花板**，见 §2 |
| **aspirin0418/aspirin-ant** | VS Code 扩展，Apache-2.0 | 多 Google 号 refresh token 轮换、按额度/成功率/负载选号、429 冷却 + 503 短冷却、`minQuotaPercent` 低额自动剔除（热加载）、AI Credits 余额与超量开关、账号卡分级（Ultra/Pro/Premium/Standard/Free）、自带 token-proxy（token-manager/quota-tracker/quota-poller） |
| **NoeFabris/opencode-antigravity-auth** | OpenCode 插件，MIT | **缓存优先调度**的标准答案，见 §3；双额度池（Antigravity ↔ Gemini CLI 互备）；`pid_offset_enabled` 给并行 subagent 分散账号；`soft_quota_threshold_percent: 90`（避免把号打干被 Google 惩罚）；ToS 警告里直接写「已有用户被封/影子封」 |
| **pi-antigravity-rotator** | npm 本地网关 | OpenAI 兼容网关、按模型额度路由、账号健康评分、Virtual Keys、成本审计 |
| **CLIProxyAPI / antigravity-api-proxy** | Go/Python 代理 | Round robin / weighted / fill-first / session affinity 四种策略的参考实现 |

---

## 2. 「伪装」到底要伪装什么（Antigravity-Manager 的做法，按可信度排序）

1. **UA 版本动态化**：不再硬编码 `1.0.0`，读本机真实安装版本拼 User-Agent；Docker/无客户端时回落到「已知稳定版」指纹（如 v1.16.5）。—— 这条最实用，成本最低。
2. **全套 header**：`X-Client-Name`、`X-Client-Version`、`X-Machine-Id`、`X-VSCode-SessionId`。缺一个就可能落进「非官方客户端」特征。
3. **TLS 指纹（JA3/JA4）**：v4.1.18 起用 `rquest` + BoringSSL 复刻 Chrome 123 的握手指纹。Node 侧要做这件事得换 `undici` 的自定义 connector 或走 Rust/Go sidecar，**工程量最大、收益最不确定**。
4. **稳定的 Session/Machine ID**：同一账号、同一机器 ID 不变，否则每次请求都像「新设备」。

对照 DSH 生态：Jaylor-Wang 只做到「AGY CLI 版本号的 header + 归因」，suntianc 干脆不伪装、保留真实 DSH 归因头。**如果你要做第 1 条需求，Antigravity-Manager 的 1/2/4 是可直接照抄的清单，3 建议先不做**（Node 里改 JA3 很容易把连接搞坏，而且 Chrome 版本一升就废）。

⚠️ 但要想清楚：**「伪装成官方」和「用官方客户端」是互斥的两条路**。B 路线（agy CLI / ACP）不需要伪装，因为流量本来就是官方二进制发的——它的「官方途径」是真的，不是装的。A 路线无论伪装多像，Google 侧仍可从行为模式（并发、频率、模型组合）区分。这话不是我编的，opencode-antigravity-auth 的 README 自己写了封号案例。

---

## 3. 「掉缓存」到底掉在哪（这是最值得自己做的差异化）

Prompt cache 的命中取决于**前缀逐字节稳定**，而号池类插件恰好在这上面全是坑：

| 掉缓存的原因 | 谁踩过 / 谁解决了 |
|---|---|
| 换账号 → 缓存按账号隔离，一切归零 | opencode 用 `cache_first`：限流时**先等同一账号**（默认最多 60s），等不到才切；`sticky` 策略同理 |
| 会话 ID 变 → 服务端视为新会话 | Antigravity-Manager v3.3.9 用 SHA256 内容哈希生成**粘性 Session ID**，CLI 重启仍继承 |
| tool 定义/签名变 → 整段前缀失效 | Antigravity-Manager 的「tool-signature cache write-amplification mitigation」；ALAMBICCO 把 `thoughtSignature` 落盘重放（600 条上限） |
| 连接重建 → 缓存预热白做 | ALAMBICCO 的 **prefill cache warm-up gating**；Jaylor-Wang 的 TLS 连接池 + session resumption |
| 并行 subagent 抢同一账号 → 互相踩缓存 | opencode 的 `pid_offset_enabled`；almost-nowhere 的会话亲和 |

**可落地的组合**（我认为这是你这个插件最该做的部分）：
1. 账号选择默认 `cache_first` + 粘性会话 ID（哈希自 `accountId + workspace + 首条 user message`）；
2. 429 先原地退避 ≤60s，再考虑换号；换号后**主动标记 cache cold**，UI 上告诉用户；
3. 所有 tool schema 稳定排序 + 稳定序列化，避免每轮 JSON key 顺序抖动；
4. 连接复用（keep-alive / TLS session ticket），别每轮新建连接；
5. 缓存命中率做成指标：从响应 `usageMetadata.cachedContentTokenCount` / `cache_read_tokens` 读回来，展示 hit rate。**没有这个指标，你永远不知道自己有没有掉缓存。**

---

## 4. 额度检查：字段与坑

多份实现一致的端点：
- `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`（也有 `daily-cloudcode-pa...` 变体）
- `POST .../v1internal:loadCodeAssist`（拿 project / tier）
- `POST .../v1internal:streamGenerateContent?alt=sse`
- `POST .../v1internal:fetchAvailableModels`（实时模型目录）

额度模型（几乎可以确定）：
- **5 小时滚动窗** + **每周固定窗**，两窗都按订阅档位（Free/Pro/Ultra）给量；
- **两个独立池**：Gemini 系（Flash/Pro）一个池，Claude + GPT-OSS（3P）另一个池；
- 消耗按 token 成本折算，Opus 掉得比 Flash 快得多；
- 响应里带 `quotaResetDelay`（毫秒级）和 reset time。

坑：
- 不要自己估算百分比，**只信服务端明确返回的 shared quota**（V1ki 明确这么做）；估算值一旦偏乐观，就会把号打穿。
- 阈值设在 **90%** 而不是 100%（opencode 的做法），把最后 10% 留给「同一会话的续聊」，避免刚好在长任务中间断掉。
- 缓存过期要 **fail-open**（未知 = 放行），否则一个过期的额度缓存能把整个插件锁死。
- `retrieveUserQuotaSummary` 有时只返回聚合值，分池数据要结合 `fetchAvailableModels` 的 `quotaInfo` 一起看。

---

## 5. 多账号：从「能切」到「不打架」

成熟度分四层，挑插件时按这个尺子量：

1. **L1 手动切换**（suntianc）：能存多个 refresh token，同一时刻一个活动号。
2. **L2 轮询**（randomix777、早期 fork）：429 就换下一个，简单但会疯狂掉缓存。
3. **L3 会话亲和 + 健康度**（almost-nowhere、opencode hybrid）：按「余额/(1+在途)」排序、P2C 二选优、429 分类冷却、按模型家族分别记限流。
4. **L4 并发隔离**（dsh-agy-link 的 Windows 凭证槽租约、每账号独立 HOME/代理；Antigravity-Manager 的 Exclusive/Pooled/Fallback 三种调度 + 凭证级粘性）：多个 DSH 会话/子代理同时跑也不串号。

**关键细节**（都是别人踩过的坑）：
- 每账号独立 `HOME`/`XDG_*`/代理，否则 CLI 类实现会互相覆盖登录态；
- 429 要区分「真限流」vs「网络抖动」vs「区域限制」vs「鉴权失效」，四类处理完全不同（dsh-agy-link 的 Jitter-Safe Auth 就是干这个）；
- 账号级**不要**做全局暂停（Lukeknow0 的教训）；
- Windows 上文件锁 + PID 探活（Jaylor-Wang），不然崩溃后号池永久锁死；
- 并发写入要租约/文件锁，别两个进程同时 refresh 同一个 token（会把 refresh token 转失效）。

---

## 6. 给你的 5 条需求打分（● 完整 / ◐ 部分 / ○ 无）

| 插件 | ①伪装 | ②缓存 | ③额度 | ④多账号 | ⑤其他（工具面/UI/工程） |
|---|---|---|---|---|---|
| Antigravity-Manager | ●●●（UA+header+JA3+粘性ID） | ●●● | ●● | ●●● | ●●● 协议转换/模型路由/Imagen/Docker |
| amlyczz/dsh-agy-link | ●●（官方本体） | ●●（cache_read_tokens 映射） | ●●● | ●●● | ●●● DSH 集成最完整、最热 |
| Jaylor-Wang/dsh-tool-antigravity | ●●（CLI 版本头） | ●◐（连接层强、prompt 层弱） | ●● | ●● | ●● schema 归一化、重试 |
| ALAMBICCO/dsh-subagent-antigravity | ○ | ●●●（warm-up + thoughtSignature） | ●●●（200ms） | ○ | ●●● 子代理专用、loopback 代理 |
| almost-nowhere/dsh-antigravity | ○ | ●●（会话亲和） | ●●● | ●●● | ●● 调度算法文档化 |
| LiZhenNet/dsh-antigravity | ○ | ○ | ●● | ○ | ●● 最干净的基线，适合当起点 |
| suntianc/dsh-antigravity-auth | ○（主动不伪装） | ○ | ●● | ◐ 手动 | ●●● 工具面最宽 |
| opencode-antigravity-auth | — | ●●●（cache_first） | ●●● | ●●● | — 不是 DSH |
| dsh-antigravity-acp | ●●●（真官方） | ◐（进程复用） | ○ | ○ | ●● 合规上限 |

---

## 7. 三套可选打法（我的建议）

**打法 1「复刻 LiZhenNet + 加三件套」——工作量最小，风险中等**
以 LiZhenNet 的直连实现为骨架（单账号、OAuth、流式、模型目录都有了），加：
- 号池 + 会话亲和（抄 almost-nowhere 的排序公式）
- 缓存指标 + `cache_first` 退避（抄 opencode）
- 额度双池面板（5h + weekly，按 90% 阈值）
伪装只做「UA 版本 + 四个 header」，不碰 JA3。

**打法 2「双引擎」——最贴近你的 5 条需求**
- 默认引擎走 **官方 `agy`/ACP**（真官方，零伪装风险，额度/登录直接复用）
- 高级引擎走 **直连 + 伪装**（可控 header、可控缓存、可多号）
- 两个引擎共用一套号池/额度/缓存指标层，UI 上让用户选「稳」还是「快」
这是 dsh-agy-link（B）和 Antigravity-Manager（A）的合体，工程量最大，但唯一能同时满足「官方感」和「完全控制」。

**打法 3「只做调度层」——差异化最锋利**
不碰模型请求，只做 `antigravity` 的**号池 + 额度 + 缓存观测**中间层，把请求转发给已有的 provider 插件。好处是不用重写流式解析/schema 转换这些脏活；坏处是受制于人。

如果目标是「自己搓一个能长期用的」，我选 **打法 1 起步、按打法 2 演进**：先把单账号链路 + 额度面板跑通（1～2 天量级），再叠号池和缓存，最后才考虑伪装深度。

---

## 8. 风险与合规

- **ToS**：Google 明确禁止用非官方客户端访问 Antigravity 配额。opencode-antigravity-auth 的 README 写了「有用户被封 / 影子封」（shadow ban：不报错但降智/限流）。这不是理论风险。
- **供应链**：这些插件都能读你的文件、拿你的 OAuth token、访问网络，DSH 的工具审批管不到插件本体。装之前至少 `grep` 一遍网络请求目标。
- **fork 泛滥**：LiZhenNet 一族有十几个换皮仓库，质量参差，很多没有测试。**读一个就够，别按 star 排序盲选**。
- **许可证**：Antigravity-Manager 是 CC BY-NC-SA 4.0，代码可以看、不能商用、衍生要同协议；aspirin-ant 是 Apache-2.0；opencode 那个是 MIT。要抄代码先看 LICENSE。
- **别碰**「共享号池 / 远程 relay / 批量注册号」——lninghaha 那类插件明确划了红线，也是被封得最快的。

---

## 9. 需要你拍板的三件事

1. **路线**：A（直连+伪装）/ B（官方 CLI/ACP）/ 双引擎？
2. **伪装深度**：只做 UA+header，还是要碰 TLS 指纹？
3. **首发范围**：先做「单账号 + 额度面板」还是直接上「号池 + 缓存优先」？

定了之后我再对选中的 1～2 个仓库做源码级拆解（目录结构、请求构造、流式解析、额度字段、可复用模块），给出实现方案和文件级拆分。
