# 插件内架构

> 本文只约束 `packages/dsh-workspace-ide` 内部结构。产品背景、选型依据、界面形态见 [MINI-VSCODE-PLAN.md](docs/MINI-VSCODE-PLAN.md) 与 `plan/全方案.md`。

## 一句话定位

DSH 的一个**右栏工作台插件**：它是右栏（rightbar）的一个宿主 tab；内部左栏是文件/搜索，工作区是可分栏的标签页（文件、diff、提交图谱、当前改动、仓库、命令），底部是真 PTY 终端。
它**不注册任何模型工具**，不参与会话对话——纯人用工作台；数据全部来自 Host（文件系统 + `git` CLI + PTY），浏览器只做渲染与交互。

## 依赖方向

```text
DSH ModuleLoader（window.__ModuleLoader__.load）
  └─ frontend/index.js  apply(ctx)                     ← 唯一入口，只做接线与资源注册
       ├─ ctx.sidebarRightTabs.register({ id, kind, keepMounted, guide }) → 右栏 tab 类型
       ├─ ctx.slots.register('sidebar.right.pane.tab', key=id) → views/WorkbenchHost
       └─ ctx.remote.$mount(remoteInfo)                    → Host service

views/*.tsx ──使用──> stores/*.stores.ts ──调用──> stores/*.datasource.ts ──Remote──> backend/service.js
    │                        │                              │
    │                        └──── 纯投影自 Host snapshot ───┘
    └──── 只读 props/selector ──────────────────────────────> frontend/service/*（纯函数：路径、键位、diff 文案、语言探测、终端通道）

Host 侧：
backend/index.js  apply(ctx)  ← export name/inject
  ├─ backend/contract.js     ← shared/contract.js（zod 双端共享）
  ├─ backend/service.js      ← 动作分发、根目录与 repositoryPath 校验、请求上下文、并发闸门
  ├─ backend/workspace.js    ← 根目录解析与切换、仓库请求上下文、限制参数
  ├─ backend/files.js        ← 按行读、版本化写、目录懒加载、重命名/删除
  ├─ backend/search.js + search-worker.js + search-globs.js ← Node Worker 文件索引 / 全文扫描与统一 ignore / glob
  ├─ backend/git/{exec,status,log,layout,diff,write,stash,watch}.js
  └─ backend/terminal.js     ← subprocess.spawnTerminal + 环形缓冲 + 游标

shared/contract.js + shared/languages.generated.js   ← 两端唯一共享面：wire schema 与纯数据表，无环境依赖
```

**禁止**：浏览器导入 `backend/**`；`views` 直接 import `datasource`；`stores` 直接 import `backend`；任何前端文件 import `@deepseek-ai/*` 的 client 包（见 AGENTS.md）。

## 进程与线程模型

| 角色 | 位置 | 说明 |
| --- | --- | --- |
| UI | 浏览器主线程 | React + CM6 + xterm。所有长任务（git、目录遍历、搜索）都不在此线程，除 CM6 自身解析（视口切片） |
| 数据中枢 | Host（Node 主进程） | Remote 动作在此校验与排队；Host 侧访问文件系统、`git`、PTY，搜索文件读取交给受限 Node Worker |
| git 子进程 | Host spawn | 每仓库一条**串行队列**（读操作可并发 ≤2，写操作独占）；超时可取消（`kill` + `SIGKILL` 兜底） |
| 终端 PTY | Host `subprocess.spawnTerminal` | 每终端一条字节流 → 环形缓冲（默认 512 KB）→ 字符游标 |
| 搜索 Worker | Host `node:worker_threads` | 文件索引与全文扫描共用遍历 / ignore / glob 规则，工作线程限内存与时间；超时终止并返回部分结果和警告 |
| 布局计算 | Host | 提交图谱的 lane 布局在 `backend/git/layout.js` 计算，wire 只传紧凑行数据（见 remote-contract §git.graph） |

浏览器不引入 Worker，CM6 仍做增量解析；Host 搜索使用 Node Worker 隔离目录遍历、文本读取与正则匹配。搜索不调用 git / rg 子进程，Worker 在超时或 dispose 时终止；进度快照用于受限扫描的可见反馈。

## 状态所有权

| 域 | 唯一持有内容 | 不持有 |
| --- | --- | --- |
| `workspace` | 根目录、工作区名、限制参数（文件大小阈值、log 页长） | 文件内容、git 状态（各自域持有） |
| `files` | 目录展开态、列表缓存、目录分页与加载态 | 文件正文（编辑器域）、git 状态、Explorer 选择 |
| `explorerSelection` | `selected[]`、`focused`、`anchor` 与当前 surface 菜单；只在已加载且可见的行内选区，切根重置、目录变化后 reconcile | 文件正文、删除事实、重复目录缓存 |
| `quickAccess` | 文件 / 内容 / 命令模式、查询与结果、活动项、过滤偏好、命令 MRU（最多 50 条）、请求 generation 与索引缓存 | Host 文件真相、任意 shell 命令或重复 SCM 状态 |
| `editor` | 打开文件的正文与每文件 `{path,version,dirty,cursor,eol,bom,mode}`、保存/冲突状态 | 标签顺序与分栏归属（`layout` 域）；CM6 只呈现 store 里的文本 |
| `layout` | 内部标签元数据、每组 `{tabs,active}`、分栏树 `{dir,ratio,a,b}`、`activeGroup`、拖拽中间态、组尺寸 | 文件正文、git 事实；树只存结构，组只存 tab id |
| `repositories` | Host 扫描清单、目录折叠、用户跟踪列表与活动仓库；按工作区路径持久化选择，默认空 | Git 业务事实、任意绝对根目录 |
| `commands` | Host 包清单、包路径树、选中包的 scripts、加载态与启动中状态 | shell 执行结果（留在终端）、脚本正文的客户端真相 |
| `ui` | 工作台布局偏好、uiScale、编辑器偏好与浮层呈现态 | 有效换行状态（由 editor/diff 文档派生） |
| `scm` | `git.status` 快照镜像、提交信息草稿、写操作队列可视化、逐文件展开态 | 变更事实（Host 计算）、文件内容 |
| `graph` | `git.graph` 行窗口、滚动锚点、选中提交、refs 徽章、过滤词 | 布局（Host 算）、提交详情（按需拉） |
| `diff` | 当前 diff 视图的目标与解析后 hunk、折叠态 | 原文（Host 出结构化 hunk） |
| `terminal` | 标签（`terminalId`/标题/状态）、每标签 offset 与连接态、面板高度 | 屏幕内容（xterm 自己的 buffer 是唯一呈现；Host 环形缓冲是可重放源） |
| `notice` | 受控确认框（危险操作）、toast、错误条；相同「已保存」info 替换旧成功通知，错误保留独立项 | 业务状态 |

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

### 仓库与命令请求

文件、搜索和普通终端保持工作区根上下文；Git / watch 请求另带工作区相对的 `repositoryPath`（根仓库为 `.`），Host 校验它在工作区内且为自己的 Git 工作树根，再绑定请求局部上下文。watch token 同时绑定会话、工作区和仓库，停止旧 token 使用原绑定；切仓库递增前端 epoch，丢弃旧 Git 响应并重置相关视图。SCM 写操作中不能切换活动仓库。仓库跟踪与活动选择存于 `dsh-workspace-ide:repositories:<encoded-root>`，属于用户呈现偏好，扫描事实来自 Host。

命令页使用 `workspace.scan` 与 `workspace.packageScripts`；`terminal.runScript` 在 Host 重新读取包清单、确认脚本存在并选择 npm / pnpm / yarn / bun。只把固定运行器和正确引用的脚本名交给新终端，cwd 为包目录；脚本命令正文只用于预览，不由浏览器拼接执行。

### 统一快速访问与搜索

工具栏、欢迎页、搜索入口与 `/` 命令共用 `quickAccess` 域和同一面板。文件 / 内容过滤偏好分别保存；命令只从静态动作目录选择，支持中文名、英文和拼音首字母，MRU 上限 50，不把查询拼成任意 shell。请求 generation 丢弃过期响应，关闭或切换工作区使旧查询失效；索引缓存按 root 与过滤参数隔离。

文件索引和全文搜索共用 `backend/search.js` 的 Node Worker 扫描器：按真实路径守边界，统一 `.gitignore` / `.ignore`、包含 / 排除 glob；Worker 的 V8 老生代堆上限 128 MB，扫描 / 结果 / 时间均有上限。超时保留最新快照并附警告，插件 dispose 终止线程。前端以加载、无结果、错误、截断与警告分别反馈，不将部分结果伪装成完整扫描。

Explorer 的目录分页与搜索索引分开：文件树只展现已展开、已加载的行；选择域维护多选、焦点与锚点，批量动作由 workbench 编排。文件栏收起只改呈现标志，不把宽度写成 0。

全视图在开放 ShadowRoot 内 portal 工作台与样式，使用 92% frame 对话框、主题 token 和独立 reset 抵御宿主按钮等全局规则；共享会话 stores，展示面重新挂载不等于业务数据丢失。

## 硬边界（DSH 集成契约）

| 项 | 要求 |
| --- | --- |
| 渲染面 | `sidebar.right.pane.tab` keyed slot（session 作用域）承载右栏工作台；`shell.overlay` list 席位承载 frame 级宽高各 92% 的 ShadowRoot 全视图；两者共享同一会话 runtime。不注册 `main`、不调用 `selectPanel` |
| 可见性 | 每个 runtime 维护 surface 集合（`sidebar` / `overlay`）：任一可见即保持 activate；全部不可见才停 watch/轮询。关闭宿主 tab 只移除 `sidebar`，不暂停仍打开的全视图 |
| 入口 | `ctx.sidebarRightTabs.register` 的 `guide` 卡片（右栏开始页）；**没有** `sidebar.panellist` 左栏图标，也**不绑默认快捷键**（命令以 `defaults:{}` 注册，键位在设置页「工作台」分区内录制） |
| 根目录 | 按会话解析：该会话手动选择 > `session.header.cwd` > lastRoot；Host 决策，wire 不放任意路径。每个 Remote 请求在 Service 入口绑定 `{sessionId, root}` 并跑在 `AsyncLocalStorage` 里，files/git/terminal/watch 只读活动上下文，不共享可变 `current` |
| 主题 | 只用 `--dsw-alias-*` / `--dsw-*` token；禁硬编码色值（构建期扫描）；明暗两套都要过 |
| 顶栏/左缘 | 右栏 body 不在窗口顶/左缘，**不**吃 `--dsh-frame-top-clearance` / `--dsh-frame-leading-clearance`；宿主 tab 条已经处理 |
| 字号与缩放 | 编辑器 / Diff 共用 10–20px 字号偏好；正文 / 终端沿用宿主 token。整个 `.wid-root` 的 uiScale 是 50–200 之间手填的整数百分比（默认 100），独立于编辑器字号；这些偏好与快捷键录制都由宿主设置页的 `settings.section`（`dsh-workspace-ide`，label「工作台」，order 30）承载，浮层与拖拽坐标先换算为逻辑像素 |
| 外部依赖 | 不 require 任何 `@deepseek-ai/*` client 包；`react`/`react-dom` 由宿主提供（external） |
| 资源 | 不打包独立 CSS 文件（内联进 JS 后运行时注入 `<style id="dsh-workspace-ide/css">`）；不依赖图片资源路由 |
| 卸载 | 所有注册（slot、remote mount、listener、定时器、CM6/xterm 实例、Host 侧终端与 git 队列）都挂在 `ctx.effect` 的 disposer 上 |
| 无工具 | 不给模型注册 tool；不写 session event；不读 session log |

## 生命周期

| 阶段 | 行为 |
| --- | --- |
| 插件 apply | 注册右栏 tab 类型 + body；每个会话首次渲染时构建 stores（不启动 IO）；`ctx.remote.$mount` 挂载 Remote |
| tab 首次可见 | `workspace.resolve { sessionId }` → 无根目录显示欢迎页；有则扫描仓库 / 包、`files.list(root)` + 恢复该会话的标签/分栏布局；只为恢复后的活动仓库加载 Git 状态 |
| tab 不可见（切会话 / 收起右栏） | body 由 `keepMounted` 保留；**停 watch/轮询/window 监听**；编辑器正文在 store 里，终端 PTY 继续跑 |
| tab 再次可见 | `workspace.resolve` 对齐 Host 工作区根 → 对活动仓库刷新 status → 恢复该仓库 watch；编辑器与内部布局原样 |
| tab 关闭 | 宿主 close handler 只移除 `sidebar` surface；全视图仍可见时 runtime 继续运行。运行时保留到插件卸载（快速重开不丢未保存） |
| 全视图打开/关闭 | 关闭右栏 tab 且保留内部标签/分栏与 store 中的未保存内容；`overlay` surface 加入/移除。展示面可重挂载，两个面共享 stores |
| 插件 dispose | 关闭全部 PTY、取消在途 git 子进程、清空定时器与 listener、解除 Remote、移除 `<style>` |
| 插件 dispose | 关闭全部 PTY（`terminate()`）、取消在途 git 子进程、清空定时器与 listener、解除 Remote、移除 `<style>` |
| 浏览器刷新 | 一切重来；Host 侧孤儿终端由下次 `terminal.list` 对账清理（或 Host 侧空闲超时 30 min 回收） |

## 错误与降级

| 场景 | 表现 |
| --- | --- |
| 系统无 `git` | 面板可浏览/编辑文件，SCM 与图谱页显示「未检测到 git」+ 安装引导；不自动下载 |
| 无活动仓库 | 改动 / 图谱提示到仓库标签勾选并选择；工作区根本身不是仓库不妨碍选择子仓库，不自动初始化 |
| 超大文件 | 分级降级（见 `docs/editor.md`）；超上限只读 + 提示 |
| 超大仓库 | `git.status` 超过 `statusLimitMs` 后置「巨大仓库」：停自动刷新、改手动；图谱分页上限收紧 |
| git 命令失败 | `error.code='E_GIT_FAILED'` + 有限 argv / stderr 摘要与 reason；实际过滤范围见 `docs/security.md` §6 |
| Remote 断连 | 顶部错误条「Host 连接中断」；所有写操作禁用；恢复后重新 `workspace.state` 对齐 |
| 版本冲突 | 保存返回 `E_VERSION_CONFLICT` + `currentVersion`；弹「重新加载 / 强制覆盖」 |

**任何时候都不出现「假装成功」**：没有 mock、没有静默失败、没有把未实现能力渲染成可用按钮（未实现的按钮必须 disabled + tooltip 说明）。

## 性能预算（验收口径）

| 指标 | 目标 |
| --- | --- |
| tab 首次可交互 | ≤ 400 ms（不含 git 子进程） |
| 350px 右栏可用 | 无横向滚动；单栏 diff；标签行不折行 |
| `git.status`（1 万文件、干净） | ≤ 150 ms |
| `git.graph` 首页 2000 条 | ≤ 250 ms（含 Host 布局） |
| 打开 1 MB 文件 | ≤ 120 ms 首屏 |
| 打开 8 MB 文件 | ≤ 400 ms 首屏（关高亮） |
| 目录列表 2000 项 | ≤ 80 ms |
| 终端输入回显 | ≤ 60 ms（120 ms 轮询下 p95） |
| 客户端 bundle | ≤ 20 MB gzip，硬断言 |
| 面板常驻内存（Host 侧） | 终端 512 KB/条 + git 输出上限 32 MB/次 |

## 静态约束（构建期检查，`scripts/check.mjs`）

1. `frontend/**` 不得 import `@deepseek-ai/*`、`backend/**`、`node:fs`、`node:child_process`。
2. `frontend/views/**` 不得 import 任何 `*.datasource`（只能经 store）；不得出现 `useState(` / `useReducer(`。
3. `backend/**` 不得 import `frontend/**`、`react`、`react-dom`。
4. `frontend/**` 与 `styles` 中不得出现 `#[0-9a-fA-F]{3,8}` / `rgb(` 字面量（`--dsw-*` token 与 `transparent`/`currentColor` 除外）。
5. 客户端 bundle 体积断言 + 不得含浏览器 `new Worker(` / `importScripts(` / `.wasm`；Host 搜索的 Node Worker 单独打包并随 service 释放。
6. `shared/**` 不得 import 任何带环境依赖的模块（只允许纯数据与 zod）。
7. `frontend/**` 不得出现 `position: fixed`（右栏工作台的浮层必须相对 `.wid-root` 定位）。
8. 分栏树/拖拽的纯函数放 `frontend/service/{split,dnd}.js`；标签归属只写在 `layout` 域，`views` 不自行排序/分组。

## 与其它包的关系

- 终端实现**复制**自 `packages/dsh-plugin-dev-sandbox`（`backend/manager.js` 的 PTY 通道与 `frontend/.../TerminalView.js`），**不共享模块**、不改动该包；未来若都稳定可再抽公共包（独立决策）。
- 不改动仓库根 `build` 脚本、`marketplace.json` 之外的任何现有包。
- 图标为独立 `icon.svg`（面板图标直接内联 SVG 组件，不复用宿主的 `sidebar.panel.icon` factory）。
