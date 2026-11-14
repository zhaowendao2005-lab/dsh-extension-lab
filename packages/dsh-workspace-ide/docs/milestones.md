
## 实现状态（M0–M4，代码为准）

| 阶段 | 交付 | 状态 | 落点 |
|---|---|---|---|
| M0 骨架 | 包结构、构建/静态检查、Remote 契约与 service、面板 + 侧栏图标、终端面板、文件树、状态栏 | 完成 | `package.json`、`scripts/{build,check}.mjs`、`backend/{index,service,contract,store,workspace,files,terminal}.js`、`frontend/{index.js,runtime.js,stores,views,styles}` |
| M1 文件与编辑器 | 目录树（分页渲染）、文件读写/新建/重命名/删除、CM6 编辑器（语法/只读降级/保存/版本冲突）、语言探测、设置页 | 完成 | `backend/files.js`、`frontend/editor/*`、`frontend/stores/editor.stores.js`、`frontend/views/{explorer,editor,common}` |
| M2 源代码管理 | `status/refs/log/diff/commit/stage/unstage/discard/commitCreate/checkout/branch/tag/stash/stageHunk`、四组状态、提交框、分支/贮藏菜单、两栏差异与代码块级暂存 | 完成 | `backend/git/*`、`frontend/stores/{scm,diff}.stores.js`、`frontend/views/{scm,diff}` |
| M3 提交图谱 | 多字符哨兵取数、行带布局（Host 侧）、28px 虚拟滚动、泳道 SVG、引用徽章、过滤/分页、双击看提交差异 | 完成 | `backend/git/{log,layout}.js`、`frontend/stores/graph.stores.js`、`frontend/views/graph` |
| M4 打磨 | 文件监听（fs.watch + 800ms 合并 + 2s 轮询兜底）、快捷键、编辑器偏好持久化、目录分页、错误提示与降级、文档同步 | 完成 | `backend/git/watch.js`、`frontend/index.js`（shortcuts）、`frontend/service/layout.js`、`docs/*` |
| M4-2 冲突三方视图 | `git.conflict` 取 `:1:/:2:/:3:`、三栏只读对照、采用我方/对方/两者都保留/删除/标记已解决（`git.resolveConflict`） | 完成 | `backend/git/conflict.js`、`backend/git/write.js`（`resolveConflict`）、`frontend/stores/conflict.stores.js`、`frontend/views/editor/ConflictView.jsx`、`frontend/styles/conflict.css` |
| M4-5 快速打开 | `files.index`（`git ls-files` 快路径 + 遍历兜底，Host 5 s 缓存）+ 文件名/路径模糊打分 + 键盘选择，`Shift+Cmd+O` | 完成 | `backend/files.js`（`index`）、`frontend/service/fuzzy.js`、`frontend/views/common/QuickOpen.jsx`、`frontend/styles/quickopen.css` |

### 运行期冒烟记录（隔离实例，2026-11-14）

`plugin_dev` 起隔离 DSH（`dsh web --patch overlay`，Web profile），Playwright 驱动，逐条实测：

| 能力 | 结果 | 证据 |
|---|---|---|
| 面板挂载 | 侧栏「工作区」图标 → `main` 面板渲染，无 slot crash | `.wid-root` 存在、控制台 0 条消息 |
| 工作区 | `workspace.resolve/open` 返回 git、信任持久（跨重启） | 打开 `/tmp/wid-conflict-demo`、`branch=main` |
| SCM 四组 | `git.status` 的 `operation` 由 `.git` 标记判定 | 合并中显示「进行中：merging」（不再误报 unborn） |
| 冲突三方视图 | 三列取 `:1:/:2:/:3:`，按钮解决后回编辑器 | 采用对方 → 文件内容变 `FEATURE`、`app.txt` 进暂存、通知「已解决冲突」 |
| 信任门禁 | 未信任时写操作被 Host 拒绝并提示 | 首次点「采用对方」提示「此工作区尚未被信任」 |
| 差异视图 | 并排/统一切换、hunk 头、行内标记 | `.wid-diff` + 2 个 `.cm-editor`（并排）/ 1 个（统一） |
| 快速打开 | `files.index` + 模糊排序 + Enter 打开 | 输入 `app` → 2 个文件、选中后编辑器打开 `app.txt` |
| 深色主题 | token 全部走 `--dsw-alias-*`，暗色下无硬编码色 | 截图：`--dsw-alias-bg-layer-1 = #232324` |
| 快捷键 | 注册成功 8 条（三修饰键），与宿主零冲突 | 前一轮「required entries did not activate」已消除 |

未实现（有意的范围外）：`git.network`（网络操作）、`git.graph.search`（服务端图谱搜索）、LSP、回收站删除、iframe 渲染。它们都返回 `E_UNSUPPORTED`，不静默失败。

# 任务拆解（M0–M4）

> 路径相对 `packages/dsh-workspace-ide/`。人日 = 单人净工时（含自测，不含等 review）。
> 状态维护：完成一项把 `☐` 改 `☑`，并在**同一提交**内更新本文件（`AGENTS.md` 的文档同步表）。
> 契约与设计不在本文件讨论：动作名看 `docs/remote-contract.md`，阈值看 `docs/editor.md`，git 细节看 `docs/git-model.md`。

## 总览

| 里程碑 | 目标 | 人日 | 可验收产物 | 依赖 |
| --- | --- | --- | --- | --- |
| M0 骨架 | 面板能开、能切视图、能敲终端 | 4–5 | 侧栏图标 → 三分区空壳 → 终端里 `echo hi` 有回显 | — |
| M1 文件与编辑器 | 能看、能改、能存、能冲突处理 | 7–9 | 打开 1 MB 文件 ≤120 ms；保存带版本；脏标记与关闭拦截 | M0 |
| M2 SCM | 能暂存/丢弃/提交/切分支/看 diff | 9–12 | 四组与 `git status --porcelain=v2` 逐条对得上 | M1 |
| M3 图谱 | 能看历史、点提交、看单文件 diff | 8–10 | 首页 2000 条 ≤250 ms，分页不重排 | M2 |
| M4 打磨与 P1 | 行级暂存、stash、搜索、watcher、性能 | 8–10 | 预算表全达标；E2E 13 条走完 | M3 |
| **合计** | | **36–46**（点估 40.5） | | |

---

## M0 骨架（4–5 人日）

| ID | 任务 | 目标 | 涉及文件 | 依赖 | 验收标准（可判定） | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| M0-1 | 包骨架与构建 | 单文件 IIFE 产出两个入口 | `package.json`、`build.mjs`、`tsconfig.json`、`icon.svg` | — | `pnpm --dir packages/dsh-workspace-ide run build` 出 `lib/index.js` + `lib/client.js`；client 含 `window.__ModuleLoader__.load` 与 `export function apply`；`react` 在 external 列表 | 0.5 |
| M0-2 | 静态检查脚本 | 6 条规则可判、可失败 | `scripts/check.mjs` | M0-1 | 每条规则有正/反例夹具；反例必须让 build 非零退出；`pnpm build` 末尾必跑 | 0.5 |
| M0-3 | Host Remote 接线 | 一个 direct 动作走通全链路 | `backend/index.js`、`backend/service.js`、`backend/contract.js`、`shared/contract.js`、`shared/errors.js` | M0-1 | `workspace.resolve` 返回 `{root,name,trust,recents,limits}`；非法 payload 被 zod 拒（`E_UNSUPPORTED`）；无 sessionId 时取最近活跃会话 cwd；`bindTypertRemote` 生效 | 0.5 |
| M0-4 | 面板与侧栏注册 | 图标 → keyed 面板 | `frontend/index.js`、`frontend/runtime/mount.ts` | M0-3 | `main` key=`workspace-ide`；`sidebar.panellist` 同 id 同 label；重复点不重复挂载；dispose 后图标与 DOM 都消失 | 0.5 |
| M0-5 | 三分区壳与分隔条 | 树/编辑/终端可拖 | `frontend/views/Workbench.tsx`、`views/panel/Splitter.tsx` | M0-4 | 拖拽跟手（≤16 ms 一帧）；比例持久化；最小尺寸生效；折叠不塌成 0 | 0.5 |
| M0-6 | 三视图切换 + 状态栏 | 单面板内切视图 | `views/common/ActivityBar.tsx`、`views/common/StatusBar.tsx`、`stores/workbench.stores.ts` | M0-5 | 切换不重建终端；状态栏显示 根/分支位/变更数/Ln,Col/编码；无数据时显示占位而非假值 | 0.5 |
| M0-7 | 主题与 token | 明暗跟随宿主 | `frontend/styles/tokens.ts`、`runtime/theme.ts` | M0-4 | 只用 `--dsw-alias-*`；切主题 ≤1 帧生效；`check.mjs` 无硬编码色；字号吃三个 `--dsh-*-font-size` | 0.5 |
| M0-8 | 根目录与空态 | `workspace.resolve/open/state` | `backend/workspace.js`、`views/explorer/EmptyState.tsx`、`datasource/workspace.datasource.ts` | M0-3、M0-6 | 无 root 出空态；`pickDirectory` → `open` 成功；`E_NOT_DIR`/`E_OUTSIDE_ROOT` 有文案；面板重开时 `state` 对齐 | 0.5 |
| M0-9 | 终端最小闭环 | 开 zsh、敲命令、关标签 | `backend/terminal.js`、`views/panel/TerminalPanel.tsx`、`stores/terminal.stores.ts`、`datasource/terminal.datasource.ts` | M0-3 | `create` 返回 `terminalId`；`echo hi` 30 帧内见输出；关标签后 `poll` → `E_TERMINAL_GONE`；dispose 后 `ps` 无残留 | 1.0 |

**M0 DoD**
- [ ] `pnpm --dir packages/dsh-workspace-ide run build` 通过；`lib/` 可被 DSH 加载
- [ ] `scripts/check.mjs` 6 条全绿，且故意破坏任一条能让构建失败
- [ ] bundle gzip ≤1.2 MB（此时应 <150 KB）
- [ ] 明暗主题各看一眼：无透明底、无白字白底
- [ ] 控制台无报错、无未捕获 promise
- [ ] 错误路径有 UI：空态、Remote 失败、终端 spawn 失败都有可读文案；同步 `docs/build.md`、`docs/ui-spec.md`

---

## M1 文件与编辑器（7–9 人日）

| ID | 任务 | 目标 | 涉及文件 | 依赖 | 验收标准 | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| M1-1 | `files.list`/`stat` | 目录懒加载与元数据 | `backend/files.js`、`backend/contract.js` | M0-8 | 2000 项 ≤80 ms；500 ms 缓存命中率可观测；越界 `E_OUTSIDE_ROOT`；`truncated` 正确 | 0.75 |
| M1-2 | `files.read` 分页 | 按行读 + 版本 | `backend/files.js`、`shared/contract.js` | M1-1 | `offset/limit/eof` 正确；>20 MB `E_TOO_LARGE`；二进制 `E_BINARY`；`totalLines` 仅 ≤2 MB | 0.5 |
| M1-3 | `files.write` 原子写 | 乐观版本保存 | `backend/files.js` | M1-2 | 临时文件 + `rename`；保留 mode；还原 eol/bom；冲突返回 `currentVersion`；同 path 串行 | 1.0 |
| M1-4 | 虚拟化文件树 | 大目录不卡 | `views/explorer/FileTree.tsx`、`stores/files.stores.ts` | M1-1 | 1 万条目滚动不掉帧；展开态保持；方向键可用；选中 ≠ 打开 | 1.0 |
| M1-5 | CM6 挂载与主题 | 编辑器进面板 | `views/editor/EditorPane.tsx`、`frontend/editor/extensions.ts` | M0-7 | StrictMode 双调用不泄漏；主题/字号跟随；1 MB 首屏 ≤120 ms | 0.75 |
| M1-6 | 语言探测与白名单 | 扩展名 → 语言 → 按需 | `scripts/gen-languages.mjs`、`shared/languages.generated.js`、`service/language.ts` | M1-5 | 13 语言白名单；未知回落 plaintext；生成幂等（同输入同字节） | 0.5 |
| M1-7 | 键位与搜索 | 常用编辑操作 | `service/keys.ts`、`editor/extensions.ts` | M1-5 | `Cmd+F`/`Cmd+G`/`Cmd+/`/多光标可用；与 `docs/ui-spec.md` 的键位表逐条一致 | 0.5 |
| M1-8 | 标签页与脏标记 | 多标签 + 保存 | `views/editor/TabBar.tsx`、`stores/editor.stores.ts`、`stores/workbench.stores.ts` | M1-3、M1-5 | 脏点只在标签与状态栏；`Cmd+S` 生效；关未保存拦截；标签顺序稳定 | 0.75 |
| M1-9 | 冲突对话框 | 三种处置 | `views/common/ConflictDialog.tsx`、`stores/editor.stores.ts` | M1-3、M1-8 | 重新加载/另存/强制覆盖三分支可用；显示两个版本号；覆盖有二次提示 | 0.5 |
| M1-10 | 大文件分级 | L0–L4 降级 | `editor/extensions.ts`、`service/large-file.ts` | M1-5 | 30 MB 不建 EditorState；8 MB 落 L2 只读；单行 1 万字符关软换行；入口 >300 ms 自动降级 | 0.75 |
| M1-11 | 目录操作 | 新建/重命名/删除 | `backend/files.js`、`views/explorer/ContextMenu.tsx` | M1-3 | 新建后自动打开；大小写改名走中转；删除确认含数量；重名报错不覆盖 | 0.5 |
| M1-12 | 标签恢复与状态栏 | 关面板再开 | `stores/editor.stores.ts`、`views/common/StatusBar.tsx` | M1-8 | 标签/滚动/折叠恢复；`Ln,Col` 实时；语言与 EOL 显示正确 | 0.5 |

**M1 DoD**
- [ ] 构建通过；`check.mjs` 新增 `views` 禁 `useState` 的反例并生效
- [ ] bundle gzip ≤1.2 MB（CM6 + 13 语言后应有明显增长，记录基线）
- [ ] 打开 1 MB / 8 MB / 30 MB 三个文件走完降级路径
- [ ] 明暗主题各开一个 `.ts` 与 `.md`，选中/搜索命中/折叠箭头都可见
- [ ] 无 console 报错；`E_VERSION_CONFLICT` 三选一都实机点过
- [ ] 同步 `docs/files.md`、`docs/editor.md`

---

## M2 SCM（9–12 人日）

| ID | 任务 | 目标 | 涉及文件 | 依赖 | 验收标准 | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| M2-1 | git exec 层 | spawn/超时/取消/硬化 | `backend/git/exec.js`、`docs/security.md` | M0-8 | `argv` 数组不经 shell；只读硬化串齐全；超时 `SIGTERM`→500 ms→`SIGKILL`；输出上限 32 MB；杀进程组 | 1.0 |
| M2-2 | status v2 解析 | 四组 + 分支模型 | `backend/git/status.js`、`docs/git-model.md` | M2-1 | `1/2/u/?/!` 全覆盖；`2` 行连读 origPath；`MM` 不去重；夹具 0 坏行；`seq` 单调 | 1.5 |
| M2-3 | SCM 列表 | 四组 + 行内按钮 | `views/scm/ChangeList.tsx`、`views/scm/ChangeRow.tsx`、`stores/scm.stores.ts` | M2-2 | 四组计数正确；悬停出按钮；单击出 diff；冲突组置顶；键盘可达 | 1.0 |
| M2-4 | stage/unstage | 写队列第一批 | `backend/git/write.js`、`backend/service.js` | M2-2 | 每仓库串行；逐 path `add`；旧 seq 丢弃；失败回滚呈现态；排队 >30 s `E_LIMIT` | 1.0 |
| M2-5 | discard + 确认 | 危险操作 | `backend/git/write.js`、`views/common/ConfirmDialog.tsx` | M2-4 | 二次确认；未跟踪删除提示"不进回收站"；不自动 stash；写完回读 status 校验 | 0.5 |
| M2-6 | 提交 | 提交框 + create | `views/scm/CommitBox.tsx`、`backend/git/write.js` | M2-4 | 空消息 disabled；`Cmd+Enter`；`commit -F -` 走 stdin；失败保留输入；成功清空 + 图谱 prepend | 0.75 |
| M2-7 | 分支切换 | checkout + refs | `backend/git/write.js`、`views/scm/BranchMenu.tsx` | M2-2 | refs ≤2000；不干净拒绝且不 stash；成功后整代作废刷新；可新建分支 | 0.75 |
| M2-8 | diff 数据 | working/index/commit | `backend/git/diff.js` | M2-1 | 单文件按需；hunk 行号可加回原文件；二进制标记；4 MB / 5 万行上限；rename 配对 | 1.0 |
| M2-9 | diff 视图 | MergeView 复用 | `views/editor/DiffPane.tsx`、`stores/diff.stores.ts` | M2-8、M1-5 | 两栏行号；折叠未变区；与图谱同一组件；上下文行可调 | 1.0 |
| M2-10 | 刷新调度 | 轮询/聚焦/操作后 | `stores/scm.stores.ts`、`backend/service.js` | M2-4 | 1500 ms 仅面板可见时；写中不刷；聚焦刷一次；300 ms 同参去重；旧 seq 丢弃 | 0.75 |
| M2-11 | 错误映射 | 17 码 → UI | `backend/service.js`、`frontend/service/errors.ts` | M2-1 | 每码有文案；`E_GIT_FAILED` 带过滤 stderr 且脱敏；错误条可复制 | 0.5 |
| M2-12 | 状态栏 git 段 | 分支/ahead-behind/变更 | `views/common/StatusBar.tsx` | M2-2 | detached 显示短 sha；unborn 显示"无提交"；变更数 = 四组之和 | 0.25 |
| M2-13 | 巨大仓库降级 | `isHuge` 停自动刷新 | `backend/service.js`、`stores/scm.stores.ts` | M2-10 | >1 万变更置 `isHuge`；停轮询；手动刷新可用；状态栏写明原因 | 0.5 |

**M2 DoD**
- [ ] 构建通过；`check.mjs` 断言 `backend/**` 无裸 `child_process`（只允许 `git/exec.js`）；bundle ≤1.2 MB gzip
- [ ] 1 万文件仓库 `git.status` ≤150 ms；3000 文件 ≤80 ms（记录实测）
- [ ] 四组与 `git status --porcelain=v2 -z --branch -uall` 逐条对得上（含 MM、rename、冲突）
- [ ] 明暗主题下 diff 的增删底色对比度可读；不靠颜色单独传达状态（有 +/- 前缀）
- [ ] 错误路径：hook 拒绝、index.lock、dubious ownership、非仓库各看到一次真实错误条
- [ ] 同步 `docs/git-model.md`（命令与解析）、`docs/security.md`（硬化串）

---

## M3 图谱（8–10 人日）

| ID | 任务 | 目标 | 涉及文件 | 依赖 | 验收标准 | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| M3-1 | log 解析与分页 | commits + refs + 缓存 | `backend/git/log.js` | M2-1 | 多字符哨兵；每条恰好 7 段否则计 bad；夹具 0 坏行；`skip` 分页；>5 万按参数缓存 | 1.0 |
| M3-2 | 布局移植 | lane 布局 + 版权头 | `backend/git/layout.js`、`THIRD_PARTY_NOTICES.md` | M3-1 | 与上游夹具逐行对拍；单行 segments ≤12；悬空 lane 200 行释放；5 万/400 分支 ≤100 ms | 1.5 |
| M3-3 | 图谱虚拟滚动 | SVG 车道 + 28 px 行 | `views/graph/GraphView.tsx`、`views/graph/CommitRow.tsx`、`stores/graph.stores.ts` | M3-2 | 首屏 2000 条 ≤250 ms；滚动 60 fps；跨行线按可视区裁剪；图列与列表共享滚动容器 | 1.5 |
| M3-4 | 分页追加 | 只重算尾部 | `backend/git/layout.js`、`stores/graph.stores.ts` | M3-3 | 追加不重排已发前缀；滚动锚不跳；`hasMore/nextSkip` 正确 | 1.0 |
| M3-5 | 提交详情 | meta + stats + files | `backend/git/diff.js`、`views/graph/CommitDetail.tsx` | M3-1 | 详情字段齐；>4 MB 截断提示；文件列表含状态与增删数 | 0.75 |
| M3-6 | 单文件 diff 复用 | 点文件出 diff | `views/graph/CommitDetail.tsx`、`views/editor/DiffPane.tsx` | M3-5、M2-9 | 与 SCM diff 同组件；`Esc` 逐级返回；可选父提交 | 0.75 |
| M3-7 | 未提交虚拟节点 | 与 SCM 联动 | `views/graph/GraphView.tsx`、`stores/workbench.stores.ts` | M3-3 | 有变更时顶行出现；点开是四组汇总；变更清空即消失 | 0.5 |
| M3-8 | 过滤与搜索 | 只过滤列表 | `views/graph/GraphFilter.tsx`、`stores/graph.stores.ts` | M3-3 | 过滤不触发布局（`layoutMs` 不涨）；清空即恢复 | 0.5 |
| M3-9 | 边界降级 | 超宽/病态/编码 | `backend/git/layout.js`、`views/graph/GraphView.tsx` | M3-2 | lane>200 截断并提示；布局 >200 ms 退化列表；中文/emoji/`\x1f` subject 正常 | 0.75 |
| M3-10 | 泳道配色 token | 颜色走索引 | `frontend/styles/tokens.ts`、`views/graph/CommitRow.tsx` | M3-3 | 明暗两套；无硬编码色；色数上限 12；色盲友好（有 lane 序号兜底） | 0.25 |

**M3 DoD**
- [ ] 构建通过；体积较 M2 增长 ≤120 KB gzip（虚拟滚动库 + 布局）
- [ ] 5 万 commit 仓库首屏 ≤250 ms、滚动不掉帧（录屏为准）
- [ ] `THIRD_PARTY_NOTICES.md` 存在且含 Apache-2.0 全文与 SourceGit MIT 头
- [ ] 明暗主题各看一次图谱：车道、选中行、refs 徽章都可读
- [ ] 错误路径：非仓库、布局超时、分页失败各有一次真实表现
- [ ] 同步 `docs/graph.md`（wire 结构、分页规则）

---

## M4 打磨与 P1（8–10 人日）

| ID | 任务 | 目标 | 涉及文件 | 依赖 | 验收标准 | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| M4-1 | 行级暂存 | `hash-object` + `update-index` | `backend/git/write.js`、`views/scm/HunkActions.tsx` | M2-4、M2-8 | 整 hunk 与行区间两种；写后回读 `--cached` 校验；失败回滚；CRLF/末尾换行夹具通过；**禁** `--3way` | 1.5 |
| M4-2 | 冲突三方视图 | ours/base/theirs | `views/editor/ConflictPane.tsx`、`backend/git/diff.js` | M4-1 | 取 `:1:/:2:/:3:`；接受单侧/双侧；标记 resolved 走 `git add` | 1.0 |
| M4-3 | stash 面板 | list/push/pop/apply/drop | `backend/git/stash.js`、`views/scm/StashList.tsx` | M2-7 | 四动作可用；`includeUntracked`；drop 有确认；pop 冲突有提示 | 0.75 |
| M4-4 | 搜索面板 | ripgrep 三级降级 | `backend/search.js`、`views/common/SearchPanel.tsx` | M1-1 | `engine` 字段正确（ripgrep/system-rg/js）；2000 条上限；点结果跳转并定位；regex/大小写/整词开关 | 1.0 |
| M4-5 | `Cmd+P` 快速打开 | 文件名模糊匹配 | `views/common/QuickOpen.tsx`、`service/fuzzy.ts` | M1-1 | 数据来自已加载目录缓存（不全盘扫）；键盘选择；` .git` 不出现 | 0.5 |
| M4-6 | Markdown 预览 | 只读渲染 | `views/editor/MarkdownPreview.tsx` | M1-6 | `react-markdown` + `remark-gfm`；代码块不引 Shiki；明暗可读；链接不在面板内导航 | 0.5 |
| M4-7 | watcher P1 | `watch.start/poll` | `backend/git/watch.js`、`stores/scm.stores.ts` | M2-10 | debounce 1000 ms；`.git` 只监听第一层；`dropped`→全量刷新；`stopped`→退回轮询并提示 | 1.0 |
| M4-8 | 性能治理 | 预算全达标 | `build.mjs`、`ARCHITECTURE.md` 预算表 | M2-9、M3-3 | 首屏/status/graph/1 MB/8 MB/目录/回显全部达标；bundle 断言生效；长时运行内存无线性增长 | 0.75 |
| M4-9 | 交互打磨 | 尺寸/焦点/快捷键 | `frontend/views/**`、`docs/ui-spec.md` | M2-9 | 明暗各看一眼无坏色；焦点环可见；快捷键表全覆盖；无"点了没反应"的按钮 | 0.75 |
| M4-10 | 文档同步与 E2E | 文档 = 代码 | `docs/*.md`、`plan/E2E-流程.md` | M4-1…M4-9 | 同步表 8 项全部对齐；E2E 13 条走完并记录已知问题 | 0.5 |
| M4-11 | 发布准备 | 版本 + marketplace + tag | `package.json`、根 `marketplace.json` | M4-10 | 版本一致；`spec` 浮动；tag `version-<n>` 可复现；`lib/` 已提交 | 0.25 |

**M4 DoD**
- [ ] 构建通过；`lib/` 与源码一致（重新构建无 diff）
- [ ] bundle ≤1.2 MB gzip 硬断言；`--metafile` 产物归档
- [ ] 静态检查 6 条 + 新增规则全绿
- [ ] 明暗主题各走一遍完整流程（打开→改→提交→看图谱→终端）
- [ ] 无 console 报错；错误路径（hook、锁、超时、断连、冲突）各有 UI
- [ ] 行级暂存夹具：CRLF、无末尾换行、新增文件、删除文件、mode 变更 5 类全过
- [ ] 同步 `docs/` 全部 8 篇 + `plan/E2E-流程.md` + 本文件勾选

---

## 进度风险与砍项

**先砍的顺序**（从下往上砍，砍一项就在本文件标注"本期不做"）：

| 顺序 | 砍什么 | 省 | 影响 | 是否有替代 |
| --- | --- | --- | --- | --- |
| 1 | M4-6 Markdown 预览 | 0.5 | 只能看源码 | 有：编辑器里读 Markdown 原文 |
| 2 | M4-5 `Cmd+P` | 0.5 | 找文件靠树 | 有：树 + 展开 |
| 3 | M4-2 三方冲突视图 | 1.0 | 冲突只能整文件取舍 | 部分：SCM 里看到 `U` 状态，用终端解决 |
| 4 | M4-3 stash 面板 | 0.75 | stash 走终端 | 有：终端 `git stash` |
| 5 | M3-8 过滤、M3-7 虚拟节点 | 1.0 | 图谱只能顺序看 | 无（可接受） |
| 6 | M4-4 搜索面板 | 1.0 | 仓库内搜索靠终端 `rg` | 有：终端 |
| 7 | M4-1 行级暂存 | 1.5 | 只能整文件暂存 | 无（这是 P1 的核心增量，砍它等于承认"不是完整平替"） |

**绝不能砍**：M0 全部（没骨架什么都没）、M1-1～M1-5 与 M1-8（看/改/存是唯一不可替代的价值）、M2-1（硬化串，安全底线）、M2-2（status 解析，一切都是它的下游）、M2-4/M2-6（暂存与提交）、M3-1～M3-3（图谱本体）、`check.mjs` 与体积断言、所有错误路径 UI。

**进度风险**

| 风险 | 概率 | 影响 | 处置 |
| --- | --- | --- | --- |
| M4-1 行级暂存反复（CRLF/mode/新增/删除） | 高 | +1.5 人日，阻塞 M4-2 | 先做整 hunk；行区间放最后；每次写完回读 `--cached` 校验，失败即回滚 |
| M3-2 移植布局与上游行为不一致 | 中 | +1 人日 | 用上游仓库的真实提交图做夹具（≥3 个仓库），逐行对拍 `lane/segments` |
| M3-9 病态拓扑（lane 不闭合）布局 4 s | 中 | 图谱卡死 | 活跃 lane >200 截断 + 超时退化列表；这两条在 M3-9 强制验收 |
| M4-7 macOS watcher 只报 rename / fd 耗尽 | 中 | 刷新错乱 | 一律当"目录变了"；失败即 `stopped` 退回 1500 ms 轮询（契约已定义） |
| M1-6 语言白名单把 bundle 顶过 1.2 MB | 中 | 构建红 | 先装 6 语言跑通，再按真实仓库扩展；每次构建记录 gzip 基线 |
| 契约在 M2 期间变更（字段/错误码） | 中 | 返工 datasource + UI | 契约改动必须同提交改 `docs/remote-contract.md` + `shared/contract.js`；本包只跟不改 |
| DSH 升级导致 Remote/slot API 变化 | 低 | M0-3/M0-4 返工 | 契约集中 `contract.js`；启动自检失败时降级为信息卡，不崩面板 |

---

## 依赖顺序图

```text
M0-1 ─┬─► M0-2
      ├─► M0-3 ─┬─► M0-4 ─┬─► M0-5 ─► M0-6 ─┐
      │         │         ├─► M0-7          │
      │         │         └─────────────────┤
      │         ├─► M0-8 ◄──────────────────┘
      │         └─► M0-9
      │
      └────────────► M1-1 ─► M1-2 ─► M1-3 ─┬─► M1-8 ─► M1-12
                          M1-5 ─► M1-6      ├─► M1-9
                          M1-5 ─► M1-7      └─► M1-11
                          M1-5 ─► M1-10
                          M1-1 ─► M1-4

M1-3 ─┬─► M1-8 ─┐
      │         ├─► M2-1 ─► M2-2 ─┬─► M2-3
      │         │                 ├─► M2-4 ─┬─► M2-5
      │         │                 │         ├─► M2-6
      │         │                 │         └─► M2-10 ─► M2-13
      │         │                 └─► M2-7
      │         └─► M2-8 ─► M2-9
      └─► M2-11 / M2-12（可与 M2-4 并行）

M2-1 ─► M3-1 ─► M3-2 ─► M3-3 ─┬─► M3-4
                               ├─► M3-7
                               ├─► M3-8
                               └─► M3-10
                    M3-1 ─► M3-5 ─► M3-6（M3-6 另需 M2-9）
                    M3-2 ─► M3-9

M2-4 + M2-8 ─► M4-1 ─► M4-2
M2-7 ─► M4-3        M1-1 ─► M4-4 / M4-5
M1-6 ─► M4-6        M2-10 ─► M4-7
M2-9 + M3-3 ─► M4-8 ─► M4-9 ─► M4-10 ─► M4-11
```

关键路径：`M0-1 → M0-3 → M0-4 → M0-8 → M1-1 → M1-3 → M1-8 → M2-1 → M2-2 → M2-4 → M2-8 → M2-9 → M3-1 → M3-2 → M3-3 → M4-8 → M4-10 → M4-11`。

---

## 人日汇总

| 里程碑 | 区间 | 点估 | 累计（乐观 / 点估 / 保守） |
| --- | --- | --- | --- |
| M0 | 4–5 | 5.0 | 4 / 5.0 / 5 |
| M1 | 7–9 | 8.0 | 11 / 13.0 / 14 |
| M2 | 9–12 | 10.5 | 20 / 23.5 / 26 |
| M3 | 8–10 | 8.5 | 28 / 32.0 / 36 |
| M4 | 8–10 | 8.5 | 36 / 40.5 / 46 |

与 `MINI-VSCODE-PLAN.md` §6 一致：M0 4–5、M1 7–9、M2 9–12、M3 8–10、M4 8–10，累计 **36–46**。
只做 M0–M2 = 20–26 人日（可交付"能看能改能提交"，无图谱、无行级暂存）。
