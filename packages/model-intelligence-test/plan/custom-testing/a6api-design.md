# a6api 自定义测试专项设计

状态：初稿（设计材料；不代表当前已实现）

## 1. 目标

a6api 自定义测试复用普通自定义测试的任务、运行单元、监控和结果模型，但使用 a6api 的渠道身份与 Host 账户凭据执行。网页只负责提交选择，不能成为执行依赖。

需要保持的既有原则：

- a6api 网页/油猴是一次性发令器，发送选择清单后退出。
- Host 使用账户访问令牌调用控制面，使用专用测试 Key 调用数据面；现有接口与金额口径见 [a6api 接入说明](../../docs/a6api.md)。
- 测试 key、账户令牌和操作 key 永不进入 Client、浏览器 localStorage、任务 prompt 或沙箱。
- 固定未读回确认时，不发送任何数据面请求。
- 自动测试槽位与结果页的全局操作 Key 是两种不同用途，不能互相覆盖。

## 2. 两个入口，一个 Host 流程

### 2.1 插件端入口

插件端“自定义测试 → a6api”读取 Host 中最近一次有效 selection 镜像，展示渠道、模型、供应商、价格/缓存率快照和可选测试令牌。用户可删除或补充目标后提交同一 `customTaskCreate`。

没有 selection 时，显示“从 a6api 网页导入”操作，导航到现有接入说明，不在插件里伪造渠道搜索或要求粘贴 API key。

### 2.2 指纹结果端入口

结果行上的“创建自定义测试”把当前 a6api channel/model 身份和创建时的 market snapshot 带入向导。它不复制完整响应、账单原文、测试 key 或操作 Key。

### 2.3 汇聚规则

两种入口都只产生统一的目标：

```js
{
  kind: 'a6api',
  modelId,
  channelId,
  supplierId,
  displayName,
  marketSnapshot
}
```

Host 再根据当前任务配置分配测试令牌。入口不得各自实现一套 a6api 调度逻辑。

## 3. a6api 运行时序

```text
读取 selection / 结果身份
  -> Host 校验 account、channel、model 和快照
  -> 每个目标创建独立 modelRun、session 和 sandbox
  -> worker 获取共享测试令牌锁
  -> pin 到目标渠道，关闭智能兜底
  -> GET pins 并确认 route_effective / channel 身份
  -> 取得该测试令牌的实际 key（仅 Host 内存）
  -> 在当前 sandbox 会话中执行自定义 prompt
  -> 采集请求 ID、流和 usage
  -> 清理所有流与迭代器
  -> unpin 并确认恢复
  -> 校验声明输出文件
  -> 释放 token 锁，领取下一目标
```

自定义任务可能有多个模型输出步骤，但固定关系的生命周期必须覆盖所有数据面请求。不得在第一步完成后提前解除固定，也不得在流仍未清理时复用测试令牌。

如果 `route_effective` 为 false、渠道身份不匹配、key 获取失败或固定状态不确定，run 直接失败且请求数为零。unpin 失败时停止领取新目标，并在监控面板显示需要人工核对的状态。

## 4. 与现有 a6api 功能的关系

| 功能 | 自定义测试中的使用方式 |
| --- | --- |
| `/mit-a6/select` | 仍只用于网页把选择清单送入 Host；不增加回传或轮询协议 |
| `A6Site.tokens/pins/pin/unpin` | 由 Host 适配器按任务执行，不由 Client 直接调用 |
| `A6Site` 账户访问令牌 | 仅 Host 持有，按当前账号 generation 隔离 |
| `slots.js` | 继续提供站点/账号/测试令牌跨任务锁 |
| `transport.js` | 继续提供 Host 侧 SSE/消息流解析和取消 |
| `ledger.js` | 每次实际请求独立 execution；重试或重新运行追加流水 |
| `operations.js` | 只服务结果页全局操作 Key 的固定/路由，不被自定义测试复用 |
| 旧恢复租约 | 保留兼容恢复入口；自定义测试的固定由运行单元清理，日常操作不创建新租约 |

## 5. 渠道快照和账单

创建任务时使用 selection 或结果记录携带的 market snapshot，不能在运行中用新的市场列表覆盖历史目标。快照至少包含价格单位、输入/输出/缓存价格、币种、展示汇率和缓存命中率状态。

实际费用独立于市场报价：

- 请求前登记 execution。
- 从数据面响应获取 request ID（如可用）。
- 请求结束后异步查询 a6api 日志并校验 request ID、token、model 和时间归属。
- 多消费事件、退款、不完整分页、鉴权失败或无 request ID 时显示未知/ambiguous，不当作零费用。
- 结果页展示“报价快照”和“实际结算”两套字段。

自定义任务的 token 和费用统计必须能按 task、modelRun、attempt、execution 分层汇总，避免多个模型或重试相互覆盖。

## 6. 监控面板中的 a6api 专项信息

任务总览额外显示：

- a6api 账号显示名（不显示访问令牌）。
- 当前使用的测试令牌名称/ID 掩码。
- 当前渠道和供应商。
- 固定状态：未开始、已确认、失败、解除中、已解除、未知。
- 站点请求、数据面请求和实际账单的分离计数。

模型详情的“允许会话”区域显示：

- 当前会话只能使用哪个 channel/model 身份。
- 当前沙箱根目录和声明的输出文件。
- 允许的文件能力：读取规则、读取输入、写入输出、提交状态。
- 禁止网络、工作区、其他模型目录、凭据和操作 Key。
- 当前测试令牌锁和固定生命周期（只显示 ID/名称，不显示 key）。

它是权限和生命周期摘要，不是让用户编辑 Host 凭据的设置页。

## 7. 并发和限流

- 用户请求并发数是任务级上限，Host 仍需应用全局请求池和供应商限流上限。
- 一个测试令牌同一时刻只服务一个 a6api modelRun；一个 modelRun 同一时刻只写自己的沙箱。
- 不通过 `sk-<key>-<channelId>` 广场自助测试后缀绕限流；走已有固定渠道 + 普通 key 的正常数据面。
- 429、Retry-After 和站点冷却由 Host 处理；失败退避不能把同一批请求立即重发到同一窗口。
- 任务级并发降低是非抢占的，只影响尚未领取的 run。

## 8. 错误和恢复

错误至少分为：

- `selection-stale`：导入清单的账号/渠道快照过期。
- `pin-not-confirmed`：固定未读回或身份不匹配。
- `token-busy`：测试令牌被其他任务或租约占用。
- `a6-rate-limited`：站点或渠道限流。
- `stream-failed`：数据面流中断。
- `output-invalid`：输出文件缺失、越界或格式不符。
- `unpin-unknown`：解除固定结果未知，需要人工核对。
- `billing-ambiguous`：账单无法安全归属。

Host 重启或插件 dispose 后，未完成 run 进入 `interrupted`/`unknown`，不自动重新固定或重新推理。用户显式恢复前，优先检查站点固定状态和测试令牌锁。

## 9. 安全验收

1. 浏览器断开后任务仍可在 Host 运行；浏览器重新打开只能读取摘要。
2. Client wire 中没有账户访问令牌、测试 key、操作 key 或完整 Authorization。
3. 任何输出文件路径在 Host realpath 校验后才可打开。
4. HTML 预览不能访问父页面、工作区、网络或其他模型输出。
5. a6api 固定未确认时，账单和请求数均为零，而不是把其他渠道响应记入当前目标。
6. 任务删除、取消、账号切换和插件销毁都能阻止晚到回调写入旧 run。
7. 旧版指纹采样、结果页固定/路由和油猴选择协议的行为保持不变。

## 10. 待确认问题

- a6api 自定义任务是否允许一个 prompt 产生多次数据面请求；若允许，需明确每次请求的固定生命周期。
- `transport.js` 的普通 chat/messages 请求是否支持自定义 Agent 所需的工具事件和文件事件；不能默认沿用指纹采样的 assembler。
- DSH Host 是否已有可限制到单个沙箱的 session/agent capability API。
- a6api 账单日志是否能稳定关联自定义会话产生的每一个 request ID。
- 取消时站点固定/解除固定和数据面 Abort 的最终顺序，需要用无费用的 Host mock 先验证。
