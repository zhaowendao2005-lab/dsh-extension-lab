# Remote 契约（`ide` namespace）

> 双端唯一接口面：`shared/contract.js`（zod）声明，Host 侧 `backend/contract.js` 组装 Typert 描述符，Client 侧由 `ctx.remote.$mount(remoteInfo)` 挂载后 `ctx.remote.ide.execute(request)` 调用。
> 本文是**规格即实现**：字段名、错误码、分页语义、并发语义都按此写，改动必须同步三处（本文 / `shared/contract.js` / `docs/` 引用方）。

## 0. 传输形状

单个动作入口（与仓库内 `pluginDev` 同形，`invocation.kind:'direct'`）：

```js
// 请求
{
  sessionId: string,        // 用于解析默认根目录；不是权限来源
  action: string,           // "files.read"
  payload: object           // 按 action 定义，严格校验，多余字段报错
}

// 成功
{ ok: true,  data: { … , seq?: number, version?: string } }
// 失败
{ ok: false, error: { code: ErrCode, message: string, detail?: object } }
```

- **无 sessionId 亦可用**（面板是 root scope）；此时根目录取最近活跃会话的 `cwd`。
- 所有动作都是**幂等查询**或**显式命令**；查询不得有副作用。
- 命令成功不代表 UI 内容已是最新：命令返回值只带「足够让客户端定位增量」的信息（`seq`/`version`/`hash`），刷新由客户端显式再查。

`ErrCode` 全集：

| code | 语义 | 客户端表现 |
| --- | --- | --- |
| `E_NO_ROOT` | 尚未选定工作区根目录 | 空态引导 |
| `E_NOT_DIR` | 路径不存在或不是目录 | 输入框红字 |
| `E_OUTSIDE_ROOT` | 解析后越出根目录 | 拒绝 + 提示 |
| `E_NOT_FOUND` | 文件/提交/分支不存在 | 行级错误 |
| `E_VERSION_CONFLICT` | 写盘版本不匹配（`detail.currentVersion`） | 冲突对话框 |
| `E_NOT_A_REPO` | 目录不是 git 仓库 | SCM 空态 + 初始化按钮 |
| `E_GIT_MISSING` | 找不到 git 可执行文件 | SCM 页说明 |
| `E_GIT_FAILED` | git 退出码非 0（`detail:{code, argv, stderr, reason}`） | 错误条 + 可展开 |
| `E_TIMEOUT` | 命令超时被 kill | 错误条 + 重试 |
| `E_CANCELLED` | 被新的同类操作取消 | 静默 |
| `E_TRUST_REQUIRED` | 未信任工作区执行了写/执行类动作（`detail.reason: 'write'\|'terminal'\|'network'\|'watch'`） | 按 reason 弹对应确认框 |
| `E_PERMISSION` | 权限不足（`EACCES`/`EPERM`，`detail.syscall`） | 行级/条级提示，不伪装成"不存在" |
| `E_INVALID_ARG` | payload 语义非法（空 `paths[]`、空 message、非法 ref 名、非法路径字符；`detail.field`） | 输入框红字，不发命令 |
| `E_TOO_LARGE` | 文件/结果超上限（`detail.limit`） | 降级提示 |
| `E_BINARY` | 二进制文件（`detail.bytes`） | 只读 hex 视图（P2）/提示 |
| `E_LIMIT` | 达到并发/数量上限 | 排队提示 |
| `E_TERMINAL_GONE` | 终端已被回收 | 自动重建 tab |
| `E_UNSUPPORTED` | 能力不存在（如旧 DSH 无 `subprocess.spawnTerminal`） | 置灰 + 说明 |

## 1. 限制参数（`limits`，Host 下发，客户端只读）

```js
{
  readLinesDefault: 2000,      // files.read 默认行数
  readLinesMax: 20000,         // 单次上限
  readBytesMax: 16 * 1024 * 1024,   // 二进制/整读上限
  writeBytesMax: 8 * 1024 * 1024,   // 单次写盘上限
  dirEntriesMax: 5000,         // 单目录条目上限（超出 truncated）
  logPageDefault: 2000,        // git.log/graph 单页提交数
  logPageMax: 20000,
  diffBytesMax: 4 * 1024 * 1024,    // 单次 diff 文本上限
  diffLinesMax: 50000,
  searchMaxResults: 2000,
  statusTimeoutMs: 8000,
  gitTimeoutMs: 20000,
  terminalBufferBytes: 512 * 1024,
  largeFileBytes: { full: 262144, noFold: 2097152, noSyntax: 10485760, readonly: 20971520 },
  statusPollMs: 1500,          // 客户端轮询建议值
  longLineChars: 10000         // 单行超过它：关软换行与语法高亮（VS Code LONG_LINE_BOUNDARY）
}
```

## 2. workspace

### `workspace.resolve`
默认根目录：若 Host 记着上次根目录且仍存在 → 用它；否则取最近活跃会话（`ctx.sessionController`，`updatedAt` 最大且有 `cwd`）的 `cwd`。
```js
payload: {}
→ { root: string|null, name: string|null, trust: 'trusted'|'untrusted'|'unknown',
    recents: string[], limits }
```

### `workspace.open`
```js
payload: { root: string }                  // 绝对路径，必须存在且是目录
→ { root, name, trust }
错误: E_NOT_DIR | E_OUTSIDE_ROOT(当 root 在禁区内，如 /dev)
```

### `workspace.state`
```js
payload: {}
→ { root, name, trust,
    git: { available: boolean, isRepo: boolean, branch: string|null, head: string|null, bare: boolean,
           version: string|null,      // `git --version` 归一后的 "2.39.3"；<2.15 时 porcelain v2 不可用 → UI 提示升级
           shallow: boolean,          // 浅克隆：log 不完整，图谱显示"历史不完整"
           repoEpoch: string|null },  // 与 git.status 的 repoEpoch 同算法；非仓库为 null
    limits, sessionId: string|null }
```
> 面板每次获得焦点、以及 Remote 重连后调用此动作做一次对齐。

### `workspace.trust`
```js
payload: { root: string, trusted: boolean }
→ { root, trust }
```
信任状态存插件自己的 `storageDomain`（键 `workspace_ide/trust`，值为 `{ roots: { [path]: 'trusted'|'untrusted', updatedAt } }`），不写仓库文件。
**精确匹配**：信任按 `realpath` 后的**完整路径**相等判定，不递归子目录（父目录受信任的子目录仍需单独信任）；撤销信任不中断进行中的操作，但后续每次调用重新判定。
**未信任时的限制**：`files.write/create/rename/delete`、`git.stage/unstage/discard/commit/checkout/stash`、`terminal.create` 全部返回 `E_TRUST_REQUIRED`；`git.*` 读动作可用但强制硬化参数 + 不启用 hooks。
**门禁在 Host**：UI 里的确认弹窗只是 UX，真正的判定发生在 `backend/service.js`（客户端每次调用都会被重新校验；`terminal.create` 亦同）。
**未信任时的 diff**：`git.diff` 仍可用，但可能只给摘要（`truncated:true` / 无 hunk），因为外部 filter 驱动被禁用——UI 必须说明"未信任，仅显示摘要"。清空 filter 只针对**该仓库声明过的** filter 名（读 `.gitattributes`），**永远不要无条件清 `filter.*`**（git-lfs 依赖它）。
**UI 呈现态不进 Remote**：面板高度、折叠、活动视图、标签顺序等存在插件 `storageDomain` 的 `workspace_ide/ui.*` 键下（客户端直接读写），契约不定义它们，Host 也不关心。

## 3. files

所有 `path` 都是**工作区相对路径**（用 `/` 分隔）；Host 统一 `path.resolve(root, rel)` 后校验仍在 root 之下（含符号链接的真实路径校验），否则 `E_OUTSIDE_ROOT`。

### `files.list`
```js
payload: { path?: string, refresh?: boolean }   // 省略 = 根目录
→ { path, entries: [{ name, type: 'file'|'directory'|'symlink'|'other',
                      size?: number, mtime?: number,
                      hasChildren?: boolean,   // 目录是否有子项：免掉"点开才知道是空"
                      ignored?: boolean,       // P1 .gitignore 命中；P0 可缺省
                      target?: string|null }], // symlink 指向（展示用；越界给 null）
    truncated: boolean, version: string }        // version = 目录 mtime+条目数 的哈希，客户端据此判断是否需要重列
```
- 只列一层（懒加载）；不排序（客户端排序 + 目录优先）。
- Host 侧缓存 500 ms；`refresh:true` 跳过缓存。
- 不做 `.gitignore` 过滤（P0）；P1 加 `ignored:boolean` 标记字段（**可选字段，客户端必须容忍缺省**）。
- **符号链接**：Host **从不跟随**（只报 `type:'symlink'` + `target`）；`realpath` 解析带深度上限 32 与祖先链去重，成环报 `E_LIMIT`（`detail.reason:'symlink-loop'`）。
- 根目录显示名由 `workspace.state.name` 提供，`files.list` 根响应不重复带。

### `files.stat`
```js
payload: { path: string }
→ { path, type, size, mtime, version, eol: 'lf'|'crlf'|'mixed'|null, bom: boolean,
    binary: boolean, encoding: 'utf8'|'other',
    writable: boolean, mode: number }            // 只读文件要能提前禁用保存，而不是等 write 失败
```
`version` = `sha1(size|mtimeMs|inode)` 短串，写盘时作 `expectedVersion` 用。

### `files.read`
```js
payload: { path: string, offset?: number /*行号 1-based*/, limit?: number,
           expectedVersion?: string }   // 续取时传首页版本；文件已改写则 E_VERSION_CONFLICT
→ { path, version, offset, lines: number, text: string, eof: boolean,
    eol, bom, binary: false, totalLines: number|null }
```
- 按**行**分页，`limit` 上限 `readLinesMax`；跨页用返回的 `offset + lines` 续取并带 `expectedVersion`，版本不一致时整体重载，**不许把两页拼在一起**。
- `totalLines` 只在文件 ≤ 2 MB 时给（否则 `null`，客户端显示「更多」）。
- 二进制（含 NUL 或非法 UTF-8 比例超阈值）→ `E_BINARY`。
- 超过 `largeFileBytes.readonly` → `E_TOO_LARGE`（客户端给「以只读方式打开前 N 行」的入口，走 `files.read` + `limit` 仍允许）。

### `files.write`
```js
payload: { path: string, text: string, expectedVersion: string|null, create?: boolean,
           force?: boolean }   // force：用户明确选择覆盖时用，且要求 trusted；不给就是硬冲突
→ { path, version, savedAt, bytes }
错误: E_VERSION_CONFLICT { currentVersion } | E_TOO_LARGE | E_TRUST_REQUIRED
```
- `expectedVersion:null` 表示「文件必须不存在」（新建）；写已存在文件必须传版本。
- 原子写：同目录 `.<name>.tmp-<rand>` → `rename`；保留原文件 mode 与 mtime 不保留（新 mtime 必然变）。
- 写前重新 `stat` 校验版本（TOCTOU 窗口最小化）。
- 文本必须按原 `eol`/`bom` 还原后再写（客户端传**已还原的原始字节文本**；Host 用 `binary:false` 语义直接 `writeFile(utf8)`）。
- 所有写操作进 `service` 级**每路径串行队列**。

### `files.create`
```js
payload: { path: string, kind: 'file'|'directory', text?: string }
→ { path, kind, version }
错误: E_NOT_FOUND(父目录不存在) | E_VERSION_CONFLICT(已存在)
```

### `files.rename`
```js
payload: { from: string, to: string }
→ { from, to, version }
错误: E_NOT_FOUND | E_VERSION_CONFLICT(目标已存在) | E_OUTSIDE_ROOT
```
同名不同大小写在 macOS 上要特殊处理（先在 Host 侧判断 `toLowerCase` 相等则走临时名中转）。

### `files.delete`
```js
payload: { path: string, recursive?: boolean }
→ { path }
```
不做回收站（跨平台不可靠）；UI 必须二次确认，并显示「将删除 N 个文件/目录」。

### `files.search`
```js
payload: { queryId?: number, query: string, include?: string, exclude?: string,
           maxResults?: number, caseSensitive?: boolean, regex?: boolean, wholeWord?: boolean }
→ { queryId?: number,   // 原样回显：客户端据此丢弃乱序到达的旧查询结果
    hits: [{ path, line, column, text, matchStart, matchEnd }],
    truncated: boolean, engine: 'ripgrep'|'system-rg'|'js', elapsedMs }
```
- 引擎顺序：`@vscode/ripgrep` 自带二进制 → `PATH` 里的 `rg` → 纯 JS（限 2000 文件/5 MB 后放弃）。
- 默认排除 `.git/`、`node_modules/`、`.DS_Store`；`include/exclude` 为 glob 字符串。
- 结果路径为工作区相对路径。

## 4. git

前置：`workspace.state.git.available && git.isRepo`，否则一律 `E_NOT_A_REPO` / `E_GIT_MISSING`。

所有 git 命令都由 `backend/git/exec.js` 统一发起：
```js
// 只读（硬化参数）
git --no-optional-locks -c core.fsmonitor=false -c core.pager=cat -c core.hooksPath=<tmpEmpty>
    -c credential.helper= -c core.askPass= -c diff.external= -c core.sshCommand= <args>
// env: { ...process.env, LC_ALL:'en_US.UTF-8', LANGUAGE:'en', GIT_TERMINAL_PROMPT:'0',
//        GIT_OPTIONAL_LOCKS:'0', GIT_PAGER:'cat' }
// 读操作: spawn(argv, {cwd:root}), 超时 statusTimeoutMs/gitTimeoutMs, 输出上限 32 MB
// 写操作: 追加 -c core.hooksPath 用用户配置（信任时），串行队列
```

### `git.status`
```js
payload: { seq?: number }
→ { seq: number,                    // Host 单调递增；客户端丢弃 seq < 已知值的响应
    branch: { name, detached, upstream: string|null, ahead: number, behind: number,
              unborn: boolean, sha: string|null },
    staged:   Change[],   // index  有差异
    working:  Change[],   // worktree 有差异
    untracked: Change[],
    conflicts: Change[],
    operation: 'none'|'merge'|'rebase'|'cherry-pick'|'revert'|'bisect',
    repoState: { merging: boolean, rebasing: boolean, cherryPicking: boolean, reverting: boolean,
                 sequencer: boolean },
    stashCount: number,   // 来自 `git stash list --format=%gd | wc`（并入同一次调用: 单独命令，失败不影响主结果）
    isHuge: boolean,      // 上次 status 超时/超量
    untrackedMode: 'all'|'normal'|'none',  // 实际生效的未跟踪统计档位；非 'all' 时 UI 必须标注「未跟踪文件未计全」
    repoEpoch: string,    // 仓库「代号」= sha1(root|branch|HEAD sha|unborn) 前 12 位；变化即整代作废
    elapsedMs: number }

Change = { path, origPath?, status: 'M'|'A'|'D'|'R'|'C'|'T'|'U'|'?',  // U=冲突
           mode: { head?: string, index?: string, worktree?: string },
           stages?: [string, string, string],   // 仅冲突：`u` 行的 m1/m2/m3（base/ours/theirs）模式
           renameScore?: number, isSubmodule: boolean, isUntracked: boolean }
```
解析规则（`--porcelain=v2 -z`）：`1` 普通变更、`2` 重命名（紧跟一段 origPath）、`u` 冲突（四路 mode）、`?` 未跟踪、`!` 忽略。
- 同一文件可同时出现在 `staged` 与 `working`（如 `MM`）——**不去重**。
- 子模块（`mode` 为 `160000`）→ `isSubmodule:true`，UI 显示为目录条目，不提供逐行 diff。
- 命令固定：`status --porcelain=v2 -z --branch --untracked-files=all`。
- 降级：超时/超量时按 `all → normal → none` 降一档，`untrackedMode` 回传实际档位；UI 必须据此标注「未跟踪文件未计全」，不许静默。

### `git.init`
```js
payload: { defaultBranch?: string }      // 仅用户显式确认后调用
→ { seq }
```
- UI 必须先弹确认（「此目录不是 git 仓库，要初始化吗？」），Host 侧再校验目标目录为空或已存在且未被 `safe.directory` 拦截。
- 不自动执行：任何其它动作发现 `E_NOT_A_REPO` 时**不得**顺手 init。

### `git.refs`
```js
payload: {}
→ { head: { ref, sha, detached },
    local: [{ name, sha, upstream: string|null, ahead: number, behind: number, current: boolean,
              upstreamGone?: boolean }],     // %(upstream:track) 含 [gone]
    remote: [{ name, sha, remote, url?: string|null }],      // origin/main 等；url 仅供展示，任何动作都不得接受它当参数
    tags: [{ name, sha }],
    defaultBranch: string|null,           // 由 origin/HEAD 或 init.defaultBranch 推断
    truncated: boolean }
```
命令：`for-each-ref --format='%(refname)%09%(objectname)%09%(objecttype)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)'`，上限 2000 refs。

### `git.log`
```js
payload: { maxCount?: number, skip?: number, refs?: 'all'|string[], path?: string,
           search?: { query: string, mode: 'message'|'author'|'hash' } }
→ { commits: Commit[], nextSkip: number, hasMore: boolean, totalKnown: number|null }

Commit = { hash, shortHash, parents: string[], authorName, authorEmail, authorAt, committerAt,
           subject, refs: [{ type:'branch'|'tag'|'remote'|'head', name, isHead }] }
```
- 格式串**必须多字符哨兵**（subject 里可能出现 `\x1f`）：
  `--format="%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D"` **不可与 `-z` 同用** → 用 `%x00` 分隔 + `%x1e`（RS）作记录分隔，逐字节解析；或 `-z` + 多字符文本哨兵（实现任选其一，**但必须写进代码注释**并配 0 坏行断言）。
- 默认 `--all --date-order`；`path` 时追加 `-- <path>`。
- 分页用 `--max-count` + `--skip`；**skip 会重跑解析**，超过 5 万条时 Host 缓存「已解析提交数组」按 `(refs, path, search)` 键失效。

### `git.graph`
```js
payload: { maxCount?: number, skip?: number, refs?: 'all'|string[], path?: string,
           search?: { query: string, mode: 'message'|'author'|'hash' } }   // search 为 P1 预留，形状同 git.log
→ { rows: GraphRow[], commits: Commit[], nextSkip, hasMore, layoutMs,
    maxLane: number,              // 本次结果用到的最大列号（图列宽 = maxLane+1）
    totalKnown: number|null,      // 已知总数（null = 未统计，UI 显示「已加载 n+」）
    layoutEpoch: string }         // = sha1(repoEpoch|refs|path|maxCount|skip|布局算法版本)；变化即前缀不可复用

GraphRow = {
  hash: string,
  parents: string[],             // 供「跳到父提交」；与 commits[i].parents 同源
  lane: number,                  // 该提交圆点所在列
  segments: [{ from: number, to: number, kind: 'passthrough'|'merge'|'fork' }],  // 该行行带内到下一行顶边的线段
  color: number,                 // 泳道配色索引（客户端映射到主题色，不传色值）
  degraded?: boolean             // 该行线段被压上限后合并过（只影响读屏文案，不提示用户）
}
```
- **布局在 Host 计算**（`backend/git/layout.js`，移植 `git-graph-plus` 的 `git-graph-builder.ts`，Apache-2.0，保留版权头）：输入必须拓扑有序（`--date-order` 保证），输出 `lane + segments`；单行 `segments` 上限 12，超出合并为 `passthrough`。
- 布局结果按 `(refs,path,maxCount,skip)` 缓存，`commits` 引用不变则复用；分页追加时**只对增量重算尾部 200 行**并保留已发前缀（不复用旧前缀 = 行号漂移）。
- **行带模型**：`segments[].from/to` 是行带内的 lane 槽位（不是像素），`kind` 决定曲率；不变量「上一行底边 lane 集合 = 下一行顶边 lane 集合」由 Host 保证，客户端据此把同 lane 竖直段合并成 run 再画 path。
- 悬空 lane 回收：**仅当**该 lane 活跃超过 200 行**或**其父提交已不在已加载窗口时才释放（无条件释放会切断 `--date-order` 下健康的长寿分支，导致图谱"断头"）。
- 单行 `segments` 上限 12：超出时按 `merge` → `fork` → `passthrough` 的次序合并（被合并的行标 `degraded:true`）。
- `search`（P1）：只过滤**列表**与命中高亮，`rows` 仍按全量顺序返回，客户端不重排布局（避免行号漂移）。
- 客户端拿到 `rows` 只做「可视区间切片 + SVG 生成」，不重算布局。

### `git.commit`
```js
payload: { hash: string }
→ { hash, parents, author: {name,email,at}, committer: {name,email,at},
    subject, body, refs: [...],
    stats: { files: number, additions: number, deletions: number },
    files: [{ path, status: 'M'|'A'|'D'|'R'|'C', additions: number, deletions: number, origPath? }],
    truncated: boolean }
```
命令：`show -s --format=… <hash>` + `show --name-status --numstat -z --format= <hash>`。

### `git.diff`
```js
payload: { target:
             | { kind: 'working', path?: string }      // 工作区 vs index
             | { kind: 'index',   path?: string }      // index vs HEAD
             | { kind: 'commit', hash: string, parent?: number, path?: string }
             | { kind: 'range', from: string, to: string, path?: string }
             | { kind: 'untracked', path: string },    // 未跟踪文件：整文件视为新增
           context?: number, ignoreWhitespace?: boolean }
→ { target, isBinary: boolean, truncated: boolean,     // truncated = 整体被截断
    files: [{ path, origPath?, status, additions, deletions, hunks: Hunk[],
              truncated?: boolean }],                  // 单文件被截断（其余文件仍完整）
    text?: string,                // truncated=true 时给原始文本头部（可选）
    elapsedMs }

Hunk = { header: '@@ -a,b +c,d @@', oldStart, oldLines, newStart, newLines,
         oldNoEol?: boolean, newNoEol?: boolean,       // 该侧末尾缺换行（`\ No newline at end of file`）
         lines: [{ type: ' '|'-'|'+', text, oldNo: number|null, newNo: number|null,
                   noNewline?: boolean }] }             // 行级标记只在标记行落在 hunk 中间时用
```
- Host 直接解析 unified diff 成结构（客户端不再解析文本），上限 `diffBytesMax`/`diffLinesMax`，超出 `truncated:true` 且只返回首个文件的前 N 行。
- 二进制/较大文件 → `isBinary`/`truncated`，UI 显示摘要。
- `kind:'untracked'` 由 Host 内部转成 `diff --no-index /dev/null <path>`（退出码 1 视为成功），客户端不必区分。
- `context: -1` = **整文件上下文**（每文件一个覆盖全篇的 hunk），供两栏 diff 还原左右全文；同样受 `diffBytesMax`/`diffLinesMax` 约束，超限 `truncated:true`（此时两栏 diff 必须降级为单栏 hunk 视图）。
- **行号基准**：`oldStart`/`newStart` 1-based，语义与 unified diff 完全一致（纯插入 hunk `oldLines:0`、纯删除 `newLines:0`；`oldNo/newNo` 为 `null` 的行不参与跳转定位）。
- **换行归一**：diff 文本在显示层统一为 LF；原文件的 CRLF/LF 只用于写入时的还原（见 `files.stat.eol`），不改 diff 语义。
- 子模块 diff 只给 `-Subproject commit …/+Subproject commit …` 两行。

### `git.stage` / `git.unstage` / `git.discard`
```js
git.stage   payload: { paths: string[], all?: boolean }        → { staged: number, seq }
git.unstage payload: { paths: string[], all?: boolean }        → { unstaged: number, seq }
git.discard payload: { paths: string[], untracked?: string[], all?: boolean } → { discarded: number, seq }
```
- `all:true` = 对该组全部条目操作（`paths` 忽略）；分组标题上的「全部暂存/取消暂存」用它，避免客户端拼上百个路径。
- stage：`add -- <paths>`（删除的文件用 `add -A -- <paths>` 覆盖）；`all:true` 时 `add -A`。
- unstage：`reset -q HEAD -- <paths>`（无 HEAD 的新仓库用 `rm --cached -- <paths>`）；`all:true` 时 `reset -q HEAD`（无 pathspec；无 HEAD 用 `rm --cached -r -- .`）。
- discard：已跟踪 → `checkout -- <paths>`（无 HEAD 时 `rm --cached` + 删文件）；未跟踪 → 逐文件删除（**不走 `git clean -f`**，避免误删忽略文件旁路）。`all:true` 同样逐文件执行，不做批量 `checkout .`（那会把用户没看见的改动一起丢）。
- 全部进写队列；返回后客户端必须重查 `git.status`。

### `git.commitCreate`
```js
payload: { message: string, amend?: boolean, signoff?: boolean,
           paths?: string[],          // 仅提交这些路径（add 后 commit -- <paths>）
           allowEmpty?: boolean, noVerify?: boolean }
→ { hash, seq }
错误: E_GIT_FAILED { detail.code, detail.stderr }   // 典型：无 user.email、hook 拒绝、nothing to commit
```
命令：`commit -F -`（message 从 stdin 传入，**不走 argv**，避免引号/换行问题）。

### `git.checkout`
```js
payload: { ref: string, create?: string, force?: boolean, detach?: boolean, paths?: string[] }
→ { head: string, branch: string|null, seq }
```
- `paths` 存在 → 文件恢复语义（`checkout -- <paths>`），不切分支。
- 切分支前 Host 检查 working tree 是否干净；不干净时返回 `E_GIT_FAILED`（由 UI 提示「先提交或 stash」），**不自动 stash**。

### `git.branch` / `git.tag`（P1 起）
```js
git.branch payload: { action:'create'|'delete'|'rename', name, newName?, force?, startPoint? }
git.tag    payload: { action:'create'|'delete', name, target?, message? }
→ { seq }
```

### `git.stash`（P1）
```js
payload: { action: 'list' } → { entries: [{ index, name, message, hash, at }], seq }
payload: { action: 'push'|'pop'|'apply'|'drop', index?: number, message?, includeUntracked? } → { seq }
```

### `git.stageHunk`（P1）
```js
payload: { path: string, hunkIndex: number, mode: 'stage'|'unstage',
           selection?: { fromLine: number, toLine: number },   // 行级时给
           expectedIndexSha?: string }                          // 可选并发前置：index 里的 blob 已变则直接 E_VERSION_CONFLICT
→ { seq }
```
实现（**唯一允许的 hunk 暂存路线**）：
1. 取目标 hunk 的统一 diff 片段，构造「只含该片段的 patch 文本」；
2. `git hash-object --stdin -w --path <rel>` 得到 blob sha；
3. 用 `git apply --cached` **以外的**方式：把该 blob 写入 index 需构造完整文件内容——因此实际做法是「读原文件 → 应用该 hunk → hash-object → `update-index --cacheinfo <mode>,<sha>,<rel>`」；
4. 回读 `git diff --cached -- <path>` 校验命中行数与预期一致，否则 `update-index` 回滚到原 sha。
> **禁止** `git apply --cached --3way`（失败会在 index 留冲突标记）与 `--cached --recount` 静默兜底。

### `git.network`（P2，默认在 UI 上关闭）
```js
payload: { action:'fetch'|'pull'|'push', remote?: string, branch?: string, setUpstream?: boolean }
→ { ok: boolean, output: string, seq }   // 只在用户显式点击且已信任时可用；超时 120 s；必须 `--progress` 或 `--porcelain`
```
- `remote` **只能是仓库里已配置的 remote 名**（先与 `git.remote` 列表比对），不接受 URL / `file://` / `ssh://`——否则这个动作就成了任意网络出口。
- 默认全部关闭：没有 `git.network` 之外的动作能触网；`E_TRUST_REQUIRED.detail.reason='network'` 表示需要单独授权。

## 5. terminal

```js
terminal.create payload: { cwd?: string, shell?: string, cols: number, rows: number }
→ { terminalId: string, pid: number, shell: string, title: string }

terminal.write  payload: { terminalId: string, data: string }        → { accepted: number }
terminal.resize payload: { terminalId: string, cols: number, rows: number } → {}
terminal.poll   payload: { terminalId: string, offset: number }
→ { data: string, offset: number, dropped: boolean,
    exited: boolean, exitCode: number|null, title: string|null }
terminal.close  payload: { terminalId: string }                      → {}
terminal.list   payload: {}                                          → { terminals: [{terminalId, pid, shell, title, createdAt, exited}] }
```

- `create`：`cwd` 缺省 = 工作区根；`shell` 缺省 = `subprocess.terminalEnvironment().defaultShell`；env 继承 `subprocess.terminalEnvironment()` + `TERM=xterm-256color`。
- 目标 shell 不可用 → `E_UNSUPPORTED` + `detail.reason:'shell-unavailable'`（客户端展示可选的 shell 列表）。
- `terminal.rename` 为 **P1**（本期标签改名只存客户端呈现态）。
- `terminal.list` 不返回缓冲游标：刷新后客户端对每个已知 id 先 `poll(offset:0)` 一次，据 `dropped` 判断旧内容是否已被截断。
- 环形缓冲 512 KB（`terminalBufferBytes`）；`offset` 是**字符偏移（UTF-16 code unit，字符串长度口径）**，不是字节；`dropped:true` 表示客户端落后超过缓冲，需 `offset = 返回的 offset` 并提示「输出已截断」。缓冲内部丢弃的字符数只进 Host 调试日志，**不上 wire**。
- `terminal.write` 单次 `data.length ≤ 65536`（超限 `E_TOO_LARGE`，客户端分段发）；`terminal.resize` 在 shell 不支持改尺寸时静默成功（不报错）。
- **Host 必须剥离 OSC 0/2 标题序列**后再进缓冲（否则屏流会被标题污染，xterm 端也无法自愈）。
- `terminate()` 后置 `exited`；`poll` 仍返回剩余数据；`close` 后再 poll → `E_TERMINAL_GONE`。
- 空闲 30 min 由 Host 回收；`list` 用于浏览器刷新后的对账（客户端没有的 id 就 close）。
- **不实现**：终端复用官方 `ctx.webTerminals`（hold 冲突，见 ARCHITECTURE）；终端不走 Remote 流式推送（P1 再评估）。

## 6. watch（P1）

```js
watch.start payload: { kinds: ['workspace','git'] }  → { token: string, epoch: number }
watch.poll  payload: { token: string, offset: number }
→ { events: [{ kind: 'git-status'|'dir'|'file', path?: string, at: number }],
    offset: number, dropped: boolean, stopped: boolean,   // stopped=true 表示 watcher 失效（fd 上限/网络盘/不支持）
    reason?: 'limit'|'error'|'fs-events-unsupported'|'network-volume' }
watch.stop  payload: { token: string } → {}
```
- Host 侧合并同类事件（1000 ms debounce + 未完成则丢弃），`dropped:true` 时客户端全量刷新。
- `stopped:true` → 客户端退回 1500 ms 轮询并显示「自动刷新已降级」。

## 7. 并发与取消语义

| 规则 | 说明 |
| --- | --- |
| 同一仓库的 git **写**操作串行 | `service` 内按 `root` 维护 promise 队列；新写操作排队，排队超 30 s 返回 `E_LIMIT` |
| git **读**操作并发 ≤ 2 | 超出排队；`git.status` 有「进行中则复用同一 promise」的去重（避免轮询堆积） |
| 文件写 | 按 `path` 串行；不同文件可并发 |
| 刷新类查询去重 | `git.status` / `files.list` 相同参数在 300 ms 内的重复请求返回同一 promise 结果 |
| 取消 | 客户端不显式 cancel；新请求到达时旧同类请求被 `kill`（`E_CANCELLED`）——仅用于 `git.status` 与 `files.read` |
| 整代作废 | 响应里的 `repoEpoch` 与客户端当前值不同 → **丢弃该响应**（切分支/切根目录/重新 init 后，所有在途响应与缓存一起失效；比逐个比 `branch.sha` 可靠） |
| 超时 | git 命令 `gitTimeoutMs`（status 用 `statusTimeoutMs`）；超时后 `SIGTERM` → 500 ms → `SIGKILL`；子进程组一起杀（`detached:true` + `kill(-pid)`） |

## 8. 客户端调用约定

```js
// frontend/stores/*.datasource.ts
async function call(action, payload) {
  const res = await remote.execute({ sessionId: sessionStore.currentId ?? '', action, payload })
  if (!res.ok) throw new IdeError(res.error)      // IdeError 带 code，供 UI 分类
  return res.data
}
```
- 错误处理分三层：`E_CANCELLED` 静默；`E_VERSION_CONFLICT`/`E_TRUST_REQUIRED` 走受控对话框；其余进错误条（可折叠 detail）。
- 任何 datasource 都不得吞掉 `ok:false` 变成 `null`。
- **未实现能力的统一约定**：按钮 `disabled` + `title`/tooltip 走 `common.unsupported`（文案表见 `docs/ui-spec.md`），绝不做成"点了没反应"；契约里标注 P1/P2 的动作即视为未实现。

## 9. 变更记录

| 版本 | 变更 | 兼容性 |
| --- | --- | --- |
| v1 | 初版：workspace / files / git / terminal / watch 五组动作 | — |
| v2 | 增补：错误码 `E_INVALID_ARG`、`E_PERMISSION`；`E_GIT_FAILED.detail.reason`；`workspace.state.git.version/shallow/repoEpoch`；`git.status.untrackedMode`/`repoEpoch` 与 `Change.stages`；`git.diff` 新增 `kind:'untracked'`、`files[].truncated`、行级 `noNewline`；`git.refs` 的 `upstreamGone`/`remote[].url`；`git.stageHunk.expectedIndexSha`；`git.graph.maxLane`/`GraphRow.parents`；`git.stage/unstage/discard` 统一 `all`；新动作 `git.init`；`files.search.queryId` 回显；`files.list` 的 `hasChildren`/`ignored`/`target`；`files.stat.writable/mode`；`files.read.expectedVersion`；`files.write.force`；`limits.longLineChars`；`git.diff` 的 `context:-1` 语义与行号基准；`Hunk.oldNoEol/newNoEol`；`git.graph` 的 `layoutEpoch`/`totalKnown`/`GraphRow.degraded`/行带语义/`search`(P1)；lane 回收改为条件触发；`terminal.write` 64 KiB 上限、OSC 0/2 剥离归 Host、`shell-unavailable`、`terminal.rename`(P1)；`git.network.remote` 限定为已配置 remote 名；`watch.reason` 扩展两种失效原因；trust 精确匹配与「未信任 diff 只给摘要」写进契约 | **只增不改**：老客户端忽略新字段即可，无破坏性变更 |

> 任何新增/修改动作、字段、错误码都必须在本表追加一行——与 `AGENTS.md`「文档同步」要求一致。

## 12. 实现落地时的契约补充（M0–M4，代码为准）

实现过程中有 9 处字段形状必须比 §1–§8 更具体，全部已落到 `backend/contract.js` 的 zod schema；这里记录差异原因，避免下次照旧文档写出会被 `strictObject` 拒绝的请求。

| 动作 | 文档原写法 | 实现 | 为什么 |
|---|---|---|---|
| `git.checkout` | `{target, create?}` | `{ref, force?, create?}` | `target` 与 `git.diff.target` 同名易混；`force` 是「脏工作区强制切换」的唯一开关，必须显式 |
| `git.log` / `git.graph` | 只有分页字段 | 额外接受 `refs?: string[]`、`path?: string` | 图谱要按分支集合与路径过滤；不带 `refs` 时是 `--all` |
| `git.stageHunk` | `hunk.{oldStart,oldLines,newStart,newLines}` | 额外要求 `hunk.stagedText`（应用该块后的**完整文件内容**），`lines` 为纯字符串数组 | Host 用 `hash-object -w` 直接写 blob，不再解析补丁；由客户端算好目标内容，避免 Host 端再做一次「打补丁」实现 |
| `git.discard` | `{paths, all?}` | 额外接受 `untracked?: string[]` | 未跟踪文件删除与已跟踪文件回滚是两条完全不同的代码路径（`fs.rm` vs `checkout --`），必须显式区分 |
| `git.stash` | 返回贮藏列表 | `{action:'list', entries:[{ref, subject}]}` | 直接来自 `stash list --format=%gd%x09%s`，Host 不再二次加工 |
| `watch.start` | 返回 `{token}` | 可能返回 `{token: null, stopped:'fs-events-unsupported' \| 'limit'}` | 有些卷/网络盘不支持递归监听；此时不是错误，客户端保持 1500ms 轮询即可 |
| `files.delete` | 文档 §3 用 `files.remove` 措辞 | 动作名统一为 `files.delete` | `delete` 是保留字之外的合法标识符，且与 `fs` 服务对齐；`ACTIONS`、schema、前端三处此前不一致，已统一 |
| `git.checkout` / `git.stage` / `git.unstage` | 只有逐条路径 | 增加 `all?: boolean`（`checkout` 无） | 「全部暂存/全部取消」不该在客户端拼 2000 条路径，Host 侧一次 `add -A` / `reset` |
| 编辑器偏好 | 未涉及 | 存浏览器 `localStorage`（`workspace_ide/ui.layout` 的 `editor` 字段） | 字号/制表/换行是纯显示偏好，写 Host storage 会让每次改动都过一遍 RPC |

另外两条实现级的约束，写在这里防止被当成可选项：

1. **所有写动作都在 Host 侧的单写队列里串行执行**（`backend/git/index.js` 的 `enqueueWrite`）；并发写会让 `.git/index.lock` 变成随机失败。客户端另外有一个 Promise 队列只为「按钮状态」服务，不是正确性保证。
2. **写动作前必须先 `workspace.assertTrusted(...)`**，文件写入用 `'write'`、终端用 `'terminal'`；未信任时返回 `E_TRUST_REQUIRED`，前端只负责提示，不做放行判断。

### 12.1 运行期联调发现的传输层差异（launch 后实测）

上面 9 条是「字段形状」差异；下面 6 条只在真正跑起来之后才暴露，且**不改契约文本就会在下次实现时重犯**。

| 现象 | 根因 | 实现结论 |
|---|---|---|
| 客户端拿到的结果是 `undefined` | `service.execute()` 已经返回 `{ok, data}`，Typert 的 `result.mode:'strict'` 又在外面包了一层 `{ok, value}` | `frontend/service/client.js` 的 `unwrapTransport()` 先剥外层（`response.value.ok`），再按 `{ok, error}` 判成败。**任何新客户端都要做这一层** |
| `workspace.resolve` 的 `trusted` 永远是 `false` | 文档写的是 `trust: {root, trusted}` 对象 | Host 统一返回**布尔** `trusted`；`workspace.trust` 的 payload 只收 `{trusted}`（root 以 Host 当前根为准），传 `{root,trusted}` 会被 `strictObject` 拒绝 |
| 打开目录后状态栏显示「无仓库」 | `workspace.open` 原来只回 root/name | `resolve`/`open`/`state` 都必须带回 `git: {available,isRepo,branch,detached,unborn,version,shallow}`；空态回 `{git:{available:true,isRepo:false}}` |
| 清空分支过滤后图谱报 `refs 数组不能为空` | `normalizeRefsArg(undefined)` 返回 `[]` 继续往下传 | `backend/git/log.js` 的 `normalizeRefs`：空数组等价 `['--all']`（面板的「所有引用」就是这条路） |
| 插件状态（上次根目录、信任列表）重启即丢 | `await import('@deepseek-ai/dsh-storage-domain')` 在插件目录解析不到（npm 只有 `0.0.1-rc.1`，装机是 `0.2.2-rc.2`） | 不再 import 该包，改传**纯 DomainSpec** 给 Host 服务：`ctx.get('storageDomain').open({name:'workspace_ide', version:1, layout:'single', tables:{state:{valueSchema}}})` |
| SCM 顶部误报「进行中：unborn」 | `git status --porcelain=v2` 里新增文件的 head mode 就是 `000000`，被当成「无提交」 | `operation` **只能**来自 `.git` 标记文件（`MERGE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD`/`BISECT_LOG`/`rebase-*`/`sequencer`）；`branch.unborn` 只看 `# branch.oid (initial)` |

还有一条不属契约但属交付面的结论：`dsh.client.inject` 里写的包名必须是 boot 图里真实存在的 row id，写了不存在的包**不会报错，只会让整个客户端 bundle 静默不加载**（本插件第一次 launch 失败的唯一原因）。

### 12.2 M4 追加的三个动作（冲突三方视图与快速打开）

| 动作 | 请求 | 返回 | 说明 |
|---|---|---|---|
| `git.conflict` | `{path}` | `{path, base, ours, theirs, binary, truncated, elapsedMs, seq}` | 三类索引阶段 `:1:`/`:2:`/`:3:`，缺失的一侧为 `null`（add/add、delete/modify 天然如此）；只读 |
| `git.resolveConflict` | `{path, side:'ours'\|'theirs'\|'both'\|'delete'}` | `{path, side, resolved, seq}` | `ours/theirs` 走 `git checkout --ours/--theirs` + `git add`；`both` 由 Host 拼 `:2:`+`:3:` 写盘后 `add`；`delete` 走 `git rm -f`。**写动作**：串行队列 + `assertTrusted('write')` |
| `files.index` | `{maxAgeMs?, limit?}` | `{paths, total, truncated, engine:'git'\|'walk', elapsedMs}` | 快速打开的扁平文件表。有仓库时走 `git ls-files -z --cached --others --exclude-standard`（自带 `.gitignore`、一次子进程），否则退回目录遍历；Host 侧 5 s 缓存，上限 50000 条 |
