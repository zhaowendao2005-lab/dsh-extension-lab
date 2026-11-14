# 编辑器模块设计（CodeMirror 6）

> 分层与禁用项见 [ARCHITECTURE.md](../ARCHITECTURE.md)、[AGENTS.md](../AGENTS.md)：`frontend/views/editor/`（CM6 实例绑定）+ `frontend/stores/editor.{stores,datasource}.ts` + `frontend/service/{bytes,language,diff-text,editor-theme}.js`（纯函数）；打开文件的跨域编排只在 `frontend/stores/workbench.stores.ts`。字段名以 [remote-contract.md](./remote-contract.md) 为准，文件树见 [files.md](./files.md)。结论先行：**单视图池 + 全 token 主题 + 无 worker/无 LSP**，正文永不进 Zustand。

## 1. 依赖与装配

### 1.1 版本表（精确锁版，全 MIT）

CM6 被打进 `lib/client.js`（esbuild IIFE、`react` external），按既有包惯例（`dsh-plugin-dev-sandbox`）全部放 `devDependencies`。

| 包 | 版本 | gzip | 用途 |
| --- | --- | --- | --- |
| `@codemirror/state` | 6.7.6 | 16.1 KB | `EditorState`/`Transaction`/`Compartment`/`Facet`/`Prec` |
| `@codemirror/view` | 6.43.15 | 79.7 KB | `EditorView`/`Decoration`/`GutterMarker`/`keymap` |
| `@codemirror/commands` | 6.11.1 | 89.6 KB | `history`/`defaultKeymap`/`historyKeymap`/`indentWithTab` |
| `@codemirror/language` | 6.13.1 | 86.7 KB | `syntaxHighlighting`/`HighlightStyle`/`foldGutter`/`indentUnit` |
| `@codemirror/search` | 6.7.2 | 73.1 KB | 查找替换、`highlightSelectionMatches` |
| `@codemirror/autocomplete` | 6.20.4 | 95.4 KB | **只取 `closeBrackets`**，不启用 `autocompletion()` |
| `@codemirror/merge` | 6.12.3 | +60~90 KB | diff 视图 `MergeView` |
| `@codemirror/lint` / `theme-one-dark` / `codemirror`(meta) | — | — | **均不装**：无 LSP；配色全来自 DSH token；`basicSetup` 是固定组合，按 §1.3 自拼 |

13 个语言包（全进主 bundle，映射见 §11.2，格式 `版本/gzip KB`）：`lang-javascript 6.2.5/46.2`、`json 6.0.2/17.4`、`html 6.4.12/24.2`、`css 6.3.1/24.5`、`markdown 6.5.2/22.0`、`python 6.2.1/31.7`、`rust 6.0.2/45.7`、`go 6.0.1/27.2`、`java 6.0.2/34.9`、`cpp 6.0.3/49.2`、`xml 6.1.0/19.3`、`yaml 6.1.3/20.7`、`sql 6.10.0/~30.0`。

体积基线：13 语言 + merge + oneDark 经 esbuild minify = **1025 KB min ≈ 320 KB gzip**（Lead 实测；无 worker、无 CSS 文件——CM6 靠 `style-mod` 运行时注入 `<style>`、无字体），占 ARCHITECTURE 1.2 MB gzip 预算的 320 KB。

### 1.2 传递依赖与「单实例」硬约束

`view` → `style-mod`/`w3c-keyname`/`crelt`；`language` → `@lezer/common`/`@lezer/highlight`/`@lezer/lr`（14.8 KB）；`state` → `@marijn/find-cluster-break`；每个 `lang-*` → 自身 `@lezer/<lang>`（如 `@lezer/javascript` 46.2 KB）。**`state` 与 `view` 必须只有一份实例**（跨实例 `Facet`/`StateField` 判定失败 → 扩展静默不生效）：根 `package.json` 用 `pnpm.overrides` 锁 `6.7.6`/`6.43.15`，`scripts/build.mjs` 断言产物里版本标记只出现一次。

### 1.3 `extensions` 组合清单

| 项 | 用/不用 | 为什么 |
| --- | --- | --- |
| `lineNumbers()` | 用，永不关 | 保存失败定位、跳行依赖它；CM6 行号虚拟化，成本与文档大小无关 |
| `highlightSpecialChars()` | 用，`plain` 起关 | `\u0000`/零宽字符必须可见，否则「看起来一样、git 说不一样」 |
| `history({minDepth:200})` | 用，`noFold` 起降 50 | 默认 100 层不够长改动；大文件降层控内存 |
| `foldGutter()` + `foldKeymap` | 用，`noFold` 起移除 | 折叠需全量语法树，2 MB 上是首屏杀手 |
| `drawSelection()` | 用，永不关 | 原生选区颜色由 UA 定，深色下与 `--dsw-alias-bg-document-selection` 冲突 |
| `allowMultipleSelections.of(true)` | 用 | CM6 自带多选（Alt+点击）保留，不做 `Mod-d` |
| `indentOnInput`/`bracketMatching`/`closeBrackets`/`syntaxHighlighting` | 用，`noSyntax` 起依次关 | 全依赖语法树或缩进规则；`closeBrackets` 在纯文本里自动补右括号是灾难 |
| `highlightActiveLine` + `highlightActiveLineGutter` | 用，`noFold` 起关 | 各只 1 行背景，但大文件每次选移动都触发重绘 |
| `highlightSelectionMatches` | 用，`noSyntax` 起关 | 全文扫描无上限，是「1 MB 文件 `Cmd+F` 卡顿」主因之一 |
| `EditorView.lineWrapping` | 用，`plain` 起关 | 见 §7 |
| `scrollPastEnd()` | 用 | 末行能滚到视口中央，否则贴边无法居中编辑 |
| `indentUnit.of('  ')` + `EditorState.tabSize.of(2)` | 用 | `indentUnit` 决定缩进宽度（默认按语言猜，`.txt` 猜不出）；`tabSize` 只影响 Tab 显示宽 |
| `contentAttributes.of({spellcheck:'false',autocorrect:'off',autocapitalize:'off'})` | 用 | 不关会把代码首字母大写、把标识符划红线 |
| `dropCursor`/`rectangularSelection`/`crosshairCursor` | 不用 | 不做文件拖放；块选区与宿主文本选择心智冲突 |
| `autocompletion()` + `completionKeymap` | **不用** | 无 LSP 只有词法补全，价值低；95.4 KB 包只取 `closeBrackets` |

```js
// 三层 keymap：Tab 只做缩进（否则焦点跳出编辑器）；Escape 仅失焦；其余走 CM6 默认
const keymaps = [Prec.highest(keymap.of([indentWithTab])), keymap.of([...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap]), Prec.lowest(keymap.of([{ key: 'Escape', run: v => (v.contentDOM.blur(), true) }]))]
```

### 1.4 只读组合（两件必须一起用）

| 只设一个 | 后果 |
| --- | --- |
| 只 `EditorState.readOnly.of(true)` | `contenteditable` 仍在 → IME 吞键、双击出系统光标、粘贴先被浏览器接 |
| 只 `EditorView.editable.of(false)` | 命令层仍可 `dispatch({changes})` 改文档（`state.readOnly` 才是命令守门人） |

复原：`view.dispatch({ effects: compartments.readOnly.reconfigure([]) })`。

## 2. 主题

### 2.1 `EditorView.theme` token 映射

值全写 `var(--dsw-alias-…)`，**不出现 `#hex`/`rgb(`**（AGENTS 构建期扫描拦截）。`ThemePresenter` 把变量写在 `body` 上，`var()` 自然继承进 `.cm-editor`。语法高亮复用同一批 token（`HighlightStyle` 里 keyword/string/number/property 分别指 `--dsw-alias-json-tree-*`），因此**只有一套高亮定义，明暗自适应**。

| CM6 选择器 | 属性 | token |
| --- | --- | --- |
| `&` | `backgroundColor` / `color` | `--dsw-alias-bg-layer-1` / `--dsw-alias-label-primary` |
| `&.cm-focused` | `outline` | `none`（焦点环由面板容器画 `var(--dsw-focus-ring-color)`） |
| `.cm-scroller` | `fontFamily`/`fontSize`/`lineHeight` | `var(--dsh-font-family-code)` / `var(--dsh-code-font-size)` / `1.5` |
| `.cm-content` / `.cm-cursor` | `caretColor` / `borderLeftColor` | `--dsw-alias-label-primary` |
| `.cm-selectionBackground, .cm-content ::selection` | `backgroundColor` | `--dsw-alias-bg-document-selection` |
| `.cm-gutters` / `.cm-gutterElement` | `backgroundColor`/`color`/`borderRight` / `padding` | `--dsw-alias-bg-layer-1` / `--dsw-alias-label-tertiary` / `1px solid var(--dsw-alias-border-l1)` / `0 8px 0 12px` |
| `.cm-activeLine` / `.cm-activeLineGutter` | `backgroundColor` | `--dsw-alias-fill-l1` / `--dsw-alias-fill-l2` |
| `.cm-matchingBracket` | `outline` / `backgroundColor` | `1px solid var(--dsw-alias-border-selected)` / `--dsw-alias-bg-multi-select` |
| `.cm-nonmatchingBracket` | `color` | `--dsw-alias-state-error-primary` |
| `.cm-searchMatch` / `.cm-searchMatch-selected` | `backgroundColor` | `--dsw-alias-bg-multi-select` / `--dsw-alias-state-warn-secondary` |
| `.cm-foldPlaceholder` | `backgroundColor`/`color`/`border` | `--dsw-alias-fill-l1` / `--dsw-alias-label-secondary` / `1px solid var(--dsw-alias-border-l2)` |
| `.cm-scroller::-webkit-scrollbar` | `width` / `thumb` | `var(--dsh-scrollbar-width)` / `--dsw-alias-scrollbar-bg-l1`（hover `-hover-l1`） |

### 2.2 明暗切换：Compartment，不重建 state

颜色全是 `var()`，palette 由 `body[data-ds-dark-theme]` 驱动 → 切换时 CM6 一行都不用改；`EditorView.theme(spec,{dark})` 的 `dark` 只加 `&dark`/`&light` 选择器与 `EditorView.darkTheme` facet（内置 tooltip 阴影消费它）。

```js
// frontend/service/editor-theme.js
export const themeExt = isDark => [EditorView.theme(themeSpec, { dark: isDark }), EditorView.darkTheme.of(isDark)]
ctx.on('theme/change', s => { const ext = themeExt(s.active.colorScheme === 'dark')
  for (const v of pool.liveViews()) v.dispatch({ effects: compartments.theme.reconfigure(ext) }) })
```

不用 `setState` 的原因：它会丢滚动定位/选区/折叠态并触发完整 measure → 切换「闪一下 + 跳回顶部」；`reconfigure` 只重算 facet，实测 < 2 ms。

## 3. 加载管线

### 3.1 打开文件时序

| # | 动作 | 关键字段 | 失败分支 |
| --- | --- | --- | --- |
| 1 | 树/搜索点击 → `workbench.stores.openFile(path)`；建 tab，`status='loading'` | — | — |
| 2 | `files.stat { path }` | `size` `eol` `bom` `binary` `encoding` `version` | `E_NOT_FOUND` → 关 tab + 树标灰 |
| 3 | 定级：`size` 落 `limits.largeFileBytes` 哪级 → `tab.largeMode`；`binary`/`encoding!=='utf8'`/`size>=readonly` → `readOnly=true` | `limits.largeFileBytes` | — |
| 4 | `files.read { path, offset: 1, limit: limits.readLinesDefault }`（2000 行） | `text` `lines` `eof` `version` `totalLines` `eol` `bom` | `E_BINARY` → §6；`E_TOO_LARGE` → 只读分页 |
| 5 | `doc = fromDiskBytes(read.text, tab)`（剥 BOM、归一 `\n`，§5.1）；`tab.version = read.version`（覆盖 stat 的，取更晚者） | `version` | 两次 version 不一致时以 read 为准 |
| 6 | `EditorState.create({doc, extensions})` → `new EditorView({state, parent})` | — | — |
| 7 | 恢复滚动：`view.requestMeasure({read: () => tab.scroll, write: (_, v) => { v.scrollDOM.scrollTop = tab.scroll }})` | `tab.scroll` | — |
| 8 | `status='ready'` + `performance.mark('ide:editor:first-paint')`（§13 验收口径） | — | — |

`tab.truncated = !read.eof`；`totalLines===null`（>2 MB）时状态栏只显示「已加载 N 行」。

### 3.2 续取与「用户已在编辑」的合并

触发（`scroll` 上 100 ms 节流）：`doc.length - visibleRanges.at(-1).to < PREFETCH_CHARS`，`PREFETCH_CHARS = 200*80`（按字符算，避免长行误判）。请求 `files.read { path, offset: tab.loadedLines+1, limit: 2000 }` —— **续取 offset = 上一页 `offset + lines`**，`lines` 取返回值而非自己数 `\n`。

```js
const Pagination = Annotation.define()
function applyPage(view, tab, page) {
  if (page.version !== tab.version) return markStale(tab)                 // 磁盘被改过：停止续取（§5）
  view.dispatch({ changes: { from: view.state.doc.length, insert: page.text },    // page.text 自带行尾 \n
                  annotations: Transaction.addToHistory.of(false) })             // 否则 Cmd+Z 会把文件「缩回去」
  tab.loadedLines += page.lines; tab.eof = page.eof; tab.truncated = !page.eof
}
// updateListener 里：if (u.transactions.some(tr => tr.annotation(Pagination))) { if (!tab.dirty) { rt.savedDoc = u.state.doc; rt.savedLength = u.state.doc.length } }
```

三条要点：(1) `addToHistory:false`；(2) 追加位置与用户编辑**无关**（分页文本只属于文档末尾），故只需判版本、不必判「是否正在编辑」；(3) 基线推进必须改 `savedDoc` —— 只比 `doc.length` 会把追加误判成 dirty（§4.1）。

## 4. 状态模型

```ts
export type LargeMode = 'full' | 'noFold' | 'noSyntax' | 'plain' | 'readonly'
export interface EditorTab {                // frontend/stores/editor.stores.ts，唯一状态入口
  id: string; path: string; version: string; dirty: boolean; eol: 'lf' | 'crlf' | 'mixed'; bom: boolean
  largeMode: LargeMode; cursor: { anchor: number; head: number }; scroll: number; selectionAnchor: number
  language: string; readOnly: boolean; truncated: boolean        // truncated = 仍有未加载行
}
interface EditorRuntime {   // 不进 store：frontend/views/editor/pool.js 的 Map<tabId, EditorRuntime>
  view: EditorView | null; state: EditorState | null; savedDoc: Text | null; savedLength: number   // dirty 的真依据
  loadedLines: number; eof: boolean; lastUsedAt: number
}
```

`cursor`/`scroll`/`selectionAnchor` 由 `updateListener` + `scroll` 100 ms 节流写回 store，只有 `dirty` 变化立即写（views 是纯订阅者，不持业务状态）。

### 4.1 dirty 判定与撤销变 clean

```js
function recomputeDirty(u, tab, rt) {
  if (!u.docChanged) return
  if (u.state.doc.length !== rt.savedLength) return setDirty(tab, true)       // 快路径：长度不同必脏
  requestIdleCallback(() => setDirty(tab, !u.state.doc.eq(rt.savedDoc)))      // 同长再比内容，避免每键 O(n)
}
```

`Text.eq` 是内容相等（同 chunk 结构时接近 O(1)）→ `Cmd+Z` 退回保存时的内容即自动 `dirty=false`，无需监听 `history`。`savedDoc`/`savedLength` 只在三处推进：保存成功、干净标签的分页追加、重新加载完成。`docChanged` 口径：`some(tr => tr.docChanged && !tr.annotation(Pagination))`，纯选区移动不参与。

### 4.2 实例保留 vs 重建

| 策略 | 结论 |
| --- | --- |
| 默认 | **保留**：`MAX_LIVE=8` 内 DOM 常驻，切换只切父容器 `display:none` + `view.requestMeasure()`（< 5 ms） |
| 超 8 个 | 按 `lastUsedAt` LRU `view.destroy()`，把 `view.state` 存进 `EditorRuntime.state`；再开时 `new EditorView({state})` |
| 总字节 > 32 MB | 无视 8 个上限，强制降级最久未用者（`sum(rt.state.doc.length)`） |

销毁前先 `flushPendingStore()`（立刻写回节流的 cursor/scroll）；`ctx.effect` disposer 遍历销毁全部 view。

## 5. 保存与冲突

### 5.1 字节还原（唯一做换行/BOM 转换的地方）

```js
// frontend/service/bytes.js（纯函数）
export const toDiskBytes = (text, { eol, bom }) => {
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length, crlf = (text.match(/\r\n/g) ?? []).length
  const useCrlf = eol === 'crlf' || (eol === 'mixed' && crlf > lf)
  return (bom ? '\uFEFF' : '') + (useCrlf ? text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : text)
}
export const fromDiskBytes = (text, { eol, bom }) => {
  const t = bom && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return eol === 'crlf' ? t.replace(/\r\n/g, '\n') : t
}
```

决策：**`EditorState` 里永远只有 `\n`，BOM 永远不进 doc**。(a) BOM 进 doc 会让第 1 行偏移 1，搜索列号、`git.diff` 拼行、跳行全错位；(b) 用 `EditorState.lineSeparator` 承载 CRLF 会让所有 `\n` 字面比较失效且该 facet 不可中期修改。`mixed` 取多数，保存前 inline 提示「该文件有 2 种换行，保存后会统一为 CRLF（N 行）」。

### 5.2 `Cmd/Ctrl+S` 全流程

| # | 步骤 | 细节 |
| --- | --- | --- |
| 1 | 快捷键 | `ctx.shortcuts` 的 `ide.editor.save`，`regions:['page','editable']`（§10） |
| 2 | 守卫 | `readOnly` → toast「只读，未保存」；`!dirty` → 直接返回，不发请求 |
| 3 | 还原 + 本地体积校验 | `toDiskBytes(doc.toString(), tab)`；`TextEncoder().encode(text).length > limits.writeBytesMax`（8 MB）→「文件超过 8 MB 写入上限，请拆分或用外部工具」 |
| 4 | 请求 | `files.write { path, text, expectedVersion: tab.version }` |
| 5a | 成功 | `tab.version=data.version`；`rt.savedDoc=doc`；`rt.savedLength=doc.length`；`dirty=false`；状态栏「已保存 HH:mm:ss」（`data.savedAt`） |
| 5b | `E_VERSION_CONFLICT` | §5.3 |
| 5c | `E_TOO_LARGE`/`E_TRUST_REQUIRED`/`E_OUTSIDE_ROOT` | 「超过服务端 8 MB 上限」/「目录未被信任，保存已禁用」+信任入口/「路径解析到工作区之外（可能是符号链接），禁止保存」；后两者置 `readOnly=true` |
| 5d | 其它（`ENOSPC`/`EACCES`/`E_TIMEOUT`） | toast「保存失败：<message>」+「重试」；**保留 dirty，绝不改 version** |

### 5.3 `E_VERSION_CONFLICT` 三选一

| 选项 | 实现 | 风险 |
| --- | --- | --- |
| 重新加载 | 有本地修改先确认「将丢弃本地修改」，再走 §3 全流程 | 丢本地修改 |
| 强制覆盖 | 用响应里的 `currentVersion` 当基线重写 `files.write { expectedVersion: currentVersion }`（**不能用 `null`**：`null` 语义是「必须不存在」） | 期间再变 → 再冲突，重试 1 次后回落模态 |
| 取消 | 保留 dirty，什么也不改 | — |

契约无 `force:true`，第二行是唯一合法的强制覆盖路径（差异 #5）。

### 5.4 保存全部

串行 `for` 循环按标签顺序（Host 侧每路径本就是串行队列，并行只会让冲突模态叠加）。汇总「保存 5 个成功，1 个冲突，1 个只读跳过」；中途遇冲突即停并弹模态（避免连点 6 次）。

## 6. 只读与特殊文件

| 触发 | 判定 | UI | 可编辑 |
| --- | --- | --- | --- |
| 二进制 | `stat.binary` 或 `read` 的 `E_BINARY` | 居中卡片「二进制文件 · {size}」（P1 十六进制） | 否 |
| ≥20 MB | `size >= limits.largeFileBytes.readonly` → `E_TOO_LARGE` | 「文件 24.3 MB，超过 20 MB 上限，仅显示前 2000 行」 | 否 |
| 非 UTF-8 | `stat.encoding === 'other'` | 「非 UTF-8 编码（可能是 GBK/Shift-JIS），无法安全编辑」+「以 Latin-1 只读查看」；**绝不**用宽松 `TextDecoder` 解出 U+FFFD 再允许保存 | 否 |
| 未信任目录 | `E_TRUST_REQUIRED` | 横幅 + 禁用保存，直接 `readOnly` | 否 |
| diff 两栏 | 恒只读 | 工具栏只留「在编辑器中打开」 | 否 |

diff 两栏各自 `[EditorState.readOnly.of(true), EditorView.editable.of(false)]`（§1.4）。

## 7. 大文件分级降级

阈值取 Host 下发的 `limits.largeFileBytes`，**客户端不写死数字**（唯一客户端常量是 `LONG_LINE_BOUNDARY`，差异 #6）。

| 级 | 大小区间 | `largeMode` | 移除的 extension | 保留 |
| --- | --- | --- | --- | --- |
| 1 | `< 262144` | `full` | — | 全部 |
| 2 | `262144–2097152` | `noFold` | `foldGutter` `foldKeymap` `highlightActiveLine` `highlightActiveLineGutter`；`history` 降 50 | 语法高亮、软换行、括号匹配 |
| 3 | `2097152–10485760` | `noSyntax` | 再移除 `syntaxHighlighting` `bracketMatching` `closeBrackets` `indentOnInput` `highlightSelectionMatches`，`language.reconfigure([])` | 行号、`drawSelection`、`history`、软换行 |
| 4 | `10485760–20971520` | `plain` | 再移除**软换行**（`wrap.reconfigure([])`）、`highlightSpecialChars` | 行号、`drawSelection`、`history` |
| 5 | `>= 20971520` | `readonly` | 全部 + 只读组合 + 首屏 2000 行 | 滚动、当前页内搜索、复制 |

单行 ≥ 10000 字符（照 VS Code `LONG_LINE_BOUNDARY = 10000`）：

```js
let maxLen = 0
for (let i = 1; i <= state.doc.lines; i++) maxLen = Math.max(maxLen, state.doc.line(i).length)
if (maxLen >= 10000) {                       // 2 万行全扫 ≈ 5 ms；大文件改抽样（前 2000 + 随机 500 行）
  view.dispatch({ effects: compartments.wrap.reconfigure([]) })          // 关软换行，该行横向滚动
  showBanner(`检测到 ${maxLen} 字符的超长行，已关闭自动换行`)
}
```

## 8. diff 视图

### 8.1 `MergeView` vs `unifiedMergeView`

| | `MergeView`（两栏） | `unifiedMergeView`（单栏） |
| --- | --- | --- |
| 布局 | 左删右增并排，两侧各自 `EditorView` | 单栏，删除行用 `syntaxHighlightDeletions` 装饰 |
| 未改动区间折叠 | **不支持**（`collapseUnchanged` 只在 unified 配置里） | `collapseUnchanged:{margin:3,minSize:8}` |
| hunk 暂存按钮 | 需自挂（§8.4） | `mergeControls`/`gutter` 有内建位 |

结论：**P0 用两栏 `MergeView`**（SCM 面板默认 900 px 以上）；面板宽度 < 600 px 或 diff 行数 > 5000 时切 `unifiedMergeView`。两栏不做未改动区折叠（CM6 不提供），改用 `goToNextChunk`/`goToPreviousChunk` 的上下 hunk 按钮。

```js
import { MergeView } from '@codemirror/merge'
const view = new MergeView({
  a: { doc: sides.a, extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers()] },
  b: { doc: sides.b, extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(),
        syntaxHighlighting(dshHighlightStyle), languageSupport] },
  parent: hostEl, gutter: true, highlightChanges: true,
  diffConfig: { timeout: 1500, scanLimit: 50000 },
})
ctx.effect(() => () => view.destroy())                     // 卸载必须销毁两侧 view，否则每条 diff 漏一个实例
```

### 8.2 hunk → 左右两侧文本

`git.diff` 只给 hunk（含 `context` 行），**要完整两侧文本必须请求整文件上下文**：`git.diff { target, context: -1 }`（每文件一个覆盖全文件的 hunk）。

```js
export function sidesFromHunks(hunks, rawPatchText) {     // frontend/service/diff-text.js（纯函数）
  const noEol = /^\\ No newline at end of file$/m.test(rawPatchText ?? '')
  const a = [], b = []
  for (const h of hunks) for (const l of h.lines) {
    if (l.type !== '+') a.push(l.text)          // ' ' 与 '-' 属于旧侧
    if (l.type !== '-') b.push(l.text)          // ' ' 与 '+' 属于新侧
  }
  const join = arr => arr.join('\n') + (noEol ? '' : '\n')
  return { a: join(a), b: join(b) }
}
```

末尾无换行：`Hunk.lines[].text` **不携带** `\ No newline at end of file`，优先从响应的 `text`（原始 patch）正则探测，拿不到就两侧都补 `\n` 并提示「已忽略末尾换行差异」；**不要**用「`oldLines` 计数 vs 实际行数」推断（未加载的行会造成误判）。拿不到 `context:-1` 时降级为「hunk 卡片列表」：每段静态渲染（`<pre>` + 行类型上色）+「在编辑器中打开第 N 行」——可用降级路径，不是错误态。

### 8.3 `diffConfig` 与超大降级

`diffConfig = { timeout: 1500, scanLimit: 50000 }`。`timeout`：CM6 超时后放弃精细 diff 退回粗糙匹配，1.5 s 是白屏容忍上限（`limits.gitTimeoutMs=20000` 是 git 子进程预算，不该全花在前端）；`scanLimit` 对齐 `limits.diffLinesMax = 50000`。**必须显式设**：默认值在超大 diff 上让主线程卡 > 5 s（Monaco 的 `maxComputationTime` 默认 5000，CM6 无此保护）。

| 条件 | 处理 |
| --- | --- |
| `truncated === true` | 横幅「差异已被截断（仅首个文件前 N 行）」，不建 `MergeView` |
| `sum(hunks[].lines.length) > 20000` | unified 静态渲染前 2000 行 +「差异过大，请用 SCM 面板或终端」 |
| `isBinary === true` / 子模块（两行 `Subproject commit`） | 「二进制文件 · 无法显示差异」/「子模块变更」，都不渲染左右文本 |

### 8.4 行内暂存按钮（P1，`git.stageHunk`）

挂载点选 **`Decoration.widget` + `StateField`**，不用 `MergeView` 的 `gutter`（完整实现见 `frontend/views/diff/stage-gutter.js`）：`Decoration.widget` + `StateField`（`provide: EditorView.decorations.from(f)`）挂在 b（新侧）view 上，按 hunk 起点建 widget；`toDOM()` 里建 `<button className="wid-stage-hunk">` 并必须 `ignoreEvent() { return false }` 才拿得到点击；`create: () => Decoration.none`、`update: (d, tr) => (tr.docChanged || tr.reconfigured ? buildStageDecorations(tr.state) : d.map(tr.changes))`。

理由：`MergeView` 的 `gutter` 作用在合成视图内部组合上，两栏再加 gutter 会与 `lineNumbers`/`foldGutter` 排序耦合，且 `gutterClick` 给行号不给 hunk 号（还得反查）；`Decoration.widget` + `ignoreEvent:false` 直接命中点击、不污染文档偏移，两栏都能挂。

## 9. 查找替换

`search({top:true, caseSensitive:false, literal:false, wholeWord:false, createPanel: v => new DshSearchPanel(v)})` + `highlightSelectionMatches({highlightWordAroundCursor:false, minSelectionLength:2, wholeWords:false})`。

| 项 | 值 | 理由 |
| --- | --- | --- |
| 命中上限 `LIMIT_FIND_COUNT` | **999**（照 VS Code） | CM6 无内建上限，`query.getCursor(doc)` 是惰性迭代器；数到 999 就停并显示 `999+`，这是「1 MB 文件 `Cmd+F` 不卡」的关键 |
| 正则 | 允许，`new RegExp` 包 try/catch，非法时红框但不禁用「下一个」 | 用户中途打字必然出现半截正则 |
| 替换 | P0 提供 `replaceNext`/`replaceAll`；`replaceAll` 次数 > 100 时二次确认 | — |

**与宿主快捷键的关系**：`Mod-f` **只**在 CM6 `searchKeymap` 里绑，不进 `ctx.shortcuts`。宿主 dispatch 在 `window` 冒泡阶段，CM6 在 `.cm-content` 先收到并 `preventDefault()` → 宿主看到 `gesture.defaultPrevented` 直接 `{status:'pass'}`；双绑必有一个静默失效（desktop 上 `priority` 会跳过 `regions`，靠 region 隔离不住）。焦点在文件树时的 `Cmd+F`：面板容器 `keydown` 捕获 → `preventDefault()` → 聚焦编辑器 → `openSearchPanel(view)`。

**面板 UI：自己画，复用搜索内核**（默认面板文案硬编码英文、无 i18n、不显示「第 N/M 个」计数、DOM 不受控）：


## 10. 键盘与快捷键

> 键位表唯一出处是 [`docs/ui-spec.md`](./ui-spec.md)；本节只列编辑器子集，改动须两处同步（AGENTS「文档同步」）。宿主已占：`Mod-p`（`workspace.files`）、`Mod-t`（`browser.new`）、`Mod-b`/`Mod-Alt-b`（侧栏）、`Mod-,`、`Mod-/`、`Ctrl-\``；`Mod-w`/`Mod-n`/`Mod-q` 属浏览器/Electron 保留（web 关标签页、desktop 关窗，`preventDefault` 拦不住）。

| 动作 | 默认键 | 注册处 | 说明 |
| --- | --- | --- | --- |
| 保存 / 全部保存 | `Mod-s` / `Mod-Alt-s` | `ctx.shortcuts` `ide.editor.save` / `saveAll` | `regions:['page','editable']` |
| 关闭当前标签 | `Alt-w` | `ctx.shortcuts` | **不用 `Mod-w`**（窗口/浏览器会吞） |
| 下一个/上一个标签 | `Alt-]` / `Alt-[` | `ctx.shortcuts` | `code:'BracketRight'/'BracketLeft'` |
| 第 N 个标签 | `Alt-1..9` | `ctx.shortcuts` | `code:'Digit1'..'Digit9'` |
| 快速打开 | `Mod-e` | `ctx.shortcuts` `ide.editor.quickOpen` | **不用 `Mod-p`**（宿主已占） |
| 命令面板 / 格式化 | — | **不做** | §14（无 formatter 就不做假成功） |
| 查找 / 替换 | `Mod-f` / `Mod-Alt-f` | **CM6 `searchKeymap`** / CM6 自定义 | 不双绑；自定义键在 keymap 里 `preventDefault`，不会插入特殊字符 |
| 下一个/上一个命中 | `Mod-g` / `Shift-Mod-g` | CM6 `searchKeymap` | — |
| 跳行 | `Ctrl-g` | CM6 自定义 | 全平台，对齐 VS Code（`Mod-g` 已给「下一个」） |
| 撤销/重做 | `Mod-z` / `Mod-Shift-z`（mac 另 `Mod-y`） | CM6 `historyKeymap` | — |
| 缩进/反缩进 | `Tab` / `Shift-Tab` | CM6 `indentWithTab` | 多行选区整块缩进 |

```js
ctx.effect(() => ctx.shortcuts.register({
  id: 'ide.editor.save', label: () => t('editor.save'), aliases: ['save file', '保存'],
  defaults: Object.fromEntries(PROFILES.map(p => [p, { code: 'KeyS', modifiers: ['primary'] }])),   // PROFILES = 6 个 runtime:platform
  regions: ['page', 'editable'], modals: [],
  resolve: () => ({ status: 'handled', run: () => void saveActiveTab() }),
}), 'workspace-ide: shortcuts')
```

| 规则 | 说明 |
| --- | --- |
| 同一个键**只在一处**注册 | 宿主 `dispatch` 开头 `if (gesture.defaultPrevented \|\| gesture.composing) return {status:'pass'}`；CM6 先处理并 `preventDefault` → 双绑必有一个永不触发 |
| `regions` 至少含 `'editable'` | 编辑器聚焦时 `.cm-content` 是 `contenteditable="true"` → region 判为 `'editable'` |
| 不能靠 `regions` 隔离 | `priority = runtime==='desktop' && (platform==='windows'\|\|'macos')` 时宿主**跳过** region 过滤 |
| `modals: []` | 有 dialog 时返回 `{status:'blocked', reason:'modal'}`，宿主只 `preventDefault`、不 stopPropagation |
| IME 期间不响应 | 宿主已算 `composing = guards(event) \|\| deadKey \|\| AltGraph`，CM6 侧 `view.composing` 自挡；**自己写的 DOM keydown 必须**判 `e.nativeEvent.isComposing \|\| e.keyCode === 229` |
| `preventDefault` 边界 | 由宿主 `consume()` 负责；`run()` 里不要再 `preventDefault`（会打乱快捷键录制态） |
| 冲突 | 键已被别的命令注册时宿主 `consume()` 后返回 `{status:'blocked', reason:'conflict'}` 且 `run` 不执行 → 新增命令前先查 DSH 快捷键面板 |

## 11. 语言探测

### 11.1 构建期 codegen（`scripts/gen-languages.mjs`）

输入 `linguist-languages@9.5.0`（833 种，含 `extensions`/`filenames`/`interpreters`/`aliases`/`codemirrorMode`/`type`），输出 `shared/languages.generated.js`（10–20 KB gzip，运行时零依赖）：

字段：`BY_EXT`（ext → 语言 id）、`BY_DOUBLE_EXT`（`d.ts` 特例）、`BY_FILENAME`（`Dockerfile`/`Makefile`/`CMakeLists.txt`/`.gitignore`）、`LANGS`（`{ id, name, aliases, codemirror }`，`codemirror` 是 CM6 工厂名或 `null`）。

口径：`codemirror` 是**我们手写的映射**，不直接信 linguist（它给 `.ts` 的 `codemirrorMode` 是 `typescript`，我们没有独立包 → 映射到 `javascript`）。`BY_*` 只收「落到白名单或纯文本」的项，其余 `codemirror:null`，运行时不再做白名单判断。探测顺序：**扩展名（含 `.d.ts`）→ 文件名精确 → shebang → 内容嗅探（`<?xml`、`{` 开头 JSON）→ `plaintext`**；**不要用 mime 反查**（`.ts` → `video/mp2t`）。

### 11.2 语言包白名单（进主 bundle）

IIFE 单文件下 `import()` 不省体积（esbuild 只能内联），**白名单即 bundle 内容**；加语言 = 改白名单 + 改体积断言。

| CM6 工厂 | 扩展名 | CM6 工厂 | 扩展名 |
| --- | --- | --- | --- |
| `javascript()` / `javascript({jsx:true})` | `js mjs cjs` / `jsx` | `python()` | `py pyi` |
| `javascript({typescript:true})` / `({jsx:true,typescript:true})` | `ts mts cts` / `tsx` | `rust()` / `go()` / `java()` | `rs` / `go` / `java` |
| `json()` / `css()` | `json jsonc` / `css` | `cpp()` / `xml()` | `c cc cpp cxx h hh hpp hxx` / `xml xsd svg plist` |
| `html({matchClosingTags:true,autoCloseTags:true})` | `html htm` | `yaml()` / `sql()` | `yml yaml` / `sql` |
| `markdown({codeLanguages:fromLanguage})` | `md markdown` | — | — |

P1 用 `@codemirror/legacy-modes 6.5.5` 兜底（**不在 P0 bundle**）：`shell`(sh/bash/zsh)、`dockerfile`、`makefile`/`cmake`、`toml`、`ini`、`php`、`ruby`、`perl`、`lua`、`powershell`、`diff`、`verilog`，经 `StreamLanguage.define(shell)` 接入。未知扩展名 → `language.reconfigure([])`（纯文本），状态栏显示 `Plain Text`，不报错不弹窗。

## 12. Markdown 预览（P1）

依赖 `react-markdown@10.1.0`（34.1 KB）+ `remark-gfm@4.0.1`（+9.6 KB）。**不装** `rehype-raw`（禁 raw HTML）、`@shikijs/rehype`、`rehype-pretty-code`、`rehype-highlight`、`streamdown`。

| 决策 | 值 | 理由 |
| --- | --- | --- |
| raw HTML | 默认不渲染且不装 `rehype-raw`，`components` 再屏蔽 `iframe`/`script` | 预览的是工作区任意 `.md`，可能恶意；Host 侧还有 CSP |
| 代码块高亮 | **不加 Shiki**：`highlightTree` + `dshHighlightStyle` 静态高亮 | 13 个语言的 lezer 语法已在包里；Shiki core+engine = 54 KB（oniguruma 还要内联 155 KB wasm），且复用同一套 alias token → 预览与编辑器配色天然一致 |
| 滚动同步 | **不做** | 双向同步需行映射，投入产出比极低；切换时各自记 `previewScroll`/`scroll` 再恢复 |
| 外链 | `ctx.uiWorkspace.openExternal` + `rel="noreferrer noopener"` | 不直接 `window.open` |

组件骨架（`frontend/views/editor/MarkdownPreview.tsx`，类名 `wid-md-preview`，props 来自 store，不持状态）：`<Markdown remarkPlugins={[remarkGfm]} components={{ a: ExtLink, code: HighlightedCode, iframe: () => null, script: () => null }}>{text}</Markdown>`。

## 13. 性能手段与验收数字

| 手段 | 做法 |
| --- | --- |
| 批量事务 | 分页追加、初始装饰各合并进**一个** transaction，且 `addToHistory:false` |
| 不每键 setState | `updateListener` → `EditorRuntime`（Map）→ 100 ms 节流写 Zustand；只有 `dirty` 立即写 |
| 昂贵比较 | `doc.eq` 放 `requestIdleCallback`，主线程只做 `doc.length` 快路径 |
| 预取 | `PREFETCH_CHARS = 200*80`；`pageLoading` 互斥，失败后 2 s 内不重试 |
| 主题/标签切换 | `reconfigure` 而非 `setState`；`display:none` + `requestMeasure` 而非 `destroy` |

验收口径（`performance.mark/measure` 埋点，`?ideDebug=1` 打 console）：

| 场景 | 起点 → 终点 | 目标 | 备注 |
| --- | --- | --- | --- |
| 1 MB / ~2 万行 | `files.read` 发出 → 首帧且 `visibleRanges` 非空 | **≤ 120 ms** | ARCHITECTURE 硬指标，`full` |
| 8 MB | 同上 | **≤ 400 ms** | 必须 `noSyntax` 才达标 |
| 单行 5 万字符 | 同上 | **≤ 300 ms** | 自动关软换行（§7） |
| 续取一页（2000 行）/ 连续输入 50 键（1 MB） | 响应 → `dispatch` 完成 / 每次 update → 下一帧 | 主线程 **≤ 16 ms** | 无语法重算；`perfLog` 采样 p95 |
| 标签切换（10 个各 1 MB） | 点击 → 可交互 | **≤ 32 ms** | 只切 `display` |
| 面板首屏可交互 | slot 挂载 → 树可点 | **≤ 400 ms** | ARCHITECTURE 硬指标 |

## 14. 明确不做

| 项 | 结论 |
| --- | --- |
| LSP / 诊断 / 语义补全 | 不做：无 worker、无 server 进程，`@codemirror/lint` 不装 |
| minimap | **自绘 1 px 色块**替代：右侧 60 px `<canvas>`，每 4 行抽样取 `line.length` 映射 x 宽度，色 `var(--dsw-alias-label-quaternary)`；点/拖映射 `scrollTop`；不做语法着色 minimap |
| 按符号大纲 / breadcrumbs | 不做：需全量语法树 + 第二套导航模型 |
| 多光标 | **CM6 自带 `allowMultipleSelections` 保留**（Alt+点击）；不做 VS Code 的 `Mod-d`「选下一个同词」 |
| 嵌入式终端 / 格式化 / 编码转换 | 不做：终端属 terminal 模块；无 formatter 就不做假成功；编码只提示 + Latin-1 只读（§6） |

## 与契约的差异（已复核：全部并入契约 v2）

| # | 初版需求 | 契约 v2 实际 | 落地注意 |
| --- | --- | --- | --- |
| 1 | `git.diff` 需要整文件上下文 | 已定义 `context: -1` = 整文件 hunk | 受 `diffBytesMax/diffLinesMax` 约束；`truncated` 时两栏 diff 降级为单栏 hunk |
| 2 | `Hunk` 缺「末尾无换行」 | 改为 Hunk 级 `oldNoEol/newNoEol` | 左右两侧各一个布尔，不要靠正则扫原始 patch |
| 3 | `files.stat` 缺 `writable` | 已有 `writable: boolean` + `mode: number` | 只读文件提前禁用保存并说明原因 |
| 4 | `files.read` 分页版本一致性 | 已加可选 `expectedVersion` | 版本不一致 → 整体重载，不许拼接两页 |
| 5 | `files.write` 缺 `force` | 已有 `force?: boolean`（要求 trusted） | 只有用户明确点「覆盖」才传 |
| 6 | 单行长度阈值不在 `limits` | 已加 `limits.longLineChars: 10000` | 关软换行 + 关高亮的判据统一走它 |
| 7 | diff 行号基准未声明 | 已声明 1-based、`oldLines/newLines` 可为 0 | 「跳到 hunk」与暂存按钮定位直接用它 |

**仍待实现期确认（不是契约缺口）**：`MergeView` 的 `diffConfig{timeout:1500, scanLimit:50000}` 与 Host 侧 `diffLinesMax:50000` 是否会造成「客户端先超时而 Host 仍完整」的不一致——建议统一取 `limits.diffLinesMax`。

## 实现补充（代码为准）

- Markdown 预览不是完整 CommonMark：`frontend/editor/markdown.js` 自实现标题/围栏代码/引用/列表/分隔线/段落与行内 `code`/粗体/斜体/删除线/链接，全部渲染成 React 元素，永不用 `dangerouslySetInnerHTML`（README 无法注入标记）。需要完整语法时按 `docs/build.md` 的体积规则另行评审，不要临时加依赖。
- 预览是每个标签独立的开关（`editor.previews[path]`），切换不丢缓冲区、不重挂载 CodeMirror（保 undo 历史）。
- 大文件与软换行降级阈值不变；Markdown 预览同样受 `syntaxMaxBytes 4MB` 限制，超限只显示源码。
