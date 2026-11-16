# Antigravity over ACP: research and rebuild proposal

Status: research only. No plugin code or profile changes have been made.
Date: 2026-11-15. Environment: DSH Desktop `0.2.2-rc.3`, `agy` `1.5.9` (macOS arm64).

## 0. Conclusion

Retire the current `dsh-antigravity` direct path. It reimplements the private Cloud Code `v1internal` protocol: request envelope, credit routing, quota, signatures and retries. The 429 problem came from that self-built request layer.

Build a new plugin, tentatively named **`dsh-agy-acp`**. It treats the local `agy acp` as a **complete external agent**. DSH only does session mapping, rendering, permission bridging and optional tool bridging. It never constructs Cloud Code requests.

## 1. Verified facts (local probes, no model requests sent)

| Item | Result | How verified |
|---|---|---|
| Is ACP built in? | `agy acp` = "Start the Agent Client Protocol (ACP) stdio server" | `agy --help`, `agy acp --help` |
| Protocol version | `protocolVersion: 1`, `agentInfo: Antigravity ACP Server 1.5.9` | `initialize` handshake |
| Session capabilities | `loadSession`, `session/resume`, `close`, `list`, `additionalDirectories` | `initialize.agentCapabilities` |
| Prompt content | image ✓, embeddedContext ✓, audio ✗ | same as above |
| Authentication | `oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`; also supports `agy acp --login` | `authMethods`, help |
| Private extension | `_meta.antigravity.tier: true`, `systemPrompt.append: true` | `initialize._meta` |
| Models and options | `session/new` returns 18 models; `configOptions`: `model`, `thought_level` (low/medium/high), `mode` (default/accept-edits/auto/plan) | `session/new` |
| Account tier | `_meta.antigravity.tier = Google AI Pro (g1-pro-tier)` | `session/new._meta` |
| Slash commands | goal / compact / schedule / browser / plan / teamwork / boost / swarm …, plus locally installed skills (e.g. `browser-use`) | `available_commands_update` |
| Context window | `usage_update {used:0,size:1048576}` | session/update |
| MCP passthrough | `session/new.mcpServers` accepts both a stdio entry and an http entry; `initialize` does **not** declare `mcpCapabilities` | probe2 |
| systemPrompt append | `_meta:{antigravity:{systemPrompt:{append:"…"}}}` is accepted by session/new without error. **Whether the model actually sees it is unverified** (needs one real prompt) | probe2 + binary type `acp.AntigravitySystemPromptCap` / `json:"append"` |
| Shared session store | `session/list` returns 91 sessions (shared with CLI history) | probe2 |
| DSH has an ACP **client**? | Yes: `@deepseek-ai/dsh-subagent-acp` (subagent backend, one-shot run, permission only `allow`/`reject`). The Desktop installation **does not include it** | packages.md, config-catalog, `list_bundles` |
| DSH as ACP **server** | `@deepseek-ai/dsh-acp`, not relevant here | dsh-acp README |
| Can the agent driver be replaced? | `ctx.agents.setFactory()` is a **global single slot**, already held by `dsh-agent-loop`. A per-session replacement is not possible | dsh-agent `src/index.ts:377` |
| Does an LLM adapter know its session? | `GenerateOptions.sessionId`, `signal`, `messages`, `tools` | dsh-llm `src/types.ts:564-605` |
| Can a plugin request approval? | `ctx.approval.request({agent, toolName, callId?, reason?, signal?})` | dsh-user-approval `src/index.ts:128,242` |

Side effect: the probes created about 5 empty ACP sessions in agy's local store (cwd `/tmp/acpprobe`). No model calls were made.

## 2. Answers to the four questions

### Q1 Do I need the Antigravity CLI installed?
**Yes, it is required.** The ACP server is a subcommand of the `agy` binary. There is no separate npm or SDK package. The plugin should:
- Locate the command with `command -v agy`, or let the user configure an absolute path. Require a minimum version (≥1.5.9) and refuse to start below it.
- Detect login state. If not logged in, guide the user to run `agy acp --login` / `agy` themselves, or call ACP `authenticate` (oauth-personal).
- Never ship or download the binary. Upgrades go through `agy update`.

### Q2 Does it use the local Antigravity directly?
**Yes.** DSH spawns a local `agy acp` child process (stdio JSON-RPC). It reuses that machine's own:
- Google login and credentials (`~/.gemini/oauth_creds.json` and similar). The plugin **does not read or store tokens**.
- Account tier, credits and quota routing. The `enabledCreditTypes` behaviour is handled by agy, so the earlier root cause is eliminated.
- Its settings, MCP configuration (currently `tavily-proxy`), plugins, skills, rules and session history.
- Optional isolation: `--app-data-dir`, `--gemini-dir`, `--process-per-session`, `--sandbox`, `--disable-telemetry`. Isolating the directories also separates login state and history, so they stay off by default.

### Q3 How to handle prompts and tools

**Antigravity's internal system prompt.** It is owned entirely by agy and cannot be read or replaced. The only channel is `_meta.antigravity.systemPrompt.append`, for appending. Strategy:
- **Do not forward** the DSH system prompt (it describes DSH tools that agy cannot call, which leads to hallucinated tool calls).
- Append only a short "host description": it is running inside the DSH GUI, the workspace path, and which bridged tools are available.
- Project instruction files such as AGENTS.md / GEMINI.md are read by agy from the cwd itself. Do not inject them twice.

**MCP tools installed in Antigravity (`agy mcp`).** Still loaded by agy itself. DSH does not touch them. Each tool call runs inside agy and reaches DSH only as `tool_call` / `tool_call_update` updates for display.

**Per-session MCP that DSH passes to agy.** Use `session/new.mcpServers`. The safe choice is stdio. HTTP was accepted in testing, but agy does not declare it in `mcpCapabilities`, so treat it as unguaranteed.

**DSH's own tools / MCP / skills.**
- agy's model **cannot call DSH tools directly**. The tool list DSH passes to the adapter (89 tools / ~99 KB) must be **dropped entirely**.
- Optional phase two: a "DSH tool bridge". The plugin provides a small stdio MCP shim. The shim connects back to the DSH plugin over a local socket protected by a one-time token, and exposes only a whitelist of DSH tools (e.g. drawai, office, present). Each call is attributed to the live DSH Agent and still goes through DSH approval.
- DSH skills are not forwarded by default. agy has its own skill system.
- DSH-configured MCP servers (e.g. blender) can be passed in as stdio entries, but that starts a second process. Make it an explicit opt-in.

**Client capabilities (fs / terminal).** Declare `false` initially, so agy uses its own file and terminal tools and the boundary stays clear. Later, they could be implemented on top of DSH `ctx.fs`/`ctx.subprocess` + the sandbox (a large effort, only if needed).

**Permissions.** agy's `session/request_permission` → main-chat mode maps to `ctx.approval.request({agent, toolName, reason, signal})`, using DSH's existing approval UI. Subagent mode uses a fixed policy. agy's `mode` (default/accept-edits/auto/plan) maps to the DSH permission preset.

### Q4 What is kept from Antigravity under ACP

**Kept (owned by agy):**
- Its whole agent loop, internal system prompt and context management (including `/compact`).
- Built-in tools (file edits, terminal, browser agent, subagents/teamwork/swarm/workflow, etc.) and its MCP, plugins, skills and rules.
- Model catalog, thinking levels, modes, account tier, credits and quota routing, and retry policy.
- Session persistence: `session/list/load/resume/close`. Sessions are shared with CLI history.

**DSH keeps or adds:** conversation UI, model picker (fed by ACP `configOptions`), approval UI, workspace, cancel, `usage_update` → context usage display, and the optional tool bridge.

**Lost or degraded:**
- DSH's own tool cards for agy's tools (they can be rendered from tool_call updates as text or collapsible blocks).
- DSH token cost accounting (only context usage from ACP; no billing tokens).
- DSH compaction / rewind / fork / retry / model failover are meaningless for this route and must be disabled or degraded.
- DSH-side multi-account rotation. A single agy login is the source of truth.

## 3. Architecture options

| Option | Approach | Pros | Cons | Recommendation |
|---|---|---|---|---|
| A Agent-as-Provider | Register an LLM provider `agy`. Each DSH turn maps to one ACP `session/prompt`. `sessionId` maps to an ACP session. Send only the latest user input; stream `agent_message_chunk`/`agent_thought_chunk` back as text/reasoning. | Directly selectable in the **main chat** model picker | Semantic mismatch with the DSH loop: it sends the full history every call and expects tool calls. A "one step = whole agy turn" convention is needed | **Main route** |
| B Subagent provider | Register `antigravity` on `ctx.subagents`; DSH main models delegate via `subagent({provider:"antigravity"})` | Uses an official seam with clear boundaries; official `dsh-subagent-acp` can serve as reference | One-shot run, cannot be selected as the main chat model | **Ship alongside** (low cost) |
| C Replace the agent driver | Register your own AgentFactory | — | Global single slot, already occupied by agent-loop; would break every session | Reject |
| D Install the official `dsh-subagent-acp` directly | Config `command: agy`, `args: [acp]` | Zero code | Not in the Desktop installation, needs verification that npm has a matching version; permission is only allow/reject; no DSH approval UI | For quick verification only |

### Key contracts for option A
1. **Session mapping**: `DSH sessionId → {acpSessionId, cwd}` is persisted in the plugin's own storage. On restart, use `session/resume` (or `load`). Only if that fails, create a new session.
2. **Input extraction**: take only the user messages after the last assistant message in `messages`. Images become ACP image content. Drop the system message and `tools`.
3. **Output projection**: thought → reasoning; message → text; `tool_call*` → foldable text blocks (or a custom DSH presentation in phase two); `usage_update` → context usage; `stopReason` → finishReason (`end_turn`→stop, `cancelled`→abort, `max_tokens`/`refusal` mapped accordingly).
4. **Never return tool calls** to the DSH loop, so DSH ends the turn after one step.
5. **Cancel**: `signal.abort` → `session/cancel`.
6. **Model/thinking/mode**: built from `configOptions` into a DSH model directory (e.g. `agy/gemini-4-hydrogen` + reasoningEffort low/medium/high → `set_config_option`).
7. **Disable DSH retries**: classify agy errors as non-retryable, so `dsh-llm-retry` does not resend a whole agent turn.
8. **Process model**: one long-lived `agy acp` per plugin instance (multiplexing sessions), or `--process-per-session`. Use stdin-EOF-first teardown, following DSH `disposeAcpChild`.

## 4. Naming and the old plugin

- New package: `dsh-agy-acp` (display name "Antigravity (ACP)"), new provider id `agy`, so it does not clash with the old `antigravity`.
- Old `dsh-antigravity` (currently installed 1.2.0): freeze development. Once the new plugin passes acceptance, `remove_bundle`. Keep the repository directory and mark it deprecated in its README, or delete it after confirmation. Sensitive captures under `capture/*.jsonl|*.mitm` should be cleaned up separately.
- Reusable assets: almost none (the direct protocol layer is dropped entirely). Only the UI/catalog display ideas carry over.

## 5. Implementation phases (each needs approval)

| Phase | Content | Acceptance |
|---|---|---|
| P0 | Probe script: one real `session/prompt` (consumes 1 request). Verify systemPrompt append, http MCP, the `tool_call` update shape and `stopReason` | Record the update samples (redacted) |
| P1 | `dsh-agy-acp` skeleton: binary detection, login state, process management, `initialize`/`session/new`, model directory | Model picker shows the agy models; no model request |
| P2 | Option A streaming, cancel, session mapping and resume, error classification | Multi-turn conversation in the main chat, cancel, restart then resume |
| P3 | Permission bridge to `ctx.approval`, mode mapping | default mode shows DSH approval cards |
| P4 | Option B subagent provider | `subagent({provider:"antigravity"})` returns a result |
| P5 (optional) | DSH tool-bridge MCP shim (whitelist + token + approval) | agy can call the whitelisted DSH tools |
| P6 | Retire old plugin, marketplace release | New sessions verified; old plugin removed |

## 6. Open risks

- agy's ACP is a private implementation that changes with version (field names are snake/camel dual-written). Pin a minimum version and tolerate unknown fields.
- ACP sessions are shared with CLI history. Tag sessions created by DSH with a `_meta`/title prefix so they can be told apart.
- `--dangerously-skip-permissions` must never be enabled by default.
- Every DSH "step" is a complete agy agent turn. Quota consumption and latency are much higher than a single model call; the UI must make this clear.

## 7. References

- ACP specification: https://agentclientprotocol.com
- DSH ACP client reference implementation (README; source is not in the Desktop package): `@deepseek-ai/dsh-subagent-acp`. Config: `.agents/skills/dsh-doc/dsh-docs/config-catalog.zh.md` around line 3753
- DSH ACP server contract: `.agents/skills/dsh-doc/packages/dsh-acp.zh.md`
- Agent factory single slot: `app.asar/dsh/node_modules/@deepseek-ai/dsh-agent/src/index.ts:166-386`
- LLM request contract: `@deepseek-ai/dsh-llm/src/types.ts:564-605`
- Approval API: `@deepseek-ai/dsh-user-approval/src/index.ts:128-149,242`
- Subprocess / ACP teardown: `.agents/skills/dsh-doc/dsh-docs/subsystems/subprocess.zh.md`
- Plugin development skill: `.agents/skills/dsh-doc/references/plugin-development.md`, `host-plugin.md`, `practices.md`, `configuration.md`, `verification.md`
- Probe scripts: `/tmp/acpprobe/probe.mjs`, `/tmp/acpprobe/probe2.mjs` (temporary)
