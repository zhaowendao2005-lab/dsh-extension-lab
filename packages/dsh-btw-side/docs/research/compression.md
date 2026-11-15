# btw 与压缩类插件的等价性调查（billion-context + 内置 compaction）

目标：证明/证伪「旁路提问 ≡ 把会话停下来问下一次请求」。结论必须落到可实现级别：`/btw` 到底该发什么。

环境：DSH 0.2.2-rc.1；profile `/Users/qihoo/.dsh/profiles/desktop`（bundle 含 `billion-context@0.1.213`，见其 `package.json` `dsh.profile.bundles`）。✅ = 有代码/实机证据；◐ = 推断；**UNCERTAIN** = 证据不足。

## 0. TL;DR

| 结论 | 证据 |
|---|---|
| 本机 **内置 compaction 已被关闭**，压缩由 billion-context 在**进程外的本地代理**（`127.0.0.1:18787`）完成 | `billion-context/dsh.bundle.patch.yml`：`- id: compaction-basic` → `config: { auto: false }`，四个 preset 注入 `[biliBasicCompactionPolicy]`；`dist/agent/dsh-native.js` 的 `apply()` 在 `plan.mode !== "off"` 时调用 `declareDshCompactionActive()` → `globalThis.__BILI_DSH_COMPACTION_VERDICT__="active"` → gate 把 `@deepseek-ai/dsh-compaction-basic` / `dsh-command-compact` 行改为 `disabled:true`（`dsh-compaction-gate.js` `disableBasicCompaction`） |
| 实机确认 bili 已接管：`curl -s http://127.0.0.1:54419/bili/origin` → `{"origin":"http://127.0.0.1:18787","contextTab":true,...}` | 探针（只读）已执行 ✅ |
| 内置 compaction 一旦生效是**落盘的**（`compaction/summary` + 带 `surfaceOp:{op:'replace'}` 的替换 `user/message`）⇒ `deriveMessages()` 已含压缩结果 ⇒ 捕获点看到的**就是**下一次请求的 messages | `dsh-compaction-basic/lib/index.js:469/484/634/650-655`（`session.append("compaction/summary", …)`、`session.append("user/message", checkpointMessage, { surfaceOp: { op: "replace", … } })`） |
| bili 的 ACP 压缩**不落盘**：`llm/stream` 监听器只做归属（attribution），真正改写发生在 `globalThis.fetch` 链 → `/bili/<upstream>` 代理 | `dsh-native.js` `installFetchChain(makeDispatch)`；`makeTarget(`${again}/bili/${url}`)`；`const scope={sid,msgIds:hostMsgIdsOf(options.messages)}` … `runLlmDispatch(scope, () => wrapScopedIterable(next(), scope))` |
| **因此当前 DESIGN.md「side 调用不带 sessionId」在 bili 环境下不等价**：无归属 ⇒ gateway 拒绝接管 ⇒ **DIRECT 未压缩直发** | `refuse()` 日志原文：`` `bili-native-dsh: model request sent DIRECT (uncompressed) — takeover gate refused ${key}: …` ``；`sideShapedBody()`（无 tools 且 max_tokens ≤ 200）才被视为旁路形状 |

## 1. 本机实际生效的压缩链

| 层 | 位置 | 在哪一步压缩 | 是否落盘（`deriveMessages()` 是否已含） | 本机状态 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-compaction-basic` | `agent/pre-step`（pressure）、`agent/request`（模型切换，`{prepend:true}`）、`agent/request-error`（`CONTEXT_WINDOW_EXCEEDED_CODE` 恢复）✅ | 各 step 的 request 组装**之前** | ✅ 落盘：`compaction/start|summary|end` + 替换 `user/message`（surface shadowing） | **被 bili gate 关闭**（`auto:false` + `internal/config` 改写行 `disabled:true`） |
| `@deepseek-ai/dsh-session-checkpoint-policy` | `llm/stream`：`if (options.sessionId === void 0) return next(); … await ctx.sessions.flush(session); yield* next();` | 不压缩，只做持久化栅栏 | n/a | 生效（属 dsh-base）；**无 sessionId 时早退** |
| billion-context ACP | `globalThis.fetch` 链（`installFetchChain`）→ 本地代理 `/bili/<url>` | **进程外**，在 adapter 序列化之后、真正上行之前 | ❌ 不落盘（只写它自己的会话状态与统计） | **生效**（`/bili/origin` 探针 + verdict global） |
| `dsh-compaction` / `-tool-result-pruner` / `-image-offload` | 各自独立 backend（未逐个验证是否在 profile 激活） | 在 compaction 框架内 | ✅（同属落盘族） | ◐ 随 compaction-basic 一同被 gate 关闭/未激活 |

## 2. 一次主请求的真实调用链（本机）

```
agent-loop step
 └─ agent/pre-step (waterfall)  … dsh-compaction-basic 在此按 pressure 压缩（本机已关）
 └─ systemPrompt.project + session.append("system/message", …)   ← system 提示词进 history
 └─ buildRequest()  = Object.freeze({...header.config, messages: session.deriveMessages(), toolHistory, tools?, sessionId, signal})
      │                       ^^^^ 压缩后（若 compaction 落盘过）；bili 压缩在此尚未发生
      └─ preparedCall?.stream(request) ?? ctx.llm.stream(request)
           └─ llm.prepareCall → streamWithRegistration
                └─ ctx.waterfall("llm/stream", options, () => adapterStream(options))
                     ├─ [ours]  prepend:true  ← 只读捕获：options.messages 快照（压缩前/落盘后）
                     ├─ [bili]  attribution only：scope={sid,msgIds}; runLlmDispatch(scope, ()=>wrapScopedIterable(next(),scope))
                     ├─ [checkpoint-policy] flush(session) 后 yield* next()
                     └─ adapterStream → adapter(serialize) → fetch(...)
                          └─ [bili 已 patch 的 fetch] URL 改写为 {origin}/bili/{upstream} + 归属头 → 本地代理 18787
                               └─ 代理内 ACP 压缩 → 上行 provider（真正 wire 字节只存在于代理里）
```

要点：

1. `next()` **不接受参数**（`dsh-llm/lib/index.js:2401-2402` `streamWithRegistration`），bili 也不可能通过 `next()` 换 options；它靠 patched `fetch` + AsyncLocalStorage 归属来接管，**不改 options、不动 session**。
2. 我们的 `{global:true, prepend:true}` 捕获位于 bili 之前、compaction 之后：看到的是「内置压缩已生效、bili 压缩未发生」的 messages。
3. 因此**在进程内不可能捕获到 bili 压缩后的 wire body**：字节在代理进程里生成（`/bili/` 前缀 + `register.base` + `fetchProxyVersion(base)` 均指向独立 origin）。
4. `llm/stream` 监听器顺序：prepend 者先跑；`bili` 未用 prepend（`onEvent("llm/stream", …)`，无 options）⇒ 我们的捕获天然排在它前面。必须恰好 `next()` 一次、绝不 mutate（options 对 agent-loop 请求是冻结的）。

## 3. 等价性判定

记 `M = session.deriveMessages()`（= buildRequest 的 messages），`Q` = 用户问题。若「停下来再问」，下一次请求的真实 wire body 为 `W_next = COMPRESS(loop_refresh(M))`；我们的旁路请求为 `W_side = COMPRESS'?(M + Q)`。

| 场景 | `W_next` 的构成 | 旁路**不带** sessionId | 旁路**带** sessionId | 判定 |
|---|---|---|---|---|
| A. 仅内置 compaction（bili 关/off/attach 失败） | `M` 已含压缩；`COMPRESS` 为恒等 | `M + Q` = `W_next` 的消息 + 1 条 ⇒ **结构等价** | 同上，且 checkpoint 会 `flush(session)`（无害） | ✅ 等价（唯一差异：+Q、动态 system/runtime 刷新） |
| B. 仅 bili ACP（本机常态） | 代理内压缩 `M` 的前缀，`M` 本身未压缩 | `M + Q` **未压缩直发**（gate 拒绝接管）⇒ 费用/窗口显著更大，且前缀形态不同（无 `acp_summary_` 块） | 归属成立 ⇒ 代理用同一会话状态压缩 `M + Q` 的前缀 ⇒ **与 `W_next` 同压缩路径、同前缀** | 带 sessionId ≈ 等价；不带 = 近似（超集） |
| C. 两者叠加（bili 关闭过又启用、或旧会话带着 compaction 事件 + bili 代理） | `M` 内已有落盘压缩，再由代理二次压缩 | `M + Q` 未压缩（但 `M` 已被内层压过）⇒ 差一层 | 内层落盘 + 外层代理压缩，与 `W_next` 同构 | 带 sessionId ≈ 等价 |

**形式化结论**：等价性分解为三个可验证条件。

- **E1（前缀相同）**：`W_side.messages[0..n-1] ≡ W_next.messages[0..n-1]`。在场景 A 由 `deriveMessages()` 保证；场景 B/C 只在**归属成功**时由代理保证。
- **E2（工具/配置相同）**：`tools`/`toolHistory`/provider/model/reasoningEffort 来自同一 `EpochHeader` ⇒ 天然相同（我们保留 `tools`）。
- **E3（唯一增量是一条 user 消息）**：`W_side.messages[n] = Q`，且代理的压缩只作用于尾部之前的内容。◐ bili 的 slot 映射按消息 id 做（`hostMsgIdsOf`/`pfSlotIdsOf`，过滤 `acp_summary_`）⇒ 同前缀同槽位，Q 作为最新消息落在"新鲜尾巴"。

**已知不可消除的差异**（诚实记录，不是 bug）：

1. 真实下一次请求会先跑 `agent/pre-step` + `systemPrompt.project`，可能追加/刷新 `system/message`（运行时时间、cwd、上下文段）。旁路请求不会，最多缺 1 条动态 system/context 消息。
2. 真实请求会写 `turn/start|step/*|assistant/message` 等落盘事件并推进 `session.seq`；旁路**不写任何 session 事件**（这是特性，不是等价性缺陷，但意味着「等价」只在 wire 层成立）。
3. 带 sessionId 时 bili 会把这条请求当作该会话的一次模型调用记入它自己的统计/会话状态（可能推进其 slot 水位、计入其 token 报表）。**这正是「停下来再问」会产生的效果**，但对「只想知道答案、不想扰动主会话压缩态」的语义是副作用。**UNCERTAIN**：副作用强度（是否触发额外摘要调用、是否改变下一次真实请求的压缩结果）需探针实测。
4. 若主请求此刻正在流式输出（用户不停），`M` 与 `buildRequest` 用的 `M` 可能相差一个进行中的 assistant 片段：捕获取的是**最近一次已发出的请求**，这正是"latest-wins"的定义域。

## 4. 实现候选排序

| 排序 | 方案 | 代码级可行性 | 等价性 | 副作用 / 冲突风险 |
|---|---|---|---|---|
| **1（推荐）** | **旁路请求带 `sessionId`**（+ 不带 `purpose`），让压缩链自己跑：`ctx.llm.stream({ ...snap, messages: [...snap.messages, Q], sessionId })` | ✅ 直接可写；bili 的 `llm/stream` 监听器按 `options.sessionId` 建 scope；checkpoint-policy 会 flush | B/C 场景 ≈ 等价（E1 由代理保证） | ① bili 统计/会话状态推进（见上）；② `sessions.flush` 一次 I/O；③ **自身捕获必须过滤掉这次调用**（`isAgentLoopRequest(options)===false` ⇒ 天然被过滤，因为只有 `buildRequest` 会打标记）；④ 若主会话在压缩瞬间被 abort，代理侧可能留半截状态（UNCERTAIN） |
| **2（兜底）** | 不带 `sessionId`：**未压缩直发**，接受近似 | ✅ 现状设计 | A 场景等价；B/C 场景是超集（token 更多、可能超窗） | ① bili 记一条 `DIRECT (uncompressed)` 日志/客户端事件；② 大 body 可能触发 `silentDirectBodyCapBytes()` 的本地 422（`emptySlotOversizeRefusal`）；③ 无会话副作用（最"干净"） |
| 3 | 复用 bili 的压缩 routine | ❌ 无公开 API：`dist/agent/dsh-native.js` 导出仅 `apply/inject/name` + `_*ForTest` 钩子；代理只暴露 `/__bili/health|watcher|plugin/manifest`，无"压缩这条 body"端点 | 完美 | 依赖私有 HTTP 协议，版本脆弱（C16 级风险） |
| 4 | 捕获 wire 最终 payload（最低层 hook/adapter/fetch 包装） | ❌ 进程内不可能：压缩在代理进程（18787）内完成；我们只能看到**未压缩**的 fetch body | 完美（若能拿到） | 需要改 adapter/包 fetch/读代理内部，跨进程不可行 |
| 5 | 自建 SubagentProvider / fork 子会话 | 可行但成本高（见 host-api.md §2） | 与 1/2 同样的压缩问题（子会话有自己的 sessionId → 压缩链看到的是**子会话**状态，不是主会话） | 新增子会话、descriptor 事件、两套压缩状态 ⇒ 等价性更差 |

**推荐组合**：默认 **1**；在 `gateCapabilities` 中探测 bili 是否接管（`GET /bili/origin` 200 或 `globalThis.__BILI_DSH_COMPACTION_VERDICT__==='active'`，◐ 后者需在 host ctx 内读），失败或用户配置 `compression:"isolated"` 时退 **2**。两者共用同一快照与同一流式管线，只是 `sessionId` 是否随请求下发。

## 5. 副作用与冲突（对齐 DESIGN.md §7 C1–C18）

| 风险 | 说明 | 对策 |
|---|---|---|
| llm/stream 顺序（C-llm） | 我们的捕获 `prepend:true`，bili 无 prepend ⇒ 捕获在 bili 之前，只读、恰好一次 `next()` | 现有约束不变；捕获**永不** mutate/跳过 `next()` |
| 自我捕获（捕获污染） | 方案 1 的旁路请求带 sessionId，会被任何"按 sessionId 认领"的中间件看到 | `isAgentLoopRequest` 过滤 + 旁路请求不带 `purpose`；再加 `WeakSet` 记录我们自己发出的 request 对象做二次保险 |
| 双压缩 | 不会发生：`M` 未压缩时只经代理一次；落盘压缩 + 代理压缩是**两层不同机制**，与真实请求同构 | 不做任何"预压缩" |
| 重复计费 | 旁路调用本身必然多一次计费（调用 provider）；带 sessionId 时**不会**双计主会话 token（usage 不进 session，除非 bili 把它计进自己的报表） | UI 展示旁路 usage；文档说明"每次提问 = 1 次额外模型调用" |
| 代理状态污染 | 带 sessionId 时 bili 可能推进该会话压缩水位/统计 | 默认开启；提供开关退化为方案 2；**UNCERTAIN** 需实测 |
| 422 fuse | 方案 2 在 bili 拦截态缺失时会拒绝超大直发 | 发送前 `tokenMeter.contextPressure(session)` 预检；失败映射 `overflow` 错误码 |
| checkpoint flush | 带 sessionId ⇒ `sessions.flush(session)` | 无害（一次落盘）；与命令 handler 并发无冲突 |
| abort | 中断在压缩前/后表现不同；`llm.stream` 以 `finish{kind:'aborted'}` 结束而非 throw | 单一 controller：`AbortSignal.any([invocation.signal, AbortSignal.timeout(120_000)])`，按 finish 帧渲染 |

## 6. 探针（只读；不安装、不改配置）

```bash
# P1 bili 是否接管本机（已执行 ✅）
curl -s -m 4 http://127.0.0.1:54419/bili/origin          # → {"origin":"http://127.0.0.1:18787",...}
# P2 代理版本与能力（已执行 ✅ 版本 0.1.213 / commit 133f3525c）
curl -s -m 4 http://127.0.0.1:18787/__bili/plugin/manifest | head -c 300
# P3 compaction 行是否被禁用（gate 生效证据）
grep -n "compaction-basic\|disableBasicCompaction\|VERDICT" \
  /Users/qihoo/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-compaction-gate.js
# P4 内置 compaction 的落盘形态（运行时观测点，非命令）
#    在会话里触发一次压缩后看 session events：compaction/start → compaction/summary → compaction/end
#    + 带 surfaceOp:{op:'replace'} 的 user/message（session.deriveMessages() 立即变化）
```

**观测点（探针脚本，临时文件，不入库）**：

1. 捕获点打点：`messages.length`、末条 message id、`session.seq`、`tokenMeter.measure(session).totalTokens`——与 `deriveMessages()` 对拍，验证 E1 在无 bili 压缩时成立。
2. 方案 1 对照：同一会话分别用「带 sessionId」和「不带 sessionId」发同一问题，比较 `usage.inputTokens`；若带 sessionId 明显更小 ⇒ 代理确实压缩了旁路请求（E1 生效）。
3. bili 日志：不带 sessionId 时应出现 `model request sent DIRECT (uncompressed) … takeover gate refused`（客户端事件/日志），这是方案 2 特征的**硬证据**。
4. 状态污染：方案 1 连续问 3 次后，检查主会话下一次真实请求的 `usage.inputTokens` 是否与"从未提问"的对照会话同阶；差异显著 ⇒ 代理状态被推进。
5. 主请求进行中提问：验证捕获快照是上一个已完成请求（`session.seq` 不变），且旁路不写 session（`session.seq` 前后相同）。

## 7. UNCERTAIN（需要在实现第一天用探针确认）

1. bili 代理对"带归属的旁路请求"是否与主请求走完全相同的压缩路径（同 slot 水位），以及是否会把旁路请求计入其会话统计——直接决定方案 1 的副作用大小。
2. `globalThis.__BILI_DSH_COMPACTION_VERDICT__` 的可见性（host 插件上下文与 bili 同为进程内，应可见；但改全局是 bili 私有约定，不可作为长期依赖 ⇒ 探测 `/bili/origin` 更稳，或两者叠加）。
3. `silentDirectBodyCapBytes()` 的具体阈值与触发条件（源码内为可配置/环境相关；决定方案 2 在超大会话上的失败面）。
4. 场景 C（旧会话带落盘压缩 + bili 代理）在真实 profile 中的出现频率；若极少，等价性论证可简化为 A/B。
5. 代理压缩是否对"最后一条 user 消息"做特殊处理（"quarantine tail" 类策略）——若有，`Q` 会被保新鲜，正是我们想要的；否则可能把 `Q` 也纳入压缩窗口。对答案质量有影响，不影响 E1。

## 7.5 证据附录（可复核的最小片段）

```ts
// ① agent-loop 把「压缩后表面」直接冻结进请求（dsh-agent-loop/lib/index.js:1018）
markAgentLoopRequest(Object.freeze({
  ...header.config,
  messages: boundaryMessages,        // = session.deriveMessages()
  toolHistory: session.toolHistory(),
  ...(header.tools !== void 0 ? { tools: header.tools } : {}),
  sessionId: this.session.id,
  signal,
}));

// ② 内置 compaction 落盘 + 表面替换（dsh-compaction-basic/lib/index.js:634-655）
const summaryEvent = session.append("compaction/summary", { … });
session.append("user/message", checkpointMessage, {
  surfaceOp: { op: "replace", startSeq, endSeq },   // 旧表面被 shadow，deriveMessages() 立即反映
});

// ③ checkpoint-policy 是栅栏不是压缩，且无 sessionId 即早退（dsh-session-checkpoint-policy/lib/index.js）
ctx.on("llm/stream", (options, next) => {
  if (options.sessionId === void 0) return next();
  const session = ctx.sessions.get(options.sessionId);
  return session === void 0 ? next() : afterCheckpoint(ctx, session, next);
});

// ④ bili 的 llm/stream 只建归属，不改请求（dsh-native.js:167 行内 apply 区）
ctx.inject(["llm"], () => {
  onEvent("llm/stream", (options, next) => {
    const sid = typeof options?.sessionId === "string" && options.sessionId.length > 0 ? options.sessionId : void 0;
    if (sid === void 0) return next();                       // ← 无 sessionId：不建 scope
    const scope = { sid, msgIds: hostMsgIdsOf(options?.messages) };
    pfCaptureIds(sid, pfSlotIdsOf(options?.messages));
    return runLlmDispatch(scope, () => wrapScopedIterable(next(), scope));
  });
});

// ⑤ 无归属时的接管拒绝（dsh-native.js，refuse() 内日志模板）
//    `bili-native-dsh: model request sent DIRECT (uncompressed) — takeover gate refused ${key}: ${reason} — refusals so far: ${count}`
//    reason 取值含 "no active initiator attribution (agentless/background lane, third-party in-process caller, …)"
```

观测 → 结论映射（把探针结果直接读成判定）：

| 观测 | 结论 |
|---|---|
| 旁路带 sessionId 时 `usage.inputTokens` ≪ 不带时（同问题、同会话） | 代理确实压缩了旁路请求 ⇒ 方案 1 的 E1 成立 |
| 不带 sessionId 时出现 `DIRECT (uncompressed)` 日志 | 方案 2 确为未压缩直发（等价性仅 A 场景） |
| 带 sessionId 连续提问后，主会话下一次真实请求 `usage.inputTokens` 与对照会话同阶 | 代理状态未被明显扰动 ⇒ 方案 1 副作用可接受 |
| 压缩后 `session.events` 出现 `compaction/summary` + `surfaceOp.replace` | 内置 compaction 生效且落盘 ⇒ `deriveMessages()` 即压缩表面 |
| 主请求流式中提问，旁路前后 `session.seq` 不变 | 捕获/旁路都不写 session（无污染） |

## 8. 对 DESIGN.md 的具体修改建议

1. **§3/§4 侧调用参数**：把「side 调用不带 sessionId」改为**条件带 sessionId**（默认带；`compression:"isolated"` 或检测到 bili 未接管时不带），并写明理由：无 sessionId ⇒ bili gateway 拒绝接管 ⇒ DIRECT 未压缩直发，等价性仅在内置 compaction 场景成立。
2. **§2 等价性小节（新增）**：收录 E1/E2/E3 三条件 + 三条不可消除差异（动态 system 刷新、不写 turn、bili 统计副作用）。
3. **§7 冲突表**：新增一行「压缩等价性」——与 billion-context 的接管 gate 交互；对策：条件 sessionId + 发送前 token 预检 + `overflow` 错误码。
4. **§8 能力门**：加入 `compression` 探测项（`GET /bili/origin` 或 verdict global），失败不阻断，只降级为方案 2 并在栏内提示一次。
5. **§6 错误码**：`overflow` 明确对应两种来源（tokenMeter 预检 / 代理 422 fuse），用户文案区分。
6. **新文件引用**：在 DESIGN.md 头部研究依据列表加入 `research/compression.md`（本文件）。
