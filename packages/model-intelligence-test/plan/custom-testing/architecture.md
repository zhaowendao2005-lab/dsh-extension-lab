# 自定义测试模块架构草案

状态：初稿（设计评审材料；不代表已实现或已获得真实 Agent 沙箱权限）

## 1. 架构原则

1. **同一编排器、两个执行适配器**：普通 DSH 模型和 a6api 渠道只在 Host 执行适配器不同，创建、排队、监控、取消、账单和结果投影共享。
2. **Host 持有事实和权限**：会话、沙箱、文件、凭据、请求和账单均由 Host 管理；Client 只提交严格契约并订阅摘要。
3. **每模型独立运行单元**：每个目标拥有独立 `modelRunId`、会话、沙箱和执行账本，不能共享写目录。
4. **最小权限默认拒绝**：沙箱没有网络、工作区、其他模型目录、凭据和任意终端权限。能力只能由 Host 根据预设显式授予。
5. **可恢复但不重发**：Host 重启后恢复任务和会话状态；未确认的推理不自动重发，使用 `interrupted`/`unknown`，由用户显式重试。

## 2. 建议模块

```text
frontend/
  views/custom/
    CustomEntryView.tsx       # 两个入口共用
    CustomCreateView.tsx      # 目标、预设、并发、输出配置
    CustomMonitorView.tsx     # 任务总览和模型行
    CustomRunView.tsx         # 极简会话详情
    CustomOutputView.tsx      # 安全文件预览入口
  stores/custom.stores.ts     # 唯一状态/动作入口
  stores/custom.datasource.ts # Remote 与前端导航适配
  service/custom.service.ts   # 仅浏览器侧持久化/导航

backend/custom/
  service.js                  # 生命周期和 Remote facade
  orchestrator.js             # 队列、并发、取消、恢复
  run-adapter.js              # 适配器接口
  dsh-adapter.js              # 普通模型执行
  a6-adapter.js               # a6api 固定/取 key/采样/解固定
  sandbox.js                  # 路径、模板、权限和文件声明
  session.js                  # 会话事件、极简详情和允许会话
  output.js                   # 输出验证、预览授权和元数据
  ledger.js                   # 每次实际请求的 execution/账单关联
  domain.js                   # 任务、modelRun、文件和事件 schema
shared/
  custom-contract.js          # 严格 Remote 输入/输出投影
```

模块名只是建议，实施时应复用现有 `backend/records`、`backend/a6/ledger` 和 DSH 已有会话/文件服务，避免复制一套存储或导航协议。

## 3. 核心数据模型

### 3.1 CustomTask

```js
{
  id,
  status: 'draft' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted',
  source: 'dsh' | 'a6api' | 'mixed',
  preset: { id, version, prompt, rulesVersion },
  concurrency: { requested, effective },
  output: { format: 'html', relativeFile },
  createdAt,
  startedAt,
  finishedAt,
  modelRunIds: []
}
```

### 3.2 ModelRun

```js
{
  id,
  taskId,
  target: {
    kind: 'dsh' | 'a6api',
    providerId?, modelId, displayName,
    channelId?, supplierId?, marketSnapshot?
  },
  status,
  phase: 'queued' | 'preparing' | 'running' | 'validating' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
  sandboxId,
  sessionId,
  output: { declaredFile, state, size?, modifiedAt?, validation? },
  usage: { requestCount?, inputTokens?, outputTokens?, cost?, billingState? },
  error?,
  startedAt?, finishedAt?
}
```

`target` 只保存身份和必要快照，不保存 API key、账户访问令牌、完整响应或 prompt 中的机密。a6api 目标沿用现有 channel/model 复合身份，不能只用动态 worker 的 token 作为稳定 ID。

### 3.3 事件

建议事件为 append-only：`task/created`、`task/started`、`run/queued`、`session/event`、`execution/started`、`execution/settled`、`output/validated`、`run/finished`、`task/finished`、`task/cancelled`。事件需要 generation/epoch，删除或取消后的晚到回调必须被拒绝。

## 4. 创建和执行时序

```text
入口（插件端 / 指纹结果）
  -> 只提交目标身份
Host custom.create
  -> 校验来源、预设版本、并发、输出相对路径
  -> 为每个目标创建 modelRun + sandbox + session
  -> 快照 RULES.md/config.json/prompt
  -> orchestrator.enqueue
  -> 返回 taskId + 初始摘要

orchestrator worker
  -> acquire global capacity
  -> adapter.prepare(run)
  -> session.start(run)
  -> adapter.execute(run, sandbox capabilities)
  -> output.validate(config/output file)
  -> ledger settle request facts
  -> release capacity
  -> finish run
```

普通适配器应尽量复用 DSH 的模型调用和取消语义；a6api 适配器继续调用现有 `A6Site`/`transport`，且必须先确认固定关系再发数据面请求。两者都通过统一的 `RunAdapter` 报告事件和账单事实。

## 5. 沙箱和权限模型

### 5.1 路径

Host 为每个 `modelRunId` 创建不可猜测的目录名，并通过真实路径检查、realpath、符号链接检查和相对路径规范化阻止越界。`config.json.output.file` 只能指向沙箱内的 `output/`，首版只接受 `.html` 文件。

### 5.2 能力

建议将能力拆成显式集合，而不是把完整 Host context 暴露给 Agent：

```text
sandbox.readRules
sandbox.readInput
sandbox.writeOutput
sandbox.statOutput
sandbox.declareOutput          # 受限更新 config.json.output.file，不授予任意配置写入
session.emit
```

默认不授予：`network`、`workspace.read`、`workspace.write`、`credentials.read`、`provider.configure`、`shell.exec`、`browser.navigate`。

### 5.3 HTML 预览隔离

输出打开动作返回受 Host 授权的文档资源，而不是裸磁盘路径。预览采用无同源权限 iframe，允许运行 Canvas 动画所需脚本；结合资源策略阻止顶层导航、父窗口访问、网络加载及外部资源下载。需要确认 DSH 当前文档预览/文件资源 provider 是否能表达该授权边界；不能直接假设普通 iframe sandbox 属性足够。

## 6. 并发、锁与取消

- `orchestrator` 只负责自定义任务槽位；普通指纹/a6api 自动采样仍接入现有全局容量闸门。
- 目标锁键建议为 `custom:<taskId>:<modelRunId>`，外部资源锁继续沿用 a6api 的站点/账号/token 身份锁。
- a6api run 的锁顺序必须与现有专项一致：锁测试令牌 → pin/确认 → 取 key → 发送请求 → 清理流 → unpin/确认 → 释放锁。
- 取消先将任务置为 cancelling，停止领取新 run；在途会话得到 AbortSignal，清理完成后才允许释放模型和 a6api 令牌锁。
- 调低并发只影响尚未领取的 run，不抢占已开始请求。
- 删除必须先拒绝新写入，再等待在途回调结算；有持久租约或未确认 a6api 固定时拒绝删除并给出恢复指引。

## 7. Remote 契约草案

首版建议只暴露以下最小面：

```text
customTaskCreate(input) -> { task, runs }
customTaskList(input) -> { tasks, revision }
customTaskView({ taskId }) -> { task, runs, eventsSummary }
customTaskCancel({ taskId }) -> { task }
customRunRetry({ runId }) -> { taskId, runId }
customOutputOpen({ runId }) -> { resourceAddress, metadata }
customTaskDelete({ taskId }) -> { ok }
```

输入必须严格校验：目标身份、预设 ID/version、并发范围、输出文件相对路径。任何 API key、account access token、绝对路径、任意工具名称和未知字段都拒绝。

Client store 以 task revision 和 run generation 丢弃旧响应；监控使用 Host 推送/订阅能力时优先，否则使用有界轮询，不让断线伪装成任务失败。

## 8. 结果和会话 UI

监控页采用信息密度优先的工作台布局：

- 顶部显示任务状态、并发和整体计数。
- 主表每行一个 modelRun，状态、阶段、耗时、输出和账单列固定位置。
- 行点击打开右侧会话栏；右侧栏只显示该 run 的事件和允许会话摘要。
- 输出文件使用文件图标按钮和 tooltip；未通过验证时禁用打开。
- 任务级取消/删除放在显式菜单，避免关闭右侧栏触发副作用。
- 不把每个模型做成嵌套卡片；重复行用紧凑表格，遵守现有 `.mit-workbench` 样式约束。

## 9. 持久化建议

继续使用现有 `model_intelligence_test` records domain，新增自定义任务相关表或 additive 字段，不修改版本导致历史记录丢失：

- `custom_tasks`
- `custom_runs`
- `custom_events`
- `custom_outputs`
- `custom_executions`

设置和凭据仍进入现有 settings/auth domain；沙箱真实文件由 Host 文件/沙箱服务管理，Client 不直接写文件。预设版本可持久化在浏览器或 Host，但运行时必须保存不可变快照。

## 10. 需要 DSH 平台确认的问题

在 P0 结束前必须通过官方 Host/Client inspect 或小型无副作用 spike 确认：

1. 是否存在可由插件创建、限制能力并独立销毁的 Agent/Session API。
2. Agent 工具调用能否把文件写入指定 sandbox，而不是当前工作区。
3. 是否支持无网络、无工作区、无凭据的能力清单。
4. 会话允许列表能否在 UI 中只展示当前 run 的授权资源。
5. 文件预览资源能否安全地暴露单个 HTML 文件，并阻断同源/网络逃逸。
6. Host 任务恢复、取消和插件 dispose 的语义，尤其是晚到写入和未知推理状态。
7. 账单/请求 ID 能否覆盖普通 DSH 与 a6api 两种适配器。
8. DSH UI 是否已有可复用的极简会话右栏 slot，而不需要复制聊天壳。

若关键隔离能力无法满足，明确记录平台缺口与受阻范围；Mock 或只读展示不计为真实自定义测试完成。

## 11. 分阶段实施计划

### P0：平台契约与任务骨架

- 通过 `cordis_inspect` 确认会话、沙箱、文件预览及右栏契约，记录能力缺口。
- 定义 shared schema、Host domain、orchestrator 状态机和 Client 监控投影。
- 实现时同步调整当前禁止自定义 Agent 沙箱的包内规则，使其与经确认的隔离方案一致。

### P1：普通 DSH 适配器

- 复用 DSH 现有会话/模型调用契约。
- 单模型、单 HTML 输出、无网络沙箱。
- 验收文件权限、结果打开和费用未知态。

### P2：a6api 适配器

- 复用 A6Site、transport、slots 和 ledger。
- 执行 pin/确认、请求、清理和 unpin；固定未确认时零请求。
- 按现有账号、token、channel 锁与恢复约束验收。

### P3：产品化

- 双入口、右栏会话、任务恢复、账单和清理策略。
- 无同源预览和文件授权验收。
- 独立 UI/安全审查，最后才考虑发布或安装。

## 12. 与现有模块的关系

- 不修改普通指纹的挑战与评分语义；自定义输出不进入指纹评分。
- 不改变 a6api 油猴的单向发令协议；新增入口读取已有 Host selection 镜像。
- 不复制全局操作 Key UI；自定义 a6api run 使用自动采样凭据和现有槽位锁，结果行的日常固定/路由仍是独立功能。
- 复用现有 ledger 的“每次实际请求独立 execution、未知不算零”原则。
- 复用现有删除保护、generation/epoch 和 Host dispose 约束。

## 13. 文档范围

本目录描述待实现方案；当前插件行为以 [插件架构](../../ARCHITECTURE.md) 和 [a6api 接入说明](../../docs/a6api.md) 为准。
