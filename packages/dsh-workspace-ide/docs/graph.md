# 提交图谱：布局、wire 行与 SVG 渲染

> 本文是 `git.graph` 的实现规格：Host 侧布局、分页与缓存、wire 行怎么变成 SVG、虚拟滚动与交互、降级与可访问性。
> 分层与状态所有权见 [ARCHITECTURE.md](../ARCHITECTURE.md)；动作/字段/错误码唯一出处 [remote-contract.md](./remote-contract.md) §4.6；log 格式串与实测口径见 [git-model.md](./git-model.md) §4.4 / §9；算法选型论证见 `research/git-graph.md`。
> **不写实现代码**：`backend/git/layout.js` 与 `frontend/views/graph/**` 由实现者按本文写。

## 1. 分工：谁算、谁传、谁画

| 环节 | 位置 | 产出 | 禁止 |
|---|---|---|---|
| 取数 | Host `git/log.js` | 已解析、已排序的 `Commit[]` | 客户端解析 `git log` 文本 |
| 布局 | Host `git/layout.js` | `GraphRow[]`（`lane`/`color`/`segments`） | 客户端重算 lane、重排 commits |
| 传输 | wire | 紧凑行 + 同序 `commits[]` | 传 SVG、传像素、传色值 |
| 渲染 | 客户端 | 可视区间切片 + `<path>` | 客户端排序、合并、去重提交 |

不变量（构建期断言 + 运行时 0 容忍）：`rows.length === commits.length` 且 `rows[i].hash === commits[i].hash`。`commits[i]` 只供展示字段（`parents`/`refs`/`subject`），`rows[i]` 只供画图。

## 2. 分页管线

### 2.1 请求参数

| 参数 | 首页 | 追加页 | 巨大仓库 | 说明 |
|---|---|---|---|---|
| `maxCount` | 2000（`limits.logPageDefault`） | 2000 | 1000 | 硬顶 `logPageMax` 20000；Host 侧 clamp，不信任客户端 |
| `skip` | 0 | 上页 `nextSkip` | 同左 | 已加载上限 10000（5 页）；巨大仓库 4000（4 页） |
| `refs` | `'all'` | 同首页 | 同首页 | 分页期间**必须**一致，变了就是换视图（清行窗口） |
| `path` | 无 | 同首页 | 同首页 | 与 `refs` 同规则 |

`nextSkip = skip + rows.length`；`hasMore` 由 Host 多取 1 条判断后丢弃得出。客户端距底部 **400 行**（`PREFETCH_ROWS`）预取下一页；到 10000 行停并显示「仅显示最近 10000 条提交」。

### 2.2 Host 两级缓存

| 级别 | 键 | 值 | 失效 |
|---|---|---|---|
| L1 解析 | `(refs, path, search)`（契约 §`git.log`） | `Commit[]` 全量，上限 5 万条，超出截断 | refs 变化、HEAD 移动、仓库重建 |
| L2 布局页 | `(refs, path, maxCount, skip)`（契约 §`git.graph`） | `{ rows, tailState@(skip-200), emittedAt, epoch }`，每仓库最多 8 页 LRU | 同 L1 |

**L2 必须存 `tailState`**：追加页要从"上一页倒数第 200 行之前"的 lane 状态重放，否则 lane 号漂移（§2.3）。失效动作：`refs`/`path` 变、`git.status.seq` 变化且 `head` 变（提交/切分支/合并）、L1 被淘汰、`LAYOUT_VERSION` 常量变更 → 清 L2 并 `layoutEpoch++`，客户端从 `skip:0` 重取。

### 2.3 追加页：尾部 200 行重算 + 前缀校验

输入 `arr = L1 缓存`、`page = L2[skip]`、`anchor = max(0, skip - TAIL_ROWS)`，`TAIL_ROWS = 200`（与悬空 lane 回收窗口同值）。

```js
function appendPage(arr, cache, { skip, maxCount }) {
  const anchor = Math.max(0, skip - TAIL_ROWS)
  const state = cloneLaneState(cache.get(anchor)?.tailState ?? emptyLaneState())
  for (let i = anchor; i < skip; i += 1)                  // 1) 重放 [anchor, skip)：只校验不输出
    if (!sameRow(layoutRow(arr[i], state), cache.get(i)?.rows[0])) return drift(cache, skip, maxCount)
  const rows = []                                         // 2) 输出 [skip, skip+maxCount)
  for (let i = skip; i < Math.min(arr.length, skip + maxCount); i += 1) rows.push(layoutRow(arr[i], state))
  return { rows, tailState: state, nextSkip: skip + rows.length, hasMore: skip + rows.length < arr.length }
}
```
三条硬规则：①**已发前缀一律不重算、不重发**；②只重算尾部 200 行（200 是"能影响当前 lane 状态的最长回溯窗口"：悬空回收与颜色回收都在窗内；每页 O(skip) 会让 1 万行退化成 O(n²)）；③校验失败 = 数据源变了，`layoutEpoch++` 并改从 0 重算。

### 2.4 为什么不能重算前缀

| # | 后果 |
|---|---|
| 1 | 行号漂移 → 行 key 变化，虚拟列表 40 行 × 12 path 全部重挂载 |
| 2 | 选中行指向错提交（详情面板显示的不是用户点的那个） |
| 3 | 滚动锚点失效，视角跳回顶部 |
| 4 | 每页 O(skip) 布局，累计成本随页数线性增长 |
| 5 | 前缀重发每页多传数百 KB（2000 行 ≈1.1 MB） |

### 2.5 漂移检测（契约无 `layoutEpoch` 时的过渡）

`git.status.seq` 变化后重取 page 0，比对 10 个探测点 `rows[i].hash`，`i ∈ {0,200,…,1800}`。任一不等 → 清行窗口、锚点重置为原选中 hash（找不到则 0）；全等 → 保留前缀只追加。正常刷新不提示。

### 2.6 refs 徽章：来源与合并时机

| 来源 | 有什么 | 缺什么 |
|---|---|---|
| `Commit.refs[]`（`git.log` 的 `%D`，随页下发） | `{type:'branch'\|'tag'\|'remote'\|'head', name, isHead}` | 分不清 annotated / lightweight；无 `ahead/behind`；`truncated` 时不全 |
| `git.refs`（一次 `for-each-ref`，**与 page 0 并行发**） | `head`/`local[]`/`remote[]`/`tags[]` + `defaultBranch` | 晚于 page 0 到达 |

规则：①首帧徽章用 `Commit.refs[]`，不等 `git.refs`；②`git.refs` 到达后建 `Map<sha, RefMeta[]>`，只补 `annotated:boolean` 与 `defaultBranch` 标记 —— `Commit.refs[]` 仍是唯一徽章来源（避免两处真相）；③合并**不重排、不重新布局**，只让 `refsByHash` 的 `version` 自增触发选择器重算；④`ahead/behind` 只在当前分支徽章 tooltip 显示；⑤`git.refs.truncated` → 顶部 chip「引用过多，徽章可能不全」。

## 3. 布局算法（Host，移植 `git-graph-plus/src/git/git-graph-builder.ts`）

### 3.1 移植契约

```ts
// backend/git/layout.js
// Ported from git-graph-plus/src/git/git-graph-builder.ts
// Copyright (c) the0807 — Licensed under the Apache License, Version 2.0
// https://github.com/the0807/git-graph-plus/blob/main/LICENSE
// 修改说明：输出改为稳定 lane 槽位 + 每行 segments（原文输出像素坐标 polyline）。
export const LAYOUT_VERSION = 1
type LaneState = { lanes: Array<{ lane: number; color: number; next: string; idle: number }>; free: number[]; nextColor: number; maxLane: number }
export function layoutRow(commit: Commit, state: LaneState): { row: GraphRow; state: LaneState }
export function layoutRange(commits: Commit[], state: LaneState): { rows: GraphRow[]; state: LaneState; stats: LayoutStats }
```

**与原文唯一的算法差异（写进文件头）**：原文每行重写 `lastX` 做 lane 左压缩，像素 x 逐行变化；wire 要求 `from`/`to` 跨行可对齐，故 `lane` 是**稳定槽位**（复用最小空闲号），`x` 由客户端算。

### 3.2 lane 分配规则（逐行按序执行）

| # | 规则 |
|---|---|
| R1 | 所有 `lane.next === commit.hash` 的活跃 lane 中**按 lane 升序取第一个**为 `major`（左侧优先，历史主线靠左） |
| R2 | 其余等待同一 hash 的 lane → 各发 `merge(from: lane, to: major.lane)`，释放并回收颜色 |
| R3 | 无 `major`（没人等它）→ 新开 lane 作 `major`，本行**无入线**（引用尖端/孤儿提交） |
| R4 | `major.next = parents[0]`；无父（root）→ 释放 `major`，本行**无出线** |
| R5 | 第 2+ 父：已有 lane 在等它 → `fork(from: commit.lane, to: 该 lane)`；否则开新 lane → `fork(...)` 到新 lane |
| R6 | 本行其余活跃 lane 各发一条 `passthrough(from: l, to: l)` |
| R7 | `commit.lane = major.lane`，`commit.color = major.color` |

**同一 lane 复用条件**：该 lane 的 `next` 等于本行 hash（R1），或等于本行某父提交（R5 的反向）。**绝不**为省列而复用"颜色相同但 `next` 不同"的 lane —— 那会把两条无关历史画成一条。

### 3.3 `segments` 语义：行带模型

`rows[i].segments` 描述 **row i 的行带** `y ∈ [i×28, i×28+28]` 内全部几何（局部 `top=0 / mid=14 / bottom=28`）：

| `kind` | 几何 | `from` / `to` |
|---|---|---|
| `passthrough` | 竖线 `top → bottom`（圆点盖中间） | `from === to` |
| `merge` | `(from, top) → (to, bottom)`，终点在圆点中心 | `to === rows[i].lane` |
| `fork` | 圆点中心 `(from, mid) → (to, bottom)` | `from === rows[i].lane` |

不变量（客户端 dev 断言）：`row i` 的底边 lane 集合（所有 `to`）=== `row i+1` 的顶边 lane 集合（`passthrough.from` ∪ `merge.from`）。线性历史每行只有 1 条 `passthrough`，不是 merge+fork 两条。

### 3.4 颜色索引分配与回收

| 项 | 规则 |
|---|---|
| 调色板 | 8 槽（`color & 7`），**只传索引**，色值由主题 token 决定（§4.5） |
| 分配 | `free.length ? free.shift() : nextColor++ % 8` |
| 邻接约束 | 与 `lane-1`/`lane+1` 同色则顺延到下一空槽（最多试 3 次，失败接受） |
| 回收 | 释放时 `free.push(color)`，**FIFO**（LIFO 会让相邻分配反复撞同色） |
| 折叠 | 活跃 lane > `MAX_LANES (24)` 时不开新 lane，新父挂最右 lane（`folded++`），渲染 clamp 到 15 列 |

### 3.5 悬空 lane 回收

病态输入（父提交先于子提交出现，`--date-order` 被破坏）会让 lane 永不闭合，5 万行退化成 **3,982 ms**（对比 76.7 ms）。回收条件（满足任一）：①`lane.idle ≥ RECLAIM_ROWS (200)` **且** 活跃 lane 数 > `SOFT_LANE_CAP (200)`；②该 lane 的 `next` 不在已加载窗口内（浅克隆底部/页边界）→ 页末释放，下一页若出现该父提交按 R3 重开 lane（视觉断线，可接受）。

> 契约是**无条件**"连续 200 行未推进即释放"。无条件执行会切断健康的长寿分支（`--date-order` 下父提交晚数千行出现是正常的），故限定为"成本护栏"。见 §12 #7。`stats.reclaimed > 0` 时显示 chip「部分泳道因拓扑异常被截断」，不弹框。

### 3.6 `segments` 压缩规则

| 规则 | 内容 |
|---|---|
| S1 直通合并 | 同一 lane 同时被 `merge` 与 `passthrough` 覆盖时只留 `merge`；`passthrough` 去重键 `(from,to)` |
| S2 排序 | 先 `merge`/`fork`（按 `to` 升序），后 `passthrough`（按 lane 升序）→ 同一份 commits 产生逐字节相同 JSON（缓存可比对） |
| S3 单行上限 | `segments.length ≤ MAX_SEG (12)`；超出从最大 lane 开始丢 `passthrough`，仍超则把最外圈 `fork`/`merge` 降级为同 lane `passthrough`（保方向丢曲率） |
| S4 统计 | 发生 S3 第二档的行计入 `stats.degradedRows` |

### 3.7 复杂度与实测

`O(C × L)`，`L` = **当前行活跃 lane 数**（不是分支总数）。实测（macOS 27.0.1 / git 2.54.0 / Node 24.22.1，见 `research/git-graph.md` §4.2）：1 万/40 分支（10 lane）1.8 ms；1 万/400（172）3.6 ms；5 万/40（41）5.2 ms；**5 万/400（425）76.7 ms**；病态 5 万（≈10,000 lane）**3,982 ms** → 必须回收。

### 3.8 `tailState` 快照

可 `structuredClone` 的纯数据：`{lanes:[{lane,color,next,idle}], free:number[], nextColor:number, maxLane:number}`。425 lane × ~80 B ≈ 34 KB/页，8 页 ≈ 272 KB。

## 4. wire 行 → SVG

### 4.1 坐标常量

| 常量 | 值 | 说明 |
|---|---|---|
| `ROW_H` | 28 | 固定行高（虚拟滚动前提），即 `GRAPH_LOG_ROW` |
| `COL_W` | 12 | 泳道列宽 |
| `x(lane)` | `6 + 12 × min(lane, 15)` | lane 0 中心 6px，clamp 到 15 列 |
| `DOT_R` | 4.5 | 圆点半径 |
| `STROKE_W` | 1.5 | 线宽 |
| `K_IN` / `K_OUT` | 6 / 8 | `merge` / `fork` 的贝塞尔纵向控制点偏移 |
| `GRAPH_W` / `MAX_LANES_RENDER` | 192 / 16 | `16 × 12`，正常态列宽；lane 超出按 16 列 clamp |

### 4.2 path 生成

```ts
const x = (lane: number) => 6 + 12 * Math.min(lane, MAX_LANES_RENDER - 1)

export function segmentPath(seg: GraphSegment): string {
  const [a, b] = [x(seg.from), x(seg.to)]
  if (seg.kind === 'passthrough') return `M ${a} 0 V 28`
  if (seg.kind === 'merge') {                    // 从上方 lane 扎进圆点；同 lane 时是竖线
    return a === b ? `M ${a} 0 V 14` : `M ${a} 0 C ${a} ${K_IN} ${b} ${14 - K_IN} ${b} 14`
  }
  return a === b ? `M ${a} 14 V 28` : `M ${a} 14 C ${a} ${14 + K_OUT} ${b} ${28 - K_OUT} ${b} 28`
}
```

曲率差异的用途：`merge` 用 `K_IN=6`（更陡，像"扎进"圆点）、`fork` 用 `K_OUT=8`（更缓，像"从圆点展开"）。两者控制点都落在 `(0,28)` 内 → 不越行带边界 → **逐行裁剪天然成立**（§5.2）。跨 3 列以上的 `merge` 用单段三次贝塞尔，会横穿其它 lane 竖线，与 SourceGit 表现一致，不做避让。

### 4.3 圆点

| 提交类型 | 画法 |
|---|---|
| 普通 | `<circle r="4.5" class="wid-lane-fill wid-lane-{color}">` |
| 合并（`parents.length > 1`） | 实心 `r=4.5` + 外环 `r=7 stroke-width=1.5 opacity=.45` |
| HEAD | `r=4.5` + 外环 `r=7.5 stroke=var(--dsw-alias-label-primary)` |
| Changes 伪行 | `r=4.5 fill=none stroke-dasharray="2 2"` |

### 4.4 行组件

```tsx
export const CommitRow = React.memo(function CommitRow({ index, top, row, active }: RowProps) {
  const selected = useGraphStore((s) => s.selectedHash === row.hash)
  return (
    <div role="option" id={`wid-graph-row-${index}`} aria-selected={selected} aria-posinset={index + 1}
      aria-setsize={totalRows} aria-label={rowLabel(row, index, totalRows)} data-lane={row.lane}
      className="wid-graph-row" style={{ position: 'absolute', top, height: ROW_H, width: '100%' }}
      onClick={() => select(row.hash)} onDoubleClick={() => openCommitDiff(row.hash)}>
      <svg className="wid-graph-lane" width={GRAPH_W} height={ROW_H} aria-hidden="true">
        {row.segments.map((seg, i) => <path key={i} d={segmentPath(seg)} className={`wid-lane wid-lane-${row.color & 7}`}
          fill="none" strokeWidth={STROKE_W} data-active={active} />)}
        <circle cx={x(row.lane)} cy={14} r={DOT_R} className={`wid-lane-fill wid-lane-${row.color & 7}`} />
      </svg>
    </div>
  )
})
```

### 4.5 为什么传 `color` 索引而不是色值

| 理由 | 说明 |
|---|---|
| 主题切换 | 明暗两态要在**不重取数据**下换色：索引 → CSS 变量，`data-ds-dark-theme` 一变全生效 |
| 体积 | 2000 行 × 索引（1–2 B）vs × 色值（7 B），一页省 ~10 KB |
| 静态检查 | `frontend/**` 禁 `#hex`/`rgb(` 字面量；色值只能来自 token |
| 对比度治理 | 8 槽在一处保证 ≥3:1（§11），不必逐处审计 |

一个 `color-mix()` 声明同时满足明暗两态（浅色主题 `label-primary` 近黑 → 混出深色，深色主题近白 → 混出亮色）：

```css
/* 8 槽依次 business/success/warn/error/done/idle/link/label-secondary，比例 68%（第 8 槽 82%）；lane-1..6 同形 */
.dsw-wid-graph { --wid-lane-0: color-mix(in srgb, var(--dsw-alias-state-business-primary) 68%, var(--dsw-alias-label-primary)); }
```

## 5. 虚拟滚动与连线裁剪

### 5.1 `@tanstack/react-virtual` 配置

| 项 | 值 | 理由 |
|---|---|---|
| `count` | `commits.length + 1`（Changes 行） | |
| `estimateSize` | `() => 28` | 固定行高，无需测量 |
| `overscan` | **8**（224 px） | 快速滚动白屏 ≤1 帧；再多是浪费 |
| `getItemKey` | `i === 0 ? 'changes' : rows[i-1].hash` | 用 hash 做 key，前缀保留时行不重挂载 |
| 视口 | 面板默认高 640 px → 23 行；渲染上限 23 + 2×8 = **39 行** | |

```tsx
const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_H, overscan: 8, getItemKey: (i) => (i === 0 ? 'changes' : rows[i - 1]!.hash) })
```
**单滚动容器**：图列与表格共用同一个 `overflow-y:auto`（`display:grid; grid-template-columns:192px 1fr`），避免两列滚动不同步；行绝对定位在 `totalSize` 高的 spacer 里。

### 5.2 跨行裁剪：竖直 run 合并

行带模型让每条 path 都落在自己行内，**只剩两个跨行问题**：①同 lane 连续 `passthrough` 会有 28 px 接缝（1.5 px 描边在抗锯齿下可见明暗差）；②不合并则 path 数 = 行数 × 段数。渲染前先合并竖直 run：

```ts
type VertRun = { lane: number; color: number; y0: number; y1: number }

export function coalesceRuns(rows: GraphRow[], from: number, to: number): VertRun[] {
  const open = new Int32Array(MAX_LANES_RENDER).fill(-1)   // lane → out 下标
  const out: VertRun[] = []
  for (let i = from; i <= to; i += 1) {
    const row = rows[i]!, touched = new Uint8Array(MAX_LANES_RENDER)
    for (const seg of row.segments) {
      if (seg.kind !== 'passthrough' || seg.from !== seg.to) continue
      const lane = Math.min(seg.from, MAX_LANES_RENDER - 1); touched[lane] = 1
      const top = i * ROW_H, idx = open[lane]!
      if (idx >= 0 && out[idx]!.y1 === top) out[idx]!.y1 = top + ROW_H        // 续接上一行
      else { open[lane] = out.length; out.push({ lane, color: row.color, y0: top, y1: top + ROW_H }) }
    }
    for (let lane = 0; lane < MAX_LANES_RENDER; lane += 1) if (!touched[lane]) open[lane] = -1
  }
  return out
}
```

| 项 | 值 |
|---|---|
| 复杂度 | `O(V × (S + L))` = 39 × (12 + 16) ≈ 1.1k 次操作/帧 |
| 输出规模 | run ≤ 16（每 lane 一个）+ `merge`/`fork` ≤ 2/行 → 39 行约 **94** 条 path（不合并约 250） |
| 裁剪方式 | `from`/`to` 由虚拟区间给出，越界部分**根本不生成**；首尾半个行由容器 `overflow:hidden` 裁掉，**不做 path 求交** |

> 取舍：若将来改成 SourceGit 式"0→N 长 polyline"就必须实现按 y 的贝塞尔求交裁剪；本设计用行带模型换取零求交。

### 5.3 滚动锚点恢复

| 时机 | 行为 |
|---|---|
| 记录 | 卸载/切视图/进过滤态时取首可见项 `{hash: rows[idx]?.hash ?? null, offsetInRow: scrollTop - idx*28, scrollTop}` |
| 恢复（命中） | `useLayoutEffect` 里 `scrollTop = idx' * 28 + offsetInRow`（`idx'` 由 `indexByHash` 查），首帧前完成，无跳动 |
| 恢复（未命中且 `hasMore`） | 依次预取，最多 5 页；仍未命中 → `scrollTop` clamp 到 `[0, totalSize - clientHeight]` |
| 选中项 | 按 hash 恢复；不存在（被过滤/重取）→ 选中首行；空列表清锚点 |

## 6. 交互

| 操作 | 行为 |
|---|---|
| 单击行 | 选中 + 右侧详情：`git.commit({hash})`，同 hash 300 ms 内不重发，最近 20 个结果 LRU |
| 双击行 | 编辑器区打开该提交 diff：`git.diff({target:{kind:'commit', hash}})`，只读标签 |
| hover 行 | 高亮同泳道：`hoverLane = row.lane`，CSS `[data-hover-lane="3"] .wid-lane:not(.wid-lane-3){opacity:.3}` |
| 距底 400 行 | 预取下一页（§2.1） |
| 拖拽分隔条 | 图列宽三档：192 / 96 / 24（过滤态固定 24，§8.3） |
| 右键 | 上下文菜单（§6.2） |

### 6.1 键盘

| 键 | 行为 |
|---|---|
| `↑` / `↓` | 选中 ∓1 行（边界不循环）+ `scrollToIndex(align:'auto')` |
| `PageUp` / `PageDown` | ∓ **22** 行（可见 23 − 1） |
| `Home` / `End` | 首行 / 末个已加载行（`End` 且 `hasMore` 先拉下一页） |
| `Enter` | 等价双击（打开 diff） |
| `Space` | 只选中并滚入可视区，不打开 |
| `Cmd/Ctrl+C` | 复制 `shortHash`；无选中时 `aria-disabled` |
| `Escape` | 清选中 + 关菜单 |

容器 `role="listbox"` + `tabIndex={0}` + `aria-activedescendant="wid-graph-row-<i>"`；虚拟列表必须手写 `aria-posinset`/`aria-setsize`，否则 SR 报「1 of 1」。

### 6.2 右键菜单

| 项 | 动作 | 阶段 | 前置 |
|---|---|---|---|
| Checkout 此提交 | `git.checkout({ref: hash, detach: true})` | P0 | trusted；脏工作区先确认；对话框写明"分离 HEAD" |
| 复制完整哈希 / 复制提交信息 | 剪贴板 | P0 | — |
| 创建分支… | `git.branch({action:'create', name, startPoint: hash})` | **P1** | trusted；`git check-ref-format` 实时校验名字 |
| 创建标签… | `git.tag({action:'create', name, target: hash})` | **P1** | trusted |
| 在终端中执行 | **不做** | — | 违反"不自动执行命令"（security.md §7.1） |

自建 `position:absolute` + `role="menu"`（`↑↓/Enter/Esc`），不引第三方库。

### 6.3 refs 徽章视觉层级

| 层级 | 类型 | 样式 | token |
|---|---|---|---|
| 1 | `head` | 实心胶囊 + HEAD 图标 | 背景 `--dsw-alias-brand-primary`，字 `--dsw-alias-label-primary-foreground` |
| 2 | `branch` | 描边胶囊 | 边/字 `--dsw-alias-state-business-primary` |
| 3 | `remote` | 描边胶囊（无图标） | `--dsw-alias-label-tertiary` |
| 4 | `tag` | 小圆角标签 + `#` | `--dsw-alias-state-warn-label` |

排序 = 层级升序 + 同级按名字；最多显示 3 个，其余 `+N`（tooltip 列全）；名字截断 ≤24 字；徽章不是交互元素（不拦行的点击）。

## 7. 未提交的虚拟行（Changes）

数据由 `git.status` 派生（**不是** `git.graph` 的行）：`staged`/`working`/`untracked`/`conflicts` 四组计数 + `operation`（非 `none` 时整行加 `MERGING`/`REBASING` 标签）+ 合计文案固定「共 N 项变更」（**不是文件数**：同一文件可同时在 staged 与 working，契约明确不去重）。

- 列表 index 0；图列在 `rows[0]?.lane ?? 0` 列画虚线圈，向下 1 px 虚线直通第 1 行顶边（同 lane，不画弯线）。
- 选中 → 详情面板显示变更摘要：四组各列前 5 条（`Change.path` + 状态字母 + 重命名箭头），超出显示「还有 N 个」；「查看全部」只切左栏 SCM 面板的可见性，不改其选中项。

### 7.1 与 SCM 面板的联动：**不联动**

| 理由 | 说明 |
|---|---|
| 滚动打架 | SCM 选中 → 图谱滚动定位 → 又触发选中同步；两处 `scrollIntoView` 互相打断 |
| 无对应目标 | 图谱只有 1 行 Changes，SCM 可能 5000 个文件 → 多对一，定位语义不成立 |
| 语义不同 | 图谱定位单位是**提交**；用文件定位提交要 `git log --follow -- <path>`（额外子进程 + 语义模糊） |
| 已有路径 | 从提交看文件走"详情 → 文件列表 → 单文件 diff"，不需要经过 SCM |

只允许三条联动：①`git.status.seq` 变化 → 只刷新 Changes 行计数与徽章，**不滚动、不改选中**；②`git.commitCreate` 成功 → 重取 page 0 顶部插入新行并选中（用户主动操作，`scrollTop=0`）；③切分支/checkout 成功 → 清行窗口，锚点重置为 HEAD。

## 8. 搜索与过滤

| 项 | 值 |
|---|---|
| 动作 | `git.log({ search:{query, mode}, maxCount:2000 })`（`git.graph` 无 `search`，§12 #1） |
| 模式 | `message` → `--grep`；`author` → `--author`；`hash` → **不发请求**，客户端对已加载行做前缀匹配（提示「仅在已加载的 1 万条中搜索」） |
| 字面量 | 必须加 `--fixed-strings`（`--grep` 默认正则，`[` 会 `E_GIT_FAILED`）+ `--regexp-ignore-case` |
| 防抖 | 250 ms；`query.length < 2` 不搜，清空即退出过滤 |
| 上限 | `limits.searchMaxResults` 2000；`hasMore` → 「继续加载」按钮，不自动无限滚动 |

### 8.1 过滤只影响列表，不影响布局

布局按 `(refs, path)` 全量算，过滤只换"显示哪些 hash"。若按过滤结果重算布局，行号会随输入漂移（选中行、滚动锚点、lane 颜色全乱），且每次按键都要 ~77 ms 级布局 → 输入卡顿。结论与 `research/git-graph.md` §5.3 一致。

### 8.2 过滤态下的图列

| 项 | 正常态 | 过滤态 |
|---|---|---|
| 列宽 | 192 px | **24 px** |
| 连线 | 全部 `segments` | **全部隐藏** |
| 圆点 x | `6 + 12 × lane` | 固定 12 |
| 圆点颜色 | `row.color`（该 hash 在已加载布局窗口内时） | 不在窗口内 → `hashColor(hash) = parseInt(hash.slice(0,2),16) & 7`（跨会话稳定） |
| 行高 | 28 | 28（不变，虚拟滚动 key 不变） |

### 8.3 进入 / 退出

进入：保存 `ScrollAnchor` → `filterRows = git.log(search).commits` → 虚拟器 `count` 切换。退出：`filterRows = null` → 按锚点恢复（hash 仍在 → 精确；已不在 → 回顶部并保持选中）。过滤请求 `E_GIT_FAILED` → 保留原列表 + 错误条 + 输入框标红（**不要**显示空结果）。

## 9. 性能预算与实测口径

首屏 2000 行 ≤ **250 ms**（ARCHITECTURE 预算）的分解：

| 阶段 | 预算 | 依据 |
|---|---|---|
| `git log` 子进程（2000 条） | 60 ms | 45,251 条 0.22 s 线性外推 ≈10 ms + 进程启动 15–30 ms |
| 解析 + 多字符哨兵（0 坏行） | 8 ms | 45,251 条 36.1 ms |
| 布局 2000 行 | 12 ms | 5 万/400 分支 76.7 ms → 2000 行 ≈3 ms，留 4 倍余量 |
| rows+commits 序列化 / IPC | 60 ms | ≈1.1 MB JSON |
| 客户端归一 + 不变量断言 | 15 ms | |
| 首帧 39 行 SVG | 12 ms | |
| **合计** | **≈167 ms** | 余量 83 ms |

| 指标 | 预算 | 测法 |
|---|---|---|
| 滚动 | 每帧 ≤8 ms（60 fps） | DevTools Performance：`coalesceRuns` + 39 行重渲染 |
| DOM 节点 | ≤ **1200** | `document.querySelectorAll('.wid-graph *').length`（39 行 × ~19 + 表头 + 详情） |
| 已加载行 | ≤ 10000（5 页） | 超出停止预取 |
| 客户端内存 | 行 10k×~300 B ≈3 MB + commits 10k×~500 B ≈5 MB + DOM ≈6 MB | heap snapshot |
| Host 内存 | L1 ≤ 20 MB（5 万×~400 B）+ L2 8 页×2000 行×200 B ≈3.2 MB | |

## 10. 降级矩阵

| 场景 | 检测 | Host 行为 | UI 表现 |
|---|---|---|---|
| 巨大仓库（>20 万 commit） | `status.isHuge` 或连续 100 页仍有 `hasMore` | `maxCount` 降 1000，已加载上限 4000，停自动刷新 | banner「巨大仓库：仅加载最近 4000 条，自动刷新已停用」+ 手动刷新 |
| `--all` 失败（坏 ref / 权限） | `E_GIT_FAILED` 且 argv 含 `--all` | 自动改用 `refs:[当前分支]` 重试一次 | 错误条「无法列出全部分支，已只显示当前分支」+ 重试 |
| 浅克隆 | `git rev-parse --is-shallow-repository` | 照常 | 底部固定行「历史被浅克隆截断（`--depth`）」；**不**执行 `unshallow` |
| replace refs | `for-each-ref refs/replace` 非空 | 照常（git 默认按 replace 解析） | chip「历史已按 replace ref 替换」+ tooltip 原 sha |
| 恶意 parent 环 / 自指 | `parents` 含自身或重复 → 丢该边；同 hash 出现两次 → 截断 | `stats.anomalies++`；累计 ≥3 或出现重复 hash 停布局 | 行内「历史异常」标记 + banner「仓库历史含异常父链，图谱已截断」；不崩溃、不死循环 |
| 泳道爆炸（活跃 >200） | 活跃 lane 计数 | 启用 §3.5 回收；>24 折到最右列 | 图列宽不变，超出列 clamp 到 15 |
| 拓扑降级（单列） | 回收后仍 >200 活跃 | 后续行统一 `lane:0` + 单条 `passthrough` | banner「拓扑异常，图谱已降级为单列」 |
| bare / worktree | `workspace.state.git.bare` / `--git-dir ≠ .git` | 图谱照常（log 不需工作区） | Changes 行隐藏；SCM 显示「bare 仓库无工作区」 |

## 11. 可访问性

| 项 | 规格 |
|---|---|
| 焦点 | 容器 `tabIndex={0}`；焦点环 `outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: -2px` |
| 结构 | `role="listbox"` + 行 `role="option"` + `aria-selected` + `aria-posinset`/`aria-setsize` + 容器 `aria-activedescendant` |
| 装饰图形 | `<svg aria-hidden="true">`（连线不可读，信息由行文本承载） |
| 行 `aria-label` | `第 i+1 行，共 total 行：提交 shortHash，authorName，时间，refs，泳道 n，subject`（`refs` 如「HEAD main、分支 dev」；合并提交追加「，父提交 2 个」） |
| 播报 | `role="status"` 区域：`已加载 n 条提交，共 totalKnown 条` / `找到 n 条匹配` |
| 对比度 | 8 个泳道槽在明暗两态与 `--dsw-alias-bg-base` 对比度 **≥3:1**（WCAG 1.4.11）；正文 ≥4.5:1（`label-primary`）；选中不只靠底色，另加左侧 2 px `brand-primary` 竖条 |
| 验证 | `scripts/check-contrast.mjs`（纯 Node 算 sRGB 相对亮度，无新依赖）对两态取色断言；某槽不达标就把该槽 `color-mix` 比例提到 80/20 |
| 动效 | `prefers-reduced-motion: reduce` 下关 `scroll-behavior: smooth` 与 hover 过渡 |

## 12. 与契约的差异（已复核：5 条并入、3 条就地定案）

| # | 初版诉求 | 处置 |
|---|---|---|
| 1 | `git.graph` 无 `search` | **契约 v2 加 P1 预留字段**；语义定死为「只过滤列表与高亮，`rows` 仍全量」，故过滤时布局不会重排 |
| 2 | 无 `layoutEpoch` | **已并入契约 v2**：`layoutEpoch = sha1(repoEpoch\|refs\|path\|maxCount\|skip\|算法版本)`；与已发前缀不一致就重取，不必 10 点探测 |
| 3 | `GraphRow` 无 `degraded` | **已并入契约 v2**（可选字段，只影响读屏文案） |
| 4 | `segments.from/to` 属哪条边 | **已写进契约**：行带模型，`from/to` 是 lane 槽位而非像素；不变量「上行底边集合 = 下行顶边集合」 |
| 5 | 无 `totalKnown` | **已并入契约 v2**（与 `git.log` 对齐；`null` 时显示「已加载 n+」） |
| 6 | 布局统计（`reclaimed`/`anomalies`） | **不加字段**：只进 Host 日志 + 固定文案 chip |
| 7 | 契约「连续 200 行未推进即释放」是无条件 | **契约措辞已改**：「活跃 >200 行**或**父提交已不在已加载窗口」才释放 |
| 8 | 超 12 段后丢哪些未定义 | **已写进契约**：`merge → fork → passthrough` 次序合并，并标 `degraded` |

> §8 的搜索会引入 `--grep --fixed-strings --regexp-ignore-case`（命令变更），实现时必须同步 `docs/git-model.md` §4.4。

## 实现偏差（M0–M3 已落地，逐条给理由）

实现以 `backend/git/layout.js`（行带布局）与 `backend/git/log.js`（取数/解析）为准；下面每一条都是落地时对本文的**有意偏离**，改代码前先看这里。

| # | 本文原写法 | 实现 | 为什么 |
|---|---|---|---|
| 1 | §3.4 空槽分配器 + 邻接试色 3 次 | `color = lane % 8`（`COLOR_COUNT = 8`） | 省掉 `freeColor` / `nextColor` 两个状态字段，分页重放时颜色不会漂移；同色只要不相邻即可，`lane % 8` 已保证相邻 lane 不同色 |
| 2 | §3.7 回收条件②「父提交不在窗口即回收」 | 只在 `options.truncated === true` 时执行，`backend/git/index.js` 传 `truncated: !hasMore` | 否则**每个分页边界**都会剪断长寿分支，第 2 页开始图就断线；只有真到历史末尾才允许回收 |
| 3 | §3.6 超 12 段时最外圈 fork/merge 退化成同 lane `passthrough` | 退化成**同 kind 的竖直段**（`merge(x,x)` / `fork(x,x)`） | 改 kind 会把端点从单边挪到双边，直接破坏不变量「上行底边集合 = 下行顶边集合」；仍超限才丢段并置 `degraded: true` |
| 4 | （未规定）单行父提交数量 | 新增 `HARD_LANE_CAP = 1000`：单行父边超过 1000 条折成单列降级 | octopus merge / 伪造历史能让单行段数爆炸；正常历史到不了这个量 |
| 5 | §3.8 `maxLane` 随行更新 | `maxLane` 是**只增水位**，进入单列模式后也不回落 | 前面的行确实用到过高 lane 号，回落会把画布宽度算小、裁掉早先的列 |
| 6 | §3.8 lane state 含颜色分配字段 | `{ lanes, freeLanes, nextLane, maxLane, collapsed }`，无颜色字段 | 见 #1；该对象可 `structuredClone`，能原样作为 `options.state` 传回续算 |
| 7 | §1.2 #7 `git log` argv | 额外加 `-c i18n.logOutputEncoding=UTF-8`、`--decorate=short` | 用户配置 `log.decorate=full` 会把 `%D` 污染成 `refs/heads/main`；编码不钉住会随仓库 locale 漂 |
| 8 | §4.4 `refs` 模型里 `head` 是对象 | Host 内部 `refs.head` 是 `string \| null` + `refs.headDetached: boolean`，扁平化由 `backend/git/index.js` 的 `toWireCommit` 负责 | 解析层只认识字符串，避免在 Host 内部两处各存一份「当前分支」真值 |

落地实测（`/tmp/wid-check`，真仓库 5345 提交 + 合成宽拓扑）：5000 提交布局中位 3.4ms / 最大 4.5ms；150 并发 lane × 5000 行 56.2ms；真实 300 分支 23.5ms（`reclaimed=150`）；octopus（单提交 1500 父）`folded=500` 后转单列。`git log --all --date-order` 顺序与 `hasMore` 探测逐条一致。
