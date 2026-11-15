# 插件架构

## 边界与调用链

```text
a6api 页面 / Tampermonkey
 ├─ 独立表格列、跨分页渠道选择 Map
 ├─ 测试令牌 {id,name} → localStorage(origin + accountId)
 ├─ GM 连接配置 → 配对本机 bridge
 └─ 同源站点 pin / restore / subscriptions（登录态不离开页面）
          ↕ 仅 selection / poll / ack
Host webServer /mit-a6/bridge/*
 ├─ backend/a6/bridge.js → 随机 capability + 页面/账号绑定 session
 ├─ backend/a6/service.js → 用户手动映射、专项记录创建、快捷操作
 ├─ backend/a6/slots.js → 跨任务测试令牌身份锁
 └─ backend/fingerprint/engine.js
       → pin 确认 → DSH prepareCall/stream × 3 → restore → 下个待测项
       → 官方 BlockAssembler / AssistantStreamAccumulator → lmfpd-sdk

Client apply 生命周期
 └─ a6api service → datasource → store（selection 常驻轮询）
       → sidebarRight.openTab → 专项创建页
       → evaluations 接收已持久化记录 → 共用指纹结果/诊断页
```

普通指纹不经过站点桥，仍使用 DSH 真实模型目录。自定义任务仍由明确标注的 Mock 域运行。Host/Client 只共享无环境依赖的 `shared/contract.js`，没有浏览器导入 backend。

## 深链接的真实能力

当前 Electron 对 `dsh://open` / `dsh://open/` 做精确匹配，只聚焦安装版窗口，没有通用插件 URL 分发。选择数据先由 GM 请求送进 Host，原生唤起后 Client 从同一 Host feed 获取，官方 `sidebarRight.openTab(kind,{params})` 负责面板导航。Client 启动即创建全局 workbench，不等 Panel 挂载；侧栏没有会话 surface 时保存待激活 ID，下次轮询继续尝试。已消费选择 ID 只记在 Client sessionStorage，避免重复抢焦点。

独立开发 Host 与安装版 Host 不一定相同；Web 备用 URL 指向实际配对 origin。原生协议不是切换 profile/Host 的通道。

## 状态所有权

| 所有者 | 数据 |
| --- | --- |
| 油猴内存 | 渠道选择、受限字段响应缓存、连接 session、命令去重与执行状态 |
| 站点 localStorage | 按账号隔离的测试令牌 ID/name、固定补偿 lease；卡片布局按站点保存 |
| GM 存储 | 本机 bridge 配对配置，不存测试 API key |
| Host A6Bridge | 页面连接、selection feed、待 ACK 操作、重启恢复租约 |
| Host A6Service | 用户映射偏好、明确的单目标手动操作 |
| Host FingerprintEngine | 挑战、队列、槽位、真实采样/指标/分析与 revision |
| Host RecordsService | records、attempts、固定目标快照及请求持久化 |
| Client a6api 域 | selection 镜像、专项草稿、映射和操作反馈 |
| Client evaluations 域 | 记录/请求镜像与稳定 run 投影 |
| 其余 Client 域 | 普通草稿、目录、预设、页签、纯展示状态、确认框 |

## 身份与用户选择

待测项用模型、listing/channel/supplier 复合身份；记录和 run 的稳定 provider 是 `a6api:<channelId>:<supplierId>`，不是动态领取该项的 worker。实际推理提供商单独记为 `callProvider`，令牌记为 `slotTokenId`，路由阶段记为 `routing`。同模型不同渠道不能合并。

槽位使用 `{tokenId,provider}`，用户手动选择为准，不读取 key、不自动比较 credential、不改提供商。只检查必要结构、令牌在用户已选择列表中、provider 仍已注册；模型目录对专项是展示信息，不额外要求所有提供商广告每个待测模型。

## 动态槽位与原子性

每个测试令牌一个 worker，跨任务锁键为站点/账号/tokenId。worker 领取一项后：等待原账号网页在线 → pin 并读回 → 原子预留三条全局请求容量 → 三条请求同时发送 → `Promise.allSettled` 等待所有流和迭代器清理 → 释放请求容量 → 恢复原固定 → 下一个目标。

三题不拆批；取消、单题失败、超时不能使令牌在其他兄弟请求结束前切换渠道。普通任务与专项共用 18 路全局在途请求池。页面离线等待不启动 sample 计时器；每个 sample 的超时从真正请求准备开始，降低限时不抢占，提高限时才延长在途请求。

## 桥接与恢复

所有网页调用需 capability 配对或页面 session 凭据；session 绑定站点/account/page。桥只监听现有 webServer 的 loopback origin，校验 Host 和 Origin，JSON 请求限长，不向浏览器开放任意 Remote/模型调用或 credentials。

pin 命令发送前 Host 持久化恢复意图，油猴发写请求前保存 previous/target lease，并关闭 fallback。成功 pin 必须 ACK verified。纯前置失败通过 notApplied 证明无写入；不明结果不能伪装未写入。

restore 比对当前固定与 lease.target/previous：已经恢复则可幂等确认；外部改动不覆盖；失败保留补偿数据。恢复租约重启后只向同站点同账号页面补发，恢复未完成前不分配新的固定任务。恢复操作允许测试令牌已取消勾选，其他写操作仍只能针对已选测试令牌。

## 持久化与生命周期

`model_intelligence_test` 保留 records/attempts，版本不改以保留历史；`model_intelligence_settings` 的 auth 表保存按 profile/账号隔离的槽位偏好以及恢复 lease，不再保存 API key。运行时启动把旧 queued/running attempt 标为 interrupted，不自动重发推理。

Cordis effect 管理 web 路由、UI 注册、样式与 store。Client dispose 停止所有轮询和监听；油猴 pagehide 撤销 hooks/observer/列与计时器，BFCache pageshow 重建。Host dispose 中止采样，未完成恢复由持久化 lease 接续。关闭内部页签不取消任务；显式取消/删除/清空才中止。

## 构建约束

视图订阅 store 并调用 action，不做 IO、无 useState/useReducer；store 只经同名 datasource，实际 IO 在 service/Host transport。React 仅来自 DSH ModuleLoader。新 CSS 限定 `.mit-workbench`，feature styles 由构建统一拼接注入，不能依赖额外未加载的 CSS 文件。`lib/` 由 `pnpm build` 生成，不手改。
