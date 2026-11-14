/**
 * 提交图谱布局（git.graph 的 Host 侧一半）：把按 `--date-order` 排好的提交序列变成行带（rows）。
 *
 * 这个模块负责什么：
 * - `layoutGraph(commits, options)`：提交数组进 → `{ rows, maxLane, layoutEpoch }` 出；
 *   每行给 `{ hash, lane, color, segments, degraded? }`，`segments` 用的是 **lane 槽位**而不是像素；
 * - 纯同步、无 IO：不读文件、不 spawn、不看时钟。要拼 epoch 只用传入的字符串。
 *
 * 为什么这样切：
 * - **布局留在 Host**（AGENTS.md → 图谱）：客户端只做可视区间切片 + SVG 生成，wire 只传 lane 槽位。
 *   槽位是整数、与主题无关，客户端换主题/改缩放都不用重算布局；像素坐标进 wire 会让每次
 *   resize 都变成一次 Host 往返。
 * - **行带而不是折线**：每行只描述"本行底边与下一行顶边如何接上"，不变量
 *   `bottom(row i) === top(row i+1)` 就从一个全局算法问题变成逐行的局部约束，
 *   分页追加时只要把上一页的 tailState 接上就能保证前缀不变（docs/graph.md §2.3）。
 * - **不变量按几何收紧**：`merge` 只画到 mid(14)、`fork` 从 mid 起（docs/graph.md §4.2），
 *   所以 merge 不进底边、fork 不进顶边。于是：
 *     顶边 = { passthrough.from } ∪ { merge.from }
 *     底边 = { passthrough.to }   ∪ { fork.to }
 *   这个定义让"圆点所在 lane 有没有入线/出线"也必须发段：
 *     - 圆点所在 lane 上一行就在等它 → 发 `passthrough(d,d)`（顶边收线）；
 *     - 圆点是本行新开的 lane → 发 `fork(d,d)`（只画下半段竖线）；
 *     - root（无父提交）且圆点原本在等 → 发 `merge(d,d)`（顶边收进圆点，底边不出线）；
 *     - 悬空 lane 被回收 → 发 `merge(L→d)`（从底边斜进圆点，不留悬空尾巴）。
 *   漏掉这几条"看起来多余的"段，跨行不变量就会在 root / 回收行上破掉。
 *
 * 移植来源与许可：
 * Ported from git-graph-plus/src/git/git-graph-builder.ts
 * Copyright (c) the0807 — Licensed under the Apache License, Version 2.0
 * https://github.com/the0807/git-graph-plus/blob/main/LICENSE
 * 修改说明：原文输出像素坐标 polyline；本文件输出稳定 lane 槽位 + 每行 segments（行带模型），
 *           并把 lane 复用/回收策略改成"按活跃数触发 + 有界悬空"，以便分页重放与 5 万提交量级。
 *
 * 与 docs/graph.md 的差异（逐条原因见各函数注释末尾「差异」小节，改这里要同步 docs/graph.md）：
 * 1. 配色用 `lane % 8` 而不是文档 §3.4 的空槽分配器；
 * 2. 回收条件 ②（父提交不在已加载窗口）由 `options.truncated` 显式开启；
 * 3. 单行超 12 段时不再"降级为同 lane passthrough"，而是同 kind 竖直段 + 必要时丢段标 degraded；
 * 4. 文档的「回收后仍 >200 → 单列」是唯一降级开关，另加 `HARD_LANE_CAP` 兜底单行父提交爆炸
 *    （octopus / 伪造历史）：活性表被撑到 1000 时把该父边折到最右 lane，下一行转单列。
 */

import { createHash } from 'node:crypto';
import { ideError } from '../../shared/errors.js';

/** 布局算法版本：算法语义一变就加一，进 layoutEpoch，客户端缓存据此失效。 */
export const LAYOUT_VERSION = 1;

/** 单行 segments 上限（wire 与 SVG 都按这个值预留）。 */
export const MAX_SEG = 12;

/** 泳道配色槽数（客户端映射到主题 token 索引，不传色值）。 */
export const COLOR_COUNT = 8;

/** 一条悬空 lane 空转多少行后可回收（仅在活跃 lane 超软上限时生效）。 */
export const RECLAIM_ROWS = 200;

/** 活跃 lane 软上限：超过它才开始按 idle 回收（documents §3.5 条件 ①）。 */
export const SOFT_LANE_CAP = 200;

/** 活跃 lane 硬上限：到了就整体降级为单列，保证内存与 wire 体积有界。 */
export const HARD_LANE_CAP = 1000;

/** 分页追加时窗口尾部重放行数（docs/graph.md §2.3 的 TAIL_ROWS）。 */
export const TAIL_ROWS = 200;

/** 拓扑异常累计到多少行就降级为单列（docs/graph.md §10）。 */
const ANOMALY_LIMIT = 3;

/** 排序用的 kind 次序（S2：merge 在 fork 前，最后按 from 稳定）。 */
const KIND_RANK = { merge: 0, fork: 1, passthrough: 2 };

/**
 * 单行布局用到的计数器（`layoutRow` 单独使用时不需要完整的 stats 对象）。
 *
 * @param {object} [target] - 已有的 stats 对象（存在则原地返回）
 * @returns {{ reclaimed: number, folded: number, degradedRows: number }}
 */
function makeRowStats(target) {
  const base = target && typeof target === 'object' ? target : {};
  if (!Number.isInteger(base.reclaimed)) base.reclaimed = 0;
  if (!Number.isInteger(base.folded)) base.folded = 0;
  if (!Number.isInteger(base.degradedRows)) base.degradedRows = 0;
  return base;
}

/**
 * 空的行带状态（一份可直接 structuredClone 的普通数据）。
 *
 * 与 docs/graph.md §3.8 的 tailState 相比：这里没有 `free` / `nextColor` 两个字段
 * （配色不再需要分配器，见 `colorOf`），多了 `freeLanes` / `nextLane` / `collapsed`。
 *
 * @returns {{ lanes: Array<{lane:number,next:string|null,idle:number}>, freeLanes: number[], nextLane: number, maxLane: number, collapsed: boolean }}
 */
export function emptyLaneState() {
  return { lanes: [], freeLanes: [], nextLane: 0, maxLane: 0, collapsed: false };
}

/**
 * 深拷贝一份状态：`layoutGraph` 是纯函数，绝不改调用方传进来的 tailState；
 * 输出里的 `state` 也是新对象，便于调用方直接 structuredClone 或跨页持有。
 *
 * @param {object} state
 * @returns {object} 新状态对象
 */
export function cloneLaneState(state) {
  const source = state && typeof state === 'object' ? state : {};
  return {
    lanes: Array.isArray(source.lanes)
      ? source.lanes.map((lane) => ({ lane: lane.lane, next: lane.next ?? null, idle: lane.idle ?? 0 }))
      : [],
    freeLanes: Array.isArray(source.freeLanes) ? [...source.freeLanes].sort((a, b) => a - b) : [],
    nextLane: Number.isInteger(source.nextLane) ? source.nextLane : 0,
    maxLane: Number.isInteger(source.maxLane) ? source.maxLane : 0,
    collapsed: source.collapsed === true,
  };
}

/**
 * 泳道配色：直接由 lane 号取模。
 *
 * 差异（vs docs/graph.md §3.4 的空槽分配器）：文档是"回收池优先 + 邻接不撞色最多试 3 次 + FIFO"。
 * 这里改成 `lane % 8`，原因三条：
 * 1. 相邻两个 lane 取模后必然不同色，"邻接不撞色"变成恒等式，不需要试探；
 * 2. 分页追加/尾部重放时颜色不会漂移——分配器一旦跨页带状态，重放段和已发前缀就可能不同色；
 * 3. 少一份跨页状态，tailState 里不用再带 `free` / `nextColor`（§3.8 少两个字段）。
 * 代价是同一分支在换 lane 后可能换色（复用最小空闲号时更明显），可接受。
 *
 * @param {number} lane
 * @returns {number} 0..COLOR_COUNT-1
 */
export function colorOf(lane) {
  return ((lane % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT;
}

/**
 * 布局一页提交。
 *
 * @param {Array<{hash:string, parents?:string[], graphNote?:string}>} commits - 已按 `--date-order` 排好
 * @param {object} [options]
 * @param {object} [options.state] - 上一页的 tailState（`layoutGraph` 输出里的 `state`），深拷贝后使用
 * @param {boolean} [options.truncated] - 本窗口之后没有更多已知提交（浅克隆底部 / L1 被截断）时传 true，
 *   页末才会回收"父提交不在窗口内"的悬空 lane；默认 false = 分页追加，页边界保持连续
 * @param {string} [options.repoEpoch] - 仓库 epoch（由调用方按 worktree/branch 变化生成）
 * @param {'all'|string[]} [options.refs] - 本次取数用的 ref 选择，仅参与 layoutEpoch
 * @param {string} [options.path] - 路径过滤，仅参与 layoutEpoch
 * @param {number} [options.maxCount] - 本次页大小，仅参与 layoutEpoch
 * @param {number} [options.skip] - 本次页起点，仅参与 layoutEpoch
 * @returns {{ rows: Array<object>, maxLane: number, layoutEpoch: string, state: object, stats: object }}
 */
export function layoutGraph(commits, options = {}) {
  if (!Array.isArray(commits)) {
    throw ideError('E_INVALID_ARG', 'commits 必须是数组', { field: 'commits' });
  }

  const state = cloneLaneState(options.state);
  const rows = new Array(commits.length);
  const stats = {
    reclaimed: 0, // 被回收的悬空 lane 数
    folded: 0, // 因硬上限折叠掉的父边数
    degradedRows: 0, // 被压缩/折叠过的行数
    anomalies: 0, // 拓扑异常行数（自指/重复父、重复 hash、上游 graphNote）
    collapsed: false, // 是否降级为单列
    notes: [], // 去重后的人类可读告警（只进 Host 日志/chip，不进 wire）
  };
  const seenHashes = new Set();
  let singleColumn = false;

  const note = (text) => {
    if (!stats.notes.includes(text)) stats.notes.push(text);
  };

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (!commit || typeof commit !== 'object' || typeof commit.hash !== 'string' || commit.hash === '') {
      throw ideError('E_INVALID_ARG', '提交缺少 hash', { field: `commits[${index}].hash` });
    }

    const parents = normalizeParents(commit, index);
    let rowAnomaly = parents.dropped > 0;
    if (commit.graphNote) {
      rowAnomaly = true;
      note(commit.graphNote);
    }
    // 同 hash 出现两次只可能是历史被改写或伪造：继续布局会画出假边，直接单列降级。
    if (seenHashes.has(commit.hash)) {
      rowAnomaly = true;
      singleColumn = true;
      note('duplicate-hash');
    }
    seenHashes.add(commit.hash);
    if (rowAnomaly) stats.anomalies += 1;
    if (stats.anomalies >= ANOMALY_LIMIT) {
      singleColumn = true;
      note('anomaly-limit');
    }

    if (singleColumn || state.collapsed) {
      rows[index] = collapsedRow(commit.hash, parents.list, state);
    } else {
      rows[index] = layoutRow({ hash: commit.hash, parents: parents.list }, state, stats);
    }
    // 泳道爆炸被折叠成单列时留一条告警（Hard cap 在 layoutRow 里触发，告警在这里补）。
    if (state.collapsed && !stats.collapsed) {
      stats.collapsed = true;
      note('collapsed-single-column');
    }
  }

  // 页末回收条件 ②：父提交不在已加载窗口（只有调用方明确说"后面没数据了"才做）。
  if (options.truncated === true) {
    const survivors = [];
    for (const lane of state.lanes) {
      if (lane.next !== null && seenHashes.has(lane.next)) survivors.push(lane);
      else stats.reclaimed += 1;
    }
    state.lanes = survivors;
  }

  return {
    rows,
    // maxLane 取状态水位：追加页不会让图列宽回缩（首页即为本页最大 lane 号）。
    maxLane: state.maxLane,
    layoutEpoch: computeLayoutEpoch(options),
    state: cloneLaneState(state),
    stats,
  };
}

/**
 * 布局单行（供追加页重放用；**就地修改 state**）。
 *
 * 与文档 §3.1 的 `layoutRow(commit, state)` 同形：提交对象进、行带出，状态走参数。
 *
 * @param {{ hash: string, parents?: string[] }} commit - 已归一化父提交的提交对象
 * @param {object} state - 行带状态（会被就地修改）
 * @param {object|null} [stats] - 统计累加器；单行调用可不传
 * @returns {object} GraphRow
 */
export function layoutRow(commit, state, stats = null) {
  const counters = stats ?? makeRowStats();
  const { hash } = commit;
  const parents = Array.isArray(commit.parents) ? commit.parents : [];
  const segments = [];
  const spawned = new Set(); // 本行新建的 lane：已经有 fork 入线，不再发 passthrough

  // R1：lane 升序里第一个在等本提交的 lane 当主线（lanes 始终按号码升序）
  let major = null;
  const waiters = [];
  for (const lane of state.lanes) {
    if (lane.next !== hash) continue;
    if (major === null) major = lane;
    else waiters.push(lane);
  }

  const isNewLane = major === null;
  if (isNewLane) {
    major = acquireLane(state);
    spawned.add(major.lane);
  } else {
    major.idle = 0;
  }
  const dotLane = major.lane;

  // R2：其余等待者各发一条 merge 并入圆点后释放（它们在本行底边消失）
  for (const waiter of waiters) {
    segments.push({ from: waiter.lane, to: dotLane, kind: 'merge' });
    releaseLane(state, waiter);
  }

  // R4：第一父（主线继续）
  if (parents.length === 0) {
    // root：本行没有出线。圆点原本在等它时，用同 lane 的 merge 把顶边收进圆点，底边留空。
    if (!isNewLane) segments.push({ from: dotLane, to: dotLane, kind: 'merge' });
    releaseLane(state, major);
    major = null;
  } else {
    major.next = parents[0];
    major.idle = 0;
    segments.push(
      isNewLane
        ? { from: dotLane, to: dotLane, kind: 'fork' } // 新 lane：只画 mid→bottom
        : { from: dotLane, to: dotLane, kind: 'passthrough' }, // 原本就在等：顶边→底边整段
    );
  }

  // R5：第 2+ 父（分叉出去）
  for (let index = 1; index < parents.length; index += 1) {
    const parentHash = parents[index];
    let target = findWaitingLane(state, parentHash);
    if (target === null) {
      if (state.lanes.length >= HARD_LANE_CAP) {
        // 兜底（正常历史到不了）：一行里父提交太多（octopus / 伪造），活性表被撑爆，
        // 把这条父边折到最右 lane（端点仍存在，故不变量不破），下一行转单列。
        const rightmost = state.lanes[state.lanes.length - 1];
        if (rightmost && rightmost.lane !== dotLane) {
          segments.push({ from: dotLane, to: rightmost.lane, kind: 'fork' });
        }
        counters.folded += 1;
        // 下一行会整体降级为单列（本行仍按原样收尾，避免半行两套模型）
        state.collapsed = true;
        continue;
      }
      target = acquireLane(state);
      target.next = parentHash;
      spawned.add(target.lane);
    }
    segments.push({ from: dotLane, to: target.lane, kind: 'fork' });
  }

  // R6：其余活跃 lane 原样穿行；活跃数超软上限时顺手回收闲置太久的悬空 lane
  const reclaiming = state.lanes.length > SOFT_LANE_CAP;
  const releasing = [];
  for (const lane of state.lanes) {
    if (lane === major || spawned.has(lane.lane)) continue;
    lane.idle += 1;
    if (reclaiming && lane.idle >= RECLAIM_ROWS) {
      // 回收：斜着钻进圆点后释放，底边不留悬空尾巴（否则下一页还会接着画一条死线）
      segments.push({ from: lane.lane, to: dotLane, kind: 'merge' });
      releasing.push(lane);
      counters.reclaimed += 1;
      continue;
    }
    segments.push({ from: lane.lane, to: lane.lane, kind: 'passthrough' });
  }
  for (const lane of releasing) releaseLane(state, lane);
  // docs/graph.md §10：回收之后活跃 lane 仍超软上限，就不该继续画分叉了——后续行统一单列。
  // 这一条同时给 "悬空 lane 必须有界" 兜底：活跃表不会停在 200 以上。
  if (state.lanes.length > SOFT_LANE_CAP) state.collapsed = true;

  if (dotLane > state.maxLane) state.maxLane = dotLane;

  const compressed = compressSegments(segments);
  const row = {
    hash,
    lane: dotLane,
    color: colorOf(dotLane),
    parents,
    segments: compressed.segments,
  };
  if (compressed.degraded) {
    row.degraded = true;
    counters.degradedRows += 1;
  }
  return row;
}

/**
 * 单列降级行：拓扑异常（重复 hash / 异常数量超限 / 泳道爆炸）后的兜底模型。
 *
 * 每行只有一条竖直段，永远不可能超 MAX_SEG；旧 lane 全部折进 0 号槽，保证不变量成立
 * （`merge(L→0)` 收顶边、`fork(0,0)`/`passthrough(0,0)` 出底边）。
 * 降级的告警由 `layoutGraph` 统一记一次（这里只负责把 state 切到单列）。
 *
 * @param {string} hash
 * @param {string[]} parents
 * @param {object} state
 * @param {object|null} [stats]
 * @returns {object} GraphRow（恒带 degraded）
 */
function collapsedRow(hash, parents, state, stats = null) {
  const counters = stats ?? makeRowStats();
  const segments = [];
  const hadLaneZero = state.lanes.some((lane) => lane.lane === 0);

  for (const lane of state.lanes) {
    if (lane.lane !== 0) segments.push({ from: lane.lane, to: 0, kind: 'merge' });
  }

  // 清空后重新从 0 号槽开始，lane 号不会无限增长
  state.lanes = [];
  state.freeLanes = [];
  state.nextLane = 0;
  state.collapsed = true;

  const lane = acquireLane(state);
  lane.idle = 0;
  if (parents.length > 0) {
    lane.next = parents[0];
    state.lanes.push(lane);
    segments.push(
      hadLaneZero
        ? { from: 0, to: 0, kind: 'passthrough' }
        : { from: 0, to: 0, kind: 'fork' },
    );
  } else if (hadLaneZero) {
    segments.push({ from: 0, to: 0, kind: 'merge' });
  }
  // 注意：maxLane 是只增水位，不随单列模式回落——本页前面的行确实用到过高 lane 号，
  // 客户端拿它算画布宽度，回落到 0 会把早先那些行裁掉。

  const compressed = compressSegments(segments);
  counters.degradedRows += 1;
  return {
    hash,
    lane: 0,
    color: colorOf(0),
    parents,
    segments: compressed.segments,
    degraded: true,
  };
}

/**
 * 归一化父提交：自指与重复边丢掉（docs/graph.md §10 的"丢该边 + anomalies + 1"）。
 *
 * @param {{hash:string, parents?:string[]}} commit
 * @param {number} index - 用于错误定位
 * @returns {{ list: string[], dropped: number }}
 */
function normalizeParents(commit, index) {
  const raw = commit.parents;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw ideError('E_INVALID_ARG', 'parents 必须是数组', { field: `commits[${index}].parents` });
  }
  const list = [];
  const seen = new Set();
  let dropped = 0;
  for (const parent of raw ?? []) {
    if (typeof parent !== 'string' || parent === '') continue;
    if (parent === commit.hash || seen.has(parent)) {
      dropped += 1;
      continue;
    }
    seen.add(parent);
    list.push(parent);
  }
  return { list, dropped };
}

/**
 * 单行内线段压缩与去重。
 *
 * 次序（docs/graph.md §3.6）：
 * - S1 同一 lane 既有 merge 又有 passthrough 时只留 merge（merge 已把它吸走）；
 * - S2 先 merge/fork（按 to 升序、同 to 时 merge 在 fork 前、再按 from），后 passthrough（lane 升序）
 *   —— 同一输入必须逐字节产出相同 JSON，否则客户端缓存比对会一直失败；
 * - S3 超 MAX_SEG 分三档见函数尾部注释。
 *
 * @param {Array<{from:number,to:number,kind:string}>} segments
 * @returns {{ segments: Array<{from:number,to:number,kind:string}>, degraded: boolean }}
 */
function compressSegments(segments) {
  const merges = new Map(); // from → to（同一 from 只可能有一条）
  const forks = new Map(); // to → from（同一 to 只可能有一条）
  const pass = new Set();

  for (const seg of segments) {
    if (seg.kind === 'merge') {
      if (!merges.has(seg.from)) merges.set(seg.from, seg.to);
    } else if (seg.kind === 'fork') {
      if (!forks.has(seg.to)) forks.set(seg.to, seg.from);
    } else {
      pass.add(seg.from);
    }
  }
  // S1：被 merge 吸收的 lane 不再穿行
  for (const lane of merges.keys()) pass.delete(lane);

  const head = [];
  for (const [from, to] of merges) head.push({ from, to, kind: 'merge' });
  for (const [to, from] of forks) head.push({ from, to, kind: 'fork' });
  head.sort((a, b) => a.to - b.to || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.from - b.from);

  const tail = [...pass]
    .sort((a, b) => a - b)
    .map((lane) => ({ from: lane, to: lane, kind: 'passthrough' }));

  const list = head.concat(tail);
  if (list.length <= MAX_SEG) return { segments: list, degraded: false };

  // 第一档：从最大 lane 开始丢 passthrough（列表尾部即 lane 降序尾部）。
  // 只影响"谁还继续穿行"的竖直段，端点最外侧，视觉损失最小。
  while (list.length > MAX_SEG && list[list.length - 1].kind === 'passthrough') list.pop();

  // 第二档：把剩下的 merge/fork 折成同 lane 竖直段——端点集合完全不变（不破不变量），
  // 只丢横向曲率。差异：文档 §3.6 写"降级为同 lane passthrough"，那会把端点从单边挪到双边，
  // 直接破掉"底边 == 下一行顶边"，所以这里保留 kind、只把 from/to 拉平。
  if (list.length > MAX_SEG) {
    for (const seg of list) {
      if (seg.kind === 'merge') seg.to = seg.from; // merge(x,d) → merge(x,x)
      else if (seg.kind === 'fork') seg.from = seg.to; // fork(d,x) → fork(x,x)
    }
  }

  // 第三档：仍然超出（例如一行要回收 200 条悬空 lane）。只能丢段，丢端点必然破坏该行的
  // 边集合，所以整行标 degraded，客户端遇到 degraded 行跳过不变量断言。正常仓库到不了这里。
  while (list.length > MAX_SEG) {
    let worstIndex = -1;
    let worstEndpoint = -1;
    for (let i = 0; i < list.length; i += 1) {
      const endpoint = Math.max(list[i].from, list[i].to);
      if (endpoint > worstEndpoint) {
        worstEndpoint = endpoint;
        worstIndex = i;
      }
    }
    if (worstIndex === -1) break;
    list.splice(worstIndex, 1);
  }

  return { segments: list, degraded: true };
}

/** 找正在等某个父提交的 lane（可能为空）。lanes 按号码升序，取第一个即可。 */
function findWaitingLane(state, hash) {
  for (const lane of state.lanes) {
    if (lane.next === hash) return lane;
  }
  return null;
}

/** 取一个 lane 槽：优先复用最小空闲号，否则拿新号（号码单调增长，永不回收已用最大值）。 */
function acquireLane(state) {
  const laneNumber = state.freeLanes.length > 0 ? state.freeLanes.shift() : state.nextLane;
  if (state.freeLanes.length === 0 && laneNumber >= state.nextLane) state.nextLane = laneNumber + 1;
  const lane = { lane: laneNumber, next: null, idle: 0 };
  insertSorted(state.lanes, lane, (item) => item.lane);
  if (laneNumber > state.maxLane) state.maxLane = laneNumber;
  return lane;
}

/** 释放 lane：从活跃表摘掉，号码进空闲池（升序，复用最小号），保持 lanes 升序。 */
function releaseLane(state, lane) {
  const index = state.lanes.indexOf(lane);
  if (index !== -1) state.lanes.splice(index, 1);
  lane.next = null;
  insertSorted(state.freeLanes, lane.lane, (value) => value);
}

/** 把值插进"按键升序"的数组（活跃 lane 最多几百条，二分插入足够）。 */
function insertSorted(list, value, keyOf) {
  const key = keyOf(value);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (keyOf(list[mid]) < key) low = mid + 1;
    else high = mid;
  }
  list.splice(low, 0, value);
}

/**
 * layoutEpoch：`sha1(repoEpoch | refs | path | maxCount | skip | LAYOUT_VERSION)` 的前 16 位。
 *
 * 客户端用它决定"这份图谱缓存还能不能复用"：只要 refs / 页参数 / 算法版本变过就必须重取。
 * refs 数组先排序再 join —— 同一组 ref 传进来的顺序不该影响 epoch。
 *
 * @param {object} options - `layoutGraph` 的 options
 * @returns {string} 16 位十六进制
 */
function computeLayoutEpoch(options) {
  const refsKey = Array.isArray(options.refs)
    ? [...options.refs].sort().join(',')
    : String(options.refs ?? 'all');
  const parts = [
    String(options.repoEpoch ?? ''),
    refsKey,
    String(options.path ?? ''),
    String(options.maxCount ?? 0),
    String(options.skip ?? 0),
    String(LAYOUT_VERSION),
  ];
  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}
