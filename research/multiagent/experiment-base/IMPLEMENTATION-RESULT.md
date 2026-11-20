# 实现阶段结果（静态 smoke）

日期：2026-11-18（Asia/Shanghai）

## 本轮已完成（仅外部实验底座）

- `driver.mjs`：外部 DSH headless supervisor。必须显式 `--execute`，要求专用绝对 `DSH_HOME` / cwd / output；canonical 路径与 `~/.dsh`、ambient `DSH_HOME` / `DSH_PROFILE_DIR`、调用 checkout 交叉检查；固定最小环境、独立 HOME/XDG、无继承凭据，凭据仅能通过 0600 JSON 明确 opt-in；bounded stdout/stderr；POSIX 进程组 timeout / SIGINT / SIGTERM 清理，TERM 后 KILL；严格 NDJSON 生命周期和退出码双重终态。
- `report.mjs`：严格 `session → … → final` 解析；缺 final、重复 final、final 后事件、坏 JSON、超长行、错误 session identity 都是 protocol error；提取 `DeliveryRunV3` 公开投影、`run.*` 事件、单位依赖 DAG、timeline、usage 和 metrics。`processCompleted` 与 `business.accepted` 分离，未知 usage/cost/cache 为 `null`。
- `runner.mjs`：可选、独立、显式批准的 Docker runner。校验 `RunnerRequestV1` candidateFiles 的 sha256/bytes 与 opaque candidateHash，固定 `RunnerConfigV1` image digest / network none / resources / allowlisted executable / outputRoot / journeyArgv；Docker 只读 candidate、受限 writable output、read-only root、no-new-privileges、cap-drop、tmpfs、资源上限；compile 失败使 journey 为 `unknown`；每个支持的 check 精确一条 `pass|fail|unknown`，回显 nonce/candidate 绑定。
- `matrix.mjs`：只生成可复现 seeded randomization plan，不自动执行模型、浏览器或进程。
- 文档：README、验证批准计划、执行计划更新，明确临时 DSH_HOME 不是 OS 安全边界、真实运行/容器/browser/compiler 需单独批准。

## 已执行且通过

- `node --check research/multiagent/experiment-base/driver.mjs`（exit 0）
- `node --check research/multiagent/experiment-base/report.mjs`（exit 0）
- `node --check research/multiagent/experiment-base/runner.mjs`（exit 0）
- `node --check research/multiagent/experiment-base/matrix.mjs`（exit 0）

## 未执行

没有安装插件、没有修改共享 profile、没有启动真实 DSH/headless、没有调用模型或 Playwright、没有执行 Docker/browser/compiler/网络、没有运行测试、没有产生真实账单。静态检查只证明 JS 语法；不证明 DSH Loader 装载、真实 runner image、模型/浏览器行为、OS 级隔离、成本或生产验收。
