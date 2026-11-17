# a6api 接入与数据口径

本文记录当前实现使用的接口和数据边界。功能分工见 [插件架构](../ARCHITECTURE.md)，操作步骤见 [使用说明](../README.md)，尚未实现的扩展见 [自定义测试设计](../plan/custom-testing/README.md)。

接口事实来自 2026-11-15 至 2026-11-16 的站点源码与已有查询记录，并与当前包内实现核对；不是对站点未来行为的保证。以下限额、汇率和返回样例均不能硬编码成长期规则。

## 1. 网页与 Host 的分工

网页脚本只提交渠道、测试令牌 ID/name 和市场快照；Host 使用账户访问令牌与 `New-Api-User` 调用控制面，不依赖网页 cookie 或持续在线。访问令牌和模型调用 Key 是两种凭据，均不进入 Client 或网页选择清单。

自动测试与日常操作分开：

- 自动测试使用用户选择的专用测试令牌，每令牌一 worker；固定并读回确认后调用普通模型接口，流清理和解除固定后释放槽位。
- 日常结果操作使用按账号保存的一个全局操作 Key，只读取令牌元数据；选择 Key 时读取 pins/routes，执行后读回对应关系。
- 两者共用令牌身份锁。测试拒绝覆盖已有日常固定。新日常固定不创建恢复租约；历史租约保留兼容恢复入口。
- 不扫描或匹配 DSH 提供商凭据，不为日常操作读取 Key 明文，不周期扫描令牌和关系。

## 2. 控制面接口

| 用途 | 方法与路径 | 约束 |
| --- | --- | --- |
| 账户校验 | `GET /api/user/self` | 返回账号必须与配置的用户 ID 一致 |
| 令牌列表 | `GET /api/token/search?p=…&page_size=100` | 按 total 收敛、按 ID 去重；重复页不能当完整列表 |
| 测试令牌密钥 | `POST /api/token/{id}/key`，body `{}` | 仅 Host 为自动测试按需读取，当前请求超时 10 秒 |
| 固定列表 | `GET /api/marketplace/pins` | 身份是账号 + token_id + model_name |
| 固定渠道 | `POST /api/marketplace/pin` | body 含 token_id、model_name、channel_id、fallback_to_smart_routing；测试关闭 fallback |
| 解除固定 | `POST /api/marketplace/unpin` | 明确指定 token、model、channel |
| 路由列表 | `GET /api/subscriptions` | 与 pins 分开维护；Host 筛选所选 Key |
| 新建路由池 | `POST /api/subscriptions` | token_id、model_name、channels、caps、sort_strategy |
| 追加路由渠道 | `PATCH /api/subscriptions/{id}/channels` | body `{channel_id}`；不覆盖已有渠道集合 |
| 请求账单 | `GET /api/log/self?request_id=…&p=…&page_size=100` | 精确核对 request_id、token、model；检查分页完整性 |
| 金额换算参数 | `GET /api/status` | quota_per_unit、usd_exchange_rate 必须有效 |

同一 Key 的同一模型只能固定一个渠道；路由池可以包含多个渠道。固定和加入路由均以站点读回为准，未知或失败不提前点亮。已点亮标签不执行删除。

控制面共用有界请求队列，处理 429 的 `Retry-After` 或 `x-ratelimit-reset`。账号 generation 阻止切换账号后的旧请求写回；关系读写另有 epoch、single-flight 与写后读回屏障。

## 3. 模型调用与限流

自动测试使用普通 Key 向模型网关请求，先通过 pin 确保命中目标渠道。`sk-<key>-<channelId>` 是站点广场自助测试形态，不用于当前采样。

历史截图中的每账号 5 次/分钟、每渠道 20 次/分钟属于广场自助测试限制，不能套成普通模型调用或市场接口的统一配额。普通调用仍可能受到渠道、账户或上游限流；失败按真实错误展示，不自动重发推理。

## 4. 市场快照字段

报价由网页在选择时传入，Host 记录历史快照，不重新抓取全量市场覆盖已有测试目标。

| 原字段 | 单位或用途 |
| --- | --- |
| listing_id、channel_id、supplier_id、model_name | 渠道/模型复合身份 |
| charge_type | per_token 或 per_request |
| pricing_currency、pricing_unit | 原币种及 per_1m_tokens / per_request |
| input_price_micros、output_price_micros | 原币种的百万分之一；除以 1,000,000 得每百万 Token 报价 |
| cache_read_price_micros、cache_write_price_micros | 同上，缓存读取/写入报价 |
| per_request_price_micros | 除以 1,000,000 得每请求报价 |
| cache_hit_rate_24h、cache_hit_state | 基点，10000=100%；先判断状态，缺失不能当 0 |
| p50_ttft_ms、recent_p50_ms | 首字延迟与端到端延迟，不能混用 |
| throughput_tps | Token/秒 |

USD 报价转人民币采用 `/api/status.usd_exchange_rate`，保留获取时间。`realtime_ratio_cny` 是倍率，`realtime_ratio_exchange_rate` 是倍率快照所用汇率，不能代替展示汇率。报价、市场近 24h 缓存率与本次实际费用/缓存用量分别展示。

市场接口历史观察仅供脚本适配参考：

- `GET /api/marketplace/public/channels/search` 当时匿名可用，参数使用 query string；model 为精确名。
- page_size 大于 100 时曾缺少 b24/b7d/cache_hit_rate_24h；越界页曾被夹回末页。若后续适配分页，必须按 total 收敛并去重，不能依赖空页结束。
- 市场读接口曾返回 HTML 429 和 `x-ratelimit-reset: 3`，观测到每 IP 30 请求/3 秒；这不是当前可用额度或请求安全性的保证。
- 站点的测试按钮开关与协议枚举只反映站点自测能力，不等于插件可执行能力。

## 5. 请求账本与概览

每次实际数据面请求独立保存 execution；失败重试追加新流水。record 是测试定义，attempt 是一轮执行，均不等于一次 HTTP 请求。控制面失败尚未发送采样时不能增加实际请求数；发送后中断保留不确定状态，不猜免费。

传输在 HTTP 错误检查前捕获 `X-Oneapi-Request-Id`，账单 worker 按此查询。日志行的 id 曾在不同查询中重复，不能作为跨请求唯一身份。响应正文 id 也不能默认等于站点 request_id。

日志保留 quota、prompt_tokens、completion_tokens、type、other 等事实；type=2 为消费、5 为错误、6 为退款。多消费、退款、身份不符、request ID 冲突或分页不完整均保留 ambiguous，不把多行盲目相加。

人民币展示口径：

```text
USD 等值 = quota / quota_per_unit
CNY 展示等值 = USD 等值 × usd_exchange_rate
```

保留原始额度及首次有效换算基准，不使用渠道挂牌价补实际费用，不将人民币等值声称为用户充值现金成本。

- 已观察金额与完整结算分开；未查询到日志、无 request ID 或认证失败不算零费用。
- Token 优先使用可确认账单，其次为标明来源的流用量；同一 execution 不重复相加。
- 概览范围为本轮或当前记录全部轮次，包含重试；不是整个账号的日常用量。
- 账单采用有界延迟补查；取消采样不代表退款。删除记录阻止晚到回写，重启只补账、不重发模型请求。
- `/api/log/self/stat` 已观察到 quota/rpm/tpm，不能据此推导总请求数和输入/输出分列。

## 6. 仍需真实样本确认的边界

- 普通数据面 request ID 头在不同协议和失败路径中的覆盖情况。
- 退款、预扣、补扣和最终结算的唯一事件关联及符号。
- 账单延迟、分页上限和 total_capped 的长期行为。
- Host 当前取测试 Key 的延迟与限流分布；历史浏览器自动化超时不能证明该接口不可用。

上述事项未完成验证，不因旧计划被删除而视为已验收。
