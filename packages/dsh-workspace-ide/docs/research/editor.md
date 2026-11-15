# DSH 插件「文件查看 + 编辑 + 语法高亮」技术选型调研

调研时间：2026-11-13。所有版本号、体积、默认值均来自当时的 npm registry、官方文档或本机对 npm tarball 的实测；无法实测或没有公开数据的地方都显式标注。

标注约定：

- **【实测】** 本次调研在本机量出来的数字（`npm pack`/tarball 解包后 `wc -c` 与 `gzip -9`，或 bundlephobia API 的 min+gzip）。
- **【官方】** 官方文档/源码里的原文或常量。
- **【估算】** 由【实测】数字推算，非直接测量。
- **【无公开数据】** 明确没有找到可信数据，不要当结论用。

---

## 0. 结论先行

| 用途 | 选型 | 一句话理由 |
| --- | --- | --- |
| **编辑**（读为主 + 保存） | **CodeMirror 6**：`@codemirror/{state,view,commands,search,language,autocomplete}` + 按需 Lezer 语言包 | 全套 basicSetup 118.75KB gzip【实测】，**零 CSS 文件、零字体、零 worker**，viewport 渲染，`@codemirror/merge` 与编辑器同源，全 MIT。 |
| **只读预览**（默认路径） | **同一个 CM6 实例的只读模式**：`EditorState.readOnly` + `EditorView.editable.of(false)` | 编辑预算已经付过，只读复用**边际体积 0**，还白拿 find / 跳转行 / 选区复制 / 折叠 / 准确的滚动高度。 |
| **只读预览**（补充路径） | **Shiki 静态高亮 + `@tanstack/react-virtual` 行虚拟列表** | 只在「多实例预览（列表里几十个片段）、Markdown 代码块、需要与 VS Code 主题像素级一致」时用；比开编辑器实例省内存，但**不是**默认首选（见 §4.4）。 |
| **Diff** | **`@codemirror/merge`**：`MergeView`（左右分栏）/ `unifiedMergeView`（单栏内联） | 与编辑器同一份 `Text`/`Extension`，`diffConfig.timeout`/`scanLimit` 有内置降级护栏【官方】；纯粹的 unified patch 文本用 `diff`（jsdiff）`parsePatch` 解析。 |
| **语法高亮引擎** | 编辑/只读主路径：**Lezer**（CM6 自带，增量）；Markdown 与「精确配色」路径：**Shiki**（`createHighlighterCore` + JS regex engine 或 oniguruma） | Lezer 增量解析适配 1MB 编辑；Shiki 才有 TextMate/VS Code 主题，但**全量 tokenize** 的代价只适合只读。 |
| **语言探测** | 构建期从 `linguist-languages` codegen 成静态表，运行时零依赖 | 833 种语言带 extensions/filenames/interpreters/aliases【实测】；运行时全量打包 39.7KB gzip 不值，codegen 后约 10–20KB。 |
| **Markdown** | `react-markdown` + `remark-gfm` + 自写 Shiki rehype 插件（复用已建 highlighter） | 34.1 + 9.6KB gzip【实测】，比 `rehype-pretty-code`(65.8) / `rehype-highlight`(47.5) 更省且与代码块配色统一。 |
| **明确不选** | **Monaco Editor** | 核心 **602KB gzip** + CSS **124KB** + `editor.worker` **80KB** ≈ 800KB gzip，是 CM6 全套的 **6.7×**【实测换算】；单 bundle 下 worker/CSS/字体全要自己糊；而且 Monaco **不支持 TextMate**（它用 Monarch），"VS Code 同款高亮"这个卖点本身不成立。 |

**一句话总纲**：VS Code 的真实路线是「Monaco 视图层 + TextMate(Oniguruma) 语法 + 视口渲染 + 后台时间切片 tokenize」。我们在**单文件 esbuild IIFE（不拆 chunk、无独立 worker 文件、无 assets 目录）**约束下对齐「视口渲染」和「TextMate 语法」，放弃「Monaco 视图层与 worker 体系」，用 CM6 + Shiki 拼出等价能力，体积代价从 ~800KB gzip 降到 ~150KB gzip（编辑）+ 155KB（只读 Shiki，可选）。

> **关于 `IIFE`**：本报告的默认打包目标已按 **单文件 IIFE** 校准（见 §9）。三个候选在 IIFE 下的结论一句话版：**CM6 零障碍**（无 CSS/无字体/无 worker/无动态 import 需求）；**Shiki 可行**（wasm 走 `wasm-inlined` 内联或干脆换 JS engine 不用 wasm，动态 `import()` 会被 esbuild 内联成惰性初始化函数）；**Monaco 勉强可跑但代价最大**（worker 必须 blob 内联、100 个 CSS 文件必须构建期内联、`codicon.ttf` 必须 dataurl、AMD 已弃用），且体积是 CM6 的 6.7 倍。

---

## 1. 先把「VS Code 的路线」说清楚（问题 8）

### 1.1 桌面 VS Code 的实际构成

- **视图/编辑层**：Monaco Editor 内核（同一份代码在 VS Code 里叫 `vs/editor`）。
- **语法着色**：**TextMate grammar**，由 `vscode-textmate`（解释器）+ `vscode-oniguruma`（Oniguruma 编译成 WebAssembly）执行。**不是** Monarch。
- **语义能力**：LSP / 语言服务（TS server、JSON schema 等），走 worker 或独立进程。
- **大文件策略**（源码常量，microsoft/vscode `src/vs/editor/common/model/textModel.ts`）【官方】：

  | 常量 | 值 | 含义 |
  | --- | --- | --- |
  | `LARGE_FILE_SIZE_THRESHOLD` | `20 * 1024 * 1024`（20MB） | 超过则「永不 tokenize」 |
  | `LARGE_FILE_LINE_COUNT_THRESHOLD` | `300 * 1000`（30 万行） | 同上 |
  | `LARGE_FILE_HEAP_OPERATION_THRESHOLD` | `256 * 1024 * 1024`（2.56 亿字符） | 禁用重内存操作 |
  | `_MODEL_SYNC_LIMIT` | `50MB` | 不参与同步 |
  | `LONG_LINE_BOUNDARY` | `10000` | 单行超过 1 万字符的判定 |
  | `LIMIT_FIND_COUNT` | `999` | 查找结果上限 |

  原文注释（决定性的一句）：

  > `// !!! Make a decision in the ctor and permanently respect this decision !!!`
  > `// If a model is too large at construction time, it will never get tokenized, under no circumstances.`

  以及大文件下直接关掉软换行（`word wrap`）：`// Cannot word wrap huge files anyways, so it doesn't really matter`。

- **tokenize 调度**：`DefaultBackgroundTokenizer` 用 `runWhenGlobalIdle(deadline)`，在空闲回调里按 deadline 切片，**每次至少干 1ms 就 `setTimeout0` 让出主线程**；编辑器未挂载或没有待处理行就不干活【官方源码】。
- **渲染**：只渲染视口内可见行（`ViewLines`），滚动时按行高估算 + 实测校正——这一点 CM6 与之一致。

### 1.2 一个常被搞错的事实：Monaco ≠ TextMate

`monaco-editor` 的 README FAQ【官方】直接写：

> ❓ **Why doesn't the editor support TextMate grammars?**
> Please see https://github.com/bolinfest/monaco-tm which puts together `monaco-editor`, `vscode-oniguruma` and `vscode-textmate` to get TM grammar support in the editor.

也就是说：**开源 Monaco 的默认高亮是 Monarch（手写状态机词法器）+ 84 种 `basic-languages` 定义**，要 TextMate 得自己接社区 monaco-tm。反过来说，**Shiki 恰恰就是 TextMate 路线**（`@shikijs/core` 依赖 `@shikijs/vscode-textmate@10.1.0`【实测】）。所以「和 VS Code 一样的高亮」这个需求，CM6+Shiki 比 Monaco 更贴近。

### 1.3 我们能对齐 / 必须妥协

| VS Code 的做法 | 我们能否对齐 | 说明 |
| --- | --- | --- |
| 视口渲染（只渲染可见行） | ✅ 完全对齐 | CM6 `EditorView` 天然如此，官方文档 §Viewport 明说只渲染可见 + 边距。 |
| TextMate 语法 + VS Code 主题 | ✅ 对齐（Shiki） | 但**只在只读/静态路径**划算；编辑路径用 Lezer（见 §4.4）。 |
| 长行保护（10000 字符） | ✅ 可对齐 | 自己加检测 + 降级（§8）。 |
| 大文件阈值（20MB / 30 万行）| ✅ 可对齐 | 直接照抄这两个数，改渲染层。 |
| 后台时间切片 tokenize | ⚠️ 部分 | CM6 的 Lezer 是「按视口拉动 + 有工作预算」，语义不同但效果等价；Shiki 全量 tokenize 没有切片能力，必须放到 worker 或只读小文件。 |
| **Web Worker 语言服务** | ❌ 基本放弃 | 单 ESM bundle + 无静态资源服务，worker 只能 blob 内联；CM6 本身不需要 worker，这是它最大的工程红利。 |
| Monaco 视图层（diff editor/装饰/overview ruler） | ⚠️ 功能换实现 | CM6 的 merge/decoration 覆盖 90%，overview ruler 这类要自绘或不做。 |

---

## 2. Monaco Editor（问题 1）

### 2.1 版本与许可证

| 项 | 值 |
| --- | --- |
| 最新版 | **0.57.0**，发布 2026-09-24【实测 npm registry】 |
| 许可证 | **MIT** ✅ |
| 运行时依赖 | `marked@14.0.0`、`dompurify@3.4.15`（0.57 起带 DOMPurify，用于把 markdown hover/文档当不可信内容处理）【实测】 |
| 包体积 | tarball 18.5MB；解包 **99.3MB**（`min/` 25MB、`esm/` 32MB、`dev/` 44MB）【实测】 |

### 2.2 体积（实测，逐个文件 gzip -9）

| 产物 | raw | **gzip** | 说明 |
| --- | --- | --- | --- |
| `min/vs/editor-BdtEMBbM.js` | 2414KB | **602KB** | 编辑器核心 + 全部 66 个 features，**不含**语法定义 |
| `min/vs/editor/editor.main.css` | 381KB | **124KB** | 全部组件样式（必须一起进 bundle） |
| `min/vs/assets/editor.worker-*.js` | 269KB | **80KB** | 基础 worker（tokenize / 模型同步） |
| `min/vs/assets/json.worker-*.js` | 397KB | 117KB | JSON 语言服务 |
| `min/vs/assets/css.worker-*.js` | 1029KB | 232KB | CSS/SCSS/Less 语言服务 |
| `min/vs/assets/html.worker-*.js` | 700KB | 183KB | HTML/Handlebars/Razor |
| `min/vs/assets/ts.worker-*.js` | 6869KB | 1502KB | TypeScript/JavaScript 语言服务（**绝不要装**） |
| `min/vs/loader.js`（AMD loader） | 38KB | 10KB | 仅 AMD 路径需要 |
| 语言定义 chunk | 107 个文件 | 单个 0.3–18KB | 84 种语言，按需动态加载 |

**只读/纯查看的最小可行集合（估算）**：core 602 + CSS 124 + `editor.worker` 80 ≈ **806KB gzip**，还没算任何语言定义。反过来，社区事故可以交叉验证这个量级：

- SigNoz issue #12692：有人把 `import * as monaco from 'monaco-editor'` 放进入口，**entry chunk gzip 从 912KB 涨到 1881KB（+969KB）**，其中 monaco 渲染后约 6.8MB。
- yscope-log-viewer issue #260：仓库里量到 monaco「2.7MB uncompressed / 706.49KB compressed」。

### 2.3 ESM 打包方式，以及 0.53/0.56 的两次破坏性变更

- **0.53.0**：`AMD` 构建被弃用（changelog 原文：*"This release deprecates the AMD build … Please migrate to the ESM build"*），`browser-script-editor` 那种不用打包器的同步加载方式不再工作，自定义 AMD worker 也不再开箱即用。
- **0.56.0**：**重组 ESM 入口，提供可 tree-shake 的入口点**（PR #5155）。现在的官方入口【实测解包确认】：
  - `monaco-editor/editor` → `esm/vs/editor.js`，只导出 API，不注册任何 features；
  - `monaco-editor/features/register.all`（66 个 feature，可单个 `features/<name>/register`）；
  - `monaco-editor/languages/definitions/register.all`（84 种语言，可单个 `languages/definitions/<lang>/register`）；
  - `monaco-editor/languages/features/register.all`（css / html / json / typescript 四个语言服务）；
  - 默认入口 `monaco-editor` 仍然「全都要」。
- **`exports` map 陷阱【实测】**：`package.json` 里是
  ```json
  "exports": { ".": { "import": "./esm/vs/index.js" }, "./*.js": "./esm/vs/*.js", "./*": "./esm/vs/*.js" }
  ```
  所以子路径**不要**再写 `esm/vs/`：正确是 `monaco-editor/editor/editor.api`，写成 `monaco-editor/esm/vs/editor/editor.api` 会被解析成 `esm/vs/esm/vs/...` 而失败。网上大量旧文章还是老写法。

### 2.4 worker 在「esbuild + 单 bundle」里怎么处理

d.ts 里的官方钩子【实测 `monaco.d.ts` §Environment】：

```ts
interface Environment {
  baseUrl?: string;
  getWorker?(workerId: string, label: string): Promise<Worker> | Worker;  // 优先
  getWorkerUrl?(workerId: string, label: string): string;                 // 次选
}
```

结论：

1. **`getWorker` 返回 `new Worker(blobUrl)` 是可行且被类型签名支持的**，不依赖任何静态资源服务。代价是 worker 源码要以字符串形式进主 bundle（二次构建：先把 `monaco-editor/editor/editor.worker` 用 esbuild 打成 IIFE，再以 text loader 内联），80KB gzip 的 worker 变字符串后 gzip 基本不变（js 文本压缩率与 base64 不同，`Blob` 里是原文，不会膨胀 33%）。
2. `getWorkerUrl` + `blob:` 也可以（返回一个指向 Blob 的 URL），但多一次 fetch 语义，没有必要。
3. **`@monaco-editor/loader` / `@monaco-editor/react` 默认走 CDN**：README 原文 *"By default, `monaco` files are being downloaded from `CDN`"*，配置项是 `loader.config({ paths: { vs: '...' } })`。离线场景必须 `loader.config({ monaco })` 把本地包塞进去（4.4.0 起支持）。**在 DSH 里 CDN 路线直接判死**（离线 + 无外网假设）。
4. `AMM` 之外还有个现实问题：Monaco 的 worker 不是可选的。没有 worker 时语言服务报 "Could not create web worker"，编辑器会降级但仍能用——对「只读文本」够用，对「编辑+补全」不够。

### 2.5 能不能靠「只读模式」把包减下来

能减，但减不到 CM6 那个量级。0.56+ 的 `features/<name>/register` 允许按需注册，源码体积证据（`esm/vs/editor/contrib/` 各目录 raw 体积，**未 gzip**）【实测】：

| feature | raw 源码体积 | 是否可裁（纯查看场景） |
| --- | --- | --- |
| `inlineCompletions` | 804KB | ✅ 必裁 |
| `suggest` | 264KB | ✅ 必裁 |
| `hover` | 224KB | ✅ 可裁 |
| `find` | 200KB | ⚠️ 建议保留（要搜索） |
| `gotoSymbol` | 156KB | ✅ 可裁 |
| `folding` | 136KB | ⚠️ 保留 |
| `colorPicker` / `codeAction` / `snippet` | 132 / 128 / 108KB | ✅ 可裁 |

参照系：`esm/vs/editor/{common,browser,standalone,contrib}` = 2664 + 2132 + 328 + 3548 = **8.6MB raw**，`base/browser` 1.5MB、`platform` 1.5MB。裁掉上面前 6 个大约去掉 1.8MB raw（**约 20%**），**gzip 后能省多少没有公开数据【无公开数据】**，别信"能减到 200KB"这类说法。保守估计：tree-shake 后仍在 **450–550KB gzip** 区间【估算】。

### 2.6 大文件性能

- **官方行为**：`largeFileOptimizations` 默认 `true`（`monaco.d.ts` 原文：*"Special handling for large files to disable certain memory intensive features"*）。开启时按 VS Code 的两个阈值（20MB / 30 万行）**永久**关闭 tokenize。
- **关键坑**：阈值之下的文件是要**全量 tokenize** 的。10MB / 约 30 万行正好卡在边缘；5MB 级别的文件会老老实实跑完整 Monarch 词法，主线程被打满。GitHub issue **#2054「Too aggressive tokenization」** 就是这类报告（长文档"几乎所有时间都花在 tokenizing"）。
- **长行**：`maxTokenizationLineLength` 默认 **20000**（超过的行不 tokenize），`stopRenderingLineAfter` 默认 **10000**（超过的字符不渲染）。这两个值同时也是我们降级策略的参照（§8）。
- **结论**：Monaco 在 10MB 文本上不是"不卡"，而是"靠关掉语法来不卡"。这一点和 CM6 的差别是：CM6 是**按需**解析（视口拉动），Monaco 是**全量后切片**。

### 2.7 diff editor

`monaco.editor.createDiffEditor` 可用且成熟，d.ts 里的默认值【实测】：

| 选项 | 默认 | 备注 |
| --- | --- | --- |
| `renderSideBySide` | `true` | 还有 `useInlineViewWhenSpaceIsLimited` / `renderSideBySideInlineBreakpoint` 自动切内联 |
| `diffAlgorithm` | `'advanced'` | 可选 `'legacy' \| 'advanced' \| 'advanced-external' \| 'advanced-wasm'`（0.56 新增后两个） |
| `maxComputationTime` | **5000ms** | 超时取消 diff 计算 |
| `maxFileSize` | **50MB** | 超过直接不 diff |
| `ignoreTrimWhitespace` | `true` | |
| `hideUnchangedRegions` | 关闭 | `{enabled, revealLineCount, minimumLineCount, contextLineCount}` |
| `originalEditable` | `false` | |
| `experimental.useTrueInlineView` | `false` | 真正的行内 diff（仅 `renderSideBySide: false`） |

注意：**包里没有任何 `.wasm` 文件**【实测 `find -name "*.wasm"` 结果为 0】，所以 `advanced-wasm` 的 wasm 只能是以内联形式在 JS 里，选它会额外吃体积；默认 `advanced` 更划算。

### 2.8 主题与 React 集成

- 主题：内置 `vs` / `vs-dark` / `hc-black` / `hc-light`，自定义用 `monaco.editor.defineTheme` + `setTheme`；还有 `autoDetectHighContrast`（默认 true，会覆盖你的主题，注意关掉）。是 VS Code **主题 JSON 的超集子集**，可以吃 `.json` 主题但需要转换器（社区有 `monaco-themes`，本次未评估质量）。
- React：`@monaco-editor/react@4.7.0`（4.7KB gzip【实测】，peer 依赖 `react`,`react-dom`,`monaco-editor`）本质是「loader + 生命周期 wrapper」；`useMonaco()` 首次返回 `null`（异步初始化）。**离线场景必须先 `loader.config({ monaco })`**，此时它的价值只剩「DiffEditor 组件的 props 转发」，自己写 100 行 wrapper 更可控。**不建议**引入。

### 2.9 小结：为什么不用 Monaco

1. **体积差 6.7 倍**：806KB gzip（还不含语言）vs CM6 全套 118.75KB。
2. **单 bundle 摩擦**：worker 要二次构建内联、100 个 CSS 文件要处理、`codicon.ttf` **149KB**【实测】要 base64 内联（≈200KB raw 字符串）、AMD 已弃用而 ESM 入口在 0.56 刚被重组（生态文章大面积过期）。
3. **"和 VS Code 一样"是伪需求**：Monaco 用 Monarch 不是 TextMate（§1.2）。
4. **它唯一的不可替代优势是成熟 diff editor**，而 `@codemirror/merge` 已覆盖 90%（§7），且能和编辑器共享同一份 doc/theme。

---

## 3. CodeMirror 6（问题 2）

### 3.1 版本与许可证（全部 MIT ✅）

| 包 | 版本 | 发布 | 说明 |
| --- | --- | --- | --- |
| `codemirror`（meta / basicSetup） | 6.0.2 | 2025-06-19 | 只是一组 import + 数组，**代码在子包里** |
| `@codemirror/state` | 6.7.6 | 2026-09-22 | 文档模型/事务（依赖 `@marijn/find-cluster-break`） |
| `@codemirror/view` | 6.43.15 | 2026-10-19 | DOM 渲染层（依赖 `style-mod`、`w3c-keyname`、`crelt`） |
| `@codemirror/language` | 6.13.1 | 2026-10-07 | Lezer 集成/折叠/缩进（依赖 `@lezer/{common,highlight,lr}`、`style-mod`） |
| `@codemirror/commands` | 6.11.1 | — | 键位/历史 |
| `@codemirror/search` | 6.7.2 | — | 搜索面板 + `SearchCursor` |
| `@codemirror/autocomplete` | 6.20.4 | — | 补全 |
| `@codemirror/lint` | 6.9.8 | — | 诊断 |
| `@codemirror/merge` | 6.12.3 | 2026-10-19 | diff/merge 视图 |

### 3.2 体积（bundlephobia min+gzip，**含各自依赖**，所以不可相加）

| 包 | min | **gzip** |
| --- | --- | --- |
| `codemirror`（= basicSetup 全家桶） | 373KB | **118.75KB** |
| `@codemirror/view` | 244KB | 79.7KB |
| `@codemirror/state` | 48KB | 16.1KB |
| `@codemirror/language` | 270KB | 86.7KB |
| `@codemirror/commands` | 280KB | 89.6KB |
| `@codemirror/search` | 229KB | 73.1KB |
| `@codemirror/autocomplete` | 296KB | 95.4KB |
| `@codemirror/lint` | 238KB | 75.6KB |
| `@codemirror/merge` | 285KB | 91.4KB |
| `@codemirror/theme-one-dark` | 230KB | 74KB |
| `@uiw/react-codemirror` | 159KB | 51.8KB |

真实数字要理解成：**`codemirror` 的 118.75KB 已经把 state/view/language/commands/search/autocomplete/lint 全包了**，再加语言包只增语法部分。

**与本仓库实测对齐**【Lead 实测，2026-11-13】：CM6 全量（**13 种语言 + `@codemirror/merge` + `theme-one-dark`**）经 esbuild minify 后**单文件 1025KB**，产物**无 Worker、无动态 import**。按 min→gzip 经验比 0.31 折**约 320KB gzip**【估算】。这个数比本报告 §10 的保守估算（≈300KB 级）吻合，可视为本方案的体积基线。

实测 `codemirror@6.0.2` 的 `dist/index.js` 里 `basicSetup` 恰好是这 18 项 + 6 组 keymap【实测源码】：

```
lineNumbers, highlightActiveLineGutter, highlightSpecialChars, history, foldGutter,
drawSelection, dropCursor, EditorState.allowMultipleSelections, indentOnInput,
syntaxHighlighting(defaultHighlightStyle,{fallback:true}), bracketMatching,
closeBrackets, autocompletion, rectangularSelection, crosshairCursor,
highlightActiveLine, highlightSelectionMatches,
keymap.of([closeBracketsKeymap, defaultKeymap, searchKeymap, historyKeymap,
           foldKeymap, completionKeymap, lintKeymap])
```

### 3.3 有没有 worker / 有没有 CSS 资产

- **没有 worker**：官方 System Guide 全文 **0 次**提到 worker【实测 grep】。解析在主线程做，Lezer 是增量 + 有工作预算（见 3.4）。
- **没有 CSS 文件、没有字体**：样式通过 `style-mod` 在运行时 `StyleModule.mount()` 注入 `<style>`【实测 style-mod README + view 的依赖】。对「CSS 只能构建期转字符串」这个约束来说，这是**白送**的适配（不需要 css loader 黑魔法）。唯一注意点：如果宿主 CSP 禁 `style-src 'unsafe-inline'`，需要放开（Electron 默认没这么严）。

### 3.4 大文件策略与实测证据

- **viewport 渲染**（System Guide §Viewport 原文要点）：文档大时**不渲染全文**，只渲染「当前可见 + 一圈边距」，叫 viewport；视口外坐标查询不可用（没布局），但**全文行高有估算 + 实测校正**（`lineBlockAtHeight`）；长行（不折行）或大片折叠代码会让 viewport 变得很大，所以提供 `visibleRanges` 供「按可见范围干活」（例如高亮）。
- **官方 Huge Document demo**（`codemirror.net/examples/million/`）原文：*"This page loads a document of a few million lines, to demonstrate how CodeMirror performs on documents that size. You'll notice that highlighting stops at some point if you scroll down far enough. The parser contains logic that limits the amount of work it does to avoid wasting too much battery and memory. If the editor is inactive, it'll stop doing work entirely."*——**这是「几百万行」级别唯一的官方口径**。
- **作者本人的口径**（discuss.codemirror.net/t/9895）：*"It should perform very well even for large documents, but some extensions, like for example linting, act on the whole document so they'll become noticeably slow at some point."*
- **已知代价**（discuss.codemirror.net/t/5569）：大文档快速拖动滚动条时，高亮会滞后甚至「暂时消失」，回滚后由解析预算慢慢补上。这是**设计行为**，但对"查看大文件"体验有感知，需要在 UI 上接受（或对大文件关掉语法，§8）。

> **【无公开数据】** 没有找到「10MB 文本在 CM6 里的首帧/滚动帧时间」这类可引用的 benchmark。所有"CM6 比 Monaco 快 N 倍"的截图式对比（例如某些仓库里的自测表格）都不带可复现环境，本报告不采信。

### 3.5 语言覆盖

- **官方 `@codemirror/lang-*` 共 22 个**【实测 npm search】：`angular, cpp, css, go, html, java, javascript, jinja, json, less, lezer, liquid, markdown, php, python, rust, sass, sql, vue, wast, xml, yaml`。
- Lezer grammar 的 gzip 体积（含各自依赖）【实测】：

  | grammar | gzip | | grammar | gzip |
  | --- | --- | --- | --- | --- |
  | `@lezer/cpp` | 49.2KB | | `@lezer/html` | 24.2KB |
  | `@lezer/javascript` | 46.2KB | | `@lezer/css` | 24.5KB |
  | `@lezer/rust` | 45.7KB | | `@lezer/markdown` | 22KB |
  | `@lezer/java` | 34.9KB | | `@lezer/yaml` | 20.7KB |
  | `@lezer/python` | 31.7KB | | `@lezer/xml` | 19.3KB |
  | `@lezer/go` | 27.2KB | | `@lezer/json` | 17.4KB |
  | `@lezer/lr` | 14.8KB | | | |

- **`@codemirror/legacy-modes@6.5.5`**：**103 个** StreamLanguage 模式（tarball 里 `mode/` 下 103 个 `.js`），1913KB 解包 / 315 文件【实测】。覆盖 PHP、Ruby、Shell、Perl、Tcl、Verilog、PowerShell、Erlang、Haskell、Smalltalk……**但**：StreamLanguage 是**逐行正则状态机**，没有 AST、没有折叠结构、没有缩进推断，性能也不如 Lezer。定位：**兜底**（让冷门语言至少有颜色），不进主 bundle。

### 3.6 diff：`@codemirror/merge`

- `MergeView`：左右两栏对比（`a`/`b` 各给 `doc` + `extensions`）。
- `unifiedMergeView({ original, highlightChanges, gutter, syntaxHighlightDeletions, syntaxHighlightDeletionsMaxLength, allowInlineDiffs, mergeControls, diffConfig, collapseUnchanged })` + `uncollapseUnchanged` effect【实测 d.ts】。默认值里两个值得记：`syntaxHighlightDeletions` 默认开（用主编辑器语言高亮被删片段，**不是**完整文档所以有时很怪，可关），`syntaxHighlightDeletionsMaxLength` 默认 **3000**。
- **性能护栏**（`DiffConfig`，原文）【实测】：
  - `scanLimit`：限制全量（昂贵）diff 的深度，超过就退回"更快但更粗糙"的算法，避免大而不同的输入退化成二次复杂度；
  - `timeout`：运行超过 N 毫秒就放弃精细 diff 退回粗糙算法；
  - `override`：可换自己的 diff 算法。
  这三个就是「大文件不卡死」的开关，必须显式设置（§8）。

### 3.7 主题体系

`EditorView.theme({...})` 管"编辑器外观"，`syntaxHighlighting(HighlightStyle.define([...]))` 管"语法配色"。要做 VS Code 的 Dark+ / Light+，实际工作量是**一份 HighlightStyle（~60 行 tag→颜色）+ 一份 200 行 CSS**，`@codemirror/theme-one-dark` 是现成参考实现（它的 74KB gzip 里绝大部分是 state/view 依赖，独立代码只有几 KB）。**不建议**再引第三方主题库（`@uiw/codemirror-themes` 一系列），配色这种一次性的东西不值得增加依赖面。

### 3.8 React wrapper

- `@uiw/react-codemirror@4.25.12`（51.8KB gzip，含 `codemirror` meta，peer 里有 `react`/`react-dom`/`codemirror`）。功能全（受控/非受控、基本主题、`extensions` 透传）。
- 但它把 `codemirror` meta 与一批默认扩展一起拉进来，且版本节奏跟 `@codemirror/view` 不同步时容易出"两份 state"的诡异 bug。
- **推荐自写 wrapper**（~40 行）：`useRef` 建 `EditorView`，`doc` 变化时 `dispatch({changes})`（或直接重建 state，只在换文件时），`useEffect` 清理 `view.destroy()`。React 18/19 的 StrictMode 双调用要处理好（`destroy` 后再建）。

---

## 4. 语法高亮引擎（问题 3）

### 4.1 候选横评

| 方案 | 许可证 | gzip 体积【实测】 | 主题 | 语言覆盖 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **Shiki 4.6.0** | MIT | core 35.1KB + engine-oniguruma 2.6KB + **wasm 内联 155KB**（`wasm-inlined.mjs` 207KB raw）+ 语言 1–32KB/个 + 主题 2–6KB/个 | ✅ 直接吃 TextMate/VS Code 主题（66 个内置） | **361 种**语言 | 官方口径：`bundle/full` 6.4MB min / **1.2MB gzip**；`bundle/web` 3.8MB / **695KB gzip**（含异步 chunk） |
| **Shiki + JS engine** | MIT | core 35.1 + `engine-javascript` **19KB** + `@shikijs/langs-precompiled`（js 17KB、cpp 44KB…） | ✅ 同上 | 361（3.9.1 起全支持） | **不需要 wasm**；precompiled 语言把 Oniguruma 正则预编译成 JS RegExp |
| `vscode-textmate` + `vscode-oniguruma` 自建 | MIT | textmate 16.4KB + oniguruma 7KB + **`onig.wasm` 462KB raw / 147KB gzip** | 需自己实现主题解析 | 取决于你收的 grammar | 等于自己重写半个 Shiki，不划算 |
| **highlight.js 11.12** | BSD-3 | 本体 307KB（full）；`core` + 单语言约 5–20KB | ❌ 自己的 CSS class | ~190 | 无 AST、无主题兼容；`rehype-highlight` 走 lowlight 47.5KB |
| **Prism 1.30** | MIT | 7.1KB（core）+ 每语言 1–5KB | ❌ | ~300（非官方为主） | 最轻，但没有 TextMate 主题、无行内 token 精度 |
| **DSH 自带代码块** | — | — | — | — | 在 `app.asar` 里 grep 到 `codeToTokens`/`codeToHtml` 与 `shiki` 标识，**没有** `highlight.js`/`prismjs`/`monaco-editor`/`@codemirror/*` 命中【实测】——即 DSH 前端代码高亮是 Shiki 路线。可参考其用法，但按约束不得依赖。 |

**wasm 内联的真实代价（关键）**：`@shikijs/engine-oniguruma@4.6.0` 的 `dist/wasm-inlined.mjs` 是 **207KB raw / 155KB gzip**，开头是 `Uint8Array.from(atob("H4sIA…"))`——注意 `H4sIA` 是 gzip 魔数，即 **Shiki 已经把 wasm 先 gzip 再 base64**，运行时 `atob` + `DecompressionStream` 还原。对比 `vscode-oniguruma` 原始的 `onig.wasm` 462KB raw / 147KB gzip：**Shiki 的内联方案已经把代价压到最低（155KB gzip）**，比"自己 base64 一个 462KB wasm"（≈616KB raw 字符串）省得多。

### 4.2 Shiki 与 CodeMirror 的桥

- **官方没有** `@shikijs/codemirror`（npm 404）；官方文档侧栏只列了 markdown-it / rehype / Monaco / VitePress 等集成。
- 社区实现：**`codemirror-shiki@0.3.0`**（MIT，2025-07-19，**零运行时依赖**，解包 56KB，peer `shiki>=2` / `@codemirror/view^6` / `@codemirror/state^6`）【实测】。用法是 `shiki({ highlighter, language, theme })` 返回 `Extension[]`；内部是 `ViewPlugin` + `Decoration.mark`，配了 `markDecorationCache`（按颜色复用 mark decoration），并且只对"从首行开始的一段"做异步 tokenize，更新时用 `changes.touchesRange` 做增量重算。
- **它的限制**（决定我们不能全押它）：需要 **同步 highlighter**（`createHighlighterCore` 预先 `loadLanguage`），tokenize 是**整段字符串**级；大文件滚动时会反复触发整段重算，与 §3.4 的「解析预算」不是一回事。**结论：只读场景可用，1MB 编辑场景不要用。**

### 4.3 语言/主题包体积（决定我们带多少语言）

- `@shikijs/langs@4.6.0`：**361** 个语言模块，`dist` 共 10MB【实测】。单语言 gzip：javascript 16KB、typescript 15KB、cpp 32KB、python 9KB、html 11KB、css 12KB、markdown 5KB、go 5KB、java 4KB、yaml 2KB、json ≈0。
- `@shikijs/langs-precompiled@4.6.0`：同样 361 个，`dist` 10MB；单语言 gzip 略大（javascript 17KB、cpp 44KB），但**不需要 wasm**。
- `@shikijs/themes@4.6.0`：**66** 个主题；dark-plus 2KB gzip、light-plus 2KB、one-dark-pro 6KB。
- 动态 `import('@shikijs/langs/xxx')` 在 **esbuild `splitting:false`** 下会被内联进主 bundle（体积省不掉），所以"按需加载"在单 bundle 里等于"全带"，必须靠**显式白名单**控制带哪些语言。

### 4.4 关键问题：只读预览「静态高亮 + 虚拟列表」是否比编辑器更快？

分三段回答，**别一句话结论**：

1. **小于 ~256KB 的只读文件**：**静态路径更快、更省**。理由：没有 `EditorView` 的 measure/reflow 循环、没有扩展系统调度、没有光标/选区状态机；Shiki `codeToTokens` 一次出 token 数组，配 `@tanstack/react-virtual`（10.1KB gzip）只渲染可见行，内存是「字符串 + token 数组」。多实例场景（列表里几十个缩略预览）差距更明显——编辑器实例每个都要 mount DOM + 监听器。
2. **256KB ~ 2MB（我们的主战场）**：**CM6 只读实例更快**。因为此时静态路径的瓶颈变成"整文件 tokenize"（Shiki 全量 tokenize 与文件大小线性相关，且在主线程，1MB 中文/C++ 量级是几百毫秒级、会掉帧），而 CM6 只解析视口附近；更关键的是——**我们为了编辑已经付了 CM6 的 118KB gzip**，只读复用**边际体积 0**，还免费得到 find / 跳转行 / 选中复制 / 折叠 / 行号宽度自适应。自己用 div + 虚拟列表重写这些是纯亏。
3. **大于 2MB / 超长行**：两者都要降级（§8）。此时"静态 + 虚拟列表"的唯一优势是"可以只渲染纯文本，压根不碰语法"，但这用 CM6 只读 + 关语法同样能做到，且更省事。

**所以推荐**：主路径 = CM6 只读实例；静态 Shiki 路径只用于三处——(a) Markdown 代码块，(b) 侧栏/列表里的迷你预览（每屏十几个、不需要交互），(c) 需要"和 VS Code 主题逐像素一致"的导出/分享。

### 4.5 关键问题：编辑 1MB 文件，Lezer 还是 Shiki 装饰器？

**Lezer**，没有争议：

- Lezer 是**增量**解析：编辑一处只重解析受影响片段，且解析由视口拉动（System Guide: 解析预算、idle 停止）。1MB 文件里改一行，代价与文件大小基本无关。
- Shiki 装饰器（`codemirror-shiki`）每次需要**重新 tokenize 一段或全文**，1MB 下每次编辑都是几十到几百毫秒，直接毁掉输入延迟；而且 TextMate 的 line-state 语义和 CM6 的 doc 增量模型对不上（TextMate 是逐行状态栈，编辑器是字符级 patch）。
- 折中方案（可选）：**编辑用 Lezer，保存后/切到只读时用 Shiki 重刷**——收益不明显、状态容易打架，不建议。

### 4.6 关键问题：wasm 内联进单 bundle 的体积代价

| 方案 | 主 bundle 增量（gzip） | 是否需要静态资源 | 取舍 |
| --- | --- | --- | --- |
| oniguruma + `shiki/wasm`（`wasm-inlined`） | **+155KB** | ❌ 不需要（已 base64+gzip 内联） | 最省心，语言兼容性最好 |
| JS regex engine + `langs-precompiled` | **+19KB**（engine）+ 语言包（比 grammar 版 +0~30%） | ❌ 不需要 | 无 wasm，启动更快；3.9.1 起全语言支持 |
| ~~自起 host 路由提供 `.wasm`~~ | — | ❌ | **本约束下不可用**：不允许从 `/plugins/<pkg>/assets` 之类路径加载 wasm/字体，所以只剩"内联"和"不用 wasm"两条路 |
| 不用 Shiki（只用 Lezer） | +0 | ❌ | 编辑路径的默认选择 |

**结论**：如果 Shiki 只用于 Markdown 代码块 + 小文件预览，选 **JS engine + precompiled**（省 155KB 且无 wasm 加载失败风险）；如果要求"任何语言都能高亮、和 VS Code 完全一致"，选 oniguruma 内联 +155KB。

---

## 5. 文件类型/语言探测（问题 4）

| 候选 | 版本 | 许可证 | gzip | 数据 |
| --- | --- | --- | --- | --- |
| **`linguist-languages`** | 9.5.0（2026-08-30） | MIT | 39.7KB | **833 种**语言，字段含 `extensions` / `filenames` / `interpreters` / `aliases` / `tmScope` / `aceMode` / `codemirrorMode` / `codemirrorMimeType` / `languageId` / `type`【实测样例】 |
| `language-map` | 1.5.0（2021-10-13） | MIT | 23.7KB | 更小，但 **2021 年后停更**，且字段是 `extensions`+`mime`+`aceMode`，无 `interpreters`/`filenames` 的 GitHub 级覆盖 |
| Shiki `bundledLanguages` | 4.6.0 | MIT | 0（已在 shiki 内） | 361 个 lang id + 别名，只有"名字"，**没有扩展名映射** |

**推荐做法**：**构建期 codegen，运行时不带依赖**。

- 用 `linguist-languages` 生成一张扁平表：`ext → langId`（多对一）、`filename → langId`（`Dockerfile`/`Makefile`/`CMakeLists.txt`/`.gitignore` 这类）、`interpreter → langId`（shebang）。
- 同时生成两张映射：`linguistLangId → CM6 语言包`（22 个官方包，其余落到 `legacy-modes` 或 plaintext）、`linguistLangId → Shiki lang id`（Shiki 的 id 基本对齐 GitHub linguist 的 `aliases`/`aceMode`，需要人工核对 ~50 个高频语言）。
- 运行时逻辑：`扩展名（含双扩展名 .d.ts/.tar.gz 特例） → 文件名精确匹配 → shebang 首行 → 内容嗅探（可选：XML/JSON/HTML 前 64 字节）`。
- **体积**：codegen 后大约 **10–20KB gzip**【估算】，远好于运行时 39.7KB 全量（且不需要把 833 条元数据解析进内存）。
- 别用 `mime` 反查语言，误判率高（`.ts` → `video/mp2t` 的经典坑）。

---

## 6. Markdown 预览（问题 5）

| 组合 | gzip【实测】 | 说明 |
| --- | --- | --- |
| `react-markdown@10.1.0` | 34.1KB | 默认**不渲染 raw HTML**（安全），要 raw 得显式加 `rehype-raw` |
| `+ remark-gfm@4.0.1` | +9.6KB | 表格/任务列表/删除线/自动链接 |
| `+ @shikijs/rehype@4.6.0` | 45.3KB（含 shiki core） | 官方 rehype 插件，复用同一个 highlighter |
| `+ rehype-pretty-code@0.14.6` | 65.8KB | 功能多（行高亮/标题/复制按钮），但对我们是多余抽象 |
| `+ rehype-highlight@7.0.2` | 47.5KB（含 lowlight/hljs core） | 轻，但配色和代码编辑器不一致 |
| `streamdown@2.7.1`（Vercel） | 150.3KB（Apache-2.0） | 为**流式** Markdown 设计（未闭合代码块容错），AI 对话场景用的；文件预览不需要 |

**推荐**：`react-markdown` + `remark-gfm` + **自写 rehype 插件**（10–20 行，用 `codeToTokens` 输出 `<span style="color:…">`），复用同一个 Shiki highlighter 实例与主题。这样 Markdown 里和编辑器里的配色是同一套 token 色，视觉一致且省 45KB。

流式渲染对我们无意义（文件是一次读完的）；只有在做「AI 生成文件预览」时才考虑 `streamdown`。

---

## 7. Diff 展示（问题 6）

| 方案 | gzip【实测】 | 适合 | 不适合 |
| --- | --- | --- | --- |
| **`@codemirror/merge`** | 91.4KB（含共享依赖；与编辑器共用时增量更小） | 「点提交看文件 diff」——只要你能拿到**两个版本的文件内容**（`git show HEAD:path` vs 工作区），`MergeView`/`unifiedMergeView` 直接吃两个字符串，语法高亮复用 CM6 grammar，`diffConfig.timeout/scanLimit` 有降级 | 只有 patch 文本时不能直接用 |
| `diff`（jsdiff）9.0.0，BSD-3 | 7.8KB | 只需**解析** unified diff（`parsePatch`/`parseDiff`）拿 hunks；或者小文件做 `diffLines` 统计 | 渲染要自己做 |
| `diff2html` 3.4.56 | 12.4KB | 把 unified diff 字符串渲染成 GitHub 风格 HTML，**静态**、不需要虚拟化就能看小 diff | 大 diff（几千行）会卡；样式是它自己的 |
| `react-diff-view` 3.3.3 | 22.8KB（peer react） | 自带 `gitdiff-parser` + 行级组件 + **要求你自己接虚拟化** | 依赖重（`lodash`、`diff-match-patch`、`warning`），且和编辑器主题两套体系 |
| Monaco diff editor | 见 §2.7 | 最强的交互（sidebar、inline、hideUnchangedRegions、gutter revert） | 为它背 800KB gzip |

**推荐**：`@codemirror/merge` + （需要时）`diff`。

- **主场景（git 面板联动）**：Host 侧拿到 `HEAD` 版本 + 工作区版本 → 两个字符串 → `MergeView`（宽屏分栏）或 `unifiedMergeView`（窄屏内联）。这条路径 fidelity 最高（能编辑、能接受/拒绝、能跳转）。
- **只有 patch 的场景**（例如看某个 commit 的 patch 文本）：`diff` 的 `parsePatch` 解析成 hunks，再自己渲染（或 `diff2html`）。
- **性能护栏**（必须显式设，默认值不够安全）：`diffConfig: { timeout: 1000~2000, scanLimit: 1e4~1e5 }`；>1MB 或 >5万行直接不内联字符级 diff，退成「行级统计 + 前 N 个 hunk」。业界默认参照：Monaco `maxComputationTime: 5000`、`maxFileSize: 50MB`。

---

## 8. 大文件性能与降级策略（问题 7）

### 8.1 可引用的硬数字

| 来源 | 数字 |
| --- | --- |
| VS Code 源码 | 20MB / 30 万行 → **永久**停止 tokenize；2.56 亿字符 → 禁重内存操作；50MB → 不同步；单行 ≥10000 字符 → 大文件判定 |
| Monaco `monaco.d.ts` | `largeFileOptimizations` 默认 true；`maxTokenizationLineLength` 默认 20000；`stopRenderingLineAfter` 默认 10000；diff `maxComputationTime` 5000ms、`maxFileSize` 50MB |
| CM6 官方 demo | 「几百万行」可加载，高亮会在大文档滚动时停止/滞后（**设计如此**，有工作预算） |
| CM6 作者 | "should perform very well even for large documents"，但全文档型扩展（lint）会变慢 |
| Monaco issue #2054 | 长文档会**全量** tokenize（Monarch），主线程被打满 |
| **【无公开数据】** | 10MB 文本在任一编辑器里的首帧/滚动帧时间，没有可信公开 benchmark；不要相信"XX 快 10 倍"的截图对比 |

### 8.2 建议的阈值分级（按**字节**和**行数**双条件，取先触发者）

| 级别 | 触发条件 | 行为 |
| --- | --- | --- |
| L0 正常 | < 256KB | 全功能：编辑、Lezer 高亮、折叠、搜索、补全、diff |
| L1 大文件 | 256KB – 2MB | 关补全/关 lint/关 minimap 类装饰；保留高亮、搜索、折叠 |
| L2 很大 | 2MB – 10MB 或 > 5 万行 | **强制只读**，关 diff 内联，关折叠；高亮保留但用"轻量 grammar"（或接受滞后）；搜索限流（`SearchCursor` 分片 + 进度条） |
| L3 超大 | 10MB – 20MB 或 > 30 万行（对齐 VS Code） | 只读 + **关语法高亮**（plaintext），只保留行号/滚动/搜索；顶部提示"已关闭语法高亮" |
| L4 拒绝内联 | > 20MB 或单行 > 1MB | 不加载编辑器：显示文件信息卡（大小/类型/修改时间）+「用系统程序打开」/「只读分页浏览」（host 分段读，虚拟列表按字节块翻页） |
| 任意级别 | 单行 ≥ 10000 字符（VS Code `LONG_LINE_BOUNDARY`） | 关软换行（`EditorView.lineWrapping` 不加），提示"长行模式"；≥1MB 单行直接按 L4 处理（**单行 2MB 是两类编辑器的共同死穴**，因为它要求"一次布局一整行"） |

### 8.3 二进制与编码

- **二进制检测**（host 侧，在拿 bytes 时做）：前 8KB 里出现 `\0` → 二进制；再按扩展名白名单（图片/字体/压缩包/可执行）直接给"不能以文本打开"。
- **编码**：BOM 检测（UTF-8 / UTF-16LE / UTF-16BE）+ `TextDecoder('utf-8', {fatal:true})` 校验；失败则提示"非 UTF-8（可能是 GBK/Shift-JIS）"并给出"以 Latin-1 只读查看"（**不要**静默替换成 U+FFFD 再让用户保存，会毁文件）。
- **保存必须无损**：记录并回写 `EOL`（LF/CRLF，逐行统计后取多数）、**末尾是否有换行**、缩进风格（`detectIndentation` 同款逻辑：统计前 1000 行 tab vs spaces）。这三件事任何一件丢了都是"编辑器 bug"。
- **超大文件的内存**：CM6 要求完整 `Text`（10MB 字符串 ≈ 20MB UTF-16 + 树结构）；L4 的"分页浏览"必须绕过编辑器，用「host 分块读 + `react-virtual` 按行渲染」。
- **可测的自我验证**：在 L2/L3 入口处用 `performance.now()` 记录「解码 + 建 state + 首帧」三段耗时，超过 300ms 就自动降一级（这比任何静态阈值都准）。

---

## 9. 单 IIFE bundle 打包方案（esbuild 要点）

**本节的打包目标（已按最新约束校准）**：esbuild 输出**单个 IIFE 文件**通过 `window.__ModuleLoader__.load({ id, factory })` 注册；**不能拆 chunk**（`splitting: false` 且格式必须是 `iife`）、**不能生成独立 worker 文件**、**不能从 `/plugins/<pkg>/assets` 之类路径加载 wasm/字体**。所有资源只有"内联"一条路。

### 9.0 三个候选在「单文件 IIFE」下能不能跑

| | 能不能跑 | 需要做的内联工作 | 体积（gzip） |
| --- | --- | --- | --- |
| **CodeMirror 6** | ✅ **零障碍** | **无**。无 CSS 文件（`style-mod` 运行时注入 `<style>`）、无字体、无 worker、无需动态 `import()`（全静态 import 即可） | 全量 13 语言 + merge + oneDark：**1025KB minified**【Lead 实测】≈ **320KB gzip**【估算，min→gzip 经验比 0.31】 |
| **Shiki 4.6** | ✅ 可跑 | wasm 用 `shiki/wasm`（`wasm-inlined.mjs`，base64+gzip 内联，**不 fetch**）或换 `engine-javascript` + `langs-precompiled`（**完全不要 wasm**）；语言/主题的 `import()` 会被 esbuild 在 IIFE 下内联成惰性初始化函数（不会产生 chunk） | core 35 + engine 19（JS engine）/ 2.6+155（oniguruma）+ 语言 1–32/个 + 主题 2–6 |
| **Monaco 0.57** | ⚠️ **勉强可跑，代价最大** | ① worker 只能二次构建成 IIFE → 读成字符串 → `new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})))`（走 d.ts 里的 `MonacoEnvironment.getWorker`）；② 100 个 CSS 文件必须在构建期由 plugin 转成「注入 `<style>` 的 JS」，或直接把官方 `editor.main.css`（124KB gzip）当文本注入；③ `codicon.ttf`（149KB）必须 `dataurl` 内联（≈199KB raw 字符串）；④ 只能走 ESM 源（AMD 自 0.53 弃用），子路径要写 `monaco-editor/editor/editor.api` | core **602** + CSS **124** + editor.worker **80** ≈ **806KB**，再加每语言 0.3–18KB |

结论：**IIFE 这条约束本身不否决任何一家，但它把 Monaco 的"工程摩擦"从"改配置"升级成"写三层构建插件"**，而 CM6 是唯一"打包器什么都不用管"的选项。这也是本报告选 CM6 的第二个硬理由。

### 9.1 通用配置基线

- `format: 'iife'`、`bundle: true`、`splitting: false`（IIFE 下本来就不支持 splitting）、`platform: 'browser'`、`target: 'chrome120'`（Electron 新 Chromium 足够）、`jsx: 'automatic'`、`globalName` 可省（DSH 的 `load({factory})` 自己拿返回值，不依赖全局名）。
- **必须 external**：`react`、`react-dom`、`react/jsx-runtime`、`react-dom/client`（宿主提供 `require('react')`，禁止第二份 React）。IIFE 下 external 会保留为 `require(...)` 调用，正是 DSH ModuleLoader 想要的形态。
- **不要 external**：CM6 / Shiki 全部打进 bundle。
- **动态 `import()`**：IIFE 下 esbuild 会把它内联（惰性初始化闭包），**不会**产生第二个文件；但也就意味着"按需加载语言"在体积上不再省，必须靠**显式白名单**控制。
- 产物校验：`--metafile` + `--analyze`，把「单文件 gzip 上限」写成 CI 断言（建议 < 1.2MB gzip；本方案目标 ≈ 320–400KB）。

### 9.2 CodeMirror：几乎零工作量（这是选它的核心理由）

- **无 CSS 文件**：`@codemirror/view` 通过 `style-mod` 在运行时注入 `<style>`，不需要 `css` loader，也不需要 `insert <style>` 的构建技巧。
- **无字体**：用系统等宽栈 `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`，不打包字体。
- **无 worker**：不需要 worker 构建流水线。
- 唯一注意：`@codemirror/state` 与 `@codemirror/view` **必须同一份实例**（同一 node_modules 解析），否则 `instanceof` 判断失败；pnpm 下用 `pnpm.overrides` 锁版本，或确认 `dedupe`。

### 9.3 Shiki：wasm 与动态 import 在单 IIFE 里的三个坑

1. **`import()` 不省体积**：IIFE 下 esbuild 内联惰性初始化，"按需加载语言"等于"全量打包" → **必须显式列语言白名单**（`createHighlighterCore({ langs: [import('@shikijs/langs/typescript'), ...] })` 只写要的），否则一不小心就 1.2MB gzip（官方 `bundle/full` 就是这个量级）。
2. **wasm 三种接法**（§4.6）：`shiki/wasm`（内联，+155KB gzip，**推荐**）/ `engine/javascript` + `langs-precompiled`（无 wasm）/ 自起 host 路由（不推荐）。
3. **不要用 `?url` 风格导入**（`new URL('...wasm', import.meta.url)`）——单 bundle 里没有资源目录，会 404。

### 9.4 Monaco（仅当未来要换回时参考）

- **worker**：两次构建。pass1：`esbuild.build({ entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'], bundle: true, format: 'iife', outfile: 'build/editor.worker.js' })`；pass2：主构建里用 `loader: { '.worker.js': 'text' }` 或一个 esbuild plugin 把该文件内容作为字符串导出；运行时
  ```js
  self.MonacoEnvironment = {
    getWorker: () => new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' })))
  }
  ```
  （`getWorker` 的签名在 `monaco.d.ts` 里就是 `(workerId, label) => Promise<Worker> | Worker`，官方支持这条路径。）
- **CSS**：两条路——(a) esbuild plugin：`onLoad({filter: /\.css$/})` 返回「注入 `<style>` 的 JS」；(b) 直接用发布好的 `min/vs/editor/editor.main.css`（381KB raw / **124KB gzip**）当文本导入注入一次（省事，但包含全部主题样式）。
- **字体**：`codicon.ttf` **149KB**【实测】，用 `loader: { '.ttf': 'dataurl' }` 内联（≈199KB raw 字符串），或干脆不引 codicon（只有图标类 UI 需要）。
- **子路径**：`monaco-editor/editor/editor.api`（**不要**带 `esm/vs/` 前缀，§2.3）。

### 9.5 成本对照（主 bundle gzip）

| 方案 | 编辑 + 高亮 | 只读高亮（可选，懒加载） | 合计 |
| --- | --- | --- | --- |
| **CM6 + Lezer（推荐）** | ~150KB（basicSetup 118.75 + 1 个语言 17–46） | — | **~150KB** |
| CM6 + 6 个主流语言 | ~300KB【估算：118.75 + 语言包累加】 | — | ~300KB |
| + Shiki（JS engine，只读路径） | — | 35 + 19 + 主题 2 + 语言 5–20 | ~60–80KB |
| + Shiki（oniguruma 内联） | — | 35 + 3 + **155** + 主题 2 | ~195KB |
| Monaco（只读最小） | 602 + 124 + 80 = **806KB** | — | ~806KB（+ 每语言 0.3–18KB） |

---

## 10. 依赖清单（包名 + 版本 + 预估 gzip）

全部 MIT（除标注），版本为 2026-11-13 的 latest。

### A. 必装（编辑 + 查看 + 搜索 + diff）

| 包 | 版本 | gzip | 用途 |
| --- | --- | --- | --- |
| `@codemirror/state` | 6.7.6 | 16.1KB | 文档/事务模型 |
| `@codemirror/view` | 6.43.15 | 79.7KB（含依赖） | 渲染层/视口 |
| `@codemirror/commands` | 6.11.1 | 89.6KB（含依赖，与上重叠） | 键位/历史 |
| `@codemirror/language` | 6.13.1 | 86.7KB（含依赖，与上重叠） | Lezer/折叠/缩进 |
| `@codemirror/search` | 6.7.2 | 73.1KB（重叠） | 搜索面板 + `SearchCursor` |
| `@codemirror/autocomplete` | 6.20.4 | 95.4KB（重叠） | 补全（可在 L1+ 关闭） |
| `@codemirror/merge` | 6.12.3 | +60–90KB（与上重叠，纯增量更小）【估算】 | diff/merge |
| `@codemirror/theme-one-dark`（可选，仅作配方参考） | 6.1.3 | 独立代码 ~5KB | 主题样板 |
| **小计** | | **实测基线：13 语言 + merge + oneDark = 1025KB minified ≈ 320KB gzip**【Lead 实测 + 估算】；不带语言时 `codemirror` meta = 118.75KB gzip | |

> 可以不装 `codemirror` meta 包，直接列上面 6 个 + 自己抄 `basicSetup`（官方源码注释就建议这么做：「once you decide you want to configure your editor more precisely, you take this package's source … copy it into your own code」）。

### B. 语言包（按仓库实际语言选，每个选一个）

| 包 | 版本 | lezer gzip |
| --- | --- | --- |
| `@codemirror/lang-javascript` / `-json` / `-html` / `-css` / `-markdown` | 6.2.5 / 6.0.2 / 6.4.12 / 6.3.1 / 6.5.2 | 46.2 / 17.4 / 24.2 / 24.5 / 22 |
| `@codemirror/lang-python` / `-rust` / `-go` / `-java` / `-cpp` | 6.2.1 / 6.0.2 / 6.0.1 / 6.0.2 / 6.0.3 | 31.7 / 45.7 / 27.2 / 34.9 / 49.2 |
| `@codemirror/lang-xml` / `-yaml` / `-sql` | 6.1.0 / 6.1.3 / 6.10.0 | 19.3 / 20.7 / ~30 |
| `@codemirror/legacy-modes`（兜底，**不进主 bundle**） | 6.5.5 | 按模式 1–10KB（全量 1.9MB 解包） |

**建议首批**：js/ts、json、html、css、markdown、python、yaml、xml、shell（legacy）、dockerfile（legacy）、sql —— 约 **230KB gzip**【估算】。

### C. 只读高亮（可选，懒加载）

| 包 | 版本 | gzip |
| --- | --- | --- |
| `@shikijs/core` | 4.6.0 | 35.1KB |
| `@shikijs/engine-javascript`（推荐）**或** `@shikijs/engine-oniguruma` | 4.6.0 | 19KB **或** 2.6KB + wasm 内联 155KB |
| `@shikijs/langs` 或 `@shikijs/langs-precompiled` | 4.6.0 | 按语言 0–44KB |
| `@shikijs/themes` | 4.6.0 | dark-plus 2KB / light-plus 2KB |
| `@tanstack/react-virtual` | 3.14.26 | 10.1KB |
| （不装）`codemirror-shiki` | 0.3.0 | ~3KB，仅在「只读也要 Shiki 装饰」时考虑 |

### D. Markdown

| 包 | 版本 | gzip |
| --- | --- | --- |
| `react-markdown` | 10.1.0 | 34.1KB |
| `remark-gfm` | 4.0.1 | 9.6KB |
| （自写 rehype shiki 插件，不装 `@shikijs/rehype`） | — | 0 |

### E. Diff / 语言探测

| 包 | 版本 | gzip | 用途 |
| --- | --- | --- | --- |
| `diff`（jsdiff）9.0.0，**BSD-3** | 9.0.0 | 7.8KB | `parsePatch` 解析 unified diff |
| `linguist-languages`（**仅 devDependency**，构建期 codegen） | 9.5.0 | 0（运行时） | 生成扩展名/文件名/shebang 映射表 |

### F. 明确不装

`monaco-editor`、`@monaco-editor/react`、`@monaco-editor/loader`、`@uiw/react-codemirror`、`react-diff-view`、`diff2html`、`rehype-highlight`、`rehype-pretty-code`、`react-syntax-highlighter`、`prism-react-renderer`、`highlight.js`、`prismjs`、`streamdown`。

---

## 11. 风险与工作量

### 11.1 人日估算（1 人，熟悉 React 与编辑器；不含 git 面板对接、不含保存写盘的 host 侧改造）

| 工作项 | 人日 | 说明 |
| --- | --- | --- |
| CM6 编辑器封装（React wrapper、主题、键位、保存、脏标记） | 2.0 | 自写 wrapper，不引 `@uiw` |
| 只读模式 + 大文件分级降级（§8.2） | 1.5 | 阈值 + 长行 + 二进制/编码 + 保存无损 |
| 语言探测 codegen（ext/filename/shebang → CM6/Shiki 双映射） | 0.5 | 构建脚本 + 50 个高频语言人工核对 |
| 搜索 / 跳转行 / 折叠 / 选区复制 | 1.0 | `@codemirror/search` + `EditorView.scrollIntoView` |
| Diff（`MergeView` + `unifiedMergeView` + patch 兜底） | 2.0 | 含大 diff 护栏与"接受/拒绝"交互 |
| Markdown 预览（react-markdown + shiki 代码块） | 1.0 | 含 CSP/安全（默认禁 raw HTML） |
| Shiki 集成（只读路径，懒加载 + 语言白名单） | 1.0 | JS engine 或 oniguruma 二选一 |
| 打包与体积治理（esbuild、metafile、CI 上限、external React） | 1.0 | CM6 侧几乎零风险 |
| 主题对齐 VS Code Dark+/Light+（HighlightStyle + CSS） | 1.0 | 视觉验收耗时 |
| 联调与回归（长行/IME/CRLF/BOM/超大文件） | 2.0 | 建议列入测试计划单独申请 |
| **合计** | **13 人日**（核心 9 + 联调 2 + 主题 1 + 缓冲 1） | 若首期只要「编辑+高亮+搜索+diff」，约 **8 人日** |

### 11.2 风险表

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| **单行超长文件**（minified JS/SVG/SQL dump） | 高 | 单行 ≥10000 字符关软换行；单行 ≥1MB 直接走 L4 分页只读（这是两类编辑器的共同死穴，不是 CM6 的锅） |
| 大文件下高亮滞后（CM6 设计行为） | 中 | L2+ 关语法或换 plaintext；UI 上不做"正在高亮"的假进度 |
| Shiki 全量 tokenize 卡主线程 | 中 | 只读路径 + 大小阈值 + （可选）worker 里跑，超时降级 plaintext |
| `@codemirror/state` 双实例 | 中 | pnpm overrides 锁版本 + 构建期断言 `instanceof` 可用 |
| 保存损坏文件（CRLF / 末尾换行 / BOM / 编码） | 高 | §8.3 三项无损 + 保存前字节级 diff 自检 |
| Shiki 语言包白名单漏配导致"某些文件没颜色" | 低 | 语言探测表与 Shiki 白名单同源生成（同一份 codegen 产物） |
| 宿主 CSP 禁 inline style（CM6/style-mod 依赖注入 `<style>`） | 低 | 提前确认；必要时 `style-src 'unsafe-inline'` |
| DSH 打包约束变化（例如禁止动态 import） | 低 | 全量静态 import + 显式白名单，本来就不依赖 splitting |
| Monaco 派需求回流（"要 overview ruler / minimap"） | 低 | 明确写进范围外；minimap 可用自绘 1px 行高色块替代 |

---

## 12. 参考链接

**官方文档 / 源码**

- Monaco Editor ESM 集成指南：https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md
- Monaco README（含「不支持 TextMate」FAQ）：https://github.com/microsoft/monaco-editor/blob/main/README.md
- Monaco 0.57.0 CHANGELOG（0.53 弃 AMD、0.56 重组 ESM 入口）：https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md
- Monaco 0.56 可 tree-shake 入口 PR #5155：https://github.com/microsoft/monaco-editor/pull/5155
- `monaco.d.ts`（`largeFileOptimizations` / `maxTokenizationLineLength` / `stopRenderingLineAfter` / diff 选项 / `Environment.getWorker`）：npm 包内 `monaco.d.ts`
- VS Code 源码 `textModel.ts`（20MB / 30 万行 / 长行 10000 阈值）：https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/textModel.ts
- VS Code 源码 `textModelTokens.ts`（后台 tokenize 时间切片）：https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/textModelTokens.ts
- CodeMirror System Guide（§Viewport 视口渲染）：https://codemirror.net/docs/guide/
- CodeMirror 参考手册（`unifiedMergeView` / `MergeView` / `DiffConfig`）：https://codemirror.net/docs/ref/
- CodeMirror Huge Document demo（几百万行）：https://codemirror.net/examples/million/
- `@codemirror/merge` README：https://code.haverbeke.berlin/codemirror/merge
- Shiki 文档 · Bundles（full 1.2MB gzip、web 695KB gzip）：https://shiki.style/guide/bundles
- Shiki 文档 · Best Performance Practices（fine-grained / 缓存 highlighter）：https://shiki.style/guide/best-performance
- Shiki 文档 · RegExp Engines（oniguruma vs JavaScript engine，3.9.1 起全语言支持）：https://shiki.style/guide/regex-engines
- Shiki 文档 · Integrations（无 CodeMirror 官方集成）：https://shiki.style/guide/
- `codemirror-shiki`（社区桥，MIT）：https://www.npmjs.com/package/codemirror-shiki
- `monaco-tm`（Monaco + vscode-oniguruma + vscode-textmate）：https://github.com/bolinfest/monaco-tm

**真实案例 / 讨论**

- SigNoz #12692：monaco 进 entry chunk 导致 gzip 912KB → 1881KB：https://github.com/SigNoz/signoz/issues/12692
- yscope-log-viewer #260：monaco 2.7MB raw / 706.49KB compressed：https://github.com/y-scope/yscope-log-viewer/issues/260
- Monaco #2054「Too aggressive tokenization」：https://github.com/microsoft/monaco-editor/issues/2054
- CM6 论坛 · 大文档快速滚动导致高亮滞后：https://discuss.codemirror.net/t/syntax-highlighting-disappears-if-large-documents-are-scrolled-fast/5569
- CM6 论坛 · 作者谈"多大算太大"：https://discuss.codemirror.net/t/how-much-content-is-too-much-for-a-codemirror-editor/9895

**体积数据源**

- bundlephobia（min+gzip，含依赖）：https://bundlephobia.com/
- 本次实测方式：`registry.npmjs.org` 取 `dist.tarball` → 解包 → 对目标文件 `gzip -9 -c file | wc -c`；Monaco 0.57.0 tarball 18.5MB / 解包 99.3MB。

**许可证核查（全部通过）**

`monaco-editor` MIT · `@codemirror/*` MIT · `shiki` MIT · `@shikijs/*` MIT · `vscode-textmate` MIT · `vscode-oniguruma` MIT · `diff`(jsdiff) BSD-3 · `linguist-languages` MIT · `react-markdown` MIT · `remark-gfm` MIT · `@tanstack/react-virtual` MIT · `highlight.js` BSD-3 · `prismjs` MIT · `diff2html` MIT · `react-diff-view` MIT · `streamdown` Apache-2.0。无 GPL/AGPL 依赖链。
