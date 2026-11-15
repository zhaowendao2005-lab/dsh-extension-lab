# Git 后端选型 + SCM 面板数据模型 调研

> 范围：DSH 插件「小号 VS Code」的源代码管理面板 —— git 操作后端、状态/刷新架构、面板交互。
> 不涉及：提交图谱渲染、代码编辑器、终端（另有人负责；本文只给图谱的数据接口与联动点）。
> 调研环境：macOS 27.0.1 / Apple Git **2.54.0** / Node **v24.22.1**；所有命令格式与性能数字均为本机实测（`git 2.54.0`，仓库为 `/tmp/gittests` 下临时仓库；性能仓库含 50,000 个跟踪文件 + 10 万个未跟踪文件）。npm 版本与体积取自 registry 实时数据（2026-11）。

---

## 1. 结论先行

**主选：直接 spawn 系统 `git` CLI，自写薄封装层（约 1,200–1,500 行），命令参数与解析器照搬 VS Code `extensions/git/src/git.ts` 的做法。**
理由一句话：本机与用户机器上 git 基本必然存在（VS Code / Xcode CLT / Git for Windows 覆盖率极高），零体积、零 postinstall 网络依赖、天然复用用户的 SSH agent / credential helper / 全局配置；而 dugite 换来的只是"自带一个 git"，代价是 +60.6 MiB 下载、+211 MiB 磁盘、postinstall 联网 + asar unpack + 签名公证链路，对一个插件来说性价比不成立。

**备选：dugite 3.3.3（MIT）作为"检测不到系统 git"时的可选下载项**，而不是默认依赖。前端/设置里提供「使用随插件分发的 git」开关，用户显式开启后才拉 dugite-native tarball。

**明确否掉**：
- `isomorphic-git` 当主力 —— 纯 JS 实现，packfile/index 兼容性与大仓库性能不可控，且维护力量薄弱（见 §3）。
- `nodegit` —— 最后发布 2020-07，原生编译 + ABI 风险。
- `simple-git` 当后端 —— 它只是 CLI 封装，解析层不透明（只给 `StatusResult` 这种聚合结果），我们需要的 hunk/rename score/冲突三阶段信息拿不到；但它是很好的**降级参考实现**。
- **dugite 的 `parseGitStatus`/`gitDiff`/`GitExecutor` 不存在** —— 这是常见误解，实测 dugite v1/v2/v3 的 API 只到「起进程 + 错误分类」（详见 §3.1），状态解析必须自写或移植 VS Code。

---

## 2. 对比表

| 方案 | 版本 / 发布 | License | 安装体积 | 维护状态 | 能否满足 SCM 需求 | 结论 |
|---|---|---|---|---|---|---|
| **系统 git CLI + 自研封装** | 用户自带（本机 2.54.0） | GPL-2.0（仅作为被 spawn 的外部程序，不链接） | 0 B | N/A（git 本身持续维护） | 全部能做，解析器自己写 | **主选** |
| dugite | 3.3.3 / 2026-11-10 | MIT | 包本体 69 KB / 36 文件，**不含 git**；postinstall 下载 dugite-native：macOS arm64 tar.gz **63,505,330 B（60.6 MiB）**，解压 **211 MiB**；Windows x64 tar.gz **47,024,188 B（44.8 MiB）** | 活跃（desktop/dugite） | 只提供进程执行 + 错误分类，**无状态/日志解析** | 备选，按需下载 |
| simple-git | 4.0.2 / 2026-09-26 | MIT | unpacked 871,967 B / 217 文件（dist 1.5 MB，ESM+CJS 双格式） | 活跃 | 高层 API 齐全（status/branch/commit/diff/stash/log/push…），但解析结果是它自己的类型；拿不到 rename score / 未合并三阶段 mode | 参考实现 / 降级选项 |
| isomorphic-git | 1.44.13 / 2026-11-11 | MIT | unpacked 5,089,403 B / 37 文件 | **弱**：原作者已离开，README 自述仅两名志愿者"mainly do code review" | 纯 JS，可做 status/log/commit/checkout；大仓库、packfile、index 兼容性风险高 | 不用 |
| nodegit | 0.27.0 / **2020-07-28** | MIT | unpacked 23,787,734 B / 11,110 文件（含 node-gyp 4.x / node-pre-gyp 0.13 / nan） | **停更** | libgit2 绑定，能力最全 | 不用（ABI/编译地狱） |
| `@napi-rs/git` | 不存在 | — | — | — | — | 无 |
| git-promise / gitte / git-interface | 1.0.0(2020) / 1.0.2(2021-01) / 2.1.2(2022-04) | 无 license 字段 / MIT / MIT | 小 | 停更 | 玩具级 | 不用 |

**"系统 git" vs "分发 dugite" 的 macOS / Windows 取舍**

| 维度 | 系统 git | 随插件分发 dugite |
|---|---|---|
| 体积 | 0 | macOS +60.6 MiB 下载 / 211 MiB 落盘；Windows +44.8 MiB 下载 |
| 版本一致性 | 不可控（Apple Git 常落后 1–2 年；旧版可能无 `-z` 之外的新特性） | 锁定 2.56.1，行为可测 |
| 打包 | 无额外工作 | **必须 `asarUnpack`**：Electron 的 asar 内二进制无法执行（实测参考：WordPress/contributor-toolkit #383 "unpacked from app.asar because a binary cannot execute from inside the archive"） |
| 环境变量坑 | 无 | `LOCAL_GIT_DIRECTORY` / `GIT_EXEC_PATH` 必须**设为空字符串**而不是删除 —— dugite 的 resolver 默认参数直接读 `process.env`，删掉等于没设置（PR #401 实测教训：指向伪路径仍被采纳） |
| 签名/公证 | 无 | macOS 需对 `git` 及 `libexec/git-core` 下大量 helper 二进制签名，否则 notarization 失败 |
| 凭据/SSH | 自动复用用户 credential helper / agent | dugite-native 自带 credential manager（可裁剪），但与用户配置可能冲突 |
| 适用场景 | Host 进程能 spawn 任意子进程（DSH 是 Electron main / Node 24 进程，可以） | 检测不到 git 时的兜底 |

**结论**：默认系统 git；`git --version` 探测失败时提示用户「安装 Xcode Command Line Tools / Git for Windows」或开启「使用内置 Git」（此时才下载 dugite）。

---

## 3. 各方案实测细节

### 3.1 dugite 到底给了什么（重要）

- 3.x 的 `index.d.ts` 导出：`exec`、`spawn`、`parse-error`、`parse-bad-config-value-error-info`、`GitError`、`ExecError`、`git-environment`、`ignore-closed-input-stream`。
- `exec(args: string[], path: string, options?: IGitExecutionOptions): Promise<IGitResult>`；`IGitExecutionOptions` 支持 `env`、`stdin`、`encoding: 'buffer'`、`maxBuffer`（默认 `Infinity`）、`processCallback(child)`、**`signal: AbortSignal`**、`killSignal`（默认 `SIGTERM`）。
- `GitError` 是 59 项的枚举，配一张 `GitErrorRegexes` 正则表，可把 stderr 映射成 `LockFileAlreadyExists(36)` / `PushNotFastForward(11)` / `PatchDoesNotApply(26)` / `UnsafeDirectory(57)` / `NotAGitRepository(29)` 等语义错误 —— **这部分值得照抄思路**（我们自研封装也要有一层 `GitErrorCode`）。
- `git-environment`：`resolveEmbeddedGitDir` / `resolveGitDir` / `resolveGitBinary` / `resolveGitExecPath` / `setupEnvironment`。
- **没有** `GitExecutor` 类、**没有** `parseGitStatus`、**没有** `gitDiff`。v2 的 `build/lib` 只有 `errors/`、`git-environment/`、`git-process/`、`index`。因此"用 dugite 就不用写解析"是错的：解析层要么自写，要么从 VS Code 移植（移植量见 §6）。

### 3.2 simple-git

`status()` 返回 `StatusResult`（`not_added`/`created`/`modified`/`deleted`/`renamed`/`conflicted`/`staged`/`ahead`/`behind`/`current`/`tracking`/`detached`/`files[]`），`branch()` 返回 `BranchSummary`（含 `all`、`branches`、`current`、`detached`、`label`、`linkedWorkTree`），另有 `PushResult`/`PullResult`/`LogResult`。内置 task 有 `apply-patch`、`diff-name-status`、`check-ignore`、`count-objects`、`first-commit`、`clone`、`clean`、`config`，`untracked` 有专门选项。

它能覆盖 80% 的需求，问题在于：**它替我们决定了子命令与解析方式**。例如没有 rename 相似度评分、没有未合并条目的三阶段 mode/hash（porcelain v2 的 `u` 行）、没有 `--untracked-files` 的超限截断控制（我们要在 1 万条时 kill 掉进程），缓存/节流也得自己做。所以只能当参考或「快速原型阶段」的临时后端。

### 3.3 isomorphic-git

纯 JS，`status`/`log`/`commit`/`checkout`/`init`/`clone`/`push` 都有。但：①**index 兼容性**——它按 index v2/v3 读写，遇到 `extensions.sparseIndex`、split index、`index.version=4` 精细路径压缩时容易出现"我读到的和你 `git status` 看到的不一致"；②**无 hooks / 无 credential helper 复用**；③大仓库（10 万文件）下 `status` 要在 JS 里遍历整棵工作树 + 写自己的 stat cache，性能和维护成本都不可控；④维护投入不足（README 自承）。**适合 WASM/浏览器内只读浏览，不适合当 IDE 的面板后端。**

### 3.4 原生绑定（nodegit / libgit2 / napi-rs）

`nodegit` 0.27.0 停在 2020 年，依赖 `node-gyp@4` + `nan` + `node-pre-gyp@0.13`，在 Node 24 / Electron 高版本 ABI 上基本无法直接编译；`@napi-rs/git` 在 npm 不存在。若要 libgit2，正确做法是自己写 napi-rs binding 并预编译多平台产物 —— 对插件来说是**独立项目级别**的工作量，且 libgit2 的行为与用户 git 有细微差异（尤其是 status 的 ignore 规则、CRLF 处理），会造成"IDE 显示的和命令行不一致"的支持成本。**不选。**

---

## 4. 关键命令清单（精确参数 + 输出格式）

> 所有解析都假定：**非 tty 执行**、`GIT_PAGER=cat`、`LANGUAGE=en`/`LC_ALL=en_US.UTF-8`、路径一律用 `-z`（NUL 分隔）拿到原始 UTF-8，避免 `core.quotepath` 的 C 转义（实测：不加 `-z` 时 `uni dir/日本語.md` 会被转义成 `"uni dir/\346\227\245..."`；加 `-z` 后是原始字节，**此时无需 `-c core.quotepath=false`**）。

### 4.1 工作区状态（唯一入口）

```bash
git --no-optional-locks status --porcelain=v2 -z \
    --branch --untracked-files=all          # 默认 all；大仓库降级为 normal/no
```
`--no-optional-locks` 等价于 `GIT_OPTIONAL_LOCKS=0`（git ≥ 2.15），作用是**不让 status 去刷新/重写 index** —— 实测：普通 `git status` 会把 `.git/index` mtime 从 17:45:28 改到 17:48:53；加了这个以后 index mtime 完全不变。这对"后台每 1–2 秒跑一次 status"的 IDE 场景是必须的，否则会和用户的 git 操作抢锁。

porcelain v2（git ≥ 2.11）的 `-z` 记录格式（本机逐字节验证）：

| 行首 | 格式 | 含义 |
|---|---|---|
| `#` | `# branch.oid <sha>` / `# branch.head <name>` / `# branch.upstream <remote>/<branch>` / `# branch.ab +N -M` | 头信息；`branch.oid` 在无提交时是 `(initial)`；`branch.ab` 只在有 upstream 时出现 |
| `1` | `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` | 普通变更；XY = index/worktree 两列状态（`.`=无变化，`M` 修改，`A` 新增，`D` 删除，`R` 重命名，`C` 复制，`T` 类型变化）；`sub` 为 `N...` 或 `S<c><m><u>`（子模块：commit 变化/有修改/有未跟踪） |
| `2` | `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` **NUL** `<origPath>` | 重命名/复制；`<X><score>` 如 `R100`、`C075`；**路径后跟第二个 NUL 分隔的原路径** |
| `u` | `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` | 未合并（冲突）；**注意有 4 个 mode 字段**（stage1/2/3/worktree）与 3 个 blob hash，`XY` 取值 `DD`/`AU`/`UD`/`UA`/`DU`/`AA`/`UU` |
| `?` | `? <path>` | 未跟踪 |
| `!` | `! <path>` | 被忽略（**只有传了 `--ignored` / `--ignored=matching` 才出现**） |

实测样例：
```
1 D. N... 100644 000000 000000 <hH> 0000000000000000000000000000000000000000 del.txt
1 MM N... 100644 100644 100644 <hH> <hI> mod.txt
2 R. N... 100644 100644 100644 <hH> <hI> R100 ren2.txt\0ren.txt
u UU N... 100644 100644 100644 100644 <h1> <h2> <h3> c.txt
```

**为什么用 v2 而不是 VS Code 的 v1**：v1（`git status -z`）每个文件只有两位 XY，丢了 rename 相似度、子模块状态、冲突三阶段对象；而 v2 的 `1/2/u/?` 直接能映射成"Staged / Unstaged / Untracked / Conflicts"四组，不用二次推导。代价是要写一个约 120 行的状态机解析器（NUL 流式切分，注意 `2` 行要连读两段）。

### 4.2 按需 diff（不要一次性 `git diff` 全仓库）

| 用途 | 命令 |
|---|---|
| 变更文件清单（含状态字母） | `git diff --name-status -z --diff-filter=ADMR -- [<pathspec>]`（staged 加 `--cached`；重命名检测 `--find-renames=<n>%`） |
| 汇总行数 | `git diff --shortstat`（staged 同理 `--cached`） |
| 单文件 diff | `git diff -- <path>` / `git diff --cached -- <path>` |
| 单文件 diff（含上下文控制/无颜色） | `git -c color.ui=false diff --no-color --unified=3 -- <path>` |
| 提交详情 | `git -c i18n.logOutputEncoding=UTF-8 show -s --decorate=full --shortstat --format='%H%n%aN%n%aE%n%at%n%ct%n%P%n%D%n%B' -z <ref> --` |
| 提交的文件列表 | `git show --name-status -z --format= <ref>`（`--diff-filter=ADMR` 可选） |
| 提交内单文件 diff | `git show <ref> -- <path>` |
| 暂存区 vs 指定提交 | `git diff --cached <ref> -- <path>` |

负载策略：面板首屏只要 `status` + 每文件 1 行摘要（`--name-status` 已够）；**diff 正文在用户点开文件时才拉**（`git diff -- path`），并且对 >1 MB 的文件用 `--stat` + 折叠提示。提交历史列表只拉 `%H %P %an %at %s %D`（图谱布局最低需求），不做 `--numstat` 批量预取。

### 4.3 hunk / 行级暂存（最易出坑的一块）

可行方案有三条，实测结论：

1. **打 patch + `git apply --cached`（VS Code 旧做法）**
   - 从 `git diff` 输出里切出目标 hunk，**必须保证 patch 文本以换行结尾**，否则 `git apply` 报 `error: corrupt patch at /tmp/.../one.patch:13`（实测就是这么挂的）。
   - 加上 `--recount` 可以容忍 hunk 头行数不准：`git apply --cached --recount --check` 先校验，再 `git apply --cached --recount` 应用 → 实测 status 变 `1 MM`、`--cached --stat` 显示 1 insertion/1 deletion。
   - 反向（取消暂存某 hunk）：`git diff --cached` 取 patch → `git apply --cached -R` → status 回到 `1 .M`，实测可用。
   - **陈旧 patch 风险**：index 期间被改变 → `error: patch failed: f.txt:12` + `error: f.txt: patch does not apply`（exit 1）。此时**不要自动降级到 `--3way`**：实测 `git apply --cached --3way` 会输出 `Applied patch to 'f.txt' with conflicts.` 并往 index 写入 `U f.txt`，把一次"暂存失败"变成"仓库出现冲突条目"。
2. **`hash-object` + `update-index`（VS Code 现今做法，推荐）**
   ```bash
   git hash-object --stdin -w --path <rel>            # 客户端已经算好"部分暂存后"的完整文件内容
   git update-index [--add] --cacheinfo <mode>,<sha>,<rel>
   ```
   实测成功：得到 `6afb3f67...` 并写入 index 后 status 变 `1 MM`、cached diff = 2 insertions/2 deletions。`mode` 从 `git ls-tree HEAD -- <path>` 取，新增文件用 `100644` 且需要 `--add`。**优点**：不依赖 hunk 数学正确性，客户端只需产出目标文件全文（对编辑器场景天然成立）；**缺点**：大于数 MB 的文件要多传一次全文。
3. `git add -p` 的非交互替代 —— 没有稳定接口（它是 `--interactive` 的 Perl/C 实现，输出是菜单文本），**不建议**。

行级暂存 = 把"选中的行区间"先合成目标文本，再走方案 2；这与 VS Code `commands.ts` 的 `_stageChanges → applyLineChanges(original, modified, changes) → repository.stage(resource, result)` 完全一致。

### 4.4 提交 / 历史 / 分支 / stash / tag / reflog

| 数据 | 命令 | 备注 |
|---|---|---|
| 提交 | `git commit -m <msg>` | 追加 `--amend`、`--signoff`、`--no-verify`、`--allow-empty`、`-S`（签名要用户配置 gpg） |
| 历史（列表） | `git -c i18n.logOutputEncoding=UTF-8 log --format='%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%D%x00%s' -z -n 200 --skip=0 [--all] [--graph 不需要，自己布局]` | `-z` 在 log 上可用（实测）；`%D` 给 ref 装饰 |
| 历史（按文件） | 同上 + `--follow -- <path>` | `--follow` 每次只能跟一个路径 |
| 提交详情 | 见 §4.2 | |
| 分支列表 | `git for-each-ref --format='%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)' refs/heads refs/remotes` | **`for-each-ref` 不支持 `-z`**（实测 `unknown switch 'z'`）：只能在 format 里用 `%00` 分隔字段，记录靠换行结束；refname 不含换行，安全 |
| 分支详情 | `%(refname)%00%(upstream:short)%00%(objectname)%00%(upstream:trackshort)%00%(committerdate:unix)%00%(subject)` | |
| ahead/behind | `git rev-list --left-right --count <branch>...<remote>/<name>` | 输出 `1<TAB>0` = 左独有 1 / 右独有 0（实测） |
| stash 列表 | `git stash list --format='%H%x00%P%x00%gd%x00%gs%x00%at' -z` | `-z` 可用（实测 `48db724...|0f140e1... f3dadc0...|stash@{0}|WIP on main: 0f140e1 c1|1794563649`） |
| stash 操作 | `git stash push -m <msg> [--] <pathspec>` / `git stash pop|apply|drop stash@{n}` | |
| tag 列表 | `git tag --list --format='%(refname:short)%00%(objectname)%00%(objecttype)%00%(*objectname)'` | **同样没有 `-z`**；annotated tag 的 `objecttype=tag`，`%(*objectname)` 是其指向的 commit（实测 `v1|fa1b589...|tag|0f140e1...`） |
| reflog | `git reflog --format='%H%x00%gD%x00%gd%x00%gs%x00%at' -z [-n 100]` | `-z` 可用（实测 `0f140e1...|HEAD@{0}|HEAD@{0}|commit (initial): c1|1794563649`）→ discard/reset 的撤销面板就靠它 |
| worktree | `git worktree list --porcelain -z` | 每块 `worktree <path>`/`HEAD <sha>`/`branch refs/heads/x` /`bare`/`detached`/`locked`；**worktree 里的 `.git` 是文件不是目录**，内容 `gitdir: <main>/.git/worktrees/<name>`，向上找仓库时必须同时接受文件与目录 |
| 子模块 | `git submodule status --recursive` | 或用 status `sub` 字段 |
| merge base | `git merge-base <a> <b>` | |
| 冲突文件三方内容 | `git show :1:<path>` / `:2:` / `:3:`（base/ours/theirs） | 冲突解决 UI 的正解，比 `<<<<<<<` 文本解析可靠 |

### 4.5 网络/耗时操作（进度与取消）

- `git clone/fetch/push --progress` 会把进度写到 **stderr**，用 `\r` 分隔。实测片段：
  `remote: Enumerating objects: 50102, done.` / `remote: Counting objects:  0% (1/50102) … 100% (50102/50102), done.` / `Receiving objects: 0% (1/50102) … 100% (50102/50102), 2.18 MiB | 61.87 MiB/s, done.` / `Updating files: 28% (14493/50000) … done.`
  解析正则要同时吃 `remote: ` 前缀、`(\d+)% \((\d+)/(\d+)\)`、`done.`、速率段。push 还有 `Writing objects:`、`Total 4 (delta 2), reused 0 …`。
- 取消：`child.kill('SIGTERM')` 实测有效（`git log -p --all` 中断后 `exit code: null, signal: SIGTERM`，git 自己清理，不留 `index.lock`）。Windows 上 Node 的 `kill()` 对子进程实际是 TerminateProcess，git 可能来不及清理 → **必须在杀进程后做一次 stale lock 检查**（`fs.stat('.git/index.lock')` 且 mtime 早于本次操作开始时才提示删除/自动删）。
- 写操作并发：**单仓库串行队列**（同一 `.git` 上的所有写操作排队），读操作（status/diff/log）可并发但受"操作进行中不刷新"约束。实测：存在 stale `.git/index.lock` 时 `git status` 仍返回 0（读不受影响），而 `git add` 直接失败 `fatal: Unable to create '<repo>/.git/index.lock': File exists.` + `Another git process seems to be running in this repository, or the lock file may be stale`。`GIT_OPTIONAL_LOCKS=0` 对写操作无效。

---

## 5. 状态模型与刷新架构

### 5.1 数据模型（建议直接照 VS Code `api/git.d.ts` 的字段名，便于将来对拍）

```ts
type Status =
  | 'INDEX_MODIFIED' | 'INDEX_ADDED' | 'INDEX_DELETED' | 'INDEX_RENAMED' | 'INDEX_COPIED'
  | 'MODIFIED' | 'DELETED' | 'UNTRACKED' | 'IGNORED'
  | 'INTENT_TO_ADD' | 'INTENT_TO_RENAME' | 'TYPE_CHANGED'
  | 'ADDED_BY_US' | 'ADDED_BY_THEM' | 'DELETED_BY_US' | 'DELETED_BY_THEM'
  | 'BOTH_ADDED' | 'BOTH_DELETED' | 'BOTH_MODIFIED';

interface Change { path: string; origPath?: string; status: Status; renameScore?: number; }
interface RepoState {
  HEAD: Branch | undefined;
  refs: Ref[]; remotes: Remote[]; submodules: Submodule[]; worktrees: Worktree[];
  rebaseCommit?: string;
  indexChanges: Change[];        // staged
  workingTreeChanges: Change[];  // unstaged
  untrackedChanges: Change[];    // untracked
  mergeChanges: Change[];        // conflicted (u 行)
  didHitLimit: boolean;
}
```
porcelain v2 → 四组的映射：`1/2` 行有 Index 列变化 → `indexChanges`，有 Worktree 列变化或 `?` → `workingTreeChanges`/`untrackedChanges`，`u` 行 → `mergeChanges`；一个文件可同时出现在 staged 与 unstaged（`MM`），**这是对的，不要合并去重**。

### 5.2 刷新调度（照搬 VS Code 的节流结构）

```
事件源 ──┬─ 工作区递归 watcher（过滤 .git/**）──────┐
         ├─ .git 第一层 watcher（index / HEAD / refs/**）─┤
         ├─ 每个 git 写操作结束后 ────────────────────┤
         └─ 窗口重新聚焦（可选）──────────────────────┘
                            ↓
                  debounce 1000ms（合并爆发事件）
                            ↓
             throttle：上一个 status 未完成则丢弃
                            ↓
        whenIdle：无正在进行的 git 操作（否则延后）
                            ↓
        isRepositoryHuge?（上次 didHitLimit）→ 跳过自动刷新，只留手动刷新按钮
                            ↓
        git status --porcelain=v2 -z --branch -uall（超时 5s）
```

细节与理由：

- **监听 `.git` 只监听第一层**（`.git/index`、`.git/HEAD`、`.git/refs/**`），不递归 `.git`：`.git/objects` 在 clone/fetch/commit 时会产生海量事件。社区经验（低权威，仅旁证）指出只写 `**/.git/**` 排除不够、必须显式排除 `**/.git/objects/**` 与 `**/.git/lfs/**`；一个 5 万文件的 `node_modules` 仓库能让 `git status` 从 80ms 涨到 2.3s。
- 过滤 `index.lock`（我们自己的操作也会产生它，会自我触发刷新）以及 `.git/worktrees/<wt>/index.lock`。
- **不要在 watcher 回调里直接用 eventType**：Node 24 在 macOS 上 `fs.watch(dir, {recursive:true})` 实测**对嵌套文件的内容修改也只报 `rename`**（没有 `change` 事件）；新建嵌套目录还会按路径分量连续报 `rename:a`、`rename:a/b`。结论：**任何事件都当成"目录变了"**，不要再区分 change/rename，靠 debounce 合并。
- **降级轮询**：①watcher 建立失败（macOS 上目录极多时 `fs.watch` 会耗尽 fd；Windows 上 `ReadDirectoryChangesW` 缓冲区溢出会静默丢事件）；②仓库落在网络盘/外置卷；③`status` 超过阈值（>1.5s）。三种情况都退到 `setInterval` 轮询 `git status`（间隔 3–5s，且仅在窗口可见/聚焦时跑）。macOS 上 `kern.maxfiles` 与 `ulimit -n` 是真实瓶颈，10 万文件的递归 watch **不要**直接铺（VS Code 也把 watcher 做成可配置排除）。
- **大仓库判据**：`didHitLimit`（超过 `statusLimit` 默认 10000，VS Code 的默认值）→ 置 `isRepositoryHuge`，从此不再自动刷新（只保留手动刷新 + 明确提示"仓库变更过多"）。实测 5 万文件、干净状态 `git status` 0.05–0.07s，属于可接受；但 `touch` 全部 5 万文件后第一次 status 要 **2.97s**（要重新哈希），随后回到 0.07s —— 所以"短暂卡顿"必须靠"操作未 idle 则跳过"来平滑，而不是靠加长 debounce。
- 10 万个未跟踪文件实测：`-unormal` 0.03s / `-uall` 0.07s（输出 1,423,000 B）/ `-uno` 0.01s。所以 `-uall` 本身不慢，**慢在解析与 IPC**：1.4 MB 的 NUL 流建议流式解析、并且 limit 一到就 `kill`。
- `core.untrackedCache=true` 在本机 5 万文件仓库实测**没有可见收益**（0.06–0.08s 前后无差异），不要为此自动改用户配置；`core.fsmonitor` 同理（macOS 内置 `git fsmonitor--daemon` 已在跑）。**一律不写用户 `.git/config`**，需要时用 `git -c key=value` 每次覆盖。

---

## 6. SCM 面板交互清单（对齐 VS Code，标 P0/P1/P2）

### 6.1 数据分组与行内操作

| # | 交互 | 说明 | 优先级 |
|---|---|---|---|
| 1 | 分组 Staged Changes / Changes / Untracked / Merge Conflicts | 由 §5.1 四组直接映射；冲突组始终置顶 | P0 |
| 2 | 行内按钮：Stage（+）/ Unstage（−）/ Discard（↺）/ Open File / Open Diff | 悬停显示；`Discard` 必须二次确认 | P0 |
| 3 | 单击文件 → 打开工作区 diff；staged 行 → index vs HEAD diff | 未跟踪文件用 `git diff --no-index /dev/null <path>` 或直接打开编辑器 | P0 |
| 4 | 分组级操作：Stage All / Unstage All / Discard All | Discard All 要求输入确认或强提示 | P0 |
| 5 | 顶部输入框提交信息 + Commit 按钮；`Ctrl/Cmd+Enter` 提交 | 空 message 时按钮 disabled；提交后刷新 + 清空 | P0 |
| 6 | 提交按钮下拉：Commit、Commit (Amend)、Commit & Push、Commit & Sync | `Amend` 需提示"会改写上一次提交" | P1 |
| 7 | SCM 标题栏：当前分支 + ahead/behind 数字 + 刷新按钮 + 更多菜单 | ahead/behind 来自 `rev-list --left-right --count` | P0 |
| 8 | 单选提交信息模板 / 上次提交信息回填（Up arrow） | VS Code 有；纯本地行为 | P2 |
| 9 | 行级/选区级 Stage（编辑器内右键 `Stage Selected Ranges`） | §4.3 方案 2；先做整文件，行级 P1 | P1 |
| 10 | 冲突解决：Accept Current / Incoming / Both，标记 Resolved（`git add`） | 需要三方内容（`:1:`/`:2:`/`:3:`）或编辑器 merge 视图 | P1 |
| 11 | 分支切换（Quick Pick：本地 + 远程，含"创建新分支"） | `git checkout <b>` / `git switch -c <b>` | P0 |
| 12 | 提交历史列表（点击 → 文件树 → 单文件 diff） | 与图谱共用数据源：`log --format=%H%x00%P...%z` | P0 |
| 13 | Stash：列表、Apply、Pop、Drop、Create | Drop 需确认 | P1 |
| 14 | 危险操作确认 + Undo：`discard` / `reset --hard` / `checkout -- .` / 删分支 / force push | Undo 面板从 `git reflog` 取（§4.4），展示"XX 秒内可撤销" | P1 |
| 15 | 签名提交（`-S`）、signoff | 依赖用户 gpg 配置，失败要给出可读错误 | P2 |
| 16 | push / pull / fetch（带进度条） | **默认关闭**，见 §8；开启后要有 `--progress` 进度与取消 | P2 |
| 17 | Git LFS 提示、嵌套仓库（submodule）标记 | status `sub` 字段 / 路径以 `/` 结尾表示嵌套仓库 | P2 |

### 6.2 与提交图谱的联动（只定接口，渲染由他组实现）

- 图谱数据：`git log --all --format='%H%x00%P%x00%an%x00%at%x00%D%x00%s' -z -n <limit>`；**不要**用 `--graph` 的 ASCII（客户端自己布局才能做 hover/点击）。
- 点提交 → 面板右栏显示：commit meta（`%H %an %ae %at %ct %D %B`）+ `show --name-status -z` 文件列表 + 单文件 `git show <ref> -- <path>`。
- 工作区 diff 与提交 diff 用**同一个 diff 视图组件**，只是 base 侧换成 `工作区`/`index`/`HEAD`；入口区分：SCM 面板点文件 = 工作区；图谱点提交点文件 = 该提交。
- 图谱里的"未提交节点"是虚拟节点，选中时把 SCM 面板的四组变更汇总成一个 pseudo-commit 展示。

---

## 7. 可借鉴的开源实现

| 项目 | License / 状态 | 可借鉴部分 | 可移植性判断 |
|---|---|---|---|
| **microsoft/vscode `extensions/git`** | MIT，活跃 | 见下表 | **最高**：解析器与模型是纯 TS，只依赖 `child_process` |
| mhutchie/vscode-git-graph | MIT，**2023-07 后停滞**，唯一依赖 iconv-lite 0.5.0，100+ 配置项 | 图谱 + 提交详情 + 文件树的参数化设计（`repository.commits.initialLoad/loadMore/order`、`graph.style/colours`、`showRemoteBranches/showTags/showStashes`、`includeCommitsMentionedByReflogs`、`onlyFollowFirstParent`、`useMailmap`）；`dialog.*` 危险操作默认项 | 中：逻辑可读，但它是自绘 webview + 自己的 git 封装，且代码风格老、已停更 —— **只抄设计不抄代码** |
| jesseduffield/lazygit | MIT，活跃，Go TUI | 键位与操作语义（stage hunk 的 keymap、commit 菜单、rebase 交互的"可撤销"心智） | 低代码级、高交互级 |
| gitbutlerapp/gitbutler | **FSL-1.1-MIT（非 OSI 开源，2 年后转 MIT）** | 虚拟分支/分栈概念、变更组织方式 | **牌照注意**：不能直接搬代码进我们的插件 |
| sourcegit-scm/sourcegit | MIT，C#/Avalonia | 图形化分支操作、冲突解决 UX | 低（语言不通），可参考界面 |
| FredrikNoren/ungit | 10.6k★，LICENSE 文件 404、package.json 无 license 字段（按惯例视为 MIT，**引用需谨慎**） | 图谱布局算法（它是 Node 端分 lane 的经典实现） | 中：lane 分配算法值得读 |

**VS Code `extensions/git` 的可移植性拆分（main 分支，行数为原始文件实测）**

| 文件 | 行数 | 能否直接用 | 说明 |
|---|---|---|---|
| `src/git.ts` | 3523 | **能搬 60–70%** | 里面 `exec`/`spawn` 封装、各类 `--format` 常量、`GitErrorCode` 映射、`staging` 之外的大部分子命令调用都是纯 Node；真正要改的是它用 `vscode.Uri`、`IpcLogger`、`WorkspaceConfiguration` |
| `src/api/git.d.ts` | 529 | **能全搬** | 纯接口/枚举定义，就是我们 §5.1 想要的模型；没有 vscode 运行时依赖（只有类型） |
| `src/staging.ts` | 239 | **不能搬** | 依赖 `vscode.TextDocument/TextEdit` 的文本编辑模型，是"diff 编辑器里的行变更 → 文本"的数学；我们自己要在编辑器侧实现（或用纯字符串版本重写，约 200 行） |
| `src/model.ts` | 1225 | 大部分不能搬 | `Repository` 的 vscode 侧模型（`SourceControl`、`Resource`、`QuickDiff`、`FileDecoration` 全是 vscode API） |
| `src/repository.ts` | 3706 | 部分可搬 | 操作编排（提交、分支、stash、rebase、冲突、worktree、子模块）的逻辑非常有参考价值；但 80% 是 vscode API 胶水 + `SourceControl` 刷新 |
| `src/commands.ts` | 5791 | 只读参考 | 几乎全是 `vscode.commands.registerCommand` + 菜单/确认框 |
| `src/blame.ts` | 755 | 解析部分可搬 | `--porcelain --incremental` 的增量解析器（约 200 行）值得抄 |
| `src/main.ts` / `repositoryCache.ts` / `autofetch.ts` / `statusbar.ts` / `decorationProvider.ts` / `quickDiffProvider.ts` | 330 / 228 / 143 / 316 / 359 / — | 不能搬 | 全是对 `vscode.window/workspace/scm` 的适配 |
| 合计 | ~18,000 行（含 commands） | 真正可复用的纯逻辑约 **1,800–2,500 行**（git.ts 的命令表 + 状态解析 + blame 解析 + api 类型） | 其余靠我们自己写 |

---

## 8. 安全与边界（必须写进设计）

**威胁模型**：面板一打开就会跑 `git status`，而 git 会**执行仓库本地配置里指定的外部命令**。这不是理论问题：2026-05 的 GitHub Copilot CLI、2026-08 的 Eclipse Theia 都是"打开文件夹 → 自动 `git status` → 恶意 `.git/config` 的 `core.fsmonitor` → RCE"；攻击面不止 `core.fsmonitor`，公开分析提到 **15+ 个可执行配置键**（`core.hooksPath`、`diff.external`、`merge.tool`、`filter.*.clean/smudge`、`credential.helper`、`core.sshCommand`、`core.askPass`、`core.pager` 等），并且可以用"在一个普通仓库里埋一个 bare repo"的手法把配置带进来（OVE-20210718-0001）。

本机实测确认（恶意配置写在临时仓库里）：

- `.git/hooks/pre-commit` → `git commit` 时被执行；`git status` 不跑钩子。
- `filter.evil.clean = <cmd>` → `git add` 时被执行；改成空值 `-c filter.evil.clean=` 后不执行（但**不能无条件清空所有 filter**，那会破坏 git-lfs —— 合法过滤器就是靠 `filter.*` 实现的）。
- `core.fsmonitor = sh -c "<cmd>"` → 普通 `git status` 就执行。
- `core.pager` / `diff.external` 风险低：stdout 非 tty 时 pager 不跑；`diff.external` 不加 `--ext-diff` 不执行。
- 硬化调用实测（不执行 fsmonitor、status 正常返回）：
  ```bash
  GIT_OPTIONAL_LOCKS=0 git \
    -c core.fsmonitor=false -c core.hooksPath=<空目录> -c core.pager=cat \
    -c diff.external= -c credential.helper= -c core.askPass= -c core.sshCommand= \
    status --porcelain=v2 -z --branch -uall
  ```

**建议方案（分层，不追求 100%）**：

1. **Workspace Trust 门禁（最重要）**：未信任的目录只允许"只读 + 硬化配置"的 `status`/`log`/`diff`，且不自动刷新（用户点一下才扫）；信任后才允许写操作与钩子。信任状态存在插件自己的 profiles 里，不进仓库。
2. **读路径硬化**：所有后台命令统一带 `GIT_OPTIONAL_LOCKS=0` + 上面的 `-c` 组合；`GIT_TERMINAL_PROMPT=0` 防止卡在密码提示；`LC_ALL=C`/`LANGUAGE=en` 保证错误信息可解析（实测 macOS 上 `LC_ALL=xx_YY.UTF-8` 不报错，但 glibc 环境会打 setlocale 警告，**不要用非法 locale**，用 `C`/`en_US.UTF-8`）。
3. **写路径**：钩子是正当功能（用户就是要 pre-commit 校验），默认**沿用用户配置**，但在设置里给「运行 git hooks」开关，并**不要**替用户 `-c core.hooksPath=/dev/null`（那会让用户以为自己的 lint 生效了其实没有）。写操作前先检查 `index.lock` 是否 stale。
4. **凭据**：**绝不读 `~/.git-credentials`、不实现 credential store**；需要认证时只依赖用户的 credential helper 或 `GIT_ASKPASS`。默认**关掉所有网络操作**（push/pull/fetch/clone/子模块递归更新），作为 P2 显式开关；开启后也不自动执行，必须用户点击。
5. **目录信任的补充**：`safe.directory` 报 `fatal: detected dubious ownership in repository at '<path>'` 时**不要**自动写全局 `safe.directory`（等于替用户关掉 CVE-2022-24765 的保护），提示用户手动加。
6. **clone 相关**：如将来支持 clone，对不可信远端用 `-c core.symlinks=false` + 不递归子模块（CVE-2024-32002：递归 clone 可被构造成把 hook 写进 `.git` 并在 clone 过程中执行，CVSS 9.0，已在 2.45.1 修）。
7. **不修改用户的 `.git/config`**：一律 `git -c` 临时覆盖；`core.untrackedCache`/`core.fsmonitor` 等性能项不做自动改写。

---

## 9. 风险与工作量估算（人日）

| 工作项 | 人日 | 风险 |
|---|---|---|
| git 执行层（spawn 封装、env/超时/取消/错误码映射、lock 冲突处理） | 2.0 | 低 |
| status v2 流式解析 + 四组模型 + limit 截断 | 2.0 | 中（`2` 行双路径、`u` 行 4 mode 易错） |
| 按需 diff（工作区/暂存/提交/单文件）+ 二进制与超大文件处理 | 1.5 | 低 |
| 行/hunk 暂存（hash-object + update-index 方案） | 3.0 | **高**（这是最容易出正确性 bug 的部分：CRLF、末尾换行、mode、新增文件、删除文件） |
| 提交 / amend / signoff / 提交信息校验 | 1.0 | 低 |
| 分支（checkout/新建/删除/rename）、merge 与冲突三方内容 | 3.0 | 中 |
| stash / tag / reflog / worktree / submodule 列表 | 1.5 | 低 |
| 刷新架构（双 watcher + debounce + throttle + idle + 轮询降级） | 2.0 | 中（macOS 递归 watch 只给 rename、fd 上限） |
| 写操作串行队列 + 操作中禁止刷新 + 超时/取消 | 1.5 | 中 |
| 安全硬化 + Workspace Trust + 危险操作确认/Undo | 2.0 | 中 |
| 面板 UI（四组列表、行内按钮、提交框、分支 picker、diff 入口） | 5.0 | 中 |
| 与图谱的接口（log 数据、点选联动、虚拟未提交节点） | 1.0 | 低 |
| 测试与大仓库验证（1k/5万文件、Windows、CRLF、中文路径） | 3.0 | 中 |
| **合计** | **≈ 28–29 人日** | 不含图谱渲染与编辑器（另计） |

**主要风险**

1. **Windows 路径与换行**：`core.longpaths`（>260 字符路径）、CRLF 自动转换、盘符大小写；建议所有路径在 Node 侧统一用 `path.resolve` + 传给 git 时用 `/`，并禁止自己实现路径规范化。
2. **git 版本碎片**：porcelain v2 需要 ≥2.11（2016），`GIT_OPTIONAL_LOCKS` 需要 ≥2.15；Apple Git 与 CentOS 7 的 git 1.8 仍可能遇到 → 启动时 `git --version` 探测，<2.11 直接降级到 v1 解析或提示升级。
3. **行级暂存的正确性**：不同编辑器/编码（UTF-8 BOM、CRLF、gitattributes 的 `text eol=lf`）会让"客户端算出的目标文本"与 git 期望不一致 → 必须以 `git apply --cached --check` 或 `git diff --cached` 回读校验，失败就回滚。
4. **dugite 兜底路径**的打包（asarUnpack、签名、`LOCAL_GIT_DIRECTORY` 置空）与 postinstall 联网在企业网络下会失败 → 只在用户显式请求时才走。
5. **监听风暴**：超大仓库/网络盘必须能一键关 watcher 回到轮询，否则表现为"IDE 卡死"。

---

## 10. 参考链接

**git 官方**
- `git status` porcelain v2 格式：https://git-scm.com/docs/git-status#_porcelain_format_version_2
- `git` 环境变量（`GIT_OPTIONAL_LOCKS`、`GIT_TERMINAL_PROMPT`）：https://git-scm.com/docs/git#Documentation/git.txt-GITOPTIONALLOCKS
- `git apply`（`--cached`/`--recount`/`--3way`）：https://git-scm.com/docs/git-apply
- `git update-index --cacheinfo`：https://git-scm.com/docs/git-update-index
- `git for-each-ref` / `git tag --list --format`：https://git-scm.com/docs/git-for-each-ref
- `git worktree list --porcelain`：https://git-scm.com/docs/git-worktree
- man page 中 `GIT_OPTIONAL_LOCKS` 的用途描述（"prevent git status from refreshing the index as a side effect"）：https://man.freebsd.org/cgi/man.cgi?query=git&sektion=1&manpath=Debian+13.1.0

**VS Code / dugite**
- `extensions/git/src/git.ts`（命令表与解析器）：https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts
- `extensions/git/src/api/git.d.ts`（数据模型）：https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
- `extensions/git/src/repository.ts`（`statusLimit` 默认 10000，:3114）：https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts
- 慢 status 的 telemetry PR：https://github.com/microsoft/vscode/pull/158325
- dugite 仓库：https://github.com/desktop/dugite ；环境变量文档：https://github.com/desktop/dugite/blob/main/docs/environment-variables.md
- dugite-native releases（体积/平台）：https://github.com/desktop/dugite-native/releases
- Electron 内打包 dugite 的实证（asar unpack + `LOCAL_GIT_DIRECTORY` 置空坑）：https://github.com/WordPress/contributor-toolkit/issues/383 、https://github.com/WordPress/contributor-toolkit/commit/1d5d62e7f89fea08210b2d5ef07c9b5f6705397b

**npm**
- dugite：https://www.npmjs.com/package/dugite
- simple-git：https://www.npmjs.com/package/simple-git
- isomorphic-git：https://www.npmjs.com/package/isomorphic-git
- nodegit：https://www.npmjs.com/package/nodegit

**安全**
- CVE-2026-45033（Copilot CLI：埋 bare repo + `core.fsmonitor` 等 15+ 可执行配置键 → RCE）：https://nvd.nist.gov/vuln/detail/cve-2026-45033
- CVE-2026-19884（Eclipse Theia：打开文件夹即 `git status` → RCE）：https://vuldb.com/cve/CVE-2026-19884
- CVE-2026-71963（Hermes Agent 同类）：https://vuldb.com/cve/CVE-2026-71963
- CVE-2022-24765（safe.directory / dubious ownership）：https://support.atlassian.com/bitbucket-cloud/kb/git-command-returns-fatal-error-detected-dubious-ownership/
- CVE-2024-32002（递归 clone 子模块符号链接写 hook，CVSS 9.0）：https://ubuntu.com/security/CVE-2024-32002

**面板/图谱参考**
- vscode-git-graph（图谱与配置面参考，已停滞）：https://github.com/mhutchie/vscode-git-graph
- lazygit（键位与操作语义）：https://github.com/jesseduffield/lazygit
- SourceGit（图形化分支/冲突 UX）：https://github.com/sourcegit-scm/sourcegit
- ungit（lane 布局思路；license 字段缺失需谨慎）：https://github.com/FredrikNoren/ungit
- gitbutler（FSL-1.1-MIT，非 OSI）：https://github.com/gitbutlerapp/gitbutler/blob/master/LICENSE.md
