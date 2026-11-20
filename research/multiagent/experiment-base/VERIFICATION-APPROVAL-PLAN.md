# 实验底座执行计划（静态实现与后续审批）

## 本轮已允许

- 只修改 `research/multiagent/experiment-base/`。
- 读取根 README 与 DSH headless 文档。
- `node --check` 语法检查；不启动 DSH，不安装插件，不运行模型、浏览器、网络、Playwright、编译器或测试。

## 本轮禁止

不使用生产插件 Host API，不改 `packages/` 或共享 profile，不继承当前 shell 凭据，不把临时 `DSH_HOME` 当成 OS 安全边界，不用退出码单独宣布交付通过。

## 后续真实运行审批（需单独批准）

1. **隔离检查**：批准人提供绝对 `dsh`、专用 DSH_HOME、专用 worktree/cwd、全新输出目录和任务样本；核对 canonical 路径不重叠 `~/.dsh`、ambient profile 或 checkout，并确认是否允许明确的 credential JSON。
2. **执行范围**：明确 headless/profile、permission mode、固定模型/路由、网络策略、预算、超时、重复次数、矩阵 seed、是否启用真实 browser/compiler adapter。没有 OS 容器/VM 隔离时，只运行受信任务。
3. **验证风险**：批准真实 `--execute` 运行，观察 bounded stdout/stderr、严格 `session → … → final` NDJSON、超时/TERM→KILL 进程组回收、`result.json` 中 `processCompleted` 与 `business.accepted` 的分离；不得以退出 0 代替 DeliveryRunV3 验收。
5. **Optional runner approval**: separately approve a trusted `RunnerConfigV1` (pinned Docker image digest, absolute allowlisted executables, network none, resource caps, output root, fixed journey adapter). Validate candidateFiles hashes and opaque candidateHash, then approve `runner.mjs --execute`; inspect exact `RunnerResponseV1` nonce/candidate binding and one status per supported check. Compile failure must make journeys `unknown`, never pass. No Docker/browser/compile execution is part of this static delivery.

## 交付门槛

静态交付只声称代码入口、文档和语法可检查。真实装载、模型行为、插件接受率、浏览器/编译器能力、网络隔离、成本与 OS 级安全性均保持未验证，直到批准人完成上述计划并提供日志与退出证据。
