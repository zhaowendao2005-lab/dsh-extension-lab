# 插件内架构

## 依赖方向

```text
DSH ModuleLoader / plugin apply
  ├─ Host backend/service/catalog.js → llm.listProviders/listModels
  │                                   └─ backend/fingerprint/engine.js → llm.stream + lmfpd-sdk
  └─ Client composition root
       views → stores/*.stores.ts → *.datasource.ts
                   │                  ├─ *.mock.ts
                   │                  └─ frontend/service → Remote / browser storage
                   └─ shared frontend/types.ts
Host 与 Client 仅共享 shared/contract.js 的 wire schema。
```

## 状态所有权

| 域 | 唯一持有内容 |
| --- | --- |
| workbench | 页签身份、活动页签、侧栏、每页签导航 |
| draft | 创建名称、类型、选择模型、正文、搜索/选择器状态 |
| models | 真实目录及加载/错误投影 |
| presets | 浏览器预设、持久化错误、编辑器侧栏状态 |
| evaluations | 记录及按 runId 索引的逐模型运行事实 |
| presentation | 列显示/宽度、展开覆盖、跟随、筛选 |
| notice | 受控确认框及输入 |

创建记录使用 sessionId/testId/runId 明确身份。页签与侧栏只引用记录，不维护记录副本。运行快照包含最终 prompt、footerVersion、所用预设；页签关闭与任务生命周期分离。Mock 引擎按批次更新发生变化的行，对未改变 run 保持引用稳定。列表用行级 selector，不订阅整个运行字典。

`runtime.ts` 提供宿主 React 桥和 useSyncExternalStore 选择器。React 不作为运行依赖打包。选择器缓存同一状态快照的值；组件局部不持有业务状态，DOM ref 仅用于焦点或指针捕获。

## IO 与真实/模拟分流

模型目录的 datasource 只路由到 catalog transport。Host 读取已注册 adapter 广告的模型列表，不调用模型、不使用 endpoint discovery。逐供应商错误返回固定安全提示，避免透传含凭据的 adapter 异常。未注册 llm 时返回明确错误，目录永不回退到模拟数据。

`workbench.stores.ts` 是跨域用例编排器，连接草稿、预设和页签，但不直接导入 datasource。models/presets/evaluations 各域 controller 独占同名 datasource 和 IO 生命周期；presentation 等纯展示域不创建空 datasource。Mock 内部时钟与展示指标分离；TTFT = 首 Token − 请求开始，端到端速率 = 输出 Token / 请求耗时，生成速率 = 输出 Token / 首 Token 到生成结束耗时。多轮以各轮分母累加，排除排队和分析，缺失指标显示 `—`。

预设 service 是浏览器 storage 边界，进行版本/结构验证并暴露失败。评测 datasource 按类型分流：指纹走真实 Host transport + 前端投影，只有自定义任务走 Mock 引擎。业务不混入 view，后端不直接导入浏览器。

指纹运行事实只归 Host `FingerprintEngine` 持有：共享三题、按 provider/model 唯一身份采样、模型槽位调度、全局请求池、模型级分析和 revision 快照。调度单位是模型：同一模型的三条挑战始终并发，插件内最多 6 个模型槽位（默认 6）与 18 个同时在途请求（6×3），跨作业共享请求池，超出即排队。槽位并发与单请求时长（30–1800 秒）属于运行参数，可经 `fingerprintConfigure` 实时调整且**非抢占**：降低并发或时长不打断已开始的请求，只有提高时长会延长进行中的请求。`fingerprintStart/Configure/Retry/Status/Cancel` 均为 owner-only Remote；`fingerprintRetry` 只重发某个模型的失败样本，保留其已完成样本并重新分析，可从 `done` 重新打开为 `running`。真实调用用 `llm.stream`，SDK 只调用 `generateChallenges`、`loadDetector`、`analyze`，不使用需要 API key 的 `detect`。供应商错误正文先经 Host 脱敏（`sk-*`、`Bearer`、`api_key`/`authorization`/`token` 键值）再随采样下发 `errorDetail`（`source`/`code`/`status`/`text`/`stack`），供 UI 在「采样信息」里展示堆栈以便定位认证、限流或适配器异常；未脱敏原文永远不出 Host。每任务固定一个检测器与参考版本；参考库 TTL/缓存由 SDK 管理，格式不兼容需升级 SDK，无缓存失败绝不回退模拟。

指纹采样分别保存题目、原始回答、解析数量、状态、finish、usage 和时序；推理 delta 不进入数字分析。首可观察 delta（文本或推理）用于 TTFT，首至末 delta 用于生成耗时，单块无法测量则留空。跨样本速率仅使用同时存在 token 与时间的同一批样本，缺失为 `—`，指纹不生成模拟费用。SDK 的原始排序分数可为负；只有库内已校准概率才转成百分比。`completed` 表示检测流程结束，不保证 `scored`：UI 必须另呈现 partial/unscorable/not_model。

Mock 是确定性场景演示：可观察排队、首 Token 等待、生成、收尾、分析、成功/失败/超时/取消。费用明确模拟，匹配分数不标为概率。成果类型由 Mock Agent 样例决定，没有用户成果类型选择器；HTML/SVG 预览隔离，服务托管延期。当前仅允许内置 Mock 成果在 `sandbox="allow-scripts"` 的不透明来源 iframe 内执行绘图脚本；不授予 same-origin、表单、弹窗或顶层导航，CSP 禁止网络和嵌套 frame。此策略不授权以后直接预览任意 Agent 生成的 HTML；接入真实成果前须重新审查安全边界。

## 生命周期

入口按 DSH sessionId 懒创建 Workbench。关闭内部 tab 不销毁 store；显式删除/取消/清空及插件 dispose 请求中止 Host 作业。真实请求和轮询由独立生命周期标记保护，晚到响应不得复活记录。未拿到 jobId 时请求取消的意图保留到启动响应返回；断连只反映为连接错误，不伪造 Host 失败或取消。浏览器强制退出或永久断网不能保证取消命令送达，因此 Host 另有每请求超时及全局并发/记录上限。插件 dispose 停止 Mock 定时器与轮询并清空会话映射；Host dispose abort 所有作业。样式与右栏注册由 Cordis effect 返回 disposer。持久预设与清空记录分离。

## 静态约束与扩展

构建脚本通过 TypeScript AST 检查 view/components 不导入 service/datasource/mock、不出现组件业务状态或直接 IO；store 不越过 datasource；任何前端不导入 backend 或运行态 React。该规则是编译依赖防线，不代替人工审查或经过授权的行为测试。将来增加域时使用 `<domain>.stores.ts`，实际 IO 存在时再增加 datasource，无 IO 的 UI 域不创建空 mock。

规则限定在此包。根仓库构建脚本、插件市场、Extension Lab 全局规范均不修改。
