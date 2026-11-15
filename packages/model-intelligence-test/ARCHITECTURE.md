# 插件架构

## 边界与调用链

```text
a6api 页面 / Tampermonkey（发令器，只发一次 POST，不参与执行）
 ├─ 独立表格列、跨分页渠道选择 Map
 ├─ 测试令牌 {id,name} → localStorage(origin + accountId)
 └─ 清单 → POST <Host>/mit-a6/select  (header x-mit-intake)
          ↓ 单向；无轮询、无确认、无回传
Host webServer /mit-a6/select
 ├─ backend/a6/intake.js  口令鉴权 → selection 队列（list / selection）
 ├─ backend/a6/site.js    访问令牌直连 a6api 控制面：pin / unpin / pins / token key / tokens
 ├─ backend/a6/transport.js 数据面：SSE → DSH StreamChunk（chat / messages）
 ├─ backend/a6/service.js  凭据保存、槽位校验、专项记录创建、手动固定/解除
 ├─ backend/a6/slots.js    跨任务测试令牌身份锁
 └─ backend/fingerprint/engine.js
       → pin 确认 → 取测试 key → 3 条共享挑战并发 → 全部流清理 → unpin → 下一项
       → 官方 BlockAssembler / AssistantStreamAccumulator → lmfpd-sdk

Client apply 生命周期
 └─ a6api service → datasource → store（2 秒轮询 intake revision）
       → sidebarRight.openTab → 专项创建页
       → evaluations 接收已持久化记录 → 共用指纹结果/诊断页
```

普通指纹不经过站点，仍使用 DSH 真实模型目录（`llm.prepareCall`）。a6api 专项不走 `prepareCall`：它用自己的 key 和 HTTP 直连，因此也不要求该 key 被注册成 DSH 提供商。自定义任务仍由明确标注的 Mock 域运行。Host/Client 只共享无环境依赖的 `shared/contract.js`，没有浏览器导入 backend。

## 为什么是单向

网页侧唯一职责是**发令**：把"要测哪些渠道、用哪些令牌"送过来。真正的执行全在 Host：

- 固定渠道、取测试 key、解除固定都用账户访问令牌（`authorization: <token>` + `new-api-user: <userId>`，站点专门支持这条无 cookie 通道）；
- 因此不需要网页在线、不需要拿 cookie 做写操作、不需要命令通道。

早先的双向配对（capability + poll + ack + 租约）已整体删除：它解决的问题（谁来 pin）由宿主自己接管后就不存在了。

## 状态所有权

| 所有者 | 数据 |
| --- | --- |
| 油猴内存 | 渠道选择、受限字段响应缓存、令牌列表 |
| 站点 localStorage | 按账号隔离的测试令牌 ID/name；卡片布局 |
| GM 存储 | Host 接入点 `{origin, intake}`，不存测试 API key |
| Host `A6Site` | 访问令牌与用户 ID（内存），以及掩码视图 |
| Host `A6Intake` | 导入口令（持久化）、已收到的 selection 队列 |
| Host `A6Service` | 凭据持久化、test key 10 分钟缓存、手动固定租约 |
| Host `FingerprintEngine` | 挑战、队列、槽位、真实采样/指标/分析与 revision |
| Host `RecordsService` | records、attempts、固定目标快照及请求持久化 |
| Client a6api 域 | selection 镜像、专项草稿、配置表单 |
| Client evaluations 域 | 记录/请求镜像与稳定 run 投影 |
| 其余 Client 域 | 普通草稿、目录、预设、页签、纯展示状态、确认框 |

## 身份与用户选择

待测项用模型、listing/channel/supplier 复合身份；记录和 run 的稳定 provider 是 `a6api:<channelId>:<supplierId>`，不是动态领取该项的 worker。实际用的是哪个测试令牌记为 `slotTokenId`，路由阶段记为 `routing`。同模型不同渠道不能合并。

槽位就是测试令牌本身（1–8 个），用户勾选为准，不做 key 指纹比对、不改 DSH 提供商配置。

## 动态槽位与原子性

每个测试令牌一个 worker，跨任务锁键为 `站点:账号:tokenId`。worker 领取一项后：`pin` → 校验 `route_effective` → 取 key → 原子预留三条请求容量 → 三条挑战同时发送 → `Promise.allSettled` 等所有流和迭代器清理 → 释放容量 → `unpin` → 下一目标。

三题不拆批；取消、单题失败、超时都不能让令牌在兄弟请求结束前换渠道。普通任务与专项共用 18 路全局在途请求池。每个 sample 的超时从真正请求准备开始。

固定未生效（`route_effective:false`）时**零采样请求**并直接失败：否则回答会记到错误渠道名下。解除固定失败则整个任务失败并提示人工处理，不带着不确定的固定状态继续跑。

## 任务终态

`engine.complete()` 统一决定终态：只要没有任何模型完成，任务记为 `failed` 而不是 `done`；`RecordsService.persistJob` 把同一结论写进 attempt.status。取消仍是 `cancelled`。

## 持久化与生命周期

`model_intelligence_test` 保留 records/attempts，版本不改以保留历史；`model_intelligence_settings` 的 auth 表保存 a6api 凭据（`a6-site`）与导入口令。运行时启动把旧 queued/running attempt 标为 interrupted，不自动重发推理。

Cordis effect 管理 web 路由、UI 注册、样式与 store。Client dispose 停止轮询与监听；油猴 pagehide 撤销 hooks/observer/列与计时器，BFCache pageshow 重建。Host dispose 中止采样。关闭内部页签不取消任务；显式取消/删除/清空才中止。

## 构建约束

视图订阅 store 并调用 action，不做 IO、无 useState/useReducer；store 只经同名 datasource，实际 IO 在 service/Host transport。React 仅来自 DSH ModuleLoader。新 CSS 限定 `.mit-workbench`，feature styles 由构建统一拼接注入，不能依赖额外未加载的 CSS 文件。`lib/` 由 `pnpm build` 生成，不手改。
