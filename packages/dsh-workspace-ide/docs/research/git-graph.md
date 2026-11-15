# 提交图谱（Git Graph）技术选型调研

> 调研对象：DSH 第三方插件「小号 VS Code」中的 **源代码管理 + 提交图谱** 面板。
> 硬约束：自有 esbuild 单文件 ESM bundle、`window.__ModuleLoader__.load({id, factory})` 加载、**不得 import 任何 DSH 内部 client 包**、**不用 iframe**、宿主 Node 可 spawn、许可证仅 MIT/Apache-2.0/ISC/BSD、目标 5k–50k commit / 数十至数百分支。
> 所有版本号、体积、耗时均为 2026-11-13 在 macOS（git 2.54.0 / Node 24.22.1）**实测**，实测仓库为 `git fast-import` 合成的 45,251 commit / 350 分支 / 21 tag 仓库。

---

## 1. 结论先行

**主选：自研 lane 布局 + 自绘 SVG + 固定行高虚拟滚动；布局算法直接采用/移植 `the0807/git-graph-plus` 的 `src/git/git-graph-builder.ts`（Apache-2.0，487 行，纯 TS，零运行时依赖）。**

一句话理由：这是全部候选中唯一同时满足「吃任意 DAG（`hash + parents[]`）」「许可证允许拷贝与再分发」「算法已验证可用于 SourceGit 风格多泳道图」「体积与耦合均可控」的现成件；渲染层自己写反而比接一个 React 图谱组件更省事，因为虚拟滚动、主题变量、右键菜单、diff 面板都必须由我们控制。

**备选 A（快速 MVP / 交叉校验）：`@wexample/js-graph-log`**（MIT、6.3 KB、0 依赖，API `graphLogLayout([{id, parents}]) → rows`，可直接吃任意 DAG）。体量小到可以 30 分钟接入，用于在自研布局完工前先跑通「数据 → 泳道 → 列表」的链路；其「lane 不重排、不左压缩」的画法比 SourceGit 差，长期仍需替换为自研版本。

**备选 B（不推荐，仅作参考实现）：`@dolthub/commit-graph`**（Apache-2.0，React 组件，`computePosition.ts` 195 行能吃任意 DAG）。放弃原因：没有窗口化虚拟滚动（只有 react-infinite-scroller 的「加载更多」）、样式与交互定制受限、传递依赖含 react-tooltip/reactjs-popup 等一长串。

**明确排除**：`@gitgraph/*`（仓库已 archived，且 API 是声明式分支操作、**没有注入任意 DAG 的入口**）、`vscode-git-graph` 源码（许可证**禁止分发衍生作品**，见 §6）、解析 `git log --graph` 的 ASCII 输出（**不输出 parent hash**，拿不到拓扑）。

---

## 2. 候选对比表

### 2.1 布局引擎类（能产出泳道坐标的）

| 候选 | 版本 / 最近发布 | License | 体积(unpacked) | 吃任意 DAG？ | 维护状态 | 结论 |
|---|---|---|---|---|---|---|
| **git-graph-plus** `git-graph-builder.ts` | 仓库 2026-07-01 活跃 | **Apache-2.0** | 单文件 487 行，可零依赖抽出 | **是**（`Commit[]{hash,parents[],refs}`） | 113★，活跃 | **主选：移植/直接 vendor** |
| **@wexample/js-graph-log** | 1.0.12 / 2026-10-23 | MIT（package.json 声明；tarball 无 LICENSE 文件） | 16 KB（实现 6.3 KB） | **是**（`{id, parents}[]`，newest-first） | 0★、12 个版本、单人 | **备选 A：MVP 起步** |
| @dolthub/commit-graph | 2.4.1 / 2026-03-17 | MIT(npm) | 报告 347 MB（异常，疑含构建产物） | 是 | 良好 | 备选 B，仅参考 `computePosition.ts` |
| commit-graph (liuliu-dev) | 2.4.0 / 2026-03-29 | npm 标 MIT / 仓库 Apache-2.0 | 323 KB | 是 | 99 个版本，良好 | 同族，样式更重 |
| @gitgraph/core / js / react | 1.5.0 / **2021-03-06** | MIT | 441 KB / 216 KB / 586 KB | **否** | **已 archived** | **排除** |
| graph-lab | 0.0.5 / 2026-05-02 | **UNKNOWN（npm 无 license 字段，GitHub 404）** | 107 KB | 是 | 不可核 | **雷区，禁用** |
| d3-dag | 1.3.0 / 2026-11-01 | MIT | 536 KB（+quadprog/lp-solver） | 是 | 活跃 | 通用 DAG，非 git 语义，过重 |
| @mermaid-js/diagram-gitgraph | 13.0.0-alpha.1 | MIT | 224 KB | 是 | **alpha** | 不宜上生产 |
| gitopo | 0.0.6 / 2026-03-06 | MIT | 167 KB | 是 | 停滞 | 依赖 electron+vite，不可用 |
| elkjs | 0.12.1 | **EPL-2.0 OR GPL-3.0-or-later** | — | 是 | 活跃 | **许可证雷区，排除** |
| dagre | 0.8.5（2019） | MIT | — | 是 | 停更 | 排除 |

### 2.2 完整组件类（图谱 + 列表一把梭）

| 候选 | License | 形态 | 任意 DAG | 虚拟滚动 | 结论 |
|---|---|---|---|---|---|
| commit-graph / @dolthub/commit-graph | MIT / Apache-2.0 | React 组件（内联 SVG 行） | 是 | **无**（仅加载更多） | 可读不可用 |
| @dsviz/git | MIT | 自研图引擎插件 | — | 未知 | 新，非专用 |
| committree | MIT | 终端 UI | 是 | — | 不可用 |
| megit-app | MIT | 完整 app，非库 | — | — | 不可用 |

### 2.3 走读参考（不能拷代码，只学算法）

| 项目 | License | 图谱实现 | 可复用程度 |
|---|---|---|---|
| **SourceGit**（C#） | **MIT** | `src/Models/CommitGraph.cs`，436 行，active-lane 列表 + 每行重算 x + 颜色队列复用 | **可直接移植（MIT）**，思路最干净 |
| **vscode-git-graph**（TS） | **定制许可：禁止分发衍生作品**（GitHub 报 NOASSERTION） | `web/graph.ts` 913 行纯 SVG 自绘、**0 处 vscode API**；扩展侧 `src/dataSource.ts` 2025 行（仅 4 处 vscode 引用），`src/` 23 个 .ts 中 16 个 import 'vscode' | **只能读，不能拷** |
| GitLens | MIT **但不含 `plus/`** | 图谱在 `src/webviews/plus/` → **闭源** | 不可用 |
| GitButler | **FSL-1.1-MIT**（源码可见，非 OSI） | Rust 自研 | 不可商用拷贝 |
| ungit | MIT | 前端画图 | 可读 |
| GitKraken | 闭源商业 | — | 不可用 |
| GitExtensions | NOASSERTION | — | 需核实，勿拷 |

---

## 3. 数据获取与解析（实测命令与格式）

### 3.1 结论：**一次 `git log` 拿全列表，refs 单独一次 `for-each-ref`，详情按需取**

| 方案 | 实测耗时（45,251 commit） | 评价 |
|---|---|---|
| **`git log` 单次 + 哨兵分隔** | **0.22 s**，7.0 MB，解析 **36.1 ms**，heap 40 MB | **采用** |
| `git rev-list --all --parents` | 0.18 s，3.7 MB | 只有 hash+parents，缺 author/subject，仍需二次取 |
| `rev-list --parents` + `cat-file --batch-check` | **0.31 s** | 比 git log 更慢，无收益 |
| `git log --all --graph` | 0.18 s，2.24 MB | **不可解析**（见 §3.4） |

推荐流水线（**3 次 spawn 完成首屏**）：

```bash
# ① 提交列表（唯一的大输出）
git log --all --date-order -z \
  --format="%H<SEP>%P<SEP>%an<SEP>%ae<SEP>%at<SEP>%s<SEP>%D"
# ② refs 明细（含 upstream / ahead-behind）
git for-each-ref \
  --format="%(refname)%09%(objectname)%09%(objecttype)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)" \
  refs/heads refs/tags refs/remotes
# ③ 点开某提交时才跑
git show -s --format="%H%n%P%n%an%n%ae%n%at%n%cn%n%ce%n%ct%n%D%n%B" <hash>
git show --stat --format="" <hash>        # 0.01 s
git diff-tree -p --find-renames <hash>^!  # diff 正文
```

实测：①0.22 s / ②**0.15 s（371 行）**/ `git show --stat` 0.01 s。`<SEP>` 取多字符哨兵（我用 `--DSH-SEP-9x--`，vscode-git-graph 用 40 字符 `XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb`）。

### 3.2 解析格式（验证过）

- `-z` 只是把记录结尾的 `\n` 换成 `\0`，**字节数完全不变**（实测都是 7,012,965 B）；Node 端 `buf.split('\0')` → 每条 `split(SEP)` → 必须恰好 7 段，否则计入 bad（实测 **45,251 parsed / 0 bad**）。
- `%P` 是空格分隔的父 hash；root commit 该字段为空字符串。
- `%at` 是 unix 秒。`%D` 是装饰串（`HEAD -> main, tag: v20, origin/main`），**够画徽章但不够判断 annotated/lightweight、也不含 ahead/behind** → 这部分交给 ②。
- 时间排序用 `--date-order`（比默认更稳，保证 parent 必在 child 之后），要「少交错」可换 `--topo-order`（实测 0.22 s，同体积）；两者都满足布局算法的前提。

### 3.3 坑（全部实测踩过）

1. **单字符分隔符不可靠**：故意造一个 subject 里含 `\x1f` 的提交，用 `%x1f` 做字段分隔器时该行**拆出 9 段而不是 7 段**，直接错位。→ 必须用多字符哨兵。
2. **`-z` 与 `%x00` 不能同时用**：`-z` 已经把记录分隔符变成 NUL，再用 `%x00` 做字段分隔会歧义。要一次带多行 body（`%B`）时，用「记录哨兵 `%x01%x02%x03` 前缀 + 字段 `%x00`」（git-graph-plus 的做法），或干脆 body 按需 `git show -s`。
3. **编码**：写入对象库的真 latin-1 提交（`Jos\xe9` / `caf\xe9`），`git log --format="%an"` 输出已是 **UTF-8**（`Jos\xc3\xa9`）——git 默认把 message 与 author name 重编码为 UTF-8。仍需显式加 `--encoding=UTF-8`，并固定子进程 `env` 的 `LC_ALL/LANG`，防用户 global gitconfig 设了 `i18n.logOutputEncoding` 为非 UTF-8。
4. **首屏不该只加载全部**：45k commit 的 7 MB 文本 + 40 MB heap 可以接受，但 50 万级要分批（`--max-count` + skip 续取），否则 IPC 与 GC 都会痛。

### 3.4 `git log --graph` 为什么不能当数据源

实测 `git log --graph -z --format="%H"` 的输出形如：

```
*  <40hex>
| \ \0| * <40hex>
```

- 图线字符被**前置**在每条记录前，「跨行连线」（`| \`）还会插在记录内容与 `\0` 之间 → NUL **不在行首/行尾对齐**，必须先按 NUL 切、再剥每段最后一行的可变长图线前缀。
- 更致命：**`--graph` 不输出 parent hash**，DAG 拓扑直接丢失，后续布局、搜索、diff 导航全都要再查一遍。
- `--graph --oneline` 输出 45,356 行 = 45,251 commit + **105 行纯连线**，行数与 commit 数不等，做行号映射还要额外对齐。

→ 只用于人工对照/debug，**不要做数据源**。

---

## 4. 布局算法

### 4.1 三种可选方案

**方案 A：SourceGit 式 active-lane 列表（推荐）**

数据结构：`unsolved: PathHelper[]`，每个 `PathHelper { next: hash, lastX: number, path }`。

每行 `commit` 的处理（`offsetY += 1`）：
1. 顺序遍历 `unsolved`，`offsetX += unitWidth`，把 `l.lastX = offsetX` 写回 —— **每行重算 x，所以 lane 会自动左压缩，永远不会留空列**（这是它比 vscode-git-graph 画得紧凑的原因）。
2. 第一个 `l.next === commit.sha` 的 lane 成为 `major`：`major.next = parents[0]`，无父则 `End`。其余命中的 lane `End(major.lastX, ...)` 收掉，`colorPicker.recycle(color)`。
3. 没有 major 且有父 → `unsolved.Add(new PathHelper(parents[0], colorPicker.Next()))`。
4. 额外 parent（merge 的第二、三个父）：`unsolved.Find(p => p.next === parentHash)`，找到就补一条 `Link{start=position, control=(parent.lastX, position.y), end=parent.lastX}`（贝塞尔），找不到就 `offsetX += unitWidth` 新建 lane。
5. 行尾写 `commit.color`、`commit.leftMargin`。

输出三类图元：`paths`（父线点集）、`links`（merge 贝塞尔，带 control point）、`dots`（默认/HEAD/merge 三种圆点）。渲染端只需要「画折线 + 画二次贝塞尔 + 画圆」。

**方案 B：vscode-git-graph 式 `determinePath` 贪心扫描**

从每个 vertex 沿 `getNextParent()` 向下逐行扫描，遇到「已被占用的点」就 break，用 `registerUnavailablePoint` 记占用；merge 时走 `getPointConnectingTo` 复用已有通道；颜色用 `availableColours[color] = 结束行号` + `getAvailableColour(startAt)` 找第一个 `startAt > 可用行号` 的槽（**branch index reuse**）。缺点：`nextX` 只增不减 → 长仓库里 lane 只增不回收，图会越画越宽；且需要「占用点」二维表，扫描是 O(C²) 最坏。**只作算法参考，不建议照抄。**

**方案 C：`@wexample/js-graph-log` 式「lane 不重排」**

`lanes: (Lane|null)[]`，每个 commit 取「正在等它的 lane」（多个则最左，其余 merge 进来），空槽 `freeColumn()` 复用，颜色单调 `nextColor++`。实现极短（6.3 KB），但 **lane 永不重排** → 线的列号一旦分配就固定，视觉上会出现大量平行长线，宽仓库比 SourceGit 宽。

### 4.2 复杂度与实测耗时

复杂度 **O(C × L)**，其中 L 是该行的活跃 lane 数（**不是总 lane 数，也不是分支数**）。

| 场景 | commit | 分支 | 最大并行 lane | 布局耗时 |
|---|---|---|---|---|
| 稀疏 | 10,000 | 40 | 10 | **1.8 ms** |
| 稀疏 | 50,000 | 40 | 41 | **5.2 ms** |
| 密集 | 10,000 | 400 | 172 | **3.6 ms** |
| 密集 | 50,000 | 400 | 425 | **76.7 ms** |
| 病态（lane 不闭合） | 10,000 | — | ≈10,000 | **162.5 ms** |
| 病态（lane 不闭合） | 50,000 | — | ≈50,000 | **3,982 ms** |

（Node 24，一次性脚本，非本仓库代码。）

**关键结论**：布局不是瓶颈——5 万 commit / 400 分支只要 **77 ms**，完全可以在主线程一次算完（或放进 `requestIdleCallback`）。但**输入顺序必须保证 parent 一定出现在 child 之后**；我第一版生成器把边指反了，lane 永远不闭合，耗时从 5 ms 涨到 3,982 ms（退化成二次）。所以：

- 用 `--date-order`/`--topo-order` 保证拓扑序；
- 布局里加**防御**：若某行活跃 lane 数超过阈值（如 200），降级为「合并同色 lane / 直接截断为单列竖线 + 徽章」，避免 UI 被病态仓库（某些 monorepo 的 octopus merge）拖死；
- 每个 `PathHelper` 有个到期行号，超过 N 行仍未命中 parent 就标注为「悬空」，不要让孤儿 lane 无限堆积。

---

## 5. 渲染与交互实现要点

### 5.1 SVG vs Canvas

| | SVG | Canvas |
|---|---|---|
| 1 万 commit 全量绘制 | **不可行**（DOM 节点爆炸） | 可行 |
| 虚拟化后（可视 ~40 行） | **~40 行 × 每行 2–3 图元 = 几百个节点，完全够** | 也可以，但失去 hover/点击命中 |
| 主题/动画/点击命中 | CSS 变量直接吃宿主主题，`<circle>` 天然可点 | 需要手动 hit-test |
| 缩放/清晰度 | 矢量，Retina 免处理 | 需 `devicePixelRatio` |

**结论：SVG + 虚拟滚动**。理由：虚拟化后可视区只有几十行，SVG 节点数不是问题；而主题 token（CSS 变量）、hover tooltip、点击命中、无障碍焦点全都要靠 DOM。仅当「用户主动拉成 5 万行全展开、不做虚拟化」时才考虑 Canvas，这恰恰是我们要避免的。参考：vscode-git-graph 也是纯 SVG 自绘（`web/graph.ts` 913 行、12 处 `createElementNS`、0 依赖），在它的分页策略（每次 +100）下够用；SourceGit 是 Avalonia 直接画（相当于 Canvas 路线）。

### 5.2 虚拟滚动

- **固定行高是前提**：`GRAPH_LOG_ROW = 28`（js-graph-log）这类常量即可；行高固定 → 可视窗口 = `scrollTop / rowHeight`，无需测量。
- 推荐 `@tanstack/react-virtual`（3.14.26 / 2026-11-03 / MIT / 62 KB，headless，不绑样式）；`react-window`（MIT）更小 API 但定制差；`react-virtuoso` 自带动态高度，我们用不上。
- 结构：外层 `overflow-y: auto` + 一个撑高的 spacer，内部绝对定位渲染 `[start, end]` 行区间。
- 左右两栏（图 + 表格）**共享同一个竖向滚动容器**，用 CSS grid 对齐：`grid-template-columns: {graphWidth}px 1fr`，图列宽 = `maxLanes × unitWidth`。
- 图列也要窗口化：只给可视行生成 `<path>`。跨行线（merge 长线）需要按可视区间**裁剪路径**——这是唯一需要额外算的：把每条 path 的多点折线按 `[start,end]` 行区间截断（简单做法：把线转成逐行的「进出点」记录，SourceGit 的 `Path.points` 已天然按行排列，按行号切片即可）。

### 5.3 React 重渲染

- 布局结果是**不可变数据**（`paths/links/dots` 数组），用 `useMemo` 挂在 `commits` 引用上；`commits` 不变就永不重算。
- 行组件 `React.memo`，props 只传行号 + 该行的图元切片（不要传整个 graph 对象）。
- 选中态、hover 态放独立的 lightweight store（`zustand`，MIT）或 `useSyncExternalStore`，避免整表重渲染；参考 Git Graph 的做法：选择变化只重算受影响行。
- 搜索过滤：**只过滤列表，不重排布局**（Git Graph 的 `highlighting` 枚举就是这个思路：`All / CurrentBranchOnly / SelectedCommitsOnly / ...`）——重新布局会导致点击行号漂移，体验很差。

### 5.4 交互清单

| 功能 | 现成件 | 备注 |
|---|---|---|
| diff 展示 | `diff2html`（MIT，2.0 MB，统一/side-by-side + 行内高亮）/ `react-diff-view`（MIT，1.45 MB，React 原生、性能好）/ `@git-diff-view/react`（MIT，1.3 MB，自带 highlight.js） | diff2html 最省事；`diff`（BSD-3）只做算法 |
| 虚拟滚动 | `@tanstack/react-virtual` | 见 5.2 |
| 右键菜单 | 无好用的「零依赖」库，建议自研（一个 absolute 定位的 `<div>` + 键盘导航），或用宿主已有的 context menu API | 若宿主没暴露，自研 50 行 |
| 搜索高亮 | 自研（`indexOf` 标黄）或用 `highlight.js` 的 `highlight()` | 别引入全文检索引擎 |
| 状态管理 | `zustand`（MIT，5.1.0）/ `@tanstack/react-query`（MIT，5.107.1） | 仓库切换、refetch 缓存用 react-query 省事 |
| 图标 | 内联 SVG（勿引入 icon 包，bundle 体积敏感） | — |

**没有任何现成 React 组件同时满足「多泳道 SourceGit 风格 + 真虚拟滚动 + 可定制交互」**——这也是推荐自研渲染层的直接原因。

---

## 6. 许可证雷区（必读）

| 候选 | 实际许可证 | 能不能拷代码 |
|---|---|---|
| **vscode-git-graph** | 自 1.x 起是**改过的 MIT**：`Permission is NOT GRANTED to publish, distribute, sublicense, and/or sell derivative works of the Software.`（GitHub 因此报 NOASSERTION） | **绝对不能**。不能 vendor、不能分发衍生。只能读算法后自己写。⚠️ npm 上的 `dsh-dev-git-graph` 0.1.4 把它的 `vendor/git-graph/`（含 `dataSource.ts`）整包 vendor 了，法律风险由该包作者承担，勿模仿 |
| **graph-lab** | npm 无 license 字段，GitHub `trevSmart/graph-lab` 404 | **不能**（来源与许可均不可核） |
| elkjs | EPL-2.0 OR GPL-3.0-or-later | **不能**（GPL 传染 + EPL 条款） |
| GitButler | FSL-1.1-MIT（2 年内禁止竞品用途） | **不能** |
| GitLens | MIT 排除 `plus/` 目录，图谱恰在 `plus/` 内 | **不能** |
| GitExtensions | GitHub 报 NOASSERTION | 未核实，**不要拷** |
| dagre / d3-dag | MIT | 可以，但都不是 git 语义（见 §2.1） |
| **SourceGit** | **MIT** | **可以**（保留版权声明即可） |
| **git-graph-plus** | **Apache-2.0** | **可以**（保留 NOTICE/版权声明；其 builder 已注明 ported from SourceGit/MIT） |
| @wexample/js-graph-log | MIT（仅 package.json 声明） | 可以，但建议自研等价实现（体量太小，不值得为它承担「无 LICENSE 文件」的合规瑕疵） |
| diff2html / react-diff-view / @tanstack/react-virtual / zustand | MIT | 可以 |

> 合规建议：如果直接 vendor `git-graph-builder.ts`，在插件仓库里建 `THIRD_PARTY_NOTICES.md`，抄上 Apache-2.0 全文 + SourceGit 的 MIT 版权头（该文件自己的注释里已经写明来源链）。

---

## 7. 风险与工作量估算

### 7.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **超宽图**（octopus merge / monorepo，并行 lane >200） | 布局耗时从 5 ms 涨到秒级，横向滚动恶心 | lane 上限 + 截断降级；按分支过滤默认只看当前分支 |
| **grand-scale 仓库**（>20 万 commit） | 7 MB 文本 × 倍数、IPC 卡顿 | 分页 `--max-count` + 续取；首屏只加载 5k |
| 病态拓扑让 lane 不闭合 | 复杂度退化二次（实测 50k → 3.9 s） | 布局里加「悬空 lane 超期回收」 |
| 编码 | 少数机器配置了非 UTF-8 输出编码 | 显式 `--encoding=UTF-8` + 固定 `LC_ALL` |
| spawn 生命周期 | 快速切仓库时进程泄漏、输出串扰 | 每次请求带 epoch，旧请求 `kill()` |
| shallow / partial clone / worktree / bare repo | `git log --all` 可能不完整或失败 | 启动时 `git rev-parse --is-shallow-repository` 检测并提示 |
| **许可证** | 误拷 vscode-git-graph 代码 → 无法分发 | 见 §6，CI 里加 license 白名单检查 |
| 主题/语言环境拿不到 | 违反「不用 iframe」的初衷 | 全部走 CSS 变量 + 宿主 i18n API，不引入硬编码色值 |

### 7.2 工作量（人日，单人，含联调自测）

**P0 最小可行实现（MVP，建议先做）≈ 9–12 人日**

| 任务 | 人日 | 说明 |
|---|---|---|
| Host：git 数据层 | 2 | 3 条命令封装 + 解析 + 错误态 + 进程管理（实测已验证命令与格式） |
| Host→Client 传输 + 宿主路由/API 通道 | 1 | 大 payload 分片、取消 |
| 布局算法（vendor/移植 `git-graph-builder.ts` + 类型适配 + 单测） | 1.5 | 有 430 行现成测试可参照 |
| SVG 图谱渲染 + 固定行高虚拟滚动 | 2.5 | 含裁剪、lane 高亮、hover |
| 列表行（hash/作者/日期/subject/ref 徽章）+ 搜索过滤 | 1.5 | — |
| 详情面板（`git show -s`）+ 单文件 diff（diff2html） | 2 | 含大文件降级 |
| 打包集成（esbuild 单 ESM、ModuleLoader、主题变量） | 1.5 | — |
| **合计** | **≈ 12** | 乐观 9 / 保守 12 |

**P1 完整版（VS Code Git Graph 平替）再 +12–18 人日**：分支/标签右键操作（checkout/merge/rebase/cherry-pick/tag/push）、工作区改动 + stage、stash、多仓库/多 worktree 切换、文件历史、对比两个 commit、ahead/behind 指示、GPG 签名标记、commit 详情里的文件树与二级 diff、拖拽分栏、快捷键。

**总计：21–30 人日**（不含代码评审与视觉打磨）。

---

## 8. 参考链接

- SourceGit（MIT，C# 参考实现）：<https://github.com/sourcegit-scm/sourcegit> · 关键文件 `src/Models/CommitGraph.cs`
- git-graph-plus（Apache-2.0，可复用的 TS builder）：<https://github.com/the0807/git-graph-plus> · 关键文件 `src/git/git-graph-builder.ts`
- vscode-git-graph（**许可证禁止分发衍生**，只读）：<https://github.com/mhutchie/vscode-git-graph>
- @wexample/js-graph-log：<https://www.npmjs.com/package/@wexample/js-graph-log>
- @dolthub/commit-graph：<https://www.npmjs.com/package/@dolthub/commit-graph>
- gitgraph.js（archived）：<https://github.com/nicoespeon/gitgraph.js>
- @tanstack/react-virtual：<https://www.npmjs.com/package/@tanstack/react-virtual>
- diff2html：<https://www.npmjs.com/package/diff2html> · react-diff-view：<https://www.npmjs.com/package/react-diff-view>
- git log 格式占位符文档：<https://git-scm.com/docs/git-log#_pretty_formats>
- git for-each-ref 字段：<https://git-scm.com/docs/git-for-each-ref>
- DSH 侧先例（供对照，均为 iframe 或 peer 依赖路线）：`dsh-dev-git-graph` 0.1.4、`dsh-git-panel` 0.1.20、`dsh-idea-git` 0.5.5

---

### 附：本次调研用到的实测脚本位置（非交付物，可删）

- 合成仓库与 benchmark：`/tmp/ggbench/{bigrepo,edge,latin,js,out}`
- 源码走读克隆：`/tmp/ggsrc/{vscode-git-graph,gitgraph.js,sourcegit,git-graph-plus,commit-graph,dsh-plugins}`
