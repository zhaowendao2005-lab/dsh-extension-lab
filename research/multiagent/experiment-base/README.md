# External DSH experiment base

This directory is intentionally outside the production plugin. It contains the external supervisor and report builder used to run the same plugin in a dedicated DSH headless process. The plugin never imports this directory, starts headless, or writes experiment HTML.

## Explicit, isolated execution

Execution is refused unless all isolation inputs are explicit and the caller passes `--execute`:

```sh
node driver.mjs --execute \
  --command /absolute/path/to/dsh \
  --dsh-home /absolute/path/to/isolated-dsh-home \
  --cwd /absolute/path/to/dedicated-worktree \
  --task-file /absolute/path/to/task.txt \
  --out /absolute/path/to/new-artifacts-dir
```

The driver checks canonical paths before launching: the dedicated `DSH_HOME`, worktree, and output directory must be pairwise disjoint and must not overlap the invocation checkout, `~/.dsh`, ambient `DSH_HOME`, or `DSH_PROFILE_DIR`. The worktree and DSH home may not contain `.env`; an existing output directory is rejected. The process runs with a new `HOME`/XDG tree below the output directory, `DSH_TELEMETRY_MODE=DISABLED`, no inherited environment, and only a small fixed environment allowlist. Credentials are absent unless the caller explicitly supplies a 0600 owner-only JSON file via `--credentials-file`; credential names are recorded, never values. The driver is not an OS sandbox: use a separately approved container/VM when the task can execute untrusted code.

`--permission-mode` is `read-only` by default and may be set to `workspace-write`. No model, browser, network, install, or real headless run is performed by static checks; `--execute` is a deliberate runtime opt-in.

## Protocol and fail-closed result

The child is launched as `dsh --profile headless --json --permission-mode ... --approval-policy never -`. Stdout is parsed as strict NDJSON; stderr is retained separately. Each stream is bounded (`--max-log-bytes`, default 8 MiB) while still drained. A line over `--max-line-bytes`, malformed JSON, missing `session`/`final` lifecycle, duplicate final, or any event after final is a protocol error. Timeout, SIGINT/SIGTERM, protocol errors, log overflow, and I/O failures terminate the detached POSIX process group with TERM, then KILL after the grace interval; cleanup is reported as `settled` or `pending`.

The report keeps separate facts:

- `processCompleted`: exit code 0 + no signal + strict terminal final with `reason.kind === completed` + process-group cleanup settled.
- `business.verdict` / `business.accepted`: derived only from the public `DeliveryRunV3` projection or explicit verdict fields; absent or incomplete plugin acceptance is `null`, never inferred from process completion.
- `usage`: numeric usage fields when present; otherwise `null` (unknown is not zero).

Output artifacts are `stdout.ndjson`, `stderr.log`, `events.json`, `delivery.json`, `timeline.json`, `dag.json`, `metrics.json`, `result.json`, and `report.html`. `report.mjs` extracts the public run projection (`schemaVersion: DeliveryRunV3`), `run.*` events, unit dependency edges, usage, lifecycle, and acceptance evidence without modifying the plugin.

## Trusted external runner (optional, never implicit)

`runner.mjs` is a separate adapter for the plugin's `RunnerRequestV1`; it is not called by the production Host. It refuses execution without `--execute` and a separately approved `RunnerConfigV1` containing `runnerApproved: true`, absolute Docker binary, pinned `imageDigest: sha256:...`, `network: "none"`, bounded CPU/memory/PID limits, absolute allowlisted executable paths for each check kind, a configured output root, and a fixed `journeyArgv`.

The request must bind the opaque `candidateHash` supplied by the plugin and verify every `candidateFiles[{path,sha256,bytes}]` against the immutable workspace. It accepts only compile/CLI/journey checks (other card kinds remain plugin-owned), emits exactly one `RunnerResponseV1.checks[]` item per supported check, and binds `nonce`, `runId`, `unitId`, `candidateId`, and `candidateHash` in the response. Compile failure produces `unknown` for journeys, never a skipped pass. Journey execution accepts one prewritten `ScenarioV1` with one browser context/DSL journey; the driver does not create per-step agents. Child execution is Docker-only with read-only candidate mount, writable bounded output mount, read-only root, no-new-privileges, all capabilities dropped, no network, tmpfs `/tmp`, and resource limits. No model-generated command can add mounts, privileges, networking, shell chaining, or Docker flags. The wrapper reports runner image/network/resource metadata; browser screenshots/downloads are evidence only and never acceptance by themselves.

The runner is useful only when a trusted container image and adapter are supplied by an approved operator. It has not been executed in this task.

The base records a content hash of the task, the exact command/profile/policy, event timeline, dependency DAG, and metrics. A future matrix runner can consume `result.json`/`events.json` to randomize seeded scenarios and replay them. This package deliberately does not execute a matrix, browser journey, compiler, or model call implicitly; those require a separate approved run plan and a trusted adapter/container.

## Limitations

- POSIX process-group cleanup only; Windows execution is refused.
- The driver cannot prove that DSH itself or a model-resolved tool respects the requested isolation. Temporary `DSH_HOME` is configuration separation, not a security boundary.
- `DeliveryRunV3` acceptance is `null` when the plugin does not expose complete per-unit decisions. A child `tool_result` status or successful process exit is never treated as delivery acceptance.
- No production package or shared profile is changed by this directory.
