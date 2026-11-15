# 小号 VS Code（文件工作台）DSH 插件 · 技术与实施策划

> **状态（2026-11-13）**：调研完成，范围定为 **M0–M4（36–46 人日）**；当前阶段 = **补全工程文档**，代码未开始。
> 实施依据是 `packages/dsh-workspace-ide/` 下的文档集（见 §8.1），本文保留选型论证与阶段计划。
>
> 目标：在 DSH 里做一个「小号 VS Code」——只保留三件事：**源代码管理（含 SourceGit 风格提交图谱）+ 基本 git 操作**、
> **高性能文件查看/编辑/高亮**、**真终端**。根目录 = 当前工作区目录。
> 结论：**可行，且不必从零发明关键部件**——图谱布局、终端、git 解析各有可直接复用/移植的现成件，
> 真正的工程量集中在「SCM 数据模型与刷新」「编辑器与文件通道」「面板 UI」三块。

| 结论 | 内容 |
| --- | --- |
| 渲染面 | 第三方插件可注册**全局面板**（`main` slot）+ 侧栏图标（`sidebar.panellist`），插件管理器页就是先例 |
| 编辑器 | **CodeMirror 6 + Lezer**（全量 13 语言 + merge + 主题实测 1025 KB min / ≈320 KB gzip，**零 worker / 零 CSS 资产 / 零动态 import**） |
| 提交图谱 | **自研 lane 布局（移植 `git-graph-plus` 的 `git-graph-builder.ts`，Apache-2.0）+ 自绘 SVG + 固定行高虚拟滚动**；`@gitgraph/*`、`vscode-git-graph` 源码均不可用（前者归档且不吃外部 DAG，后者许可证禁止分发衍生） |
| git 后端 | **spawn 系统 `git` CLI + 自写薄封装**（≈1.2–1.5k 行，照 VS Code `extensions/git/src/git.ts` 的做法）；`status --porcelain=v2 -z` 为唯一状态入口 |
| 终端 | 复用本仓库 `dsh-plugin-dev-sandbox` 已验证的 **`subprocess.spawnTerminal` 真 PTY + xterm 6 + offset 轮询**（不是官方 `ctx.webTerminals`，那个的 hold 会被官方侧栏抢占） |
| 文件通道 | 自建 Host Remote（读写/search/写盘版本校验），不借只读的 `workspaceFiles` |
| 总体量 | **≈30–38 人日**做到 P0+P1（不含网络类 git 操作等 P2）；若只求「能用的 P0」约 **18–22 人日** |

---

## 1. 需求边界

### 1.1 用户要的三块

| # | 需求 | 本次答复 |
| --- | --- | --- |
| A | 如图的**源代码管理**面板 + **提交图谱**，根目录 = 工作区目录，提供**基本 git 功能**；「最好找现成的，量很大」 | 除官方 GitHub 先例外无可直接接入的「多泳道 + 虚拟滚动 + 可定制」组件，但**布局算法有现成件可移植**，数据面全部用 git CLI（详见 §4.2 / §5） |
| B | **文件查看和编辑 + 高亮**，要求高性能，「和 VS Code 路线差不多」「最好有现成的」 | 用 CM6（现成、MIT、视口渲染），对齐 VS Code 的「视口渲染 + 增量解析」路线；差异在 **Monaco vs CM6**，已量化比较后选 CM6（§4.1） |
| C | **终端**，参考「插件调试沙箱」插件的实现，「使用现场的」 | 直接复刻该插件的 PTY 通道与 xterm 视图（它就是同一个 profile 里跑着的，代码在本仓库） |

### 1.2 明确不做（避免范围蔓延）

- 不做 LSP / 补全 / 重构 / 调试器（P2 之后另议；CM6 留了接口）。
- 不做插件市场、主题编辑器、扩展宿主。
- 不做 iframe 嵌入方案（违反 DSH `practices.md:33`：iframe 拿不到主题 token / 明暗切换 / locale）。
- 首版**不做网络类 git 操作**（push/pull/fetch/clone）：安全面太大（凭据、CVE 史、企业网络），放到 P2 且默认关闭。

### 1.3 交付形态

- 新包 `packages/<name>`（暂定 `dsh-workspace-ide`，显示名「文件工作台」；名字可改）。
- 入口：侧栏图标 → 全局面板（占据 `main` 区，与「对话」平级，随时可切回）。
- 构建：与仓库现有包一致，`pnpm --dir packages/<name> run build` → 提交 `lib/`。

---

## 2. 界面形态

```
┌───────────────────────────────────────────────────────────────────────┐
│ ⬤⬤⬤  工作台 / Lenovo/dsh-extension-lab        main ↑2 ↓0   ⟳  ⚙  ✕DSH │ ← 标题栏（吃 --dsh-frame-top-clearance）
├──────┬─────────────────────┬──────────────────────────────────────────┤
│ 活动栏│ 侧栏（可折叠/可调宽）│  编辑区（标签页）                          │
│  📁  │ ▾ dsh-extension-lab │  ┌ git.ts ✕ ┬ package.json ✕ ┬ diff ✕ ┐  │
│  ⑂   │   ▾ packages        │  │  1  import { … }                 │  │
│  ⑃   │     ▸ dsh-btw-side  │  │  2                                 │  │
│  >_  │     ▸ …             │  │  3  export function apply(ctx) {   │  │
│  ⟳   │   ▸ research        │  │ …                                 │  │
│      │                     │  └───────────────────────────────────┘  │
│      │                     ├──────────────────────────────────────────┤
│      │                     │  终端 1 │ 终端 2 │ +        问题 0  ✕     │ ← 底部面板（可拖高/收起）
│      │                     │  $ pnpm build                                            │
│      │                     │  built … (xterm 真 PTY)                                  │
├──────┴─────────────────────┴──────────────────────────────────────────┤
│ ⑂ main  ↑2 ↓0   ●  3 个变更    Ln 12, Col 4   TypeScript   UTF-8   ⧉   │ ← 状态栏
└───────────────────────────────────────────────────────────────────────┘
```

三视图（与 VS Code 对齐，**一个面板里切换**，不额外开三个面板）：

| 侧栏视图 | 内容 | 对应需求 |
| --- | --- | --- |
| **资源管理器** | 工作区文件树（虚拟化、懒加载、图标、过滤/搜索入口） | B |
| **源代码管理** | 提交信息输入 + Staged / Changes / Untracked / Conflicts 四组 + 行内 Stage/Unstage/Discard/Diff + 分支切换 | A |
| **提交图谱** | 多泳道 SVG 图 + 提交行（hash/作者/时间/subject/ref 徽章）+ 详情与 diff | A（截图那块） |

侧栏可拖宽、可折叠；编辑区多标签、可切分（P1）；底部面板放终端；右侧可选「详情/diff」栏（P1）。

**DSH 集成规则**（必须遵守）：

- 只用 `--dsw-alias-*` 主题 token，明暗两套都成立（`ctx.theme`）；不硬编码颜色。
- 代码/终端字号读宿主变量：`--dsh-code-font-size`、`--dsh-content-font-size`、`--dsh-terminal-font-size`。
- 主面板顶部用 `--dsh-frame-top-clearance`（macOS 48px）留出红绿灯带，照抄插件管理器页。
- 不 import 任何 `@deepseek-ai/dsh-client-ui-*` 包；控件自己写、类名加 `dw-` 前缀（`practices.md:35`）。
- 文案走 `ctx.locale.register(NS, {zh,en,…})`。

---

## 3. 架构

### 3.1 包内分层（照本仓库既有约定）

```
packages/dsh-workspace-ide/
├─ package.json                 # type=module, exports ./lib/index.js + ./lib/client.js
│                               # dsh.manifestVersion/bundle.patch/client{platform:web,inject}
├─ scripts/build.mjs            # 照 dsh-plugin-dev-sandbox：backend 原样拷贝 + esbuild iife 单文件 client.js
├─ integration/cordis.patch.yml # - insert: [{ id, name }]
├─ backend/                     # Host 侧（Node，可 spawn git / PTY / 读写文件）
│  ├─ index.js                  #   export name/inject/apply；只做接线
│  ├─ contract.js               #   zod requestSchema + Typert Remote 描述符
│  ├─ service.js                #   服务类：动作分发、路径校验、信任门禁、串行队列
│  ├─ workspace.js              #   根目录解析/切换、workspace trust、忽略规则
│  ├─ files.js                  #   读（按行分页）/写（版本校验）/新建/删除/重命名/stat
│  ├─ search.js                 #   ripgrep（可复用 @vscode/ripgrep 或系统 rg，降级纯 JS 扫描）
│  ├─ git/
│  │  ├─ exec.js                #   spawn 封装：env 硬化、超时、取消、错误码、epoch 防串扰
│  │  ├─ status.js              #   porcelain v2 -z 流式解析 → 四组变更模型
│  │  ├─ log.js                 #   log -z + 多字符哨兵解析；for-each-ref
│  │  ├─ diff.js                #   按需 diff（工作区/暂存/提交/单文件）
│  │  ├─ write.js               #   stage/unstage/discard/commit/checkout；hunk 暂存（hash-object+update-index）
│  │  └─ watch.js               #   双 watcher + debounce/throttle/idle + 轮询降级
│  └─ terminal.js               #   subprocess.spawnTerminal + 环形缓冲 + 游标（移植 dev-sandbox）
├─ frontend/
│  ├─ index.js                  #   window.__ModuleLoader__.load({id, factory})；apply(ctx) 注册面板与侧栏图标
│  ├─ runtime.js / styles.js    #   React 绑定 / CSS 文本注入（<style>）
│  ├─ stores/                   #   datasource（唯一 Remote 通道）+ 工作台 store（面板状态机）
│  ├─ service/                  #   纯函数：路径、键盘、diff 高亮、语言探测、终端通道
│  └─ views/
│     ├─ Workbench.tsx          #     三分区布局 + 分隔条拖拽 + 状态栏
│     ├─ explorer/FileTree.tsx  #     虚拟化文件树
│     ├─ scm/{ScmView,ChangeRow,CommitBox}.tsx
│     ├─ graph/{GraphView,LaneCanvas,CommitRow,CommitDetail}.tsx
│     ├─ editor/{EditorTab,CodeMirrorEditor,DiffView,MarkdownPreview}.tsx
│     ├─ panel/{TerminalTabs,TerminalView,Problems}.tsx
│     └─ common/（Button、Icon、Splitter、Menu、Input、Tooltip、Spinner）
└─ README.md / ARCHITECTURE.md / AGENTS.md   # 与 model-intelligence-test 的文档惯例对齐
```

### 3.2 数据流与状态规则（沿用本仓库约定）

```
用户操作 → store.dispatch → datasource（一次 Remote 调用）→ Host 动作 → snapshot 回传 → store 更新 → 视图重绘
```

- **Host snapshot 是唯一真相**；frontend 不缓存可推导的业务状态（开关类 UI 状态除外）。
- 每个 Remote 动作都是**幂等的状态查询或显式命令**，返回值带 `revision`/`version`，客户端据此判断是否需要刷新。
- 大载荷（git log 5 万条 / 目录列表）走**分页 + 上限**，不一次性塞进 snapshot。

### 3.3 Remote 契约（草案）

单 namespace（`ide`），一个 `execute(request)` 分发表（与 `pluginDev` 同形，`invocation.kind='direct'`，zod strict 校验）。
动作分组（括号内为 P 级）：

| 组 | 动作 |
| --- | --- |
| workspace | `workspace.resolve`（默认取最近会话 cwd，可显式传 root）、`workspace.set`、`workspace.trust`（P0） |
| files | `fs.listDir`、`fs.stat`、`fs.read`（按行 range，返回 `{text,lines,eof,version,nextOffset}`）、`fs.write`（带 `expected` 版本）、`fs.create`、`fs.rename`、`fs.remove`（P0） |
| search | `fs.search`（查询/排除/上限，ripgrep）、`fs.grep`（编辑器内查找，P1） |
| git | `git.status`、`git.log`（`--max-count`/`--skip`）、`git.refs`、`git.show`、`git.diff`、`git.stage`、`git.unstage`、`git.discard`、`git.commit`、`git.checkout`、`git.stageHunk`、`git.discardHunk`、`git.stash*`（P1）、`git.network`（P2） |
| terminal | `terminal.create`、`terminal.write`、`terminal.poll`、`terminal.resize`、`terminal.close`（P0） |
| watch | `workspace.changes`（P1，流式；先做 Host 侧 debounce 后推 `{statusDirty}` 的轻量通知；P0 用前端 1s 轮询 `git.status`） |

**安全**：`sessionId` 可以来自 wire，但**根目录必须由 Host 用 `ctx.sessionController.resolveAgent(sessionId).session.header.cwd` 解析**，或用户自己的显式选择；不允许 wire 传任意绝对路径直接当根（照 `dsh-plugin-dev-sandbox/backend/service.js:13-25` 的写法）。

### 3.4 打包约束（硬边界，先说清）

- **单文件 IIFE**：`esbuild --format=iife --bundle`，不能拆 chunk、不能有独立 worker 文件、不能从 `/plugins/<pkg>/assets` 加载 wasm/字体（该路由只服务 `.svg/.png/.webp/.jpg/.jpeg`）。
- `react` 必须 **external**（宿主 `require('react')` 提供，禁止第二份 React）；`react/jsx-runtime` 同理。
- 体积预算：**主 bundle ≤ 1.2 MB gzip**（当前方案估算 350–500 KB），CI 用 esbuild metafile 断言。
- 语言包**显式白名单**（IIFE 下动态 import 不省体积）。

---

## 4. 选型与依据（含放弃项）

### 4.1 编辑器：CodeMirror 6（放弃 Monaco）

| 维度 | CM6 + Lezer（选） | Monaco（放弃） |
| --- | --- | --- |
| 体积（gzip） | basicSetup **118.75 KB**；13 语言 + merge + 主题实测 **1025 KB min ≈ 320 KB gzip**（本机实测，无 worker/CSS/字体） | core **602 KB** + CSS **124 KB** + editor.worker **80 KB** ≈ **806 KB**，且**每语言另算** |
| 单 IIFE 可行性 | **零障碍**（无 CSS 文件、无字体、无 worker、无动态 import） | 勉强可跑：worker 必须二次构建成字符串 + `Blob` 内联、100 个 CSS 文件构建期内联、`codicon.ttf`(149 KB) dataurl |
| 「VS Code 同款高亮」 | Lezer 增量；Markdown/精确配色可另用 Shiki | **Monaco 不支持 TextMate**（用 Monarch），这个卖点本身不成立 |
| 视口渲染/大文件 | 视口渲染；按 256 KB / 2 MB / 10 MB / 20 MB + 单行 1 万字符分级降级 | 20 MB / 30 万行才停止 tokenize，10 MB 仍全量 tokenize |
| diff | `@codemirror/merge`（同为 MIT，共享 Text/Extension，带 `diffConfig.timeout/scanLimit` 护栏） | diff editor 现成但代价同上 |
| 许可 | 全 MIT | MIT，但工程摩擦与体积 6.7× |

**结论**：CM6。**只读预览复用同一实例的只读模式**（边际体积 0）；Shiki 仅在 Markdown 代码块与「要像素级对齐 VS Code 主题」时可选引入（P1，JS engine 路线 60–80 KB，oniguruma 内联 155 KB，二选一）。

**大文件降级策略**（与 VS Code 常量对齐）：< 256 KB 全功能；256 KB–2 MB 关折叠/关部分扩展；2–10 MB 关语法高亮；10–20 MB 纯文本 + 关软换行；> 20 MB 拒绝内联、改分页只读。单行 ≥ 10000 字符关软换行。

### 4.2 提交图谱：移植现成布局算法 + 自绘

| 候选 | 许可 | 吃任意 DAG | 虚拟滚动 | 结论 |
| --- | --- | --- | --- | --- |
| **git-graph-plus `src/git/git-graph-builder.ts`（487 行纯 TS，0 依赖）** | **Apache-2.0** | 是 | 自控 | **主选：vendor/移植** |
| `@wexample/js-graph-log`（6.3 KB） | MIT | 是 | 自控 | 备选 A：MVP 先跑通链路，后替换 |
| `@dolthub/commit-graph` / commit-graph | MIT/Apache | 是 | **无**（只有加载更多） | 仅作参考实现 |
| `@gitgraph/*` | MIT | **否**（声明式 API） | — | 排除（且仓库已 archived） |
| vscode-git-graph 源码 | **禁止分发衍生作品** | — | — | **禁止拷贝**（只可读） |
| `git log --graph` ASCII | — | — | — | 排除：**不输出 parent hash**，拿不到拓扑 |
| elkjs / GitButler / GitLens `plus/` | EPL/GPL、FSL、闭源 | — | — | 许可证雷区 |

数据获取（实测 45,251 commit / 350 分支）：`git log --all --date-order -z --format="%H<SEP>%P<SEP>%an<SEP>%ae<SEP>%at<SEP>%s<SEP>%D"`
→ **0.22 s / 7.0 MB / 解析 36 ms / 0 坏行**；refs 用 `for-each-ref --format="%(refname)%09%(objectname)%09…%(upstream:track)"`（0.15 s）。布局复杂度 O(C×活跃 lane)，实测 5 万 commit/400 分支 **77 ms**（输入必须拓扑有序，否则退化到 ~4 s，需悬空 lane 回收）。
渲染：SVG + 固定行高（28px）+ `@tanstack/react-virtual`；图列与列表共享同一滚动容器（CSS grid 对齐）；跨行连线按可视区间裁剪。

### 4.3 git 后端：系统 CLI（放弃 dugite / isomorphic-git / nodegit / simple-git 当后端）

- **dugite 不带解析器**：它只做「起进程 + 错误分类」，`parseGitStatus`/`gitDiff` 是常见误解；自带的代价是 +60.6 MiB 下载 / +211 MiB 落盘 / asarUnpack / 签名公证。→ 只作「检测不到 git」时的可选下载项（P2）。
- isomorphic-git 维护力量薄弱、packfile/index 兼容性风险；nodegit 2020 停更 + ABI；simple-git 解析不透明（拿不到 rename score / 冲突三阶段）。→ 全部放弃，但 **simple-git / VS Code `git.ts` 作为写法参考**。
- 命令要点：
  - 状态：`git --no-optional-locks status --porcelain=v2 -z --branch --untracked-files=all`（`1/2/u/?` 四类 → staged/unstaged/untracked/conflicts；`2` 行要连读第二段 origPath；`u` 行有 4 个 mode）。**必须 `--no-optional-locks`**：普通 `status` 会改 `.git/index` mtime，与用户操作抢锁。
  - 路径一律 `-z`（避免 `core.quotepath` 的 C 转义），`LC_ALL=en_US.UTF-8`/`LANGUAGE=en` 固定。
  - hunk/行级暂存：`git hash-object --stdin -w --path <rel>` + `git update-index [--add] --cacheinfo <mode>,<sha>,<rel>`（不要 `git apply --cached --3way`：失败会往 index 写冲突；`--cached --recount` 可作为兜底）。
  - 网络/耗时操作带 `--progress` + 可取消；`GIT_TERMINAL_PROMPT=0`。
  - 刷新：工作区递归 watcher（排除 `.git/**`）+ `.git` 只监听第一层（`index`/`HEAD`/`refs/**`）→ **debounce 1 s → throttle（上一次未完成则丢弃）→ 操作未 idle 则延后**；`didHitLimit`（>10000）置「巨大仓库」停自动刷新；macOS 递归 `fs.watch` 对嵌套内容修改只报 `rename`（一律当「目录变了」处理）；破例降级 3–5 s 轮询（网络盘/大仓库/watch 失败）。
  - **一律不写用户 `.git/config`**，需要时 `git -c key=value` 临时覆盖。

### 4.4 终端：复用「插件调试沙箱」的 PTY 通道

- `subprocess.spawnTerminal({ argv, cwd, env, rows, cols, terminalType:'xterm-256color', graceMs })` → `{ pid, done, output: Readable, terminate() }`（官方 Host 服务，沙箱插件已在用）。
- Host 每终端环形缓冲 + 字符游标；前端 `terminalPoll(id, offset)` 续读（落后过多返回 `dropped`）、`terminalWrite`、`terminalResize`、`terminalClose`；xterm 6.0.0 + `addon-fit` 0.11.0；ResizeObserver → `fit()`。
- **不采用**官方 `ctx.webTerminals`：其 `reconcileHolds()` 只用官方侧栏终端通过 `retainTabs()` 独占写入的 `openTabs` 构造 wanted 集合，我们嵌入的终端会被下一次侧栏变更 release（hold 是输出挂载前置条件）。
- 轮询 120 ms（沙箱实测值）；后续可换「Host 主动推送 + ack」提延迟，P1。

### 4.5 文件通道：自建 Host Remote

- 读：按行 range 分页（`{offset, limit}` → `{text, lines, eof, version, bytes}`），上限与 `workspaceFiles` 语义对齐（行 1-based）。
- 写：带 `expected` 版本（学官方 `fs.writeText(expected)`），冲突返回 `{conflict:true, version}` 让编辑器提示重新加载——**这是保护用户不被 AI 并发改写覆盖的关键**。
- 目录：`listDir` 返回 `{path, entries:[{name,type,size?}]}`，**懒加载**（点开目录才列），并可在 Host 侧按 `.gitignore` 预过滤（P1）。
- 搜索：优先 `@vscode/ripgrep`（DSH 已随安装包分发）或系统 `rg`，都没有则纯 JS 遍历（P2）。

### 4.6 一处需要澄清的认知

用户说「和 vscode 的路线差不多」——VS Code 的真实构成是「Monaco 视图 + TextMate(Oniguruma) 语法 + 视口渲染 + 后台时间切片 tokenize + LSP」。
在「单文件 IIFE、无独立 worker、无 assets 路由」的约束下，我们**对齐「视口渲染 + 增量解析 + 大文件分级降级」**，放弃 Monaco 视图层与 worker 体系；代价是：没有 minimap / overview ruler（可用自绘 1px 色块替代）、没有 LSP 语义能力、TextMate 只在 Shiki 可选路径上出现。

---

## 5. 关键实现方案（容易翻车的地方）

### 5.1 编辑器与文件

1. **打开**：`fs.read` 首屏取前 2–5k 行 → `EditorState.create`；滚动到边缘再补页（`eof` 停止）。**不要**为了「像 VS Code」一次性读全文件。
2. **脏标记与保存**：编辑器持有 `doc` 与 `savedDoc`，用 `doc.length + changes` 判脏；`Cmd+S` → `fs.write{path, text, expectedVersion}`；返回新版本则更新；冲突弹「文件已被外部修改：重新加载 / 强制覆盖」。
3. **换行与编码**：读时记录 `crlf`/末尾换行/BOM（写回时还原）；非 UTF-8 一律按 `readBytes` + 只读 hex/文本视图处理（P2 再做编码转换）。
4. **标签页**：一个 tab = `{path, groupId, state: 'clean'|'dirty'|'loading'|'error', scroll}`；关标签前脏检查。
5. **diff**：`@codemirror/merge` 的 `MergeView`（P0 用左右分栏）+ `unifiedMergeView`（P1 内联）；数据来自 `git.diff`（统一 diff 文本）→ 用 `diff`(jsdiff) `parsePatch` 转两侧文本；超大 diff 只显示摘要 + 首屏 hunk。

### 5.2 SCM 面板

1. **四组模型**直接照 VS Code `api/git.d.ts` 字段命名（`indexChanges`/`workingTreeChanges`/`untrackedChanges`/`mergeChanges` + `Change{path,origPath?,status,renameScore?}`），便于将来对拍与迁移；同一文件可同时在 staged 与 unstaged（`MM`），**不去重**。
2. **刷新**：P0 用「操作后 + 1s 轮询 + 窗口聚焦」；P1 接 Host watcher 推送。
3. **写操作串行队列**：所有 git 写操作排队执行，执行期间不触发 status 刷新；每个操作带超时与取消；失败要有可读错误（`git` stderr 过滤后展示）。
4. **危险操作**：`discard` / `discard all` / 删分支 / `reset --hard` 二次确认；P1 加「XX 秒内可撤销」（从 `git reflog` 取回退点）。
5. **提交**：空 message 禁用按钮；`Cmd+Enter` 提交；P1 加 amend / signoff。

### 5.3 提交图谱

1. **数据**：`git.log` 一次拉 `--max-count=5000`（首屏），滚动到底再 `--skip` 续取；`git.refs` 单独拉。
2. **布局**：`commits: {hash, parents[], refs[], author, at, subject}` → `git-graph-builder` 产出 `{paths, links, dots}`；结果**不可变**，`useMemo` 挂在 `commits` 引用上；加「悬空 lane 超期回收」防退化。
3. **渲染**：SVG + 固定行高 + `@tanstack/react-virtual`；跨行线按可视区间裁剪（把线转成逐行「进出点」记录，按行号切片）。
4. **交互**：点提交 → 右侧详情（meta + `show --name-status` 文件列表 + 单文件 diff）；hover 高亮泳道；右键菜单（checkout / cherry-pick / tag / copy hash；P1）；搜索只**过滤列表不重排布局**（重排会让点击行号漂移）。
5. **未提交节点**：列表最上方一个虚拟「Changes」行，选中时把四组变更汇总成一个 pseudo-commit 展示；Commits 行与 SCM 面板共享数据源。

### 5.4 终端

1. 每个终端 tab：`terminal.create` → `{terminalId, pid, shell}`；写入走 `terminalWrite`；输出走 120 ms 轮询 `terminalPoll(id, offset)` 写进 xterm。
2. 尺寸：ResizeObserver + `fit()` → `terminalResize(cols, rows)`；窗口隐藏时不轮询。
3. 关闭：先客户端移除 tab（乐观）→ `terminalClose`（`terminate()` + 等待静默）→ 失败回滚 tab（照抄沙箱的「先移除再确认」策略）。
4. 首个终端默认 shell 取 `subprocess.terminalEnvironment().defaultShell`，cwd = 工作区根。

### 5.5 安全（写进设计，不是收尾工作）

1. **Workspace Trust 门禁**：未信任目录只允许「只读 + 硬化配置」的 `status/log/diff`，且不自动刷新；信任后才允许写操作与 git hooks。信任状态存插件自己的 storage，不进仓库。
2. **读路径硬化**（所有后台命令）：`GIT_OPTIONAL_LOCKS=0` + `-c core.fsmonitor=false -c core.hooksPath=<空目录> -c core.pager=cat -c diff.external= -c credential.helper= -c core.askPass= -c core.sshCommand=` + `GIT_TERMINAL_PROMPT=0`。
   （理由：`core.fsmonitor` 等 15+ 个可执行配置键能在「打开文件夹 + 自动 git status」时 RCE，2026 年 Copilot CLI / Theia 都有实例。**但不能无条件清空 `filter.*`**——git-lfs 靠它。）
3. **写路径**：默认沿用用户配置（钩子是正当功能），设置里给「运行 git hooks」开关；不替用户改 `core.hooksPath`。
4. **凭据**：绝不读 `~/.git-credentials`；需要认证只依赖用户 credential helper / `GIT_ASKPASS`。
5. **路径**：所有路径在 Host `path.resolve` 后必须仍在工作区根之下（防目录逃逸）；`argv` 数组传参不过 shell。
6. **不修改用户 `.git/config`**；`safe.directory` 报错时提示用户手动处理，不自动写全局。

---

## 6. 分阶段计划

> 每个里程碑都能独立跑起来并被用户看到，不做「一次交付一大坨」。人日为单人估算（不含评审与视觉打磨）。
> 测试与验证按仓库纪律：**先报计划获批再执行**，默认交付 = 实现符合需求 + 构建成功。

| 里程碑 | 内容 | 产出可验收 | 人日 |
| --- | --- | --- | --- |
| **M0 骨架** | 新包骨架（package.json/build.mjs/cordis patch）、Host Remote 接线、面板注册 + 侧栏图标、三分区布局 + 分隔条 + 状态栏、主题 token 接入、`workspace.resolve`（默认 = 最近会话 cwd）、终端复用打通（1 个 tab 能敲命令） | 侧栏出现图标 → 点开是空工作台，底部终端能用 | 4–5 |
| **M1 文件与编辑器** | `fs.listDir/stat/read/write`、虚拟化文件树、CM6 编辑器（主题/键位/搜索/折叠/保存/脏标记/标签页）、语言探测 codegen、大文件分级降级 | 能浏览、打开、编辑、保存真实文件；大文件不卡 | 7–9 |
| **M2 SCM 面板** | git exec/status/log/diff 解析、四组变更列表 + 行内操作 + 提交框 + 分支切换、工作区 diff 视图、刷新节流、写操作串行队列、危险操作确认 | 能看变更、暂存/取消/丢弃、提交、切分支 | 9–12 |
| **M3 提交图谱** | `git.log --all` 分页 + refs、vendor 布局算法、SVG + 虚拟滚动渲染、提交详情 + 文件列表 + 单文件 diff、与 SCM 联动（虚拟未提交节点） | SourceGit 风格图谱可滚动 5 万条、点开有详情 | 8–10 |
| **M4 打磨与 P1 项** | 行级暂存（hash-object）、stash、文件搜索（ripgrep）、快速打开（`Cmd+P`）、Markdown 预览、合并冲突三方视图、watcher 推送刷新、尺寸/性能最终治理 | 日常可替代 VS Code 面板工作 | 8–10 |
| **M5（P2，另议）** | 网络类 git（fetch/pull/push + 进度 + 取消，默认关闭）、reflog 撤销、submodule/worktree、设置页、内置 git（dugite）兜底 | — | 10+ |

**累计**：M0–M4 ≈ **36–46 人日**（乐观 36 / 保守 46）；只做 M0–M2（「能用」的 P0 骨架）≈ **20–26 人日**。

**复用/移植项节省的工程量**（相对从零）：终端 ≈ −4 人日、图谱布局 ≈ −3 人日、git 状态模型与刷新结构 ≈ −3 人日、编辑器选 CM6 而非 Monaco ≈ −5 人日。

---

## 7. 风险与未决项

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 单文件 bundle 体积（CM6 + xterm + 组件 ≈ 400–600 KB gzip） | 首次打开面板加载 1–2 s | 体积上限断言；面板内部按需挂载（编辑器/终端懒初始化） |
| 大仓库（>5 万文件 / >20 万 commit） | status 慢、图谱首屏大 | 分页 + `didHitLimit` 置「巨大仓库」、停自动刷新、提示手动刷新 |
| 行级暂存正确性（CRLF/BOM/mode/新增/删除） | 暂存错内容 | 用 `hash-object + update-index` 方案 + `git diff --cached` 回读校验 + 失败回滚 |
| macOS 递归 watcher（只报 rename、fd 上限） | 刷新抖动 / 卡死 | 一律当「目录变了」+ debounce；大仓库降级轮询；提供「关自动刷新」开关 |
| 宿主主题/CSP 变化 | 样式错乱 | 全部走 `--dsw-*` token；构建期检查无硬编码色 |
| 与 AI 并发写同一文件 | 覆盖用户编辑 | `expected` 版本校验 + 冲突提示 |
| DSH 版本升级导致 Remote/slot 契约变化 | 面板挂掉 | 契约集中在 `contract.js`；启动时自检必需服务存在并降级提示 |

**已拍板（2026-11-13）**：

1. **范围**：做到 **M0–M4**（完整平替，36–46 人日）。P2 的网络类 git 操作仍不做，默认关闭。
2. **顺序**：**先把工程文档写完整，再写实现**。文档落在 `packages/dsh-workspace-ide/`（见 §8 文档索引），代码在文档评审通过后开始。
3. **包名/显示名**：暂定 `dsh-workspace-ide`（「文件工作台」），面板 id `workspace-ide`。
4. **默认根目录**：上次打开的工作区优先，否则取最近活跃会话的 `cwd`，另有面板内「打开文件夹」显式选择。
5. **不动现有包**：只新增本包；终端实现从 `dsh-plugin-dev-sandbox` **复制**，不抽公共模块、不改那个包。

---

## 8. 文档索引

### 8.1 工程文档（`packages/dsh-workspace-ide/`，实施的唯一依据）

| 文件 | 内容 |
| --- | --- |
| `README.md` | 面向使用者的说明：入口、三视图、边界、安全摘要 |
| `docs/README.md` | 文档阅读地图 + 术语表 + 文档维护规则 |
| `ARCHITECTURE.md` | 依赖方向、进程模型、状态所有权、数据流、硬边界、生命周期、性能预算、静态约束 |
| `AGENTS.md` | 插件内硬规则（可被构建期检查或 review 判定） |
| `docs/remote-contract.md` | Remote 契约：动作、字段、错误码、限制参数、并发与取消语义 |
| `docs/git-model.md` | git 命令清单、porcelain v2 解析、四组操作矩阵、diff 结构化、hunk 暂存、刷新节流 |
| `docs/security.md` | 威胁模型、信任矩阵、读路径硬化、路径校验、凭据、审计 |
| `docs/editor.md` | CM6 装配、主题映射、加载管线、保存与冲突、大文件分级、diff、快捷键 |
| `docs/files.md` | 目录树与虚拟化、读写管线、版本冲突、搜索、刷新 |
| `docs/graph.md` | 图谱数据管线、布局算法移植、SVG 渲染与裁剪、交互、降级 |
| `docs/terminal.md` | PTY 通道、环形缓冲与偏移协议、xterm 装配、轮询、生命周期 |
| `docs/ui-spec.md` | 布局尺寸、组件规格、token 映射、快捷键、文案、无障碍、响应式 |
| `docs/build.md` | package.json、构建脚本、静态检查、开发循环、发布、故障排查 |
| `docs/milestones.md` | M0–M4 任务级拆解、DoD、依赖图、人日汇总 |
| `plan/全方案.md` | 完整方案与决策记录（ADR） |
| `plan/E2E-流程.md` | 端到端人工验收剧本 |

### 8.2 调研文档（选型依据）

| 文件 | 内容 |
| --- | --- |
| `research/dsh-surface.md` | DSH 扩展面：全局面板/侧栏图标、bundle 协议与资源路由、工作区根解析、文件通道、终端两条路线、包骨架、主题约束 |
| `research/editor.md` | Monaco vs CM6 vs Shiki 横评（体积/worker/CSS/大文件/diff/主题/语言探测/Markdown）、IIFE 打包要点、依赖清单与人日 |
| `research/git-graph.md` | 图谱库横评与许可证雷区、`git log`/`for-each-ref` 实测命令与解析坑、布局算法复杂度、SVG+虚拟化方案、人日 |
| `research/git-backend.md` | git 后端横评（系统 CLI vs dugite 等）、porcelain v2 状态模型、按需 diff、hunk 暂存三条路线实测、刷新节流、P0/P1/P2 交互清单、安全硬化 |
