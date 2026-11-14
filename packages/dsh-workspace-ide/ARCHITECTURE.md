# 插件内架构

> 本文只约束 `packages/dsh-workspace-ide` 内部结构。产品背景、选型依据、界面形态见根目录 [MINI-VSCODE-PLAN.md](../../MINI-VSCODE-PLAN.md) 与 `plan/全方案.md`。

## 一句话定位

DSH 的一个**全局面板插件**：左栏文件树、中栏 CM6 编辑器与 diff、右栏（可停靠）SCM 与提交图谱、底部真 PTY 终端。
它**不注册任何模型工具**，不参与会话对话——纯人用工作台；数据全部来自 Host（文件系统 + `git` CLI + PTY），浏览器只做渲染与交互。

## 依赖方向

```text
DSH ModuleLoader（window.__ModuleLoader__.load）
  └─ frontend/index.js  apply(ctx)                     ← 唯一入口，只做接线与资源注册
       ├─ ctx.slots.register('main', key='workspace-ide')  → views/Workbench
       ├─ ctx.slots.register('sidebar.panellist', id=…)    → views/Icon
       └─ ctx.remote.$mount(remoteInfo)                    → Host service

views/*.tsx ──使用──> stores/*.stores.ts ──调用──> stores/*.datasource.ts ──Remote──> backend/service.js
    │                        │                              │
    │                        └──── 纯投影自 Host snapshot ───┘
    └──── 只读 props/selector ──────────────────────────────> frontend/service/*（纯函数：路径、键位、diff 文案、语言探测、终端通道）

Host 侧：
backend/index.js  apply(ctx)  ← export name/inject
  ├─ backend/contract.js     ← shared/contract.js（zod 双端共享）
  ├─ backend/service.js      ← 动作分发、根目录校验、信任门禁、并发闸门、写队列
  ├─ backend/workspace.js    ← 根目录解析与切换、信任状态、限制参数
  ├─ backend/files.js        ← 按行读、版本化写、目录懒加载、重命名/删除
  ├─ backend/search.js       ← ripgrep / 系统 rg / 纯 JS 降级
  ├─ backend/git/{exec,status,log,layout,diff,write,stash,watch}.js
  └─ backend/terminal.js     ← subprocess.spawnTerminal + 环形缓冲 + 游标

shared/contract.js + shared/languages.generated.js   ← 两端唯一共享面：wire schema 与纯数据表，无环境依赖
```

**禁止**：浏览器导入 `backend/**`；`views` 直接 import `datasource`；`stores` 直接 import `backend`；任何前端文件 import `@deepseek-ai/*` 的 client 包（见 AGENTS.md）。

## 进程与线程模型

| 角色 | 位置 | 说明 |
| --- | --- | --- |
| UI | 浏览器主线程 | React + CM6 + xterm。所有长任务（git、目录遍历、搜索）都不在此线程，除 CM6 自身解析（视口切片） |
| 数据中枢 | Host（Node 主进程） | 唯一能碰文件系统、`git`、PTY 的地方；Remote 动作同步/异步都在此处排队 |
| git 子进程 | Host spawn | 每仓库一条**串行队列**（读操作可并发 ≤2，写操作独占）；超时可取消（`kill` + `SIGKILL` 兜底） |
| 终端 PTY | Host `subprocess.spawnTerminal` | 每终端一条字节流 → 环形缓冲（默认 512 KB）→ 字符游标 |
| 布局计算 | Host | 提交图谱的 lane 布局在 `backend/git/layout.js` 计算，wire 只传紧凑行数据（见 remote-contract §git.graph） |

不引入 worker：CM6 的解析是视口切片 + 增量，实测 10 MB 文件滚动可用；真正的重活（git/目录/搜索）已经天然在 Host。

## 状态所有权

| 域 | 唯一持有内容 | 不持有 |
| --- | --- | --- |
| `workspace` | 根目录、仓库名、信任状态、限制参数（文件大小阈值、log 页长） | 文件内容、git 状态（各自域持有） |
| `files` | 目录展开态与列表缓存、选中/焦点、排序与过滤、文件图标映射 | 文件正文（编辑器域）、git 状态 |
| `editor` | 打开标签、每标签 `{path,version,dirty,scroll,cursor,eol,bom,largeMode}`、保存/冲突状态 | 文件正文的第二份真相（正文在 CM6 `EditorState`，只有 dirty/version 回镜像到 store） |
| `scm` | `git.status` 快照镜像、提交信息草稿、写操作队列可视化、逐文件展开态 | 变更事实（Host 计算）、文件内容 |
| `graph` | `git.graph` 行窗口、滚动锚点、选中提交、refs 徽章、过滤词 | 布局（Host 算）、提交详情（按需拉） |
| `diff` | 当前 diff 视图的目标与解析后 hunk、折叠态 | 原文（Host 出结构化 hunk） |
| `terminal` | 标签（`terminalId`/标题/状态）、每标签 offset 与连接态、面板高度 | 屏幕内容（xterm 自己的 buffer 是唯一呈现；Host 环形缓冲是可重放源） |
| `notice` | 受控确认框（危险操作）、toast、错误条 | 业务状态 |

**规则**：

1. `views` 不持业务状态（禁 `useState`/`useReducer`；`useRef` 只用于 DOM 与焦点、以及 CM6/xterm 实例句柄）。
2. 每域一个 `*.stores.ts`（Zustand vanilla）+ 一个同名 `.datasource.ts`；**IO 只经 datasource**。
3. 跨域编排只有一处：`stores/workbench.stores.ts`（打开文件→新标签、选中变更→出 diff、切分支→刷新 status+graph）。
4. 记录型实体（标签、终端）在 store 里只存**ID 与元数据**，实体数据按需向 Host 取。
5. `git.status` / `git.graph` / `files.list` 的响应带 `seq`（单调递增）或 `version`；**旧 seq 的响应必须丢弃**，防止乱序回写。

## 数据流

```text
用户操作 → view 事件 → workbench.stores 用例 → 域 datasource → Remote execute(action,payload)
                                                              ↓
                                                    backend/service 分发
                                                              ↓
                                        { ok, data:{…, seq|version} } 或 { ok:false, error:{code,…} }
                                                              ↓
                                       域 store 应用（校验 seq）→ selector → 视图重绘
```

- **Host 是唯一真相**：客户端不做「猜测式更新」，只做**乐观 UI**（标签高亮、终端 tab 关闭、输入框草稿），失败即回滚并出错误条。
- **刷新触发**：用户显式动作（保存、stage、切分支…）→ 立即刷新；面板获得焦点 / 窗口重新可见 → 刷新一次；P0 每 1.5 s 轮询 `git.status`（仅当面板可见且非写操作中）；P1 换 `watch` 推送。

## 硬边界（DSH 集成契约）

| 项 | 要求 |
| --- | --- |
| 渲染面 | `main` keyed slot，`key='workspace-ide'`；不占用 `conversation` key；**拿不到 sessionId**（`scope:'root'`），根目录自行解析 |
| 侧栏入口 | `sidebar.panellist` list 项 `{ id:'workspace-ide', order, label }`；点击即 `ctx.layout.selectPanel('workspace-ide')` |
| 主题 | 只用 `--dsw-alias-*` / `--dsw-*` token；禁硬编码色值（构建期扫描）；明暗两套都要过 |
| macOS 顶栏 | 主面板根元素 `padding-top: var(--dsh-frame-top-clearance, 0px)`；左侧用 `--dsh-frame-leading-clearance` |
| 字号 | 代码 = `var(--dsh-code-font-size)`、正文 = `var(--dsh-content-font-size)`、终端 = `var(--dsh-terminal-font-size)` |
| 外部依赖 | 不 require 任何 `@deepseek-ai/*` client 包；`react`/`react-dom` 由宿主提供（external） |
| 资源 | 不打包独立 CSS 文件（内联进 JS 后运行时注入 `<style id="dsh-workspace-ide/css">`）；不依赖图片资源路由 |
| 卸载 | 所有注册（slot、remote mount、listener、定时器、CM6/xterm 实例、Host 侧终端与 git 队列）都挂在 `ctx.effect` 的 disposer 上 |
| 无工具 | 不给模型注册 tool；不写 session event；不读 session log |

## 生命周期

| 阶段 | 行为 |
| --- | --- |
| 插件 apply | 注册 slot + 面板图标；构建 stores（不启动任何 IO）；`ctx.remote.$mount` 挂载 Remote |
| 面板首次打开 | `workspace.resolve` → 若无根目录显示空态引导（「打开文件夹」）；有则 `git.status` + `files.list(root)` + `git.graph(firstPage)` |
| 面板关闭（切回对话） | 保留 stores；**停轮询**；CM6 实例保留但不再 layout；终端继续跑（Host 侧 PTY 存活） |
| 面板重新打开 | 恢复滚动与标签；刷新一次 status；终端重新 attach（按 `offset` 续读 + `terminal.list` 对账回收孤儿终端） |
| 插件 dispose | 关闭全部 PTY（`terminate()`）、取消在途 git 子进程、清空定时器与 listener、解除 Remote、移除 `<style>` |
| 浏览器刷新 | 一切重来；Host 侧孤儿终端由下次 `terminal.list` 对账清理（或 Host 侧空闲超时 30 min 回收） |

## 错误与降级

| 场景 | 表现 |
| --- | --- |
| 系统无 `git` | 面板可浏览/编辑文件，SCM 与图谱页显示「未检测到 git」+ 安装引导；不自动下载 |
| 目录不是 git 仓库 | 同上，SCM 显示「初始化仓库」按钮（显式确认后 `git init`） |
| 未信任目录 | 只读：打开/查看/diff 可用；编辑保存、stage、commit、终端里也不代表安全——终端需显式确认才创建 |
| 超大文件 | 分级降级（见 `docs/editor.md`）；超上限只读 + 提示 |
| 超大仓库 | `git.status` 超过 `statusLimitMs` 后置「巨大仓库」：停自动刷新、改手动；图谱分页上限收紧 |
| git 命令失败 | `error.code='E_GIT_FAILED'` + 过滤后的 stderr（去路径噪声）+ 可展开的完整命令（脱敏） |
| Remote 断连 | 顶部错误条「Host 连接中断」；所有写操作禁用；恢复后重新 `workspace.state` 对齐 |
| 版本冲突 | 保存返回 `E_VERSION_CONFLICT` + `currentVersion`；弹「重新加载 / 强制覆盖」 |

**任何时候都不出现「假装成功」**：没有 mock、没有静默失败、没有把未实现能力渲染成可用按钮（未实现的按钮必须 disabled + tooltip 说明）。

## 性能预算（验收口径）

| 指标 | 目标 |
| --- | --- |
| 面板首次可交互 | ≤ 400 ms（不含 git 子进程） |
| `git.status`（1 万文件、干净） | ≤ 150 ms |
| `git.graph` 首页 2000 条 | ≤ 250 ms（含 Host 布局） |
| 打开 1 MB 文件 | ≤ 120 ms 首屏 |
| 打开 8 MB 文件 | ≤ 400 ms 首屏（关高亮） |
| 目录列表 2000 项 | ≤ 80 ms |
| 终端输入回显 | ≤ 60 ms（120 ms 轮询下 p95） |
| 客户端 bundle | ≤ 1.2 MB gzip，硬断言 |
| 面板常驻内存（Host 侧） | 终端 512 KB/条 + git 输出上限 32 MB/次 |

## 静态约束（构建期检查，`scripts/check.mjs`）

1. `frontend/**` 不得 import `@deepseek-ai/*`、`backend/**`、`node:fs`、`node:child_process`。
2. `frontend/views/**` 不得 import 任何 `*.datasource`（只能经 store）；不得出现 `useState(` / `useReducer(`。
3. `backend/**` 不得 import `frontend/**`、`react`、`react-dom`。
4. `frontend/**` 与 `styles` 中不得出现 `#[0-9a-fA-F]{3,8}` / `rgb(` 字面量（`--dsw-*` token 与 `transparent`/`currentColor` 除外）。
5. bundle 体积断言 + 不得含 `new Worker(` / `importScripts(` / `.wasm`。
6. `shared/**` 不得 import 任何带环境依赖的模块（只允许纯数据与 zod）。

## 与其它包的关系

- 终端实现**复制**自 `packages/dsh-plugin-dev-sandbox`（`backend/manager.js` 的 PTY 通道与 `frontend/.../TerminalView.js`），**不共享模块**、不改动该包；未来若都稳定可再抽公共包（独立决策）。
- 不改动仓库根 `build` 脚本、`marketplace.json` 之外的任何现有包。
- 图标为独立 `icon.svg`（面板图标直接内联 SVG 组件，不复用宿主的 `sidebar.panel.icon` factory）。
