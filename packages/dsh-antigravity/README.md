# dsh-antigravity

Direct Google Antigravity (`v1internal:streamGenerateContent?alt=sse`) provider plugin for DeepSeek Harness (`dsh`).

## Architecture Highlights

- **Direct Cloud Code Protocol**: Connects directly over HTTPS (`daily-cloudcode-pa.googleapis.com` -> `daily-cloudcode-pa.sandbox.googleapis.com` -> `cloudcode-pa.googleapis.com`) without wrapping external binaries.
- **Request Hygiene & Trajectory ACL**: Uses host-matched `antigravity/hub/2.28.0 (aidev_client; os_type=<host>; arch=<host>; cl=1008300195)` `User-Agent` with `Accept-Encoding: gzip`, canonical 5-segment `requestId`, deterministic FNV-1a upstream `sessionId`, best-effort `writeTrajectoryAcls` pre-registration, ordered envelope (`project -> requestId -> request -> model -> userAgent -> requestType`), and omits `x-goog-user-project` on `aicode-consumers` and content generation requests.
- **DSH Disjoint Usage Accounting**: Computes `inputTokens = max(0, promptTokenCount - cachedContentTokenCount)`, sets `outputTokens = candidatesTokenCount + thoughtsTokenCount`, explicitly emits `cacheReadTokens` (including `0`), omits `cacheWriteTokens`, and self-computes `totalTokens = inputTokens + cacheReadTokens + outputTokens`.
- **KV Prefix Stability & Lossless Replay**: Declares `systemPromptUpdate: 'in-history'`, freezes `systemInstruction`, wraps mid-conversation system/developer instructions in `<system-reminder>` user turns, keeps tool declarations stable, and replays `thoughtSignature` metadata via DSH `ReplayEnvelope`.
- **Sticky Multi-Account Routing**: Persists credentials (`0o600`) under `$DSH_HOME/antigravity/accounts.json` (`~/.dsh/antigravity/accounts.json`) and keeps per-session sticky affinity (no round-robin), switching only after 3 consecutive `AUTH`/`QUOTA`/`RATE_LIMIT` failures, `<= 5%` pool quota, or manual user action (with explicit cold-cache warning UI).
- **Live Quota & Settings UI**: Integrates into DSH Settings (`antigravity`) with OAuth PKCE loopback login (+ manual callback fallback), pool quota progress bars (`<15%` warn, `<=5%` exhausted, fail-open on errors), cache telemetry metrics, connection diagnostics (`Run Diagnostics`), and model visibility toggles.

## Slash Commands

- `/antigravity-status` — Active account, cold-cache notice, quota pools, and cache hit telemetry
- `/antigravity-accounts` — List signed-in Google accounts
- `/antigravity-switch <email-or-id>` — Switch active/session sticky account
- `/antigravity-quota` — Refresh live quota pools
- `/antigravity-doctor` — Run end-to-end token, `loadCodeAssist`, `countTokens`, and header hygiene diagnostics

## Setup & Build

Install local peer/dev dependencies before launching in the DSH Plugin Dev Sandbox so Node ESM resolves `@deepseek-ai/*` runtime peers when loaded directly via `file://`:

```bash
pnpm --dir packages/dsh-antigravity install
node scripts/build.mjs
```
