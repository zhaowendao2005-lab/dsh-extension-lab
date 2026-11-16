# 界面规格（ui-spec）

布局基准：`MINI-VSCODE-PLAN.md` §2 与 `README.md` 的 ASCII 图；状态所有权见 `ARCHITECTURE.md`；动作名与字段见 `docs/remote-contract.md`；禁色规则见 `docs/build.md` §3。约定：颜色只能取 `--dsw-alias-*`；尺寸用本包自有 `--wid-*`（纯长度）；类名 `.wid-` 前缀；CSS 内联进 `lib/client.js` 后注入 `<style id="dsh-workspace-ide/css">`。

## 1 设计原则

| # | 原则 | 可 review 的判定 |
| --- | --- | --- |
| 1 | **VS Code 的肌肉记忆** | 区域位置、行高（22/26/28px）、缩进 12px、单击选中·双击打开、分隔条拖拽、右键菜单、状态栏信息顺序全部对得上 |
| 2 | **DSH 的皮** | 颜色 100% 来自 `--dsw-alias-*`；字号取 `--dsh-content-font-size` / `--dsh-code-font-size` / `--dsh-terminal-font-size`；圆角 `--dsw-radius-xs/sm`；阴影 `--dsw-shadow-lv1/2` |
| 3 | **不假装** | 未实现按钮 `disabled` + `title`；失败必落错误条；宁可空态也不给假数据 |
| 4 | **密度优先** | 行间距即行高；块间距只取 8/12/16 三档；面板内不出现 ≥24px 留白 |

冲突裁决（**一律以 DSH 为准**）：强调色用 `--dsw-alias-brand-primary`（亮色近黑、暗色近白），不用 VS Code 蓝——蓝在 DSH 里是 `state-business-primary`（信息态），不抢；选中行用 `--dsw-alias-bg-multi-select` 而非蓝底白字；diff 增删色用宿主为明暗各调过的 `--dsw-alias-file-diff-*`；字体族用 `var(--dsw-font-family)` / `var(--ds-font-family-code)`（打包禁字体文件）。

## 1.1 布局状态的持久化（实现期决定）

侧栏宽度、面板高度、折叠状态、当前活动视图、diff 分栏比例存在**浏览器 `localStorage`**（键 `workspace_ide/ui.layout`，`frontend/service/layout.js`），不写 Host storage。理由：面板关闭/重开与浏览器刷新都必须在**零 Host 往返**下恢复出上一次的版式，而 `localStorage` 正是宿主页面自己的存储；写进插件 storage 会让每次打开面板都先等一次 Remote 往返再首绘。代价与边界：

- 换浏览器/换机器不继承版式（可接受：这是纯偏好，不是工作区数据）。
- **工作区相关的状态（根目录、信任、最近打开）仍然只在 Host**（`workspace.resolve`），不能借道 `localStorage`——那会绕过 `E_TRUST_REQUIRED` 的门禁。
- `localStorage` 不可用（隐私模式/被禁）时静默退化为内存默认值，不弹错误。

## 2 整体布局（右栏工作台 v2）

工作台是 DSH 右栏里的一个宿主 tab；宿主已经提供 tab 条与右栏宽度拖拽，本插件只画 body。body 内部**两栏**：左栏是文件/搜索（可收起），右侧是工作区（内部标签行 + 可拖动分栏的编辑组），底部是可收起的终端面板。

```css
.wid-frame { height: 100%; container-type: inline-size; container-name: widframe }
.wid-root {
  --wid-nav-w: clamp(180px, 30cqi, 260px);
  --wid-toolbar-h: 30px; --wid-tabbar-h: 28px; --wid-statusbar-h: 22px; --wid-split-h: 4px;
  display: grid; height: 100%; min-width: 0; min-height: 0; overflow: clip; padding: 0;
  grid-template-columns: var(--wid-nav-w) minmax(0, 1fr);
  grid-template-rows: var(--wid-toolbar-h) minmax(0, 1fr) var(--wid-split-h) var(--wid-panel-h) var(--wid-statusbar-h);
  grid-template-areas:
    'toolbar toolbar'
    'nav     work'
    'split   split'
    'panel   panel'
    'status  status';
}
.wid-root[data-nav='collapsed']   { --wid-nav-w: 0px }
.wid-root[data-panel='collapsed'] { --wid-panel-h: 0px; --wid-split-h: 0px }
```

| 区域 | grid-area | 默认 | 最小 | 最大 | 可变性 |
| --- | --- | --- | --- | --- | --- |
| 工具栏 | `toolbar` | 30px | 30px | 30px | 固定；根 chip、分支、快速打开、图谱、改动、终端、全视图、设置、⋯ |
| 左栏 | `nav` | `clamp(180px, 30cqi, 260px)` | 160px | 360px | 内部不提供拖拽；收起 = 0；窄屏变抽屉 |
| 工作区 | `work` | flex | 0 | — | 吃剩余空间；内部可再分栏 |
| 面板分隔条 | `split` | 4px | 4px | 4px | 仅在终端面板展开时存在 |
| 终端面板 | `panel` | 220px | 120px | ≤ 根高−240px | 拖拽；默认收起 |
| 状态栏 | `status` | 22px | 20px | 22px | 固定；窄态精简 |

**内部标签与分栏**（细节见新增 §16）：

- 每个编辑组 = 一条 28px 标签行 + 内容区；文件、diff、提交图谱、当前改动、设置都是标签。
- 分栏树最多 4 个组，左右/上下可嵌套；新组最小 180×140px；分隔条 4px 热区、比例 0.2–0.8、双击复位。
- 拖标签到组边缘分栏、到中心移动；拖拽期间只在目标变化时更新高亮，松手一次提交。

**断点**（容器查询，基于右栏宽度，不是窗口宽度）：

| 断点 | 行为 |
| --- | --- |
| ≥720px | 左栏并排；工具栏显示分支；标签最大 180 |
| 520–719px | 左栏可并排可收起；分支隐藏、状态栏保留分支 |
| <520px | 左栏变抽屉（默认收起，带遮罩）；标签最大 140；状态栏 20px |

持久化（`frontend/service/layout.js`，浏览器 localStorage）：

```json
{ "workspace_ide/ui.layout": { "sidebarWidth": 240, "panelHeight": 220, "sidebarCollapsed": false, "panelCollapsed": true, "activityView": "files", "editor": { "fontSize": 13, "wrap": true, "tabSize": 2 } },
  "workspace_ide/ui.workbench.v1.<sessionId>": { "version": 1, "tree": {}, "groups": {}, "tabs": {}, "activeGroup": "g1" } }
```

**不持久化**：编辑器正文/未保存内容、终端标签列表（由 `terminal.list` 对账）、拖拽中间态、组尺寸、任何 git 事实。右栏宽度与显隐归宿主；`localStorage` 不可用时静默退化为内存默认值。

## 3 左栏（文件 / 搜索）

顶部 28px 头部：`[文件][搜索]` 分段（`role="tablist"`，选中项底 `--dsw-alias-bg-layer-2` + 字 `--dsw-alias-label-primary`）、刷新/新建/新建文件夹、收起箭头（`⌥⌘⇧B`）。没有竖直活动栏。

| 项 | 值 |
| --- | --- |
| 容器 | `var(--wid-nav-w)` 宽，底 `--dsw-alias-bg-base`，右侧 1px `--dsw-alias-border-l1` |
| 收起 | 宽 0，工具栏出现「展开文件栏」按钮；窄屏 <520px 默认收起，展开为 280px 抽屉 + 35% 遮罩 |
| 视图 | `files`（文件树）/ `search`（工作区搜索）；切换不改宽度 |

图标为内联 SVG 组件（`frontend/views/common/Icon.jsx`），**不引图标库、不复用宿主 `sidebar.panel.icon` factory**（`ARCHITECTURE.md`）。

## 4 文件树

| 项 | 值 |
| --- | --- |
| 行高 | 22px；虚拟滚动按 22px 定量，overscan 8 行 |
| 缩进 | `padding-inline-start: calc(8px + 12px * depth)`；展开箭头占 16px |
| 展开箭头 | 12×12 chevron，`stroke-width: 1.5`，`--dsw-alias-label-tertiary`；hover → `--dsw-alias-label-primary` |
| 文件名 / 目录名 | 12px、字重 400、单行省略；目录展开后不加粗（保密度） |
| 文件图标 | **8×8 圆点**，不引图标库；未知扩展名用中性圆点 |
| hover 行 | 底 `--dsw-alias-interactive-bg-hover`，行内操作浮现（`opacity` 过渡 120ms） |
| 选中行 | 底 `--dsw-alias-bg-multi-select`，字 `--dsw-alias-label-primary` |
| 焦点行 | 内描边 `box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary)`，可与选中并存 |
| 行内操作 | 右侧 3 个 18×18 图标：新建文件 / 刷新 / 折叠全部；hover 或键盘聚焦行时出现 |

圆点按"类别"上色（不区分具体语言；图例在设置页）：代码 `.ts .tsx .js .jsx .py .go .rs .java .c .cpp` → `--dsw-alias-state-business-primary`；样式 `.css .scss .less` → `--dsw-alias-state-done-primary`；配置 `.json .yml .yaml .toml .env` → `--dsw-alias-state-warn-primary`；文档 `.md .mdx .txt .rst` → `--dsw-alias-label-secondary`；图片 `.png .jpg .svg .webp` → `--dsw-alias-state-success-primary`；其它 → `--dsw-alias-label-tertiary`。

右键菜单（`onContextMenu`，交互见 §12）：打开 / 重命名（`files.rename`）/ 删除（`files.delete` + 确认框）/ 复制相对路径（纯客户端 `navigator.clipboard`）/ 刷新（`files.list`）/ 在文件管理器中显示（**无动作 → `disabled` + tooltip**）。未信任时写类项 `disabled`。

拖拽移动文件：**P2 不做**；`draggable={false}`，不出拖影，避免与分隔条拖拽混淆。

## 5 SCM 面板

**提交框**：`<textarea>`，`min-height: 56px`（≈2 行）、`max-height: 140px` 后内部滚动；字号 `var(--dsh-content-font-size)`、行高 20px、`padding: 8px 10px`；边框 1px `--dsw-alias-border-l2`，focus 时 `--dsw-alias-brand-primary` + `outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)`；占位符 `scm.commit.placeholder`；右下角 11px 字符计数（>72 字符转 `--dsw-alias-state-warn-label`）；`Cmd/Ctrl+Enter` 提交（输入框内 `onKeyDown`，不注册全局命令）；空消息（trim）/ 写操作进行中 / 未信任 / 无根目录 → 按钮 `disabled` + tooltip 给原因。

**四组分区**：

| 组 | 数据源 | 全部操作 | 空时 |
| --- | --- | --- | --- |
| 已暂存 | `status.staged` | 全部取消暂存 → `git.unstage { paths }` | 整组隐藏 |
| 未暂存 | `status.working` | 全部暂存 → `git.stage { all: true }` | 整组隐藏 |
| 未跟踪 | `status.untracked` | 全部暂存 → `git.stage { all: true }` | 整组隐藏 |
| 冲突 | `status.conflicts` | 全部暂存 → `git.stage { paths }` | 整组隐藏；出现时组头左沿 2px `--dsw-alias-state-error-primary` |

组头高 22px、`padding: 0 8px 0 4px`、底 `--dsw-alias-bg-base`、`position: sticky; top: 0`；chevron 12px + 标题 12px/600 + 计数（`--dsw-alias-label-tertiary`，`tabular-nums`）+ 右侧 18×18「全部」按钮（仅 hover 出现）。折叠态写 `workspace_ide/ui.scm.groupsCollapsed`。

**行规格**：高 22px，`grid-template-columns: 14px minmax(0,1fr) auto`。

| 元素 | 规格 |
| --- | --- |
| 状态字母 | 11px/600，宽 14px 居中；配色见下表 |
| 文件名 | 单行省略，`--dsw-alias-label-primary` |
| 目录灰字 | 紧随文件名，12px `--dsw-alias-label-tertiary`，可被文件名挤掉（`min-width: 0`） |
| 增删统计 | `+{a} −{d}`，11px；`--dsw-alias-file-diff-added-marker` / `--dsw-alias-file-diff-deleted-marker`；仅 diff 已载入时显示 |
| hover 操作 | 打开 / 暂存（或取消暂存）/ 丢弃 三个 18×18 按钮，hover 或聚焦行出现；丢弃按钮 hover 底 `--dsw-alias-interactive-bg-hover-danger`、图标 `--dsw-alias-state-error-primary` |
| hover 行 / 选中行 | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-bg-multi-select` |

状态字母配色（`--wid-tone-*` 配方见 §11，已核算对比度）：`M`→`--wid-tone-warn`、`A`→`--wid-tone-success`、`D`→`--wid-tone-error`、`R`→`--wid-tone-business`、`C`→`--wid-tone-done`、`T`→`--wid-tone-neutral`、`?`→`--dsw-alias-label-tertiary`、`U`→`--wid-tone-error` + 字重 600 + 行首 2px `--dsw-alias-state-error-primary`。

**徽章与空态**：活动栏 `scm` badge = 四组长度之和（**同一文件可被计两次**，与 git 真实语义一致，不去重）。空态居中：`scm.empty.noChanges`（主）+ `scm.empty.hint`（次），字 `--dsw-alias-label-secondary`。

**写操作进行中**：行级 → 文件名右侧 12×12 spinner（`--dsw-alias-brand-primary`，1s 线性旋转），该行不可再点；全局禁用 → 操作元素 `opacity: .6` + `pointer-events: none`；队列提示 → 组头下 20px 条「正在执行 {op}…（队列 {n}）」（底 `--dsw-alias-bg-layer-2`，11px）；排队超 30s 命中 `E_LIMIT` → `scm.queue.tooLong`。失败：行内红字 11px + 行首 2px 红条留 5s，同时错误条出摘要，**不得吞 `ok:false`**。

**危险操作确认框**（丢弃 / 删除 / 不干净时切分支 / 强制覆盖保存）：面板内 modal（不是宿主 modal），宽 `min(420px, calc(100% - 32px))`、圆角 `--dsw-radius-md`、阴影 `--dsw-shadow-lv3`、遮罩 `--dsw-alias-bg-mask-1`；标题 14px/600 + 正文 13px（受影响路径最多 5 行后「等 N 个文件」）+ 右对齐两按钮；默认焦点在「取消」；危险按钮底 `--dsw-alias-state-error-primary`、字 `--dsw-alias-label-primary-foreground`；`Esc` 取消、`Enter` 确认（焦点在危险按钮时）、点外部取消；丢弃与删除必须显示 `scm.confirm.irreversible`。

## 6 提交图谱

| 项 | 值 |
| --- | --- |
| 行高 | 28px（虚拟滚动量化单位，SVG `y = index * 28`） |
| 图列宽 | `clamp(48px, calc(var(--wid-max-lane) * 12px + 16px), 160px)`；`--wid-max-lane` 由客户端对已收 `rows` 求 `max(lane, segments[].from, segments[].to)` |
| 泳道 | 线宽 2px、`stroke-linecap: round`；节点圆 8px（`r=4`），2px 底色描边避免压线 |
| 提交列 | `minmax(0,1fr)`：subject 12px 单行省略（`--dsw-alias-label-primary`），refs 徽章紧跟其后（间距 6px） |
| refs 徽章 | 高 16px、圆角 `--dsw-radius-xs`、11px：HEAD → 实心 `--dsw-alias-brand-primary` + `--dsw-alias-label-primary-foreground`；本地分支 → 底 `--dsw-alias-state-business-tertiary` + 字 `--dsw-alias-state-business-primary`；远端 → 底 `--dsw-alias-bg-layer-2` + 字 `--dsw-alias-label-secondary`；tag → 底 `--dsw-alias-state-warn-tertiary` + 字 `--dsw-alias-state-warn-label` |
| hash 列 | 宽 64px，`var(--ds-font-family-code)` 11px `tabular-nums` `--dsw-alias-label-tertiary`，短 7 位 |
| 作者列 | 宽 96px，11px `--dsw-alias-label-secondary`，单行省略 |
| 时间列 | 宽 72px 右对齐，11px `--dsw-alias-label-tertiary`；`3 分钟前` / `2 天前` / `3 个月前`，一年以上用 `YYYY-MM-DD` |
| hover / 选中行 | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-bg-multi-select` + 行首 2px `--dsw-alias-brand-primary` |
| 顶部虚拟行 | 「Changes」行（28px）：图标 + `graph.changesRow`，点击出 working diff |

泳道 8 色 = `row.color % 8` → `--wid-lane-0..7`（§11.3）；**wire 只传索引不传色值**。分页：距底 400px 且 `hasMore` 时自动 `git.graph { skip: nextSkip }` 追加到尾部、**不重算已收前缀**；手动兜底为底部 32px「加载更多」按钮，`hasMore === false` 时显示「已到最早的提交」。过滤（author / 消息 / ref）只过滤列表、**不重排布局**（lane 值不变，图列宽不变）。

详情面板（右，宽 `min(420px, 45%)`，可关）：meta 网格 2 列×N 行（标签 11px `--dsw-alias-label-tertiary`，值 12px `--dsw-alias-label-primary`），行序 = 哈希（可复制）/ 作者 / 时间（绝对+相对）/ refs / 父提交（可按 sha 跳转）；文件列表复用 §5 行规格的只读版（无 hover 操作），点击 → `git.diff { target: { kind: 'commit', sha, path } }`；cherry-pick / tag 按钮 `disabled` + tooltip（P1/P2）。

## 7 内部标签行（每个编辑组一条）

高 28px，底 `--dsw-alias-bg-layer-2`，下沿 1px `--dsw-alias-border-l1`；标签 `max-width: 180px`、`min-width: 72px`、`padding: 0 6px 0 8px`、12px、图标 12px。活动标签底 `--dsw-alias-bg-base`、上沿 2px `--dsw-alias-brand-primary`、上圆角 `--dsw-radius-sm`；非活动字 `--dsw-alias-label-secondary`，hover 底 `--dsw-alias-interactive-bg-hover`。脏点 6px、`--dsw-alias-label-primary`，hover 时隐藏并换成 16×16 关闭按钮；非活动标签的关闭按钮默认 `opacity: 0`，hover/活动时出现。溢出横向滚动（隐藏滚动条）不折行；行尾 24px「⋯」打开组级菜单。中键关闭走 `auxclick` 且 `button === 1`；右键菜单见 §18；拖拽分栏见 §18；切标签后活动标签 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`。

## 8 diff 视图

两栏为 **P0** 唯一形态（内联单栏 P1，切换控件 P0 就位但 `disabled` + tooltip）。两栏间 4px 热区 `cursor: col-resize`，比例写 `workspace_ide/ui.layout.diffSplit`（0.2–0.8）。行高 20px（比编辑器紧 2px，便于扫读），`var(--ds-font-family-code)`、`font-size: var(--dsh-code-font-size)`。

| 元素 | 规格 |
| --- | --- |
| 行号列 | 每侧 48px（含量左右 8px），`tabular-nums` 11px `--dsw-alias-label-tertiary`，底 `--dsw-alias-bg-layer-2` |
| hunk 头 | 高 22px，底 `--dsw-alias-bg-layer-2`，11px `--dsw-alias-label-secondary`，文本 `@@ -oldStart,oldLines +newStart,newLines @@`；点击折叠该 hunk |
| 新增行 | 底 `--dsw-alias-file-diff-added-bg`，行号列 `-gutter`，左沿 2px `-marker`（三个都用） |
| 删除行 | 底 `--dsw-alias-file-diff-deleted-bg`，行号列 `-gutter`，左沿 2px `-marker` |
| 修改行 | 左右分别落在 added / deleted 底色上，**不新造颜色** |
| 空位行 | 对侧无对应行：底 `--dsw-alias-bg-layer-2` + `repeating-linear-gradient` 叠 `--dsw-alias-border-l1` 斜纹 |
| `\ No newline` | 单独一行 18px、斜体 11px `--dsw-alias-label-tertiary`，文案 `diff.noNewline`，出现在删除侧/新增侧对应位置 |
| 折叠未变更行 | 上下文 3 行；折叠条 22px「展开 {n} 行」+「全部展开」两个可点区域，底 `--dsw-alias-bg-layer-2` |
| 导航 | 工具栏右：上一处 / 下一处（`{i}/{n}` 计数），键 `F7` / `Shift+F7`，到边界 `disabled` |
| 头 / 截断 / 二进制 | `{path}` + `+{a} −{d}` + 状态字母（同 §5）；`truncated` → 顶部 20px 提示条 `diff.truncated`；`isBinary` → 居中 `diff.binary` + 字节数 |

## 9 终端面板

标签栏高 26px，底 `--dsw-alias-bg-layer-2`；标签文案取 `terminal.create` 返回的 `title`，回退 `terminal.tab`（「终端 {index}」）。活动标签底 `--dsw-alias-bg-base` + 上沿 2px `--dsw-alias-brand-primary`，非活动字 `--dsw-alias-label-secondary`。末尾 20×20 `+` → `terminal.create { cwd: root, cols, rows }`；标签右 12×12 `✕`（hover 出现）→ `terminal.close`，**这是唯一的 kill 入口**。

| 项 | 值 |
| --- | --- |
| 面板显隐 | 活动栏终端图标 / `Cmd/Ctrl+J`：只切 `display`，**不 kill、不 `terminal.close`、不重建 xterm** |
| 高度拖拽 | 分隔条 4px 热区（`cursor: row-resize`，视觉 1px 边框在上沿），范围见 §2 |
| 内容区 | `padding: 4px 6px`，底 `--dsw-alias-bg-base`，字号 `var(--dsh-terminal-font-size)`，字体 `var(--ds-font-family-code)` |
| 工具栏 | 面板右上浮层（hover 出现）：清屏 / 复制全部 / 杀死（18×18；杀死图标 `--dsw-alias-state-error-primary`，tooltip 注明「等同关闭该标签」） |
| 滚动条 / 选中 / 光标 | 滑块 `--dsw-alias-scrollbar-bg-l2`、hover `--dsw-alias-scrollbar-hover-l2`；选中底 `--dsw-alias-bg-document-selection`；光标 `cursorStyle: 'block'` + 闪烁，失焦 `'outline'` |
| 截断 / 退出 | `dropped > 0` → 插入 `terminal.truncated` 提示行（`--dsw-alias-state-warn-label`）；`exited` → 标签右上灰字 `退出码 {code}`，标签保留不自动关 |

## 10 状态栏

高 22px，底 `--dsw-alias-bg-layer-2`，上沿 1px `--dsw-alias-border-l1`，11px，左右 `padding: 0 8px`，各项 `padding: 0 6px` 且 hover 底 `--dsw-alias-interactive-bg-hover`。

| 区 | 内容 | 数据 | 点击行为 |
| --- | --- | --- | --- |
| 左 | `⑂ {branch}` | `status.branch.name`（detached 用 `HEAD@{sha7}`） | 分支选择器（M2 末接 `git.checkout`；之前 `disabled` + tooltip） |
| 左 | `↑{ahead} ↓{behind}` | `branch.ahead/behind` | 无（不显示 pointer） |
| 左 | spinner + `{operation}` | `status.operation !== 'none'` | 出详情（merge/rebase 说明，放弃入口 P1） |
| 中 | `● {n} 个变更` | 四组计数和 | 切到 SCM 视图（同活动栏 `scm`） |
| 右 | `Ln {line}, Col {col}` | `editor` 域游标 | P1 跳转框；P0 `disabled` |
| 右 | `空格:2` / `Tab:4` | `editor` 域缩进 | P1 选择器；P0 `disabled` |
| 右 | `UTF-8` / `UTF-8 BOM` | `editor.bom` | P2 `disabled` + tooltip |
| 右 | `LF` / `CRLF` | `editor.eol` | 切换 → 标脏，保存时按新 EOL 写（`files.write`） |
| 右 | `TypeScript` | `frontend/service/language.ts` | P1 选择器；P0 `disabled` |

无打开文件：右侧四项合并为灰字 `status.noEditor`（`--dsw-alias-label-tertiary`，不可点）。断连：分支位换成 `status.disconnected` + `--dsw-alias-state-error-primary` 圆点。

## 11 主题 token 映射表

**逐元素映射**（左列即"要上色的东西"，右列为唯一允许的取值）：

| 视觉元素 | token |
| --- | --- |
| 面板根背景 / 卡片浮层 | `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-3`；弹层 `--dsw-alias-bg-overlay` |
| 侧栏、标签栏、状态栏、hunk 头、行号列 | `--dsw-alias-bg-layer-2` |
| 分隔线 1px / 控件边框 / 浮层描边 | `--dsw-alias-border-l1` / `-l2` / `-l4` |
| 主文本 / 次文本 / 第三级 / 禁用 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-caption` |
| 深色底上的文字 | `--dsw-alias-label-primary-foreground` |
| 强调（指示条、焦点环、spinner、活动标签上沿） | `--dsw-alias-brand-primary` |
| 链接 / 可点文本 | `--dsw-alias-link` |
| hover 底 / 按下底 / 选中底 | `--dsw-alias-interactive-bg-hover` / `-active` / `--dsw-alias-bg-multi-select` |
| 危险 hover 底 | `--dsw-alias-interactive-bg-hover-danger` |
| 危险 / 成功 / 警告（条与图标） | `--dsw-alias-state-error-primary` / `-success-primary` / `-warn-primary` |
| **警告文字** | `--dsw-alias-state-warn-label`（亮色下 primary 对比度不足，文字不能直接用 primary） |
| 信息（badge 底、`A`/`R`、进度） | `--dsw-alias-state-business-primary`（淡底用 `-tertiary`） |
| 已完成（`C`、泳道 4） | `--dsw-alias-state-done-primary` |
| 新增行 / 删除行 | `--dsw-alias-file-diff-added-bg` `-gutter` `-marker` / `--dsw-alias-file-diff-deleted-bg` `-gutter` `-marker` |
| 修改行 | 复用上面两组，不新增色 |
| 行内差异高亮（P1） | `--dsw-alias-code-diff-added` / `--dsw-alias-code-diff-deleted` |
| 徽章 | 见 §3 / §6 各表（只用 `state-*` + `label-*foreground`） |
| 终端选区 / 编辑器选区 | `--dsw-alias-bg-document-selection`（CM6 主题另映射一份） |
| 骨架屏 / 遮罩 | `--dsw-alias-bg-skeleton` / `--dsw-alias-bg-mask-1`（modal）、`-mask-2`（轻遮罩） |
| 浮层阴影 | `--dsw-shadow-lv2`（卡片）/ `--dsw-shadow-lv3`（modal） |
| tooltip / toast | `--dsw-alias-tooltip-bg` + `-key-bg` / `--dsw-alias-toast-bg` + `-label` |
| 滚动条 | `--dsw-alias-scrollbar-bg-l2` / `-hover-l2` |
| 等宽底（代码、终端） | `--dsw-alias-markdown-code-block` |

**兜底规则**：① 先按语义找：`state-*` 管状态、`label-*` 管文字、`border-l1..4` 管线、`bg-layer-1..3` 管面、`interactive-*` 管反馈。② 真猜不到时**只允许**这四个：`--dsw-alias-bg-layer-2`（面）、`--dsw-alias-border-l2`（线）、`--dsw-alias-label-secondary`（字）、`--dsw-alias-brand-primary`（强调）。③ 要"淡"用 `color-mix(in srgb, var(--dsw-alias-<x>) 12%, transparent)`，要"深"用 `color-mix(in srgb, var(--dsw-alias-<x>) 60%, var(--dsw-alias-label-primary))`——**混色两端必须是 token**。④ 明暗差异一律由 token 承载，禁写 `@media (prefers-color-scheme)`、禁读 `data-ds-dark-theme`。⑤ 任何 `#` / `rgb(` / `hsl(` / `oklch(` 字面量都会被 `scripts/check.mjs` 拦下（`// check-ignore: color` 仅限插画与品牌 logo，需注明理由）。

**派生色（泳道 8 色 + 状态字母）**：

```css
.wid-root {
  --wid-tone-business: color-mix(in srgb, var(--dsw-alias-state-business-primary) 60%, var(--dsw-alias-label-primary));
  --wid-tone-success:  color-mix(in srgb, var(--dsw-alias-state-success-primary)  60%, var(--dsw-alias-label-primary));
  --wid-tone-warn:     color-mix(in srgb, var(--dsw-alias-state-warn-primary)     60%, var(--dsw-alias-label-primary));
  --wid-tone-done:     color-mix(in srgb, var(--dsw-alias-state-done-primary)     60%, var(--dsw-alias-label-primary));
  --wid-tone-error:    color-mix(in srgb, var(--dsw-alias-state-error-primary)    60%, var(--dsw-alias-label-primary));
  --wid-tone-neutral:  color-mix(in srgb, var(--dsw-alias-label-secondary)        60%, var(--dsw-alias-label-primary));
  --wid-tone-teal:     color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, var(--dsw-alias-state-success-primary)) 60%, var(--dsw-alias-label-primary));
  --wid-tone-magenta:  color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-state-done-primary) 50%, var(--dsw-alias-state-error-primary)) 60%, var(--dsw-alias-label-primary));
  --wid-lane-0: var(--wid-tone-business); --wid-lane-1: var(--wid-tone-success);
  --wid-lane-2: var(--wid-tone-warn);     --wid-lane-3: var(--wid-tone-done);
  --wid-lane-4: var(--wid-tone-error);    --wid-lane-5: var(--wid-tone-neutral);
  --wid-lane-6: var(--wid-tone-teal);     --wid-lane-7: var(--wid-tone-magenta);
}
```

混入 `--dsw-alias-label-primary` 是关键：亮色下它近黑（压暗）、暗色下它近白（提亮），**同一行 CSS 在两套主题里都朝"离背景更远"的方向走**，因此不需要第二套定义。

**对比度核算**（`check:contrast` 固化；目标：文字 ≥4.5:1、图形 ≥3:1。表中 hex 是核算结果，**不得写进 CSS**）：

| 派生色 | 亮色 | vs `bg-layer-2` | 暗色 | vs `bg-layer-2` |
| --- | --- | --- | --- | --- |
| `--wid-tone-business` | `#2d4e92` | 7.7:1 | `#adcafd` | 8.4:1 |
| `--wid-tone-success` | `#1a7d41` | 5.0:1 | `#78da9d` | 8.2:1 |
| `--wid-tone-warn` | `#99660f` | 4.7:1 | `#f7c36b` | 8.6:1 |
| `--wid-tone-done` | `#502a97` | 9.5:1 | `#c8b7fa` | 7.7:1 |
| `--wid-tone-error` | `#941214` | 8.6:1 | `#f59a9a` | 6.6:1 |
| `--wid-tone-neutral` | `#404449` | 9.4:1 | `#e0e3e5` | 10.8:1 |
| `--wid-tone-teal` / `-magenta` | `#24656a` / `#721e55` | 6.4 / 9.9 | `#92d2cd` / `#dea9ca` | 8.2 / 7.1 |

八色在两套主题下均 ≥4.5:1，故同一变量既可用于 2px 线（3:1）也可用于 11px 状态字母（4.5:1）。

## 12 交互模式

| 场景 | 规则 |
| --- | --- |
| 单击 / 双击 | 单击：树节点、graph 行、SCM 行**选中**（SCM 行单击即出该文件 diff）；双击：树文件打开到编辑器、目录展开/折叠、graph 行开详情 |
| 焦点环 | 只用 `:focus-visible`：`outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px`；鼠标点击不出环 |
| 右键菜单 | `onContextMenu`（`preventDefault` + 记坐标）；`pointerdown` 捕获阶段关外部；`Esc` 关闭；↑/↓ 移动、`Enter` 执行、`Tab` 关闭；容器 `role="menu"`、项 `role="menuitem"`；渲染为根容器内 `position: absolute` 浮层 + `--dsw-shadow-lv3`（**不允许 fixed**，不能越出右栏） |
| 分隔条 | `pointerdown` + 窗口级 move/up；拖动中同步 `document.body.style.cursor`；`pointerup` 解绑并写 storage；双击恢复默认；热区用负 margin 扩到 8px |
| 标签拖拽 | pointer events（不用 HTML5 DnD）：移动 ≥4px 才进入拖拽；幽灵跟随指针；按组内容矩形 25% 边缘判定五区；`Esc`/窗口失焦取消；松手一次提交 |
| 标签右键 | 关闭当前 / 关闭其他 / 关闭所有 / 拆分四向 / 复制相对路径；批量关闭有脏文件时一次确认 |
| `prefers-reduced-motion` | 关折叠过渡、标签脏点↔关闭的尺寸过渡；spinner 改 1.5s 淡入淡出；骨架屏静止 |
| 触控 | 不做手势；热区 ≥8px 已满足最小可点尺寸 |

## 13 快捷键

注册形状（宿主 `dsh-client-shortcuts` 实测）：

```js
ctx.inject(['shortcuts'], (c) => c.effect(() => ctx.shortcuts.register({
  id: 'workspaceIde.save', label: () => t('shortcut.save'), aliases: ['save file', '保存'],
  defaults: { 'desktop:macos': { code: 'KeyS', modifiers: ['primary'] }, 'web:macos': { code: 'KeyS', modifiers: ['primary'] },
              'desktop:windows': { code: 'KeyS', modifiers: ['primary'] }, 'web:windows': { code: 'KeyS', modifiers: ['primary'] } },
  regions: ['page', 'editable'], modals: [],
  resolve: () => (editor.ready() ? { status: 'handled', run: () => editor.save() } : { status: 'blocked', reason: t('shortcut.noEditor') }),
})));
```

`resolve` 的返回值就是"消费语义"，**API 没有 `preventDefault` 参数**：`{status:'handled'}` = 插件消费（宿主阻止浏览器默认行为后执行 `run`，这是 `Cmd+S` 不弹"另存为"、`Cmd+W` 不关窗口的唯一手段）；`{status:'pass'}` = 不消费、事件透传给编辑器/终端/浏览器；`{status:'blocked'}` = 消费但不执行并给 `reason`（tooltip/toast），绝不"点了没反应"。`regions` 只写需要的：`page`（面板非编辑区）、`editable`（CM6）、`terminal`（xterm 焦点内）；**没写 `terminal` 的全局命令在终端里不触发**。宿主对重复 id 与默认键位重叠直接拒绝注册，失败必须落错误条；宿主保留或浏览器自留的键（`Cmd+W`/`Cmd+T`/`Cmd+N` 在 Web 端）"不进入窗口就拦截不到"，必须同时给面板内可见入口。

| 功能 | 键 | 宿主是否已占 | regions | 处理 |
| --- | --- | --- | --- | --- |
| 保存当前文件 | `Cmd/Ctrl+S` | 否 | `page`,`editable` | 注册；无脏标签 → `blocked`（无改动） |
| 全部保存 | `Shift+Cmd/Ctrl+S` | 否 | `page`,`editable` | 注册；逐文件 `files.write`，失败逐个进错误条 |
| 关闭当前标签 | `Cmd/Ctrl+W` | 否 | `page`,`editable` | 桌面端注册；**Web 端浏览器保留、拦不到** → 另注册 `Cmd/Ctrl+Alt+W` 并在关闭按钮 tooltip 标注可用键 |
| 快速打开（P1） | `Cmd/Ctrl+P` | **是**（`workspace.files`） | — | **不注册**；改 `Shift+Cmd/Ctrl+P`，另提供面板内 `/` 聚焦搜索框 |
| 全局搜索（P1） | `Shift+Cmd/Ctrl+F` | 否 | `page`,`editable` | 注册 → `files.search` |
| 折叠侧栏 | `Cmd/Ctrl+B` | **是**（`sidebar.left.toggle` 折叠宿主左栏） | — | **不注册**；改 `Shift+Cmd/Ctrl+E`（VS Code 里即资源管理器），活动栏 tooltip 标注 |
| 切换终端面板 | `Cmd/Ctrl+J` | 否 | `page`,`editable`,`terminal` | 注册；只切显隐不 kill |
| 切视图 1/2/3 | `Cmd/Ctrl+1` `+2` `+3` | 否（`Shift+2` 被占） | `page`,`editable`,`terminal` | 注册；焦点在终端时先切侧栏视图 |
| 上/下一条提交 | `Alt+↑` / `Alt+↓` | 否（裸 `↑/↓` 被占作菜单导航） | `page` | 注册；焦点不在图谱时返回 `pass`；Web 端若组合被拒则降级 `Alt+K`/`Alt+J` |
| 上/下一处差异 | `F7` / `Shift+F7` | 否 | `page` | 注册；无 diff 时 `blocked` |
| 提交（输入框内） | `Cmd/Ctrl+Enter` | 否（裸 `Enter` 被占） | 不注册 | `<textarea onKeyDown>` 自处理，避免全局抢 `Enter` |
| 终端复制/粘贴 | `Cmd/Ctrl+C` / `+V` | 否（KeyC/KeyV 未注册） | 不注册 | 交 xterm 原生；无选区时 `Cmd+C` 按 xterm 语义发 `^C`(SIGINT)，不禁用 |

### 13.1 落地与偏差（M4 实测的宿主规则）

上一节的表是设计意图；宿主 `dsh-client-shortcuts` 的实际规则更严，实现按下面这套走（`frontend/index.js`）：

1. **注册时机**：`ctx.inject(['shortcuts'], cb)` 里注册，`ctx.get('shortcuts')` 在 apply 时可能还是 `undefined`（激活顺序不是 load barrier）。
2. **`register` 是原子的、并且会伤人**：默认键位与已注册命令重叠时抛错，而且**被抢的一方（宿主包）也注册失败**——宿主会报「required entries did not activate」，整个 Web 启动不了。旧实现靠 `describeBinding` 预检 + `0/400/1200/2500ms` 重试抢位，现已整体删除：本插件不再声明任何默认键位（见 §13.2），冲突面归零。
3. **Web 端白名单**（`isWebBindingAllowed`）：`secondCode` 双键组合一律不行；`web:macos`/`web:windows` 只允许「≥3 个修饰键」或「primary + alt/shift」；**`web:linux` 只允许 `Ctrl+/`、`Cmd+Shift+,`、`Cmd+Shift+.`**，所以 `web:linux` 一条都不声明，也不必为它编键位。
4. **保留键**（`bindingIssue`）：带 primary 的 `C/V/X/Z/Y/Q/H`、不带 shift 的 `A`、以及 `Escape/Tab/Space/Backspace/Delete/方向键/裸 Enter` 属保留；macOS 的 `Cmd+H` 即「隐藏应用」，连 `Cmd+Shift+H` 一起被拒。
### 13.2 不绑默认键（现行策略）

**本插件不为任何命令声明默认键位**——`defaults: {}`。理由：11 条三修饰键组合占满 `⌥⌘⇧` 字母区，与宿主/浏览器/其他插件的冲突面只增不减，而"一次装好就再也不会改"的默认值对用户是负债。注册仍然完整（id/label/aliases/regions/modals/resolve），只是没有 key，因此：

- 宿主注册阶段对 `['desktop','web'] × ['macos','windows','linux']` 逐个 `resolveShortcutDefault` 拿到 `undefined` 就跳过，不产生 `Conflicting shortcut defaults`，也不需要预检与重试。
- 未绑定命令在宿主面板里显示 `No shortcut` 并可编辑（`dsh-client-ui-shortcuts`），所以"注册但不绑键"是官方支持的形态，不是残缺态。

| 命令 id | 默认键 | 面板内等价入口 |
| --- | --- | --- |
| `workspace-ide.explorer` | 无 | 导航面「文件」页签 / 工具栏 ⋯ |
| `workspace-ide.search` | 无 | 导航面「搜索」页签 |
| `workspace-ide.scm` | 无 | 工具栏 `±` 徽标按钮 / 欢迎页 |
| `workspace-ide.graph` | 无 | 工具栏 `⑂` 按钮 / 分支 chip / 欢迎页 |
| `workspace-ide.panel` | 无 | 工具栏 `>_` 按钮 / 状态栏终端区 |
| `workspace-ide.quickOpen` | 无 | 工具栏 🔍 按钮 |
| `workspace-ide.save` | 无 | 标签脏点、`⋯` 菜单、编辑器右键 |
| `workspace-ide.saveAll` | 无 | `⋯` 菜单 |
| `workspace-ide.nav` | 无 | 导航面右上「‹」按钮 / `⋯` 菜单 |
| `workspace-ide.closeTab` | 无 | 标签 `×`、中键、标签右键菜单 |
| `workspace-ide.fullview` | 无 | 工具栏「全视图」按钮 |

### 13.3 改键一律走官方设置面板

插件**不再自带录制器**（原 `view:shortcuts` 标签已删除）。改键入口是宿主自己的面板：

- 「设置 → 通用 → 编辑快捷键」，或 `Mod + /`；标题「快捷键」，480×600。
- 面板列出所有已注册命令，含本插件 11 条未绑定命令；选中行按组合键即写入。
- 存储位置由宿主决定：Web 端 `localStorage['dsh.keybindings.v1']`，桌面端 `userData/keybindings.json`。
- 工作台「设置」页只做**只读映射**：列出 11 条命令与其当前有效键（未绑定显示「未绑定」）并给出上面这条路径说明；工具栏/右键菜单里的按键提示也从 `shortcuts.catalog` 动态取，绑定为空时不渲染提示。
- 插件侧不调用 `shortcuts.edit`：`Shortcuts` 接口没有 `invoke`/`openSettings`，唯一合法路径是用户自己在面板里改。

### 13.4 其它约束

- `regions` 只声明 `page`：xterm 焦点位于 `terminal` 区，宿主不会把命令派进来，`Ctrl+C` 等保持 xterm 原生语义（未注册 `KeyC`）。
- `resolve` 返回 `{status:'blocked', reason:'请先选择一个会话'}` 当没有挂载会话时——消费但不执行，绝不"点了没反应"。
- 旧 §13 的键位表（`⌥⌘⇧E/F/G/R/J/O/S/A/B/W/V`）已作废，仅作历史记录保留在 §13.1 的正文里。

## 14 文案与本地化

NS `workspace-ide`，`ctx.locale.register('workspace-ide', { zh, en })`，slot 注册带 `locale: 'workspace-ide'`。key 规范 `<域>.<对象>.<语义>`，域取 `common|activity|explorer|scm|graph|editor|diff|terminal|status|notice|shortcut|error|shortcut`；占位符统一 `{name}`（禁 `%s`/`{{name}}`）；复数只对英文生效（`.one`/`.other`，中文忽略）；缺翻译回退 key 本身并在 dev 构建 `console.warn`。

| key | zh | en |
| --- | --- | --- |
| `common.cancel` / `common.confirm` | 取消 / 确定 | Cancel / OK |
| `common.retry` / `common.refresh` | 重试 / 刷新 | Retry / Refresh |
| `common.discard` / `common.copy` / `common.close` | 丢弃 / 复制 / 关闭 | Discard / Copy / Close |
| `common.loading` / `common.unsupported` | 加载中… / 暂未支持 | Loading… / Not supported yet |
| `activity.explorer` / `activity.scm` | 资源管理器 / 源代码管理 | Explorer / Source Control |
| `activity.graph` / `activity.terminal` / `activity.settings` | 提交图谱 / 终端 / 设置 | Commit Graph / Terminal / Settings |
| `explorer.empty` | 这个目录是空的 | This folder is empty |
| `explorer.action.newFile` / `collapseAll` | 新建文件 / 折叠全部 | New File / Collapse All |
| `explorer.action.rename` / `delete` | 重命名 / 删除 | Rename / Delete |
| `explorer.menu.copyPath` / `reveal` | 复制相对路径 / 在文件管理器中显示 | Copy Relative Path / Reveal in File Manager |
| `explorer.error.readDir` | 读取目录失败：{message} | Failed to read folder: {message} |
| `scm.empty.noChanges` / `scm.empty.hint` | 没有变更 / 工作区是干净的 | No changes / Your working tree is clean |
| `scm.group.staged` / `working` | 已暂存 / 未暂存 | Staged / Changes |
| `scm.group.untracked` / `conflicts` | 未跟踪 / 冲突 | Untracked / Conflicts |
| `scm.action.stageAll` / `unstageAll` | 全部暂存 / 全部取消暂存 | Stage All / Unstage All |
| `scm.action.discard` | 丢弃更改 | Discard Changes |
| `scm.commit.placeholder` | 提交信息（Cmd+Enter 提交） | Commit message (Cmd+Enter to commit) |
| `scm.commit.button` / `scm.commit.count` | 提交 / {count} 字符 | Commit / {count} chars |
| `scm.commit.disabled.empty` | 请先输入提交信息 | Enter a commit message first |
| `scm.confirm.discardTitle` | 丢弃 {count} 个文件的更改？ | Discard changes in {count} files? |
| `scm.confirm.irreversible` | 此操作不可撤销 | This cannot be undone |
| `scm.queue.tooLong` | 操作排队过久，请稍后重试 | Too many pending operations, try later |
| `graph.empty` / `graph.loadMore` / `graph.noMore` | 还没有提交 / 加载更多 / 已到最早的提交 | No commits yet / Load more / No more commits |
| `graph.changesRow` | 未提交的变更（{count}） | Uncommitted changes ({count}) |
| `editor.conflict.reload` / `overwrite` | 文件已在磁盘上变更，重新加载 / 强制覆盖 | File changed on disk. Reload / Overwrite |
| `diff.binary` | 二进制文件，无法显示差异 | Binary file — no diff available |
| `diff.truncated` | 差异过大，只显示前 {count} 行 | Diff too large — showing first {count} lines |
| `diff.noNewline` | \ 文件末尾没有换行 | \ No newline at end of file |
| `diff.nav.count` | 第 {index}/{total} 处差异 | Change {index} of {total} |
| `terminal.tab` / `terminal.new` | 终端 {index} / 新建终端 | Terminal {index} / New Terminal |
| `terminal.truncated` | 输出过多，已丢弃前 {bytes} 字节 | Output truncated — {bytes} bytes dropped |
| `terminal.exited` | 进程已退出（{code}） | Process exited ({code}) |
| `status.noEditor` / `status.disconnected` | 无打开的编辑器 / 未连接 | No editor open / Disconnected |
| `notice.noRoot.title` / `action` | 还没有打开文件夹 / 打开文件夹 | No folder opened / Open Folder |
| `notice.noGit.title` / `hint` | 未检测到 git / 请安装 git 后重新打开面板（本插件不会自动下载） | git not found / Install git and reopen (never auto-downloaded) |
| `notice.notRepo.title` / `action` | 当前目录不是 git 仓库 / 初始化仓库 | Not a git repository / Initialize Repository |
| `notice.untrusted.title` / `hint` / `action` | 此工作区尚未受信任 / 受信任后才能保存、暂存、提交和打开终端 / 信任此工作区 | Untrusted workspace / Trust it to write / Trust Workspace |
| `notice.huge.title` | 仓库较大，已停止自动刷新 | Large repository — auto refresh paused |
| `error.gitFailed` / `error.showCommand` | git 执行失败（退出码 {code}）/ 查看完整命令 | git failed (exit code {code}) / Show full command |
| `shortcut.save` / `shortcut.noEditor` | 保存文件 / 没有可保存的文件 | Save file / No file to save |
| `terminal.a11y.hint` | 终端输出不会被朗读；复制请用面板右上角按钮 | Terminal output is not announced; use the copy button |

## 15 状态视觉

| 状态 | 触发 | 视觉 | 可操作 |
| --- | --- | --- | --- |
| 无根目录 | `E_NO_ROOT` | 空态：插画位 `--dsw-alias-illustration-background` + 标题 + 主按钮「打开文件夹」 | 只能选目录 |
| 空工作区 | `files.list` 空 | 树区 `explorer.empty`，工具栏保留 | 新建可用 |
| 无 git | `E_GIT_MISSING` | SCM/图谱显示 `notice.noGit.*` + 复制安装指引，**不自动下载** | 文件与编辑全可用 |
| 非仓库 | `E_NOT_A_REPO` | `notice.notRepo.*` + 「初始化仓库」（显式确认后才 `git init`） | 确认后可用 |
| 无变更 | 四组皆空 | `scm.empty.*` 居中 | 提交框禁用 |
| 无终端 | `terminal.list` 空 | 面板空态 + 「新建终端」 | 可新建 |
| 加载·首屏 | 首个响应未到 | **骨架屏**：树 12 条 22px、图谱 12 条 28px 灰条（`--dsw-alias-bg-skeleton`） | — |
| 加载·局部 | 已有数据、取下一页或刷 diff | **spinner** 12px `--dsw-alias-brand-primary`，出现在触发点旁，不清空已有内容 | 可继续操作 |
| 错误·全局 | `ok:false`（除受控错误） | 顶部 28px 错误条：左沿 2px `--dsw-alias-state-error-primary` + 浅底 `color-mix(... 10%, transparent)`；含 `{code}` 与「查看完整命令」（`E_GIT_FAILED` 的 `detail.argv/stderr`，脱敏） | 可关闭、可重试 |
| 错误·行级 | 单文件读写失败 | 行内红字 11px + 行首红条，5s 消失 | 重试 |
| 降级·超大仓库 | `status.isHuge` | 顶部 20px 条 `notice.huge.title` + 右上「手动刷新」 | 关自动刷新 |
| 降级·只读 | 未信任 / 大文件超限 | 编辑器只读，状态栏加锁图标，写类按钮 `disabled` | 浏览与复制可用 |
| 断连 | Remote 连续 2 次失败 | 顶部条 `status.disconnected` + 写操作全禁用 + 3s→30s 指数退避重试 | 只读浏览 |
| 版本冲突 | `E_VERSION_CONFLICT` | 受控 modal：`editor.conflict.reload` / `overwrite`，显示 `detail.currentVersion` | 二选一 |

骨架屏 vs spinner 的边界：**首次填充用骨架屏；替换/追加已有内容一律用 spinner**，绝不整块清空重画。

## 16 无障碍

| 项 | 要求 |
| --- | --- |
| 对比度 | 文本 ≥4.5:1（含 11px 状态字母、hunk 头、状态栏），图形/边框 ≥3:1（泳道线、焦点环、展开箭头）；§11 的派生色已核算，构建期 `check:contrast` 复算 |
| 不靠颜色单传 | 状态字母本身是字符（`M/A/D`）；泳道另有位置编码；选中行除底色外有左沿条 |
| 键盘全可达 | hover 才出现的行内操作在行被键盘聚焦时同样出现；无"只能鼠标"的功能 |
| Tab 顺序 | 标题栏工具 → 活动栏(↑↓) → 侧栏视图切换 → 侧栏内容（tree 内用方向键）→ 标签栏 → 编辑器 → 面板分隔条 → 终端标签 → 终端内容 → 状态栏可点项 |
| 树 | 容器 `role="tree"` + `aria-label`；行 `role="treeitem"` + `aria-level` + `aria-expanded`（目录）+ `aria-selected` + `aria-posinset`/`aria-setsize`；↑↓ 移动、→ 展开或进入、← 折叠或回父、`Home/End` 首尾、`Enter` 打开 |
| 列表（SCM/graph） | `role="listbox"` + 行 `role="option"` + `aria-selected`；↑↓ 移动，`Home/End` 首尾 |
| 图标按钮 | 必须有 `aria-label`（与 tooltip 同文案）；纯装饰 svg `aria-hidden="true"` |
| `aria-label` 清单 | 活动栏 5 项；「关闭 {name}」与「全部关闭」；树行内 3 个操作；SCM 行内 3 个操作；分隔条（`role="separator"` + `aria-valuenow`）；终端新建/关闭/清屏/复制/杀死；diff 上一处/下一处；状态栏每项 |
| 终端 | 容器 `role="log"` + `aria-live="off"`（不朗读流式输出）+ `aria-label`；旁边常驻 sr-only `terminal.a11y.hint` 说明如何取内容 |
| 动态区域 | 断言式错误用 `role="alert"`；spinner 不设 `aria-live`，另用「正在进行：{op}」文本 + `aria-live="polite"` |
| 焦点管理 | 关标签后焦点落到相邻标签；树删除后落到父节点；modal 打开做 focus trap，关闭后还原 |
| 减少动效 | `prefers-reduced-motion: reduce` 关全部位移/尺寸过渡，spinner 改淡入淡出，骨架屏静止 |

## 17 响应式

断点用**容器查询**（右栏宽 ≠ 窗口宽）：`container-type: inline-size` 挂 `.wid-frame`，`@container widframe` 判定；**不用 `@media` 判断面板宽度**。

| 断点 | 行为 |
| --- | --- |
| ≥720px | 左栏并排；工具栏显示分支；标签最大 180px |
| 520–719px | 左栏可并排可收起；分支只在状态栏；标签最大 150px |
| <520px | 左栏变抽屉（默认收起，`data-nav` 控制，带遮罩）；状态栏 20px；标签最大 140px；工具栏根 chip 截断 |
| 分栏约束 | 左右分栏需组宽 ≥360px（每侧 180）；上下分栏需组高 ≥280px；放不下的方向在拖拽/菜单里置灰 |
| 状态栏裁剪优先级 | 保留顺序：变更计数 → 分支 → 语言 → 编码；先隐藏：缩进 → 光标行列 → ahead/behind |
| <640px 内容 | 图谱隐藏作者/时间列；diff 用单栏统一视图 |

## 与契约的差异（已复核：全部处理）

| # | 需求 | 处置 |
| --- | --- | --- |
| 1 | 图列宽要 `maxLane` | **已并入契约 v2**：`git.graph` 返回 `maxLane` |
| 2 | 「3 分钟前」相对时间 | 不需要进契约：`frontend/service/time.ts` 纯函数，按 `commit.committerAt` 算 |
| 3 | 缩进宽度 / 语言探测 | 不需要进契约：扩展名 + 首行内容，在 `frontend/service/language.ts` |
| 4 | 分组「全部暂存/取消暂存」 | **已并入契约 v2**：`stage/unstage/discard` 统一有 `all?: boolean` |
| 5 | 终端标签重命名、文件管理器显示 | P2，本期 `disabled` + tooltip |
| 6 | 图谱「跳到父提交」 | **已并入契约 v2**：`GraphRow.parents` |
| 7 | 折叠态/面板高度/标签持久化 | 契约侧已声明：这些属**客户端呈现态**，存 `workspace_ide/ui.*`，Host 不关心 |
| 8 | 未实现按钮的统一 tooltip | **已并入契约 §8**：未实现 → `disabled` + `common.unsupported` 文案 |

**本文件自身待补（测试与实现期）**：泳道 8 色的具体 token 混合比例需在真实主题下再验一遍对比度（当前结论来自 `--dsw-alias-*` 的 60% `color-mix` 推导，见 §3）。

## 实现补充（代码为准）

- 活动栏在四视图之外新增 **搜索**（`ui.activityView === 'search'`，快捷键 `Shift+Cmd+F`）：输入框 220ms 防抖后调用 `files.search`，命中列表点击走 `actions.openAt(path, line, column)`，由编辑器 `reveal{path,line,column,seq}` 消费并 `scrollIntoView`。
- 侧栏标题由 `SidebarHeader` 按视图给出；搜索视图的标题区只保留刷新/折叠，不提供「新建」。
- 所有色值仍只来自 `--dsw-alias-*` 与派生变量；搜索样式集中在 `frontend/styles/search.css`。
- 差异视图支持「并排 / 统一」两种布局（并排用 `MergeView`，统一用 `unifiedMergeView`，只读、无 revert 控件）；Markdown 文件在标签栏提供预览开关，图标为自绘 `preview`。
- 终端标签双击可重命名（走 `terminal.rename`，只改显示名，不重启 shell）。

## 18 内部标签页与拖动分栏

### 18.1 标签模型

| 类型 | id | 单例 | 来源 |
| --- | --- | --- | --- |
| 文件 | `file:<相对路径>` | 否 | 文件树、快速打开、搜索 |
| 差异 | `view:diff` | 是 | 「改动」行点击、图谱提交 |
| 冲突 | `view:conflict` | 是 | 冲突行的三栏视图 |
| 提交图谱 | `view:graph` | 是 | 工具栏 ⑂、状态栏分支、欢迎页 |
| 当前改动 | `view:changes` | 是 | 工具栏 ±、状态栏变更数、欢迎页 |
| 设置 | `view:settings` | 是 | 工具栏「⋯」 |

- 同一 id 全工作区只存在一份；打开已存在的标签只聚焦，不复制。
- 每组有 `active`；组获得焦点（pointerdown）时成为 `activeGroup`，新打开的标签落在活动组。
- 标签行右侧「⋯」：关闭该组所有标签、关闭所有分栏。标签右键：关闭当前 / 关闭其他 / 关闭所有 / 拆分四向 / 复制相对路径。
- 关闭文件标签前若有未保存修改 → 面板内确认框；批量关闭只弹一次，列出前 5 个路径。

### 18.2 拖动分栏

- 在标签上 pointerdown + 移动 ≥4px 进入拖拽；`×` 不触发拖拽；`Esc` 取消；拖到组外取消。
- 目标组内容矩形按 25% 边缘划分五区：左/右 = 左右分栏，上/下 = 上下分栏，中心 = 移动到该组。
- 拖拽中显示幽灵（跟随指针，90% 不透明、`--dsw-shadow-lv3`）与目标区高亮（品牌色 12% 底 + 2px 描边 + 文案）。
- 松手才提交布局；拖拽中不重排、不加过渡。
- 约束：总组数 ≤4；新组最小 180×140；放不下的方向不可投放（高亮不出现）。
- 分隔条：4px 热区，比例 0.2–0.8，双击恢复 50/50；组空自动合并（只剩一组时显示欢迎页）。
- 菜单里的「拆分四向」与拖拽走同一路径，是无障碍替代。

### 18.3 空组与欢迎页

空组显示工作区名/根路径 + 「打开文件… / 查看改动 / 提交图谱 / 设置」；首次打开只有欢迎页，不自动打开改动或图谱。

### 18.4 双层 tab 的视觉区分

- L1（宿主右栏 tab 条）：宿主 chip 胶囊，本插件不控制。
- L2（内部标签行）：编辑器标签风格（上圆角、活动标签与内容同底、上沿 2px、关闭按钮 hover 出现）；不加外框/阴影，避免看起来像第二层宿主 chrome。

## 19 Tree 改动视图与全视图

### 19.1 改动页两种视图

| 视图 | 结构 | 切换 |
| --- | --- | --- |
| Tree（默认） | 一级「更改 / 暂存」两级节点；未跟踪、冲突并入「更改」，文件行带状态与文件类型图标 | 改动页任意位置右键 →「使用默认视图」 |
| 默认（平铺） | 原来的「合并冲突 / 暂存的更改 / 更改 / 未跟踪」四组 | 右键 →「使用 Tree 视图」 |

- 一级节点可收起；节点右侧提供「全部暂存 / 全部取消暂存」。
- 文件行右键：打开文件、查看差异、暂存/取消暂存、丢弃、复制相对路径，以及两种视图切换。
- 行列表按 22px 行高窗口化，只渲染可视区 + overscan，不随变更数量线性增长 DOM。
- 未跟踪文件使用后端 `{ kind:'untracked' }` diff，不再按工作区 diff 发送。

### 19.2 全视图

- 入口：工具栏「全视图」按钮（主入口）；命令 `workspace-ide.fullview` 默认不绑键，需要键位请在宿主「设置 → 通用 → 编辑快捷键」里自行分配。
- 打开时关闭右栏的宿主「工作台」tab，把同一份会话工作台显示为 frame 级 `shell.overlay` 对话框。
- 对话框宽高各 80%，位于 `shell.overlay` 内（绝对定位，不用 `fixed`）；点击外部、Esc、关闭按钮或再按快捷键关闭。
- 右栏与全视图共享同一 runtime 与内部标签/分栏；切换展示位置不重建编辑器、不丢未保存内容。
- 可见性按 surface 聚合：`sidebar` 与 `overlay` 都不可见时才停止轮询/watch。

### 19.3 设置与快捷键入口

- 工具栏有「设置」与「全视图」两个入口；窄栏（<520px）隐藏「设置」，保留全视图与「⋯」。
- 「设置」是内部标签 `view:settings`：工作区根、信任、最近打开、编辑器偏好、生效上限，以及**只读的快捷键映射表**（11 条命令 ↔ 当前绑定，未绑定显示「未绑定」）并注明改键位置是宿主面板（设置 → 通用 → 编辑快捷键 / `Mod + /`）。
- 插件不自带录制 UI：宿主 `Shortcuts` 接口没有 `invoke`/`openSettings`，无法用代码打开该对话框，因此在设置页只给文字路径。
