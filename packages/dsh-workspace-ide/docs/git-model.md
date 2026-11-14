# SCM 数据模型与 git 实现细节

> 本文覆盖 `backend/git/{exec,status,log,diff,write,stash,layout,watch}.js` 的**数据契约与算法**，是 `docs/remote-contract.md` §4 的实现说明。
> 分层与线程模型见 [ARCHITECTURE.md](../ARCHITECTURE.md)；安全边界（信任门禁、硬化参数、脱敏）见 [security.md](./security.md)，本文只在需要处引用。
> 所有命令、字段、实测数字来自 `research/git-backend.md` 与 `research/git-graph.md`（macOS 27.0.1 / Apple Git **2.54.0** / Node **v24.22.1**）。**不写实现代码，只定规格。**

## 1. 命令清单总表

### 1.1 两个前缀常量

所有子进程都由 `backend/git/exec.js` 唯一发起，argv 只有两种形态：

```bash
# H = 只读前缀
git --no-optional-locks -c core.fsmonitor=false -c core.pager=cat -c core.hooksPath=<tmpEmptyDir> \
    -c credential.helper= -c core.askPass= -c diff.external= -c core.sshCommand= \
    -c color.ui=false -c gc.auto=0 -c maintenance.auto=false <args>
# W = 写前缀：去掉 --no-optional-locks（对写无效）；-c core.hooksPath 仅在 runHooks=false 时加
git -c core.fsmonitor=false -c core.pager=cat -c color.ui=false <args>
```

env（H/W 共用）：`LC_ALL=en_US.UTF-8`、`LANGUAGE=en`、`GIT_PAGER=cat`、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`、`GIT_LITERAL_PATHSPECS=1`、`GIT_CEILING_DIRECTORIES=<dirname(root)>`、`GIT_ATTR_NOSYSTEM=1`；其余只继承 PATH/HOME/SHELL/USER/LOGNAME/TMPDIR/LANG 白名单，并清掉 `GIT_DIR` 等继承变量。**逐条理由与完整清单见 [security.md](./security.md) §3.1——那是硬化参数的唯一出处。**

**路径一律 `-z`**（NUL 分隔）取得原始 UTF-8，避免 `core.quotepath` 的 C 转义（实测：不加 `-z` 时 `uni dir/日本語.md` 变 `"uni dir/\346\227\245…"`）。`for-each-ref` / `tag --list` **没有 `-z`**（实测 `unknown switch 'z'`），必须额外加 `-c core.quotepath=false`。

### 1.2 总表

`P` = 只读前缀 `H`，`W` = 写前缀。`--` 之前一律先放 `--literal-pathspecs`。

| # | 用途 | argv（前缀 + 参数） | 超时 | 输出上限 | 解析 | Remote 动作 |
|---|---|---|---|---|---|---|
| 1 | 版本探测 | `git --version`（启动一次，缓存） | 5 s | 64 B | 正则 `git version (\d+)\.(\d+)` | `workspace.state` |
| 2 | 仓库探测 | `P rev-parse --show-toplevel --is-inside-work-tree --is-bare-repository --absolute-git-dir --is-shallow-repository` | 5 s | 4 KB | 行序固定（5 行） | `workspace.state` |
| 3 | 当前分支 | `P symbolic-ref --quiet --short HEAD` | 5 s | 512 B | exit 1 = detached | `workspace.state`、`git.refs` |
| 4 | 默认分支 | `P -c core.quotepath=false symbolic-ref --quiet --short refs/remotes/origin/HEAD` | 5 s | 512 B | 去 `origin/` 前缀（§4.3） | `git.refs` |
| 5 | 工作区状态 | `P status --porcelain=v2 -z --branch --untracked-files=all` | `statusTimeoutMs` 8000 | 32 MB / 40 万条 | 状态机 §2 | `git.status` |
| 6 | refs 全表 | `P -c core.quotepath=false for-each-ref --format=<F6> refs/heads refs/tags refs/remotes` | `gitTimeoutMs` 20000 | 2000 refs / 2 MB | TAB 切字段 §4.2 | `git.refs` |
| 7 | 提交列表 | `P -c i18n.logOutputEncoding=UTF-8 log --all --date-order -z -n <maxCount> --skip=<skip> --format=<F7>` | `gitTimeoutMs` | `logPageMax` 20000 条 / 32 MB | 多字符哨兵 §4.4 | `git.log`、`git.graph` |
| 8 | 单条提交 meta | `P -c i18n.logOutputEncoding=UTF-8 show -s --format=<F8> <hash> --` | `gitTimeoutMs` | 1 MB | 行序（`%B` 在末尾） | `git.commit` |
| 9 | 提交文件清单 | `P show --name-status -z --format= <hash>` | `gitTimeoutMs` | 4 MB | `-z` 两段/三段 | `git.commit` |
| 10 | 提交行数统计 | `P show --numstat -z --format= <hash>` | `gitTimeoutMs` | 4 MB | 与 #9 按记录序号配对 §5.4 | `git.commit` |
| 11 | 提交内单文件 diff | `P diff-tree -p --root --find-renames=50% --no-color --no-ext-diff --unified=<n> <hash> -- <path>` | `gitTimeoutMs` | `diffBytesMax` 4 MB | §5 | `git.diff`(`commit`) |
| 12 | 工作区 diff | `P diff --no-color --no-ext-diff --no-textconv --unified=<n> [--ignore-whitespace] -- <path>` | `gitTimeoutMs` | 4 MB | §5 | `git.diff`(`working`) |
| 13 | 暂存区 diff | 同 #12 加 `--cached` | `gitTimeoutMs` | 4 MB | §5 | `git.diff`(`index`) |
| 14 | 区间 diff | `P diff --no-color --no-ext-diff --no-textconv --unified=<n> <from>..<to> -- <path>` | `gitTimeoutMs` | 4 MB | §5 | `git.diff`(`range`) |
| 15 | 未跟踪文件 diff | `P diff --no-index --no-color --unified=<n> -- /dev/null <path>`（退出码 1 属正常） | `gitTimeoutMs` | 4 MB | §5 | 见 §12 差异 1 |
| 16 | 暂存 | `W add -A -- <paths>`（`all:true` 时 `W add -A --`） | `gitTimeoutMs` | 4 KB | 退出码；计数取自 status 差 | `git.stage` |
| 17 | 取消暂存 | `W reset -q HEAD -- <paths>`；unborn 仓库 `W rm --cached -r -q -- <paths>` | `gitTimeoutMs` | 4 KB | 退出码 | `git.unstage` |
| 18 | 丢弃（已跟踪） | `W checkout -- <paths>`；unborn 仓库 `W rm --cached -q -- <paths>` + `fs.unlink` | `gitTimeoutMs` | 4 KB | 退出码 | `git.discard` |
| 19 | 提交 | `W commit -F - [--amend] [--signoff] [--no-verify] [--allow-empty] [-- <paths>]`（message 走 **stdin**） | `gitTimeoutMs` | 64 KB | 退出码 + `%H` 从 stdout 取 | `git.commitCreate` |
| 20 | 切分支 | `W checkout <ref>` / `W checkout -b <name> [<start>]` / `W checkout --detach <ref>` / `W checkout -f <ref>` | `gitTimeoutMs` | 8 KB | 退出码 | `git.checkout` |
| 21 | 分支增删改 | `W branch <name> [<start>]` / `W branch -d\|-D <name>` / `W branch -m <old> <new>` | `gitTimeoutMs` | 8 KB | 退出码 | `git.branch` |
| 22 | tag | `W tag [-a -m <msg>] <name> [<target>]` / `W tag -d <name>` | `gitTimeoutMs` | 8 KB | 退出码 | `git.tag` |
| 23 | stash 列表 | `P stash list --format=%H%x00%gd%x00%gs%x00%at -z` | `gitTimeoutMs` | 512 KB | `-z` + `%x00` | `git.stash`(`list`) |
| 24 | stash 写 | `W stash push -m <msg> [--include-untracked] [-- <pathspec>]` / `W stash pop\|apply\|drop stash@{n}` | `gitTimeoutMs` | 64 KB | 退出码 | `git.stash` |
| 25 | blob 写入 | `P hash-object --stdin -w --path <rel>`（stdin 为目标文件全文） | 5 s | 41 B | `^[0-9a-f]{40,64}$` | `git.stageHunk` 内部 |
| 26 | index 换 blob | `W update-index [--add] --cacheinfo <mode>,<sha>,<rel>` | 5 s | 4 KB | 退出码 | `git.stageHunk` 内部 |
| 27 | 文件 mode | `P ls-tree HEAD -- <rel>` | 5 s | 4 KB | `^(\d{6}) blob (\h+)` | `git.stageHunk` 内部 |
| 28 | 三方内容 | `P show :1:<path>` / `:2:` / `:3:` | `gitTimeoutMs` | 4 MB | 原样文本 | 冲突解决（P1） |
| 29 | ahead/behind | `P rev-list --left-right --count <local>...<upstream>` | `gitTimeoutMs` | 64 B | `^(\d+)\s+(\d+)$` | `git.refs`（补 #6 的 `[gone]`） |
| 30 | 仓库初始化 | `W init -b <branch>`（git<2.28 退 `W init` + `W symbolic-ref HEAD refs/heads/<branch>`） | `gitTimeoutMs` | 4 KB | 退出码 | 见 §12 差异 2 |
| 31 | 忽略判定（P1） | `P check-ignore -z --stdin` | 5 s | 256 KB | `-z` 路径流 | `.gitignore` 提示 |

超时纪律：契约给的是**上限**，实现可收紧不可放宽（`min(gitTimeoutMs, 5000)` 用于 #25–#27 这类短命令）。超时后 `SIGTERM` → 500 ms → `SIGKILL`，`detached:true` + `kill(-pid)` 杀进程组。

## 2. porcelain v2 解析状态机

命令固定为 #5，**`-z` 下所有记录（含 `#` 头行）以 `\0` 结尾**，`2` 行的 `origPath` 是**独立的一段**。

### 2.1 真实字节样例

```text
# branch.oid 0f140e1c8a1b3c4d5e6f708192a3b4c5d6e7f809\0
# branch.head main\0
# branch.upstream origin/main\0
# branch.ab +2 -1\0
1 .M N... 100644 100644 100644 0f140e1c8a1b3c4d5e6f708192a3b4c5d6e7f809 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 a.txt\0
1 MM N... 100644 100644 100644 0f140e1c8a1b3c4d5e6f708192a3b4c5d6e7f809 6afb3f67aa4d1e1e8b9a2f0f3f9c1d2e3f4a5b6c b.txt\0
2 R. N... 100644 100644 100644 0f140e1c8a1b3c4d5e6f708192a3b4c5d6e7f809 6afb3f67aa4d1e1e8b9a2f0f3f9c1d2e3f4a5b6c R100 new name.txt\0old name.txt\0
u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 c.txt\0
? d.txt\0
```

（`\0` 是字面 NUL；上面为了可读写成两字符。真实流里没有换行——换行只出现在**路径**里，而路径含换行时 `-z` 正是唯一的正确解法。）

### 2.2 字段映射

| 行首 | 字段（按位置） | 模型落点 |
|---|---|---|
| `# branch.oid <sha>` | sha / `(initial)` | `branch.sha`；`(initial)` → `sha:null, unborn:true` |
| `# branch.head <name>` | 短名 / `(detached)` | `branch.name`；`(detached)` → `detached:true, name:null` |
| `# branch.upstream <r>/<b>` | `origin/main` | `branch.upstream`；**行缺失 = 无上游**（`null`，不是 `""`） |
| `# branch.ab +N -M` | `+2 -1` | `branch.ahead/behind`；**行缺失 = 无上游**，此时强制 `ahead:0, behind:0` 且 `upstream:null` |
| `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` | 8 段 | 见 §2.3 |
| `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` + `\0` + `<origPath>` | 9 段 + 1 段 | `path` = 新名，`origPath` = 第二段；`X` ∈ `R`/`C`，`score` = `100`/`075` |
| `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` | 10 段 | 四路 mode，见 §2.5 |
| `? <path>` | 1 段 | `untracked[]`，`status:'?'`，`isUntracked:true` |
| `! <path>` | 1 段 | 被忽略；**只有传 `--ignored` 才出现**，P0 不传 → 正常流里永不见，但解析器必须能吃（P1 `ignored` 标记） |

`<sub>`：`N...` 普通，或 `S<c><m><u>`（子模块：commit 变 / 有修改 / 有未跟踪）。`<XY>` 的 X = index vs HEAD，Y = worktree vs index，`.` = 无变化。

### 2.3 `1` 行 → 四组

| XY | staged（X 侧） | working（Y 侧） |
|---|---|---|
| `M.` | `M` | — |
| `.M` | — | `M` |
| `MM` | `M` | `M`（**两条 Change，不去重**） |
| `A.` / `AM` | `A` | — / `M` |
| `D.` / `.D` | `D` | `D` |
| `T.` / `.T` | `T` | `T` |
| `..` | 不可能（git 不输出无变化行） | 不可能 |

→ 一条 `1` 行最多产出 **2 个** Change；`renameScore` 仅 `2` 行有。

### 2.4 三个必须写死的坑

1. **同一文件同时 staged 与 working（`MM`）**：`staged` 与 `working` 各一条，**不去重、不合并**。UI 侧两组各显示一行（VS Code 同行为），行内按钮因此不同（staged 行的"暂存"按钮隐藏，"取消暂存"可用）。
2. **重命名必须连读两段**：`2` 行的 `path` 之后的下一段是 `origPath`，**不是**下一条记录。状态机实现必须是「读段 → 若以 `2 ` 开头则再读一段」，而不是「按 `\0` 切完数组再遍历」（后者在路径本身含 `\0` 不可能、但**路径含换行**时会正常工作，而"先切完再遍历"也能工作——真正的坑是 `split('\0')` 之后必须显式 `i++` 跳过 origPath 段，否则 origPath 会被当成一条未知记录报 bad）。
3. **冲突行的四路 mode**：`u` 行有 **4 个 mode 字段**（stage1/base、stage2/ours、stage3/theirs、worktree）与 **3 个 blob hash**。缺的 stage 用 `000000` + 全零 sha 表示（`DD`/`AU`/`UD` 等）。`XY` 取值集合固定为 `DD/AU/UD/UA/DU/AA/UU`，**不存在** `M*` 组合；解析器对未知组合必须记 `bad` 并跳过（不抛异常）。

### 2.5 冲突行 mode 映射（契约三槽 vs 四路）

| porcelain | 语义 | wire 落点 |
|---|---|---|
| `m1` | merge base（stage 1） | 不进 wire（§12 差异 3）；需要时 `show :1:<path>` 现取 |
| `m2` | ours / HEAD（stage 2） | `mode.head` |
| `m3` | theirs（stage 3） | `mode.index` |
| `mW` | worktree | `mode.worktree` |

冲突态的 UI 文案**禁止**写 "ours/theirs"：rebase 与 cherry-pick 下 `--ours/--theirs` 的指向会翻转（rebase 时 `--ours` 是 upstream）。按钮文案统一写「取 stage-2」「取 stage-3」。

### 2.6 流式与上限

- 用 `readline` 的等价物按 `\0` 增量切（`Buffer.indexOf(0)` 循环），**不要** `stdout.toString()` 全量再 `split`：10 万未跟踪文件实测输出 1,423,000 B，全量 split 会峰值双倍内存。坏段（未知行首、字段数不符）计 `bad`，`bad > 0` 时 `console.warn` 一次（不弹 UI），**不**丢整次结果。
- 累计 Change 数 > 10000 → 置 `isHuge:true` 并继续读完（不能中途 kill：status 被 kill 会让 `--no-optional-locks` 之外的副作用不可预期；超 32 MB 才 kill + `E_TOO_LARGE`）。

## 3. 四组 × 状态字母 操作矩阵

`✓` = 允许；`—` = 不适用（按钮隐藏）；`✗` = 禁止并给出原因。`staged`/`working`/`untracked`/`conflicts` 四组与 `git.status` 返回同名。

| 组 | 字母 | 打开 diff | 暂存 `add` | 取消暂存 `reset` | 丢弃 | `.gitignore` |
|---|---|---|---|---|---|---|
| staged | `M` / `T` | `diff{index}`（`T` 可能 binary） | — 已暂存 | ✓ | ✓ `reset`→`checkout` | ✓ 追加 |
| staged | `A` | `diff{index}` | — 已暂存 | ✓ | ✓ 仅 `reset`（**不删文件**） | ✓ |
| staged | `D` | `diff{index}` | — | ✓ | ✓ `reset`（文件由 working 组的 `D` 恢复） | ✓ |
| staged | `R` / `C` | `diff{index}` + `origPath` | — | ✓ | ✓ `reset` | ✓ 用新路径 |
| staged | `T` | `diff{index}`（可能 binary） | — | ✓ | ✓ `reset`→`checkout` | ✓ |
| working | `M` / `T` | `diff{working}` | ✓ | — | ✓ `checkout -- <path>` | ✓ |
| working | `D` | `diff{working}` | ✓（`add -A`） | — | ✓ `checkout -- <path>` 恢复 | ✓ |
| untracked | `?` | 编辑器只读打开 / `diff --no-index` | ✓ | — | ✓ `fs.unlink`（**逐文件**） | ✓ |
| conflicts | `U`（`UU`/`AA`/…） | 三方视图 `:1/:2/:3` | ✓ = 标记已解决 | ✓ 清 index 三阶段（回到 working） | ✗ 语义随 operation 翻转（§2.5），改提供「取 stage-2/3」 | ✓ |
| 任意 | 子模块 `mode=160000` | 只给 `-Subproject commit` / `+Subproject commit` 两行 | ✓ | ✓ | ✗ 不做子模块递归操作（P2） | ✓ |
| 任意 | 二进制 / 符号链接 | `isBinary:true` + 无 hunk（摘要）/ 一行目标路径 | ✓ | ✓ | ✓（同组规则） | ✓ |

补充规则：

- **丢弃 untracked 走 `fs.unlink`/`fs.rm`，不用 `git clean -f`**：`clean` 会连带删掉同级被忽略的文件（`-x` 更甚），且无法按路径精确控制。
- **`A` 的 staged 丢弃只 unstage**：删文件的决定必须由用户在 untracked 组显式做（避免"暂存后反悔=文件消失"）。
- **冲突组暂存 = `add`**：这正是 git 的"标记已解决"语义；冲突组取消暂存会清掉 stage 1/2/3，UI 必须先确认。
- `.gitignore` 一律通过 `files.write`（追加一行 + 末尾换行）实现，不新增 git 动作；追加前用 #31 `check-ignore` 判重（P1）。

## 4. 分支与同步状态

### 4.1 `# branch.*` 行（来自 #5）

已在 §2.2。三个易错点：

| 场景 | 表现 | 处理 |
|---|---|---|
| detached HEAD | `branch.head (detached)`，无 `branch.upstream`/`branch.ab` | `detached:true, name:null, upstream:null, ahead:0, behind:0` |
| unborn（`git init` 后未提交） | `branch.oid (initial)`，无 `branch.ab` | `unborn:true, sha:null`；`reset HEAD` 类命令必须走 §3.1 的 `rm --cached` 分支 |
| 上游被删（`[gone]`） | `for-each-ref` 的 `%(upstream:track)` = `[gone]`，`status` 的 `branch.ab` **消失** | 两处都要处理：`refs.local[].ahead/behind` 记 `null` 并置 `upstreamGone:true` |

### 4.2 `for-each-ref`（#6）

```text
<refname>\t<objectname>\t<objecttype>\t<HEAD>\t<upstream:short>\t<upstream:track>\n
refs/heads/main\t0f140e1c…\tcommit\t*\torigin/main\t[ahead 2, behind 1]\n
refs/tags/v1\tfa1b5890…\ttag\t\t\t\n
refs/remotes/origin/main\t0f140e1c…\tcommit\t\t\t
```

- **TAB 分隔是安全的**：refname 经 `git check-ref-format` 校验，禁控制字符（含 `\t`）与空格。`%(upstream:track)` 变体穷举：`''`（无上游/远程分支）、`[ahead 2]`、`[behind 1]`、`[ahead 2, behind 1]`、`[gone]`；解析用 `/^\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]$/` + 先判 `[gone]`。
- `%(objecttype)=tag` 是 annotated tag，`objectname` 是 tag 对象而非 commit —— 契约只给 `{name, sha}`，UI 徽章只显示名字，**不显示 commit**，因此不解引用（需要时 P1 加 `%(*objectname)`）。
- 分组：`refs/heads/*` → `local`；`refs/remotes/<remote>/*` → `remote`（`remote` = 第三段，`name` = `origin/main`）；`refs/tags/*` → `tags`。上限 2000 条，超出 `truncated:true`（**不**截断到一半的记录）。

### 4.3 默认分支推断（固定顺序，命中即止）

1. `symbolic-ref --quiet --short refs/remotes/origin/HEAD` → `origin/main` → 去 `origin/`；
2. `git config --get init.defaultBranch`；
3. 本地存在 `main` → `main`；存在 `master` → `master`（`show-ref --verify --quiet` 各一次）；
4. 以上都失败 → `null`（UI 显示「未知」而不是猜 `main`）。

### 4.4 `log` 格式串（#7）

```bash
--format='%H<SEP>%P<SEP>%an<SEP>%ae<SEP>%at<SEP>%ct<SEP>%s<SEP>%D'
# SEP = 22 字符文本哨兵 --DSH-SEP-9x--
```

- **必须多字符哨兵**：实测故意造 subject 含 `\x1f` 的提交，用 `%x1f` 分隔时该行拆出 **9 段而不是 8 段**，直接错位。
- **`-z` 与 `%x00` 不可同用**（`-z` 已把记录分隔符变成 NUL）。契约允许两种写法，本实现选「`-z` + 文本哨兵」，并在 `log.js` 顶部注释 + 单测断言：`records.split(SEP).length === 8`，否则该条计 `bad`（实测 45,251 条 / 0 bad）。
- `%D` 只用于徽章；annotated/lightweight 与 ahead/behind 一律由 #6 提供。
- `--date-order` 保证 parent 必在 child 之后（布局算法的前提）；`--topo-order` 可换但无收益（同 0.22 s / 同体积）。
- `path` 参数存在时追加 `-- <path>`（`--literal-pathspecs` 已开）；`refs` 为数组时展开为多个 ref 名（**不**用 `--all` 混用）。

## 5. diff 结构化

### 5.1 流水线

```text
argv（#11–#15） → 逐行状态机（\n 切；保留行末 \r）
  'diff --git a/X b/Y' 新建 file ─ 'new file mode'→A ─ 'deleted file mode'→D ─ 'old/new mode'→mode
  'similarity index N%'→renameScore ─ 'rename from/to'→R+origPath ─ 'copy from/to'→C+origPath
  'index <old>..<new> <m>'→blob 变化（无 hunk = 纯 mode 变化）
  'Binary files … differ' / 'GIT binary patch'→isBinary=true, hunks=[]（跳到下一个 diff --git）
  '--- a/X' / '+++ b/Y' → 确认 path（`-p` 下无 tab 时间戳）
  '@@ -a,b +c,d @@ …' → 新 hunk（b/d 省略时 = 1）
  ' ' / '-' / '+' → 推 line{type,text,oldNo,newNo}
  '\ No newline at end of file' → 附着到**上一条** line 的 noNewline=true
  → 计数校验（hunk 头 oldLines/newLines vs 实际）→ 不符则用实际值覆盖 + 计 bad → 上限判定 → wire
```

### 5.2 五个边界情况

| 情况 | 真实输出 | 处理 |
|---|---|---|
| 无末尾换行 | 在 `-foo` 行后另起一行 `\ No newline at end of file` | **附着标记，不产生 line**；否则 hunk 行数校验必然失败（这是最容易被写成"多一行"的地方） |
| CRLF | blob 里是真 `\r\n` 时，`line.text` 末尾带 `\r` | 按 `\n` 切行、`\r` 保留在 `text` 内（否则行号错位）；渲染层决定是否隐藏。契约缺 `crlf` 标记（§12 差异 4） |
| rename / copy | `similarity index 95%` + `rename from a` + `rename to b` | `status:'R'`、`origPath:'a'`；`--find-renames=50%` **显式传**（用户可能把 `diff.renames` 关掉） |
| binary | `Binary files a/x and b/x differ` | `isBinary:true`，`hunks:[]`；**不**尝试解码 |
| submodule | `-Subproject commit <sha>` / `+Subproject commit <sha>[-dirty]` | 单 hunk + 2 行，`isSubmodule:true`；不展开子仓库 diff |

### 5.3 上限与 truncated

| 阈值 | 值 | 触发后 |
|---|---|---|
| 单次 diff 字节 | `diffBytesMax` 4 MB | `truncated:true` + 只保留首个文件的完整 hunk + `text` 头部（1 MB） |
| 单次 diff 行 | `diffLinesMax` 50000 | 同上 |
| 单文件 hunk 数 | 2000 | 该文件后续 hunk 丢弃，`truncated:true` |
| 单 hunk 行数 | 20000 | 后续行丢弃，`truncated:true` |

`truncated:true` 时 **`files[]` 仍可能只有 1 条**，UI 必须显示「diff 过大，已截断」而不是渲染成"只有一个文件变了"。

### 5.4 `--numstat` 与 `--name-status` 的拼装（#9 + #10）

两条命令**分别执行**，然后按**记录序号**配对（不按路径字符串推断）：

- 两者来自同一 commit 的同一次树遍历，顺序确定一致；`-z` 下 `--numstat` 的 rename 路径表示在不同 git 版本间有差异（`old => new` 紧凑形式 vs 两段），**字符串推断不可靠**。
- 配对时把 #9 的 `path` 与 #10 的 `path` 做**断言**：不相等 → 该文件 `additions/deletions` 记 `null` 并计 `bad`（**不让路径推断决定正确性**）。
- 二进制文件的 numstat 是 `-\t-\t<path>`（两个减号）→ `additions/deletions = null`。
- `--name-status -z` 的 rename 是 `R100\0old\0new\0` 三段；copy 是 `C075\0old\0new\0`。

## 6. 写操作

### 6.1 统一前置检查（顺序固定）

```text
1. trust==='trusted' → 否则 E_TRUST_REQUIRED；isRepo → 否则 E_NOT_A_REPO；gitAvailable → 否则 E_GIT_MISSING
2. paths 非空 且 每项经 security.md §5 校验 → 否则 E_OUTSIDE_ROOT / E_INVALID_ARG（§12 差异 5）
3. 取该 root 的写队列（串行，排队 > 30 s → E_LIMIT）
4. stale index.lock（存在且 mtime 早于本次操作开始 10 s）→ 仅警告，不删
5. spawn W … → 退出码判定 → 刷新状态
```

### 6.2 每个写命令的回滚语义

git 没有事务，回滚只有两种：

| 命令 | 失败后的状态 | 回滚策略 |
|---|---|---|
| `add` | 可能部分成功（多路径） | **不回滚**；以操作后重查的 `git.status` 为唯一真相，`staged` 计数 = 操作前后 staged 集合差 |
| `reset` / `checkout` / `commit` / `branch` / `tag` / `stash` | 全成或全不成（单路径失败即退出码非 0） | 不回滚；错误条 + 重查 status |
| `update-index --cacheinfo`（§7） | 可能写入了错的 blob | **显式 sha 回滚**（唯一需要回滚的地方，因为 blob 是我们自己算的） |

「操作后必须重查 status」是**硬约束**：写动作的返回值只带 `seq`（Host 单调递增）与计数，**不**内联 status 快照。理由：一次动作两次输出 = 双倍解析开销；且内联快照的 `seq` 会与轮询的 `seq` 竞争，客户端难以判序。

### 6.3 写队列与刷新打架

| 规则 | 实现 |
|---|---|
| 写操作串行 | 按 `root` 维护 promise 队列，队首执行时置 `writing=true` |
| 写期间**自动** status 暂停 | 轮询回调先查 `writing` → 跳过本次（**不排队**，避免堆积） |
| 写完成 | `seq++` → 广播一次「强制刷新」→ 客户端发 `git.status` |
| 用户显式刷新允许并发 | 读 ≤ 2；返回的 `seq` 若小于写完成 `seq`，客户端丢弃（ARCHITECTURE 状态所有权第 5 条） |
| 排队超时 | 30 s 未开始 → `E_LIMIT`（`detail.queued`） |
| 取消 | 写操作**不**支持取消（`kill` 掉 `commit` 可能留下 `index.lock`）；只有读操作可被新请求 kill（`E_CANCELLED`） |

## 7. hunk / 行级暂存算法

**唯一允许的路线**：`hash-object -w` + `update-index --cacheinfo`。**禁止** `git apply --cached --3way`（实测：失败时输出 `Applied patch to 'f.txt' with conflicts.` 并往 index 写入 `U f.txt`，把一次"暂存失败"变成"仓库出现冲突条目"）；也**禁止** `--cached --recount` 静默兜底（吞掉 hunk 头行数错位，写出错内容）。

```text
stageHunk(path, hunkIndex, mode /* 'stage' | 'unstage' */, selection?):
 1  rel = relPath(path)                       // 已过 §security-5 校验，'/' 分隔
 2  lsTree = P ls-tree HEAD -- rel            // '100644 blob <sha>\t<rel>'
    isNew  = (exit != 0)                     // 不在 HEAD 里
    mode   = isNew ? '100644' : lsTree.mode  // 100644/100755/120000/160000
    origSha= isNew ? '0'*40  : lsTree.sha
 3  origBytes = fs.readFile(root/rel)         // **原始字节**，不经编辑器换行规范化
 4  if mode === '160000' || isBinary(origBytes) → E_UNSUPPORTED
 5  src = (mode === 'unstage')
             ? P diff --cached --no-color --unified=0 -- rel   // index vs HEAD
             : P diff           --no-color --unified=0 -- rel   // worktree vs index
    target = src.files[0]; h = target.hunks[hunkIndex]
    if (selection) h.lines = h.lines.filter(行号 ∈ selection)
 6  base = (mode === 'unstage') ? P show HEAD:rel : origBytes
 7  newText = applyHunk(base, h)              // 见下
 8  sha = P hash-object --stdin -w --path rel   < newText
 9  W update-index (isNew || mode==='unstage' ? '--add' : '') --cacheinfo <mode>,<sha>,<rel>
10  verify = P diff --cached --no-color --unified=0 -- rel
    断言：解析出的 +行数/-行数 === 预期（mode='stage' 时 + = 选中 +行；unstage 时 - = 选中 -行）
11  失败/断言不符 →
      isNew ? W rm --cached -q -- rel
            : W update-index --cacheinfo <mode>,<origSha>,<rel>
      → E_GIT_FAILED { detail.reason:'hunk-verify-failed' }
12  return { seq: ++seq }                    // 客户端随后重查 status + diff
```

```text
applyHunk(base, hunk):
lines = base.split('\n'); out = []; oldIdx = hunk.oldStart - 1; newIdx = 0   // 保留末尾空段
for (ln of hunk.lines):        // ' ' → out.push(lines[oldIdx++]), newIdx++
  '-' → oldIdx++              // '+' → out.push(ln.text), newIdx++
// 多个 hunk 时对 hunk 数组**倒序**处理（从文件尾往前），否则前面的增删会让后面 hunk 的 oldStart 漂移
if (hunk.lines.at(-1).noNewLine) out 末尾不补 '\n'
return out.join('\n')
```

正确性约束（每条都对应一个已知错法）：

| 约束 | 错法后果 |
|---|---|
| `origBytes` 必须是**原始字节** | 用编辑器规范化后的 `\n` 文本 → 提交进 index 的 blob 与工作区不一致，`git status` 出现伪 `MM` |
| 尊重 `\ No newline` 标记 | 末尾凭空多/少一个换行，回读校验必挂（这是校验存在的意义） |
| mode 取自 `ls-tree`，不取 `fs.stat` | 可执行位丢失（`100755` → `100644`）、符号链接被写成普通文件 |
| 新增文件必须 `--add` | `update-index` 静默不写（exit 0 但 index 无变化），回读校验挂 |
| 删除全部行合法 | 目标文本为空串 → `hash-object` 得空 blob，这是合法的"文件变空" |
| 冲突态拒绝 | index 有 stage 1/2/3 三份条目，`--cacheinfo` 会静默覆盖 stage 0 → 丢冲突信息 |
| 大文件保护 | 全文要过一次 stdin：> `writeBytesMax` 8 MB → `E_TOO_LARGE`（`detail.limit`） |

## 8. 刷新与节流

### 8.1 P0（轮询）

| 参数 | 值 | 说明 |
|---|---|---|
| 间隔 | `statusPollMs` 1500 | 契约下发；实现不自行改 |
| 门控（全部为真才发） | 面板可见 ∧ 窗口聚焦 ∧ `!writing` ∧ 未 `isHuge` ∧ 上一次 status 已结束 | 任一条假则**跳过本次**（不排队） |
| 去重 | 同参数 300 ms 内复用同一 promise | 契约 §7 |
| 触发点 | 定时 / 写操作完成 / 面板 focus / `visibilitychange` / 编辑器保存后 / 切根目录 | 后四者立即触发一次 |
| 超时 | `statusTimeoutMs` 8000 | 超时 → `isHuge:true`（见 8.3） |

### 8.2 P1（watch 推送）

```text
watch.start { kinds:['workspace','git'] } → { token, epoch }
```

| 规则 | 值 | 理由 |
|---|---|---|
| debounce | 1000 ms | 合并爆发事件（`git add .` 一次几百个） |
| throttle | 上一次 status 未完成 → **丢弃**（不排队） | 防 IPC 堆积 |
| whenIdle | 写队列非空 → **延后**（不丢弃） | 写完必须看到结果 |
| 合并 | 同 kind + 同 path 只留一条；`dropped:true` → 客户端全量刷新 | 契约 §6 |
| 失效判定 | 10 分钟无任何事件但轮询发现变化 → `stopped:true, reason:'error'` | 网络盘/外置卷上 `fs.watch` 可能完全不报 |
| fd/上限 | `fs.watch` 抛 `EMFILE`/`ENOSPC` → `stopped:true, reason:'limit'` | 客户端退回 1500 ms 轮询 + 提示「自动刷新已降级」 |

监听范围（**只这些**）：

| 路径 | 说明 |
|---|---|
| `<root>/**`（递归） | 排除 `**/node_modules/**`、`**/.git/**`、`**/.git/lfs/**`、`**/.git/objects/**` |
| `<root>/.git/index`、`.git/HEAD`、`.git/refs/**`、`.git/MERGE_HEAD`、`.git/REBASE_HEAD`、`.git/CHERRY_PICK_HEAD`、`.git/index.lock` | 仓库状态；`index.lock` 只用于**过滤**（我们自己的操作会产生它，不过滤会自激） |

**macOS 递归 watch 只报 `rename`**（Node 24 实测：嵌套文件的内容修改也只给 `rename`，新建嵌套目录按路径分量连续上报 `rename:a`、`rename:a/b`）。后果：**不能按 `eventType` 分流**，任何事件一律当「目录变了」，靠 debounce 合并。Windows 上 `ReadDirectoryChangesW` 缓冲区溢出会**静默丢事件**，因此必须保留 10 分钟哨兵判定。

### 8.3 巨大仓库判定与降级

| 判据 | 阈值 | 降级动作 |
|---|---|---|
| status 超时 / 条目数 | 一次超过 `statusTimeoutMs` 8000，或变更 > 10000（VS Code `statusLimit` 默认值） | `isHuge:true`：停自动刷新，只留手动刷新按钮 |
| 未跟踪文件量 | `-uall` 输出 > 32 MB | 降到 `--untracked-files=normal`；再超 → `=no` |
| 布局悬空 lane | 单行活跃 lane > 200 | 合并为单列竖线 + 徽章（见 `git-graph.md` §4.2） |

**不做**的性能优化（实测无收益或有副作用）：`core.untrackedCache=true`（5 万文件仓库 0.06–0.08 s 前后无差异）、`core.fsmonitor=true`（macOS 已有 `fsmonitor--daemon`）。**一律不写用户 `.git/config`**，需要时用 `git -c key=value` 临时覆盖。

## 9. 性能预算与实测

| 场景 | 命令/口径 | 实测 | 预算 | 结论 |
|---|---|---|---|---|
| 1 万文件、干净 | #5 | 0.05–0.07 s（5 万文件仓库同口径） | ≤ 150 ms（ARCHITECTURE） | 达标 |
| 5 万文件刚 `touch` / 稳定后 | #5 首跑 / 次跑 | **2.97 s**（重新哈希全部）/ 0.05–0.07 s | — | 靠「写队列未 idle 则跳过轮询」平滑，**不**靠加长 debounce |
| 10 万未跟踪文件 | `-unormal` / `-uall` / `-uno` | 0.03 s / **0.07 s（1,423,000 B）** / 0.01 s | — | 慢在解析与 IPC，不在 git |
| 45,251 commit 全量 log | #7 | **0.22 s / 7,012,965 B / 解析 36.1 ms / heap 40 MB / 0 bad** | — | 首屏可一次拉 5000 条 |
| 371 条 refs | #6 | 0.15 s | — | 与 log 并行发 |
| 单提交 `--stat` | #10 | 0.01 s | — | 点开即取 |
| 图谱布局 5 万 commit / 400 分支（/ 40 分支） | `--date-order` 输入 | **76.7 ms**（/ 5.2 ms） | ≤ 250 ms（首页 2000 条含布局） | 达标 |
| 病态拓扑（lane 不闭合） | 同上 | **3,982 ms**（50k） | — | 必须做悬空 lane 回收（200 行） |
| status 对 index 的副作用 | 无 `--no-optional-locks` | index mtime 17:45:28 → 17:48:53 | 0 次改写 | 必须 `--no-optional-locks` |

## 10. git stderr → ErrCode → UI 文案

判定顺序：**先退出码**（`ENOENT` → `E_GIT_MISSING`；signal=SIGTERM 且超时 → `E_TIMEOUT`），**再 stderr 正则**（下表从上往下短路），**都未命中** → `E_GIT_FAILED{reason:'unknown'}`。

| # | stderr 片段（原文） | reason | ErrCode | UI 文案 |
|---|---|---|---|---|
| 1 | `fatal: unable to auto-detect email address` / `fatal: no email was given and auto-detection is disabled` | `no-identity` | `E_GIT_FAILED` | 请先配置提交身份：`git config --global user.email "you@example.com"` |
| 2 | `fatal: Unable to create '<path>/.git/index.lock': File exists.` | `index-lock` | `E_GIT_FAILED` | 另一个 git 进程正在操作本仓库；若是残留锁，确认后手动删除 `.git/index.lock` |
| 3 | `error: pathspec '<p>' did not match any file(s) known to git` | `pathspec` | `E_NOT_FOUND` | 路径不在仓库中（可能已被移动或删除） |
| 4 | `nothing to commit, working tree clean`（exit 1） | `nothing-to-commit` | `E_GIT_FAILED` | 没有可提交的变更 |
| 5 | `fatal: not a git repository (or any of the parent directories)` | `not-a-repo` | `E_NOT_A_REPO` | 当前目录不是 git 仓库 |
| 6 | 任意 hook 名 + `hook` 关键字，如 `[pre-commit] ` / `husky - pre-commit hook exited with code 1` | `hook-rejected` | `E_GIT_FAILED` | `pre-commit` 钩子失败（退出码 1），详见展开的 stderr |
| 7 | `! [rejected]  … (non-fast-forward)` | `non-fast-forward` | `E_GIT_FAILED` | 远端有新提交，请先 pull 或 rebase |
| 8 | `error: Your local changes to the following files would be overwritten by checkout` | `dirty-worktree` | `E_GIT_FAILED` | 有未提交的变更，请先提交或 stash |
| 9 | `fatal: You are not currently on a branch` | `detached-head` | `E_GIT_FAILED` | 当前处于分离 HEAD 状态，操作已取消 |
| 10 | `fatal: detected dubious ownership in repository at '<p>'` | `unsafe-directory` | `E_GIT_FAILED` | 仓库属主与当前用户不一致。确认可信后请**手动**执行：`git config --global --add safe.directory <p>`（本插件不会替你写这条配置） |
| 11 | `error: insufficient permission for adding an object to repository database` / `Permission denied` / `error: unable to unlink old '<p>': Permission denied` | `permission` / `unlink` | `E_GIT_FAILED` | 权限不足，无法写入 `.git`；或文件被占用/只读 |
| 12 | `error: Committing is not possible because you have unmerged files.` / `fatal: Exiting because of an unresolved conflict.` | `unmerged` | `E_GIT_FAILED` | 存在未解决的冲突，请先标记已解决 |
| 13 | `fatal: bad revision '<r>'` / `fatal: ambiguous argument '<r>'` | `bad-ref` | `E_NOT_FOUND` | 找不到该引用 |
| 14 | `fatal: unknown option 'z'` / `error: unknown switch 'z'` | `git-too-old` | `E_UNSUPPORTED` | git 版本过旧（需 ≥ 2.15 才支持 porcelain v2 / `GIT_OPTIONAL_LOCKS`），请升级 |
| 15 | `fatal: you need to resolve your current index first` | `index-unresolved` | `E_GIT_FAILED` | 当前操作未完成（merge/rebase 进行中），请先完成或中止 |
| 16 | `fatal: cannot lock ref 'refs/heads/<b>'` | `ref-locked` | `E_GIT_FAILED` | 分支引用被锁定，请重试 |
| 17 | `fatal: The current branch <b> has no upstream branch` | `no-upstream` | `E_GIT_FAILED` | 当前分支没有上游，请先 `git push -u` |

`detail` 字段（契约既有）：`{ code, argv, stderr }`；本实现追加 `reason`（见 §12 差异 6）。`stderr` 进 wire 前必须**脱敏 + 去噪**（去 `\r` 进度行、把 root 前缀替换成 `.`、按 `security.md` §6 的规则打码），最多 4 KB。

## 11. 与 security.md 的分工

本文只定「数据长什么样、命令怎么发、解析怎么算」；**信任门禁、硬化 `-c`/env 的逐条理由、路径校验、凭据脱敏、终端与渲染安全、供应链白名单**全部在 [security.md](./security.md)，两文不重复。

## 12. 与契约的差异（已复核：全部并入契约 v2）

初版写下的 12 条缺口，已在 `docs/remote-contract.md` 的 v2 增补中处理（见该文档 §9 变更记录）。差异只剩**形式不同**，语义一致：

| # | 初版期望 | 契约 v2 实际 | 落地注意 |
|---|---|---|---|
| 1 | `working` + 内部检测未跟踪 | 新增 `target:{kind:'untracked', path}` | Host 仍用 `diff --no-index /dev/null <path>`（退出码 1 = 成功），客户端不必特判 |
| 2 | 新增 `git.init` 动作 | 已有，签名 `{defaultBranch?}` → `{seq}` | 必须 UI 二次确认；`E_NOT_A_REPO` 时**不得**自动 init |
| 3 | `Change.mode` 扩到四路 | 保持三槽，冲突另给 `Change.stages:[m1,m2,m3]` | 冲突三路内容按需 `show :1:/:2:/:3:`，不进 status |
| 4 | 行级 `noNewline` | 改为 **Hunk 级** `oldNoEol/newNoEol`，行级保留可选 | `\ No newline` 标记属整侧属性，别按行猜 |
| 5 | 新增 `E_INVALID_ARG` | 已有（`detail.field`） | 空 `paths[]`、空 message、非法 ref 名都走它，不凑 `E_UNSUPPORTED` |
| 6 | `E_GIT_FAILED.detail.reason` | 已有 | UI 按 `reason` 分类文案与修复按钮 |
| 7 | `git.status.untrackedMode` | 已有 `'all'\|'normal'\|'none'` | 非 `all` 必须显示「未跟踪文件未计全」 |
| 8 | `upstreamGone` / `remote[].url` | 两者都已加 | `url` 只用于展示，任何动作都不得接受 URL 当参数 |
| 9 | `git.version` / `shallow` | 已在 `workspace.state.git` | `<2.15` 提示升级；`shallow` 时图谱标「历史不完整」 |
| 10 | `watch.reason` 扩展 | 已有 `fs-events-unsupported` / `network-volume` | 分别给「当前文件系统不支持」/「网络盘」两种文案 |
| 11 | `stageHunk` 并发前置 `oldSha` | 字段名 `expectedIndexSha` | index blob 已变 → `E_VERSION_CONFLICT`，不要算下去 |
| 12 | `files[]` 级 `truncated` | 已有 | 只截断单文件时不许报「其他文件没变」 |

**仍待实现期确认（不是契约缺口）**：`u` 行四路模式里 `base` 槽是否需要在 UI 展示（默认只在冲突编辑器里用 `:1:`）。
