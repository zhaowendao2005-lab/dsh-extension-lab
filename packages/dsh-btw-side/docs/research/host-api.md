# btw — Host API research (DSH 0.2.2-rc.1)

Scope: host-side primitives needed by a Host+Client plugin `btw` (`/btw <question>`): capture the *real* latest LLM request payload, run an answer-only side call, stream it to a dedicated Web UI bar, and clean up.

Legend: ✅ verified at the cited path:line · ◐ inferred from surrounding code · **UNCERTAIN** where evidence is incomplete.

## 0. Sources

| Source | What it gave |
|---|---|
| Live `cordis_inspect_query` (host `Service`/`Event` providers) | exact method signatures + referenced type declarations for `llm`, `agentLoop`, `agents`, `commands`, `subagents`, `sessions`, `sessionController`, `tokenMeter`, `webServer`; event payload shapes |
| `/Volumes/Lenovo/dsh-extension-lab/extracted_files/dsh/node_modules/@deepseek-ai/*/lib/*.js` (0.2.2-rc.1, **no `.d.ts` in this extraction**; bundles keep `//#region` source markers) | implementation truth (freeze points, waterfall nesting, seed plumbing) |
| `/Users/qihoo/.dsh/profiles/desktop/node_modules/@michengai/dsh-btw/` (v1.3.8) | a real shipping plugin doing the same job (hidden command + subagent fork + client bubble store) |
| `/Users/qihoo/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js` | production precedent for `llm/stream` middleware, `ctx.commands.register`, `ctx.webServer.register` with `ctx.effect` |

---

## 1. CAPTURE — the real latest request payload

### 1.1 Hook inventory

| Hook | Verified shape | Carries messages? | Carries tools? | Carries call config? | Fires |
|---|---|---|---|---|---|
| `llm/stream` (waterfall) | `(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>)` ✅ | ✅ `options.messages` | ✅ `options.tools` | ✅ provider/model/reasoningEffort/temperature/maxTokens/stop | once per streaming model call = every step of every turn; **also for subagent sessions and for internal helper loops** (title, etc.) |
| `agent/pre-step` (waterfall) | `payload { agent, messages: UserMessage[], turn, step, signal, modelSelection }`, `next(): Promise<PreStepDecision>` ✅ | ◐ only the *user* messages claimed for this step (+ loop-injected runtime context) | ❌ | ❌ | before system-prompt projection and before request assembly |
| `agent/request` (waterfall) | `payload { turn, step, signal }`, returns `LlmCallConfig` ◐ (exists in `dsh-agent-loop`, **absent from the Event inspect catalog**) | ❌ | ❌ | ✅ but only mutable `LlmCallConfig` fields | before `llm.prepareCall` |
| `session` request snapshot | `session.requestHeader(): EpochHeader \| undefined`, `session.requestContext(): RequestContext \| undefined`, `session.toolHistory()`, `session.deriveMessages()` ✅ | via `deriveMessages()` only | ✅ header.tools | ✅ header.config | anytime from host code |
| `agent/assistant-stream` (emit) | `payload { agent, frame: AssistantStreamFrame }` ✅ | ❌ (output chunks) | ❌ | ❌ | while the main model streams |

`AssistantStreamFrame` (from the agent-loop's `AssistantStreamAttempt`, `@deepseek-ai/dsh-agent-loop/lib/index.js:351`): `start {type:'start', attemptId, revision, turn, step}` / `chunk {type:'chunk', attemptId, revision, index, time, chunk}` / `end {type:'end', attemptId, revision, index, outcome:{kind:'committed', eventType, seq} | {kind:'abandoned'}}`.

### 1.2 `llm/stream` is the payload — and it is post-compression ✅

`@deepseek-ai/dsh-llm/lib/index.js:2401-2402`:

```js
streamWithRegistration(options, prepared) {
  return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
}
```

`next()` takes **no arguments**, so a listener can only wrap the stream; the adapter is still called with the *same* `options` object. For agent-loop calls that object is the frozen request built by `buildRequest` (`@deepseek-ai/dsh-agent-loop/lib/index.js:1018`):

```js
markAgentLoopRequest(Object.freeze({
  ...header.config,
  messages: boundaryMessages,                // = session.deriveMessages() — the post-compression surface
  toolHistory: session.toolHistory(),
  ...header.tools !== void 0 ? { tools: header.tools } : {},
  sessionId: this.session.id,
  signal,
}))
```

Consequences:

* `options.messages` are the **compacted** messages the provider would have received — compression (billion-context) rewrites *after* this point: its listener wraps `next()` (`runLlmDispatch(scope, () => wrapScopedIterable(next(), scope))`), so the object we see is pre-wire, exact-frame, not byte-rewritten.
* There is **no `system` key and no `purpose` key** on agent-loop requests (◐ `purpose` is unset by the loop; `buildRequest` never sets it). The system prompt travels as `system/message` history events; `request/header` (`EpochHeader`) durably logs `config` + `tools` with `system?: never`.
* One waterfall entry per step ⇒ capture is cheap; retries/attempts re-enter and simply overwrite (latest-wins is correct).
* Requests are frozen ⇒ a listener can retain the object by reference safely (◐ messages themselves are frozen; `frozenMessages` WeakSet at `dsh-agent-loop/lib/index.js:535` is the loop's own evidence of that intent — still copy the outer array defensively).

**Registration precedent** (`@deepseek-ai/dsh-session-title/lib/index.js:252-259`) — read-only capture, no `next()` mutation:

```ts
ctx.on('llm/stream', (options, next) => { this.onMainRequest(options); return next(); },
       { global: true, prepend: true });
```

`{ global: true }` because the waterfall is dispatched inside an agent scope while the plugin listens on the root context; `{ prepend: true }` so capture happens before other middleware can short-circuit.

**Guard against capturing the wrong call** ✅ — `@deepseek-ai/dsh-llm` exports the loop's own marker:

```ts
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';   // also exported: markAgentLoopRequest
// llm/lib/index.js:357  const AGENT_LOOP_REQUESTS = new WeakSet();
if (!isAgentLoopRequest(options)) return next();             // skips btw's own side call, direct llm users
```

`isAgentLoopRequest` is the clean discriminator: **btw's own side call must not be marked**, so it can never poison the snapshot. Remaining ambiguity: internal loop work that *is* marked (◐ compaction/title share the loop path when they run through it). Mitigate by (a) keying by `options.sessionId` and (b) preferring the newest request whose message tail matches the session surface at use time (see §1.3).

### 1.3 Why not `agent/pre-step` / `agent/request` / `request/header`

* `agent/pre-step` `next()` default returns `{ kind: 'enter', messages: context === undefined ? claimed : [...claimed, context] }` (`dsh-agent-loop/lib/index.js:685-697`); the public decision type is `PreStepDecision = { kind:'reject' } | { kind:'enter'; messages: UserMessage[]; startsRequestSeries?: true }`. It is an **input** hook (it can add/replace user messages) that runs *before* system-prompt projection, so it sees neither the assembled system history nor the tool schemas — wrong layer for capture. It also does not fire until a turn runs.
* `agent/request` only carries `{turn, step, signal}` and returns a `LlmCallConfig` (provider/model/effort/temperature/maxTokens/stop). No messages, no tools ⇒ cannot reconstruct a payload. Its runtime existence is real (`dsh-agent-loop/lib/index.js:986-1001`) even though the inspect catalog omits it.
* `session.requestHeader()` + `session.requestContext()` + `session.toolHistory()` give the *durable* config/tools but **not** messages; messages would have to come from `session.deriveMessages()`, which is exactly what `buildRequest` uses — so this trio is a *reconstruction* path, not a capture path.

Verdict: `llm/stream` is the only hook that carries the four fields the side call must reproduce (messages + tools + call config + session key), at the right time (after compaction, before wire encoding).

### 1.4 Snapshot store

```ts
type BtwSnapshot = {
  readonly sessionId: SessionId;
  readonly seq: SessionLogOffset;        // session.seq at capture; monotonic freshness guard
  readonly contentGeneration: number;    // session.surface.contentGeneration
  readonly capturedAt: number;
  readonly provider: string; readonly model: string;
  readonly reasoningEffort?: ReasoningEffortId;
  readonly temperature?: number; readonly maxTokens?: number; readonly stop?: string[];
  readonly messages: readonly RequestMessage[];   // shallow-copied array, frozen elements
  readonly tools?: readonly ToolSchema[];
  readonly toolHistory?: ToolHistory;
  readonly reason: 'captured' | 'reconstructed';  // see cold-session fallback
};
```

Key: `sessionId` (string) in a `Map<SessionId, BtwSnapshot>`; **latest wins**, one entry per session.

| Policy | Value | Rationale |
|---|---|---|
| Max sessions retained | 8 (LRU) | typical desktop session count; other sessions stay recoverable via reconstruction |
| Max messages retained per snapshot | 1 200; beyond that store `messages: []` + `reason:'reconstructed'` | a 1 000+ message surface is ~MBs of retained history; the session itself can rebuild it |
| TTL | none while the session is live; drop on `session/disposed` / `agent/disposed` | avoids cross-session leakage (Question 4) |
| Eviction triggers | overwrite on capture, `session/disposed`, LRU overflow, plugin dispose | bounded, deterministic |
| Copy semantics | retain `options` by reference (frozen) but `[...options.messages]` | the loop freezes the request; only the array identity is not guaranteed |

**Cold / first-prompt / new-session fallback** (no captured request yet). At `/btw` time:

1. Try snapshot for `sessionId`.
2. Else reconstruct: `const header = session.requestHeader()` → `header.config` + `header.tools`; `const messages = session.deriveMessages()`; `session.toolHistory()`. Mark `reason:'reconstructed'`. This is *the same* function `buildRequest` calls, so for a restored/continued session it is usually frame-identical; it can only diverge if the surface changed after the last logged header (then the header is stale but the messages are current).
3. If `messages` is empty or has no assistant turn (true first prompt), return a friendly `{kind:'error'}`: *"btw: no model request in this session yet — send one message first."* (◐ matches billion-context's `/acp-cache` behavior: *"no ACP session yet… send a model request first"*).

Also expose a **staleness** signal: if `session.seq !== snapshot.seq`, still use the snapshot's `messages` as prefix but prefer reconstruction when reconstruction's tail is a superset. Practical rule: prefer the snapshot only when its last message id equals the reconstructed tail's last message id; otherwise reconstruct.

---

## 2. SIDE AGENT SEEDING

### 2.1 What the public API actually allows ✅

`ctx.agentLoop.createAgent(ownerCtx, options: CreateAgentOptions)`, mirrored by `ctx.agents.create(options)` (the registry the subagent runtime uses: `dsh-subagent/lib/index.js:1821`):

```ts
interface CreateAgentOptions {
  readonly sessionId: SessionId; readonly parentAgent?: Agent;
  readonly meta?: { cwd?; parentSession?: SessionId; isSeeded?: boolean; origin?: 'subagent'; delegationDepth?: number; agentPreset?: string };
  readonly inheritedEventCount?: SessionLogOffset;
  readonly seed?: readonly SessionEvent[];
  readonly agentOptions?: AgentOptions;   // { provider?, model?, reasoningEffort?, maxTokens?, subagentDepth? } — NO prompt/messages
  readonly signal?: AbortSignal; readonly setup?: AgentSetup;
}
```

There is **no field for initial messages, system prompt, or tool selection.** The only history channel is `seed: readonly SessionEvent[]` — durable session events (`user/message`, `assistant/message`, `request/header`, `system/message`, …) — and the agent will still run its own system-prompt assembly and tool resolution for every step. Therefore a real agent-loop Agent **cannot** be made to replay a captured `GenerateOptions` faithfully.

### 2.2 Alternatives, evaluated

| # | Approach | Faithful to captured payload? | Tools | Streaming | Transcript pollution | Verdict |
|---|---|---|---|---|---|---|
| a | `ctx.llm.stream(captured + question)` directly | **yes** (same messages/tools/config; only appends one `user` message) | none executed; if `tools` are passed the model may emit `tool-call-delta` — just ignore them | ✅ native `StreamChunk` | **none** (no session, no events) | **primary** |
| b | custom `SubagentProvider` (`registerProvider`) | no: provider decides; the built-in local path only accepts `seed`/`agentOptions` — to inject messages you must synthesize `SessionEvent[]` yourself | inherits child tool policy | ✅ via child session | creates a child session + `subagent/descriptor` | viable if a child session is required; high effort |
| c | built-in fork provider (`provider:"fork"`, `inheritsParentContext:true`) | **no** — `completedTurnPrefix()` seeds only up to the last `turn/end`; the in-flight turn is excluded by design ("the current tool-call turn is unbalanced and cannot be replayed as a valid child session", `dsh-subagent-fork-in-process/lib/index.js:22-31`) | child gets its own preset tools | ✅ via child session | new child session (does not touch parent transcript) | **fallback** only |
| d | fork/resume a temp session | same limits as (c) plus persistence/cleanup cost | — | ✅ | temp session visible in the session list | reject |

Notes on (c): the fork provider has **no `start()`**, only `prepareContinuable()`, so the runtime takes `startLocal` → `prepareContinuable` → `seed` → `agents.create({ seed, inheritedEventCount })` (dispatch at `dsh-subagent/lib/index.js:3062`; capability gate at `:3273`). `inheritsParentContext` is only metadata used by `tool-subagent` to describe the child and to forbid independent preset selection (`dsh-tool-subagent/lib/index.js:269`); it passes **no** request context — the actual inheritance is the `seed` prefix.

Notes on (b): a custom provider *can* return `{ seed }` from `prepareContinuable`, but `ContinuableCreateSpec` is exactly `{ seed?: readonly SessionEvent[] }` — so it is the same channel, just chosen by you. Synthesizing a faithful `SessionEvent[]` copy of the parent log up to `session.seq` would work for continuity but costs a session, a child agent, its own system-prompt projection (which may append extra `system/message` events → divergence) and post-turn durable writes.

### 2.3 Recommended side call

```ts
// inside the command handler; ctx.llm is a hard dep: inject: ['llm']
const snap = store.getOrReconstruct(session);           // §1.4
const question = createUserMessage({ content: [{ type: 'text', text: rawInput.trim() }] });
const request: GenerateOptions = {
  provider: snap.provider, model: snap.model,
  ...(snap.reasoningEffort ? { reasoningEffort: snap.reasoningEffort } : {}),
  ...(snap.temperature !== undefined ? { temperature: snap.temperature } : {}),
  maxTokens: config.maxTokens ?? 4096,
  messages: [...snap.messages, question],
  ...(snap.tools?.length ? { tools: [...snap.tools] } : {}),
  signal,                                                 // invocation.signal + own timeout
  purpose: 'btw',                                         // declarative tag only (§6)
};
for await (const chunk of ctx.llm.stream(request)) { /* text-delta → client; ignore tool-call-delta */ }
```

Decisions and rationale:

* **Keep `tools`**: the captured history may contain `role:'tool'` messages; several providers reject tool-role content when no tool declarations accompany it. Keeping the exact tool set is also what makes the payload faithful. Tool-call deltas are simply not executed — the "answer-only" guarantee is enforced by btw, not by the provider. (The reference plugin does the same: its child keeps the inherited tool list and rejects every call but `send_message`.)
* **Omit `sessionId`**: passing it makes billion-context (and any other `llm/stream` middleware keyed on `options.sessionId`) treat the side call as a main-session request — it would try to attribute/route/compress it and count tokens against the session. Omitting it hits billion-context's `sid === undefined → return next()` early-return. Provider-side prefix caching is content-based, so cache economics are unaffected.
* **Do not force an initiator**: the handler already receives `invocation.agent`; if we need attribution we can wrap in `ctx.agents.withInitiator(agent, op)` (✅ `ctx.agents` has `withInitiator/withoutInitiator/currentInitiator`), but for the reason above we deliberately don't.
* **Chunk handling** ✅ (`StreamChunk`): `block-start` (ignore), `text-delta {index,text}` (accumulate/stream), `reasoning-delta` (optional "thinking" line, never in the answer), `tool-call-delta` (drop), `block-end` (finalize), `usage` (cost line), `finish {kind:'stop'|'tool-calls'|'max-tokens'|'aborted'|'error'}`; `aborted`/`error` carry `LlmFailure {message, code, status?, providerRetryAfterMs?, requestId?}`.
* **Overflow preflight** ◐: `ctx.tokenMeter.contextPressure(session)` returns `{pressureTokens?, contextWindow?}` for the *main* session; the side request adds one message, so treat `pressureTokens + estimateMessage(question) > contextWindow * 0.98` as an immediate UI error ("context is full — btw can't add to it"). `tokenMeter.estimateMessage(message)` ✅ gives a cheap heuristic. There is **no** verified provider error code for overflow in this extraction (`grep` finds `context_length_exceeded` referenced only inside the pi-ai adapter) — also catch `finish.reason.kind === 'error'` and surface `failure.message` verbatim.

**Cost/abort**: one extra model call, no tools, no session ⇒ no durable write; abort by aborting the composed signal; nothing else to tear down (compare (b)/(c): child agent + session + settle + dispose).

---

## 3. COMMANDS

`ctx.commands` ✅ (`@deepseek-ai/dsh-commands/lib/index.js`):

```ts
interface CommandDefinition {
  readonly definitionId?: CommandDefinitionId;
  readonly name: string;                 // WITHOUT leading slash
  readonly description: string;
  readonly input?: { hint: string; attachments?: boolean };
  readonly recordInput?: boolean;        // false ⇒ command/run event omits `args` (lib/index.js:337)
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
interface CommandInvocation {
  readonly commandId: CommandId; readonly agent: Agent;
  readonly rawInput: string;                        // full rest-of-line, no arg parsing
  readonly attachments: readonly (ImageBlock | FileBlock)[];
  readonly signal: AbortSignal;
}
type CommandResult = { kind: 'success'; text?: string; sourceEventSeq?: SessionSeq } | { kind: 'error'; text: string };
```

* There is **no `session`, no `locale`, no parsed `args`** on the invocation. Reach the session through the agent (`invocation.agent.session`, ✅ used by `dsh-subagent-fork-in-process` as `parent.session.snapshotEvents()`; billion-context uses `invocation?.agent?.session?.id`). Localize client-side (the reference plugin passes a `locale` string inside its internal command payload).
* `register(definition)` → `this.layers.effect(this.ctx, layer => layer.commands.insert(name, …), { label: 'commands.register()' })` (`lib/index.js:266-269`) ⇒ it is **effect-scoped** and returns the exact disposer.
* **Duplicate name throws**: the name index is built with a factory that throws `command "<name>" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's agent.ctx)` (`lib/index.js:89`). Plain-context registrations are global; a command-injected child of an agent context shadows globals for that agent (`lib/index.js:207`). So btw must tolerate `apply()` being re-run (HMR/unload) by relying on `ctx.effect`, and must not assume a collision is silently won.
* **How output reaches the UI**: `execute(agent, line, attachments, signal)` appends `command/run` before the handler and `command/done` after settlement (`lib/index.js:334-345`), and returns `CommandExecution | undefined` (undefined = syntax/unknown name; admission misses log nothing). The client sees a command result; the `command/*` events are durable and *will* be in the transcript unless the client hides their views (dsh-btw registers `null` views in `conversation.chat.commandview` for its internal commands).
* `@Remote list(agent)` / `find(agent, name)` are the client-facing discovery surface; the client calls `remote.commands.execute(session, line, [], signal)` (dsh-btw, `lib/client.js` ~15745).
* **btw shape**: one user-visible `/btw` command (name `btw`, `input: { hint: 'question' }`, `recordInput: false` to keep the raw question out of the durable `command/run`), plus — if streaming needs a second leg — a hidden internal command (dsh-btw uses `/btw-internal-run <json>`); hide both with `commandview` null views.

---

## 4. LIFECYCLE / CLEANUP

| Need | Evidence |
|---|---|
| Effect-scoped registration | `ctx.effect(() => { const off = ctx.llm…; return () => off(); }, 'btw: …')` — precedent `billion-context/dist/agent/dsh-native.js` (`sub.effect(() => { offOrigin = ws.register(...); return () => { offOrigin?.(); offRelay?.(); } }, 'bili: panel routes …')`); `ctx.commands.register` already returns an effect disposer |
| Abort the side call | compose `invocation.signal` with a local `AbortController` (`AbortSignal.any([...])` is available on Node 22/24); pass as `GenerateOptions.signal`. `llm.stream` turns consumer/adapter aborts into a terminal `finish{kind:'aborted'}` |
| Session ended while streaming | `ctx.on('session/disposed', (session) => …)` ✅ (same pattern as `dsh-session-title`: `state.active?.controller.abort(new Error('session disposed during title generation'))`); agent end-of-life: `ctx.on('agent/disposed', ({agent}) => …)` — emit, fires after driver quiescence, before session detachment |
| Plugin unload | return the disposer from `ctx.effect`, and additionally abort all live side calls in that disposer (keep `Set<AbortController>` of in-flight btw calls, bounded) |
| Timeouts | `AbortSignal.timeout(ms)` composed in; default 120 s, configurable. `llm.stream` does not retry — that is `agent/request-error`'s (llm-retry's) job, which we bypass deliberately (side answers should fail fast) |
| No cross-session leakage | snapshots keyed by `SessionId`; drop on `session/disposed`; never store an `Agent` reference (Agent objects are scoped to the loop's `ctx` and are cleaned up by `agent/disposed`) |
| Cleanup of the client bar | client-side store keyed by session id, cleared when the session prop changes (dsh-btw's `BubbleStore` does `sessions.scope(props.session.sessionId)`) |

`Agent` runtime surface useful for cancellation (◐ from `dsh-agent-loop/lib/index.js:536-585`): `agent.session`, `agent.ctx`, `agent.model`, `agent.inbox`, `get status(): 'idle' | 'running'` (`AgentStatus = 'idle' | 'running'` ✅), `cancel(cause: AgentCancelCause, options?: {keepInbox?: boolean})`. The *public* `Agent` interface in the inspect catalog is only `{ readonly id: SessionId }` — treat the rest as internal. **We do not need an Agent at all** in the primary design (direct `llm.stream`), so the only abort handle is our own `AbortController`.

---

## 5. DELIVERY TO THE CLIENT

Constraint ✅ (dsh-api-remotes README): *"The capability set is fixed by explicit build-time value imports; the Client does not discover the Host's active Services or Remote definitions at runtime. Additional capabilities require an explicit `/remote` value import and mount in this assembly."* A third-party plugin therefore **cannot** register a new Remote namespace or a new forwarded event; it must reuse what is already mounted (`remote.session`, `remote.commands`, …) or add its own HTTP route.

| Route | Streaming | Effort | Needs client bundle change? | Evidence |
|---|---|---|---|---|
| A. `remote.session.follow({ address, assistantStream: true }, signal)` | ✅ incremental (`{type:'assistant-stream', frame}`) | low | no | ✅ `sessionController` `@Remote({mode:'stream'}) follow(...)`: *"complete opening snapshot followed by gap-free durable event frames and optional cursorless assistant-stream frames"*; `SessionAddress` explicitly supports `{kind:'subagent', parentSessionId, childSessionId, mode}`; client already has `SessionEventStream extends RemoteJournalStream` bound to "one ordinary or direct-subagent Session address" (`dsh-api-session-controller/lib/client.js:362+`) |
| B. Own HTTP/SSE route on `ctx.webServer` + `fetch()` from the slot occupant | ✅ manual SSE / NDJSON | medium | yes (fetch in client bundle) | ✅ `webServer.register(route: WebRoute \| WebResourceRoute): () => void`, duplicate `(kind,path)` throws; `WebResourceRoute.resource = (request: Request, peer?: PeerScope) => Promise<Response>` gives `peer.principal/interactions/signal`; precedent `billion-context` registers `{kind:'exact', path:'/bili/origin'}` and `{kind:'prefix', path:'/__bili'}` inside `ctx.effect` |
| C. Command result text only (no streaming) | ❌ answer lands at the end | low | no | dsh-btw: `remote.commands.execute(session, '/btw-internal-run …')` awaits the full text; the bubble shows "answering" until done |
| D. `agent/assistant-stream` (host emit) forwarded by our own SSE | ✅ | medium | yes | ✅ event is a process-local emit; useful only as the *source* for B if we ever mirror a live main-session stream |
| E. `ctx.typertGateway.registerRemoteEvents()` with a custom event | ✅ but cannot be consumed | — | **no** | blocked by the fixed capability set above |

**Recommendation.** Primary (direct `llm.stream`, §2.3) ⇒ **route B**: a `WebResourceRoute` on an exact path (e.g. `/btw/stream/<sessionId>`) that returns `new Response(readableStream, { headers: { 'content-type': 'text/event-stream' } })`, writing `event: delta` / `event: done` / `event: error` frames; the client slot occupant opens it with `fetch(url, { signal })` and reads `res.body.getReader()`. Keep the per-session snapshot id in the URL so the client cannot read another session's answer, and additionally check `peer.principal` if available.

Fallback (if we adopt the fork/child-session variant for other reasons) ⇒ **route A**, which is free: the client follows `{kind:'subagent', parentSessionId, childSessionId, mode:'one-shot'}` and receives `assistant-stream` frames with zero custom transport; durable parts arrive as `event` frames.

Client-side mounting ✅ (dsh-btw): a plugin client entry does `const slots = ctx.get('slots'); slots.inject('conversation.input.dock', () => slots.register({ name:'conversation.input.dock', id:'btw-bar', order:-50, locale:NS }, Dock))`; the occupant is a normal component that can call `ctx.get('remote')` and `fetch()` — so both A and B are reachable from a custom slot occupant.

---

## 6. OPEN / UNCERTAIN

1. **UNCERTAIN** — whether any *internal* loop call (compaction, title) also goes through `buildRequest` with the main `sessionId` and is therefore markable. Mitigation already in §1.4 (tail-match freshness check).
2. **UNCERTAIN** — `ctx.agents.withInitiator(agent, op)` semantics when called from a command handler; we avoid relying on it. Anthropic/OpenAI prompt caching is content-prefix based, so omitting `sessionId`/initiator should not hurt cache hits; unverified with the actual adapter.
3. **UNCERTAIN** — `purpose: 'btw'` is type-invalid today (`LlmRequestPurposeMap` is an empty augmentable interface; `purpose` has **no runtime consumer** — `grep purpose dsh-llm/lib/index.js` is empty). Either augment the map in a `.d.ts` or drop the field; it is purely a marker for our own listener.
4. **UNCERTAIN** — exact behaviour of a captured `tools` list plus a synthetic trailing `user` message on providers that require tool-result pairing (Anthropic rejects unmatched `tool_use`; a compacted history can end mid-pair). Fallback: if the side call fails with a 4xx mention of tool pairing, retry once with `tools` omitted **and** tool-role messages converted to text (last resort, changes fidelity).
5. **UNCERTAIN** — client inspect providers (`platform:'client'`) timed out (no page attached), so client-side slot/RPC contracts were taken from the reference plugin's bundle rather than the live API.
6. Not researched here (out of scope, for the Lead): client bundle packaging (`dsh` manifest `client.inject` list), locale files, and the actual bar UI/UX.

---

## RECOMMENDED DESIGN INPUTS

1. **Capture via `llm/stream`**, registered `{ global: true, prepend: true }`, guarded by `isAgentLoopRequest(options)` (exported from `@deepseek-ai/dsh-llm`) and keyed by `options.sessionId`; it is the only hook with messages + tools + call config + session key, and it fires **after** compaction and **before** wire encoding.
2. **Store one latest-wins snapshot per `SessionId`** (`Map`), retaining the frozen request by reference; LRU cap 8 sessions, drop on `session/disposed`, never store `Agent` objects.
3. **Cold/missing snapshot ⇒ reconstruct** from `session.deriveMessages()` + `session.requestHeader()` (`EpochHeader.config`/`.tools`) + `session.toolHistory()`, mark `reason:'reconstructed'`; empty surface ⇒ error "no model request yet — send one message first".
4. **Side call = direct `ctx.llm.stream(captured + createUserMessage(question))`** — the only way to replay the payload faithfully; a real agent-loop Agent cannot be seeded with arbitrary messages (`CreateAgentOptions` has only `seed: SessionEvent[]` + `agentOptions`).
5. **Do not use the built-in fork provider as primary**: `completedTurnPrefix()` seeds only through the last `turn/end`, excluding the in-flight turn — exactly the gap this feature must avoid.
6. **Keep the captured `tools`** (needed for tool-role history validity and fidelity), but **execute nothing**: drop `tool-call-delta` chunks and stream only `text-delta`/`reasoning-delta`; enforce answer-only in btw itself.
7. **Omit `sessionId` and do not install an initiator** for the side call so billion-context and other `llm/stream` middlewares ignore it; keep `purpose:'btw'` only as our own tag.
8. **Command surface**: `ctx.commands.register({ name:'btw', description, input:{hint}, recordInput:false, handler })`; reach the session through `invocation.agent.session` (no `session`/`locale`/`args` on `CommandInvocation`); duplicate names **throw**, so register inside `ctx.effect`.
9. **Deliver streaming over an owned HTTP route** (`ctx.webServer` `WebResourceRoute` returning `text/event-stream`, registered in `ctx.effect`) because a runtime Remote namespace/forwarded event cannot be added by a third-party plugin; fall back to `remote.session.follow({address:{kind:'subagent',…}, assistantStream:true})` only if the side answer runs as a child session.
10. **Client bar**: mount in an existing slot (`conversation.input.dock` in the reference plugin) and `fetch()` the SSE route from the slot occupant; hide btw's `command/*` transcript entries with `conversation.chat.commandview` null views.
11. **Abort/timeout**: compose `invocation.signal` with `AbortSignal.timeout(120_000)`; abort on `session/disposed` and in the plugin's effect disposer (track an in-flight `Set<AbortController>`); expect a terminal `finish{kind:'aborted'}`, not a throw.
12. **Overflow UX**: preflight with `ctx.tokenMeter.contextPressure(session)` + `estimateMessage(question)` against `contextWindow`; on the wire, surface `finish{kind:'error'}.failure.message` verbatim (no verified overflow-specific code in 0.2.2-rc.1).
