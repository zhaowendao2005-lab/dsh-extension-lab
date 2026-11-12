# btw — 冲突与共存研究 / Conflict & coexistence research (DSH 0.2.2-rc.1, profile `desktop`)

Scope: design-only research for a new **Host+Client** plugin `btw` (旁路提问) that registers `/btw`, captures the session's latest real LLM request payload (post-compression), runs an independent answer-only side call/agent, and renders the answer in a dedicated bar. User requirement driving this file: **「对于相关钩子和函数的冲突问题也需要提前考虑」** — conflicts with existing hooks/functions must be anticipated before implementation.

Legend: ✅ verified at cited path:line · ◐ inferred from surrounding code · **UNCERTAIN** flagged inline. Companion doc: `design/btw/research/host-api.md` (capture, seeding, delivery; this file does not repeat it, only resolves conflicts).

## 0. Sources

| Source | Use |
|---|---|
| `/Users/qihoo/.dsh/profiles/desktop/{package.json,cordis.patch.yml,cordis.yml}` + `node_modules/<pkg>/cordis.patch.yml` | enabled plugins, composition row ids |
| `/Users/qihoo/.dsh/profiles/desktop/node_modules/*` built bundles (`lib/*.js`, `dist/agent/dsh-native.js`) | third-party hook/slot footprints |
| `/Volumes/Lenovo/dsh-extension-lab/extracted_files/dsh/node_modules/@deepseek-ai/*/lib/*.js` (0.2.2-rc.1, no `.d.ts`) | core semantics: commands, waterfall, loader, app-boot gate |
| Live `cordis_inspect_query` host Event/Service providers | public event modes, service keys, `GenerateOptions`, `slots`/sidebar contracts |

## 1. Installed-plugin inventory (third-party; DSH built-ins excluded)

Profile `dsh.profile.bundles` order: base, web-app, archive-manager, **billion-context**, **btw**, dsh-context, ui-ux-pro-max, skills-manager, rewind, dshmarket, experimental-*, ui-enhancements, extension-lab-manager, dev-sandbox, mermaid-preview. Composition is patched (`cordis.yml` = `[]`); each bundle contributes rows via its own `cordis.patch.yml`.

| Package @ version | Row id (bundle patch) | Host hooks (verified) | Client slot/service footprint | Conflict relevance |
|---|---|---|---|---|
| `@michengai/dsh-btw@1.3.8` | `michengai-btw` | `commands.register`×3 (`btw` lib/index.js:1325, `btw-run` :1337, `btw-close` :1350); instance patch of `commands.list` (:1162-1172); `tools.guard`×2 (:1195+, global + per-child); `session/event`; `agent/created`; `subagents.getProvider("fork")` + `startActivation` | `conversation.input.dock` id `michengai-btw` order **-50**; `conversation.chat.text-interaction` key `btw`; `conversation.user.text.node` keys `dsh-btw-blockquote`/`dsh-btw-quote`; `conversation.chat.commandview` keys `btw-run`,`btw-close`→null; `plugins.bundle.config` + `plugins.row.config` cards | **Direct competitor**: same command name, same capture surface (side calls), same dock area, only plugin that patches a service |
| `billion-context@0.1.213` | none (no patch file) | `llm/stream` listener `ctx.inject(["llm"]) → ctx.on("llm/stream", …)` (`dist/agent/dsh-native.js`); host `fetch` intercept for model traffic; `commands.register`×4 (`acp`, `acp-cache` + adoption path) | none in `dsh.client.inject` | **Waterfall co-owner**: wraps every request; ordering + double-wrap analysis (§2 C3) |
| `dsh-context@0.83.1` | `dsh-context` | `agent/pre-step` `{prepend:true}` (rewrites id-less message ids to `dshctx-*`); `systemPrompt.section` ×2 (orders −2000 / 11200, derived from built-in names); session projections; `/api/dsh-context/*` routes | own settings panel | Prompt/pre-step shared surfaces; not llm/stream |
| `@michengai/dsh-archive-manager@1.3.1` | `ui-workspace-archive-manager` | none of command/llm/guard | `shell.overlay`, `plugins.bundle.config`, `sidebar.panellist`, `settings.section` | none direct |
| `@michengai/dsh-skills-manager@1.4.0` | `skills-manager` | skills/tools only | `plugins.bundle.config`, `sidebar.panellist`, `settings.section` | none direct |
| `dsh-rewind-plugin@0.21.2` | `dsh-rewind-plugin` | `commands.register`×4 (`rewind`, `undo`, `snapshot-auto-cleanup`); `session/event` | `conversation.chat.node`, `conversation.session.header.actions`, `plugins.bundle.config`, `settings.section` | Slash-name namespace only |
| `dshmarket@1.73.16` | `dsh-market` | `ctx.slots` host-side panel injection | `plugins.tab`, `plugins.detail.section`, `plugins.bundle.config`, `shell.overlay`, `sidebar.panellist`, `settings.plugin.item`, `settings.plugins.tab`, `settings.section` | none direct; can install more `/btw` providers |
| `extension-lab-manager@2.2.0` | `extension-lab-manager` | dev workspaces | `plugins.tab` | none direct |
| `dsh-plugin-dev-sandbox@3.2.0` | none (no patch file) | 28× `defineProperty`, 1 slot | `sidebar.right.pane.tab` body + consumes `sidebarRight`/`sidebarRightTabs` | **Right-sidebar competitor** if bar goes there |
| `dsh-ui-enhancements@2.2.0` | `ui-enhancements` | client-only | custom DOM/CSS enhancement (no catalog slot keys) | cosmetic layering over our bar |
| `dsh-mermaid-preview@0.5.1` | `mermaid-preview` | client renderer | `conversation.chat.node` renderer | none |
| `dsh-ui-ux-pro-max@1.4.1` | `ui-ux-pro-max` | host tools `design_*` + skill | none | none |
| `dsh-vscode-mode@0.28.0` | `dsh-vscode-mode` **`disabled: true`** | commands×1, guard×9, `systemPrompt`×11, `session/event`×2, 5760 defineProperty | — | Inactive; shows the blast radius of a maximal plugin |

Also physically in the profile (not plugins): `@deepseek-ai/{cordis,cosmokit,dsh-brand,dsh-sandbox,dsh-tools,dsh-typert-protocol,dsh-util-values,schemastery}` — DSH internals otherwise resolve from the app bundle; a plugin must **peer** on them, not vendor them (btw peers `@deepseek-ai/dsh-commands` etc. and imports `@deepseek-ai/dsh-session` at runtime ✅).

### Shared-surface occupancy (who is already where)

| Surface | Existing owners | Our stance |
|---|---|---|
| `llm/stream` waterfall | billion-context (outermost registered listener, no `prepend`); built-in `dsh-session-title` (`{global:true, prepend:true}`) | one more listener, read-only (§3.2) |
| command names | `btw`,`btw-run`,`btw-close`; `acp`,`acp-cache`; `rewind`,`undo`,`snapshot-auto-cleanup` | need a free name (C1/C2) |
| `tools.guard` global | btw only (global + per-child) | **add none** (§3.7) |
| `systemPrompt` sections | built-ins + dsh-context (−2000 / +11200) | avoid; only if a real Agent variant needs it (§3.11) |
| `conversation.input.dock` (list/session) | btw `michengai-btw` (order −50), queue/todo/goal/claude-code-mods/forge-panel.worktree | own id + own order (§3.5) |
| `conversation.composer.dock` (list/session) | activity/usage pills (built-ins) | alternative bar seat (§3.5) |
| `sidebar.right.pane.tab` (keyed/session) + `sidebarRightTabs` service | built-in tabs + dev-sandbox | only if right-sidebar is chosen (C8) |
| service instance patch | **btw only** patches `commands.list` | do not patch (C5) |
| config entry ids | btw `michengai-btw`, dsh-context `dsh-context`, … | namespaced id (C10) |

## 2. Conflict matrix

Severity: **P0** breaks our feature or another plugin · **P1** silent degradation / fragile · **P2** cosmetic or maintenance.

| # | Conflict surface | Symptom (observable) | Sev | Detection | Mitigation (ref) |
|---|---|---|---|---|---|
| C1 | `/btw` duplicate with `@michengai/dsh-btw` (`commands.register` throws `command "btw" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)`) | Uncaught: our plugin entry **fails silently** (host log only; `pluginInventory` shows `fiberPhase:"failed"`), no `/btw2`, no UI, btw keeps working | **P0** | trial registration `try/catch`; `pluginInventory.list()` / `profileContext.startedBundles` for known provider | configurable name + alias fallback + localized notice (§3.1) |
| C2 | `/btw` owned by an *unknown* plugin (marketplace/dsh-simplify-style) | Same as C1 if we only hard-code btw detection | **P0** | trial registration is the only authoritative probe (`commands.list/find/execute` all need an `Agent`) | alias loop `btw → btw2 → btw-side`; `onConflict:"rename"|"disable"` (§3.1) |
| C3 | two `llm/stream` wrappers (billion-context, ours) | order decides what each sees; both must call `next()` exactly once (twice ⇒ `next() called multiple times`); a listener that does not call `next()` vetoes the model call | P1 | assert `llm/stream` listener count / captured `options` identity in a debug log | register `{global:true, prepend:true}`; **never** mutate `options`/`messages` (frozen; strict-mode throw fails the request); wrap only the iterator, delegate `next/return/throw` (§3.2) |
| C4 | capture poisoning: compaction/title/auto-review calls share `options.sessionId`; btw/our/user subagent child sessions also emit `llm/stream` | "latest request" snapshot silently replaced by a compaction prompt or a child-session request; answer is nonsense or the wrong session's | **P0** | snapshot keyed by `SessionId`; record `capturedAt`, `seq`, `purpose`; compare against `session.deriveMessages()` tail at use | filter `isAgentLoopRequest(options)` (exported) **and** `options.purpose === undefined` (compaction/title/auto-review all set a purpose); own side call omits `sessionId`; reconstruct fallback if snapshot stale/missing (§3.2) |
| C5 | btw's `Object.defineProperty(commands,"list")` patch vs any second patcher | double filter is harmless, but an **unconditional restore** (`commands.list = saved`) by either plugin removes the other's filter ⇒ btw's internal `btw-run`/`btw-close` reappear in the slash menu; restore-order mismatch strands a patch on unload | P1 | compare `Object.getOwnPropertyDescriptor(commands,"list").value`; observe slash menu after unload/HMR | **do not patch**; hide own command rows with `conversation.chat.commandview` null views; if we ever patch, only `defineProperty`-restore the wrapper we installed and check identity (§3.4) |
| C6 | slot id/cell collision in `conversation.input.dock` (list/session) | reusing `michengai-btw` puts us in **btw's cell** (silent shadow/replace); duplicate entries for one cell are **not** an error — one bar may vanish nondeterministically depending on priority/order (**UNCERTAIN** tie-break) | **P0** | static: ids in our bundle ≠ `michengai-btw`; runtime: count entries for the slot key | unique id e.g. `btw-side`; distinct `order` (btw −50 ⇒ ours `0`); register through `slots.inject` in try/catch so a failed slot does not fail the plugin (§3.5) |
| C7 | bar placed in `conversation.composer.dock` / `shell.overlay` instead of `input.dock` | composer dock: overlaps activity/usage pills and every turn (ambient); shell.overlay: frame-wide layer must portal to `document.body`, otherwise clipped by the docked composer | P1 | visual regression; z-index/scroll checks | choose **input.dock** (same family as btw, no portal requirement); keep a single entry per session; fixed overlays must portal (§3.5) |
| C8 | right-sidebar variant: tab **kind** registration + `sidebar.right.pane.tab` key | exact throws: `sidebarRight: tab kind "<kind>" is already registered (<band>)`, `sidebarRight: tab type id "<id>" is already registered`, `sidebarRight: duplicate guide entry id in "<id>"`; a `fallback` band holds nothing and coexists with nothing | P1 | registration is inside `ctx.effect` (throws synchronously) | only if the design moves to the right sidebar: inject `sidebarRightTabs`/`sidebarRight`, own kind `btw`, own band `extension`, no reuse of dev-sandbox ids; wrap in try/catch + degrade to input.dock (§3.6) |
| C9 | service key collision (`ctx.provide`) | `service "<name>" has been registered at <fiber>` throws inside `fiber.effect` ⇒ plugin entry fails | P1 | avoid generic keys | namespaced `btwSide` (and `btwCoexist` if needed), unique probe before provide; never re-provide `commands`/`llm` (§3.8) |
| C10 | config entry id collision in the Loader tree | `EntryTree.create` does `store[id] ??= new Entry(...)` + `update(...)`: two rows with the **same explicit id** silently address the **same** entry (last update wins) — our config row can silently replace/merge with an existing one, or be replaced by a user patch row | P1 | `ctx.loader.entries()` / `pluginInventory.list()` entryIds; document the id in README | namespaced id `btw` / `btw-side` (avoid `michengai-btw`, `dsh-context`, `ui-*`); document `config` keys; note user patch rows override bundle rows (§3.9) |
| C11 | multiple instances / HMR double register (host) | second instance: duplicate command throws (entry failed); two `tools.guard` layers stack; two `commands.list` patches stack; a patch created outside `ctx.effect` survives unload | P1 | `pluginInventory` moduleName count > 1; duplicate guard behavior test | all registrations inside `ctx.effect` (auto-dispose); no module-level mutable singletons; detect self-duplicate via `profileContext.startedBundles` / `pluginInventory` and log a clear error; idempotent disposers (§3.3) |
| C12 | client double bundle register / HMR remount | duplicated slot entries/listeners and a leaked store after fast refresh (renderer remounts boundaries keyed by registration identity; `slots.inject` effects dispose on collapse) | P2 | count rendered bars/log store creation; rebuild client twice | all client registrations inside `ctx.effect`/`slots.inject`; stable ids so a re-register lands in the same cell; dispose stores (§3.12) |
| C13 | tool-guard interference on the side agent | btw's guard claims **any** agent whose descriptor `label` is in its `labels` set (`retainLabel` on each job) and then denies every tool except `send_message` + configured `allowedTools`; if our side agent reuses a btw locale label (zh `旁路提问`, en `Side question`) it gets claimed and its tools denied. Conversely a **global** guard of ours with heuristic matching would deny btw's side agent or the user's own subagents | P1 | descriptor labels in the child session; guard reason strings in tool results | use a unique label `btw-side:<id>`; prefer **no real Agent** (direct `ctx.llm.stream`) ⇒ no guards at all; if a real Agent is required, scope the guard with `agent.ctx.tools.guard` and match **exact childId** only — never global, never label-based (§3.7) |
| C14 | `systemPrompt.section` ordering if we inject | tie/duplicate order values produce unstable prompt order; dsh-context already owns ±(extremes); a `system-prompt/assemble` mutation would bypass section ordering | P2 | compare assembled prompt orders; section names | avoid for the primary design (captured messages already carry the system message; direct `llm.stream` has no assemble step); if needed: unique name `btw:…`, order = `getSectionOrder("TOOL_SUBAGENT") + 1` style, return the disposer, never rewrite `assembly` (§3.11) |
| C15 | abort/timeout duplication | `invocation.signal` + our `AbortSignal.timeout` + btw's 30-min job timeout are independent; double-abort loses the reason; abort surfaces as terminal `finish{kind:"aborted"}` (not a throw), so naive `await` code can show an empty answer | P2 | assert single `AbortController` per side call; check finish reason | compose `AbortSignal.any([invocation.signal, AbortSignal.timeout(120_000)])`; one cleanup `ctx.effect`; render aborted/error from the terminal chunk, not from a caught throw (§3.10) |
| C16 | real-Agent (fork/subagent) variant vs "latest real payload" | fork seeds only through the **last `turn/end`** (`completedTurnPrefix`), excluding the in-flight turn — i.e. exactly the payload `/btw` must use; a real agent also assembles its **own** system prompt/tools, so it is never byte-identical to the captured request; the child session appears in the session list | **P0** | compare seed/prefix and answer fidelity; `session.meta.parentSession` on the child | primary design = **direct `ctx.llm.stream(captured + question)`** (host-api.md §2.3); if a real Agent is mandated, pass the captured payload as an explicit prompt text within a token budget and accept non-fidelity (§3.13) |
| C17 | `webServer.register` route collision | duplicate `(kind,path)` registration throws; a second instance or a stale HMR fiber can keep the old route | P1 | route registration try/catch; `webServer` error text | path namespaced `/btw/stream/<sessionId>` (+ instance suffix if needed); register inside `ctx.effect`; prefer one route + per-session query key (§3.14) |
| C18 | cross-session state leakage | bar in a root-scope slot shows session A's answer in session B after switching; store holds `Agent`/`Session` refs after disposal | **P0** | two sessions side-by-side; switch/close session | session-scoped slot (`input.dock` is session scope) **and** store keyed by `SessionId`; drop on `session/disposed`; never retain `Agent`; client store cleared on session prop change (§3.5, §3.15) |

## 3. Mitigations with concrete API patterns

### 3.1 Command naming preflight and coexistence (C1/C2)

Do **not** hard-fail on duplicate: an apply-time throw is swallowed by cordis/loader (fiber fails, host log only). Probe, then rename.

```ts
// sketch, not final API usage
const base = config.commandName ?? "btw";           // `^[a-z][a-z0-9_-]*$`
const aliases = [base, `${base}2`, `${base}-side`];
// optional soft signal: who is installed (never authoritative)
ctx.inject(["pluginInventory"], sub => {
  void sub.pluginInventory.list().then(list => {
    btwInstalled = list?.entries.some(e => e.moduleName === "@michengai/dsh-btw" && e.enabled);
  }).catch(() => {});
});
let chosen: string | undefined;
for (const name of aliases) {
  try {
    ctx.effect(() => ctx.commands.register({ name, description, input: { hint }, recordInput: false, handler }));
    chosen = name; break;                            // trial registration IS the probe
  } catch (err) {
    if (!/already registered/.test(String(err?.message))) throw err;   // real bug → fail entry
  }
}
if (chosen === undefined) throw new Error("btw: no free command name — disable another /btw provider");
```

- `recordInput:false` keeps the question out of the durable `command/run` event (btw precedent).
- Surface the rename in the bar (`/btw2 已启用：/btw 已被 @michengai/dsh-btw 占用`) and in `ctx.logger.info`.
- Allow `onConflict:"rename" | "disable"`; default `rename`. btw's README instead tells users to disable other providers — we should not rely on user action (a failed entry is invisible).

**Policy verdict** (options from the task): (a) refuse = worst (silent failure, no feature); (b) auto-rename = best default (keeps both plugins, no user action); (c) "coexist by scoping capture to our own snapshot" is **not** an alternative to (b) — the command name and the snapshot are independent; do (b) **and** always keep our own `Map<SessionId, Snapshot>` (never read btw's state). Recommended: **b + c**.

### 3.2 One read-only `llm/stream` listener (C3/C4)

```ts
ctx.inject(["llm"], sub => {
  sub.on("llm/stream", (options, next) => {
    if (isAgentLoopRequest(options) && options.purpose === undefined && typeof options.sessionId === "string") {
      snapshots.set(options.sessionId, snapshotOf(options));      // latest-wins, shallow-copied array
    }
    return next();                                                 // never mutate options; never skip next()
  }, { global: true, prepend: true });
});
```

- `options.messages`/`options` are frozen by `buildRequest` (`deepFreeze`); mutation throws in strict mode → plugin failure. Store by reference, copy only the outer array.
- Never wrap the returned iterator for capture purposes (btw/billion-context both do their own wrapping): our listener only reads, so no double-wrap interaction.
- billion-context registered earlier **without** `prepend` ⇒ we become the outermost listener; correctness does not depend on winning the order, but do not assume b-context sees the same object after us (it doesn't mutate).
- `{global:true}` is required because the waterfall dispatches in the agent scope (built-in `dsh-session-title` uses the same flags).
- Own side call: **omit `sessionId`** (host-api.md §2.3) ⇒ billion-context early-returns and our own listener filters it out; also omit `purpose` or use it only as a local tag (union not public — **UNCERTAIN**).

### 3.3 Idempotent host registration (C11)

- Every registration returns/goes through `ctx.effect(() => …)`; cordis disposes on unload/HMR.
- No module-level singletons (`let store`), no `process.on`, no `Object.defineProperty` on shared services.
- On apply, detect a second instance of ourselves (`profileContext.startedBundles` / `pluginInventory` `moduleName` count > 1) and log one clear error instead of registering twice.
- Trial registrations are safe on failure: `NamedEntries.insert` throws before mutation (idempotent undo), so a caught duplicate leaves no partial state.

### 3.4 Do not monkey-patch `commands.list` (C5)

- Hide our own internal command rows only via the keyed slot `conversation.chat.commandview` (`[name] → () => null`), exactly like btw — never via the service.
- Preferred: **no internal commands at all** (the bar drives the side call over our own HTTP route), so there is nothing to hide and no patch to strand.
- If a patch is ever unavoidable: save the descriptor, install with `Object.defineProperty`, and on dispose only reinstall when `Object.getOwnPropertyDescriptor(commands,"list").value === ours`; never assign `commands.list = saved`.

### 3.5 Bar slot choice and ids (C6/C7/C18)

```ts
slots.inject("conversation.input.dock", () => slots.register({
  name: "conversation.input.dock", id: "btw-side", order: 0, locale: NS,
}, Dock));  // wrap in try/catch → degrade: keep command working, show answer as command result text
```

- `input.dock` is `list`/`session`: a fresh `id` is added beside shipped entries, reusing a shipped/third-party id replaces that cell; `order` ascending (−50 for btw ⇒ ours `0`, visually below).
- Bug-report rule: fixed overlays must portal to `document.body` ("the docked composer contains them") — avoid overlays; render a normal dock row.
- Session scope gives C18 for free on the client; still key the host store by `SessionId` and drop on `session/disposed`.
- Do not add a `shell.overlay` entry for the same bar (double rendering / z-index fights with dshmarket/archive-manager/plugin-refresh-toast).

### 3.6 Right-sidebar variant (C8) — only if design picks it

- Requires the whole chain: provide/inject `sidebarRightTabs` + `sidebarRight` (dsh-client-ui-sidebar-right provides both, `lib/client.js:5599-5600`), register a tab **kind** `btw` (band `extension`), and the keyed body slot `sidebar.right.pane.tab` keyed by the kind's `id`; chip title in `sidebar.right.pane.tab.title`.
- Registration must be inside `ctx.effect` (throws for duplicate kind/id/band); wrap in try/catch and fall back to `conversation.input.dock`.
- Do not reuse dev-sandbox's kind/id; `fallback` band never coexists.
- Note: a panel elsewhere (e.g. `sidebar.panellist`, owned by archive-manager/skills-manager/dshmarket) is a different surface, not a tab.

### 3.7 Tool guards (C13) — add none by default

- Primary design executes no tools (drop `tool-call-delta`), so `tools.guard` is unnecessary.
- If a real side Agent is mandated: register the guard on `agent.ctx.tools.guard` inside `agent/created` filtered by **exact `childId`**, deny every tool (including `send_message`), and release on dispose. Never a global guard; never match by descriptor label (btw's heuristic would claim any agent with its localized label in `labels`).
- Ensure our child label is unique (`btw-side:<id>`) and never reuses btw's locale strings.

### 3.8 Service and config ids (C9/C10)

- Provide at most `btwSide` (namespaced) via `ctx.provide` inside `ctx.effect`; duplicate key throws `service "…" has been registered at <fiber>`.
- Remote endpoints: do not export a new typert Remote under an existing endpoint name (`gateway/ambiguous-endpoint` at call time); deliver over `webServer` HTTP instead (host-api.md §5).
- Loader rows: namespaced entry id (e.g. `btw`); `store[id] ??=` means same-id rows silently overwrite — document and never reuse `michengai-btw`.
- Bundle config cards use the `plugins.bundle.config` key = our package name, `plugins.row.config` key = `<pkg>#<row>` (btw precedent `lib/client.js:15427-15429`).

### 3.9 Version gate pattern (see §4)

btw's gate is **manifest-only**: `engines.dsh ">=0.2.0-rc.1 <0.3.0-0"`; README.zh-CN.md: "`1.0.0` 起，不在支持列表中的宿主会被版本门拒绝，插件不会运行"; no runtime version check exists in `lib/index.js`. The runtime enforces it in `dsh-app-boot`: `engines.dsh` alone decides (peers ignored when present), prereleases included, exemption via `dsh plugin allow-version`; `dsh.compatibility.dshReleases` is informational and never read. We add a **runtime capability gate** on top (cheap, fail loud + readable):

```ts
const need = [
  ["command runtime", ctx.commands?.register],
  ["llm.stream", ctx.llm?.stream],
  ["tools.guard", ctx.tools?.guard],          // only if we register a guard
] as const;
const missing = need.filter(([, v]) => typeof v !== "function").map(([k]) => k);
if (missing.length) throw new Error(`btw: unsupported DSH build (missing ${missing.join(", ")}); requires dsh >=0.2.2-rc.1 <0.3.0`);
```

### 3.10 Abort/timeout (C15)

One controller per side job: `const signal = AbortSignal.any([invocation.signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)])`; abort on `session/disposed` and in the `ctx.effect` disposer; treat `finish{kind:"aborted"|"error"}` as UI state, not exceptions. Do not piggyback on btw's 30-min queue.

### 3.11 systemPrompt (C14)

Only for a real-Agent variant that must add policy text: `ctx.systemPrompt.section({ name: "btw:side", order: ctx.systemPrompt.getSectionOrder("TOOL_SUBAGENT") + 1, text })`, keep the disposer, unique name. Never mutate `system-prompt/assemble` output. The primary `llm.stream` design needs nothing here (system prompt already lives in captured messages).

### 3.12 Client double-register (C12)

All `slots.register`/`slots.inject` inside `apply` (or `ctx.effect`); stable ids; wrap optional registrations in try/catch (btw pattern) so one failed slot does not blank the plugin; dispose per-session stores when the session prop changes; no module-scope event buses.

### 3.13 If a real side Agent is required (C16)

- Fidelity is impossible through fork (seed excludes in-flight turn) or any `CreateAgentOptions` path (only `seed: SessionEvent[]` + `agentOptions`, no messages). Pass the captured payload as **prompt text** (`SubagentStartRequest.prompt: ContentBlock[]`), trim to a token budget, and label the answer "基于已完成内容" — or implement a custom provider that synthesizes `seed` events (high effort, still gets its own system-prompt projection).
- Prefer direct `ctx.llm.stream` and call it a "side call"; expose it as the independent answer-only worker.

### 3.14 Own HTTP route (C17)

`ctx.webServer.register({ kind: "exact", path: `/btw/stream/<sessionId>` , resource })` inside `ctx.effect`; unique path prefix, cleanup on dispose; duplicate `(kind,path)` throws — catch and append a per-instance suffix.

### 3.15 Cross-session state (C18)

Host `Map<SessionId, Snapshot>` (latest-wins, LRU 8–16, byte cap) + `ctx.on("session/disposed", …)` to delete; never store `Agent`/`Session` objects; client bar/state keyed by `session.sessionId`.

## 4. Version / compatibility (installed DSH `0.2.2-rc.1` ✅ `@deepseek-ai/dsh/package.json`)

| API used | Status | Risk if it drifts | Gate |
|---|---|---|---|
| `llm/stream` waterfall + `GenerateOptions` | public, documented in Event/Service catalogs | medium (field additions are fine; removals break capture) | `ctx.inject(["llm"])`, runtime check `typeof ctx.llm.stream === "function"` |
| `isAgentLoopRequest` / `markAgentLoopRequest` | exported from `@deepseek-ai/dsh-llm` package root (lib/index.js:377-390, :2434) but not in any plugin peer manifest — **semi-public (UNCERTAIN)** | medium | lazy `await import("@deepseek-ai/dsh-llm")` in try/catch; fallback heuristic `options.purpose === undefined && typeof options.sessionId === "string"` |
| `commands.register` + duplicate throw | public; exception text not contractual | low (match `/already registered/`, not full text) | `ctx.inject(["commands"])` |
| `commands.list` instance patching | internal implementation detail (btw does it; not documented) | high | **do not depend on or perform it** |
| `tools.guard` | public (catalog doc: monotonic denial) | low | capability check `typeof ctx.tools.guard === "function"` |
| `systemPrompt.section` / `getSectionOrder` | public | low | `ctx.inject(["systemPrompt"])` |
| slot keys `conversation.input.dock`, `conversation.chat.commandview`, `plugins.*.config` | public catalog, but renderer internals (`slots.inject`, `_core`, priority ties) are not — **UNCERTAIN** tie-break | medium | client `slots` might be missing (`ctx.get("slots")`); try/catch registration + command-result fallback |
| `sidebarRightTabs`/`sidebarRight` | provided by `dsh-client-ui-sidebar-right`, not in the inspect catalog → internal-ish | medium | only if right sidebar chosen; `ctx.inject` + capability check + fallback |
| `profileContext` / `pluginInventory` | public host services | low | `ctx.inject([...])`; optional |
| `ctx.loader.entries()` | internal-ish | medium | prefer `pluginInventory.list()` |
| typert Remote | internal (fixed capability set at build time) | high | do not add Remotes; use `webServer` |

Recommendation: `engines: { node: ">=22.19.0", dsh: ">=0.2.2-rc.1 <0.3.0-0" }` (narrower than btw because `isAgentLoopRequest` presence in 0.2.0-rc.1/0.2.1-rc.1 is unverified — **UNCERTAIN**), peers on `@deepseek-ai/dsh-{commands,llm,session,tools,system-prompt,subagent,client-*}` `>=0.2.2-rc.1 <0.3.0-0`, plus the runtime capability gate in §3.9. Do **not** use `engines.node ">=24"` (dsh-rewind does; the harness itself runs 22.19 in dev).

## 5. Verification outline (no execution yet; ≤8 checks)

| # | Check | Proves |
|---|---|---|
| V1 | With btw + ours enabled: both entries `active` in `pluginInventory`; `/btw` → btw, `/btw2` (or configured alias) → ours; both bars render in `input.dock` | C1/C2/C6 mitigation |
| V2 | Force duplicate: temp plugin registers `/btw` before ours (and take `btw2`): ours logs alias, shows localized notice, stays active (no `failed` fiber) | preflight + alias loop |
| V3 | Capture fidelity: send message → snapshot equals latest `session.deriveMessages()` tail; trigger a second step mid-stream → snapshot updates; trigger compaction/title → snapshot unchanged | C4 filter |
| V4 | Waterfall coexistence: debug-log listener order; assert btw/b-context unbroken (b-context `/acp` works, btw side answer works after our bar is used) and our side call is not captured (no `sessionId`) | C3 |
| V5 | Unload/HMR: disable+enable ours twice and btw once; assert exactly 1 command, 1 listener, 1 bar; btw's `btw-run`/`btw-close` still hidden in slash menu (patch not stranded) | C5/C11/C12 |
| V6 | Two sessions: panic answer in A does not render in B; close A → store dropped; refresh page → bar empty but `/btw` works | C18 |
| V7 | Right-sidebar (only if chosen): tab kind registers once, no `sidebarRight: …already registered` throw, fallback to dock when the sidebar plugin is absent | C8 |
| V8 | Tool guard: (agent variant) btw's side agent and a manual subagent keep their tools while our side agent is denied; no global guard denial for unrelated agents | C13 |

## 6. UNCERTAIN notes

1. **UNCERTAIN** — exact winner when two `list`-slot entries share one cell with equal priority/order: docs say "first live (non-abdicated) entry of each cell in priority order", no tie-break stated; avoid by unique id.
2. **UNCERTAIN** — whether `@deepseek-ai/dsh-llm` is resolvable from a third-party host plugin in every install; btw imports `@deepseek-ai/dsh-session` ✅ so built-ins are exposed, but use lazy import + fallback.
3. **UNCERTAIN** — client `slots` service internal registration semantics (`_core.specDynamic`, registrant) are not a public contract; only doc-level behavior (`inject`/`register`/list/keyed/shadowing) is safe to rely on.
4. **UNCERTAIN** — HMR ordering of client bundle re-evaluation vs slot disposal; stable ids + `ctx.effect` is the only defensive pattern verified for btw-like plugins.
5. **UNCERTAIN** — `sidebarRightTabs` contract source (not in inspect catalog); verified provider lines only.
6. **UNCERTAIN** — internal loop work that is *marked* as agent-loop but carries the main `sessionId` (host-api.md §6.1); the tail-match freshness check covers it.

## RECOMMENDED DESIGN INPUTS

- **Command name is config, not a constant**: default `btw`, alias chain `btw → btw2 → btw-side`, `onConflict:"rename"(default)|"disable"`; register in `ctx.effect` inside try/catch; localized notice + `logger.warn` when renamed. Never rely on users disabling btw.
- **Never hard-fail apply on a duplicate**: loader/cordis swallow apply throws into a silently `failed` entry; degrade + announce instead.
- **Coexistence policy = auto-rename + own snapshot scope** ("b + c"): own `Map<SessionId, Snapshot>` from `llm/stream`; never read/write btw's state, ids, labels, or patches.
- **Capture listener**: `ctx.on("llm/stream", …, {global:true, prepend:true})`, filter `isAgentLoopRequest(options) && options.purpose === undefined && typeof options.sessionId === "string"`; read-only (requests are frozen); shallow-copy the message array; latest-wins per session; reconstruct from `session.deriveMessages()` when missing.
- **No service monkey-patching**: no `commands.list` patch, no `shell.overlay` tricks; hide own command rows only via `conversation.chat.commandview`; preferably ship **no internal commands** and drive streaming through our own `webServer` SSE route.
- **Bar seat**: `conversation.input.dock`, `id:"btw-side"`, `order:0` (btw is −50), session scope, no fixed overlay/portal; wrap registration in try/catch with a command-result text fallback.
- **No global tool guard**: primary design executes no tools (drop `tool-call-delta`); if a real Agent is mandatory, guard only the exact `childId` via `agent.ctx.tools.guard`, deny all tools incl. `send_message`, and use a unique descriptor label (`btw-side:<id>`) — never btw's localized labels.
- **Side-call transport**: direct `ctx.llm.stream(captured.messages + question)` with the captured tools/config, **omitting `sessionId`**; unless requirements demand a real Agent, avoid fork (seed drops the in-flight turn) and document the fidelity trade-off.
- **Version gate**: `engines.dsh ">=0.2.2-rc.1 <0.3.0-0"`, `node ">=22.19.0"`, peers on `@deepseek-ai/dsh-*`; plus a runtime capability check for `commands.register`/`llm.stream` (and `tools.guard` only if used) with a loud localized error.
- **Namespacing everywhere**: service `btwSide`, config entry id `btw`, web route `/btw/*`, slot ids `btw-*`, command aliases; never reuse `michengai-btw`, `dsh-context`, or dev-sandbox ids.
- **Lifecycle**: all registrations inside `ctx.effect`; one `AbortController` per side job composed from `invocation.signal` + timeout; cleanup on `session/disposed` and plugin dispose; no module-level state.
- **Verification before implementation sign-off**: run V1–V8 (especially V1/V3/V5) against the real `desktop` profile with btw enabled.
