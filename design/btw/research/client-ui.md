# BTW (旁路提问) — Client UI & Data-Channel Research

Status: research complete, design input. Runtime studied: DSH `0.2.2-rc.1` (asar at
`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`), profile
`/Users/qihoo/.dsh/profiles/desktop`. Repo: `/Volumes/Lenovo/dsh-extension-lab`.
All paths below are absolute or repo-relative; extracted runtime files live in `/tmp`
(reader: `/tmp/asar2.py`).

## 0. Method / confidence

| Source | What it gives | Confidence |
|---|---|---|
| `cordis_inspect_query` platform `client` (`Slots.listSubTree`, `Service.listService`) | live slot tree, per-instance props | **BLOCKED** — every call timed out after 10 s ("Client inspect query … timed out"). The GUI is the Electron window; no authenticated browser page with a session token exists (`dsh web` on 127.0.0.1:54419 returns 401). Retried 3×. |
| `@deepseek-ai/dsh-client-ui-slots` slot-contract catalog embedded in the client bundle | 98 slot records with `kind`, `scope`, `doc`, `registerOptions`, `ownerProps`, `standardProps`, `slotInject`, `declaredBy`, `occupants`, `replaceRisk`, example | high (verbatim strings) |
| Built-in client bundles (unminified) `client-ui-layout`, `client-ui-sidebar-right`, `client-ui-conversation` | real registrations, geometry, tab API, per-session inject | high |
| `dsh-api-gateway` client + host, `dsh-typert-registry`, `dsh-typert-protocol`, `dsh-typert-loader` | Remote contribution, stream carrier, validation | high |
| Reference plugin `@michengai/dsh-btw` v1.3.8 | baseline UI + one-shot `remote.commands` channel | high |

Live tree + live props are **not** verified; anything below marked UNCERTAIN is derived from
bundles and must be re-checked with `Slots.listSubTree` when a browser session is available.

Key local artifacts:

- `/tmp/b1.js` — client bundle whose head is `id:"@deepseek-ai/dsh-api-gateway"`; embeds the
  98-record slot-contract catalog, lines ≈19 900–20 900 (`:20048` rightbar, `:20694` shell.bottom,
  `:20754` shell.overlay, `:20118` root).
- `/tmp/dsh-client-ui-layout.client.js` (803 lines) — root tree, AppFrame, `ctx.layout`.
- `/tmp/dsh-client-ui-sidebar-right.client.js` (5 784 lines) — right column, tab registry/slots.
- `/tmp/conv-client.js` (940 KB) — conversation children tables; `/tmp/webfrontend.js` — shared-module map.
- `/tmp/dsh-client-ui-trajectory/lib/client.js` — streamed panel example; extracted asar copy at
  `/Volumes/Lenovo/dsh-extension-lab/extracted_files/dsh/node_modules/@deepseek-ai/`.

## 1. Client runtime facts that constrain the design

### 1.1 Module loading

- A client bundle is a single IIFE ending in
  `window.__ModuleLoader__.load({ id: "@michengai/dsh-btw", factory(require) { … return module.exports } })`
  (seen verbatim at the head/tail of `/Users/qihoo/.dsh/profiles/desktop/node_modules/@michengai/dsh-btw/lib/client.js`).
- `require` accepts **only** these shared specifiers (exact map from `/tmp/webfrontend.js`):
  `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `zod`,
  `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-ui-dockkit`.
- `@deepseek-ai/dsh-client-ui-slots` exports exactly
  `{SlotCore, SlotOwnershipError, StaleAuthorizationError, resolveSlotLabel, standardHookPropName}`;
  the `slots` service used by plugins is the SlotCore instance (`ctx.slots`), not a React package.
- `dsh.client` in `package.json` selects the client entry and its peer bundles:
  ```json
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [
      "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-sidebar-right",
      "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-locale" ] } }
  ```
  `exports` must publish `"./client": "./lib/client.js"`; `dsh.client.inject` names the **bundles**
  whose services/slots the client uses (existing btw lists conversation, api-remotes, locale,
  input-trigger, primitives, slots, settings; `packages/model-intelligence-test` lists only
  api-remotes + sidebar-right).

### 1.2 Slot contract (SlotCore, from `/tmp/webfrontend.js` class `OI`)

- `register(options, Component)`: throws `slot "<name>" is not declared (a parent entry's children table must declare it)`
  when the slot was not declared by a mounted parent. Options: `{name, key?, id?, order?, label?,
  priority?, select?, inject?, children?, store?, locale?, registrant?}`.
  - **single**: one registration per priority; a second at the same priority throws
    `single slot "<name>" already has a registration at priority <n> (…registered by …) — register at a different priority to shadow it (lowest renders)`.
  - **keyed**: requires `key`; one entry per `key`+priority; a new registration at the same key
    replaces the occupant.
  - **list**: requires `id`; sorted by `priority`, then `order`; `entriesOfSlot` dedupes by id
    (first wins = lowest priority) and skips abdicated entries.
  - **chain**: requires `select`; first non-null selector wins.
- `inject(slotName, cb)` waits for the declaration (safe to call in `apply`), returns a disposer.
  Built-ins and the TS example both rely on this; a plugin may therefore register its
  `sidebar.right.pane.tab` body before `sidebar-right` mounts.
- `spec.scope` ∈ `root | session | session-maybe`. Session-scoped registrations get
  `inject(sessionId)` evaluated per session; root-scoped ones get the app root context.
- **Standard props** every slot component receives: `useRemoteAccess(action)`, `useResource`,
  `useContextMenu`, `useWorkspaces`, `usePanelInfo`, `useSessions`, `useSessionStatus`,
  `useSessionRetainInfo`, `useSessionAccess(sessionId, action)`, `useWorkspaceAccess(workspaceId, action)`.

### 1.3 The declared tree (layout root)

Authoritative declaration in `/tmp/dsh-client-ui-layout.client.js` (inside
`ctx.effect(… "ui-layout: service + root registration")`):

```js
ctx.slots.register({
  name: "root", locale: "common",
  children: {
    "sidebar":       { kind: "single", scope: "root" },
    "main":          { kind: "keyed",  scope: "root" },
    "rightbar":      { kind: "single", scope: "root" },
    "shell.bottom":  { kind: "single", scope: "root" },
    "shell.overlay": { kind: "list",   scope: "root" },
    "shell.leading": { kind: "single", scope: "root" },
  },
  store, inject: () => ({ hooks: { foldedLandscape } }),
}, AppFrame)
```

`AppFrame` renders `main` (`client-ui-layout.client.js:128`), `sidebar` (`:333`),
`shell.overlay` (`:347`), `shell.leading` (`:348`), `rightbar` (`:390`), `shell.bottom` (`:400`).
Geometry: the right column is a **track** — the frame makes room for it and draws the resize
handle; the occupant draws the panel. `computeColumns` uses
`available = viewport - sidebarWidth - 400`, `rightbar = 0` if `available < 300`, else
`clamp(px, 300, viewport * 0.7)`. Defaults: `RIGHTBAR_DEFAULT_RATIO = 0.45`,
`RIGHTBAR_MAX_RATIO = 0.7`, `SIDEBAR_AUTO_COLLAPSE = 1024`. `shell.bottom` reduces all columns'
height; `shell.overlay` is an absolute, click-through layer (`z-index: 20`, children opt into
`pointer-events`).

`ctx.layout` (cross-plugin panel-action face, provided by the layout package):

| method | effect |
|---|---|
| `selectPanel(panelId \| null)` | switch `main` keyed panel (throws if panel id unregistered) |
| `beginNavigation()` | cancellation signal for pending navigation |
| `toggleSidebar()` | left sidebar toggle |
| `openRightbar(track: boolean, fullscreen: boolean)` | ask the frame to show the right column |
| `closeRightbar()` | hide the right column |

`openRightbar` opens the column but does **not** choose a tab (tab state belongs to
`sidebar-right`'s dockkit layout store) — see §5.

## 2. Candidate bar/column destinations

All keys below are real declarations (verified in the slot-contract catalog + bundle children
tables). "Coexist" = can a plugin add an entry without replacing a shipped one.

| # | Slot key | Kind / scope | Shipped occupant(s) | Coexist | Fit for BTW bar |
|---|---|---|---|---|---|
| 1 | `root` | single / root | `client-ui-layout AppFrame` | no — shadows the whole frame | **never** |
| 2 | `sidebar` | single / root | `client-ui-sidebar SidebarRoot` | no | no |
| 3 | `main` | keyed / root | `conversation` (ConversationPanel), plugin-manager, schedule pages | only as a separate keyed panel (full page) | no — side answers are not a main page |
| 4 | `rightbar` | single / root | `client-ui-sidebar-right RightbarRoot` | no — a second registration shadows it (docs: "shadows-shipped-ui") | **no** |
| 5 | `rightbar.session` | single / session | `RightbarSeat` | no | no |
| 6 | **`sidebar.right.pane.tab`** | **keyed / session** | 13 shipped tab bodies (plan, schedule, files, terminal, subagent chat, guide, …) | **yes** — new key beside them, `replaceRisk: none` | **PRIMARY** (right column tab) |
| 7 | `sidebar.right.pane.tab.title` | keyed / session | shipped tab titles | yes | optional live title chip |
| 8 | `shell.overlay` | list / root | quota notice, context menu, file drag, toasts | **yes** — additive, click-through layer | strong fallback (floating rail / toasts) |
| 9 | `shell.bottom` | single / root | `experimental-inspector InspectorPage` | no — shadows inspector | possible "distinct bottom bar", risky |
| 10 | `shell.leading` | single / root | sidebar header controls | no | no |
| 11 | `conversation.input.dock` | list / session | queue, todo, goal, claude-code-mods, forge | yes (per-session, above composer) | **baseline** (existing btw); keep as compact fallback |
| 12 | `conversation.composer.dock` | list / session | ambient rows below composer card | yes | compact chips only |
| 13 | `conversation.session.header.utilities` | list / session | session utilities | yes (clipped/faded; overlays must portal) | toggle button / badge |
| 14 | `conversation.session.header.corner` | single / session | `ExpandButton` (right-panel expand) | no | no |
| 15 | `conversation.view` | list / session | chat, trajectory, stats views | yes | no — side answers are not a conversation view |
| 16 | `conversation.input.overlay` | list / session | command popup, slash menu, feedback | yes | no |

Owner props worth knowing:

- `conversation.input.dock` — `InputZone { readonly session: SessionSnapshot; readonly input: InputState }`
  (this is how existing btw gets `props.session.sessionId`).
- `rightbar` — `RightbarOwnerProps { width: number; viewportWidth: number; canShow: boolean }`.
- `sidebar.right.pane.tab` — `slotInject: "SidebarRightTabInjected"`; the type is not shipped in the
  runtime asar; the tab body receives its own `inject()` result as direct props plus the tab
  framework hook context (`tabId, shortcuts, title, fullscreen, active, signal, actions, useStore,
  useTabNavigation` → exposed as `useTabInfo`), see §5.2.
- `shell.bottom` explicitly "receives no Session binding and remains mounted across main-panel
  navigation" — a global bar must resolve the active session itself.

Resolution of "per-session vs global":

| Scope | Behavior |
|---|---|
| `root` | one app-global instance; no session id; plugin must read the selected session from `sessions` / conversation store |
| `session` | one instance per live session; `inject(sessionId)` runs per session; mounted/unmounted as sessions are retained/released |
| `session-maybe` | rendered even with no session (inert/empty state) |

Multiple occupants: `list` slots sort by `priority` then `order` and dedupe by `id`; `keyed` slots
dedupe by `key`; `single` slots throw unless a different priority is used to shadow. All
third-party entries should carry a fresh `id`/`key` (docs: "a fresh id is added beside the shipped
entries, while reusing a shipped id puts you in THAT cell and replaces it").

## 3. Recommendation: right-column tab, with header toggle + overlay toasts

**Primary destination: `sidebar.right.pane.tab` (keyed, session scope).** The BTW "栏" is a
dedicated panel inside the built-in right column, reachable as a tab like Plan/Terminal/Files.
Rationale:

1. It is the only *first-class*, additive right-column surface: `single` `rightbar` /
   `rightbar.session` are owned by `sidebar-right`, and shadowing them would delete the shipped
   right panel (docs rate it `shadows-shipped-ui`). The keyed tab seat is explicitly designed for
   "a new tab type needs no edit to this file" (`sidebar-right.client.js:1497-1503` comment).
2. It is **beside the main conversation by construction**: the frame reserves a real grid track
   (min 300 px, default 45 %, max 70 % viewport) and the user can resize, split, float, or
   fullscreen it — no custom layout code.
3. **Per-session** without manual bookkeeping: `inject: (sessionId) => ({…})` gives the tab body a
   per-session store; tab layout is persisted per session (`localStorage` keys
   `dsh.sidebar-right.v1.*`), so the BTW column follows the user across sessions.
4. **Multiple concurrent side questions** map naturally to multiple tab instances of our kind
   (`definition.multiple: true`) or to a single tab that renders a list of question cards; both are
   supported by the same store.
5. Theme/i18n are inherited from the panel chrome; only card content needs tokens + locale keys.

**Secondary anchors (same plugin, small):**

- `conversation.session.header.utilities` (list/session): a BTW toggle/badge button
  (`/btw`-aware, shows count of unread answers). Clipped overflow ⇒ render only a compact button,
  portals for popovers.
- `shell.overlay` (list/root): toast/badge when an answer finishes while the BTW tab is closed
  ("旁路回答已完成 · 打开"). Click-through layer; our entry must set `pointer-events: auto`.
- `conversation.input.dock` (list/session): **fallback only** — the baseline existing btw bubbles;
  differentiate by keeping it to a one-line "N 个旁路回答 · 打开" chip, never answer content.

Rejected: `root`, `sidebar`, `rightbar`, `rightbar.session`, `shell.leading` (shadow/replace shipped
UI); `shell.bottom` (single, occupied by experimental inspector; would shadow it, and the
vertical-space loss hurts the conversation); `conversation.view` (answers are not a conversation
view); custom fixed-position DOM injected into `document.body` (escapes the shell, breaks
responsive/fullscreen/theme and drag/resize).

### 3.1 How the tab gets opened (important limitation)

- The tab **type** is registered (`sidebarRightTabs.register`) with a `guide` entry; the user opens
  it from the right panel's "+" guide. Its layout is persisted per session afterwards.
- A tab **body** can open more tabs programmatically: `useTabInfo().actions.openTab(kind, options)`
  and `openResource(address, options)` (`sidebar-right.client.js:2258-2268`), and
  `useTabInfo().actions.close()`.
- `ctx.layout.openRightbar(track, fullscreen)` can reveal the column from anywhere, but cannot
  select a tab kind. **UNCERTAIN:** whether a non-tab component can select/register a tab (the
  registry exposes only `register/entries/guide/subscribe`; the controller `openTab` is internal).
  Design assumption: first open is a user action (toggle button / guide / toast); after that the
  layout is persisted and `/btw` answers appear in the already-open panel.

## 4. Data channel: host ⇄ client stream for side answers

### 4.1 What does NOT work

| Option | Evidence | Verdict |
|---|---|---|
| Custom `ctx.remote.$on("btw/…")` | `@deepseek-ai/dsh-api-remotes/lib/types/remote-events.js`: `API_REMOTE_FORWARDED_EVENTS` is "The one home of this application's forwarded-Host-event allowlist… compiled into both faces" | **impossible** without forking/recompiling api-remotes; the client `$on` validates against that list |
| Host HTTP/SSE route via `ctx.webServer.register(route)` | `dsh-host-webserver/lib/index.js`: "Electron uses `file://` plus IPC instead, and this package never prints the URL" | rejected for the desktop GUI (no same-origin page); web-only fallback at best |
| Session projections (`ctx.sessionProjections` + `observeProjections`) | `dsh-api-session-controller/lib/index.js:1833,1875`; projection values change only by committed main-session events via `apply()` | no free-form publish; side-agent runs are not main-session events → rejected |
| One-shot `remote.commands.execute` (existing btw) | `dsh-btw/lib/client.js`: `remote.commands.execute(session, line, [], signal)` → whole answer only after the run resolves | works but no streaming, no reattach; the baseline to improve on |

### 4.2 Recommended: hand-written Typert Remote **stream** contribution

This is the cheapest first-class channel: the same carrier the built-in session controller and
trajectory panel use, no code generator required.

Server side (`node` face, `lib/index.js`):

```ts
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';

export const name = 'btw';
export const inject = ['typert'];

class BtwService extends Service {
  constructor(ctx) {
    super(ctx, 'btw');
    this.typertRemote = bindTypertRemote(this, 'btw');
    this.runs = new Map(); // requestId -> { abort, buffer, state }
  }
  // Async generator: (requestJson, signal) -> AsyncIterable<Frame>
  async *ask(request, signal) { /* side agent; yield {type:'delta'|…} frames */ }
  async close(request) { /* abort run, idempotent */ }
  async state(request) { /* list live questions for a session (reattach) */ }
}
// marker: mode:'stream' is protocol-legal (Remote options whitelist is {name, mode:'stream', resources})
Remote('ask')(BtwService.prototype.ask, { kind: 'method', name: 'ask', mode: 'stream', static: false, private: false, addInitializer(i) { /* push to initializers */ } });

export function apply(ctx) {
  new BtwService(ctx);
  ctx.effect(() => ctx.typert.register(hostContribution), 'btw.remote-contract');
}
```

`hostContribution` is built with `createTypertRemoteInfo({ package: '@dsh/btw', methods: {
  'btw/ask': { service:'btw', invocation:{kind:'direct'}, mode:'stream', parameters:[request], result },
  'btw/close': { … direct … }, 'btw/state': { … direct … } } }, z)` and
`{ package, face:'host', schemas:[], invocations: remoteInfo.descriptors, model:{symbols:[],exports:[],relations:[]} }`
(exact shape proven by `packages/model-intelligence-test/backend/index.js` + `shared/contract.js`).

Validation the host must satisfy (`dsh-typert-registry/lib/index.js` `validateInvocation`):
`id`, `service`, `namespace`/`method`, strict codecs with `typeSymbol` + `create()`,
`cancellation.parameter === 'signal'` if cancellation is declared, `mode` only `'stream'`.
Gateway dispatch (`dsh-api-gateway/lib/index.js`): unary calls reject stream descriptors with
`gateway/signature-invalid … "stream Remote methods must be opened through the stream carrier"`;
`openStream` requires the method to return `Iterable`/`AsyncIterable` and wraps it
(`cancellableStream`). `openWireStream` routes `$events` to forwarded events and everything else to
`openStream`, so our frames travel the same WebSocket/IPC mux as built-ins.

Client side (`lib/client.js`, browser IIFE):

```ts
const MODULE_ID = '@dsh/btw';
window.__ModuleLoader__.load({ id: MODULE_ID, factory(require) {
  const React = require('react');
  const info = createClientBtwRemoteInfo(); // same descriptors, face:'client'
  return { name: MODULE_ID, inject: ['slots', 'remote', 'sidebarRightTabs', 'locale'],
    async apply(ctx) {
      const unmount = await ctx.remote.$mount(info);
      ctx.effect(() => unmount, 'btw.remote');
      ctx.inject(['remote.btw'], (c) => {
        const remote = c.get('remote.btw');
        // stream: AsyncIterable, single consumer, cancel on dispose
        const stream = remote.ask({ sessionId, requestId, question, afterSeq: 0 }, signal);
        for await (const frame of stream) store.apply(frame);
      });
    } };
}});
```

`ctx.remote` (`dsh-api-gateway/lib/client.browser.js`, service key `"remote"`):
`$mount(contribution) → Promise<() => void>` (installs `remote.<namespace>` services, validates
strict inputs, rejects duplicate ids/namespaces), `$stream({name, open(signal), ended,
carrierFailed})` for carrier-failure hooks, `$on(event, cb)` only for the compiled allowlist.
`invokeSelected` dispatches `descriptor.mode !== undefined` to `invokeStream`, so a descriptor with
`mode:'stream'` is enough — generated code is not required. `ClientStreamHandle` is a single-consumer
`AsyncIterable` with `send/end/dispose`; `dispose()` sends a `cancel` frame to the host.

**Frame protocol proposal** (JSON-lossless only; no functions/classes):

| frame | dir | payload |
|---|---|---|
| `{type:'accepted', requestId, model?}` | H→C | run started, side agent id |
| `{type:'delta', requestId, seq, text}` | H→C | answer token/chunk |
| `{type:'status', requestId, phase}` | H→C | `thinking` / `tool` / `retrying` |
| `{type:'done', requestId, text, usage?}` | H→C | final answer |
| `{type:'error', requestId, code, message}` | H→C | `agent-busy`, `model`, `cancelled`, … |
| `{type:'cancelled', requestId}` | H→C | after `cancel` |
| `{type:'cancel', requestId}` | C→H | optional explicit cancel (dispose alone is enough) |

Concurrency/reconnect:

- one stream per question; 3–8 concurrent streams is fine on one connection (each is an independent
  mux stream). Cap like existing btw: ≤ 8 global, ≤ 20 per session, exposed as setting.
- host keeps per-run `{ text, seq, phase }` (answers are small); client reattach calls
  `ask({sessionId, requestId, afterSeq})` — the host replays from the buffer if the run is still
  live, otherwise returns `{type:'done'}`/`{type:'error'}` terminal frame.
- on `carrierFailed`: mark `disconnected`, retry reattach once with backoff; on failure show
  "连接已断开 · 重试".
- dispose/abort on tab close must cancel host work: the handle's `cancel` frame aborts the
  generator's `signal`; the host's `finally` aborts the side agent and removes the run.

### 4.3 Concrete built-in streaming examples (code paths)

- **Trajectory panel, live tool results** —
  `/Volumes/Lenovo/dsh-extension-lab/extracted_files/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js`:
  `remote.$stream({ name: "live tool result", open: (signal) => remote.toolResults.watch({sessionId, seq}, signal), ended: () => new Error("live tool result stream ended"), carrierFailed: clear })`
  then `for await (const frame of stream) { frame.accept(); … }`. Same per-session, in-panel
  streaming shape BTW needs.
- **Session store** — `dsh-api-session-controller/lib/client.js`: `remote.$stream({ open: (signal) =>
  remote.session.control(signal) })` and `for await (const frame of this.remote.session.follow({…}))`;
  host methods are generated as `@Remote({mode:'stream'}) async *follow(request, signal): AsyncIterable<Frame>`
  (`lib/typert.host.js:2831-2880`). This is the exact protocol we copy.
- **Reference plugin (baseline, non-streaming)** — `@michengai/dsh-btw/lib/client.js` uses
  `ctx.get('remote').commands.execute(session, line, [], signal)`, stores the answer only when the
  call resolves (`BubbleStore`, line ≈1247; phases `answering → done`), caps 20 bubbles/session and
  8 active, aborts via `AbortController`, closes through a `/btw-close` command. It has **no**
  session/event subscription and **no** per-token updates — our stream design is the differentiator.

## 5. Registration recipe (client UI)

### 5.1 Tab type + tab body

```ts
// apply(ctx) after `await ctx.remote.$mount(info)`
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: 'btw',                       // unique type id; reuse throws "sidebarRight: tab type id … already registered"
  kind: 'btw',                     // tab.kind dispatched to sidebar.right.pane.tab key = definition.id
  multiple: true,                  // one tab per side question is allowed
  keepMounted: true,               // body retained off-screen → stream keeps running while tab inactive
  priority: 'extension',           // bands: builtin | extension (default) | fallback
  title: () => t('tab.title'),     // thunk re-read on locale change
  guide: [{ id: 'btw.open', order: 40, title: () => t('guide.title'),
            description: () => t('guide.description') }],
}), 'btw.tab-type');

ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'btw',                      // keyed by the type id; receives every tab of this kind
  locale: NS,
  inject: (sessionId) => ({ store: storeFor(sessionId) }),   // ← per-session state
}, BtwPanel)), 'btw.tab-body');
```

Notes:

- `sidebar-right` itself registers the `rightbar` occupant and declares
  `rightbar.session → sidebar.right.pane.tab` (keyed/session) at
  `/tmp/dsh-client-ui-sidebar-right.client.js:5670-5700`; third parties only register bodies.
- The body is dispatched via `renderSlot('sidebar.right.pane.tab', {}, {entryKey: definition.id, hookContext})`
  (`sidebar-right.client.js:1560-1605`); `definition.multiple` opens distinct tabs, each with its own
  `tab.id`.
- `keepMounted` → `retainTab(tab.id, signal)` keeps the body alive off-screen; otherwise unmount on
  tab switch and reattach streams on mount.
- Do not render a fixed-position column inside the pane; the pane already owns width, resize,
  split, float and fullscreen. Fill `height: 100%` and scroll internally.
- Optional live title: register `sidebar.right.pane.tab.title` with the same key to show a
  spinner/streaming glyph; otherwise the chip uses the registry `title(address)` captured at open.

### 5.1b Exact call shape + props typing

The body component receives the `inject()` result as **direct props** (proven by
`packages/model-intelligence-test/frontend/views/Panel.tsx:91`
`export function Panel({ store }: { store: Workbench })`); the tab framework supplies the standard
hooks via `useTabInfo()`:

```ts
interface BtwTabInjected { readonly store: BtwStore }        // our inject(sessionId) result
interface BtwTabProps extends BtwTabInjected {
  useSessions: UseSessions; useSessionStatus: UseSessionStatus;
  useSessionAccess: (sessionId: SessionId, action: RemoteEndpoint) => boolean;
  useRemoteAccess: (action: RemoteEndpoint) => boolean;
  useTabInfo: () => { tabId: string; title: boolean; fullscreen: boolean; active: boolean;
                      signal: AbortSignal; useStore: UseStore;
                      useTabNavigation: UseTabNavigation;
                      actions: { openTab(kind: string, options?: object): void;
                                 openResource(address: string, options?: object): void;
                                 close(): void } };
}
const BtwPanel = (props: BtwTabProps) => { /* snapshot from props.store, t from ctx.locale */ };

ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'btw', locale: NS,
  inject: (sessionId: SessionId): BtwTabInjected => ({ store: storeFor(sessionId) }) }, BtwPanel);
```

`SidebarRightTabInjected` is the catalog's declared `slotInject` type name; its .d.ts is **not**
shipped in the runtime asar, so the interface above is reconstructed from
`tabInfoFactory`/`TabSlot` (`/tmp/dsh-client-ui-sidebar-right.client.js:1560-1605, 5434-5450`) and
must be treated as UNCERTAIN for names but additive in practice.

### 5.2 Getting the session and calling the host

- Tab body: `inject(sessionId)` gives the session id; body props include standard hooks
  (`useSessions`, `useSessionStatus`, `useSessionAccess`, `usePanelInfo`, …) and `useTabInfo()`
  → `{tabId, title, fullscreen, active, signal, actions, useStore, useTabNavigation}`.
- Any component: `ctx.get('sessions')` is the client `ClientSessions`
  (`dsh-api-session-controller/lib/client.js`, service key `"sessions"`): `list.getSnapshot()`,
  `scope(id)`, `retain(id)`, `retainInfo(id)`, `subagentAddress(id)`; `list.byId[id].origin ===
  'subagent'` to exclude child sessions (existing btw does this).
- Permission check for invocations: standard prop `useRemoteAccess(action)` (boolean) — use it to
  disable the composer in the BTW panel when the peer is not owner.
- Remote call: resolve `ctx.get('remote.btw')` once (via `ctx.inject(['remote.btw'], cb)`) and pass
  it into the per-session store; components call store methods, not the raw remote.

### 5.3 Store shape (multiple concurrent answers)

```ts
interface BtwQuestion {
  id: string; sessionId: string; question: string;
  phase: 'asking' | 'streaming' | 'done' | 'error' | 'cancelled' | 'disconnected';
  answer: string; error?: string; startedAt: number; finishedAt?: number;
}
class BtwStore { // one per session, external store + useSyncExternalStore
  private bySession = new Map<string, Map<string, BtwQuestion>>();
  private controllers = new Map<string, AbortController>(); // key: `${sessionId}/${id}`
  ask(sessionId, question) { /* mint id, insert 'asking', open stream, apply frames, abort on close */ }
  close(sessionId, id) { /* abort + call remote.close, mark 'cancelled' */ }
  dispose() { /* abort all; called from ctx.effect cleanup */ }
}
```

- Keep stores in `Map<sessionId, BtwStore>` at plugin scope (model-intelligence-test uses exactly
  this `storeFor(sessionId)` pattern); dispose all in one `ctx.effect` cleanup.
- Panel component: `const [s, setS] = useState...` not needed — use `useSyncExternalStore(store.subscribe, store.getSnapshot)`.
- Cap and dedupe: refuse an empty/duplicate question; trim history (>50 completed) to bound memory.

## 6. Theme, i18n, responsive, lifecycle

### 6.1 Theme

- Use only CSS custom properties, never literal colors. The web stylesheet ships **98 `--dsw-*`
  tokens** (`/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-lh_YM6sT.css`,
  extracted to `/tmp/dsw.css`): `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1…4`,
  `--dsw-alias-border-l1…l4`, `--dsw-alias-label-primary/secondary/tertiary/caption`,
  `--dsw-alias-state-{business,error,success,warn}-primary`, `--dsw-alias-interactive-bg-hover`,
  `--dsw-elevation-panel/soft/prominent`, `--dsw-radius-panel/md/sm/xs`,
  `--dsw-font-xs-13`, `--dsw-font-family`, `--dsw-markdown-*`.
- Dark mode is automatic when tokens are used: the layout theme presenter sets
  `data-ds-dark-theme` on `<body>` and publishes `data-ds-theme-source`
  (`/tmp/dsh-client-ui-layout.client.js` `DARK_ATTRIBUTE`, `THEME_SOURCE_ATTRIBUTE`).
- User font preferences arrive as body variables `--dsh-content-font-size`, `--dsh-code-font-size`,
  `--dsh-terminal-font-size`, `--dsh-font-family-{text,code,terminal}`
  (`layout.client.js` `FONT_SIZE_VARIABLES`, `FONT_FAMILY_VARIABLES`) — use
  `var(--dsh-content-font-size, var(--dsw-font-xs-13))` for answer text.
- Inject styles once with `style.dataset.plugin = MODULE_ID` and scoped selectors (`[data-btw-panel] …`);
  remove in effect cleanup. Suggested: panel `--dsw-alias-bg-layer-1`, card `-layer-2`, borders
  `--dsw-alias-border-l2`, `--dsw-radius-panel`, `--dsw-elevation-soft`; labels/state as §6.1 list.

### 6.2 i18n

- Client bundle depends on the `locale` service: `ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt })`,
  then `const t = ctx.locale.bind(NS)` (exact pattern in `@michengai/dsh-btw/lib/client.js`; service
  from `dsh-client-locale`, `register(ns, localeOrDicts, dict)` in `lib/client.js`).
- Pass `locale: NS` to every `slots.register` so framework-projected labels are localized.
- Tab definition `title`/`guide` entries are **thunks** (`() => string`) so they follow the active
  locale without re-registering (`@deepseek-ai/dsh-client-ui-slots` catalog: "A thunk is re-read on
  every projection").
- Ship at least `zh` + `en` (repo convention: `locale/*.json` for all UI strings; reference plugin
  has 10 locales). Keys: `tab.title`, `guide.*`, `ask.placeholder`, `ask.send`, `answer.streaming`,
  `answer.done`, `answer.error.*`, `close`, `retry`, `open-panel`, `toast.done`.
- `label` on list-slot registrations accepts `string | (() => string)`; use thunks for any text the
  shell renders.

### 6.3 Responsive / width constraints

| Regime | Constraint | Design rule |
|---|---|---|
| rightbar normal | min 300 px, default `0.45 * viewport`, max `0.7 * viewport`; frame needs `available = viewport - sidebar - 400 ≥ 300` | never set a min-width > 300 px on the panel; use `width: 100%`; content container queries at 360/420 px |
| viewport < 1024 | opening rightbar collapses the left sidebar (`narrowExpanded = false`) | keep a single-column card list; collapse the question header to one line |
| viewport < 768 | `selectPanel` closes narrow drawer; rightbar may not fit | panel still must render at ~300 px; hide metadata rows, keep question/answer/cancel |
| fullscreen tab | pane covers viewport, wide | answer column max-width ~72ch, centered; keep streaming scroll pinned to bottom |
| split/float | two panes / floating window | panel must not assume full-pane width; no fixed positioning; no `position: fixed` tooltips (portal to document.body) |

### 6.4 Mounting / unmounting semantics

- A tab body mounts when its tab becomes active in the session's right panel; with
  `keepMounted: true` it is retained (`retainTab`) while the tab stays open but inactive.
- Per-session: closing a session or unloading the plugin removes the slot registrations and the
  retained bodies; abort all streams and dispose stores in `ctx.effect` cleanup (do not rely on
  component unmount — retained tabs never unmount).
- Do **not** start a stream from a React render/effect that can run twice (StrictMode dev): start it
  from the store action triggered by user input, or guard with `store.ensureAttached(sessionId)`.
- Re-mount after tab reopen: `remote.state({sessionId})` → render existing questions → for each
  live one call `ask({sessionId, requestId, afterSeq})` to reattach.
- Plugin unload: client `$mount` returns an unmount that removes `remote.btw`; host unload aborts
  runs. Both are owned by the plugin's `ctx.effect` disposers; never leak a handle.

## 7. Risks and open questions

| Risk | Detail | Mitigation |
|---|---|---|
| Client inspector unavailable | live tree/props unverified; `SidebarRightTabInjected` .d.ts not in runtime asar | re-run `Slots.listSubTree` from an authenticated page before implementation |
| No programmatic first open | `sidebarRightTabs` = register/entries/guide/subscribe; `ctx.layout.openRightbar` cannot select a tab | header button + guide entry + toast; user opens once, layout persists |
| Hand-written `mode:'stream'` | `...definition` spread carries it and registry accepts it; published TS types may omit it | probe `validateInvocation` + iterable; fallback = generated `./typert` artifact |
| `useTabInfo().actions.openTab` | confirmed `sidebar-right.client.js:2258-2268`; type only inferred | verify with a probe panel |
| RPC before host registration | host must `ctx.typert.register` before dispatch | register in host `apply`; retry first call once (code UNCERTAIN) |
| Single-consumer handle | one `for await` per handle; re-render must not re-iterate | iterate in store, expose snapshots |
| Shadowing temptation | `rightbar`/`shell.bottom` single seats; dynamic registration wins and deletes shipped UI | never register those keys; tab seat only |
| Theme drift | hardcoded colors break dark mode | lint for `#`/`rgb(`; review with `/tmp/dsw.css` |

## RECOMMENDED DESIGN INPUTS

- Mount the BTW 栏 as a **tab type in the built-in right column**: register a type via `sidebarRightTabs.register({id:'btw', kind:'btw', multiple:true, keepMounted:true, priority:'extension', title:()=>t('tab.title'), guide:[…]})` and a body at `slots.register({name:'sidebar.right.pane.tab', key:'btw', locale:NS, inject:(sessionId)=>({store: storeFor(sessionId)})}, BtwPanel)`; never register `root`, `rightbar`, `rightbar.session`, `sidebar`, or `shell.bottom`.
- Add a compact entry at `conversation.session.header.utilities` (list/session) as the BTW toggle + unread badge, and a `shell.overlay` toast (fresh `id`, `pointer-events:auto`) when an answer completes while the panel is closed.
- Channel: hand-written Typert **stream** Remote (`@Remote({mode:'stream'})` async generator on a `Service`, `bindTypertRemote`, `ctx.typert.register(hostContribution)`); client `ctx.remote.$mount(info)` then `remote.btw.ask({sessionId, requestId, question, afterSeq}, signal)` as an `AsyncIterable` of `{type:'accepted'|'delta'|'status'|'done'|'error'|'cancelled'}` frames. Do not use `remote.$on` (compiled allowlist), `webServer` SSE (Electron uses file:// + IPC), or session projections (no free-form publish).
- Because streaming is required and the reference plugin's `remote.commands.execute` is one-shot, keep a small unary surface too: `btw.state({sessionId})` (list live questions) and `btw.close({requestId})`; reattach with `ask({requestId, afterSeq})` and a host-side per-run text buffer.
- Support multiple concurrent questions: one host run + AbortController per request, one client store entry per `(sessionId, requestId)`, caps ≤8 global / ≤20 per session, explicit cancel on close; abort all streams in plugin `ctx.effect` cleanup (retained tabs never unmount).
- Per-session state lives in the tab body via `inject(sessionId)` + `Map<sessionId, BtwStore>`; resolve session identity from `props.session.sessionId` only if the panel is also mounted in `conversation.input.dock`, otherwise from the slot inject.
- Reuse the `sessions` client service for context: `ctx.get('sessions')`, `scope(id)`, `list.getSnapshot()`, `byId[id].origin === 'subagent'` to hide child sessions; gate invocations with the standard `useRemoteAccess` hook.
- Theme: tokens only (`--dsw-alias-bg-layer-*`, `--dsw-alias-border-l*`, `--dsw-alias-label-*`, `--dsw-alias-state-*`, `--dsw-radius-panel`, `--dsw-elevation-*`, `--dsw-font-xs-13`), user font vars `--dsh-content-font-size` / `--dsh-font-family-text`; dark mode is automatic via `data-ds-dark-theme`; inject one scoped `<style data-plugin>`.
- i18n: `ctx.locale.register(NS, dicts)` + `t = ctx.locale.bind(NS)`; pass `locale: NS` to every registration; all human-visible text (tab title, guide, placeholders, errors) localized via thunks; ship zh + en minimum.
- Layout: panel must render correctly at 300 px (rightbar min), 45 % default, 70 % max, at <1024 px viewport (sidebar auto-collapses) and in fullscreen/split/float; `height:100%`, internal scroll, container queries, no fixed positioning (portal overlays to `document.body`).
- Differentiate from the existing plugin: no answer bubbles above the composer — the dock entry is only a one-line "N 个旁路回答 · 打开" chip; answers live exclusively in the BTW tab cards (question, streaming text, cancel/retry/close, timestamps).
- Definition of done for the client slice: `/btw` from the composer opens/uses the BTW tab, streams token-by-token, supports ≥2 concurrent questions with independent cancel/retry, survives tab switch (`keepMounted`) and session switch, reattaches after carrier failure, looks native in light/dark and at 300 px width.
