# dsh-delivery-orchestrator

独立、默认关闭的 DSH Host/Client bundle，用于按独立交付线编排需求、持久化状态和受信验收边界。

> 调试/无头实例的隔离规则、目录命名与运行协议见 [agents.md](agents.md)。`DEV-WORKSPACES/` 仅用于隔离调试，整体被 git 忽略。

## 生产隔离

本包**不会自动安装、启用或修改任何 DSH profile**，也不在仓库根目录默认 build 链中。只有在显式 `enabled=true`、`DSH_DELIVERY_ISOLATED=1` 且 `isolationRoot === DSH_HOME` 时才注册 Host 命令；插件拒绝使用 `~/.dsh` 及其后代，并要求工作目录位于专用 isolationRoot 内。默认配置是关闭的。Client 入口只有在该 bundle 被单独安装到隔离 profile 后才会加载。

## Host 能力

- `delivery-run`：把一条原始需求锁定为版本化 `DeliveryRunV3`、需求映射、独立 units、接口和验收卡，并持久化到 storage-domain。
- `delivery-status`：只读调用身份所拥有的 run、units、阻塞原因、候选/快照/判定投影和 append-only events。
- `delivery-checkpoint`：为所属 unit 写入 `ready_for_acceptance` checkpoint；只入队，不把模型自报当成通过。
- `delivery-resume`：恢复所属 run；未配置可信角色路由、subagent 或 Runner/Scenario/Judge adapter 时，持久化 `BLOCKED`，绝不伪造候选、证据或 PASS。
- `delivery-cancel`：取消所属 run；不会删除已公开的不可变制品。
- `delivery-export`：导出所属 run 的完整脱敏投影。

Host 通过 `storageDomain` 持久化 ledger，使用内容地址化候选目录和非重叠写租约校验；失败的持久化转换不会静默回退到内存。状态更新通过只读 Typert `status/watch` 远程面，Client 使用宿主 ModuleLoader 和 slot，仅订阅事件，不轮询。

## 受信验收边界

插件只允许版本化 `SpecV1`、`CardV1`、候选和 `ScenarioV1` 契约：需求必须能回溯到原文，写范围不得重叠，依赖图不得成环，软件线必须包含 compile 与真实 journey 检查，journey DSL 禁止任意 JS/shell/外域跳转。真实编译、浏览器、CLI、数据和 Judge 由明确配置的受信 adapter 执行；没有 adapter 时结果是 `BLOCKED`/`NO_DECISION`，不是成功。

## 插件外实验底座

插件不启动 headless、不生成 HTML、不做实验统计，也不调用 Playwright。外部底座位于 [`research/multiagent/experiment-base/`](../../research/multiagent/experiment-base/)，负责隔离 DSH supervisor、严格 NDJSON、DeliveryRunV3 证据报告、seeded matrix 和显式批准的 Docker runner。Headless、模型、浏览器、Docker、网络和账单均不属于本次静态交付。

## 构建

```sh
pnpm --dir packages/dsh-delivery-orchestrator run build
```

`lib/` 是从 `src/` 生成的产物，不要手工编辑。根目录默认构建未包含本包；如需验证，请从该目录显式构建。
