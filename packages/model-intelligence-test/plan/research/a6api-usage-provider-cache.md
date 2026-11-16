# a6api 请求账单、提供商匹配与缓存时序研究

日期：2026-11-16。范围：只读接口研究与设计；没有实施业务改动、修改提供商配置、付费调用模型或发布版本。

## 1. 推荐结论

扩展成三条互相独立、通过稳定身份关联的链路：

1. 网页选择携带渠道报价、缓存率等市场快照；测试记录长期保存快照。
2. Host 为每次真正发送的采样请求登记账本，保存站点 request ID，再用账户访问凭据查询实际消费日志，异步回填费用和账单 Token。
3. Host 枚举站点全部令牌，读取用户所选 DSH 提供商的凭据做精确匹配；持久化匹配观察和用户选择，下拉显示 DSH title；固定、加入路由作用于对应站点 token ID。

不能合并的概念：渠道报价与实际消费、市场近24h缓存率与本轮请求缓存命中率、20个渠道与60次请求、本地配置名称与令牌身份、历史匹配与远端仍有效。

## 2. 已验证事实及证据强度

### 2.1 真实账户只读接口

通过已有 a6api 登录页、同源请求和 New-Api-User 头读取，未输出任何密钥明文、日志正文或 IP。下面的成功结果证明当前站点返回形状；本轮没有重新获取账户访问令牌做直连验证。访问令牌 + authorization/New-Api-User 直连方式在前一轮已有证据，现有 A6Site 也按此实现。

| 接口 | 当前证据 | 用途与限制 |
|---|---|---|
| GET /api/status | 200；quota_per_unit=500000、usd_exchange_rate=7.3 | 账单额度换算。数值只代表本次观察，不能写死 |
| GET /api/log/self?p=1&page_size=3 | 200；data 含 page/page_size/total/items/total_capped | 请求明细。必须处理分页与 total_capped |
| GET /api/log/self?request_id=…&p=1&page_size=5 | 200；total=1；返回 request_id 与查询完全相同 | 精确账单关联已经证明 |
| GET /api/log/self/stat?start_timestamp=…&end_timestamp=… | 200；data 只有 quota/rpm/tpm | 不能从此接口得到总请求数和输入/输出分列 |
| GET /api/token/search?p=1&page_size=2 | 200；data 含 page/page_size/total/items；当前 total=15 | 列表 key 是掩码，不能直接精确匹配 |
| POST /api/token/{id}/key，body={} | 旧轮 Host 直连曾成功；本轮一次浏览器 reveal 未得到可解释的完成结果 | 本轮 browser-use Runtime.evaluate 等待20秒后超时；这是自动化等待超时，不足以证明站点接口响应时间或失败原因 |
| GET /api/data/self | 当前公开 Dashboard 源码使用；本轮读取也遇浏览器自动化等待超时 | 不把本轮查询记为成功验证 |

日志实测字段：request_id、token_id、token_name、model_name、channel、channel_name、quota、prompt_tokens、completion_tokens、created_at、type、other，以及市场供应商与渠道字段。

other 实测还包含 cache_tokens、actual_channel_id、billed_channel_id、attempt_count、billing_source、settle_phase、usage_source、request_final_status、marketplace_price_*_micros、channel_ratio_snapshot 等字段。观察到 request_settled/success，但没有据此推断所有请求都具有同样结算状态。

不同请求的查询首条均出现 id:1，不能把该 id 当作跨查询稳定唯一键；应优先以账号 + request_id + 已确认的消费语义做去重。多消费行/退款行仍需保留、核查，不能简单只取第一行。

### 2.2 当前公开前端源码

来源：

- https://a6api.vip/ui/new/assets/index-Bz5iFRKN.js
- https://a6api.vip/ui/new/assets/ConsoleLogsView-B35J4Mzr.js
- https://a6api.vip/ui/new/assets/ConsoleDashboardView-ClFdCBHr.js

可确认：

- 站点请求传输读取响应头 `X-Oneapi-Request-Id`。
- 日志筛选支持 model_name/token_name/channel/group/request_id/start_timestamp/end_timestamp；统计查询主动去掉 request_id。
- 日志 type=2 表示消费，type=5 表示错误，type=6 表示退款。退款不能算一次新的模型请求；实际退款符号与关联策略实施时须以真实退款样本补证。
- Dashboard 从 /api/data/self 的 count/token_used/quota 聚合；未见输入、输出独立列。
- 金额显示使用 quota / quota_per_unit，再按 status.usd_exchange_rate 换成人民币。
- 日志内 channel_ratio_exchange_rate、channel_ratio_snapshot.exchange_rate 属于渠道倍率快照。实测可为6.6719，与本次全站展示汇率7.3不同，不能混用。
- 自助测试构造函数 Gc 明确允许原 key 带或不带 sk-，随后构造 Bearer sk-…-channelId；这不证明任意 DSH key 都能安全删除后缀。普通 key 的匹配 canonicalization 必须独立验证。

### 2.3 DSH 正式能力

由运行时 Service/Event Inspect 及安装版0.2.2-rc.3文档确认：

```ts
llm.listProviders(): LlmProviderInfo[] // {id,name}
llm.listConfigurableProviders(): LlmConfigurableProvider[]
// provider/displayName/settingsNs/settingsPath/defaultBaseURL?/baseURLEnv?/nativeAuth? 等
settings.describe(options?: {redactSecrets?: boolean}): SettingsDescriptor[]
credentials.resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
credentials.describe(ref: CredentialRef): Promise<CredentialInfo>
// configured/source?/writable/masked?，没有 credential revision
```

pi-ai 配置可通过 settingsNs/settingsPath 定位，显式凭据字段 apiKeyEnv 使用 credentialRef 构造引用；Host resolve 后只在内存比较。不要全量读取无关凭据。无显式引用的认证形式需要按适配器支持能力处理，OAuth/grant payload 不能当成普通 API key 拆解。

事件：llm/adapters-updated、llm/models-updated(provider)、credentials/reference-updated(ref)、credentials/record-updated(key)、settings/document-updated(ns,revision)。凭据事件不覆盖所有环境变化；配置 revision 不等于凭据 revision。

文档明确要求消费方按操作重新解析凭据，不跨操作缓存本地凭据实际值。证据：`.agents/skills/dsh-doc/packages/dsh-credentials.zh.md:111-123`。

## 3. 请求账本与费用回填

### 3.1 请求数必须记录真实发送

现有界面的“请求 #1”是整轮测试 attempt，不是一次 HTTP 请求。建议界面改称“测试轮次 #1”，另外显示“API 请求数”。20个渠道、每个3题，正常是60次 API 请求；重试增加请求数。

建议持久模型（名字是设计建议，不是现有 Remote 契约）：

```text
RequestExecution
  executionId, recordId, testAttemptId, modelRunId, challengeIndex, retryOrdinal
  siteOrigin, accountId, tokenId, intendedChannelId, model
  createdAt, dispatchStartedAt, responseReceivedAt, finishedAt
  dispatchState: prepared | dispatching | response-received | ended | unknown
  siteRequestId?, httpStatus?, finishKind?, observedActualChannelId?
  streamUsage?: {inputTokens?,outputTokens?,cacheReadTokens?}
  billing: {state,quota?,inputTokens?,outputTokens?,cacheTokens?,source,observedAt?}
```

每次重试新建 execution，绝不覆盖旧请求的消费事实。当前 engine.retry 会清空 sample 的计数、时间、usage，不能直接把 sample 当长期计费账本。pin/取key失败、尚未进入数据面不能记成一次模型请求；发出后断网、进程崩溃可能只有“不确定已受理”，需要保留此状态而不是猜0次或自动补发。

### 3.2 捕获 request ID

在 openChannelStream 收到响应后、读取或抛出HTTP错误前，捕获站点请求ID和响应状态，通过明确的 metadata 回调/事实通道写入账本，不伪装成正文增量。头名先按公开源码 `X-Oneapi-Request-Id` 实现。

尚未用新的付费模型请求验证普通数据面是否稳定返回这个头。实施时需在用户授权的正常测试中验证；本轮没有为此额外调用模型。响应体 id 与站点日志 request_id 不能默认等价。

### 3.3 账单异步状态

采样状态与账单状态分别推进：

```text
pending -> querying -> observed -> reconciled
                    -> not-found-yet -> deferred
                    -> ambiguous / unavailable
```

- 模型完成即可以查看分析，不等待账单日志落库。
- 账单worker依 request_id 查询，核对账号、token_id、模型、渠道。渠道不一致记录差异，不偷偷把预期渠道改为实际渠道。
- 查询得到消费日志不代表永不更新；区分结算阶段，保留补退费和后续修正。
- 一次自动查询只启动一个共享任务，UI多个tab不重复启动。
- 建议调度：结束后2秒、5秒、15秒、30秒、60秒、120秒；这是初始预算而非已测站点落库SLA。持续未命中后进入待补查，人工刷新/重启恢复继续。
- 限流按Retry-After（数值或HTTP日期）/站点reset提示处理，指数退避和抖动；401/403暂停该账号同步并保留旧事实。
- 无 request ID 时只能用tokenId+模型+渠道+小时间窗提出候选，三题并发、重试、日常共用令牌均可能歧义。不能仅靠最近时间自动写入“已核实费用”。

取消任务不意味着退款；已发送的执行仍可独立完成账单补查。删除记录则取消补查、拒绝晚到写回；重启后仅恢复账单查询，不自动重发模型请求。

### 3.4 人民币口径

原始事实保留整数quota、quota_per_unit、观察时汇率、账单Token、结算状态。示例公式：

```text
USD等值 = quota / quota_per_unit
CNY展示等值 = USD等值 * status.usd_exchange_rate
```

汇率取值冻结到该次显示依据，避免旧记录随全站汇率改变。该人民币数是站点账单额度的展示折算，不宣称等于用户充值时的人民币现金成本。不要用渠道报价计算结果填充实际费用。

渠道报价使用网页发送的 pricing_currency/pricing_unit/charge_type 和各 price_micros，转换到统一的站点展示币种；未明确的币种/单位不猜。历史报价与账单实际价格快照可以并列。

## 4. 用量概览交互和统计口径

建议本次首先实现“本轮测试”，另允许切到“此测试记录全部轮次”；暂不默认为整个a6api账号的累计用量。

顶部四个主指标：实际费用、API请求数、输入Token、输出Token。辅助信息：已对账数量/已发送数量、失败数、待补账数、统计范围。记录总量包含历史失败重试产生的费用。

统计规则：

- 请求总数来自 execution，不等于run数、有效样本数、日志行数或上游attempt_count。
- 费用以已核实消费与退款事件的净额计算；缺失账单不能视作0元。部分完成显示“已核实 ¥…；待对账 N次”。
- Token优先账单源，未对账时可显示已有流usage但标注来源。相同execution择一使用，不能把流usage和账单usage相加。
- 未返回的Token用量为未知，不默认0；仅确有明确0时显示0。
- 输入Token对缓存是否已包含必须按来源规范化；命中Token是子集时不可重复相加。
- 本轮缓存命中率 = 可比较口径的缓存读取Token / 对应输入Token，覆盖不足标注；不能拿“渠道近24h缓存率”代替。
- 模型请求失败、样本分析失败都不意味着免费，所有已发送execution纳入补账。
- 退款与预扣/结算的去重需要真实样本补证，不能将相同request_id任意sum或只保留第一行。

如果之后要加“所选提供商账号级日常用量”：明确其为某tokenId的全部请求（可能包括其他客户端），不要声称可区分两个共用同一key的DSH提供商。站点log返回tokenId，但已知筛选只有token_name，后端需验证ID或准确过滤；同名令牌不能混算。Dashboard只有token总计，要输入/输出必须分页明细或新增已验证聚合接口；大量历史日志需显示覆盖范围及total_capped限制。

## 5. 提供商匹配和下拉交互

### 5.1 配置阶段

上方“管理a6api提供商”打开搜索面板，使用DSH已配置提供商{id,name}；搜索name/id，展示DSH title。用户挑选希望参与匹配的提供商与站点令牌。

Host并行读取：

1. 所选DSH路由公开目录/配置引用。
2. 站点所有令牌元数据，按page/total收敛，去重tokenId，检测重复页和分页期间变化。
3. 需要时解析该DSH凭据，并按候选令牌获取真实key做精确等值比对。

来源域名、名称和前后缀掩码只能用作候选提示，不能作为验证成功。代理域名可能仍用a6api key；反之a6api字样也不能证明key归属。一个key对应多个DSH title时保留全部，tokenId相同的操作状态同步。

匹配结果：exact、pending、stale、ambiguous、unmatched、unsupported、error；未扫完/接口失败不称unmatched。失效/过期令牌单独标状态，不能由“key相同”推断可调用。

特殊认证首版仅支持明确可解析的API-key路径；OAuth、原生认证、多key轮换、任意自定义header改写显示未支持，不能尝试拆解opaque内容。站点key可能带/不带sk-的匹配策略需要单独验证，只对确定的站点格式canonicalize；绝不通用截断“-渠道ID”。

### 5.2 结果行

新增“使用提供商”下拉：优先显示已确认的本地配置，主标题DSH title，副标题站点令牌名/掩码及状态。站点全部令牌可搜索，但未对应本地配置的项放在“未关联”分组，不自动创建或修改DSH提供商。

选择即保存目标，刷新和跨tab保持。固定/加入路由由按钮明确执行；选择不隐式改站点配置。

建议保存按账号+model的默认目标；站点实际绑定身份是账号+tokenId+model，不能只保存记录行号/title。每条历史行可显示自己的目标，但同一token/model的当前固定状态必须一致。

固定一个渠道与路由池多个渠道分开显示。修改前重检关联及token可用性；先取得与测试worker共用的身份锁，正在测试时显示占用。加入路由的读取-新增-读回串行按账号/token/model控制，使用站点实际subscriptionId，不覆盖已有路由池。站点锁不能约束浏览器外部操作，读回与冲突检测仍必要。

日常固定不应被测试租约清理；同一token如果既用于日常又作为测试槽位，自动测试需明确恢复既有pin，避免日常选择被临时调度覆盖。

## 6. 缓存与时序

### 6.1 不同缓存保存不同事实

| 数据 | 保存位置 | 起始新鲜度策略（建议值） |
|---|---|---|
| 令牌id/name/mask/status/expiry、列表快照 | Host持久域，按siteOrigin/accountId隔离 | 页面先显示；后台刷新；正常TTL 5分钟 |
| providerId、配置引用、用户勾选、默认使用目标 | Host持久域，profile/account隔离 | 跨重启保存；事件驱动失效，不按title当身份 |
| 精确匹配历史、观察时间、远端状态 | Host持久域 | 重启先stale；使用前本地重新resolve，必要时远端定向复核 |
| 站点key等值索引（若启用） | Host持久HMAC索引；pepper在凭据服务 | 只是历史等值观察，不是远端有效性证明；建议24小时远端复核预算 |
| 本地实际key值 | 每次操作临时内存 | 不跨操作缓存，遵守credentials契约 |
| 站点reveal实际值 | 当前匹配任务临时内存 | 计算指纹后释放，不落普通业务域；多候选内复用同一pending请求 |
| 负匹配 | Host短期缓存 | 30–60秒；刷新/新增token/凭据变化立即失效 |
| 请求账单和execution | Host持久域 | 长期事实，独立补查、修正版本，不受界面TTL删除 |

所有TTL是设计预算，需在实施中按真实响应和限流调整。首版也可只持久化关系、不持久化HMAC索引：冷启动定向reveal既有关联，避免全量重扫；成本更简单，命中速度稍慢。

HMAC索引推荐定义：

```text
HMAC-SHA-256(profilePepper,
  encode(version, siteOrigin, accountId, site-specific-canonical-key))
```

只保存digest/algorithmVersion/pepperId/tokenId/secretObservedAt，Client不接收digest或pepper。pepper和索引同时泄露仍可用于候选验证，所以它是带密钥的等值标识，不宣传绝对不可逆。pepper轮换全部失效。

一次新本地resolve与旧digest相等，只证明“与上次观察的远端key相等”；即便mask和元数据不变，远端仍可能轮换或撤销。按钮执行前要做定向复核或满足明确短期远端复核策略，手工映射不能绕过校验。

### 6.2 避免首次拉取阻塞

- 首屏先显示持久缓存，下拉立即可打开，状态标“正在核对”。
- 拉全部令牌元数据不等于reveal全部明文。先做用户选中的provider/token，再做可比较掩码候选；掩码不同不能无证据作最终排除。
- 若用户要求发现全部对应关系，在后台分批扫剩余候选，显示完成数/总数。首次全量成本本质上是O(需要reveal的token数量)，不能承诺一瞬间完成。
- 每账号reveal并发起始2，匹配优先于后台发现；扫描和测试共用控制面限速预算，但不能持有模型请求池槽位等reveal。
- single-flight键包含site/account/accountGeneration/tokenId，避免多个tab和不同model行重复reveal。
- 每次请求显式超时（建议8–10秒起始，允许调整）；一个失败不清空其余成功映射，重试留在后台。

### 6.3 防旧结果覆盖

每个账号有generation；每个provider有关联输入指纹/配置revision和本进程失效epoch。任务开始捕获这些值，写回前再次检查：

```text
account未切换 && provider仍存在 && generation一致
&& 此记录未删除 && 关联输入仍是同一份
```

切换账号、更新账户凭据、provider改key/改baseURL/删除，取消旧工作并失效对应缓存。标题重命名只刷新title；不能把身份丢掉。配置或凭据事件去抖并触发重算；重启、进入页面、执行操作仍要按需重检，因为事件不能证明所有变化。

固定等写操作按账号/tokenId/model串行；目标选择带revision/CAS，两个tab不同选择时以后提交成功的版本为准，旧网络返回不得覆盖新选择。操作成功后先持久提交再广播快照。

## 7. 现有代码需要改变的边界

以下仅指出实施点，当前没有修改：

- backend/a6/site.js:94 只取第一页100项，需要全量分页和status/expiry等元数据；新增日志/status/统计/订阅读取适配。
- backend/a6/service.js:64 现有keyCache只以tokenId为键、10分钟明文缓存。需账号隔离、single-flight、切换凭据失效；不能直接用作长期匹配缓存。
- backend/a6/transport.js:109 后应捕获响应元数据；usageOf()当前把缺失字段默认0，messages分段usage还可能覆盖前段input。新增统计前必须区分missing/zero并正确合并增量usage。
- backend/fingerprint/engine.js:248 重试重置sample，需独立execution流水保留历史；cancel/dispose不得误阻止独立计费worker恢复。
- backend/records/domain.js:11 当前records/attempts为持久表；新增可兼容的账本/关联存储，不以提升domain版本丢弃现有记录。
- backend/service/catalog.js:59 当前只有provider id/name，需要Host限定投影配置引用及支持能力；Client不接触key。
- frontend新增概览、关联管理和列选项应沿用store/datasource/service分层，不在view直接IO。
- integration/a6api-userscript.user.js与intake白名单贯通价格/缓存率快照；不让油猴新增反向控制或账单轮询。
- AGENTS当前“无key核验”针对自动测试槽位；新增“用户主动关联日常provider”应明确限定作用域，保留测试槽位以用户选择为准。

## 8. 推荐实施顺序与尚待补证

1. 先做稳定execution账本、request ID捕获、日志适配、单请求费用回填、概览。不能先做漂亮的总数再补统计语义。
2. 并行开发provider发现、Host精确匹配、令牌全量分页和缓存状态；先验证用户选择目标的快路径。
3. 接结果行下拉与固定/路由操作、账户隔离、冲突与重启恢复。
4. 接渠道市场快照和报价/缓存率列，统一人民币展示与来源标识。

实施验收需要覆盖：重复重试仍保留旧费用；三题并发不串账；取消后账单可补齐；缺失用量不变0；退款不增加请求数；多tab去重；账号切换后晚到响应不写入；provider改key/改title/删除；同key多title；令牌分页新增/删除/禁用；同掩码不同key；远端轮换且mask不变；账单延迟、429、认证过期；普通数据面request ID头；真实退款/预扣/结算日志语义。以上是验收清单，本轮没有编写或运行测试。

待补证：普通数据面request ID头稳定性；reveal在Host直连的当前延迟分布与限流；普通key的sk-表示差异；退款/预扣的唯一事件键和符号；日志分页上限/total_capped行为；账号级输入输出聚合是否另有可用接口；各认证适配器能否准确解析当前有效key。
