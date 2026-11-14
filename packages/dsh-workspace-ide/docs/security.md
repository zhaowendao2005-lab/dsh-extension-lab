# 威胁模型与硬化清单

> 本文是**硬化参数与信任策略的唯一出处**（AGENTS.md「git」节指定）：`backend/git/exec.js` 的 `-c`/env 组合、`workspace.js` 的信任门禁、`service.js` 的路径校验、`terminal.js` 的 env 白名单，全部以此为准，改动必须同步本文。
> 数据模型与命令语义见 [git-model.md](./git-model.md)；产品边界见 [ARCHITECTURE.md](../ARCHITECTURE.md)。
> 实测环境：macOS 27.0.1 / Apple Git **2.54.0** / Node **v24.22.1**（`research/git-backend.md` §8）。

## 1. 威胁模型

**基线事实**：面板一打开就会跑 `git status`，而 `git` 会**执行仓库本地配置里指定的外部命令**。这不是理论问题——2026-05 的 GitHub Copilot CLI（CVE-2026-45033）与 2026-08 的 Eclipse Theia（CVE-2026-19884）都是「打开文件夹 → 自动 `git status` → 恶意 `.git/config` → RCE」。公开分析列出 **15+ 个可执行配置键**。

| # | 攻击面 | 触发条件 | 后果 | 本插件处置 |
|---|---|---|---|---|
| 1 | 恶意 `.git/config` 的可执行键（`core.fsmonitor`、`core.hooksPath`、`diff.external`、`merge.tool`、`core.pager`、`core.editor`、`credential.helper`、`core.sshCommand`、`core.askPass`、`gpg.program`、`diff.<d>.textconv`、`filter.<n>.clean/smudge/process`） | 打开目录即后台 `git status` | 任意代码执行（宿主是 Node 主进程，无沙箱） | 读路径逐个 `-c key=` 覆盖（§3.1）+ 信任门禁（§2）；**不写**用户 `.git/config` |
| 2 | 恶意 hook（`.git/hooks/pre-commit`、或 `core.hooksPath` 指向的目录） | 我们发起 `commit`/`checkout`/`merge`/`rebase`（hook 在这些命令里跑；`status` 不跑） | 代码执行 | 未信任 → 写操作全部 `E_TRUST_REQUIRED`（不进队列）；已信任 → 沿用用户配置（§4.1） |
| 3 | 恶意 filter / diff driver（`.gitattributes` 里的 `filter=foo`、`diff=bar`） | `git add`（clean filter）、`checkout`（smudge）、`diff`/`status`（为比对内容而跑 clean filter） | 代码执行；或内容被静默改写 | 未信任 → **按属性文件枚举 filter 名后逐个 `-c filter.<n>.*=`**（§3.3），`diff` 加 `--no-textconv` | 
| 4 | 恶意 `.gitattributes`（`text eol=crlf`、`working-tree-encoding=UTF-16`、`filter=lfs`） | `add`/`checkout`/`diff` 的内容规范化 | 内容被改写、diff 与实际不符、仓库被写坏 | 不做自动 `--renormalize`；hunk 暂存走原始字节 + 回读校验（git-model §7） |
| 5 | 路径逃逸（`../../etc/passwd`、`root/link -> /etc`、macOS 大小写、Windows 盘符） | 任意带 `path` 的动作 | 读写工作区外文件 | Host 侧 `realpath` + 前缀校验（§5） |
| 6 | 凭据泄漏（`~/.git-credentials`、URL 内嵌 `user:token@`、stderr 回显、`detail` 进 session log） | 网络动作失败、错误条展开 | token 落进日志/上报 | 不读凭据文件；只依赖用户 helper；stderr 脱敏（§6） |
| 7 | 终端转义欺骗（OSC 52 写剪贴板、OSC 8 超链接、`\e[2J` 清屏伪造提示、`\e]0;` 伪造标题、SGR 隐藏文本） | 终端里 `cat` 一个恶意文件、或 `git log` 输出被投毒 | 静默改剪贴板 / 钓鱼链接 / 视觉欺骗 | 不禁用 ANSI（终端本来就要吃）；**不注册**链接处理器、不进 Markdown 渲染、裁剪标题序列（§7） |
| 8 | XSS（文件名/分支名/提交信息/diff 内容里含 `<img onerror=…>`） | 渲染 SCM 列表、diff、Markdown 预览 | 在 DSH 页面上下文执行脚本 | 一律文本渲染 + 构建期禁 `dangerouslySetInnerHTML`（§8） |
| 9 | 依赖供应链（postinstall、native 模块、许可证不明的包） | `pnpm install` | 装包即执行代码 | 白名单 + 无 postinstall + 无 native 断言（§10） |
| 10 | 网络动作（P2：推送到恶意远端、`ProxyCommand` 注入、credential 弹窗钓鱼） | 用户点 push/pull | 凭据外泄、代码外泄 | 默认关闭、显式点击、仅 trusted、不允许 wire 传任意 URL（§9） |
| 11 | 属主不一致仓库（`fatal: detected dubious ownership`，CVE-2022-24765 保护） | 打开别人拥有的目录 | 被诱导执行他人仓库的 hook/配置 | **不自动写** `safe.directory`；报错 + 给用户手动命令（§4.3） |
| 12 | 递归子模块符号链接写 hook（CVE-2024-32002，CVSS 9.0，2.45.1 修复） | `clone --recurse-submodules` / `submodule update --recursive` | clone 过程中执行 hook | **不实现** clone 与递归子模块（§12） |
| 13 | 超长/超深路径、巨量未跟踪文件（DoS） | 打开恶意构造的仓库 | Host 内存/CPU 打满、面板卡死 | 所有输出有上限（32 MB / 20000 条 / 5000 目录项）+ `isHuge` 降级（git-model §8.3） |
| 14 | 信任状态被误用（`/tmp/a` 与 `/tmp/a2` 共用前缀、symlink 指向已信任目录） | 用户信任某目录后打开其"别名" | 越权写入 | 信任键用 `realpath` + 大小写归一后存储（§2.1） |

**明确不覆盖**：见 §12。文档不承诺"打开任意仓库都安全"，只承诺**未信任时不执行仓库内的任何外部命令**。

## 2. 信任模型

### 2.1 判定与存储

| 项 | 规格 |
|---|---|
| 三态 | `trusted` / `untrusted` / `unknown`（`workspace.resolve` 返回 `trust`，与契约一致） |
| 首次打开 | `unknown`，**不默认信任**，UI 顶部提示条「此工作区尚未信任：只读」+ 两个按钮 |
| 存储位置 | 插件 `storageDomain`，键 `workspace_ide/trust`，值 `{ roots: { [realpath]: { state, updatedAt } } }` |
| 绝不写到 | 仓库文件（不建 `.vscode/`、不写 `.git/config`、不写 DSH 项目文件） |
| 键规范化 | `fs.realpath(root)` + macOS/Windows 上 `.toLowerCase()`；**不存用户输入的原始字符串** |
| 失效 | 目录被删/移动 → `realpath` 失败 → 视为 `unknown`（不因路径字符串相同就沿用旧信任） |
| 撤销 | UI「撤销信任」→ 写 `untrusted`；进行中的写队列**不中断**（已完成的不回滚） |
| `untrusted` 与 `unknown` 的差别 | 行为完全相同；`untrusted` 只是"用户已明确拒绝"，不再弹提示条 |

### 2.2 动作 × 信任 矩阵

| 动作组 | `trusted` | `unknown` | `untrusted` | 未信任时的限制方式 |
|---|---|---|---|---|
| `files.list` / `files.read` / `files.stat` | ✓ | ✓ | ✓（只读） | — |
| `files.write` / `create` / `rename` / `delete` | ✓ | ✗ `E_TRUST_REQUIRED` | ✗ | 按钮 disabled + tooltip |
| `git.status` / `log` / `graph` / `refs` / `commit`(读) | ✓ | ✓（**手动触发**，不自动轮询/watch） | ✓（手动） | 硬化参数 + 不自动刷新 |
| `git.diff`（`index`/`commit`/`range`） | ✓ | ✓ | ✓ | 只读对象库，不跑 filter |
| `git.diff`（`working`） | ✓ | ✓（**过滤 filter 名后**） | ✓（同） | §3.3 枚举清空；`filter=lfs` 的文件跳过内容、只给摘要 |
| `git.stage`/`unstage`/`discard`/`stageHunk` | ✓ | ✗ | ✗ | 同上 |
| `git.commitCreate` / `checkout` / `branch` / `tag` / `stash` | ✓ | ✗ | ✗ | 同上 |
| **hooks** | 沿用用户配置（§4.1） | 不启用（`-c core.hooksPath=<tmpEmpty>`） | 不启用 | 写操作本就被挡，无路径 |
| `terminal.create` / `write` | ✓（仍需一次确认，§7.1） | ✗ 需显式确认对话框 | ✗ | 对话框显示**绝对路径**与「终端里的命令不经任何沙箱」 |
| `git.network`（P2） | ✓（默认仍关闭，需设置项） | ✗ | ✗ | §9 |
| `watch.start` | ✓ | ✗（退轮询） | ✗ | 未信任不铺 watcher |
| `git init`（用户点「初始化仓库」） | 仅 trusted 可写；`init` 本身不改仓库内已有内容 | ✗ | ✗ | 必须显式点击 + 确认框（AGENTS.md：不自动 `git init`） |

**门禁语义**：限制在 **Host 侧**（`service.js` 分发处），前端 disabled 只是 UX。理由：Remote 可被任何客户端调用，不止我们的 UI。

## 3. 读路径硬化

### 3.1 参数与环境变量（逐条理由）

```bash
git --no-optional-locks \
    -c core.fsmonitor=false -c core.pager=cat -c core.hooksPath=<tmpEmptyDir> \
    -c credential.helper= -c core.askPass= -c diff.external= -c core.sshCommand= \
    -c color.ui=false -c gc.auto=0 -c maintenance.auto=false \
    [--literal-pathspecs] <subcommand>
```

| 项 | 值 | 理由（不做的后果） |
|---|---|---|
| `--no-optional-locks` | 开 | 普通 `status` 会刷新并重写 `.git/index`（实测 mtime 17:45:28 → 17:48:53），与用户自己的 git 抢锁 |
| `-c core.fsmonitor=false` | 开 | `core.fsmonitor` 是可执行配置键：**普通 `git status` 就会执行它**（这是 Theia/Copilot CLI RCE 的入口） |
| `-c core.pager=cat` + `GIT_PAGER=cat` | 开 | stdout 非 tty 时 pager 本不跑，但 `pager.<cmd>` 包装仍可能生效；双保险 |
| `-c core.hooksPath=<tmpEmpty>` | 仅读 | 读命令理论上不跑 hook；统一基线，防未来误用 `checkout` 类命令 |
| `-c credential.helper=` | 开 | 读命令不需要凭据；不触发任何 helper（含恶意 `credential.helper`） |
| `-c core.askPass=` | 开 | 绝不弹密码框 |
| `-c diff.external=` + `--no-ext-diff` | 开 | `diff.external` 在加 `--ext-diff` 才执行，双保险 |
| `--no-textconv` | 开（仅 diff） | `diff.<driver>.textconv` 由 `.gitattributes` 控制，会执行任意程序 |
| `-c core.sshCommand=` | 开 | 无 ssh，杜绝 `ProxyCommand`/自定义 ssh 脚本 |
| `-c color.ui=false` | 开 | 用户 `color.ui=always` 会把 ANSI 写进 stdout，破坏解析 |
| `-c gc.auto=0 -c maintenance.auto=false` | 开 | status 不应顺带触发 gc |
| `-c core.quotepath=false` | 仅 `for-each-ref`/`tag`（无 `-z`） | 否则中文/表情分支名被 C 转义成 `"feat/\346\227\245"` |
| `--literal-pathspecs`（或 `GIT_LITERAL_PATHSPECS=1`） | 开 | 文件名 `*.txt`、`:(top)`、`:(icase)` 会被当 pathspec 魔法 → **路径注入** |
| `GIT_CEILING_DIRECTORIES=<dirname(root)>` | 开 | 根不是仓库时不向上冒用父目录的 `.git` |
| `GIT_TERMINAL_PROMPT=0` | 开 | 永不卡在账号密码提示（会挂起子进程直到超时） |
| `GIT_OPTIONAL_LOCKS=0` | 开 | 同 `--no-optional-locks`，双保险 |
| `LC_ALL=en_US.UTF-8` / `LANGUAGE=en` | 固定 | stderr 必须可被 §10 的正则匹配；**不用 `C`**（部分系统会打 `setlocale` 警告），也不用非法 locale |
| `GIT_ATTR_NOSYSTEM=1` | 开 | 忽略系统级 gitattributes，减少一处可控输入 |
| 清除继承：`GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`、`GIT_NAMESPACE`、`GIT_PREFIX`、`GIT_COMMON_DIR`、`GIT_QUARANTINE_PATH` | 置空/删除 | 用户 shell 里 export 过 `GIT_DIR` 会把我们的命令指到别的仓库 |
| **不**设 `GIT_CONFIG_NOSYSTEM=1` | — | 会丢系统级 `core.autocrlf`、`safe.directory`，行为与用户命令行不一致 → "IDE 说改了、命令行说没改"的支持成本 |
| **不**设 `HOME` / `XDG_CONFIG_HOME` | — | 必须读用户 gitconfig 才有 `user.email`、`init.defaultBranch` |
| **不**设 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | — | 不伪造身份；缺身份就走 §"no-identity" 错误 |

### 3.2 为什么**不能**无条件清空 `filter.*`

三个理由缺一不可：

1. **git-lfs 就是靠它工作的**：`filter.lfs.clean` / `smudge` / `process` 是 lfs 的全部实现。清空后，`git add` 会把 lfs 指针文件当普通内容写进仓库、`checkout` 会把指针文件当内容检出——**这是比 RCE 更常见的实际数据损坏**（用户不会立刻发现）。
2. **名字不可预知**：`-c filter.<n>.clean=` 需要先知道 `<n>`，而 `<n>` 来自 `.gitattributes` 里的 `filter=<任意名字>`，可以是仓库作者随手起的 `evil`、`foo2`。**无法穷举**。
3. **`-c` 只覆盖当次调用**：即使枚举了，也只对本次 spawn 生效（这正是我们要的），但前提仍是"枚举得到"。

**正解：按实际属性文件枚举，而不是按"所有可能的 key"清空。**

```text
collectFilterNames(root):
  sources = [
    root/.gitattributes,
    root/.git/info/attributes,
    <core.attributesFile>            // 默认 ~/.config/git/attributes
  ]
  sources += 递归查找 root/**/.gitattributes
             （排除 **/node_modules/**、**/.git/**；上限 500 个文件）
  names = ∪ /(?:^|\s)filter=([A-Za-z0-9._-]+)/g 的捕获组
  if (找到的文件数 > 500) → 返回 { unknown: true }
  return names

hardenFilters(names) → 每个名字追加：
  -c filter.<n>.clean= -c filter.<n>.smudge=
  -c filter.<n>.process= -c filter.<n>.required=false
```

| 情况 | 处置 |
|---|---|
| 枚举成功且 `names` 不含 `lfs` | 全部清空 → 工作区相关命令不再执行任何 filter |
| 枚举成功且含 `lfs` | 清空后 **`git diff{working}` 对 lfs 文件只给摘要**（`-diff --numstat` 走不了 → 显示「Git LFS 文件，未信任时不读取工作区内容」） |
| 枚举失败（> 500 个属性文件） | 未信任时**只允许** `status --untracked-files=no`（不比对内容）+ `log`/`show`/`refs`/`diff{cached,commit,range}`；`working` diff 置灰并说明原因 |

已信任工作区**不做任何 filter 清空**（lfs 必须正常工作）。

### 3.3 读路径的三个"不做"

| 不做 | 理由 |
|---|---|
| 不 `git config --get-regexp` 全量读用户配置 | 会把 `credential.*`、`url.*.insteadOf`（可能含 token）读进内存和 `detail`；只读我们需要的少数键（`init.defaultBranch`、`core.attributesFile`） |
| 不解析 `.git/config` 做"可疑键扫描" | 不可枚举（键名任意、大小写不敏感、include 链、`includeIf` 条件、bare repo 嵌套手法 OVE-20210718-0001），静态扫描给人虚假安全感——§12 已声明不做 |
| 不改 `core.*` 性能配置 | `core.untrackedCache`/`core.fsmonitor` 实测无收益（5 万文件仓库 0.06–0.08 s 无差异），且写用户配置违反"不写 `.git/config`" |

## 4. 写路径策略

### 4.1 hooks 什么时候允许

| 条件 | 行为 |
|---|---|
| `trusted` 且设置项 `git.runHooks=true`（默认 true） | **不加** `-c core.hooksPath`，用用户的 `core.hooksPath` / `.git/hooks`；hook 的 stdout/stderr 透传到错误条（脱敏后） |
| `trusted` 且 `runHooks=false` | 加 `-c core.hooksPath=<tmpEmpty>`（等效于跳过 hook，但不改用户配置） |
| `unknown` / `untrusted` | 写操作根本到不了这里（`E_TRUST_REQUIRED`） |
| 单次提交想跳过 | `git.commitCreate.noVerify:true` → `--no-verify`（**UI 必须标注"跳过 pre-commit 校验"**） |

**为什么不出手改 `core.hooksPath` 配置**：那会让用户以为自己的 lint/commitlint 还在生效，实际没跑——比明确失败更糟。跳过 hook 只能是**显式、单次、可见**的（`--no-verify` 开关）。

### 4.2 写路径 vs 读路径的参数差异

| 项 | 只读 | 写 |
|---|---|---|
| `--no-optional-locks` | ✓ | ✗（对写无效，实测 `GIT_OPTIONAL_LOCKS=0` 不阻止写操作取锁） |
| `-c core.hooksPath=<tmpEmpty>` | ✓ | 仅 `runHooks=false` 时加 |
| `-c credential.helper=` / `core.sshCommand=` | ✓ | 本地写命令不需要网络，仍清空（防 `post-*` hook 里间接用到） |
| `--literal-pathspecs` | ✓ | ✓（**必须**，`<paths>` 直接来自 wire 与文件名） |
| `index.lock` 处理 | 不检查（读不受影响，实测 stale lock 下 status 仍 exit 0） | 检查：存在且 mtime 早于本次操作开始 10 s → **提示**「可能是残留锁」，**不自动删**（另一个 git 可能正在跑） |

### 4.3 `safe.directory` 报错

`fatal: detected dubious ownership in repository at '<path>'` →

1. 返回 `E_GIT_FAILED{ reason:'unsafe-directory', stderr }`；
2. UI 显示**可复制的命令文本**：`git config --global --add safe.directory '<path>'`；
3. **绝不自动执行**。自动写全局 `safe.directory '*'` 等于替用户关掉 CVE-2022-24765 的保护，且会污染用户所有项目。
4. 该错误**不**降级为"只读可浏览"：仓库仍可读（`status` 也会被 git 拒绝），所以直接显示错误态。

## 5. 路径校验算法

**必须在 Host 侧**（`backend/workspace.js`）。前端校验只是 UX 预检，不构成边界：浏览器没有文件系统、无法 `realpath`；Remote 可被任意客户端调用；用户可改前端代码。

```text
resolveInsideRoot(root, rel):
 1  rootReal = cache(realpath(root))                    // 切根时重算
 2  拒绝：rel 含 '\0' 或 < 0x20 的控制字符
 3  拒绝：path.isAbsolute(rel) || /^[A-Za-z]:/ || rel.startsWith('\\\\')  // 绝对路径 / 盘符 / UNC
 4  norm = path.posix.normalize(rel)                    // '..' 在这里被解析（POSIX 语义，wire 一律 '/'）
 5  拒绝：norm === '..' || norm.startsWith('../')
 6  abs = path.join(rootReal, norm)                     // 注意：不 resolve，避免再次解析 '..'
 7  real = realpathOfDeepestExisting(abs)               // 对已存在的最深祖先 realpath，再拼剩余段
 8  // 前缀比较必须有分隔符边界，否则 /tmp/a 会匹配 /tmp/ab
     if (real !== rootReal && !real.startsWith(rootReal + path.sep)) → E_OUTSIDE_ROOT
     // macOS(APFS 默认)/Windows 大小写不敏感 → 两侧都 casefold 后再比
 9  写操作：落盘前再 realpath 一次父目录（缩小 TOCTOU 窗口）；最终组件允许是 symlink，
     但它的 realpath 必须仍满足第 8 步（否则 E_OUTSIDE_ROOT）
10  return abs
```

| 用例 | 输入 | 结果 |
|---|---|---|
| 上跳 | `../../etc/passwd` | 第 5 步拒绝 |
| 绝对 | `/etc/passwd` | 第 3 步拒绝 |
| 盘符（未来 Windows） | `C:\Windows\win.ini` | 第 3 步拒绝 |
| UNC | `\\server\share\x` | 第 3 步拒绝 |
| 目录符号链接逃逸 | `root/d -> /etc`，传 `d/passwd` | 第 7 步 realpath → `/etc/passwd` → 第 8 步拒绝 |
| 文件符号链接逃逸 | `root/f -> /etc/passwd` | 第 8/9 步拒绝（读也拒绝：读 `files.read` 同一函数） |
| 合法符号链接 | `root/link -> root/src/a.ts` | 允许（realpath 仍在根内） |
| 大小写混用 | root `/Volumes/X`，传 `volumes/x/a` | 放行（casefold 后相等）——**不要**用它来绕过：写盘路径用原始 `abs`，不用用户给的串 |
| 前缀陷阱 | root `/tmp/a`，real `/tmp/ab/c` | 第 8 步的 `+ sep` 保证拒绝 |
| 长路径（Windows） | 259 字符 | 由 `-c core.longpaths=true`（Windows 专用追加项）解决，校验本身不截断 |

同一函数服务 `files.*` 与 `git.*` 的 `paths`；git 侧的相对路径还要求 `/` 分隔（git 只接受 `/`），转换在 `exec.js` 完成，**不在前端**。

## 6. 凭据

| 规则 | 实现 |
|---|---|
| 绝不读 `~/.git-credentials` / `~/.config/git/credentials` | 不实现 credential store，不做任何文件读取 |
| 只依赖用户机制 | 网络动作（P2）用用户的 credential helper / `GIT_ASKPASS`；本地操作完全不需要凭据 |
| 不弹自有密码框 | 没有密码输入 UI，不存在"我们保管密码"这件事 |
| 不保存、不缓存、不写 DSH storage | 凭据永远不出现在 wire / `detail` / 审计记录里 |
| 读路径必清 | `-c credential.helper=` + `-c core.askPass=` + `GIT_TERMINAL_PROMPT=0` |

**脱敏在 Host 侧执行**（进 wire 之前，也进审计记录之前），规则表：

| 模式（正则，`i`） | 替换为 |
|---|---|
| `https?://[^/\s@]+:[^/\s@]+@` | `https://***:***@` |
| `[A-Za-z][\w+.-]*://[^/\s@]+:[^/\s@]+@` | 保留 scheme，`***:***@` |
| `(?i)authorization:\s*\S+` | `Authorization: ***` |
| `(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}` | `Bearer ***` |
| `(?i)(token\|password\|passwd\|secret\|api[_-]?key\|access[_-]?key)\s*[=:]\s*\S+` | `$1=***` |
| `gh[pousr]_[A-Za-z0-9]{20,}` | `gh*_***` |
| `sk-[A-Za-z0-9]{20,}` | `sk-***` |
| `AKIA[0-9A-Z]{16}` | `AKIA***` |
| 绝对根路径 `<rootReal>` | `.`（去路径噪声，同时避免泄漏用户名） |
| `\r` 进度行（`^\s*[^:\n]+:\s+\d+% .*\r`） | 删除（`--progress` 输出） |

脱敏后 **最多 4 KB** 进 `detail.stderr`；超长截断并标 `…[truncated]`。

## 7. 终端安全

### 7.1 创建终端的门禁

| 条件 | 行为 |
|---|---|
| 未信任 / 未知 | **必须**弹确认框：显示 `cwd` 绝对路径 + 文案「终端里的命令以你的身份执行，不经任何沙箱」；用户确认后仍只创建**一个**终端（逐个确认，不批量） |
| 已信任 | 直接创建（首次仍显示一次性的提示条） |
| `cwd` | 经 §5 校验；缺省 = 工作区根 |
| 自动执行 | **没有**任何"运行"按钮、没有自动 `cd`、没有自动 source 配置；终端只响应键盘输入 |

### 7.2 env 白名单（禁止 `...process.env` 直传）

| 变量 | 来源 | 说明 |
|---|---|---|
| `PATH` | `subprocess.terminalEnvironment().env.PATH` | 用宿主给的，不用我们自己的 |
| `HOME` / `SHELL` / `USER` / `LOGNAME` / `TMPDIR` / `PWD` | 同上 | shell 正常工作的最小集 |
| `LANG` / `LC_ALL` / `LC_CTYPE` | 同上 | 保留用户 locale（终端要正确显示中文） |
| `TERM` | 固定 `xterm-256color` | 与 xterm.js 能力匹配 |
| 其余 | **一律不传** | 白名单制，未列出即不出现 |

禁止项（显式剔除并写进单测断言）：

| 类别 | 例子 | 理由 |
|---|---|---|
| DSH 自身 | 任意 `DSH_*`（尤其 `DSH_TOKEN`、`DSH_*_KEY`、`DSH_*_SECRET`、`DSH_HOME`） | 终端里 `env` 就能看到；用户 `cat` 一个文件也可能把它带进日志 |
| 模型/供应商凭据 | `*_API_KEY`、`OPENAI_*`、`ANTHROPIC_*`、`DEEPSEEK_*` | 同上 |
| 云与 CI | `AWS_*`、`GCP_*`、`AZURE_*`、`GITHUB_TOKEN`、`CI_*` | 同上 |
| git 硬化变量 | `GIT_DIR`、`GIT_TERMINAL_PROMPT`、`GIT_OPTIONAL_LOCKS` 等 | **终端里的 git 不硬化**——文档必须写清：面板内 git 与终端 git 行为可能不同（终端里跑 `git status` 会刷 index，这是用户自己的 shell） |
| npm/pnpm 注入 | `npm_*`、`npm_config_*` | 可能含 registry token |

### 7.3 转义序列与欺骗

| 项 | 处置 |
|---|---|
| OSC 52（写剪贴板） | **不启用**：不注册剪贴板处理器；终端输出不能改系统剪贴板 |
| OSC 8（超链接） | **不注册** link provider；点击终端里的 URL 不打开任何东西（P1 若要加：仅 `http(s)` + 二次确认 + `noopener`） |
| OSC 0/2（标题） | 允许显示在 tab 上，但**截断到 256 字符**并剥离控制字符（防伪造 tab 标题） |
| `\e[2J` / 光标复位伪造 prompt | **不防**（§12）；但终端内容只进 xterm buffer，永不进我们的 Markdown/diff/通知渲染 → 不会变成"看起来像 DSH 的提示" |
| 隐藏文本（SGR 前景=背景） | 不防（§12） |
| 内存 DoS（`yes` / 海量输出） | 512 KB 环形缓冲 + 字符游标 + `dropped:true` 提示；不落盘 |
| 子进程逃逸 | `detached:true` + `kill(-pid)` 杀整个进程组；`close` = `terminate()` + 等 `done` + 2 s 强杀 |

## 8. XSS 与渲染安全

不可信输入有 6 个入口，**全部**按文本处理：文件名 / 目录名、分支名与 tag 名、提交信息与作者名、diff 内容、文件内容、错误 `stderr`。

| 规则 | 判定方式 |
|---|---|
| 禁止 `dangerouslySetInnerHTML` / `innerHTML` / `outerHTML` / `insertAdjacentHTML` | `scripts/check.mjs` 静态断言（`frontend/**` 全量） |
| 禁止 `new Function` / `eval` / `setTimeout(string)` | 同上 |
| Markdown 预览：`react-markdown` **不启用** `rehype-raw`；`allowedElements` 白名单（标题/段落/列表/表格/代码/链接/强调） | 代码 review + 单测 |
| Markdown 链接：`urlTransform` 只允许 `http:`/`https:`/`mailto:`；`javascript:`/`data:`/`file:` 一律丢弃 | 单测 |
| Markdown 图片：默认**不加载**远程图片（防 IP 泄漏/追踪）；显示占位 + 「加载图片」点击后才请求，且只允许 `https:` | 单测 |
| SVG 图标：只用仓库内 `icon.svg` 的静态常量；**不接受**来自仓库内容/文件名/提交信息的 SVG | review |
| 不引入第三方 icon 包（`lucide`、`react-icons` 等） | 依赖白名单（§10） |
| 用户数据不得拼进 `style` / `class` / `href` / `src`：`style` 只接受数字与枚举；`href` 必须 `encodeURIComponent` | review |
| 控制字符清洗：渲染前 `text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'·')`（保留 `\t`） | 共享纯函数 `frontend/service/text.ts` |
| 主题色只来自 `--dsw-*` token，禁止从仓库内容推导颜色（CSS 注入） | 构建期色值扫描（ARCHITECTURE 静态约束 4） |

## 9. 网络操作（P2，默认关闭）

| 项 | 规格 |
|---|---|
| 开关 | 设置项 `git.network.enabled`，默认 **false**；关闭时 `git.network` 一律 `E_TRUST_REQUIRED` |
| 触发 | 每次 fetch/pull/push **必须**用户显式点击（没有"提交后自动 push"） |
| 前置 | `trust==='trusted'` ∧ 开关开启 ∧ 有上游/远端 |
| 远端限制 | `remote` 必须是 `git.remote` 列表里已有的名字；**wire 不接受 URL**（防把仓库推到任意地址外泄） |
| 凭据 | 保留用户 credential helper / `GIT_ASKPASS`（唯一需要凭据的路径）；`GIT_TERMINAL_PROMPT=0`（卡住就失败，不弹框） |
| 硬化的放宽 | 网络动作**保留** `core.sshCommand` 与 `credential.helper`（否则 ssh remote 与 https 私有仓库全废）；仍清 `diff.external`/`hooksPath` |
| 超时 | 120 s；`--progress` 输出走 stderr，按 `\r` 分帧解析进度，全部脱敏后进 UI |
| 输出 | 最多 64 KB 进错误条；进度只保留最后一帧 |
| 取消 | 允许：`SIGTERM` 杀进程组 + 保留 `stderr` 尾巴 |
| 不做 | clone / `submodule update --recursive` / `lfs pull`（§12） |

## 10. 供应链

### 10.1 依赖白名单

| 包 | 用途 | 许可证 | 形态 |
|---|---|---|---|
| `@codemirror/*`（state/view/commands/language/search/merge 等） | 编辑器 + diff | MIT | 纯 JS |
| `@lezer/*` + 各语言 grammar | 语法高亮 | MIT | 纯 JS |
| `@xterm/xterm`、`@xterm/addon-fit` | 终端视图 | MIT | 纯 JS（无 worker/字体） |
| `@tanstack/react-virtual` | 虚拟滚动（文件树/图谱/列表） | MIT | 纯 JS |
| `diff`（jsdiff） | `parsePatch` → 两侧文本 | BSD-3-Clause | 纯 JS |
| `react-markdown`（+ `remark-gfm`） | Markdown 预览 | MIT | 纯 JS，**无 `rehype-raw`** |
| `zustand`（vanilla） | store | MIT | 纯 JS |
| `zod` | 双端 schema | MIT | 纯 JS |
| git-graph-plus `git-graph-builder.ts` | 图谱布局（**移植**，非依赖） | **Apache-2.0** | vendor 进本包，必须保留版权头 + `THIRD_PARTY_NOTICES.md` |

### 10.2 明确禁止引入

| 包 | 原因 |
|---|---|
| `monaco-editor` | 体积 806 KB + 100 个 CSS 文件 + worker，IIFE 单文件约束下不可行 |
| `@gitgraph/*` | 仓库 archived，且**不吃外部 DAG**（声明式 API） |
| `vscode-git-graph` 源码 | 许可证**禁止分发衍生作品**（GitHub 报 NOASSERTION） |
| `graph-lab` | npm 无 license 字段、GitHub 404，来源与许可均不可核 |
| `elkjs` | EPL-2.0 OR GPL-3.0，许可证传染病 |
| `gitbutlerapp/gitbutler` 代码 | FSL-1.1-MIT，非 OSI |
| `GitLens` `plus/` | 图谱恰在闭源目录 |
| `dugite` / `isomorphic-git` / `nodegit` / `simple-git` | 后端选型已否（research/git-backend §2）；dugite 仅 P2 可选**下载**，不进依赖 |
| `diff2html` / `react-diff-view` | 2 MB / 1.45 MB，且我们要 Host 侧结构化 hunk，客户端只画 |
| 任何 icon 包 | bundle 体积 + 供应链面；图标内联 SVG |

### 10.3 门禁

| 断言 | 位置 |
|---|---|
| 依赖许可证 ∈ {MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause} | CI license 检查脚本 |
| 本包 `package.json` **无** `postinstall`/`preinstall`/`install` 脚本 | 构建期断言 |
| 无 native 模块（无 `.node`、无 `node-gyp`） | 构建期断言 |
| `pnpm-lock.yaml` 必须提交；不允许 `^` 之外的浮动版本 | review |
| bundle ≤ 1.2 MB gzip，且不含 `new Worker(`/`importScripts(`/`.wasm` | `scripts/check.mjs` |
| `THIRD_PARTY_NOTICES.md` 含 Apache-2.0 全文 + SourceGit(MIT) 版权头 | review |

## 11. 审计与可观测

Host 侧维护**最近 200 条** git 命令的环形记录（内存），用于排查"为什么 git 报错"。

```js
// backend/git/exec.js 内部，不进 wire
{ at, action, argvRedacted, cwdRel, exitCode, signal, durationMs, bytesOut, truncated, trust, reason }
```

| 规则 | 值 |
|---|---|
| 容量 | 200 条（覆盖写，`O(1)`） |
| `argv` | 脱敏后（§6）+ 路径转相对；stdin 内容（commit message）**不记录**，只记字节数 |
| stdout/stderr | **不记录正文**，只记字节数与是否 truncated |
| 落盘 | **不落盘**；不进 `storageDomain`；进程退出即失 |
| session log | **不写**（AGENTS.md：不写 session event、不读 session log） |
| 上报 | **无**。没有 telemetry、没有 crash 上报 |
| 导出 | 仅在用户点击「导出诊断」时把环形记录（已脱敏）复制到剪贴板；导出前再跑一次脱敏 |
| 用途边界 | 只给"用户报错时贴给我们看"，不作分析用途 |

**不记录**：终端内容、文件内容、提交正文、diff 正文、任何凭据。

## 12. 明确不做的事

| 不做 | 理由（避免读者误解覆盖率） |
|---|---|
| 不 sandbox git 子进程（无 `sandbox-exec`/`bwrap`/`seccomp`） | 跨平台不可行（Windows 无等价物），且 git 必须能写 `.git` 与工作区；我们靠"未信任不执行外部命令"而不是"执行了也跑不掉" |
| 不拦 `core.symlinks`、不改 `core.autocrlf`/`core.eol` | 改了会让面板行为与用户命令行不一致（最贵的支持成本），且 `core.symlinks` 只在 checkout 生效，我们不做 clone |
| 不做恶意仓库静态扫描（不解析 `.git/config` 找可疑键、不扫 hook 文件内容） | 键名与 include 链不可枚举，扫描给人虚假安全感；信任门禁才是边界 |
| 不防"用户自己点了信任" | 信任是显式的人类决定；点了信任就等于同意执行该仓库的 hooks/配置 |
| 不实现 credential store、不弹自有密码框、不做密钥管理 | §6；凭据面越小越好 |
| 不实现 secrets 扫描（提交前查 token） | 属另一产品能力（gitleaks 类），不在本插件范围；不引入额外子进程 |
| 不防同机其它进程（本地攻击者、`ps` 窥探、`.git` 被别的进程改） | 本地多用户隔离不是本插件的信任边界；只保证"我们不主动泄漏" |
| 不承诺 DoS 免疫 | 恶意仓库可以让面板变慢（10 万 commit / 50 万 refs）；只有上限与降级（git-model §8.3），没有保证 |
| 不覆盖终端里用户自己执行的命令 | 那是用户 shell 的权限，不是我们的动作；`terminal` 只是通道 |
| 不做 clone / `submodule update --recursive` / `lfs pull` | CVE-2024-32002 类风险（递归 clone 可写 hook 并执行）+ 凭据/网络面；P2 之后单独立项 |
| 不保证与用户 `git` 命令行 100% 一致 | `-c` 覆盖、`--literal-pathspecs`、`--no-textconv` 会改变边缘行为；差异必须在错误文案里解释，而不是假装一致 |

## 13. 与契约的差异（已复核：全部并入契约 v2）

初版 8 条已在契约 v2 处理，语义与安全要求一致：

| # | 初版期望 | 契约 v2 实际 | 落地注意 |
|---|---|---|---|
| 1 | `E_TRUST_REQUIRED.detail.reason` | 已有 `'write'\|'terminal'\|'network'\|'watch'` | 按 reason 弹不同确认框；文案见 `docs/ui-spec.md` 文案表 |
| 2 | 信任作用域 | 契约写明：按 `realpath` **精确路径**匹配，不递归子目录；撤销不中断进行中操作 | UI 必须在信任对话框里说明「子目录需各自信任」 |
| 3 | git 版本字段 | `workspace.state.git.version` / `shallow` | `<2.15` → 直接提示升级，不要让 porcelain v2 解析失败 |
| 4 | `git.network.remote` 限定 | 契约写明：必须是仓库已配置的 remote 名，**禁止 URL** | Host 先比对 `git.remote` 列表，不在其中 → `E_NOT_FOUND` |
| 5 | `terminal.create` 的信任确认凭据 | 契约明确：**Host 侧一律复核**，UI 确认只是 UX | 不引入 `confirmTrusted` 之类可伪造的凭据字段 |
| 6 | 新增 `E_INVALID_ARG` | 已有 | 非法路径字符 / 空 `paths[]` / 超长 branch 名 |
| 7 | diff 硬化说明 | 契约写明：未信任时 diff 可能只给摘要；清 filter 只清该仓库**声明过的**名字 | **永远不要无条件清 `filter.*`**（git-lfs 依赖） |
| 8 | 新增 `E_PERMISSION` | 已有（`detail.syscall`） | `EACCES/EPERM` 不许伪装成「文件不存在」 |

**仍待实现期确认（不是契约缺口）**：`workspace_ide/trust` 的存储格式升级策略（版本键 + 迁移），以及审计环形记录是否也落 `storageDomain`。
