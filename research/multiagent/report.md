# DSH 多智能体：运行机制、双向同步、决策闸门（Jev / 快速 LLM）与时间预算 —— 研究报告

> 基于 DSH 0.2.2-rc.3 文档（`.agents/skills/dsh-doc/dsh-docs`）+ 本机 `~/.dsh/sessions` 全量会话（303 会话）+ Tavily 外部资料。
> 数据脚本：`research/multiagent/scripts/decompress.mjs`（只读解压 zstd 多帧日志）→ `analyze.py`；原始指标：`research/multiagent/session-metrics.json`。

---

## 0. 结论速览（TL;DR）

1. **DSH 已经具备双向通信的底座**：`send_message` 在同一子代理树内任意成员间投递（运行中 → 下一步 steer；空闲 → 开新轮次；冷会话 → 恢复），子代理也能发给 `lead`。缺的不是"通道"，而是 **"何时说、说多少、谁来决定"** 的机制：没有心跳、没有状态登记表、没有旁问（btw）、没有预算，`wait_agent` 只返回 `{timedOut}`。
2. **会话数据显示慢在哪**：子代理活跃时间 90.6% 花在 LLM 生成上（工具仅 5.6%），步延迟 p50 9.3s / p90 31.5s；子代理步数 p50 26、p90 88、最大 225。**提速的主要杠杆是"更早停/更少步"和"不让 lead 干等"**，而不是更快的工具。
3. **lead 在子代理运行期间 19.4% 时间在干等/轮询**（wait_agent 12.4% + sleep/job_output 7%），每个 root 的阻塞占比 p50 20%、p90 70%；`wait_agent` 46% 以超时告终（27/59）。
4. **中途汇报极少且晚**：160 个子代理里只有 24 个（15%）在结束前 >60s 发过消息；向 lead 的首条汇报中位数出现在轮次进度 60% 处。lead 追问状态 20 次，子代理完成通知 p90 3355 字符、最大 36,648 字符（15 条 >4000）。
5. **用户被迫手动做"预算 + 收敛"**：运行中用户消息原文如"你分析了8分钟，可以了。收回你的子智能体之后，立刻给我汇报"、"差不多了 去收回 subagent 然后给我汇报一轮"、"现在立刻汇报当前进度"。这正是 **Good-enough 闸门 + 时间预算 + 用户进度同步** 应自动化的事情。
6. **推荐方案（插件化，不改内核）**：
   - **Pulse**（子→主）：确定性状态卡 + 闸门决定是否升级；用 `inject()`（不唤醒）把登记表摘要喂给 lead，只有闸门判"需要立即处理"时才 `steer`。
   - **Peek / btw**（主→子只读旁问）：对子代理会话快照做一次无工具、不入史、不打断的单次请求，回答 ≤N token。
   - **Directive**（主→子推送）：沿用 `send_message`，增加"陈旧性复核"与 inject/steer 两档。
   - **Gates**：Jev（Noul/Choice）或快速 LLM（输出 `1/0` 或单个枚举），阈值 + 冷却 + 执行前复核 + 确定性兜底。
   - **Budget**：截止时间 → 每步注入剩余预算 + 分段策略（BATS 式），到点逐级"收敛 → 收回子代理 → 只许收尾工具 → 强制作答"。

---

## 1. DSH 多智能体运行机制（文档事实）

| 能力 | API / 工具 | 关键语义 |
|---|---|---|
| 启动子代理 | `ctx.subagents.startActivation(spec)`；工具 `subagent` / `subagent_fork` / `spawn_teammate` / `workflow` / `ralph` | provider：spawn、fork（继承父已完成轮次前缀）、acp/codex/claude-code/dsh-sdk（外部，单次执行无续指令）。返回 `{childId,name,result:Promise<SubagentResult>}`，`stopReason: completed|aborted|error|max-tokens|refusal` |
| 消息 | `sendMessage(sender,target,content)` / 工具 `send_message` | 同树任意成员；运行中→下一步 Steer，空闲→开轮次，冷→恢复；**只返回入箱确认，无回执** |
| 等待 | `wait_agent(timeout_ms 10s–1h, 默认 30s)` | 仅返回 `{timedOut}`；被新消息/完成通知/用户 steering 唤醒 |
| 完成通知 | `SubagentSettledMessageSource{kind:'subagent-settled',summary,stopReason}` | **只发给在线的直接创建者** |
| 中断 | `interrupt(target,{kind:'user'|'ancestor'})` / `interrupt_agent` | fire-and-return，保留 inbox |
| Agent 原语 | `send(msg,'next-turn'|'next-step',wakeup)`、`followup`、`steer`、**`inject`（下个 pre-step 注入上下文但不唤醒）**、`cancel(cause,{keepInbox})`、`whenIdle`、`runMaintenance`、`agent.session`（持久日志，`deriveMessages()` 投影） | `core.md:59-144` |
| Hook | `agent/pre-step`（waterfall，可 `enter{messages}`/`reject`）、`agent/turn-stopping`（serial，可再 steer 一步）、`tools/pre-execute`/`post-execute`、`agent/request-error`；事件 `subagent/start|end`、`goal/changed` | `core.md:406,1092-1114` |
| 预算 | **无**——`dsh-agent-loop` README："没有内置轮次预算"，需借生命周期 hook 自行取消 | Goal 只有 `maxGoalRounds`（按轮，非时间） |
| 快速 LLM 先例 | `dsh-session-title-llm` 的 `executeSessionTitleLlm`：`maxInputBytes / maxOutputTokens / timeoutMs / provider?/model?`，记事件 `session/title-llm-request` | 决策 LLM 可照此实现 |
| btw | DSH 无此功能 | 可由 `agent.session` 快照 + 单次请求实现 |

---

## 2. 会话数据蓝本（~/.dsh/sessions）

语料：303 会话 = 143 root + 160 子（subagent 104 / fork 36 / teammate 20），最大深度 1；24 个 root 用了子代理（每 root 子数 p50 4、p90 16.7、最大 22）。工具调用 26,775 次。

### 2.1 子代理耗时结构
| 指标 | p50 | p90 | max |
|---|---|---|---|
| 活跃时长 s | 493 | 1399 | 5583 |
| 墙钟 s | 515 | 2457 | 71,177 |
| 步数 | 26 | 88 | 225 |
| 工具调用 | 37 | 108 | 388 |
| 输出 token | 27k | 81k | 174k |
| 峰值上下文 | 117k | 217k | 689k |
| 单步延迟 s | 9.3 | 31.5 | 372 |

- **生成占活跃 90.6%，工具 5.6%** → 时间 ≈ 步数 × 生成延迟。
- 长尾显著：p90/p50 ≈ 2.8×。最长子代理"梳理前端接入结构"：5583s、225 步、388 次工具（read 168 / edit 109）、2966 万 prompt token、lead 期间给它发了 18 条消息——典型"范围漂移 + 无预算"。
- Prompt token：root 21.3 亿 vs 子 5.6 亿 → lead 端重复携带大上下文，是成本主项。

### 2.2 lead 在子代理运行期间的时间
| 状态 | 占比 |
|---|---|
| LLM 生成 | 71.2% |
| wait_agent 阻塞 | 12.4% |
| sleep 轮询 / job_output | 7.0% |
| 轮次已结束空闲 | 5.8% |
| 其他工具 | 3.2% |

- 每 root 阻塞占比 p50 0.2、p90 0.7、最大 1.0（例：`session-ae93e81b…` 72.7%，其中 sleep 轮询 2502s）。
- 子代理运行期间的轮询调用：bash sleep 64、list_agents 60、wait_agent 59、job_output 16；wait_agent 时长 p50 86s、p90 243s，**27/59 超时**，常用 timeout 180s/300s。
- 39 对近重复派生（Jaccard≥0.96），34 次代理工具错误（多为 `active teammate "…" not found`——给已结束成员发消息）。

### 2.3 通信
- **主→子**：250 条，覆盖 60 个子代理，240 条在子运行中送达；其中 20 条是"状态追问"（例："状态同步：task-1/2/4 已交付，只等你 task-3。请立即…先落盘"）。距子轮次开始 p50 250s。
- **子→主/兄弟**：291 条，58 个子代理发过；给 lead 183 条（来自 36 个子），给兄弟 99 条。
  - 首次向 lead 汇报时刻：轮次内 p50 413s、处于轮次进度 p50 60%。
  - 结束前 >60s 的"中途汇报"只覆盖 **24/160 个子代理**。
- **完成通知**：203 条；长度 p50 453、p90 3355、最大 36,648 字符；lead 收到时 200/203 正在轮次中，反应 p50 11s、p90 69s、最大 1731s；stopReason：completed 114 / null 71 / error 17 / aborted 1。

### 2.4 用户侧
- 子代理运行中用户插话 28 条（10 个 root），用户中止 127 次（有子代理的 root 中）。
- 典型诉求（原文）：
  - "你分析了8分钟，可以了。收回你的子智能体之后，立刻给我汇报" → **时间预算 + 收回 + 汇报**
  - "主动去补充和索要子智能体的工作状态 我们调查即可 没必要过于深入" → **主动拉取状态 + 深度控制**
  - "差不多了 去收回 subagent 然后给我汇报一轮" → **Good-enough 闸门**
  - "现在立刻汇报当前进度" / "给我汇报一下当前进度" → **用户进度同步**
- Goal：29 个（22 完成），轮次 p50 0，**子会话 0 个 goal**——goal 不是当前长任务的主要驱动，预算不应依赖 goal。

**解读**：不缺通道，缺"节律与决策"。lead 要么盲等、要么轮询；子代理很少主动汇报，汇报就是大段倾倒；没人决定"够了"，只能用户出手。

---

## 3. 外部资料要点（Tavily）

- **Anthropic 多代理研究系统**：同步等待是瓶颈——"lead 无法 steer 子代理，子代理无法协调，整个系统会被单个子代理阻塞"；3–5 子代理并行 + 子代理内 3+ 并行工具使复杂任务耗时降低至多 90%。<https://www.anthropic.com/research/multi-agent-research-system>
- **DACS**：编排者维护每代理 ≤200 token 的状态登记（task、Running/Blocked/Waiting/Complete、last_output_summary ≤100 token、urgency），代理发 SteeringRequest 时进入聚焦模式。<https://arxiv.org/html/2604.07911v1>
- **Jev（TypeSafe System One）**：不输出文本，只答"问题"——`noul`（P(yes)）、`choice`（≤255 选项带概率）、`score`（2–10 级）、`box`。`POST https://api.typesafe.ai/v1/systemone {model:"jev-latest", state, questions:{name:{type:"noul",instructions,criteria:{true,false}}}}` → `{answers:{name:{type:"noul",noul:0.98}}, usage}`。$0.042/M 输入、输出免费、70–500ms、64k token/请求、1200 rpm；可经 OpenRouter / Vercel。<https://docs.typesafe.ai/api>
  - 适用五条件：选项集封闭、反复发生、错误代价可用阈值+弃权兜住、状态 <32k、概率会改变动作。<https://cellcog.ai/blog/how-to-use-jev-in-your-agent>
  - 风险：提示注入可移动判决 → 只做"升级"类安全决策，不做"放行"。<https://venturebeat.com/security/companies-are-putting-jev-in-charge-of-ai-agent-decisions-and-prompt-injection-can-influence-the-verdict>
- **BB Smart Queue**（新消息该 steer 还是 followup）：state = 线程标题 + 最近 3 个用户请求 + agent 最近 2000 字符 + 新消息；单请求 5s 截止；阈值从 0.7 降到 0.5，"拿不准就 steer"（steer 只是追加到当前轮）；兜底便宜模型，再不行就当 followup；**"慢分类器绝不能去 steer 期间已开始的另一个任务"**（执行前复核状态）。<https://slopfluencer.com/experiments/jev-routing>
- **Jev, Please Proceed**：`thread.idle` 时问 Noul"agent 只是在等一个橡皮图章"，>0.95 且复核仍空闲/无变化/无队列 → 发 "please proceed"；每个 idle 事件只处理一次；同一最终回复重复出现即停；总超时 5s、32KiB 上限；只发 user+assistant 文本。<https://github.com/lawrenceluk/bb-plugin-jev-please-proceed>
- **Claude Code /btw**：看得到完整对话、无工具、一问一答、不进历史、运行中可用、复用 prompt cache。<https://wmedia.es/en/tips/claude-code-btw-side-question>；t3code side chat = 只读分叉线程。<https://github.com/pingdotgg/t3code/discussions/18028>
- **预算**：BATS / Budget Tracker——每步追加剩余预算 + High/Medium/Low/Critical 分段策略，准确率不降、搜索 −40%、成本 −31%。<https://arxiv.org/html/2511.17006v1>；BAGEN——代理预估剩余成本区间，提前报不可行。<https://ragen-ai.github.io/bagen>
- **小判官**：0.8B yes/no 判官与 27B 一致率 90.6%，9B 达 97%——快速 LLM 做 1/0 决策可行。<https://arxiv.org/html/2610.38620v1>

---

## 4. 设计：四个机制

总体原则：**确定性信号优先、LLM 只做 1/0 闸门、默认不唤醒（inject）、需要时才打断（steer）、执行前复核、全部有兜底**。

```
            ┌──────────── Registry（每树内存，≤200 token/代理）────────────┐
 child ──Pulse(每K步/T秒)──▶ 状态卡 ──Gate G1/G2──┬─(否)→ 仅更新登记表 ──inject──▶ lead 下个 pre-step
                                                   └─(是)→ send_message steer ─────▶ lead 立即处理
 lead ──peek(name,q)──▶ 子会话快照 + 单次请求（无工具/不入史/不打断）──▶ ≤N token 答案
 lead ──directive──▶ 复核(子仍在做同一任务?) ──▶ inject（补充） | steer（改向） | interrupt（收回）
 Budget ──每步──▶ 注入 "剩余 X 分 / regime=Low" ──阈值──▶ 收敛 → 收回子代理 → 只许收尾工具 → 强制作答
 User  ──Gate G6──▶ 进度卡（不占 lead 轮次）
```

### 4.1 Pulse：子 → 主 定时汇报（心跳）

- **触发**：子代理 `agent/pre-step`（或 `step/end` 事件）计数，每 `K=8` 步或 `T=120s` 取较早者；数据中位子代理 26 步 ≈ 3 次心跳，p90 88 步 ≈ 11 次。
- **状态卡（确定性，零 LLM 成本）**——从 `agent.session` 日志直接算：
  `{name, task(截断), status: running|blocked|waiting|done, elapsed, steps, tokens_out, last_tools[3], files_touched[5], last_assistant_tail(≤300 字符), budget_left}`
- **可选一行摘要**：快速 LLM（`maxOutputTokens≈40`）"用一句话说进展"，只在 G1 判真时生成。
- **投递**：
  - 默认写入 Registry，并在 lead 的 `agent/pre-step` 用 `inject` 方式附加 **登记表摘要**（全部子代理合计 ≤1k token，替代 list_agents/sleep 轮询）。
  - G1/G2 判真才用 `send_message` steer lead。
- **改造 `wait_agent`**：返回 `{timedOut, digest}`（登记表变化），超时也能带回进展——直接消掉 46% 的"空超时"。

### 4.2 Peek / btw：主 → 子 只读旁问

- 新工具 `peek_agent({agent, question, max_tokens=150})`：
  1. 取目标子代理 `agent.session` → `deriveMessages()` 得快照（只读，不加锁，不入子代理 inbox）。
  2. 拼接"快照 + 旁问"做一次单次请求（照 `executeSessionTitleLlm`：`timeoutMs`、`maxInputBytes`、`maxOutputTokens`），**无工具**，同 provider/model 以命中子代理的 prompt cache 前缀（尾部追加问题，不改前缀）。
  3. 结果只回给提问方，**不写入子代理历史**，子代理不中断。
- 适用：lead 想知道"你找到 X 了吗/现在卡在哪"，用户问"那个子代理在干嘛"。数据里 20 次状态追问 + 用户"立刻汇报"都可用它秒答，而非打断子代理。
- 变体（Jev 版）：`peek` 的问题若是是/否型（"是否已经确定根因?"），直接用 Jev Noul，70–500ms，成本近零。
- 注意：快照超过 64k token 时截断为"首条任务 + 最近 N 条"；超大上下文（数据峰值 689k）必须走截断。

### 4.3 Directive：主 → 子 继发指令

- 沿用 `send_message`，在插件层分三档：
  - `inject`：补充信息（"字段定义是…"），**不唤醒**，子代理下一步自然读到——数据中主→子 250 条大多属此类。
  - `steer`：改方向/缩范围（"别深入，只要结论"）。
  - `interrupt + followup`：收回（预算或 good-enough 触发）。
- **陈旧性复核**（BB 规则）：发送前比对子代理当前 `turn`/任务哈希与下指令时观察到的一致，否则丢弃或改为 followup；避免向已结束成员发消息（数据中 34 次 `active teammate not found`）。
- 派生时把"汇报协议"写进子代理提示：完成时交付 **≤800 字摘要 + 产物路径**，长内容落盘（压住 p90 3355 / 最大 36k 字符的通知倾倒）。

### 4.4 Gates：何时同步 / 拉起 / 收回（Jev & 快速 LLM）

每个闸门 = `{触发时机, state, 问题(1/0 或短枚举), 阈值, 动作, 复核, 兜底}`。输出只可能是 `1/0`、概率或单个枚举。

| # | 闸门 | 触发 | state（≤32k） | 问题 | 阈值→动作 | 兜底 |
|---|---|---|---|---|---|---|
| G1 | report_worthy | 子代理心跳 | 子任务 + 上次汇报 + 最近输出尾 | "自上次汇报后，是否产生了 lead 现在就需要的发现/决策/阻塞?" | ≥0.7 → steer lead 汇报；否则只更新登记表 | 超时→仅登记表 |
| G2 | stuck_or_drift | 子代理心跳 | 任务 + 最近 20 次工具调用签名 + 尾输出 | Choice{on_track, looping, off_scope, blocked_need_input} | looping/off_scope ≥0.8 → 给子代理 inject 提醒并通知 lead；blocked → steer lead | 确定性：同一调用重复 ≥3 次即 looping |
| G3 | good_enough | lead 每次 pre-step（有子代理在跑时）/ 子代理完成时 | 用户目标 + 登记表 + 已收结果摘要 | "已有信息是否足够完成用户目标(剩余子代理只是锦上添花)?" | ≥0.85 且持续 2 次 → interrupt 余下子代理 + peek 收割部分结果 + 开始综合 | 只建议不执行（inject 给 lead） |
| G4 | notice_route | 完成通知/子消息到达，lead 忙 | lead 当前在做什么(尾 2000 字) + 新消息 | Noul"与 lead 当前步骤直接相关?" | ≥0.5 steer，否则 next-turn | 拿不准就 steer（BB 经验） |
| G5 | spawn_decision | lead 准备派生时（`tools/pre-execute` 拦 `subagent`） | 新任务 + 现有登记表 | Choice{new, duplicate_of:<name>, send_to_existing} | duplicate ≥0.8 → 拒绝派生并提示改用 send_message | 确定性 Jaccard≥0.9 |
| G6 | user_progress | 定时(如 3 分钟) / 登记表变化 | 用户请求 + 上次发给用户的进度 + 登记表 | "自上次告知用户后是否有用户会关心的实质进展?" | ≥0.7 → 推送进度卡到 GUI（系统通知，不占 lead 轮次） | 每 10 分钟无条件一次 |
| G7 | please_proceed | 子代理轮次结束未交付（问"要我继续吗"） | 子任务 + 最后回复 | Noul"只是在等已获授权的确认?" | >0.95 且复核仍 idle → "继续" | 同一回复重复即停 |

**通用规则**
- 单次 5s 总超时、32KiB 上限、不重试；Jev → 快速 LLM（`maxOutputTokens=1`，提示要求只输出 `1`/`0`，或用 logprob 取 P("1")）→ 确定性规则，三级兜底。
- **执行前复核**：判定期间状态变了（新轮次、新消息、已完成）→ 放弃动作。
- **冷却 + 迟滞**：同一闸门同一代理最小间隔 60s；G3 需连续 2 次过阈值。
- **只让闸门"升级/提醒"，破坏性动作（interrupt）只由 G3 + 预算触发**，并保留 `keepInbox`；Jev 提示注入风险下不让它"放行危险操作"。
- 记录每次判定 `{gate, p, action, latency}` 到会话事件，供日后离线标定阈值（可用本仓库的 analyze.py 回放）。

快速 LLM 实现（无 Jev 时）：
```ts
// 照 executeSessionTitleLlm：单次、无工具、超时、小输出
const r = await oneShot({ model: cfg.gateModel, timeoutMs: 5000, maxInputBytes: 32_768, maxOutputTokens: 1,
  system: 'Answer with exactly one character: 1 for yes, 0 for no.',
  user: `${state}\n\nQuestion: ${question}` })
const yes = r.text.trim().startsWith('1')   // 有 logprobs 时取 P("1") 作为概率
```

### 4.5 时间预算：强制在规定时间内完成

DSH 无内置预算 → 插件 `budget`：

1. **设定**：用户或 lead 给出 `deadline`（如"10 分钟内"），或从 Goal/会话配置读取；子代理的预算 = `min(分配额, lead 剩余 − 综合预留)`，综合预留默认 `max(90s, 15%)`。默认子代理软上限可取数据 p90（≈1400s），推荐 15 分钟。
2. **每步注入（BATS）**：在 `agent/pre-step` 用 `enter{messages}` 追加一行
   `⏱ budget: 6m12s left of 10m (regime=Medium). Children: 2 running.`
   regime 策略：
   | regime | 剩余 | 注入的行为约束 |
   |---|---|---|
   | High | >50% | 正常探索、可派生 |
   | Medium | 25–50% | 不再派生新子代理；只补关键缺口 |
   | Low | 10–25% | 向所有子代理 directive "立即收尾、落盘部分结果、≤5 步内交付"；lead 开始起草 |
   | Critical | <10% | interrupt 子代理（keepInbox）+ peek 收割；`tools/pre-execute` 只放行 read/write/compress 等收尾工具；要求最终答复 |
3. **硬截止**：到点在 `agent/turn-stopping` / 下个 pre-step steer "Time is up. Give the final answer now with what you have; list unfinished items."；再超 60s 仍未结束则 `cancel` 并由插件把登记表 + 已收结果生成兜底报告给用户。
4. **可行性预警（BAGEN）**：Medium 起每次心跳由 G3 变体问"按当前进度能否在剩余时间完成?"，否 → 立即通知用户并提议缩小范围，而不是硬撞墙。
5. **步数 ≈ 时间**：步延迟 p50 9.3s，可把时间预算换算为步预算作为第二道闸（例如 10 分钟 ≈ 60 步）。

---

## 5. 落地路径（插件化，不改内核）

| 阶段 | 内容 | 依赖的扩展点 |
|---|---|---|
| P0 | **Registry + Pulse（确定性）+ lead 侧 inject 摘要 + 子代理汇报协议提示** | `subagent/start|end`、子代理 `agent/pre-step`、`agent.session`、lead `agent/pre-step` |
| P1 | **Budget 插件**（注入 + regime + 硬截止） | `agent/pre-step`、`agent/turn-stopping`、`tools/pre-execute`、`ctx.subagents.interrupt/sendMessage` |
| P2 | **peek_agent 工具**（btw） | 工具注册、单次 LLM 请求（仿 title-llm）、`deriveMessages` |
| P3 | **Gates**（先快速 LLM，后可选 Jev provider） | 插件配置：`gateProvider: off|llm|jev`、阈值、冷却 |
| P4 | 用户进度卡（G6）+ 离线阈值标定（回放 session 日志） | GUI 通知/Slot、analyze.py |

待核实（实现前需用 `cordis_inspect_list/query` 或源码确认）：
- 插件能否在 lead 的 ctx 中拿到 **子代理 Agent 句柄**（读 `session`、调 `inject`）；若不能，退而用 `sendMessage` + 读子会话持久日志。
- `agent/pre-step` 是否对子代理同样触发（插件在子代理 agent ctx 中是否加载）。
- 单次 LLM 请求的公共入口（title-llm 内部函数是否导出；否则通过 provider 服务直接发请求）。

## 6. 预期收益（按本机数据估算）

| 改进 | 依据 | 预计效果 |
|---|---|---|
| 去掉轮询/盲等 | lead 子代理期间 19.4% 在等/轮询；wait_agent 46% 空超时 | lead 可并行做综合/下一步，阻塞占比 p50 20% → <5% |
| Good-enough + 预算截尾 | 子代理 p90/p50 = 2.8×；用户多次手动"够了，收回" | 砍掉长尾，整体墙钟预计 −30~50%（取决于任务） |
| 中途汇报 | 只有 15% 子代理有中途汇报，首报在轮次 60% 处 | lead 可更早纠偏（G2），避免 225 步式漂移 |
| 汇报瘦身 | 通知 p90 3.4k、最大 36.6k 字符；root prompt token 是子代理 3.8× | 降低 lead 上下文增长与 prompt 成本 |
| 派生去重 | 39 对近重复派生 | 减少重复劳动 |
| 用户进度 | 28 条运行中插话、127 次中止 | 用户少打断、少中止 |

---

## 附：数据口径
- 解压：`~/.dsh/sessions/<proj>/<sid>/session.v4.jsonl.zstd`（多帧追加写，逐帧解码）→ `/tmp/dsh-sessions-raw`。
- “中途汇报” = 子代理结束前 >60s 发出的 `send_message`。

- fork 子会话剔除从父继承的事件（`session/end-seed{inherited:true}` 之前，共 98,397 条）。
- “活跃时长” = 轮次内时间；“阻塞” = lead 在子代理运行期间处于 wait_agent / sleep 轮询 / job_output。

## 7. 试点执行记录（2026-11-18）

详见 [pilot-execution.md](</Volumes/Lenovo/dsh-extension-lab/research/multiagent/pilot-execution.md>)。本次实际试点只验证 DSH 通信和提示式时间预算，使用当前获准的 `a6api-gpt/gpt-6.1-sol`：

- final-only control 正常返回；treatment 的 child→parent interim 消息到达。对 idle child 的 follow-up 唤醒得到 `STEER_ACK`。
- 另一个活跃 child 在发送 interim 后进入 `wait_agent(timeout_ms=60000)`；lead 即时发送 stop/acceptance 指令，child 收到后确认 `ACTIVE_STEER_ACK`。这验证 inbox/wait checkpoint 的 turn-level steer，不代表打断正在执行的 LLM 请求。
- Treatment 与 active-steer 都在最后一条 `send_message` 后立即结束，运行时省略了独立 closing summary；`ACTIVE_STEER_ACK` 证明 wait-point 指令已接收，但不证明质量或 TTA 改善。后续协议需让 ACK/interim 后继续实质工作，或明确将该消息作为最终结果交付。
- 历史数据口径：`children_with_midway_report=24/160`（任意中途汇报）与 `children_with_midway_parent_report=18/160`（发给 parent 的中途汇报）是不同指标，另有 214 条 child→parent midway messages 距 child 结束超过 60 秒。generation 为 38,530/54,097 秒（71.2%），`wait_agent` 为 6,719 秒（12.4%）。这些是观察值，不是可回收时长或因果收益。
- 时间预算 pilot 每组 n=1，基于相同本地数据、相同验收卡并行：Control 无硬截止，TTA=75s；Treatment 收到 60s 提示式 deadline 后 45s 交付、总 TTA=100s，两组均在验收卡 3/3 上通过。该 deadline pair 的 wall-clock 为 100s，但没有为时间预算干预设置串行对照。此单对结果没有显示 deadline 更快；角色未随机、样本极小、目标口径不同，不能推断截止提示的因果效果。
- Control 提议将 wait+poll 总时间降低 25%；Treatment 提议将 poll/sleep/joboutput 占比从 7% 降至 ≤3%（30 个可比 run）。这两个都是后续确认阶段的假设目标，不是已实现收益；deadline 是提示，不是系统强制取消。
- 从本机 DSH session archives 汇总 usage：communication pilot 窗口 14 个 lead + 11 个 child 请求、合计 `totalTokens=2,102,969`；deadline pair 窗口 5 个 lead + 8 个 child 请求、合计 `810,465`。这些是逐请求累计 token 计数（重复上下文会重复计入），不是 USD；lead 用量未分摊到单臂，缺模型账单单价，不能推断实际费用。
- 单独补做匹配的串行/并行只读分析 pilot：同一 `session-metrics.json`、相同 Metrics A/B 提示、Gpt 路由，两组均 24/24 验收。按 child activation 到最后 `agent/inbox/spliced` 计 TTA：并行 40.831s，串行 81.886s，单对样本并行约 2.00×；只验证只读数据分析，不代表代码实现或 E2E 效果。并行/串行 root+child 的 archive `totalTokens` 分别为 397,421/730,828，但逐请求重复上下文、lead 窗口含编排活动且 USD 费率未知，不等同费用。并行 completion 外层通知被 root turn 边界延迟，故使用 archive lifecycle 时间而非下一轮消息时间。
- DS41 的 `a6api-other/deepseek-v4.1-flash-1017` 被 Session 拒绝；换成当前允许的 `a6api-gpt` provider 后，该模型 route 仍不允许。隔离 Host 虽已启动，Client 插件未注入。未发出 DS41 请求，未执行 DS41 代码实现/Playwright/E2E，也未获得 DS41 质量、TTA、成本数据。构建退出码 0，但日志注明未执行测试。

当前结果支持“进度消息 + wait-point steer 可行”这一机制判断。单对 deadline pilot 没显示截止组更快；独立只读指标分析 pilot 则观察到并行 TTA 40.831s vs 串行 81.886s（双方 24/24），但 n=1、只读分析范围，不能代替 DS41 编码或 E2E 结论。原方案 A–D 的模型质量、真实 USD 成本、前后端验收及 deadline 的可重复效果仍需确认阶段；DS41 相关部分必须在可调用 DS41 环境中重测。
