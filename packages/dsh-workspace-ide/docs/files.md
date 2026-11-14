# 文件树与文件通道设计

> 分层见 [ARCHITECTURE.md](../ARCHITECTURE.md)、[AGENTS.md](../AGENTS.md)：`frontend/views/files/`（树、行内输入、搜索面板的 DOM/虚拟滚动绑定）+ `frontend/stores/{tree,editor,search}.{stores,datasource}.ts` + `frontend/service/{path,sort,tree}.js`（纯函数）；「点击文件 → 打开编辑 tab」「选中变更 → 出 diff」这类跨域编排只在 `frontend/stores/workbench.stores.ts`。编辑器侧见 [editor.md](./editor.md)，动作与字段以 [remote-contract.md](./remote-contract.md) 为准。
> 三条硬事实：**目录只列一层、不递归**；**所有路径都是工作区相对路径**（Host 才是唯一路径裁判）；**`version` 是唯一的新旧依据**（`files.*` 响应带，旧的丢弃）。

## 1. 目录树模型

### 1.1 数据结构与归属

```ts
export type NodeType = 'file' | 'directory' | 'symlink' | 'other'
export interface TreeNode {
  path: string            // 工作区相对、'/' 分隔、无前导 '/'；根目录为 ''
  name: string            // 显示名 = path 最后一段（根为 '工作区'）
  type: NodeType
  size?: number           // files.list 只对 file 给；directory 恒 undefined
  mtime?: number
  loaded: boolean         // 子项已拉过（空目录也算 loaded）
  loading: boolean        // files.list 在飞
  expanded: boolean       // 仅 directory 有意义
  error: string | null    // ErrCode，或父目录被删时的 'E_NOT_FOUND'
}
export interface DirCache { version: string; childPaths: string[]; truncated: boolean; at: number }  // 按目录缓存
```

- 树本体是 `Map<path, TreeNode>`（`frontend/stores/tree.stores.ts` 独有），**不是嵌套对象**：重命名/失效都只碰一条路径 + 父目录的 `childPaths`。
- 展开态、选中行、滚动位置同属 tree store（呈现态）；文件内容/版本属 editor store。
- `views` 只订阅 `Map` 派生的扁平可见行（§2.1），不持节点状态、不用 `useState`。

### 1.2 懒加载时序（展开一个目录）

| # | 步骤 | 调用 | 说明 |
| --- | --- | --- | --- |
| 1 | 用户点击目录 | — | 乐观 UI：`expanded = !expanded`（AGENTS 允许的四处之一），折叠不发请求 |
| 2 | 已 loaded 且未过期 | — | 直接显示缓存子项，不发请求（`at` 在 500 ms 内视为新鲜） |
| 3 | 否则标 `loading=true` | `files.list { path }` | 一次只列一层，**不递归** |
| 4 | 成功 | — | `DirCache{version, childPaths, truncated, at: Date.now()}`；为每个 entry 建/更新 `TreeNode`（保留已有 `expanded`/`loaded`，避免刷新把展开态拍平） |
| 5 | 失败 | — | `error = error.code`；行尾显示「重试」，父目录 `E_NOT_FOUND` 时整枝标灰可删 |
| 6 | `truncated === true` | — | 列表末尾插一行「仅显示前 N 项（上限 `limits.dirEntriesMax` = 5000），请用搜索」 |

并发去重：同一 path 的 `files.list` 只允许一个在飞请求（`inflight: Map<path, Promise>`），折叠再展开不重复发；`ctx.effect` disposer 里 `AbortController.abort()`（`E_CANCELLED`）。

### 1.3 子节点缓存与失效

| 触发 | 动作 |
| --- | --- |
| `files.list` 返回的 `version` 与 `DirCache.version` 相同 | 内容不变 → 只刷新 `at`，不重建 `TreeNode`（避免无谓重渲染） |
| 不同 | 以返回的 entries **为准重建该目录子项**：新增建节点、消失的从 `Map` 删除（并级联删其后代）、仍存在的保留 `expanded/loaded` |
| 本客户端写成功（`files.write`/`create`/`rename`/`delete`） | 只失效**受影响路径的父目录**，**不用** `files.list refresh:true` 全刷 |
| 未知外部变化 | 见 §4（聚焦时 `stat` 对比）与 §8（P1 `watch.poll`） |

**不做**「按 version 缓存跨会话」：version 是内容指纹，不是 revision 号，不能比较大小、不能判断「谁更新」——只能判「一样/不一样」。

### 1.4 根目录变更时整体重置

根目录只由 Host 解析（`session.cwd` 或用户在面板里选目录），客户端**永远不传绝对路径**（AGENTS「根目录只能 Host 解析」）。换根只在 `workbench.stores.ts` 一处触发（会话切换或用户显式选目录），步骤：`editor.closeAll({confirmDirty:true})` → 清空 `nodes`/`dirs`/`expanded` → 重拉根目录 `files.list {}`。**不要**把「根 version 变了」当成换根（version 只表示内容变了）。

判定「根变了」：`files.list`（无 path）返回后与上次的根 `version` 不一致 ≠ 换根；换根只能由会话切换事件或用户显式选择触发（`workbench.stores.ts` 唯一编排点），避免误清空。

### 1.5 排序与隐藏策略

Host **不排序**（契约里 `entries` 顺序未定义），排序是 `frontend/service/sort.js` 的纯函数：

```js
const rank = t => (t === 'directory' ? 0 : t === 'symlink' ? 1 : 2)
export const compareNodes = (a, b) =>
  rank(a.type) - rank(b.type) ||                                        // 目录 → symlink → 文件
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })   // main2 < main10
```

| 项 | 策略 |
| --- | --- |
| 目录优先 | 恒目录在前；symlink 单列一档（`files.list` 的 `type` 已有 `'symlink'`，不与 directory 混） |
| 大小写 | `sensitivity:'base'` 让大小写不敏感文件系统（macOS/Windows）上不出现「看起来重复的两行」；但**同名不同大小写仍要检测冲突**（§5.1、§7.4） |
| 点文件 | **显示**（`.env`/`.eslintrc` 是真实需求）；只隐藏设备噪声：`.DS_Store`、`Thumbs.db`、`desktop.ini` |
| `.git` 目录 | **隐藏**（结论见 §10）：git 元数据不是工作区内容，且列它会让 5000 项上限提前打满 |
| `node_modules` 等重目录 | 不隐藏、不过滤（P0 不做 `.gitignore`，见 §11）；靠懒加载保证不进就不列 |

## 2. 虚拟化树

### 2.1 扁平化可见行

`Map` + `expanded` 派生成一维数组（`frontend/service/tree.js`，纯函数、可单测）：

```js
export function flatten(root, nodes, dirs, expandedSet) {
  const rows = []                                   // 每项 { path, name, type, depth, hasChildren }
  const walk = (path, depth) => {
    rows.push(toRow(nodes.get(path), depth))
    const cache = dirs.get(path)
    if (!expandedSet.has(path) || !cache) return
    for (const child of cache.childPaths) walk(child, depth + 1)   // 子项已在 §1.5 排好序
  }
  walk(root.path || '', 0)
  return rows
}
```

派生缓存键 = `treeRevision`（每次 `nodes`/`dirs` 变化 +1）+ `expandedRevision`；两者都没变就不重算（`useMemo` 风格在 view 里用 `useRef` 存上次结果，**不引入 `useState`**）。

### 2.2 固定行高 + `@tanstack/react-virtual@3.14.26`

| 参数 | 值 | 理由 |
| --- | --- | --- |
| 行高 | **22 px 固定**（`--dsh-code-font-size` 12–13 px + 4 px 上下的 padding） | 固定高度才能 O(1) 算偏移；变高需要 `ResizeObserver`，10000 行必卡 |
| `estimateSize` | `() => 22` | — |
| 滚动容器 | 树视图自己的 `div`（`overflow:auto`），不是 `window` | 面板可缩放、可并排 |
| 定位 | 虚拟器给的 `transform: translateY(start)` + `position:absolute` | 只改 transform，不触发 layout |

```tsx
// frontend/views/files/TreeList.tsx（不持状态：rows 来自 store selector，ref 只放 DOM）
const rows = useTreeRows()                                  // store 派生
const scrollRef = useRef<HTMLDivElement>(null)
const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current.current,
  estimateSize: () => 22, overscan: 12 })
return <div ref={scrollRef} className="wid-tree-scroll">
  <div style={{ height: v.getTotalSize(), position: 'relative' }}>
    {v.getVirtualItems().map(it => <TreeRow key={rows[it.index].path} row={rows[it.index]} style={{ transform: `translateY(${it.start}px)` }} />)}
  </div>
</div>
```

10000 行稳定性：DOM 节点数恒为 `视口行数 + overscan ≈ 45`；滚动只在 `onScroll` 里读 `scrollTop`（虚拟器内部 rAF 合批），不写 store；展开/折叠引起的行数变化只做一次 `measure()`。

### 2.3 键盘导航

焦点在树容器上（`tabIndex=0`，roving tabindex 到选中行），`selected` 与 `expanded` 都是 store 呈现态：

| 键 | 动作 | 实现要点 |
| --- | --- | --- |
| `↓` / `↑` | 移动选中 | 在 `rows` 数组上 ±1；`scrollToIndex(i, {align:'auto'})` |
| `→` | 展开；已展开则进第一个子项 | 未 loaded 时先触发 §1.2 加载，加载完成后再移动选中（`pendingSelect`） |
| `←` | 折叠；已折叠则跳到父目录 | 父路径 = `path.slice(0, path.lastIndexOf('/'))`（根为 `''`） |
| `Enter` / `Space` | 文件 → `workbench.stores.openFile(path)`；目录 → 同 `→` | — |
| `Home` / `End` | 首/末可见行 | — |
| 字母键 | **不做** type-ahead 跳转（P1） | 与「行内重命名输入」抢键 |

事件处理写在 `TreeList` 的 `onKeyDown`（React 合成事件，天然作用域隔离），**不注册 `ctx.shortcuts`**：树的焦点归本面板，避免与宿主快捷键表冲突（§editor.md §10）。

## 3. 读写管线

### 3.1 状态机与调用顺序

`Datasource` 只做「选动作 + 传参 + 不吞 `ok:false`」，状态流转在 store：

```
idle → loading → ready
              ↘ error(ErrCode) → (retry) → loading
```

| 动作 | 调用 | 触发 | 成功后本地状态 |
| --- | --- | --- | --- |
| 列目录 | `files.list { path, refresh? }` | 展开 / 刷新 | 写 `DirCache` + `TreeNode`（§1.3） |
| 读文件 | `files.stat` → `files.read` | 打开 tab | 转交 editor store（见 [editor.md](./editor.md) §3） |
| 续读 | `files.read { path, offset: loadedLines+1, limit }` | 滚到接近末尾 | 追加；`version` 变了就整体重载 |
| 写文件 | `files.write { path, text, expectedVersion }` | `Cmd+S` | 更新 tab.version；失效父目录 |
| 新建 | `files.create { path, kind, text? }` | 行内输入提交 | 插节点 + 失效父目录 |
| 重命名 | `files.rename { from, to }` | 行内输入提交 | 搬节点子树 + 改 tab.path |
| 删除 | `files.delete { path, recursive }` | 确认后 | 删子树 + 关 tab + 失效父目录 |

所有动作必须 `catch` 后落到 `ErrCode`（AGENTS「错误不得静默」），UI 由一张 `ErrCode → 文案/动作` 表驱动（§10.2）。

### 3.2 分页边界

| 字段 | 语义 | 客户端处理 |
| --- | --- | --- |
| `offset` | 本次第 1 行的 1-based 行号（回显，可能与请求不同） | 以回显为准 |
| `lines` | 本次返回的行数 | 续取用 `offset + lines`，**不数 `\n`** |
| `eof` | 已到文件末尾 | `true` 即停止续取，`tab.truncated=false` |
| `totalLines` | 总行数；**>2 MB 时为 `null`** | `null` 时状态栏显示「已加载 N 行」，不显示 `N / total` |
| `version` | 本页所属版本 | 与 tab.version 不一致 → 停止续取，标「文件已改变」（§4） |
| `bom`/`eol` | 文件级属性（每页都回） | 只在第一页采用，续取时忽略 |

`limit` 上限 20000（`limits.readLinesMax`）：跳行到 50000 行时按 `limit: 20000` 分次补取，而不是一次要 50000。

### 3.3 原子写在 Host 的意义

`files.write` 在 Host 侧是「同目录临时文件 + `rename`」，且写前重新 `stat` 校验 `expectedVersion`（TOCTOU）。对客户端只有一条结论：**要么旧内容、要么新内容，永远读不到半截文件**。因此客户端不需要：
- 写前备份、写后回读校验（`data.bytes` 已确认落盘字节数）；
- 处理「文件正在被写」的空/截断态；
- 任何锁或重试退避（并发由 Host 的每路径串行队列处理）。

唯一需要客户端配合的是**保留原文件的 eol/bom/mode**（Host 负责 mode，客户端负责把文本按原 eol/bom 还原后再传，见 [editor.md](./editor.md) §5.1）。

## 4. 版本与冲突

| 问题 | 答案 |
| --- | --- |
| `version` 是什么 | Host 侧 `sha1(size|mtimeMs|inode)` 短串，内容或元数据一变就变。**不是** git 的 commit/rev，不可比较大小 |
| 写前校验的意义 | 用户 A 打开 → 外部（CLI/git/另一个编辑器）改了同一文件 → `Cmd+S` 若不带校验就会静默覆盖别人的改动。带 `expectedVersion` 才能返回 `E_VERSION_CONFLICT` 让用户选 |
| 何时刷新 | ①每次成功写后 `tab.version = data.version`；②面板重新获得焦点；③P1 `watch.poll` 的 `kind:'file'` 事件 |
| 焦点刷新怎么做 | 见下 |

做法：面板重新获得焦点（窗口 `focus`、标签页 `visibilitychange`、侧栏切回）时，对每个已打开 tab 发 `files.stat`，`version` 不同就 `editor.markStale(tab.id, newVersion)`（只标记不重载）；整轮节流到 1 次/2 s。

`markStale` 的 UI：标签标题加圆点 + 编辑器顶部细条「文件已在磁盘上被修改」+ 两个按钮「重新加载」「保留我的修改」；**不自动重载**（会丢用户正在打的字），也不在 dirty 时弹模态（打字中途弹窗最烦）。`watch` 未接入（P0）时，聚焦刷新是唯一的外部变更检测点，所以 `revalidateOpenTabs` 必须节流到 1 次/2 s。

## 5. 新建 / 重命名 / 删除

### 5.1 行内输入状态机

```
none → editing(kind:'create'|'rename', parent, draft) → submitting → none
                        ↘ error(文案) → editing（保留输入）
```

`Enter` 提交、`Esc` 取消、失焦取消（点了别处就是放弃，不做「猜用户意图」）。校验顺序（**先本地、后服务端**）：

| 校验 | 规则 | 文案 |
| --- | --- | --- |
| 空名 | `draft.trim() === ''` | 「名称不能为空」（禁用提交按钮，不弹错） |
| 非法字符 | 含 `/` 或 `\0` | 「名称不能包含 / 」 |
| 保留名 | `.`、`..` | 「名称无效」 |
| 重名 | 同目录 `childPaths` 里已有同名（**大小写不敏感比较**） | 「已存在同名文件或目录」（macOS/Windows 上 `Foo` vs `foo` 会互相覆盖） |
| 服务端兜底 | `files.create` 的 `E_VERSION_CONFLICT` → 「已存在同名文件或目录」；`E_NOT_FOUND` → 「父目录已不存在，刷新后重试」 | — |

```js
const isValidName = (n, siblings) =>
  n.trim() !== '' && !/[/\0]/.test(n) && n !== '.' && n !== '..' &&
  !siblings.some(s => s.toLowerCase() === n.trim().toLowerCase())
```

内存态：`editing` 是树 store 的一个字段（`inlineEdit: { kind, parent, draft, error }`），不是 `useState`；输入框的 value 走 store → view 受控，`Enter` 在 input 的 `onKeyDown` 里判 `!e.nativeEvent.isComposing`（输入法上屏的 Enter 不能当提交）。

### 5.2 删除的二次确认

| 场景 | 文案 | 按钮 |
| --- | --- | --- |
| 空目录 / 单文件 | 「删除 `src/a.ts`？此操作不可撤销。」 | 取消 / 删除 |
| 目录（递归） | 「删除目录 `src/legacy` 及其中 **12 个文件、3 个子目录**？此操作不可撤销。」 | 取消 / 删除 |
| 有未保存的标签在被删路径下 | 追加「其中 2 个标签有未保存修改，将被一并丢弃。」 | 同上 |

数量来自本地 `Map` 计数（已加载部分）；未加载的子树无法精确计数 → 文案退化为「及其全部内容」。**`files.delete` 无回收站语义**（契约无 `toTrash`，差异 #3），所以「不可撤销」必须写进文案。删除成功后：`Map` 里级联删后代、关闭子孙路径的 tab（`editor.closeTabsUnder(path)`）。

### 5.3 重命名后打开标签的路径更新

```js
export function applyRename(from, to) {
  for (const [id, tab] of editor.tabsMap()) {
    if (tab.path === from) editor.patchTab(id, { path: to })                     // 仅换路径
    else if (tab.path.startsWith(from + '/')) editor.patchTab(id, { path: to + tab.path.slice(from.length) })
  }
  tree.moveSubtree(from, to)                                                     // Map 里搬节点（不重建）
}
```

**CM6 实例复用**：只改 `tab.path`，不 `destroy` 不重建 `EditorView` —— 文档内容、撤销历史、滚动、光标全部保留，`tab.version` 也不变（同一 inode 的 mtime 会变，但契约不保证 rename 后 version 稳定 → 若用户在重命名后立刻保存，`E_VERSION_CONFLICT` 走 §4 的「强制覆盖/重新加载」流程即可，不为此专门 `stat`）。把 CM6 的 `tab.path` 同步给 `language` Compartment 只有在扩展名变化时才需要 `reconfigure`：

```js
if (extname(from) !== extname(to)) view.dispatch({ effects: compartments.language.reconfigure(languageFor(to)) })
```

大小写改名（`foo.ts` → `Foo.ts`）：macOS/Windows 上目标名视为同名 → `files.rename` 直接调会失败，Host 侧需「临时名中转」（`foo.ts → .tmp-xxx → Foo.ts`），客户端只发一次请求、不自行拆两步（差异 #4）。

## 6. 搜索

### 6.1 面板与查询模型

| 控件 | 字段（`files.search` payload） | 说明 |
| --- | --- | --- |
| 查询框 | `query` | 每条 ≥2 字符才发请求（1 字符命中太多、且 `E_LIMIT` 概率高） |
| 包含 | `include` | glob，逗号分隔，如 `src/**/*.ts` |
| 排除 | `exclude` | 同上；Host 默认再排除 `.git/`、`node_modules/`、`.DS_Store` |
| 大小写 / 正则 / 整词 | `caseSensitive` / `regex` / `wholeWord` | 三个开关，默认全关 |
| 结果上限 | `maxResults` | 默认取 `limits.searchMaxResults`（2000），UI 不再暴露输入框 |

请求节流 300 ms（输入防抖）+ 单飞（新查询取消旧请求，旧响应按 `elapsedMs`/请求序号丢弃，**不**按 `seq`——搜索响应无 `seq`，差异 #6）。空查询不发请求、直接清空结果（不是「搜全库」）。

### 6.2 结果模型 → UI

`data = { hits: [{ path, line, column, text, matchStart, matchEnd }], truncated, engine, elapsedMs }`

| UI | 数据来源 |
| --- | --- |
| 按文件分组（文件头 + 命中行） | `groupBy(hits, h => h.path)`；组内按 `line` 升序 |
| 文件头 | 相对路径 + 命中数徽标；`matchStart/matchEnd` 是**该行内**的偏移（0-based，按 UTF-16 码元） |
| 命中行 | 前后各裁 40 字符上下文，`matchStart/matchEnd` 段用 `<mark>` 高亮（注意：裁剪后要相应平移偏移） |
| 「仅显示前 N 条」 | `truncated === true` 时列表底部固定条「结果已达上限 2000 条，仅显示前 2000 条；请缩小查询范围」 |
| 空结果 | 「没有匹配 `{query}` 的结果」+ 「在已打开文件中查找」（转编辑器内查找） |

### 6.3 点击跳转到指定行

```js
// workbench.stores.ts：搜索命中 → 打开 → 定位（跨域编排的唯一入口）
export async function openSearchHit(hit) {
  await openFile(hit.path)                                    // 复用 editor 管线；tab.truncated 可能为 true
  const rt = pool.get(editor.activeId())
  if (!rt?.view) return
  const need = hit.line
  while (need > rt.loadedLines && !rt.eof) await loadNextPage(rt)   // 目标行未加载：先分页补取
  const view = rt.view
  const line = view.state.doc.line(Math.min(need, view.state.doc.lines))
  const anchor = Math.min(line.from + hit.column, line.to)
  view.dispatch({
    selection: { anchor, head: anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'center', yMargin: 80 }),
    scrollIntoView: true,
    userEvent: 'select.search',
  })
  view.focus()
}
```

要点：`hit.column` 是该行内 0-based 偏移，**必须 `Math.min(..., line.to)`** 夹住（非 UTF-8/超长行裁剪会让偏移越界）；`userEvent` 让撤销历史与 selection 更新可区分；跳转后不选中整行（避免下一次 `Cmd+F` 把整行当初始查询）。

### 6.4 搜索与其他面板的分工

| 场景 | 用哪个 | 理由 |
| --- | --- | --- |
| 想知道「改了这个符号影响哪些文件」 | `files.search`（全局） | 走 Host 的 ripgrep，不受已打开文件限制 |
| 当前文件内 | CM6 `@codemirror/search`（`Cmd+F`） | 不跨进程，实时 |
| 文件名定位 | 快速打开（`Mod-e`，见 editor.md §10） | 只查 `TreeNode` 的 name，无需 IO |

## 7. 路径与权限

### 7.1 相对路径规范（唯一形状）

| 规则 | 例子 | 校验点 |
| --- | --- | --- |
| 分隔符恒 `/` | `src/a/b.ts` | `frontend/service/path.js` 的 `normalizePath`（把 `\` 换成 `/`） |
| 不以 `/` 开头 | `src/a.ts` ✅ / `/src/a.ts` ❌ | 发送前断言；`/` 打头一律剥掉并在开发期报错 |
| 无 `.`/`..` 段 | `src/../a.ts` → 拒绝 | 客户端 `normalizePath` 先解析，出现 `..` 直接拒（不做「合法化」，避免掩盖 bug） |
| 无尾部 `/` | `src` ✅ / `src/` ❌ | 目录 path 也不带尾斜杠，便于前缀匹配 `path + '/'` |
| 根目录 | `''`（空串） | `files.list {}` 不带 path 即根；显示名取「工作区」 |

### 7.2 `E_OUTSIDE_ROOT` 的触发点

只在 Host 判定（`path.resolve(root, rel)` → `realpath` → 前缀比较带 `/` 边界）。客户端能出现的两种情况：
1. 用户手工输入了 `..` 或绝对路径 → 客户端先拒（不发请求）；
2. **符号链接指向工作区外**：`link -> /etc/passwd` 或 `link -> ../../outside` → 客户端看路径完全合法，Host 的 `realpath` 逃逸 → `E_OUTSIDE_ROOT`。UI 文案：「该路径指向工作区之外，已阻止访问」，并在树里把该 symlink 标红（`error` 字段）；不提供「强制访问」入口。

### 7.3 符号链接

| 问题 | 结论 |
| --- | --- |
| 显示 | **显示**，`type === 'symlink'`，行尾加 `↗` 图标，tooltip 显示「符号链接，点击展开将跟随」 |

### 7.4 大小写敏感差异

| 文件系统 | 行为 | 客户端对策 |
| --- | --- | --- |
| Linux（ext4 等，大小写敏感） | `A.ts` 与 `a.ts` 可共存 | 重名检测仅在 Windows/macOS 生效 |
| macOS（APFS 默认不敏感） / Windows（NTFS 不敏感） | `A.ts` 与 `a.ts` 是同一文件 | 重名检测用 `toLowerCase()`；`rename` 大小写变更走 Host 的临时名中转 |

## 8. 刷新（P0 / P1）

### 8.1 P0：`version` 对比 + 聚焦刷新

| 触发器 | 动作 |
| --- | --- |
| 面板重新获得焦点（窗口 `focus`、标签页 `visibilitychange`、侧栏切回） | ①`files.list { path: '' }` 对比根 version；②对**已展开的目录**逐个 `files.list { path }`（串行、最多 20 个，超出则只刷根与当前可见目录）；③`revalidateOpenTabs()`（§4） |
| 成功写/建/删/改名后 | 只失效受影响目录（§1.3），不发 `refresh:true` 全刷 |

version 相同的目录**不重建**节点（避免展开的子树被拍平、选中行丢失）。

### 8.2 P1：`watch.poll` 局部失效

```js
// watch.start { kinds: ['workspace','git'] } → { token, epoch }；之后循环 poll
const loop = async (token, offset) => {
  while (!stopped) {
    const r = await watch.poll({ token, offset })
    if (!r.ok) break
    const { events, offset: next, dropped, stopped: end, reason } = r.data
    if (dropped) invalidateAllDirs()                       // 事件丢了：全量失效（§8.1 的聚焦刷新一轮）
    for (const e of events) {
      if (e.kind === 'dir') invalidateDir(e.path)          // 只重列该目录（若已展开且已 loaded）
      if (e.kind === 'file') parentOf(e.path) && invalidateDir(parentOf(e.path))   // 文件增删 → 父目录条目变化
      if (e.kind === 'file' && editor.has(e.path)) markTabStaleIfChanged(e.path)   // 打开中的文件：stat 对比 version
      if (e.kind === 'git-status') scheduleGitRefresh()     // 交给 git 域，不在此处理
    }
    if (end) { showBanner(`自动刷新已停止（${reason}）`); break }
    offset = next
  }
}
```

| 细节 | 值 |
| --- | --- |
| 轮询间隔 | 1000 ms（`limits.statusPollMs` 是 git.status 的 1500 ms，两者独立） |
| 失效范围 | **只重列受影响的已展开目录**；未展开的目录只删 `DirCache`（下次展开时拉） |
| `dropped:true` | 全量失效（清所有 `DirCache`，重列根；打开中的 tab 全部 `stat` 对比） |
| `stopped:true` | 停止轮询，退回 §8.1 的聚焦刷新，横幅提示一次（不重复弹） |

## 9. 性能预算

| 场景 | 预算 | 手段 |
| --- | --- | --- |
| 2000 项目录首次渲染 | **≤ 80 ms** | 固定行高 + 虚拟化（只建 ~45 个 DOM 节点）+ 排序结果按 `version` 缓存 |
| 展开 20 层深目录 | 不掉帧 | 每次展开只 `files.list` 一层；`flatten` 是 O(可见行)，缓存键 `treeRevision` |
| 树滚动 | 60 fps | 行内无 `box-shadow`/`filter`；选中态只改 class；`translateY` 定位不触发 layout |

面板首屏可交互 ≤ 400 ms 是 ARCHITECTURE 硬指标：树的首屏只依赖 `files.list ''` 一次请求，先渲染骨架行（8 行灰条）再替换，不等数据。

## 10. 空态与错误

### 10.1 空态

| 情况 | UI | 动作 |
| --- | --- | --- |
| 无根目录（Host 解析不到 `cwd` 且用户未选） | 居中：「未选择工作区」+ 「选择目录」按钮 | 调 `ctx.uiWorkspace.pickDirectory()`，结果只告诉 Host（不在 wire 传绝对路径） |
| 根为空目录 | 「此工作区没有文件」+ 「新建文件」 | 直接在根下 `create` |
| 目录为空 | 展开后一行灰字「空目录」（`loaded && childPaths.length === 0`） | — |
| 未信任目录 | 顶部横幅「此目录未被信任，仅可浏览，不可写入」+ 保存/新建/删除按钮全部 `disabled` + tooltip | — |

### 10.2 `ErrCode` → 文案/动作

| 错误 | 文案 | 恢复动作 |
| --- | --- | --- |
| `E_NOT_FOUND` | 「`{path}` 已不存在（可能被外部删除）」 | 从 `Map` 删除节点、失效父目录、关闭对应 tab；提供「刷新」 |
| `E_OUTSIDE_ROOT` | 「该路径指向工作区之外，已阻止访问」 | 标红该 symlink；不提供强制入口 |
| `E_TRUST_REQUIRED` | 「目录未被信任」 | 横幅 + 信任入口（Host 决定流程） |
| `E_TIMEOUT` | 「操作超时（8 s），请重试」 | 「重试」按钮；连续 2 次超时提示检查路径深度/网络盘 |
| 无权限（`EACCES` 映射到 `E_GIT_FAILED`? 否 → `E_TOO_LARGE`? 否） | 「没有权限读取 `{path}`」——契约无独立码，落在 `E_NOT_FOUND` 之外时统一按 `error.message` 显示（差异 #7） | 「以只读打开父目录」 |

### 10.3 `.git` 是否显示：**隐藏**

| 理由 | 说明 |
| --- | --- |
| 不是工作区内容 | 用户不会编辑 `.git/` 里的文件；误删/误改后果严重 |
| 打满上限 | 大仓库 `.git/objects` 动辄数万项，`dirEntriesMax` 5000 会先被它吃光 |

工作树根之外的 `.git`（子模块的 `.git` 文件）同样隐藏；`git` 仓库判定与工作区根的关系由 Host 在 `git.status` 里回答，树不参与。

## 11. 明确不做（本轮）

| 项 | 结论 | 备注 |
| --- | --- | --- |
| 拖拽移动文件 | 不做 | 需要 `dragstart` 数据 + 目标高亮 + `files.rename` 冲突处理；P1 再议 |
| 上传 / 下载 | 不做 | 无文件选择器上传通道，Host 也不接受二进制流（`files.write` 只收文本） |
| `.gitignore` 过滤 | P0 不做；P1 仅**标灰**（不隐藏） | P1 依赖契约的 `ignored?: boolean`（差异 #1）；避免「文件明明在却被藏起来」的困惑 |
| 编码转换 | 不做 | 只提示 + Latin-1 只读（[editor.md](./editor.md) §6） |
| 文件监视（watcher） | P0 不做；P1 用 `watch.poll` | 见 §8.2；不用 `fs.watch`/chokidar（跨平台行为差异 + 插件卸载残留风险） |
| 多根工作区 | 不做 | 一个会话一个根；`TreeNode.path` 的根为 `''` 就够，不要引入 `rootId` |

## 与契约的差异（已复核：8 条并入、1 条驳回）

| # | 初版需求 | 处置 |
| --- | --- | --- |
| 1 | `files.list` 缺 `ignored` | **已并入契约 v2**（可选字段，P1 才填；客户端必须容忍缺省） |
| 2 | `files.list` 缺 `hasChildren` | **已并入契约 v2**（Host 一次 `readdir` 即可） |
| 3 | `files.delete` 无回收站 | **驳回**：Node 无跨平台回收站 API，伪造「已进回收站」比直接删除更危险。维持「不可恢复 + 二次确认 + 删除前显示条目数」 |
| 4 | 大小写改名谁拆步 | **已写明**：Host 负责临时名中转，客户端只发一次 `files.rename` |
| 5 | symlink 环检测 | **已写明**：Host **从不跟随** symlink，`realpath` 带深度上限 32 + 祖先链去重，成环 `E_LIMIT{reason:'symlink-loop'}` |
| 6 | `files.search` 无请求序号 | **已并入契约 v2**：`queryId` 原样回显，客户端据此丢弃乱序旧结果 |
| 7 | 无「无权限」错误码 | **已并入契约 v2**：`E_PERMISSION`（`detail.syscall`） |
| 8 | `files.stat` 缺 `writable` | **已并入契约 v2**（与 `docs/editor.md` #3 同一字段） |
| 9 | 根目录显示名来源 | **不需要新字段**：用 `workspace.state.name`，`files.list` 根响应不重复带 |

**仍待实现期确认（不是契约缺口）**：P1 `ignored` 的判据是「Host 跑 `git check-ignore --stdin` 批量询问」还是「自己解析 `.gitignore`」——前者准确但要额外进程，后者会漏掉嵌套与全局 ignore，倾向前者并按目录批量。
