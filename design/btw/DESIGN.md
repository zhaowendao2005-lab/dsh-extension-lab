# BTW · 旁路提问插件设计（v1 设计稿）

> 状态：**设计稿，未实现**（用户要求「先设计」）。目标运行时：DSH `0.2.2-rc.1`，profile `desktop`。
> 研究依据（同目录）：[host-api.md](research/host-api.md)（真实请求捕获 / 旁路执行 / 交付通道）、[client-ui.md](research/client-ui.md)（栏位槽 / 流式渲染）、[conflicts.md](research/conflicts.md)（命令 / 钩子 / 槽位冲突矩阵 C1–C18）、[compression.md](research/compression.md)（两层压缩 / takeover gate / 等价性判定）、[settings-ui.md](research/settings-ui.md)（设置分页 / configForms / volatile 配置）。
> 原始需求（用户 m00001）：「设计一个新的插件，BTW（即旁路提问），新增一个 `btw` 命令……依据真实的请求记录……独立运行与展示……使用 ts 开发……提前考虑相关钩子和函数的冲突问题……先设计」。

---

## 0. 结论速览

- 产品形态：主输入框输入 `/btw <问题>` → 用**当前会话最新一次真实 LLM 请求**的上下文做一次独立的、只回答不调工具的旁路问答 → 结果流式渲染在输入框上方的**「旁路栏」（BTW Bar）**里；不进入主对话、不打断主回合、不改主会话历史。
- 五个关键决策：
  1. **不做 fork 子 Agent**：fork 只继承到最后一个 `turn/end`，看不到进行中的回合；`CreateAgentOptions` 无法携带 system/messages，真 Agent 必然重新拼系统提示词。v1 用 `ctx.llm.stream()` 回放「停下来的那一次请求」——独立性体现在独立的 request / abort / stream / 展示（详见 §2.1）。
  2. **上下文 = 捕获的请求配置 + 提问时的实时消息面**：`provider/model/system/tools` 取自拦到的真实请求，`messages` 优先 `session.deriveMessages()`（已压缩则即压缩后内容），因此同时满足「真实请求记录」与「压缩后内容」两条要求（§2.2、§4.1–4.2）。
  3. **栏位 = `conversation.input.dock` 的常驻栏**（session 级、自动出现）；传输 = 手写 Typert **stream** Remote（Electron 下 SSE 不可用、`$on` allowlist 编译期固定）。右栏 tab 作为 P2 备选（§2.3–2.4、§5.7）。
  4. **压缩等价性**：旁路请求默认**携带主会话 `sessionId`**，让 billion-context 的 wire 层压缩链照常接管（等价于「停下来问」的压缩面）；`compression` 可配 `inherit | isolated | direct`。代价是 bili 统计/水位推进 + 一次 session flush（不写 chat 节点、不改历史），实现首日以探针量化；不带 sessionId 只作降级（未压缩直发，可能触发代理 422）。
  5. **可配置 + 设置分页**：设置中心新增 `settings.section` 分页（id `btw-side`, order 50），表单经客户端 `ctx.configForms` 读写宿主 Schemastery `Config`（可编辑字段全部 volatile），保存走 profile patch YAML + Loader reconcile 热更新；命令名 / 栏位形态 / 压缩档 / 并发上限等都可在设置页配置（§2.7、§5.8）。
- 与现有 `@michengai/dsh-btw` 的差异：真实请求上下文（含进行中回合 / 压缩后）、逐 token 流式、常驻栏 + 多问题历史 + 来源标注、不调工具、不 patch 任何服务、命令名自动避让（可并存）、设置中心独立分页（可配置）。
- 已确认决策见 §12（默认 `inherit` 归因、默认 dock 栏、v1 不持久化）；**图 1 仍未收到**，视觉先按 §5.4 规格实现，补图后可微调。

---

## 1. 需求 → 设计映射

| # | 用户要求 | 设计落点 | 验收方式 |
|---|---|---|---|
| R1 | 依据**真实请求记录**，不是轮次 | `llm/stream` 捕获每次真实请求（agent loop 每个 step 一次请求）；提问时取最新捕获 + 实时消息面 | 一轮 10 分钟 / 十几次工具调用后提问，回答能引用中间步骤的部署结论（V3） |
| R2 | 已触发压缩则用**压缩后内容** | 内置 compaction 在 step 前落盘 → `deriveMessages()` 已是压缩面；billion-context 在 fetch/代理层压缩 → 旁路请求默认携带主会话 sessionId 让同一条链接管（§2.2.1） | 压缩后提问，答案不引用已被压缩掉的内容（V4/V11） |
| R3 | **独立运行**的 Agent | 独立 side run：独立 LLM request、独立 AbortController/超时、独立流、独立生命周期与展示；默认只回答 | 主回合继续跑时旁路提问可同时完成，互不影响（V6） |
| R4 | 渲染出**一个栏**显示旁问结果 | 输入框上方 dock 栏（收起 = 一行；展开 = 问答题卡片列表），流式更新 | 栏自动出现 / 可收起 / 多问题并列（V7） |
| R5 | **不影响主线** | 不写 chat node、不起工具、不改 system prompt、不写会话事件；旁路请求默认带 sessionId **仅作压缩归因**（可切 isolated/direct），副作用仅 bili 统计/一次 flush（§2.2.1、§2.6） | 主对话无新增消息、无工具执行、无可见变化（V6/V11） |
| R6 | 使用 **TS** 开发 | Host/Client/协议全部 TS，`tsc --noEmit` + esbuild 出 `lib/` | `pnpm build` 通过 |
| R7 | 提前考虑**钩子/函数冲突** | 只读 listener、命令别名、唯一 id/命名空间、不 patch、不抢单槽（§7） | V1/V2/V5/V8 |
| R8 | 多问题 / 并发可用 | per-session run map + watcher 流 + 上限（默认并发 3） | 两条问题同时流式、独立取消（V7） |
| R9 | 可解释 / 可追溯 | 每条回答标注来源：「最新真实请求 · model · N 条消息 · 时间」；重建时标注降级 | 卡片底部来源行（V3） |
| R10 | 允许配置 / 设置新增配置分页 | 设置中心 `settings.section` 分页（id `btw-side`, order 50）+ volatile `Config` + `ctx.configForms` 表单；保存热更新 | 设置页保存后行为按约定生效（V12） |

---

## 2. 核心设计决策

### 2.1 「独立 Agent」的落地：独立 side run，而不是独立子会话

用户说「本质上是开一个 Agent 来运行」。但要让答案严格基于**最新真实请求**，真子 Agent 做不到：

| 方案 | 证据 | 结论 |
|---|---|---|
| `subagents.getProvider("fork")` + `startActivation`（现有 btw 的做法） | `dsh-subagent-fork-in-process/lib/index.js`：`prepareContinuable()` → `completedTurnPrefix()` 只取到最后一个 `turn/end`；注释明确「当前未完成的工具调用回合无法作为合法子会话回放」 | ❌ 看不到进行中的回合，恰好丢掉用户最在意的「这一轮里的十几次调用」 |
| `agentLoop.createAgent` / `agents.create` 传入历史 | `CreateAgentOptions = { sessionId, parentAgent?, meta?, inheritedEventCount?, seed?: SessionEvent[], agentOptions?, signal?, setup? }`；无 messages/system 通道 | ❌ 只能 seed 事件；Agent 会用 systemPrompt.assemble 重新拼系统提示词，无法字节级复刻 |
| 自定义 `SubagentProvider` 合成 seed 事件 | 需要伪造完整 request 事件并对齐 system 投影；成本高、版本脆弱 | ⏸ 不选（C16，P2 再评估） |
| **直接 `ctx.llm.stream()` 回放** | `LlmRuntime.streamWithRegistration` → `ctx.waterfall(this,"llm/stream",options,()=>this.adapterStream(options,prepared))`；`next()` 无参，适配器用的就是同一份 options | ✅ v1 主方案 |

因此 v1 的「独立运行」定义为：**独立的一次旁路请求 + 独立的生命周期与展示**，而不产生子会话、子 Agent、子 session。文档中称 **side run（旁路运行）**。它天然满足 R5：无工具、无子会话、无主历史写入。

### 2.2 上下文取哪一份：捕获配置 + 实时消息面

DSH agent loop 的每一步都是**一次真实 LLM 请求**（收到工具结果后进入下一步 → 新请求）。所以「10 分钟、十几次调用」对应约十几次 `llm/stream` 调用；捕获「最近一次」就拿到了完整历史（含中间工具结果），压缩已发生则已经是压缩后的消息面。

组装规则（提问瞬间执行，等价于「把会话停下来直接问下一次」）：

```
provider / model / reasoningEffort / temperature  ← 最新捕获的真实请求
system                                            ← 最新捕获的真实请求（缺失时尝试 systemPrompt.assemble）
tools                                             ← 最新捕获（保持调用配对合法；只用于形态，不执行）
messages                                          ← session.deriveMessages()（实时、压缩后的日志面）
                                                    └ 不可用时退回捕获时保存的 messages
messages + createUserMessage(`/btw` 的问题)
```

- 为什么 messages 用实时面而不是快照：快照是上一次请求发出时的消息；`/btw` 触发时会话可能又前进了（例如新一轮工具结果已落盘）。用实时面 = 真正「停下来问」，也自然覆盖「压缩后」。
- 快照仍然保存捕获时的 messages：用于降级、调试与「来源」展示（消息条数、时间、模型）。
- 若快照缺失（插件中途启用 / LRU 淘汰）：用 `session.requestHeader()` 的 config/tools + `session.deriveMessages()` 重建，system 用 `systemPrompt.assemble(agent)`，UI 标注「上下文为重建」。

#### 2.2.1 压缩等价性（内置 compaction / billion-context）

本机内置 compaction 实际关闭：billion-context 的 bundle patch 把 `compaction-basic` 设为 `auto:false`，compaction gate 在 verdict `"active"` 时把 compaction-basic / command-compact 行改为 `disabled:true`；`/bili/origin` 返回本地代理（本机为 `127.0.0.1:18787`）即证明接管。压缩因此分两层：

| 层 | 位置 | 是否落盘 | 对插件可见性 |
|---|---|---|---|
| 内置 compaction | agent/pre-step、agent/request（模型切换）、agent/request-error（超窗恢复） | ✅ 写 `compaction/summary` + `surfaceOp:'replace'` 的 user/message | `deriveMessages()` 立即是压缩后表面 |
| billion-context ACP | 进程内 fetch 链之后、本地代理内 | ❌ 不落盘、不改 options、不写 session | `llm/stream` / `agent/pre-step` 都看不到 wire 最终 body |

因此「停下来再问」的等价性拆成三条可检查条件：**E1** 消息前缀相同；**E2** tools/config 相同；**E3** 只多一条 user 问题消息。场景判定：

| 场景 | 不带 sessionId | 带主会话 sessionId（默认 inherit） |
|---|---|---|
| A 仅内置 compaction | 等价（deriveMessages 已压缩） | 等价 |
| B 仅 billion-context（本机常态） | ❌ takeover gate 拒绝接管 → `DIRECT (uncompressed)` 直发：token 更大、无 ACP 摘要、可能撞代理 422 body cap | ✅ 同一条压缩链接管（统计副作用待探针量化） |
| C 两者叠加 | 同上 | ✅ |

不可消除的差异（需在 UI/文档如实说明）：旁路请求不写 turn；动态 system/runtime 刷新时机不同；bili 统计/水位会推进。结论：默认 `compression:"inherit"`；`isolated` 用 `btw:<sessionId>` 合成归因（与主线隔离，但 bili 会建立独立压缩态，需探针）；`direct` 仅作降级。探针清单见 `research/compression.md` §6 与 §11 V11。

### 2.3 展示位置：输入框上方的常驻栏（primary）

| 候选 | 判断 | 理由 |
|---|---|---|
| `conversation.input.dock`（list/session，输入框卡片上方，全宽） | ✅ **v1 主栏**（默认；设置页 `barForm` 可切 `right-tab`） | 自动出现、无需用户额外打开；session 级天然隔离；dock 列表允许与现有 btw 并存（不同 id/order）；符合「出一个栏」 |
| `sidebar.right.pane.tab`（右栏 tab，keyed/session） | ⏳ P2 | 阅读体验最好，但**没有可靠的首开编程入口**：`sidebarRightTabs` 只能注册、`ctx.layout.openRightbar` 只能打开列、不能选中 tab；首次必须用户点 header/guide。作为「在右侧栏展开」的增强（§5.7） |
| `rightbar` / `rightbar.session` | ❌ | 单槽、由 sidebar-right 拥有，shadow 会删掉内置右栏 |
| `shell.bottom` | ❌ | 单槽被 experimental-inspector 占用；且压缩对话高度 |
| `shell.overlay` 浮动条 | ❌ | 绝对定位点击穿透层，需 portal、z-index 竞争；栏位应是布局内组件 |
| `conversation.composer.dock` | ❌ | 卡片下方 ambient 行，位置不对且窄 |
| `conversation.view` / `main` | ❌ | 旁答不是会话视图/主页面 |

现有 btw 也在 `conversation.input.dock`（`id: michengai-btw`, `order: -50`），我们注册 `id: btw-side`, `order: 0`：list 槽按 id 去重、按 priority/order 排序，两个条目互不覆盖，视觉上并排（我们排在它下面）。

### 2.4 传输：手写 Typert stream Remote

| 通道 | 结论 | 证据 |
|---|---|---|
| `ctx.remote.$on("btw/…")` | ❌ 自定义事件 | `API_REMOTE_FORWARDED_EVENTS` 是编译进 host/client 两侧的 allowlist |
| `ctx.webServer.register` SSE | ❌ 桌面端 | `dsh-host-webserver`：「Electron 使用 file:// + IPC，本包从不打印 URL」——页面不同源，拿不到流 |
| session projections | ❌ | 只能由已提交的 session 事件驱动，无自由 publish |
| `remote.commands.execute`（现有 btw） | 降级可用 | 一次性返回最终文本，无流式、无重连 |
| **Typert `@Remote({mode:'stream'})` 手写契约** | ✅ 主方案 | `bindTypertRemote` + `ctx.typert.register(hostContribution)`；内置 `session.control/follow`、trajectory `remote.$stream` 同款载体；仓库内 `packages/model-intelligence-test` 已有手写契约先例（unary）。`mode:'stream'` 属协议合法值（`validateInvocation`：mode 只能是 `'stream'`；cancellation.parameter 必须是 `'signal'`） |

客户端一句 `for await (const frame of remote.btwSide.watch({sessionId, afterSeq}, signal))` 即可拿到 delta/done/error；断线用 `afterSeq` 重放。

### 2.5 命令与共存

- 注册 `/btw`；若名字已被占用（`commands.register` 抛 `command "btw" is already registered…`），**try/catch 试注册 + 自动改名** `btw2` → `btw-side`（`onConflict: "rename" | "disable"`，默认 rename）。
- 绝不静默失败：apply 期抛错会被 loader/cordis 吞掉，插件条目变成 `failed` 且用户无感（C1）。改名后在栏内提示一次，并写 host 日志。
- 不注册内部命令（`btw-run`/`btw-close` 之类），因此**不需要 patch `commands.list`**（C5；现有 btw 的 `Object.defineProperty` patch 是兼容性风险源，我们不碰）。
- 命令名从基线帧下发，客户端据此隐藏命令行走廊（§5.6）、重试时拼回命令。

### 2.6 「不影响主线」清单（v1 明确不做）

| 不做 | 原因 |
|---|---|
| 不写 user/assistant 消息、不注册 `conversation.chat.node` | 主对话零新增 |
| 不执行任何工具、不注册 `tools.guard` | 默认「只提问」；只丢弃 `tool-call-delta` |
| side 请求默认**带主会话 `sessionId`**（压缩归因） | 让 billion-context wire 压缩链接管，满足「停下来问」的压缩面；不写 chat 节点/历史、不执行工具。代价：bili 统计/水位推进 + checkpoint flush（不产生可见消息）；可配 `isolated` / `direct` 关闭 |
| 不加 `systemPrompt.section`、不改 `agent/pre-step` | 不改主 Agent 提示词 |
| 不写 session 事件（v1） | 刷新后历史不保留（P2 再评估），换取零污染 |
| 不改 commands/llm 服务实例 | 无 patch，卸载即净 |

### 2.7 可配置与设置分页（P1）

- 设置中心新增 `settings.section` 分页（list/root，注册在 `sidebar.settings` 的 seat 内；fresh id 增量添加，复用 shipped id 会替换该格）→ 独立 nav 入口「旁路提问」。
- 页面 body 是**自由 React**（非固定 schema）；读写统一走客户端 `ctx.configForms`（`ConfigForms.get(ns)` → `ConfigFormController.getSnapshot()/mutate()`，内置 revision CAS；`writable !== true` 或描述符缺失时只读），保存后经转发事件 `settings/document-updated` 刷新。**不直接** `remote.settings.*` 写（会绕过镜像缓存与 revision）。
- 持久化：host 导出 Schemastery `Config`，**每个可编辑字段必须 `volatileField()`**（`.volatile()`）；namespace = profile patch entry id `btw-side`；保存经 Loader reconcile 热更新、无需重启；`commandName` 等改动在下次 reconcile 生效。
- 页面字段：`commandName`、`barForm(dock|right-tab)`、`compression(inherit|isolated|direct)`、`maxTokens`、`timeoutMs`、`maxConcurrent`、`maxPerSession`、`showProvenance`、`onConflict`；结构/生命周期字段保持非 volatile 且不展示。
- 命名空间隔离：section id / locale NS / entry id 均用 `btw-side`，不复用旧 btw 的 `michengai-btw` 及其 `plugins.*.config` slot key；可另加新包名的 bundle 配置卡指向同一 form face（可发现性 + 设置页不可用时降级）。
- 若自动生成的配置页与新分页重复：host `ctx.settings.configure({ auto:false })` opt-out；设置页挂载失败不影响命令/栏等核心功能。

---

## 3. 流程

### 3.1 端到端时序

```
用户: /btw 这轮部署都成功了吗？
  │
  ├─(1) 主会话命令运行时执行 Host handler（recordInput:false，问题不写 durable 事件）
  │        └─ BtwSideService.startAsk(session, question)
  │             ├─ 取快照 / 重建 → 组装 side payload（§4.2）
  │             ├─ 创建 run（requestId, AbortController）
  │             └─ 返回 {kind:'success', text:''}（不等答案）
  │
  ├─(2) Host: ctx.llm.stream(payload)  ← 独立旁路请求
  │        └─ text-delta → 广播 frame{type:'delta', n}
  │        └─ finish → frame{type:'done'} / error → frame{type:'error'}
  │
  ├─(3) Client: BtwBar（dock 槽常驻）已在 watch 流上
  │        ├─ accepted → 自动展开栏，插入问题卡片
  │        ├─ delta → 卡片打字机更新（流式）
  │        └─ done → 展示来源行 + 复制/重试
  │
  └─(4) 主对话：命令行被 commandview 置空隐藏；无消息、无工具、无 system prompt 变化
```

### 3.2 问题状态机

```
queued → calling → streaming → done
   └────────┴──────────┴──→ error（no-context / model / overflow / timeout / internal）
   └───────────────────────→ cancelled（用户取消 / 会话销毁 / 插件卸载）
```

同一会话可并行多条（默认上限 3，超出即时报 `busy`），每条独立取消、独立重试。

---

## 4. Host 设计

### 4.1 真实请求捕获（`llm/stream`）

```ts
// src/host/capture.ts
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'; // 半公开；实际实现改 lazy import()，见 §8

ctx.inject(['llm'], (sub) => {
  sub.on('llm/stream', (options, next) => {
    try {
      if (
        isAgentLoopRequest(options) &&
        options.purpose === undefined &&        // 排除 compaction / title / auto-review
        typeof options.sessionId === 'string'   // 排除无会话的辅助调用
      ) {
        capture(options);                        // 只读、不 mutate
      }
    } catch { /* 捕获失败不得影响主请求 */ }
    return next();                               // 必须且只能调用一次
  }, { global: true, prepend: true });
});
```

- `options`（`GenerateOptions`）在主循环里被 `Object.freeze`：**绝不 mutate**，只按引用保存、浅拷贝外层 `messages` 数组。
- 捕获点 = 内置 compaction 之后、billion-context wire 压缩之前；bili 在 `llm/stream` 只建 AsyncLocalStorage 归因（不读也不改 messages），真正的 ACP 压缩在其 `fetch` 拦截之后的本地代理里。因此快照是「内置压缩已生效 / bili 压缩未发生」的消息面（§2.2.1）。
- side 调用是否带 `sessionId` 由 `compression` 决定（默认 inherit）；`purpose` 仅作本地标记（不进入公共联合类型）。`isAgentLoopRequest` 保证 side 调用不会被当作主请求快照（自我污染）。
- 存储：`Map<SessionId, BtwSnapshot>`，最新覆盖；LRU 8 个会话；单快照 messages > 1200 条时只留 config 元信息（提问时反正走实时消息面）；`session/disposed` 删除；插件卸载清空。

```ts
interface BtwSnapshot {
  sessionId: string;
  capturedAt: number;
  provider: string; model: string; reasoningEffort?: string;
  system?: string;
  tools?: ToolSchema[];
  messages?: RequestMessage[];      // 捕获时快照，仅降级/展示用
  messageCount: number;
  payloadRef: GenerateOptions;      // 冻结对象，只读
}
```

### 4.2 提问时组装 side payload

```ts
// src/host/payload.ts
function buildSideRequest(agent, snap, question, cfg): GenerateOptions {
  const session = agent.session;
  const live = tryDerive(session);            // session.deriveMessages()，抛错则 undefined
  const base = snap
    ? { provider: snap.provider, model: snap.model, reasoningEffort: snap.reasoningEffort,
        system: snap.system, tools: snap.tools }
    : reconstruct(session);                   // requestHeader().config/.tools + systemPrompt.assemble(agent)
  const messages = live?.length ? live : (snap?.messages ?? []);
  if (!messages.length) throw new BtwError('no-context', '这个会话还没有真实请求记录，先发一条消息再 /btw');
  return {
    ...base,
    messages: [...messages, createUserMessage({ content: [{ type: 'text', text: `${SIDE_ANSWER_ONLY}\n\n${question}` }] })],
    maxTokens: cfg.maxTokens,
    signal,                                    // AbortSignal.any([invocation.signal, timeout])
    // 压缩归因：默认 inherit = 主会话 id（让 bili 压缩链接管）；isolated = 合成 id；direct = 不带
    sessionId: compressionSessionId(cfg.compression, session.sessionId), // Branded<SessionId>，见 §2.2.1
    // 刻意不带：purpose；tools 仅保留定义、绝不执行
  };
}
```

- `provider/model` 取不到或不可用时 → `error{code:'model'}`，提示「请检查模型配置」。
- 预检：`ctx.tokenMeter.contextPressure(session)` + `estimateMessage(question)` 对比 `contextWindow * 0.98`；超限直接 `error{code:'overflow', source:'preflight'}`（不把超长请求打给模型）。`compression:'direct'` 下还要接住 bili 代理的 422 body cap，映射为 `overflow{source:'proxy'}`。
- system 缺失（重建路径）时允许无 system 运行，但卡片标 `degraded: true`。
- **尾部配对裁剪**：若 `messages` 最后一条 assistant 消息带 `tool_calls`、而对应 tool 结果尚未落盘（工具仍在执行），先裁掉该 assistant 消息再追加问题，来源行标注「以最近完成步骤为准」；否则部分 provider 会拒绝「user 消息紧跟未完成的 tool_calls」。
- payload 在 run 创建时一次性组装并冻结，运行中不再跟随主会话变化；来源信息（时间/模型/消息数）即取该时刻。
- **保留 tools 定义**：历史消息里可能存在 `role:'tool'`，部分 provider 要求 tools 与 tool_calls 配对；我们只提供定义、绝不执行（`tool-call-delta` 一律丢弃，`finish.reason==='tool-calls'` 时报 `tools-attempted`）。
- **注入 answer-only 提示词**：把常量 `SIDE_ANSWER_ONLY`（「这是一次旁路提问：只依据当前对话已有的上下文直接回答，不要调用任何工具，也不要输出或提议工具调用。」）前置在用户问题文本前。它不改变捕获的请求配置与消息前缀（仍满足 E1/E2），只在尾部多一条受约束的 user 消息；实测模型会直接作答而非发起工具调用，`tools-attempted` 仍作为连接层兜底错误保留。
- **`compression` 三档**：`inherit`（默认，`sessionId=session.sessionId`，与主请求同一条压缩链）/ `isolated`（``sessionId=`btw:${session.sessionId}` ``，独立归因，bili 建立独立压缩态；首日探针验证）/ `direct`（不带 id，未压缩直发，仅当探测不到压缩接管或用户强制时使用）。
- **带 sessionId 的副作用（已核实代码）**：`dsh-session-checkpoint-policy` 会在模型边界 `flush` 主会话（耐久保存，不产生 chat 事件）；`dsh-session-title` 的 `onMainRequest` 因 `isAgentLoopRequest(options)===false` 直接忽略；bili 可能推进该会话统计/水位——均不改变主对话可见内容，实现首日量化。

### 4.3 旁路执行（answer-only）

```ts
// src/host/run.ts
async function runSideCall(run, payload, emit) {
  emit({ type: 'accepted', view: run.view });
  let text = '';
  for await (const chunk of ctx.llm.stream(payload)) {
    switch (chunk.type) {
      case 'text-delta':   text += chunk.text; emit({ type: 'delta', requestId: run.id, seq: ++run.seq, text: chunk.text }); break;
      case 'reasoning-delta': /* 可选显示「思考中」，不进答案 */ break;
      case 'tool-call-delta': /* 丢弃：默认不执行工具 */ break;
      case 'usage':        run.usage = chunk.usage; break;
      case 'finish':
        if (chunk.reason.kind === 'tool-calls') throw new BtwError('tools-attempted', '模型尝试调用工具，旁路提问只支持纯文本回答');
        if (chunk.reason.kind === 'aborted') return emit({ type: 'cancelled', requestId: run.id });
        if (chunk.reason.kind === 'error') throw new BtwError('model', chunk.reason.failure.message);
        return emit({ type: 'done', requestId: run.id, answer: text, usage: run.usage, finishedAt: Date.now() });
      default: break;
    }
  }
}
```

- 一个 run 一个 `AbortController`：`AbortSignal.any([invocation.signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)])`。
- 取消 / 超时 → abort → 收到 `finish{kind:'aborted'}` → `cancelled` 帧（不是异常）。
- 答案纯文本上限 64 KB（防异常模型刷屏），超出截断并标注。
- 输出 token 默认 `maxTokens: 8192`（可配置，旁答通常短）。

### 4.4 Remote 服务契约（host）

```ts
// src/host/service.ts
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol';

export class BtwSideService extends Service {
  constructor(ctx) { super(ctx, 'btwSide'); this.typertRemote = bindTypertRemote(this, 'btwSide'); /* ... */ }

  async *watch(request, signal) {          // mode:'stream' → 客户端 AsyncIterable
    yield { type: 'baseline', sessionId: request.sessionId, commandName: this.commandName,
            questions: this.views(request.sessionId), cursor: this.cursor(request.sessionId) };
    // 先补发 afterSeq 之后的缓冲帧，再挂到会话事件总线；signal 结束只退订，不取消 run
    yield* this.bus.subscribe(request.sessionId, { after: request.afterSeq, signal });
  }
  async state(request) { /* { commandName, questions, cursor }，非流式降级/重连用 */ }
  async close(request) { /* 取消该 session 的某条 run；幂等 */ }
  async clear(request) { /* 清掉已完成卡片（host 缓冲同步清理） */ }
}

const inits = [];
Remote('watch')(BtwSideService.prototype.watch, { kind: 'method', name: 'watch', mode: 'stream',
  cancellation: { parameter: 'signal' }, static: false, private: false,
  addInitializer(i) { inits.push(i); } });
// close / clear 为普通 direct 方法（mode 缺省）
```

```ts
// src/host/index.ts
export const name = 'dsh-btw-side';
export const inject = ['typert', 'commands'];
export function apply(ctx, config) {
  gateCapabilities(ctx);                      // §8
  const svc = new BtwSideService(ctx, config);
  ctx.effect(() => ctx.typert.register(hostContribution), 'btw-side.remote-contract');
  ctx.effect(() => registerCommand(ctx, svc, config), 'btw-side.command');
  ctx.effect(() => capture.install(ctx, svc), 'btw-side.capture');
  ctx.effect(() => () => svc.dispose(), 'btw-side.dispose');
}
```

契约唯一来源：`src/shared/contract.ts` 用 `createTypertRemoteInfo({package:'dsh-btw-side', methods:{...}}, z)` 生成 host/client 两侧 descriptors（先例：`packages/model-intelligence-test/shared/contract.js`）。实现期需用一次探针验证 `mode:'stream'` 的手写 descriptor 能通过 `validateInvocation` 并由 gateway 走 stream carrier（见 §11 V9、§8 UNCERTAIN）。

### 4.5 命令

```ts
// src/host/command.ts
const base = config.commandName ?? 'btw';
const candidates = [base, `${base}2`, `${base}-side`];
let chosen;
for (const name of candidates) {
  try {
    ctx.effect(() => ctx.commands.register({
      name,
      description: 'BTW 旁路提问：基于当前会话真实请求上下文提问，不影响主线',
      input: { hint: '<问题>' },
      recordInput: false,                        // 问题不写入 durable command/run
      handler(invocation) {
        const question = invocation.rawInput.trim();
        svc.startAsk(invocation.agent, question);   // 同步创建 run，异步执行
        return { kind: 'success', text: '' };        // 立即返回，不阻塞主回合
      },
    }), `btw-side.command.${name}`);
    chosen = name; break;
  } catch (err) {
    if (!/already registered/.test(String(err?.message))) throw err;
  }
}
if (!chosen) throw new Error('btw-side: 没有可用命令名，请禁用其他 /btw 提供者');
svc.commandName = chosen;
```

- 空问题：不创建 run，bar 展开显示输入提示（`error{code:'empty-question'}` 帧）；问题 > 4000 字符 → `too-long`。
- 命令结果文本为空：P1 保留命令行（用于让 `/btw` 的失败原因可见）；`conversation.chat.commandview` 置空隐藏列为 P2（§5.6）。
- 延迟创建 run 里如果快照缺失，直接发 `error{code:'no-context'}` 帧——栏打开并给出可读提示，而不是让命令静默失败。

### 4.6 生命周期与容量

| 资源 | 上限 / 清理 |
|---|---|
| 快照 | 每会话最新 1 份；LRU 8 会话；`session/disposed` 删除 |
| run | 每会话保留最近 20 条（含运行中）；全局并发 3；完成卡片文本 ≤64 KB |
| 帧缓冲（重连） | 每会话 ring 512 帧 / 10 条 run；`afterSeq` 重放 |
| watcher | 每个客户端栏一条；客户端 dispose → 退订（不取消 run） |
| abort | 会话销毁 / 插件卸载 / 用户取消 → abort 全部 in-flight |
| HMR / 双实例 | 所有注册进 `ctx.effect`；启动时探测同 module 重复实例并只注册一次 |

### 4.7 降级路径

1. `remote.btwSide` mount 失败（typert stream 不可用）→ 客户端不显示流式栏，插件仍注册命令；host 检测到「无 watcher 且配置 `fallbackToCommandResult=true`」时可把完整答案作为命令结果文本返回（P2）。
2. 捕获不到真实请求 → 重建上下文 + `degraded` 标注。
3. 模型报错 / 上下文超限 → 错误卡片原文展示 failure.message，支持重试。

---

## 5. Client 设计

### 5.1 挂载

```ts
// src/client/index.tsx
const ID = 'dsh-btw-side';
window.__ModuleLoader__.load({ id: ID, factory(require) {
  const React = require('react');
  return { name: ID, inject: ['slots', 'remote', 'locale', 'sessions', 'configForms'], async apply(ctx) {
    const unmount = await ctx.remote.$mount(remoteInfo);         // 失败 → ctx.logger.warn，降级
    ctx.effect(() => unmount, 'btw-side.remote');
    ctx.inject(['remote.btwSide'], (c) => {
      const remote = c.get('remote.btwSide');
      const stores = new BtwStoreRegistry(remote);
      ctx.effect(() => () => stores.dispose(), 'btw-side.stores');
      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register({
          name: 'conversation.input.dock', id: 'btw-side', order: 0, locale: NS,
          inject: (owner) => ({ stores, sessionId: owner.session.sessionId, locale: t }), // owner = InputZone（入参以 slot 契约目录为准）
        }, BtwBar)), 'btw-side.bar');
      // P1 结束：命令行为空视图（候选别名全部注册为 null）
    });
  } };
}});
```

- Bar 是 `list/session` 槽条目，ownerProps 为 `InputZone { session, input }`；`session.sessionId` 决定 store。
- 注册外层 try/catch：槽位失败不能让整个插件条目失败；失败时命令仍可用（答案走命令结果时可见）。
- 全部注册进 `ctx.effect`；`keepMounted`/重渲染不重复建 store。

### 5.2 组件结构

```
BtwBar (dock 条目，sessionId)
├─ 无问题且未展开 → null（不占位）
├─ CollapsedBar：图标 + “旁路提问” + 最新问题摘要 + 流式指示点 + 条数徽标 + 展开箭头（36px）
└─ ExpandedPanel（展开时，max-height: min(45vh, 480px)，内部滚动）
   ├─ 头部：标题「旁路提问 · 基于真实请求」+ 收起/清空
   ├─ 空态：`输入 /btw <问题> 开始旁路提问`（附 2 个示例）
   └─ BtwCard × N（时间正序，自动滚到底部）
      ├─ 问：文本（长问题折叠 2 行）
      ├─ 答：流式文本（▍光标）/ 错误 / 取消
      ├─ 操作：复制、重试、取消（运行中）、移除（完成后）
      └─ 来源行：最新真实请求 · <model> · <N> 条消息 · <时间> [· 上下文已重建]
```

### 5.3 交互

- 触发：主输入框 `/btw 问题` 回车（命令由会话 UI 执行）。栏收到 `accepted` 自动展开；流式完成不自动收起。
- 收起状态按会话记忆（localStorage，`dsh.btw-side.expanded.<sessionId>`）。
- 取消：卡片 × → `remote.btwSide.close({ sessionId, requestId })`；宿主 abort，卡片转 `cancelled`。
- 重试：客户端用 `remote.commands.execute(sessionId, '/<commandName> <question>', [], signal)` 重发（命令名来自基线帧，兼容改名）。
- 复制：复制 answer 原文；复制成功后按钮短暂变 ✓（不依赖 markdown 渲染）。
- 清空：`remote.btwSide.clear({sessionId})` + 本地清空（运行中的保留）。
- 来源行是差异化点：让用户确认「答的是哪一次真实请求」。
- 无问题且无运行 → 栏不渲染，避免常驻空白条。

### 5.4 视觉规格

- 只用主题 token，禁止硬编码颜色：`--dsw-alias-bg-layer-1/2`、`--dsw-alias-border-l1/l2`、`--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-success-primary`、`--dsw-radius-panel/md`、`--dsw-elevation-soft`、`--dsw-font-xs-13`、`--dsw-font-family`；正文字号 `var(--dsh-content-font-size, var(--dsw-font-xs-13))`，字体 `var(--dsh-font-family-text)`。
- 深色模式自动（`data-ds-dark-theme` on body），不写死颜色。
- 圆角/内边距与 composer 卡片一致；栏与输入框间距与其它 dock 条目对齐。
- 答案文本 v1 用纯文本 + 保留段落/代码块基础样式；markdown 完整渲染 P2（复用 ui-primitives，实现前确认导出）。
- 响应式：宽度 100%；<1024 视口同样可展开（无左栏依赖）；展开面板内滚动，不挤压主对话超过 45vh。
- 动效克制：展开/收起 120ms；流式光标闪烁；不使用位移动画。

### 5.5 状态与重连

```ts
type Phase = 'queued' | 'calling' | 'streaming' | 'done' | 'error' | 'cancelled';
interface BtwQuestionView {
  requestId: string; question: string; phase: Phase;
  answer: string; error?: { code: string; message: string };
  startedAt: number; finishedAt?: number;
  provenance?: { reason: 'captured' | 'reconstructed'; model: string; messageCount: number; capturedAt: number; degraded?: boolean };
  usage?: { totalTokens?: number };
}
```

- 每会话一个 store（`useSyncExternalStore`），`Map<sessionId, BtwSessionStore>`，插件级持有，卸载 dispose。
- 栏挂载/重挂载：`watch({sessionId, afterSeq: store.cursor})`；基线含全量问题与 cursor，之后补发缓冲帧。
- 断线：`carrierFailed` → 状态 `retrying`，指数退避重连 2 次（≤5s），失败显示「连接已断开 · 重试」；重试用当前 cursor。
- 单一消费者：每会话只有 store 迭代一次流，React 组件只读快照。

### 5.6 i18n 与命令行处理

- `ctx.locale.register(NS, { zh, en, ja, … })`，所有 UI 文案走 `t = ctx.locale.bind(NS)`；tab/guide/title（P2）用 thunk；`locale: NS` 传给 slots 注册。
- P1 **不隐藏**命令行：`/btw` 的 `no-context` 等命令级错误只通过命令结果行呈现，隐藏会让失败变得不可见（与 DESIGN 早期设想不同，已按实测调整）。`conversation.chat.commandview`（keyed，open key domain）注册 key = 每个候选命令名 → 返回 null 的组件，列为 P2；届时需同时把错误从命令结果迁移到栏内（或在 commandview 组件里按错误状态渲染）。
- 无障碍：流式状态行 `role="log" aria-live="polite"`，`aria-busy` 标记运行中；卡片按钮有 `aria-label`；Esc 收起展开面板；焦点不因流式更新被抢。

### 5.7 P2：右栏 tab（可选增强）

- 注册：`sidebarRightTabs.register({ id:'btw-side', kind:'btw-side', multiple:true, keepMounted:true, priority:'extension', title:()=>t('tab.title'), guide:[…] })` + `slots.register({ name:'sidebar.right.pane.tab', key:'btw-side', locale:NS, inject:(sessionId)=>({ store: stores.for(sessionId) }) }, BtwPanel)`。
- 入口：展开面板右上「在右侧栏打开」→ 尽力调用 `ctx.get('sidebarRight').openTab('btw-side')`；若右栏未挂载先 `ctx.layout.openRightbar(false,false)`，下一拍重试；失败则只在 dock 栏内展开（不报错）。
- 明确的限制：首开无法可靠编程触发（研究结论）；作为阅读器，不是 v1 必需；设置页 `barForm:"right-tab"` 时仍以 dock 栏为兜底入口。

### 5.8 设置分页（Settings Center）

> P1 实测补充：插件沙箱通过命令行 `--patch` overlay 注入本插件，Harness 的配置编辑器会拒写该类行（`Configuration for "<id>" is overridden by a home patch or command-line overlay`）。因此沙箱内设置页按只读态渲染（文案 `settings.overlay`），正式安装到 profile 后写入正常。

```ts
// src/client/index.tsx（模块级；inject 增加 'configForms'）
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'btw-side', order: 50, locale: NS,
  label: () => t('settings.nav'),
  inject: () => ({ form: formStore(ctx) }),
}, BtwSettingsSection));

ctx.slots.inject('settings.section.icon', () =>
  ctx.slots.register({ name: 'settings.section.icon', id: 'btw-side', locale: NS }, BtwNavIcon));
```

- `formStore(ctx)`：在 `ctx.configForms.describe()` 的 `namespaces` 中找到 `ns === 'btw-side'`（加载次序不定，300ms × 6 重试），取得 `ConfigFormController`；对外只暴露 `getSnapshot/subscribe/save(patch)/bound()`，`save` 走 `controller.mutate([{op:'set', path:[field], value}, …])`。
- 组件：仅主题 token；内容列 `max-width:760px`，行内校验（schema 仍为最终权威）；`writable !== true` 或 `bound() === false` 时全只读并提示「配置服务不可用」；revision 冲突（`SettingsConflictError`）提示「配置已修改，请重试」并重读快照；保存成功短暂显示 ✓。
- i18n：`label` 用 thunk（shell 不订阅 locale 状态，重注册语义以 slot 契约为准），zh/en 至少；文案用「旁路提问」，避免与旧插件「旁路提问设置」同名。
- 降级：`settings.section` 注册抛错或 `configForms` 缺失 → try/catch 吞掉并改为注册 `plugins.bundle.config` + `plugins.row.config`（key 用**新**包名/new row id）的同一 form face；**绝不复用**旧 btw 的 key。
- 页面状态不承载运行时旁问数据（settings 关闭即卸载）；旁问状态仍在 dock 栏 store（§5.5）。

---

## 6. 协议定义（Host ⇄ Client）

帧（JSON-lossless，seq 为每会话单调递增）：

| 帧 | 方向 | 载荷 |
|---|---|---|
| `baseline` | H→C | `{ sessionId, commandName, questions: BtwQuestionView[], cursor }` |
| `accepted` | H→C | `{ view: BtwQuestionView }`（含来源元信息） |
| `delta` | H→C | `{ requestId, seq, text }` |
| `status` | H→C | `{ requestId, phase: 'calling' \| 'streaming' \| 'thinking' }` |
| `done` | H→C | `{ requestId, answer, usage?, finishedAt }` |
| `error` | H→C | `{ requestId, code, message }` |
| `cancelled` | H→C | `{ requestId }` |

方法：

| endpoint | 类型 | 入参 | 出参 |
|---|---|---|---|
| `btwSide/watch` | stream | `{ sessionId, afterSeq? }` | 帧流 |
| `btwSide/state` | direct | `{ sessionId }` | `{ commandName, questions, cursor }` |
| `btwSide/close` | direct | `{ sessionId, requestId }` | `{ ok: true }` |
| `btwSide/clear` | direct | `{ sessionId }` | `{ ok: true }` |

错误码：`no-context`（无真实请求）· `empty-question` · `too-long` · `busy` · `model`（配置/调用失败）· `overflow`（`source:'preflight'|'provider'|'proxy'`）· `tools-attempted` · `timeout` · `cancelled` · `unavailable` · `internal`。错误消息面向用户，中文为主（可按 locale 由客户端映射 code；v1 直接展示 host 文案）。

---

## 7. 冲突清单与对策（压缩版；完整 C1–C18 见 [conflicts.md](research/conflicts.md)）

| 面 | 冲突 | 对策（本设计） |
|---|---|---|
| 命令名 | 与 `@michengai/dsh-btw` 的 `/btw` 重复；apply 抛错被吞 → 条目静默 failed | 试注册探测 + 别名链 `btw→btw2→btw-side`；`onConflict:rename` 默认；栏内一次性提示；`recordInput:false` |
| llm/stream | 与 billion-context（无 prepend 的外层包装）、session-title 共存；重复 `next()` 或拦截会破坏主请求 | 只读监听、`prepend:true`、必须恰好调用 `next()` 一次、绝不 mutate 冻结 options |
| 压缩等价 | billion-context takeover gate：不带 sessionId 的旁路请求被拒接管 → `DIRECT (uncompressed)`（token 更大 / 422 cap） | 默认 `compression:"inherit"` 带主会话 id；`isolated`/`direct` 可配；发送前 token 预检；overflow 双来源映射（§2.2.1） |
| 捕获污染 | compaction/title/auto-review、子会话、别的 side 调用都带 sessionId | `isAgentLoopRequest` + `purpose===undefined` 双过滤；side 调用若带 sessionId 用 `isAgentLoopRequest` 排除；会话维度 latest-wins |
| 服务 patch | 现有 btw `Object.defineProperty(commands.list)`，双 patch 恢复顺序易 strand | 不 patch；无内部命令；P1 保留命令行使错误可见，`commandview` 空组件列为 P2 |
| slot | `input.dock` 复用 id 会占人家格子；单槽 shadow 会删内置 UI | 唯一 `id: btw-side`、`order: 0`；绝不注册 `rightbar`/`rightbar.session`/`shell.bottom`/`root`；注册 try/catch |
| 服务/Remote | service key / typert endpoint 冲突抛错 | `btwSide` 命名空间；endpoint `btwSide/*`；`$mount` 只挂一次；唯一 package id |
| 配置行 id | Loader `store[id] ??=` 同 id 静默合并 | 行 id `btw-side`，不复用 `michengai-btw` 等 |
| settings 分页 | `settings.section` id / locale NS / config namespace 与旧插件或未来版本撞车；复用 shipped id 会替换该格 | id/NS/entry 全用 `btw-side`；只读区不注册 `sidebar.settings`/`settings.header`；失败降级到新包名的 `plugins.*.config` 卡（§2.7、§5.8） |
| 双实例/HMR | 重复注册、patch 残留、store 泄漏 | 全部 `ctx.effect`；启动探测同 module 重复实例；稳定 slot id；卸载 dispose |
| 工具 guard | 现有 btw 的 guard 按 label 认领任意 agent；全局 guard 会误伤 | 我们不加 guard、不建 agent；将来若加 agent，只按精确 childId 且 unique label |
| systemPrompt | 段序冲突 | v1 不注册 section；重建路径只读 assemble |
| abort/超时 | signal 叠加、abort 表现为 finish 而非 throw | 一个 controller：`AbortSignal.any([invocation.signal, timeout])`；以 finish/帧状态渲染 |
| 跨会话 | root 槽串台、store 持有 Agent 泄漏 | 槽位 session 级 + store 按 SessionId；不存 Agent/Session；`session/disposed` 清理 |
| 版本 | btw 的 gate 是 manifest-only；`engines.dsh` 才生效 | `engines.dsh >=0.2.2-rc.1 <0.3.0-0`，`node >=22.19.0`；运行时能力门（§8） |

共存策略：**自动改名 + 永远使用自己的快照/存储**（conflicts.md 的 b+c），绝不读/写 btw 的状态、id、patch；是否禁用旧插件交给用户（配置 `onConflict:"disable"` 可强制本插件失败并提示）。

---

## 8. 版本与能力门

```ts
function gateCapabilities(ctx) {
  const need = [
    ['commands.register', ctx.commands?.register],
    ['llm.stream', ctx.llm?.stream],
    ['typert.register', ctx.typert?.register],
  ] as const;
  const missing = need.filter(([, v]) => typeof v !== 'function').map(([k]) => k);
  if (missing.length) throw new Error(`dsh-btw-side: DSH 构建不兼容，缺少 ${missing.join(', ')}；需要 dsh >=0.2.2-rc.1 <0.3.0`);
}
```

- 压缩探测（不阻断）：读到 bili 只读信号（`ctx.get('biliBasicCompactionPolicy')` 或 `globalThis.__BILI_DSH_COMPACTION_VERDICT__==='active'`；能拿到本机 web 端口时 GET `/bili/origin`）即视为被接管，默认 `compression:'inherit'`；探测失败按「无 bili」降级并在栏内提示一次。
- `isAgentLoopRequest` 是 `@deepseek-ai/dsh-llm` 的导出但不在插件 peer 清单里（半公开）：用 lazy `import()` + try/catch，失败时退回启发式 `options.purpose === undefined && typeof options.sessionId === 'string'`，并把「精确捕获」标记为降级。
- `ctx.configForms`（客户端）由 `dsh-client-ui-settings` 提供；缺失或 `writable!==true` 时仅设置页降级（只读/`plugins.*.config` 卡），不影响命令与栏。
- `mode:'stream'` 手写 descriptor、`SidebarRightTabInjected` 类型、`openTab` 编程入口三处为 **UNCERTAIN**，实现第一天先做 30 分钟探针（§11 V9），不通过就切降级路径。
- 发布元数据：`engines.dsh` 建议 `>=0.2.2-rc.1 <0.3.0-0`、`engines.node` `>=22.19.0`；peer 依赖 `@deepseek-ai/dsh-{commands,llm,session,system-prompt,typert-protocol}` 与客户端 bundles（`dsh-api-remotes`、`dsh-client-ui-conversation`、`dsh-client-locale`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）。

---

## 9. 包结构 / 技术栈 / 构建

```
packages/dsh-btw-side/                     # package name: dsh-btw-side（未占用），row id: btw-side
├─ package.json                            # dsh.manifestVersion 1 / bundle.patch / client.inject / exports
├─ integration/cordis.patch.yml            # - insert: [{ id: btw-side, name: dsh-btw-side }]
├─ src/
│  ├─ shared/contract.ts                   # createTypertRemoteInfo + frame zod schema（host/client 唯一来源）
│  ├─ shared/frames.ts                     # 帧/错误码类型
│  ├─ host/index.ts                        # apply：能力门、服务、命令、捕获、清理
│  ├─ host/capture.ts                      # llm/stream 只读捕获 + 快照 store + 重建
│  ├─ host/payload.ts                      # 组装 side 请求、token 预检
│  ├─ host/run.ts                          # 遍历 llm.stream、帧广播、abort/超时
│  ├─ host/service.ts                      # btwSide Service + @Remote 方法
│  ├─ host/command.ts                      # 命令注册/别名探测
│  ├─ client/index.tsx                     # ModuleLoader 入口、$mount、slots 注册
│  ├─ client/store.ts                      # BtwStoreRegistry / BtwSessionStore（useSyncExternalStore）
│  ├─ client/Bar.tsx · Panel.tsx · Card.tsx
│  ├─ client/Settings.tsx                  # settings.section 页面（configForms 表单）
│  ├─ client/i18n.ts · client/styles.css
│  └─ client/ambient.d.ts                  # 运行时无 .d.ts：手写 ClientContext / slot 类型
├─ locale/zh.json · en.json
├─ scripts/build.mjs                       # tsc --noEmit + esbuild(host esm / client iife)
├─ tsconfig.json
└─ lib/                                    # 提交到仓库（repo 约定：lib 为构建产物且入库）
```

- Client 入口必须在 bundle 内调用 `window.__ModuleLoader__.load({ id, factory(require) { … } })`（先例 `packages/model-intelligence-test/frontend/index.tsx`）；`require` 只接受共享 specifier：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`（esbuild 里这些标记 external）。
- `package.json` 关键块：

```jsonc
{
  "name": "dsh-btw-side", "version": "0.1.0", "type": "module",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./locale/*.json": "./locale/*.json" },
  "dsh": { "manifestVersion": 1,
    "bundle": { "patch": "./integration/cordis.patch.yml" },
    "client": { "platform": "web", "inject": [
      "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-primitives" ] } },
  "engines": { "dsh": ">=0.2.2-rc.1 <0.3.0-0", "node": ">=22.19.0" },
  "scripts": { "build": "node scripts/build.mjs" }
}
```

- 配置（schemastery，host 侧，**所有可编辑字段 `volatileField()`**）：`commandName?='btw'`、`onConflict?: 'rename'|'disable'='rename'`、`barForm?: 'dock'|'right-tab'='dock'`、`compression?: 'inherit'|'isolated'|'direct'='inherit'`、`maxTokens?=8192`（64–8192）、`timeoutMs?=120000`（1s–5min）、`maxConcurrent?=3`（≤16）、`maxPerSession?=20`（≤20）、`showProvenance?=true`；entry/patch row id 固定 `btw-side`（settings namespace 与 `configForms` 依赖它）。
- 发布遵循仓库规则：先 `pnpm build` 提交 `lib/`；marketplace.json 仅在正式发布时登记；测试默认不跑，需用户批准。

---

## 10. 分阶段实施 / 非目标

**P1（MVP，建议先做）**
1. 探针：typert stream Remote 手写 descriptor 端到端通（V9）；`session.deriveMessages()` 可从 command 拿到的 agent 上调用；bili takeover / `compression` 三档（V11）。
2. Host：能力门、捕获、payload、run、watch/state/close/clear、命令别名。
3. Client：dock 栏（收起/展开、流式卡片、取消/复制/重试/来源行）、locale zh/en、主题 token。
4. 与现有 btw 并存验证：`/btw`→旧插件，`/btw2`→本插件（或用户卸载旧插件后 `/btw`→本插件）。
5. 设置分页：`settings.section`（id `btw-side`）+ `ctx.configForms` 表单 + volatile `Config` 字段 + 新包名 bundle 卡降级（§2.7、§5.8）。

**P2**
- 右栏 tab 阅读器（§5.7）；命令结果文本降级；会话刷新后的历史持久化（自定义 `ignorable` session 事件 + projection，需额外研究）；markdown 渲染；选择文本提问；栏内快捷设置入口（复用同一 configForms form face，仅当设置页不可用时）；成本/用量展示。

**非目标（v1）**
- 不执行工具、不做真子 Agent / 子会话（保真优先）；
- 不改主对话任何节点、不接 `agent/pre-step`、不加 `systemPrompt` 段、不加 `tools.guard`；
- 不做旁答的多轮追问（每条旁问独立，基于同一最新上下文）；
- 不用 SSE / `$on` / projections 通道。

---

## 11. 验证计划（设计级；实现后执行，测试需用户批准）

| # | 检查 | 通过标准 |
|---|---|---|
| V1 | 并存安装（旧 btw + 本插件） | 两个条目 active；`/btw`→旧插件，`/btw2`→本插件；栏都渲染；无 failed fiber |
| V2 | 强制命令冲突 | 本插件自动改名并提示，仍 active，无静默失败 |
| V3 | 真实请求保真 | 长回合（多工具调用）中途 `/btw`，卡片来源行指向最新请求，答案能引用中间工具结果；与 `session.deriveMessages()` 尾部一致 |
| V4 | 压缩后上下文 | 触发压缩后再 `/btw`，答案不出现被压缩掉的内容；来源行标注压缩后消息数 |
| V5 | 卸载/HMR | 关闭再启用两次：命令/listener/栏各 1；无 patch 残留；旧 btw 的斜杠菜单仍正常 |
| V6 | 不影响主线 | 旁路运行期间主对话无新增消息/工具/命令可见行；主回合不被阻塞；无 session token 归属 |
| V7 | 并发与取消 | 两条旁问同时流式；各自取消互不影响；超并发上限报 busy；断线重连后补帧 |
| V8 | 双会话隔离 | A 的答案不出现在 B；关闭 A 后 store 清空；插件卸载后无泄漏 |
| V9 | 通道探针 | `remote.btwSide.watch` 在 Electron 窗口返回 AsyncIterable 帧；`mode:'stream'` 通过 `validateInvocation`；否则记录降级 |
| V10 | 构建 | `pnpm build` 通过；`lib/` 全量生成；无硬编码颜色（grep `#`/`rgb(`） |
| V11 | 压缩等价（bili） | `inherit` 下旁路请求在 bili 侧被接管（日志非 DIRECT）；主对话无可见变化；对照「停问」请求满足 E1/E2/E3；`isolated`/`direct` 行为可预测；bili 统计副作用可量化 |
| V12 | 设置分页 | 设置中心出现「旁路提问」分页（fresh id 不替换 shipped 分区）；表单读 `ctx.configForms`，保存后 Loader reconcile 生效（`commandName` 下次生效）；`writable!==true` 时只读；`settings.section` 失败时 fallback 卡可见；与旧 btw 设置卡并存无同 id 冲突 |

---

## 12. 待确认（需要你拍板）

已按你的答复落定：

- 新增设置分页（P1，§2.7/§5.8）；接受 v1「独立 side run」；命名用 `dsh-btw-side` / `btw-side`。
- 压缩兼容：**默认 `compression:"inherit"`**（旁路请求带主会话 sessionId，交给 bili 压缩链；§2.2.1）。
- 栏位：**默认输入框上方 dock 栏**；设置页 `barForm` 可切 `right-tab`（右侧栏无法自动弹出，仅作阅读器）。
- 持久化：**v1 不持久化**旁答历史（刷新清空），P2 再评估自定义 `ignorable` 会话事件方案。
- 旧 `@michengai/dsh-btw` 由你之后卸载；设计保留命令自动改名与并存验证兜底。

只差一项信息（不影响 P1 开工）：

- **图 1 仍未收到**：若方便请补发你现用 btw 栏的截图，用于对齐展开/收起、卡片密度、来源行等视觉细节；没有图则按 §5.4 视觉规格实现。

---

## 附录 A · 关键证据索引

| 结论 | 路径 |
|---|---|
| `llm/stream` waterfall 与 `GenerateOptions` | `extracted_files/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js:2401`（`streamWithRegistration`）；`lib/typert.host.js:360`（GenerateOptions） |
| `isAgentLoopRequest` 导出 + 请求冻结 | `@deepseek-ai/dsh-llm/lib/index.js:357`（WeakSet/标记）；`dsh-agent-loop/lib/index.js:1018`（buildRequest） |
| 真实请求组装源：`session.deriveMessages()` / `requestHeader()` / `toolHistory()` | `dsh-agent-loop/lib/index.js:1018` 附近；`dsh-session` 请求信封文档 |
| fork 只到最后一个 `turn/end` | `@deepseek-ai/dsh-subagent-fork-in-process/lib/index.js`（`completedTurnPrefix`） |
| `CreateAgentOptions` 无 messages/system | `dsh-api-session-controller/lib/typert.host.js:2920` 附近（AgentOptions）；`dsh-agent-loop` createAgent |
| 命令契约 / 重复抛错 | `@deepseek-ai/dsh-commands/lib/index.js`（`register`、`command "…" is already registered`） |
| Typert stream 协议 | `@deepseek-ai/dsh-typert-protocol/lib/index.js`（`Remote`、`bindTypertRemote`、`mode:'stream'`）；`dsh-typert-registry/lib/index.js:584`（`validateInvocation`） |
| 内置流式先例 | `dsh-api-session-controller/lib/index.js`（`control`/`follow` 的 `@Remote({mode:'stream'})`）；`dsh-client-ui-trajectory/lib/client.js`（`remote.$stream`） |
| slot 契约 / 栏位 | `dsh-client-ui-layout/lib/client.js`（root 子槽声明、`ctx.layout.openRightbar`）；`dsh-client-ui-sidebar-right/lib/client.js`（`sidebar.right.pane.tab`、tab registry、`openTab`）；slot 契约目录（98 条，`/tmp/b1.js:19900–20900`） |
| 现有 btw 行为（基线） | `/Users/qihoo/.dsh/profiles/desktop/node_modules/@michengai/dsh-btw/lib/{index,client}.js` |
| 手写 Remote 契约先例 | `packages/model-intelligence-test/{shared/contract.js,backend/service/catalog.js,frontend/index.tsx}`（只读参考，不修改该包） |
| 两层压缩 / takeover gate | `design/btw/research/compression.md`；billion-context `dist/agent/dsh-{native,compaction-gate,acp}.js`；`dsh-compaction-basic/lib/index.js:634-655`（落盘压缩） |
| 设置分页 / configForms / volatile | `design/btw/research/settings-ui.md`；`dsh-settings/lib/index.js:322-544`（`volatileForm`/`describe`/`mutate`）；`dsh-config-editor/lib/index.js:24,96-140`；`dsh-client-ui-settings/lib/client.js:1270+`；`dsh-api-remotes/lib/types/remote-events.js`（`settings/document-updated`） |
| Electron 无 SSE / `$on` allowlist | `dsh-host-webserver/lib/index.js`；`dsh-api-remotes/lib/types/remote-events.js` |

## 附录 B · 术语

- **side run / 旁路运行**：一次独立 LLM 请求（独立 abort/流/展示），非子会话。
- **捕获快照**：`llm/stream` 拦到的最近一次真实请求（config/system/tools + messages）。
- **实时消息面**：提问瞬间 `session.deriveMessages()` 的结果（主会话当前日志面，压缩后即压缩后）。
- **降级重建**：快照缺失时用 `requestHeader` + `deriveMessages` + `systemPrompt.assemble` 拼出的上下文，UI 标注。
- **BTW 栏**：dock 中的旁路提问展示栏（收起一行 / 展开卡片列表）。
