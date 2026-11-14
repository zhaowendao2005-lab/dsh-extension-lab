# `packages/dsh-workspace-ide` 文档集 · 阅读地图

一句话：一个 DSH 全局面板插件，小号 VS Code（SCM + 提交图谱 / 文件编辑高亮 / 真终端），根目录 = 工作区目录。
**当前仓库状态：只有文档，没有实现代码。**

## 阅读路线

| 你是 | 按这个顺序读 |
| --- | --- |
| **评审者**（判断能不能开工） | `README.md` → `plan/全方案.md`（§ 决策记录）→ `docs/milestones.md` → `plan/E2E-流程.md` |
| **实现者**（接到具体任务） | `AGENTS.md`（硬规则，先读）→ `ARCHITECTURE.md` → `docs/remote-contract.md` → 你的模块文档（`docs/editor.md` / `docs/git-model.md` / `docs/graph.md` / `docs/terminal.md` / `docs/files.md`）→ `docs/ui-spec.md` 对应小节 |
| **验收者**（点一遍） | `plan/E2E-流程.md` → `docs/ui-spec.md`（尺寸/文案/状态视觉）→ `docs/milestones.md` 的 DoD |
| **未来的维护者** | `ARCHITECTURE.md` → `docs/security.md` → 各模块文档末尾的 `## 与契约的差异（已复核）`（登记已并入契约的项与仍要盯的点） |

## 文档关系

```text
MINI-VSCODE-PLAN.md（根仓库，立项与选型论证、M0–M4 人日）
        │ 结论落到 ↓
README.md ── 使用者视角（入口/三视图/边界/安全摘要）
AGENTS.md ── 硬规则（可被构建期检查或 review 判定）
ARCHITECTURE.md ── 依赖方向 / 状态所有权 / 生命周期 / 性能预算 / 静态约束
        │
        ├─ docs/remote-contract.md ── 唯一接口面（动作/字段/错误码/并发）
        │        ├─ docs/git-model.md      （git.* 的实现细节）
        │        ├─ docs/files.md          （files.* 的实现细节）
        │        ├─ docs/terminal.md       （terminal.* 的实现细节）
        │        └─ docs/graph.md          （git.graph 的 wire → 渲染）
        ├─ docs/editor.md     ── CM6 装配与文件读写编排
        ├─ docs/security.md   ── 威胁模型与硬化清单（AGENTS.md 引用它作唯一出处）
        ├─ docs/ui-spec.md    ── 尺寸/视觉/交互/文案/无障碍
        ├─ docs/build.md      ── 打包、静态检查、发布、故障排查
        └─ docs/milestones.md ── 任务级拆解
plan/全方案.md + plan/E2E-流程.md ── 决策记录与人工验收剧本
research/*.md（根仓库）── 选型调研原文，作为论证依据，不作为实现依据
```

**冲突时的优先级**：`AGENTS.md` > `ARCHITECTURE.md` > `docs/remote-contract.md` > 模块文档 > `plan/`。
任何不一致都当作 bug 修文档，不许"以代码为准"地放过。

## 术语表

| 中文 | 英文/标识 | 本文档集里的精确含义 |
| --- | --- | --- |
| 工作区根 | root | 面板的绝对根目录。**只有 Host 能解析**：上次打开的目录，或最近活跃会话的 `cwd`，或用户显式选择 |
| 全局面板 | main panel | 注册在 `main` keyed slot、`key='workspace-ide'` 的页面；与「对话」平级切换；**拿不到 sessionId** |
| Remote | Typert Remote | Host 侧服务在浏览器里的投影，单一动作入口 `execute({sessionId,action,payload})` |
| 动作 | action | `files.read`、`git.status` 这类字符串；全集在 `docs/remote-contract.md` |
| 快照 / 序号 | snapshot / `seq` | `git.status` 返回的单调递增序号；**旧 seq 的响应必须丢弃** |
| 版本 | `version` | 文件新鲜度 token（`sha1(size\|mtimeMs\|inode)` 短串），写盘时作 `expectedVersion` |
| 泳道 | lane | 提交图谱里一条纵向占位；一行一条水平槽，lane 是列 |
| 段 | segment | 图谱一行内跨列的线段描述 `{from,to,kind}`，客户端据此画 SVG path |
| 暂存区 | index / staged | git 的 index；「已暂存」= index 与 HEAD 有差异 |
| hunk | hunk | 统一 diff 的一个 `@@` 块；行级暂存以 hunk 内行为单位 |
| 未跟踪 | untracked | 不在 index 也不在 HEAD 的文件（`?`） |
| **版本冲突** | `E_VERSION_CONFLICT` | 写盘时文件的 `version` 已变（外部改写），**不是**合并冲突 |
| **合并冲突** | merge conflict（`u` 行） | git 的 conflicted 条目（stages 1/2/3 都在）；这是 status 四组里的 `conflicts` |
| 信任 | trust / `trusted\|untrusted` | 用户对该目录的显式授权；未信任 = 只读 + 硬化 + 禁终端 |
| 巨大仓库 | huge repo | `git.status` 超时或超量的仓库；自动刷新停用，改手动 |
| 降级 | degrade | 明确告知能力缩小（关高亮、关自动刷新、只读），**不许静默** |
| 轮询 | poll | 前端按固定间隔向 Host 要增量（终端 120 ms、`git.status` 1500 ms） |
| 游标 | `offset` | 终端环形缓冲中的**字符**偏移（不是字节） |
| 环形缓冲 | ring buffer | Host 侧每终端的 512 KB 输出缓冲；落后超限时 `dropped:true` |
| 丢帧 | `dropped` | 客户端落后超过缓冲；必须重置游标并提示「输出已截断」 |
| 脏标记 | dirty | 编辑器文档与最近一次读/写的版本不一致 |
| 编排 | workbench.stores | 唯一允许跨域串流程的地方（打开文件、出 diff、切分支刷新） |
| 单文件 IIFE | bundle | `lib/client.js`：一个自执行函数，无 chunk、无 worker、无 wasm |
| 主题令牌 | `--dsw-alias-*` | DSH 宿主提供的颜色变量；**禁止硬编码色值** |
| 顶栏留白 | `--dsh-frame-top-clearance` | macOS 红绿灯占据的高度（48px），主面板根元素必须留 |
| DoD | Definition of Done | 每个里程碑的完成判据，见 `docs/milestones.md` |

## 文档维护规则

| 改了什么 | 必须同步 |
| --- | --- |
| 动作、字段、错误码、限制参数 | `docs/remote-contract.md` + `shared/contract.js` |
| git 命令或输出解析 | `docs/git-model.md` |
| 编辑器扩展组合、阈值、键位 | `docs/editor.md`（键位同时改 `docs/ui-spec.md` 快捷键表） |
| 图谱 wire 结构或布局 | `docs/graph.md` |
| PTY 通道、轮询、缓冲 | `docs/terminal.md` |
| 尺寸、视觉、文案、状态 | `docs/ui-spec.md` |
| 构建参数、依赖、体积 | `docs/build.md` |
| 任务完成状态 | `docs/milestones.md` |
| 安全相关任何放宽 | `docs/security.md` + `AGENTS.md`（两份都要改） |

未实现的章节必须显式标注 **（P1）** / **（P2）**，不许写了却让人以为已实现。
