# 威胁边界与硬化清单

> 本文是 Git 硬化参数、Host 路径校验和终端环境规则的唯一出处（AGENTS.md「git」节指定）。数据模型见 [git-model.md](./git-model.md)，接口见 [remote-contract.md](./remote-contract.md)，产品边界见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 1. 当前边界

工作区已移除信任机制：没有 trust 状态、信任存储、信任动作、信任弹窗或按信任条件禁用的操作。文件写入、本地 Git 写入、watch 与终端按各自参数、路径、能力和忙碌状态处理；丢弃、更换分支等操作仍保留已有的内容保护和确认流程。

本插件只服务当前用户的工作台，不注册模型工具、不写 session event、不读 session log。Remote 入口校验调用身份、请求 envelope 与动作 payload，资源访问由 Host 解析的根目录约束。

| 面向 | 当前措施 | 边界 |
| --- | --- | --- |
| 路径越界 | 工作区内 resolve + realpath + 带分隔符的前缀校验 | 浏览器路径预检不替代 Host |
| 多会话 / 多仓库串线 | AsyncLocalStorage 请求上下文、仓库 epoch、watch token 所有权 | 不使用共享可变 current root |
| Git 可执行配置 | §3 的固定调用参数 | 不承诺覆盖所有 Git 配置或 filter 行为 |
| 写覆盖 | expectedVersion、原子落盘、每仓库写队列与脏状态检查 | 不自动 stash / reset 或删除 index.lock |
| 终端环境 | 系统 shell、Host 环境白名单、输出环形缓冲 | 用户 profile 与包脚本以用户权限正常执行 |
| UI 注入 | 文本渲染、受限 Markdown、静态 SVG 与主题 token | 终端 ANSI 留在 xterm 通道 |

## 2. 工作区与仓库作用域

根目录仅由 Host 决定：该会话手动选择 > 会话 cwd > lastRoot。Service 为每次资源请求绑定会话与根目录，跨 await 使用 AsyncLocalStorage；文件、搜索和普通终端以工作区为根。

Git/watch 请求可带工作区相对 `repositoryPath`，`.` 表示根仓库。Host 检查路径无绝对路径、上跳或非法分隔符，realpath 后仍在工作区内，目录有自己的 `.git` 文件或目录，且 `git rev-parse --show-toplevel` 与该目录一致；父级仓库不能冒充所选目录的仓库。合法 worktree 的 `.git` 文件可被识别。

用户跟踪列表与活动仓库只控制前端显示和请求目标，按工作区路径保存在本浏览器，默认均为空；Host 每次仍独立校验仓库根。切换仓库后丢弃旧 Git 响应，写操作期间不能切换。watch token 绑定会话、工作区和 repositoryPath。poll 必须匹配当前工作区根、原会话和原始仓库路径；stop 在解析当前根目录之前核对原会话和原始仓库路径，并在 token 保存的原根上下文中回收资源。因此切换工作区、原根/仓库删除或 start 响应晚到均不妨碍原会话清理；其它会话不能停止该 token。

扫描不跟随目录符号链接，跳过依赖、VCS、缓存与构建目录；限 10000 目录、100000 条目、40 层、仓库和包合计 2000 项、8000ms，达到任一限制返回 truncated 和 warnings。扫描仅发现清单，不自动跟踪仓库、运行脚本或安装依赖。

## 3. Git 调用硬化

所有 Git 子进程都经 `backend/git/exec.js`，使用 argv 数组且 `shell:false`。当前 runGit 对读写动作都应用同一 hardenArgs 基线，不写用户 git config：

```text
--no-optional-locks
-c core.fsmonitor=false
-c core.pager=cat
-c core.hooksPath=<插件拥有的空临时目录>
-c credential.helper=
-c core.askPass=
-c diff.external=
-c core.sshCommand=
-c protocol.ext.allow=never
-c advice.detachedHead=false
```

| 参数 | 用途 |
| --- | --- |
| no-optional-locks / GIT_OPTIONAL_LOCKS=0 | 减少只读 status 对 index 的可选刷新；不阻止真实写操作取锁 |
| core.fsmonitor=false | 禁止通过该配置调用 fsmonitor |
| core.pager=cat / GIT_PAGER=cat | 禁止交互 pager 干扰结构化输出 |
| core.hooksPath=<空目录> | 面板内调用统一跳过仓库 hooks；没有 runHooks 偏好或按信任放行分支 |
| credential.helper= / core.askPass= | 本地操作不调用凭据 helper 或自定义密码程序 |
| diff.external= | 取消外部 diff 程序；具体 diff 命令继续按自身参数处理 |
| core.sshCommand= / protocol.ext.allow=never | 限制自定义 SSH 与 ext 协议入口 |

固定环境为 `LC_ALL=en_US.UTF-8`、`LANGUAGE=en`、`LANG=en_US.UTF-8`、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`、`GIT_PAGER=cat`、`GIT_ASKPASS=`、`SSH_ASKPASS=`、`GIT_CONFIG_NOSYSTEM=`；runGit 在继承进程环境上合并这些值及调用方 env。默认超时 20000ms、总输出预算 32MB，超时 / 超量终止子进程并返回明确错误。

当前实现不枚举或清空所有 `filter.*`；Git LFS、clean / smudge / process 等仍受用户 Git 配置影响。终端里用户运行的 Git 不经过此调用层。文档不把固定参数描述为完整的仓库代码隔离。

## 4. 写路径与仓库配置

- 本地写操作进入每仓库串行队列，保留脏工作区检查、丢弃确认和错误回传。
- 不自动 stash、reset、git init，不写用户 `.git/config` 或全局 `safe.directory`。Git 属主或锁错误交回用户处理，不自动修改配置或删除锁。
- 面板 Git 仍使用 §3 的空 hooksPath；用户若要按自己的 hooks 工作流执行，可在普通终端操作。
- 文件写入携带 expectedVersion，冲突返回 E_VERSION_CONFLICT；不静默覆盖。保留 EOL、BOM 与文件 mode 的要求见 [files.md](./files.md)。
- hunk 暂存按现有 hash-object / update-index 路线处理，具体校验与错误见 [git-model.md](./git-model.md)。

## 5. Host 路径校验

`workspace.resolvePath` 先将相对路径解析到当前根下，再 realpath 目标；新建目标不存在时向上找到最深已存在祖先，解析其真实路径后补回未创建的段。最终路径必须等于根或以 `root + path.sep` 开头，否则返回 E_OUTSIDE_ROOT。因此 `/tmp/a` 不匹配 `/tmp/ab`，根内符号链接若指向根外同样拒绝。各动作 schema 继续限制输入路径格式。

仓库路径另外要求真实工作树根（§2）。包清单读取校验 realpath 仍在根内、必须是普通文件且至多 1MB；无效 JSON、权限错误、清单消失均显式返回错误。终端 cwd 经相同工作区路径解析。

## 6. 错误与凭据

本插件没有 credential store 或密码输入界面，不读取 Git 凭据文件。runGit 默认禁止交互密码提示与 helper；网络 Git 动作当前不开放。错误只通过受控 Remote error 与工作台通知显示，不写会话日志。

`gitOrThrow` 对非零退出返回 E_GIT_FAILED，包含退出码、分类 reason、有限 argv 与 stderr 摘要。当前 exec 层 argv 会过滤 http(s) / ssh URL 并限制条数，stderr 取前 12 行；这不是覆盖所有凭据格式的脱敏器，不应在文档承诺尚未实现的全面脱敏规则或审计环形记录。

## 7. 终端与包脚本

终端只用 `subprocess.spawnTerminal`。普通创建 cwd 默认为工作区根；包脚本播放调用 terminal.runScript，每次重新读清单并验证脚本存在，再创建新终端，cwd 为包目录，绝不向已有终端注入脚本。

运行器只允许 npm / pnpm / yarn / bun，参数固定为 run 加脚本名。包管理器按包或祖先 packageManager / 锁文件解析，兜底 npm。脚本正文用于预览，Host 不把浏览器传入的命令正文拼到 shell。脚本名与 cwd 按具体 shell 引用；不支持的 shell 或无法安全引用的名称返回错误并清理新终端。

默认 shell 来自 `subprocess.terminalEnvironment`，bash / zsh / fish 使用登录交互启动参数，PowerShell 使用 `-NoLogo`，不加跳过用户配置的参数。用户正常 profile 可设置 PATH、工具链与环境。

环境先为全部继承变量写 tombstone，再恢复 ENV_KEEP 白名单：

- 用户与 shell：HOME、USER、LOGNAME、SHELL、PATH、TERM、TMPDIR / TMP / TEMP。
- 语言与目录：LANG、LC_ALL、LC_CTYPE、XDG_CONFIG_HOME / CACHE_HOME / DATA_HOME / RUNTIME_DIR。
- Windows：ComSpec、SystemRoot、WINDIR、USERPROFILE、APPDATA、LOCALAPPDATA、HOMEDRIVE、HOMEPATH、PATHEXT。
- 工具链：SSH_AUTH_SOCK、COLORTERM、ANDROID_HOME、JAVA_HOME、GOPATH、CARGO_HOME、RUSTUP_HOME。

PWD 设为实际 cwd，TERM 为 xterm-256color，COLORTERM 为 truecolor。不向初始终端环境直传 DSH_*、NODE_OPTIONS、模型凭据或任意未列出的变量。shell profile 后续加载的环境由用户配置决定。

终端输出只进 xterm 与 Host 环形缓冲；按字符 offset 轮询，丢失输出有 dropped 提示。Host 剥离 OSC 0/2 标题序列，不注册自有链接或剪贴板处理器。关闭 / 卸载终止对应 PTY；详细协议与生命周期见 [terminal.md](./terminal.md)。

## 8. UI 渲染与资源

文件名、路径、提交信息、diff、脚本预览和错误按文本渲染；Markdown 不启用原始 HTML。静态检查禁止动态 HTML / eval 等入口。文件图标是代码内的静态 SVG 路径，名称只选择有限 kind；不将仓库内容当 SVG 标记执行。样式只取主题 token / currentColor，浮层限制在工作台根内。

## 9. 网络动作

当前不实现 push / pull / fetch / clone 与递归子模块更新。未实现能力保持禁用和原因说明，不新增信任确认或网络授权偏好作为占位。未来新增动作必须同步共享契约、实现与本文。

## 10. 供应链与打包

React 由宿主提供且 external；编辑器用显式语言白名单，终端仅 xterm 与 fit。图谱布局移植保留 Apache-2.0 版权与第三方声明。单文件 IIFE 不拆 chunk、不加 Worker / wasm / 字体资源，bundle 上限 1.2MB gzip；不引图标包、native 依赖或第二份 React。依赖、许可证与构建检查见 [build.md](./build.md)。

## 11. 可观测与生命周期

错误不静默、不伪装成功；Remote ok:false 经 datasource 回到域 store。watch / 轮询只在有可见 surface 且有活动仓库时维持；终端与资源在插件 dispose 清理。插件没有 Git 诊断环形审计记录、导出诊断或 telemetry 功能；不记录终端 / 文件 / diff 正文到会话。

## 12. 能力范围

本插件不是 OS 沙箱，也不做恶意仓库静态扫描、secret 扫描或凭据管理。Git 自身配置、用户 shell profile 与显式运行的包脚本仍可执行程序；输出预算与有界扫描只限制本插件的资源使用，不保证任意仓库不会耗时。现有路径、版本、仓库作用域和参数校验必须始终在 Host 保留。
