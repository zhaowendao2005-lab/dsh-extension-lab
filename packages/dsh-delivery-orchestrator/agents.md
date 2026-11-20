# 调试规则（dsh-delivery-orchestrator）

本文件只约束**调试**行为，不改变插件面向用户的正式契约。正式契约见 `README.md`。

## 1. 隔离边界（硬性）

- 调试实例只能放在 `DEV-WORKSPACES/` 下。禁止修改、安装、启用或停止用户生产 profile（`~/.dsh`、`~/Library/Application Support/DSH` 等一切默认位置）。
- 每个调试实例自带独立 `DSH_HOME`（`<实例>/dsh-home`），并通过 `DSH_DELIVERY_ISOLATED=1` 让插件门禁放行；同时把 `HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`XDG_DATA_HOME`、`TMPDIR` 都指向实例内部（`<实例>/home`）。
- **默认工作区必须显式重定向**：DSH 从操作系统“文稿”目录解析默认工作区（macOS 为 `~/Documents/deepseek-harness/default-workspace`），该路径不受 `HOME`/`DSH_HOME` 影响。因此每个实例的 profile patch 必须包含：
  ```yaml
  - id: workspace-controller
    config:
      documentsDirectory: '<实例>/docs'
  ```
  默认工作区随之变为 `<实例>/docs/deepseek-harness/default-workspace`。**漏掉这一行就等于把会话写进用户生产工作区**；启动前必须 `dsh --profile <p> --dump-config | grep -A3 'id: workspace-controller'` 复核。
- 启动后必须验证：会话工作区落在 `<实例>/docs/...` 内，且 `/Users/qihoo/Documents/deepseek-harness/default-workspace` 的修改时间未变化。
- 调试产生的会话、存储、日志、浏览器缓存、虚拟环境只存在于实例目录内。实例可以被整体删除，删除不影响其它实例和生产环境。

## 2. 目录与命名

目录根：`packages/dsh-delivery-orchestrator/DEV-WORKSPACES/`。

实例目录名格式：

```
<8 字标题>-<无头 dsh 主模型名>-<YYYYMMDDThhmm>
```

- 标题恰好 8 个汉字/字符（例：`小说爬虫全栈平台`）。
- 模型名取无头实例实际使用的默认模型（例：`deepseek-v4.1-flash`）。
- 时间戳为实例创建时刻（本地时间，`T` 分隔，精确到分钟；同一分钟内重复创建则追加 `-2`、`-3`）。

实例内固定结构：

```
<实例>/
├── docs/                              # documentsDirectory：DSH 默认工作区根
│   └── deepseek-harness/default-workspace/
│       ├── workspace/                 # 被测真实项目（应用代码、依赖、构建产物）
│       ├── recon/                     # 侦查资料：截图、页面文本、抓包、笔记
│       ├── runs/                      # 调用 stdout/stderr/meta、验收证据
│       ├── TASK-PROMPT.md             # 交给实例代理的任务书
│       └── TASK-BUILD.md              # 构建与验收规格
├── home/                              # HOME/XDG/TMPDIR，浏览器与工具缓存
└── dsh-home/                          # 独立 DSH_HOME（profiles、sessions、storages、凭据副本）
```

有头（`--profile web`）与无头（`--profile headless`）共用同一套目录约定，只是 profile 与启动参数不同：

- 有头：`dsh --profile web --port <端口> --host 127.0.0.1 --no-open`，启动时打印带 token 的 URL；不带 token 访问返回 401。
- 无头：`dsh --profile headless --json ...`，输出 NDJSON。
- 两者都要先 `dsh plugin --profile <p> add link:<包绝对路径>` 安装插件；`file:` 会复制快照，导致后续 `pnpm run build` 不生效。

## 3. 无头调用协议

- 一律通过 `dsh --profile headless` 调用；模型默认由实例 `dsh-home/profiles/headless/cordis.patch.yml` 的 `agent-default-model` 决定。
- 每次调用必须落盘：
  - `runs/<序号>-<用途>-stdout.ndjson`（`--json` 输出）
  - `runs/<序号>-<用途>-stderr.log`
  - `runs/<序号>-<用途>-meta.json`：开始/结束时间、退出码、`final.reason`、命令、cwd、模型
- 判定成功的条件：退出码 0 **且** 存在 `final` 事件且 `reason.kind === "completed"`，并且目标产物能被独立复查。缺少 `final` 记为 `NO_FINAL`，不得声称完成。
- 需要续跑时用 `--session-id <id>`，不要新建会话重复劳动；需要新会话时在 meta 中记录原因。

## 4. 插件使用

- 插件通过 `link:` 装进实例 profile（`dsh-home/profiles/headless/package.json`），改完 `src/` 后必须 `pnpm run build`（`lib/` 为生成物，禁止手改）。
- 无头实例默认 `routes` 为空：`/delivery-run` 会以 `ROLE_ROUTE_UNCONFIGURED` 阻断，这是预期行为；调试编排需要先在实例 patch 的插件 config 里显式配置 provider/model 路由与 `runnerApproved`。
- 只要实例仍是隔离的，插件就不得被用来改动生产 profile。

## 5. 侦查与外部访问

- 侦查以只读为主：截图、取 HTML/文本、记录 URL 与时间。需要登录或提交表单时先在计划里写明。
- Playwright 浏览器使用系统缓存（`~/Library/Caches/ms-playwright`，只读），禁止在实例内重新下载整套浏览器，除非确认缺失。
- 遵守目标站点条款与 robots；抓取并发默认低值，重试有上限。生产爬虫的并发参数必须由设置页显式配置。

## 6. 进程与清理

- 不保留长期后台服务：调试结束（或本轮结束）前停止 dev server、爬虫 worker、浏览器守护进程。
- 占用端口前先检查；结束后确认端口已释放。
- 失败与半成品必须留在 `runs/` 与 `recon/` 里作为证据，不删除、不美化。

## 7. 提交与忽略

- `DEV-WORKSPACES/` 整体被 `.gitignore` 忽略（见 `DEV-WORKSPACES/.gitignore`）；其中可能含凭据副本与用户数据，绝不提交。
- 插件自身（`src/`、`lib/`、`package.json`、`integration/`、`locale/`）是交付物，正常纳入版本管理；`node_modules/`、`lib/` 之外的构建缓存不入库（以包内 `.gitignore` 为准）。
