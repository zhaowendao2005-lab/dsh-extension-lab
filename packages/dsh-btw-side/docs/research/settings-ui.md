# BTW · Settings Center (设置中心) UI research — task-5

> Scope: how a third-party Host+Client plugin puts BTW options (command name, bar form `dock`/`right-tab`, maxTokens/timeout, concurrency caps) into a **new settings page (配置分页)** inside the DSH Settings Center, following existing conventions. Design only; no code shipped.
> Runtime: DSH `0.2.2-rc.1` inside `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/`; installed profile `/Users/qihoo/.dsh/profiles/desktop`.
> Method: live client inspector (`cordis_inspect_query` platform `client`) is unavailable in this Electron GUI (all calls time out; `dsh web` requires a token → 401). Evidence therefore comes from (a) the bundled **slot-contract catalog** embedded in `/tmp/b1.js` (the `@deepseek-ai/dsh-api-gateway` client bundle, 98 records; each record carries `source: packages/client/<pkg>/src/client/...ts:<line>`), (b) installed/bundled package sources, (c) the installed reference plugin `@michengai/dsh-btw@1.3.8`. `UNCERTAIN` marks points not confirmable without a live inspector.

## 0. Summary verdict

| Question | Verified answer |
|---|---|
| Can a third-party profile plugin add a **new settings nav page**? | **Yes.** `settings.section` is a root-scope **list** slot declared by `client-ui-settings-general`; fresh `id` is additive. 5 installed plugins already do it (billion-context, dshmarket, `@michengai/dsh-archive-manager`, `@michengai/dsh-skills-manager`, `dsh-vscode-mode`). |
| Is the page body schema-driven or free-form? | **Free-form React** component; you own copy, layout and write path. Automatic schema forms exist separately (`autoGenerate` + `plugins.*.config`), not required. |
| Where does config persist? | **Profile patch YAML** (`profileContext.patchPath`) via `configEditor`; namespace = profile patch entry id; profile-isolated. |
| How does the page read/write config? | Client `ctx.configForms` → `remote.settings.describe()` / `remote.settings.mutate(ns, ops, revision)` (generated Typert Remote), refresh via forwarded event `settings/document-updated`. |
| Restart needed after save? | **No app restart.** Only fields marked **volatile** are writable and `applies:"live"`; a save goes through Loader reconcile (volatile avoids the plugin fiber remount). Non-volatile fields are read-only in the UI. |
| Existing btw plugin's UI today | A **config card inside Settings → Plugins** (`plugins.bundle.config` key `@michengai/dsh-btw` + `plugins.row.config` key `@michengai/dsh-btw#michengai-btw`), **not** a `settings.section`. |

## 1. Settings Center slot map (exact keys, from the bundled slot-contract catalog)

All records below exist in `/tmp/b1.js` (~lines 19900–20900). "declaredBy" means the seat only exists while that parent entry is mounted — so third-party registrations must be lazy (`ctx.slots.inject(key, …)`).

| Slot key | Kind / scope | Declared by | Options (required) | Owner props | Use for BTW |
|---|---|---|---|---|---|
| `sidebar.settings` | single / root | entry in `sidebar` (`client-ui-sidebar`) — occupant `SettingsRoot` | — | `{ wide: boolean }` | ✖ single: registering replaces the whole settings seat (`shadows-shipped-ui`) |
| `settings.section` | **list / root** | entry in `sidebar.settings` (`client-ui-settings-general`) | **`id` (required)**, `order` (number, default 0), `label` (string \| `() => string`) | — | ✅ **the new BTW page** |
| `settings.section.icon` | list / root | entry in `sidebar.settings` | **`id` must equal the target section id**, `label` not displayed | `{ size:number, active:boolean }` | ✅ optional nav icon |
| `settings.plugins.tab` | **list / root** | entry in `settings.section` (`client-ui-settings-plugins`) | `id`, `order`, `label` | — | △ alternative: a tab *inside* the shipped Plugins section |
| `plugins.bundle.config` | keyed / root | entry in `main` (`client-ui-plugin-manager`) | **`key` = bundle package name** | (view: `'page'`) | △ existing btw pattern; keep for discoverability |
| `plugins.row.config` | keyed / root | entry in `main` (plugin-manager) | **`key` = `<package>#<rowId>`** | (view: `'summary'` \| `'page'`) | △ existing btw pattern |
| `settings.general.item` | list / root | entry in `settings.section` id `general` | `id`, `order` | — | △ one preference row only, no page |
| `settings.action` | list / root | `sidebar.settings` entry | `id`, `order`, `label` | — | ✖ content-column header actions (not config) |
| `settings.header` / `settings.trigger` / `settings.close` | single / root | `sidebar.settings` entry | — | `{wide}` for trigger | ✖ single seats; do not touch |
| `settings.onboarding` | list / root | `sidebar.settings` entry | — | `{ openSection(id), … }` | ✖ not a public navigation API |

Catalog doc for `settings.section` (verbatim, condensed): "One settings page per list entry. Registrant options carry the nav identity: `id` (section key, drives `only` filtering), `order` (nav position), `label` (registrant-localized display text — the registrant re-registers with fresh text on locale change, so the shell never subscribes locale state…). Sections render inside the panel content column."
`id` doc: "Use an id of your own: a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it."
Shipped ids to avoid: `general`, `plugins`, `models`, `account`, `agent-presets` (occupants of `settings.section`).

### 1.1 Third-party proof (verbatim registration, `@michengai/dsh-archive-manager`)

`/Users/qihoo/.dsh/profiles/desktop/node_modules/@michengai/dsh-archive-manager/lib/client.js`:

```js
// icon (optional), then the page; both inside a lazy inject so they wait for the seat
r.slots.inject("settings.section", () => {
  r.slots.register({ name: "settings.section.icon", id: "archive-manager", locale: Oe }, ArchiveNavIcon);
  return r.slots.register({
    name: "settings.section",
    id: "archive-manager",            // unique section key → nav identity
    order: 45,                        // nav position
    label: () => r.locale.bind(Oe)("archived.badge"),   // localized thunk
    icon: "archive",                  // UNCERTAIN: accepted at runtime, not listed in catalog options
    locale: Oe,
    inject: Zr,                       // () => custom props (store, actions, t)
  }, ArchivedSessionsSection);
});
```

Its page content persists its own preferences through its own host HTTP route (`/api/michengai/dsh-archive-manager…`, `callSettingsApi`), **not** `configForms` — proving the section body is arbitrary and you may choose the write path. For BTW we should prefer `configForms` (below) because it reuses the official config document.

## 2. Reads, writes, persistence — API table

| Layer | API / artifact | Evidence |
|---|---|---|
| Host config schema | plugin exports `Config` (Schemastery). Fields intended for the settings page are wrapped `volatileField(schema)` → `.volatile()`, which is what makes them editable live. | `@michengai/dsh-btw/lib/index.js:1115-1130`: `function volatileField(schema){ if (typeof schema?.volatile === "function") return schema.volatile(); if (typeof schema?.extra === "function" && schema.meta?.volatile !== true) return schema.extra("volatile", true); return schema; }`; `var Config = z.object({ allowedTools: volatileField(z.array(z.string()).default([])), promptPrefix: volatileField(z.string().default("")) }).default({})` (`z` = `@deepseek-ai/schemastery`). |
| Settings document | host service `settings` (`SettingsForms`, inject `["configEditor","profileContext"]`): `describe()` returns `{autoGenerate, ns, schema, revision, applies:"live", value, base, user, secrets?}`; `mutate(ns, ops, revision)`; only `volatileForm(schema)` fields are exposed. Errors: `No configurable plugin entry "<ns>"`, `Plugin entry "<ns>" has no volatile fields`, `Config field "<path>" is not volatile`, `SettingsConflictError(ns, expected, revision)`. | `/extracted_files/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js:322-544` (class at 322; `volatileForm` 122; `write` 505-540; `configure({auto})` 368-382). |
| Namespace key | **profile patch entry id** (`entry.options.id`, e.g. `michengai-btw`), not the package name. Entries are Loader entries under `include` with a unique id. | `dsh-config-editor/lib/index.js:34-48` (`entries()`, `configuration()`); `dsh-settings/lib/index.js:400-440`. |
| Persistence | `configEditor.documentPath` = `profileContext.patchPath`; row written as `{id, name, config}` into the profile patch YAML (atomic + file lock), then `fiber.resolveConfig(next)` + Loader reconcile → live hot reload. | `dsh-config-editor/lib/index.js:24` (`documentPath`), `:96-140` (`edit`). |
| Wire read/write | Host Remote namespace `settings` (`dsh-api-settings-controller`): `describe()` → `{writable, namespaces:[{ns,autoGenerate,schema,value,base?,user?,applies,secrets,revision}]}`; `mutate(ns, ops, revision)`. Client: `ctx.remote.settings.describe()` / `.mutate(...)`. | `dsh-api-settings-controller/lib/index.js` (`namespaceView`, Remote `describe`/`mutate`); generated descriptors `lib/typert.remote-client.js`. |
| Client form service | `ctx.configForms` (`ConfigForms extends Service`, key `"configForms"`): `describe()` → `SettingsDescribeMirror` with `.getSnapshot().view.namespaces`, `.load()`, `.subscribe()`; `get(ns)` → `ConfigFormController` with `getSnapshot()` (`{status,value,base,user,revision,writable}`), `set/unset/mutate`, revision CAS, auto `recover()` on failure. | `dsh-client-ui-settings/lib/client.js:1270` (`super(ctx,"configForms")`), `ConfigForms`/`ConfigFormController` definitions; package `apply` injects `["remote","remote.settings"]`. |
| Change notification | forwarded Cordis event **`settings/document-updated`** (host emits `(ns, revision)`); client also refreshes on `connection/reset`; `settings/document-updated` is in `API_REMOTE_FORWARDED_EVENTS`, so `ctx.remote.$on("settings/document-updated", cb)` is allowed for plugins. | `dsh-settings/lib/index.js` `describe()` emit; `dsh-api-remotes/lib/types/remote-events.js` list. |
| Automatic page policy | `ctx.settings.configure({ auto: false }, fiber)` opts a plugin instance out of the generated page; built-ins that ship their own UI all do this (e.g. `dsh-client-ui-settings/lib/index.js:16`, `dsh-client-ui-theme/lib/index.js:202`). Default `auto === true`. | `dsh-settings/lib/index.js:368-382` + `describe()` `autoGenerate`. |

### 2.1 How existing btw plugs into this today (baseline to keep/replace)

- Host schema: `allowedTools`, `promptPrefix` (both volatile). Client registers two keyed cards at `lib/client.js:15940-15958`: `plugins.bundle.config` key `@michengai/dsh-btw` and `plugins.row.config` key `@michengai/dsh-btw#michengai-btw`, `priority:30`, `inject:()=>face` where `face = {scope: createSettingsScope(ctx.get("configForms"))}` and the card renders `BtwSettingsCard` (summary vs form).
- `createSettingsScope(forms)` discovers the namespace from `forms.describe().getSnapshot().view?.namespaces` (order: `michengai-btw` → `include:michengai-btw` → `@michengai/dsh-btw` → regex `/(?:^|[#:/-])michengai-btw$/`), retries `mirror.load()` 6×300 ms, exposes `{getSnapshot, subscribe, setMany(pairs)}`; `setMany` → `controller.mutate([{op:"set", path:[field], value}, …])`.
- Consequence: the current UI lives under **Settings → Plugins → (bundle page / row page)**, mixed with plugin management — not a first-class nav entry. That is exactly the gap task-5 closes.

## 3. Recommended design: one new `settings.section` page + kept bundle card

- Add `settings.section` **id `btw-side`**, `order` e.g. 45–55 (after `plugins`=15; archive-manager uses 45), `label: () => t("settings.nav")` → 「旁路提问」/ “Side ask”, `locale: NS`; optional `settings.section.icon` with the same id.
- Page content: a plain component with `ctx.inject(["configForms"], …)` face, form fields bound to BTW's volatile config keys (commandName, form `dock`|`right-tab`, maxTokens, timeoutMs, maxConcurrentGlobal, maxConcurrentPerSession, allowedTools…), Save/Reset, revision-conflict banner.
- Keep (or drop, see §6) the existing `plugins.*.config` card pointing at the same form face so the plugin page remains discoverable; call `ctx.settings.configure({ auto: false })` on the host only if the auto-generated page would duplicate the new section (UNCERTAIN whether the auto page currently renders anywhere: `autoGenerate` has no consumer in bundled client packages; plugin-manager's configurable path reads `configForms` namespaces instead).

### 3.1 Minimal copyable skeleton (≈60 lines)

```js
// host (backend/index.ts) — schema only; keep fields volatile so saves apply live
import z from "@deepseek-ai/schemastery";
const volatile = (s) => typeof s?.volatile === "function" ? s.volatile() : s.extra("volatile", true);
export const Config = z.object({
  commandName: volatile(z.string().default("btw")),
  barForm: volatile(z.union([z.const("dock"), z.const("right-tab")]).default("right-tab")),
  maxTokens: volatile(z.number().min(64).max(8192).default(1024)),
  timeoutMs: volatile(z.number().min(1000).default(30000)),
  maxConcurrentGlobal: volatile(z.number().min(1).max(16).default(8)),
  maxConcurrentPerSession: volatile(z.number().min(1).max(20).default(20)),
}).default({});
export const inject = ["commands"];           // whatever the plugin already needs
export function apply(ctx) { /* … */ }
```

```tsx
// client (frontend/index.tsx) — register the page lazily; render a form over ctx.configForms
const NS = "btw-side";
export const inject = ["slots", "remote", "configForms", "locale"];
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, dicts), `${NS}.locale`);
  const t = ctx.locale.bind(NS);

  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section", id: NS, order: 50, locale: NS,
    label: () => t("settings.nav"),              // thunk → follows locale changes
    inject: () => ({ form: formStore(ctx) }),    // face handed to the component
  }, BtwSettingsSection));

  ctx.slots.inject("settings.section.icon", () =>
    ctx.slots.register({ name: "settings.section.icon", id: NS, locale: NS }, BtwNavIcon));
}

// store: mirror ConfigFormController; rebind when the describe mirror gains our namespace
function formStore(ctx) {
  let controller, off, listeners = new Set(), retry = 0;
  const notify = () => listeners.forEach((l) => l());
  const bind = () => {
    const ns = ctx.configForms.describe().getSnapshot().view?.namespaces?.find(v => v.ns === NS);
    const next = ns ? ctx.configForms.get(ns.ns) : undefined;
    if (next === controller) return;
    off?.(); controller = next; off = next?.subscribe(notify); notify();
  };
  const timer = setInterval(() => { bind(); if (controller || ++retry > 6) clearInterval(timer); }, 300);
  ctx.effect(() => () => { clearInterval(timer); off?.(); }, `${NS}.form`);
  bind();
  return {
    getSnapshot: () => controller?.getSnapshot() ?? { status: "unavailable", writable: false },
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    save: (patch) => controller?.mutate(Object.entries(patch).map(([field, value]) => ({ op: "set", path: [field], value }))),
    bound: () => !!controller,
  };
}

function BtwSettingsSection({ form }) {
  const snap = React.useSyncExternalStore(form.subscribe, form.getSnapshot);
  // … local draft state per field; Save → await form.save(patch); Save disabled unless
  //    snap.writable && form.bound() && dirty; show conflict banner on Error("conflict").
  return <form className="btw-settings" /* theme-token CSS only */ />;
}
```

Rules embedded above: save only via the controller (revision CAS is handled by it); show read-only when `writable !== true` or `bound() === false`; never call `remote.settings.mutate` directly (bypasses mirror cache + revision tracking).

## 4. Theme, layout, i18n requirements for the page

- **Theme tokens only** (no hard-coded colors): `--dsw-alias-label-primary/secondary/tertiary`, `--dsw-alias-bg-base/-bg-layer-1..4`, `--dsw-alias-border-l2/l3`, `--dsw-alias-state-business-primary` for the primary button, `--dsw-state-error-primary` for errors, `--dsw-radius-md/lg`, `--dsw-font-xs-13`, `--dsw-elevation-panel`; dark mode follows `body[data-ds-dark-theme]` (98 `--dsw-*` tokens in `dsh-web-frontend/dist/assets/index-lh_YM6sT.css`; same convention as the old btw `<style data-plugin>` injection).
- **Width**: sections render inside the settings panel content column. The shipped Plugins section caps itself at 760px (`max-width:760px` in `dsh-client-ui-settings-plugins` CSS) — mimic that for a form column; rows full width, no fixed widths below ~360px.
- **i18n**: one namespace per plugin, `ctx.locale.register(NS, {zh, en, …})`, `label` as thunk so the nav text follows locale without re-registering; dictionary lookup `t("settings.nav")`. Reuse existing btw's zh dictionary keys only if both plugins are not co-installed (different NS avoids key collisions anyway).
- **Nav order suggestion**: `order: 45-55` → between Plugins (15) and Models/Account; verify visually after mounting (UNCERTAIN final ordering of all sections).
- **Mount semantics**: `settings.section` exists only while the settings seat (`sidebar.settings` occupant) is mounted; register inside `slots.inject` (waits for declaration). The panel content unmounts on close (UNCERTAIN), so the section component must be stateless across open/close and the store must not own long-lived training; all business state stays in the host service.

## 5. Restrictions, failure modes, fallback

| Constraint | Consequence | Handling |
|---|---|---|
| Only `volatile` fields are writable (`isVolatilePath`) | A config field not marked volatile cannot be edited from any settings UI; `mutate` throws `Config field "…" is not volatile` | Wrap **every** user-editable field with `volatileField()`; keep structural/lifecycle fields (e.g. subagent model wiring) non-volatile and out of the page |
| Page seat exists only while settings is open | Can't host runtime BTW state in the section | Section reads config only; live side-question state lives in the bar component (client-ui.md design) |
| No schema auto-render requirement | Free-form; you must build inputs and validation | Use primitives (`Button`, inputs from `@deepseek-ai/dsh-client-ui-primitives`) + local validation; schema remains authoritative for host validation |
| Namespace must be the profile entry id and unique among include entries | Ambiguous ids are filtered by `configEditor.entries()` → no descriptor | Use a dedicated bundle row/id (e.g. `btw-side`); don't rely on regex sniffing like the old plugin; also register `include:`-prefixed fallback only if nested include is used (UNCERTAIN whether BTW needs it) |
| If `settings.section` registration throws | Third-party bundle may fail to mount that seat | Wrap in try/catch and keep the `plugins.bundle.config` card fallback (old plugin's pattern) |
| If settings API unavailable (`configForms` missing / `writable !== true`) | Page must not pretend to save | Show `settings.unavailable` read-only banner (old plugin does exactly this) |
| No restart, but Loader reconcile runs | Volatile fields: no remount. Non-volatile change would restart the entry (not exposed via UI) | Document that changing commandName takes effect after the config edit (Loader reconcile) — verify live once implemented |

**Fallback (if we ever decide not to add a nav page):** keep the existing `plugins.bundle.config` + `plugins.row.config` cards (id/keys of the new bundle), with the identical form face — no UX regression, just one more click (Settings → Plugins → BTW page). A third option, an in-bar settings drawer, should be avoided for config that the host must read before any bar exists; it also duplicates a second write path.

## 6. Coexistence with installed `@michengai/dsh-btw` (id / title / namespace conflicts)

| Risk | Detail | Mitigation |
|---|---|---|
| `settings.section` id clash | Old btw has **no** `settings.section`; a new one with id `btw` is free today. If a future old-btw release adds `btw`, list-slot dedupe keeps only the lowest-priority entry per id → one page silently shadows the other | Use distinct id `btw-side`; document that if old btw is removed, id may be normalized later |
| Nav label duplication | Old btw card title is 「旁路提问设置」 inside Plugins pages | New nav label 「旁路提问」 + page heading 「旁路提问 · 设置」; avoid reusing the exact old title |
| Locale namespace clash | Two plugins both registering NS `michengai-btw` would fight over keys | New NS `btw-side` (or plugin-specific), own dictionary files |
| Config namespace clash | Old plugin's entry id is `michengai-btw`; if the new plugin replaces that same bundle row, `configForms` exposes old fields under the new page | New package + new patch entry id; if replacing the old bundle deliberately, keep the same ns and version the schema (defaults for new keys) — otherwise the page shows the old `allowedTools/promptPrefix` only |
| Duplicate surfaces | Auto-generated config page (if any) + bundle card + new section can show the same fields three times | `ctx.settings.configure({ auto: false })` on the new host entry when its own page/card exists; keep exactly one card + one section |
| Slot key reuse | Reusing `@michengai/dsh-btw#michengai-btw` as `plugins.row.config` key replaces old btw's card | Only register `plugins.*.config` under the **new** bundle package name / row key |

## 7. UNCERTAIN / open items

1. `icon` option on `settings.section` is not documented in the catalog `registerOptions`, yet archive-manager passes `icon:"archive"`. Prefer the documented `settings.section.icon` list slot; treat the inline `icon` option as unsupported-but-working.
2. Exact component props for `settings.section`: catalog has no `ownerProps` for this record; archive-manager proves `inject: () => props` is supported and receives them. Whether standard hooks (`useSessions`, `useResource`, …) are also injected alongside is not verified.
3. Whether the settings panel keeps sections mounted while closed (affects whether the section may hold a `ConfigFormController` subscription permanently) — unknown; design assumes unmount-on-close.
4. `autoGenerate`'s current consumer: no bundled client package reads it; plugin-manager's "configurable" page instead derives from `configForms` namespaces. The auto page may be a future/host-only path — mark as unsupported in docs.
5. Live inspector unavailable (Electron 401). All the above comes from bundled catalog + source; re-verify slot ids once a browser-attached session exists.
6. Existing old-btw `plugins.bundle.config`/`plugins.row.config` behavior verified in installed v1.3.8; if the user upgrades it, re-check lines 15940–15958 before copying patterns.

## 8. RECOMMENDED DESIGN INPUTS (≤12 bullets for DESIGN.md)

- Add one `settings.section` page: `{ name:"settings.section", id:"btw-side", order:50, locale:NS, label:()=>t("nav") }` + optional `settings.section.icon` with the same id; lazy `ctx.slots.inject`; never touch `sidebar.settings` / `settings.header` / `settings.trigger` (single seats, would shadow shipped UI).
- Body is a free-form React form; read/write through `ctx.configForms` (`ConfigForms.get(ns)` → `ConfigFormController.getSnapshot/mutate`), not `remote.settings.*` directly; show read-only when `writable !== true` or the descriptor is absent.
- Host config: export Schemastery `Config`; wrap every user-editable field with `volatileField()` (`.volatile()`); non-volatile fields are rejected by `mutate` (`Config field "…" is not volatile`) and must not appear in the page.
- Namespace = profile patch entry id (`entry.options.id`), unique under `include`; use a dedicated bundle row/id (`btw-side`) rather than regex discovery like old btw's `createSettingsScope`.
- Persistence is the per-profile patch YAML (`profileContext.patchPath`) via `configEditor.edit`; saving is live (Loader reconcile), no app restart; document that `commandName` changes apply on the next Loader reconcile.
- Revision CAS is automatic in `ConfigFormController.mutate`; surface `SettingsConflictError` as "配置已修改，请重试" and re-read `getSnapshot()`.
- Fields on the page: commandName, barForm (`dock`|`right-tab`), maxTokens, timeoutMs, maxConcurrentGlobal, maxConcurrentPerSession; validate client-side but keep schema authoritative (zod/schemastery limits: e.g. maxTokens 64–8192, timeout 1s–5min, caps ≤16 / ≤20).
- Use host `ctx.settings.configure({ auto:false })` only if the auto page duplicates the new section; keep exactly one additional discoverability card (`plugins.bundle.config` under the new bundle name) if desired.
- Keep the old plugin's `plugins.bundle.config` key `@michengai/dsh-btw` untouched; the new section uses id `btw-side` and a distinct locale namespace to avoid shadowing/duplication.
- Style: theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-font-*`), max content width ≈760px inside the settings column, mirrored light/dark; errors via `role="alert"`, save state as idle/saving/saved/error.
- i18n: one dictionary per locale, `label` thunk re-read by the shell; zh/en at minimum; keep 「旁路提问」 as the nav label to differentiate from old btw's 「旁路提问设置」 card.
- Fallback: if `settings.section` is unavailable/throws, register the same form face under `plugins.row.config` (key `<new-bundle>#btw-side`) and `plugins.bundle.config` (key package name); no restart required either way.

### Evidence index
- Catalog: `/tmp/b1.js` (slot contracts; source paths `packages/client/ui-settings/src/client/contract/slots.ts:17-100`, `packages/client/ui-plugin-manager/src/client/slot-contract.ts:142-150`).
- Official section example: `/extracted_files/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:255-259`.
- Config service/client: `dsh-settings/lib/index.js:322-544`; `dsh-config-editor/lib/index.js:24,34-48,96-140`; `dsh-api-settings-controller/lib/index.js` (`describe`/`mutate`); `dsh-client-ui-settings/lib/client.js:1270+`; `dsh-api-remotes/lib/types/remote-events.js` (`settings/document-updated`).
- Plugin-manager card dispatch: `dsh-client-ui-plugin-manager/lib/client.js:3168,3179,5855,5870,6022,6919-6922,7776-7780`.
- Third-party section: `@michengai/dsh-archive-manager/lib/client.js` (settings.section registration + settings.section.icon + custom API persistence).
- Reference btw: `/Users/qihoo/.dsh/profiles/desktop/node_modules/@michengai/dsh-btw/lib/index.js:1115-1130` (Config/volatileField); `lib/client.js:15428-15545` (`createSettingsScope`), `15562-15690` (`BtwSettingsCard`), `15940-15958` (config cards).
