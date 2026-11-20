# 多智能体优化试点执行记录

## 状态

本记录是 2026-11-18 的可行性试点，不是原方案四项研究的完整确认实验。实测范围目前限于 DSH 子代理消息机制，模型为当前会话允许的 `a6api-gpt/gpt-6.1-sol`，不是 DS41。未运行 DS41 代码生成、Playwright/E2E 或时间预算对照，因此不能据此得出 DS41 的一次成型率、并发收益、成本或质量结论。

## 环境与保护范围

- 项目：`/Volumes/Lenovo/dsh-extension-lab`；实验目标插件：`packages/model-intelligence-test`。
- 主工作区在实验前后均显示既有状态 `M pnpm-lock.yaml`、`?? research/`、`?? scripts/export-dsh-skill.mjs`；实验未覆盖或清理它们。package 路径无 git 状态变更。
- 依据 `packages/model-intelligence-test/AGENTS.md`，仅可把真实 Host Agent inference 当正式证据，未知用量/账单不能伪装成 0，Mock 不计入实验；本试点未使用 Mock。
- 实际自定义任务代码存在于 `backend/custom/session.js` 和 `backend/custom/coordinator.js`；设计文档中称“未实现”的文字已过期。真实会话单 run 默认上限为 24 requests、24 steps、96 tool calls、8192 tokens、180 秒。

## DS41 可行性验证

1. 查询 DSH 子代理路由时，`a6api-other/deepseek-v4.1-flash-1017` 被当前 Session 明确拒绝：`LLM provider "a6api-other" is not allowed for this Session`；将 DS41 精确模型改挂授权 provider `a6api-gpt` 后仍被拒绝：`child LLM route "a6api-gpt/deepseek-v4.1-flash-1017" is not allowed for this Session`。已验证可用的是 `a6api-gpt/gpt-6.1-sol`。
2. 插件开发工具的模型目录里虽然列出 DS41，但目录不等于本 Session 的可调用路由或有效凭据。为避免改主 profile，绑定了隔离 plugin-dev profile，选择 DS41 模型并启动过独立 DSH Host。
3. 隔离 Host 报告 `pluginLoaded: true` 并成功启动；浏览器中 Client 注入的 `style[data-plugin]` 清单没有 `model-intelligence-test`，插件管理界面也没有该工作台。绑定目录不足以确认 Client 工作台已激活。未在 profile 内安装插件，也未发出任何 DS41 模型请求。
4. 隔离 Host 已停止；没有访问或修改主 profile/provider 配置。隔离 plugin-dev 的绑定和所选模型仍保留在 session `session-ea917659-822c-4678-8b98-ba32da174382` 下，便于后续在用户批准后继续排查。

结论：DS41 真实代码实验当前被两项环境条件阻塞：当前 Session 不允许 `a6api-other` provider，也不允许 `a6api-gpt/deepseek-v4.1-flash-1017` 这条精确 route；隔离插件客户端未注入且没有已验证的 DS41 请求入口。未确认有效 API key、账单或请求计费；DS41 调用数为 0，费用未知而非 0。

## 构建检查

使用 plugin-dev 的 `build` 命令执行 `node scripts/build.mjs`，退出码 0。日志中 pnpm 安装阶段报 `ERR_PNPM_IGNORED_BUILDS`，指出 `esbuild@0.25.12` 构建脚本被忽略；随后构建仍成功，输出 `Built Host, Client and scoped Tailwind CSS. No tests executed.`。产物大小为 `lib/index.js 266.7kb`、`lib/client.js 6.0mb`。这是构建结果，不是模型实验或测试通过率证据。未手改 `lib`，package git 状态无变化。

## DSH 通信机制微试点

### 设置

- Control：启动一个只读分析 `/Volumes/Lenovo/dsh-extension-lab/research/multiagent/session-metrics.json` 的子代理，要求只在最终回复，不发送中途消息。
- Treatment：启动同一模型、同一文件、相近任务的子代理，要求先通过 `send_message` 向 parent 发送 interim，再完成分析。
- Parent 在收到 interim 后追加指令；由于当时 child 已结束，追加消息唤醒 idle child 的新 turn，并收到 `STEER_ACK`。
- 另启动 `pilot-active-steer`：子代理先发送 interim，随后调用 `wait_agent(timeout_ms=60000)` 等 lead；parent 在收到 interim 后发送 stop/acceptance directive，child 收到后回报精确确认 `ACTIVE_STEER_ACK`。

### 观察

- Control 在单轮内返回最终分析；Treatment 确实先向 parent 发送了 interim，说明 child→parent 的主动消息路径可用。
- 对 idle child 发送 follow-up 后，它被唤醒并返回精确 `STEER_ACK`，说明完成后的可继续 child 可以被 parent 消息重新拉起。
- 在 `pilot-active-steer` 中，child 发出 interim 后进入 `wait_agent(timeout_ms=60000)`；parent 发出 stop/acceptance directive，child 返回 `ACTIVE_STEER_ACK`。因此验证的是活跃任务在 wait/inbox checkpoint 的 turn-level steer，不是中断正在运行的 LLM 请求或模型解码。
- Treatment 与 active-steer 的 completion notice 都显示 child 在发出最后一条 `send_message` 后紧接着结束，因此 parent 未收到独立 closing summary（运行时提示：`It sent you a message just before finishing, so its closing message is omitted.`）。协议应避免把 ACK/interim 作为 final 前的最后一步：消息后应继续实质工作/等待 lead；若内容已最终，则把消息本身定义为最终结果。
- 这轮验证了 child→parent 的主动消息与 parent→child 的 idle wake/active wait-point steer；未测在模型调用期间取消或即时改变生成。
- Treatment interim 所报的 `18/160` 是 parent-directed 中途报告口径，源字段 `children_with_midway_parent_report` 位于 `/Volumes/Lenovo/dsh-extension-lab/research/multiagent/session-metrics.json:947`；`24/160` 是任意中途报告口径，字段 `children_with_midway_report` 位于同文件第 1020 行。两者定义不同，不能互相更正；引用时必须标出分母与口径。
- Parent 的 active-steer 指令要求停止规则为“验收卡条件通过，或一次有界修订用尽；否则返回 blocked reason”。`ACTIVE_STEER_ACK` 仅证明 child 收到消息，不证明该停止规则已经提高质量或节时。
- Control 建议用有边界的任务契约、step budget 和明确验收/停止规则；将 child active p90 从 1,398.7 秒降 20% 到约 1,119 秒作为下一阶段假设，而非本次实测收益。
- 多 agent 调用使用了 `a6api-gpt/gpt-6.1-sol`；模型使用量和费用没有读数，不记录成零。该试点不验证 DS41 代码质量或便宜模型的成本优势。

### 目前指标

| 项目 | Control | Treatment | 解释 |
|---|---:|---:|---|
| Interim 到达 parent | 否 | 是 | 主动 child→parent 消息可用 |
| Parent follow-up | 不适用 | 是 | 发出时 child 已 idle；不是运行中 steer 证据 |
| Follow-up 确认 | 不适用 | `STEER_ACK` | idle child 被唤醒并处理新消息 |
| Active wait-point steer | 未试 | 单独子代理已验证 | 活跃任务处于 `wait_agent` 时收到指令并回 `ACTIVE_STEER_ACK`；不是中断模型解码 |
| 输出可用性 | 最终分析收到 | interim/ACK 后的 closing summary 未交付 | 两次 completion notice 都提示 child 在发消息后紧接着结束并省略 closing message；消息本身需包含完整结论，或继续工作后再结束 |
| 代码质量 / TTA / 费用 | 未测 | 未测 | 机制试点不替代代码实验 |

## 时间预算提示式试点

### 设计

- 启动时间：2026-11-18 01:42:44 Asia/Shanghai；模型 `a6api-gpt/gpt-6.1-sol`。
- Control 与 Treatment 并行处理同一份 `session-metrics.json`，使用相同提示词与验收卡：主要指标准确、提出一个带量化目标的干预、说明观察数据不证明因果节省；每组 n=1。
- 两组均先给 interim 并等待 lead。Control 收到“无硬截止，满足验收卡后交付”；Treatment 收到“从该 lead 消息起 60 秒内停止深挖并交付”。记录首报和最终交付时间及验收结果。
- 该 deadline 是模型指令，不是系统强制终止；当前 DSH 无内置轮次预算。TTA 由消息时间近似，不代表多次重复的统计结论；美元账单成本未知；token usage 已从 archive 计数，详见下表。

### 结果

- 两组启动于 01:42:44；首报/lead 指令时点为 01:43:39（启动后 55 秒）。两组 interim 都报告相同 q3 拆分与 `children_with_midway_report=24`。
- Control 收到无硬截止指令后于 01:43:59 交付：启动至最终 TTA 75 秒，lead 指令后 20 秒。建议用 event-driven completion notices 替代重复 polling，目标是可比样本中的 wait+poll 总时长下降 25%（10,485s → ≤7,864s）。
- Treatment 收到 60 秒交付预算后于 01:44:24 交付：启动至最终 TTA 100 秒，lead 指令后 45 秒，符合 60 秒提示式窗口。建议把 poll/sleep/joboutput 时间占比从 7.0% 降至 ≤3%，观察接下来 30 个可比 run。
- 两组在 01:42:44 并行启动，最晚最终交付为 01:44:24，pair wall-clock 为 100 秒。没有相同任务的串行对照，因此不能声称并行节省时间。
- 两组均通过预设验收卡 3/3：核心数字准确、建议含可量化目标、声明观察相关不证明因果。Treatment 比 Control 的总 TTA 多 25 秒；n=1/组、角色未随机、建议目标口径不同，因此不能据此断言 deadline 加快或减慢交付，也不能声称目标已实现。
- 两组都在 interim 后等待 lead，再返回最终答复；未复现 interim/ACK 紧邻结束导致 closing summary 省略的问题。deadline 只是提示，没有系统级强制取消；美元成本未知；token usage 见下表。

## 串行与并行只读分析试点

- 固定同一份 `session-metrics.json`、同一路由 `a6api-gpt/gpt-6.1-sol`、同样的 Metrics A/B 提示词：A 核查 corpus、delegation 与 child active duration 共 11 项；B 核查 q3 时间拆分、占比公式与 midpoint 指标共 13 项。禁止写文件、测试和浏览器操作。
- 预设验收卡为 24 个值/路径/公式及限制句全部准确。并行组 24/24，串行组 24/24；任务内容相同。
- TTA 用 parent archive 的子会话 `createdAt` 到最后一个结果 `agent/inbox/spliced`：并行 18:10:17.542–18:10:58.373 UTC = 40.831 秒；串行 18:12:45.938–18:14:07.824 UTC = 81.886 秒。该单对只读任务中，并行 TTA 低 50.1%（约 2.00× speedup）；n=1/组，不可外推至代码实现、DS41、Playwright/E2E 或其它任务。
- 归档显示并行最终 inbox 已在 18:10:58.373 到达，但 assistant turn 结束后外层 completion 消息到 18:12:08 才进入下一 turn；因此以 DSH 生命周期事件作 agent TTA，外层用户消息时间另有 turn-boundary 延迟，不直接拿来与串行时间相减。

### Token usage 代理指标

从 child 的 `assistant/message` usage 事件汇总，归档路径为 `/Users/qihoo/.dsh/sessions/--Volumes-Lenovo-dsh-extension-lab--/<session-id>/session.v4.jsonl.zstd`；单位为 tokens，不是 USD，也不包括 lead/root 会话开销。缓存读取独立列出；实际账单费率未知。

| Run | Session archive ID | Model requests | inputTokens | cacheReadTokens | outputTokens | totalTokens |
|---|---|---:|---:|---:|---:|---:|
| Final-only control | `7c94d135-974a-4b74-b3cc-4e9ccc4c36af` | 2 | 71,958 | 0 | 429 | 72,387 |
| Interim treatment | `b0016283-5990-47e4-b79f-1b0ca600b667` | 4 | 108,414 | 59,645 | 740 | 168,799 |
| Active-steer | `5d283f6b-0937-4383-91d8-4bd08a9666eb` | 5 | 83,177 | 132,075 | 336 | 215,588 |
| No-deadline control | `254c57f1-54e6-4be4-8e03-9ec27d181c76` | 4 | 77,987 | 89,539 | 335 | 167,861 |
| 60-second deadline | `8bb8af62-3821-475a-af7e-e11c42f79ecc` | 4 | 57,767 | 109,840 | 346 | 167,953 |
| Parallel Metrics A | `7efed0fa-30d1-4d25-af74-86ec356c51d2` | 3 | 47,815 | 49,408 | 447 | 97,670 |
| Parallel Metrics B | `2be86a1f-9332-4240-89ab-b591f3aaffbf` | 3 | 59,402 | 61,073 | 1,196 | 121,671 |
| Serial Metrics A | `ee5dad44-be64-416b-9e0c-346c48bd398d` | 2 | 29,684 | 42,654 | 497 | 72,835 |
| Serial Metrics B | `4abbb7a4-9291-4078-81ca-566210320497` | 2 | 47,647 | 24,704 | 719 | 73,070 |

Lead/root usage was independently summed from parent archive `session-ea917659-822c-4678-8b98-ba32da174382` at `/Users/qihoo/.dsh/sessions/--Volumes-Lenovo-dsh-extension-lab--/session-ea917659-822c-4678-8b98-ba32da174382/session.v4.jsonl.zstd`:

| Window (UTC) | Lead requests | inputTokens | cacheReadTokens | outputTokens | totalTokens |
|---|---:|---:|---:|---:|---:|
| Communication pilot, 17:25:30–17:34:00 | 14 | 447,842 | 1,181,899 | 16,454 | 1,646,195 |
| Deadline pair, 17:42:40–17:44:30 | 5 | 97,776 | 370,655 | 6,220 | 474,651 |
| Parallel read-only analysis, 18:10:17–18:10:58 | 2 | 40,629 | 136,646 | 805 | 178,080 |
| Serial read-only analysis, 18:12:37–18:14:07 | 6 | 127,533 | 454,678 | 2,712 | 584,923 |

At the window level, communication pilot usage sums to 25 requests and 2,102,969 `totalTokens` (14 lead + 11 child); deadline pair sums to 13 requests and 810,465 (5 lead + 8 child). Read-only analysis sums to 8 requests and 397,421 for parallel (2 lead + 6 child), versus 10 requests and 730,828 for serial (6 lead + 4 child): parallel was 45.6% lower in cumulative `totalTokens` in this one run. Child-only totals were 219,341 parallel vs 145,905 serial; lead window totals were 178,080 vs 584,923, respectively. These are cumulative per-request counters, repeat context, and are not USD; the broad lead windows include orchestration and surrounding analysis, so do not treat token delta as a clean billable-cost effect. Deadline pair 的 child `totalTokens` 相差 92（约 0.055%），缓存/未缓存输入组成不同。实际账单费率未知。

## 需解决后继续

1. 通信机制试点已完成；后续验证应扩大到多任务、多轮，并记录延迟与交付质量。
2. 决定 DS41 是否通过隔离 plugin-dev 安装/激活本地插件来运行；当前仅有“实验”授权，未进行插件安装。需要用户明确允许的隔离安装路径或提供已经加载的 DS41 可调用 provider。
3. 把原方案 A–D 拆成真实、可回滚的小试点；先固定一组任务与验收卡，再运行 DS41 单次/并行代码实现和业务线验证。
4. 未获得 DS41 可调用 route 与客户端工作台前，不报告 DS41 通过率、TTA、质量、成本或 E2E 结果。
