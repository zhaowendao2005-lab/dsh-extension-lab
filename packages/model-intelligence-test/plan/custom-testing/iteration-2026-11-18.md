# 自定义测试下一轮迭代计划（2026-11-18）

本轮输入（用户原话）：

1. 点击自定义测试的「继续会话」报错 `e.customRunContinue is not a function`。
2. 图 2 的位置新增一个视图，参照 `/Volumes/Lenovo/参考项目/vscode-main`。
3. 图 5 允许显示模型的输入/输出价格，以及 a6api 提供的缓存率，新增这几个字段。
4. 研究 DSH 常态使用的端口，在里面新增一个路径，便于在浏览器全屏查看这个面板并控制（不想占用过多端口，也不想出现端口占用；本意是右栏太小）。
5. 进一步分析、补充计划，落成计划文档。

当前状态：3.0.22 已发布并安装（油猴网络更新地址修复）；工作区另有未发布的指纹参考库 mtime 失效修复与「库未收录该 id」提示。真实推理只在用户明确要求时进行。

---

## 1. P0：继续会话 `e.customRunContinue is not a function`

### 根因（已定位）

客户端到 Host 的调用白名单是**手写数组**，与契约里的方法表是两份数据：

- `frontend/index.tsx:31-35` `const METHODS = ['catalog', 'recordsList', …, 'a6LedgerView']`，`transportOf()` 只按这个数组建方法；
- `shared/contract.js:104` `REMOTE_METHOD_NAMES = Object.keys(DESCRIPTIONS)`，3.0.20 新增的 `customRunContinue` 已在此表；
- `backend/service/catalog.js:107` `REMOTE_METHODS` 也已包含；
- 但 `frontend/index.tsx` 的 `METHODS` 漏了 `customRunContinue` → `transport.customRunContinue` 是 `undefined` → 点击时报 `is not a function`。

即：契约、Host 都支持，只有客户端白名单漂移。同理，`customRunDetail`/`customFileRead`/`customOutputOpen` 在表内，所以没暴露。

### 修复

1. `frontend/index.tsx`：`METHODS` 改为从 `shared/contract.js` 的 `REMOTE_METHOD_NAMES` 派生（`import { REMOTE_METHOD_NAMES, remoteInfo }`），保留一次类型断言 `satisfies readonly (keyof ModelIntelligenceTransport)[]`，从此**不可能再漂移**。
2. 构建期防回归：`scripts/build.mjs` 增加一条静态检查——客户端引用的方法集合必须等于 `REMOTE_METHOD_NAMES`（或至少断言 `customRunContinue` 等自定义方法存在）。
3. 发布独立版本（3.0.23），先修这个，不等其它项。

### 验收

`tsc --noEmit` 0 错误、build、client 探针（`evaluated OK / factory OK`）；GUI 上对一个 `failed` 的自定义轮次点「继续会话」，Host 侧应出现新的 resume 执行（`agents.resume`），而不是前端异常。

---

## 2. 新增「步骤」视图（参照 VS Code Chat Debug）

### 参照对象

`/Volumes/Lenovo/参考项目/vscode-main`：

- `src/vs/workbench/contrib/chat/browser/chatDebug/`（`chatDebugLogsView.ts` 671 行、`chatDebugDetailPanel.ts` 305 行、`chatDebugEventList.ts`、`chatDebugMessageContentRenderer.ts`、`chatDebugCacheInsights.ts` 823 行……整个子系统约 14k 行）；
- `src/vs/sessions/contrib/chatDebug/browser/chatDebug.contribution.ts` 把 Chat Debug 作为独立 View 容器挂到 Panel 区。

**只镜像「日志/步骤表」这一形态**（用户截图那张：轮次/步骤、触发、执行内容、上下文、缓存命中、首 token 时延、输出速度、总用时；底部工具条：显示合计行 / 显示事件行 / 显示上下文增量 / 最新 / 累计 / 展开全部），不搬 Flow Chart / Cache Explorer 等子系统。

### 现有数据能力与缺口

可用（`custom_runs/<uuid>.json` 实测）：

- `events`：`{type, role, phase, name, callId, executionId, turn, step, index, delta, text, at}`，已带 `turn`/`step`；
- `requests`：`{id, executionId, startedAt, finishedAt, httpStatus, finishReason, billingState, usage, metrics, error}`，`usage` 含 `inputTokens/inputTotalTokens/outputTokens/cacheReadTokens`，`metrics` 含 `ttftMs/generationMs/e2eMs/modelTokensPerSecond/endToEndTokensPerSecond/cacheRate`。

三处缺口（需要 Host 小改）：

1. `requests` 没有 `turn`/`step` —— coordinator 在 `onRequest.start` 时按当前事件水位打戳（最近一次 `turn-start`/`step` 上下文）。
2. 工具型流（只有 tool/reasoning 增量、无文本）`ttftMs` 为 `null`，而截图每步都有首 token 时延 → 新增 `firstDeltaMs`（首个任意增量），`ttftMs` 保留为「首个文本增量」并在 UI 上区分标注。
3. 步骤视图行数可能超过 `customRunDetail` 的请求上限（现在 200 条）→ 改为分页/窗口化，并在截断时明确提示（不静默丢）。

### 实现

- 新 tab「步骤」，排在 Chat 之后：`Chat / 步骤 / 文件 / 指标 / 账单 / 权限`。
- 行 = 一个数据面请求（一步）：序号、触发（该请求前最近一次用户消息/工具结果的摘要）、执行内容（工具名 + 文本/参数摘要）、输入 tokens、缓存命中、首字节、输出速度、总用时；点击展开显示该步事件明细（reasoning/text/tool call/result，复用已搬的 chat 呈现层组件，不新写样式体系）。
- 表尾：合计行（可开关）；切换「最新 / 累计」；「展开全部」；列宽与折叠状态存 presentation 域（view 不持有业务状态）。
- CSS 放 `frontend/styles/custom.css`，沿用 `.mit-*` 前缀与现有 token。

### 风险

- 首字节语义：a6 工具型请求可能整步没有任何文本增量，需要明确「未知」而不是 0。
- 大任务（20+ 模型 × 10+ 步）渲染量：先做分组折叠 + 行窗口化，不做全量 DOM。

---

## 3. 自定义监控新增「输入价 / 输出价 / 渠道 24h 缓存率」

### 现状

- 自定义行只有**实测**缓存率（`metrics.cacheRate`，来自 usage）；
- 市场报价与 24h 缓存率只在指纹表里通过 `run.model.a6api.market`（`A6Channel['market']`）渲染（`MarketPrice` / `MarketCache`，`frontend/views/a6/MarketSnapshot.tsx`）。

### 数据来源

自定义 run 的 `target` 已带 `marketSnapshot`（`A6MarketSnapshot`）：`capturedAt / chargeType / currency / unit / inputPriceMicros / outputPriceMicros / cacheReadPriceMicros / cacheWritePriceMicros / perRequestPriceMicros / exchangeRate / cacheHitRate24h / cacheHitState`。

### 实现

1. 加一个适配函数 `marketOfTarget(target)` → `A6Channel['market']`，让 `MarketPrice`/`MarketCache` 复用同一套格式化（避免两套换算）。
2. `A6_COLUMNS`（现在 `price/cache24h/target`）对 custom 记录打开，列标区分：
   - 「输入价」「输出价」（CNY / 百万 tokens，hover 显示原始 µ$ 与汇率快照时间）；
   - 「实测缓存率」（usage 口径）与「渠道 24h 缓存率」（市场快照口径）分成两列，不混用。
3. 口径：`CNY = micros / 1e6 × exchangeRate`；缺失显示 `—`，绝不显示 0；快照超过 24h 加静默标注（`title` 里给 capturedAt）。

### 风险

- 同一行两个「缓存率」容易被误读 → 列名与 tooltip 必须写清口径（实测 = 本次请求命中，市场 = 站点统计 24h）。

---

## 4. 全屏面板：端口研究结论与方案

### 端口研究（inspect 实测 `webServer`）

`webServer`（`@deepseek-ai/dsh-host-webserver`）是唯一的浏览器 HTTP 载体：

- `getOrigin(): string` —— `http://<bindUrlHost>:<listenedPort>`；
- 配置：`host` 必须是具体回环地址（禁止 wildcard，否则等于把 RCE 暴露到网络）、`port: z.natural().max(65535).required()`；CLI 传 0 让系统分配 → **每次启动只有一个随机端口**；
- 路由：`register({ kind: 'exact' | 'prefix', path, handler | resource })`、`registerUpgrade`、`registerFallback`（SPA dist 已占用）、`tapIndex` / `applyIndexTaps` / `renderIndex`、`readResource`；
- 本插件已经在用：`backend/a6/intake.js:171-180` `webServer.getOrigin()` + `register({kind:'exact', path:'/mit-a6/select' …})`。

**结论：DSH 没有可复用的固定端口，但插件的路由本来就长在 GUI 那个端口上 —— 所以「新增一个路径」不需要任何新端口。**

### 方案 A（推荐，0 新端口、0 双 React）

在现有 GUI 里做「全屏」：

- 入口：面板顶栏加「全屏」按钮 → `window.open(location.href + '&mit=fullscreen')`（保留 token 参数）；
- 客户端 `apply()` 读到 `mit=fullscreen` 时，渲染 `position: fixed; inset: 0` 的 `.mit-fullscreen` 容器：自带顶栏（面包屑 + 返回 + 关闭）、记录侧栏、主内容区，铺满整个视口；
- 控制链路与右栏完全一致（同一个 `remote.modelIntelligence`），无需新网关、无需新鉴权、无需第二份 React；
- `ESC` / 关闭按钮退出；深链可收藏。

### 方案 B（备选，真·独立页面，暂不做）

同端口 `register({kind:'prefix', path:'/mit-panel', resource})` 返回自带 HTML + 独立 bundle：

- 需要 `/mit-panel/rpc` JSON 网关（复用 `catalog.js` 的 26 个方法）+ 口令鉴权（参照 a6 intake）；
- 独立页面不在 DSH ModuleLoader 内，必须自带 React —— 与 AGENTS「浏览器 React 只从 ModuleLoader 传入，禁止打包第二份」冲突，需改规则；
- 两套入口要长期同步，收益只是「脱离 DSH 窗口」，暂不投入。

---

## 5. 上一轮分析结论（并入实施）

- **符合/不符合红绿**：不能字符串相等 —— 参考库 `displayName` 是别名集合（`gpt-6-astra/6.1-sol`），`gpt-6.1-sol` 命中 100% 却会被误判红。需三态：符合（绿）/ 不符合（红）/ 库未收录（灰），别名归一放在 `frontend/views/results/matchVerdict.ts`。
- **表头排序**：`presentation` 加 `sorts: Record<recordId,{column,direction}>` + `toggleSort`；`runOrder.ts` 加 `sortRunIds()`（数字/时间/字符串/空值末位、稳定）；表头文字变按钮 + `aria-sort`，`ResizeHandle` 独立不误触；默认仍按最高匹配降序。
- **并发数**：删掉自定义草稿的「任务并发」输入与「并发数须在 1–6 之间」报错，改为派生 `并发 = clamp(min(已分配测试密钥数, 目标模型数, 6), 1, 6)`，只读展示。

---

## 6. 实施顺序

| 序 | 内容 | 依赖 | 可独立发布 |
| --- | --- | --- | --- |
| 1 | P0 continue 白名单修复 + 构建期断言 | — | 是 |
| 2 | 价格 / 24h 缓存率列 | — | 是 |
| 3 | 全屏模式（方案 A） | — | 是 |
| 4 | 步骤视图（Host 打戳 + 前端视图） | 1 | 是 |
| 5 | 排序 / 红绿 / 并发派生 | — | 是 |
| 6 | 指纹参考库 mtime 修复 + 库未收录提示（已实现待发） | — | 是 |

每步固定流程：`tsc --noEmit` → `node scripts/build.mjs` → client 探针 → 发布 → `plugin_manager remove_bundle`/`install_bundle` → 本机 hash 核对 → 用户真跑一轮验收。不跑自动化测试、不浏览器自动化、不做非授权推理。

---

## 7. 待确认

1. 「图 2 的位置」= 在 run 详情 tabs 里加一个「步骤」tab（我的理解），还是要在 DSH 的 Panel 区域注册一个独立视图？
2. 「参照 vscode-main」= 参照 VS Code Chat Debug 的列与交互（我的理解），还是要连带搬它的 Flow Chart / Cache Explorer？
3. 全屏用方案 A（同一 GUI 新标签铺满）是否满足？若必须脱离 DSH 窗口，再评估方案 B。
4. 价格展示要「CNY / 百万 tokens」还是「本次请求估算价」？建议前者 + hover 原始 µ$。
