# 构建、打包与本地开发

打包硬边界（单文件 IIFE / 无 chunk / 无 worker / 无 wasm 与字体 / react external）见 `ARCHITECTURE.md`；分层与依赖方向见 `packages/dsh-workspace-ide/AGENTS.md`；UI 尺寸与 token 见 `docs/ui-spec.md`。本文回答：**每个字段填什么、脚本按什么顺序做什么、本地怎么跑起来、出错怎么查**。

## 1 package.json 全字段

```json
{
  "name": "dsh-workspace-ide",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "DSH 全局面板：文件树 / SCM / 提交图谱 + 编辑器与 diff + 真 PTY 终端",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "integration", "README.md"],
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "node scripts/check.mjs",
    "test": "node scripts/build.mjs --check"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./integration/cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-theme",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-shortcuts"
      ]
    }
  },
  "engines": { "dsh": ">=0.2.2-rc.1 <0.3.0-0", "node": "^22.19.0 || >=24.0.0" },
  "dependencies": { "zod": "4.4.3" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.1.0",
    "@deepseek-ai/dsh-sandbox": ">=0.2.2-rc.1 <0.3.0-0",
    "@deepseek-ai/dsh-tools": ">=0.2.2-rc.1 <0.3.0-0",
    "@deepseek-ai/dsh-typert-protocol": ">=0.2.2-rc.1 <0.3.0-0"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/cordis": { "optional": true },
    "@deepseek-ai/dsh-sandbox": { "optional": true },
    "@deepseek-ai/dsh-tools": { "optional": true },
    "@deepseek-ai/dsh-typert-protocol": { "optional": true }
  },
  "devDependencies": {
    "esbuild": "0.25.12",
    "@xterm/xterm": "6.0.0",
    "@xterm/addon-fit": "0.11.0",
    "zustand": "^5",
    "@codemirror/state": "^6",
    "@codemirror/view": "^6",
    "@codemirror/language": "^6",
    "@codemirror/commands": "^6",
    "@codemirror/search": "^6",
    "@codemirror/merge": "^6",
    "@codemirror/lang-javascript": "^6",
    "@codemirror/lang-css": "^6",
    "@codemirror/lang-html": "^6",
    "@codemirror/lang-json": "^6",
    "@codemirror/lang-markdown": "^6",
    "@codemirror/lang-python": "^6",
    "@codemirror/lang-rust": "^6",
    "@codemirror/lang-cpp": "^6",
    "@codemirror/lang-java": "^6",
    "@codemirror/lang-php": "^6",
    "@codemirror/lang-sql": "^6",
    "@codemirror/lang-xml": "^6",
    "@codemirror/lang-yaml": "^6",
    "@tanstack/react-virtual": "^3"
  }
}
```

版本锁定策略：`esbuild 0.25.12`、`@xterm/xterm 6.0.0`、`@xterm/addon-fit 0.11.0`、`zod 4.4.3` 抄自仓库既有包（`dsh-plugin-dev-sandbox`），照抄不升级；其余依赖在 M0 首次 `pnpm add -D` 时装上、由 lockfile 锁定**精确版本**，然后把 `^6`/`^3`/`^5` 回填成实际版本并记进 `docs/build.md`（本文 §7 的白名单表同步）。**不许手写猜的 patch 版本**——体积断言（§2.1 步骤 7）依赖的是实际解析出来的包集合。

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `name` | `dsh-workspace-ide` | 与 `marketplace.json`、`marketplace` `spec` 的路径一致 |
| `version` | `0.1.0` | 发布时按根 README「发布」同步改这里与 `marketplace.json` |
| `type` | `module` | `scripts/*.mjs` 与 `lib/index.js` 都用 ESM；`lib/client.js` 是 IIFE，不受影响 |
| `exports["."]` | `./lib/index.js` | Host 侧入口：Cordis 插件的 `apply` |
| `exports["./client"]` | `./lib/client.js` | 浏览器侧入口：ModuleLoader 加载的那份 |
| `exports["./package.json"]` | — | 宿主要读 `dsh` 字段做清单校验 |
| `files` | `lib`、`integration`、`README.md` | 源码不发布；**`lib/` 必须提交**（市场按 spec 拉仓库文件，不跑构建） |
| `private` | `true` | 与既有五个包一致，不走 npm 发布 |
| `scripts.build` | `node scripts/build.mjs` | 根 `pnpm build` 调用的就是它 |
| `scripts.check` | `node scripts/check.mjs` | 单独跑静态检查；`build` 内部也会跑 |
| `scripts.test` | `node scripts/build.mjs --check` | 沿用 `packages/extension-lab-manager` 的 `--check` 惯例：只校验产物是否最新，不产出 |
| `dsh.manifestVersion` | `1` | 当前宿主清单版本 |
| `dsh.bundle.patch` | `./integration/cordis.patch.yml` | 声明 Host 侧插件挂载与 `sidebar.panellist` 入口 |
| `dsh.client.platform` | `web` | 只有 web 端有 `main` keyed slot |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0-0` | 与既有包同区间，避免不同宿主管线混装 |
| `engines.node` | `^22.19.0 / >=24.0.0`（或） | 与根 `engines` 对齐，构建脚本用到 `node:fs/promises`、`zlib`、`node:test` |

**`dsh.client.inject` 的作用与选型**：这份列表**只用于排序激活**——宿主保证这些官方 client 包先于本插件就位，本插件**不 require 它们的任何导出**（`practices.md:35` 硬禁）。因此列表只收「我们直接使用的宿主能力提供者」：

| 包名 | 我们用它提供的东西 | 缺席时的表现 |
| --- | --- | --- |
| `@deepseek-ai/dsh-api-remotes` | `remote.execute({ sessionId, action, payload })` | `remote` 为 undefined，所有 datasource 立即失败 → 顶部错误条 |
| `@deepseek-ai/dsh-client-ui-slots` | `ctx.slots.register` 与 slot 树 | 面板挂不上去（与 `main` keyed slot 同时缺） |
| `@deepseek-ai/dsh-client-ui-theme` | `--dsw-alias-*` token 的注入者 | 颜色全灰（token 无值，回退到继承色） |
| `@deepseek-ai/dsh-client-locale` | `ctx.locale.register` / `t()` | 文案退化为 key 字面量 |
| `@deepseek-ai/dsh-client-ui-layout` | `main`（keyed）、`sidebar` 区域、`ctx.layout.selectPanel` | 无法渲染 |
| `@deepseek-ai/dsh-client-ui-sidebar` | `sidebar.panellist` 入口清单 | 侧栏没有本插件入口（但仍可从 `main` 直接进） |
| `@deepseek-ai/dsh-client-shortcuts` | `ctx.shortcuts.register` | 快捷键全部失效（面板内点击不受影响） |

## 2 `scripts/build.mjs`

### 2.1 流程（严格顺序，任一步失败即非零退出）

| # | 步骤 | 关键动作 | 失败信息（可 grep） |
| --- | --- | --- | --- |
| 0 | 静态检查 | `spawnSync(process.execPath, ['scripts/check.mjs'])`，继承 stdio，非零即退出 | `static check failed` |
| 1 | 清产物 | `rm(lib, { recursive: true, force: true })` + `mkdir(lib)` | — |
| 2 | 断言源码形状 | `frontend/index.js` 必须含 `window.__ModuleLoader__.load`；`backend/index.js` 必须含 `export function apply` | `frontend/index.js must register through the DSH ModuleLoader` / `backend/index.js must export apply` |
| 3 | 拷 backend | 递归遍历 `backend/**`，只取 `.js`，每个断言源码含 `export `，原样写入 `lib/<相对路径>`（缺末尾换行则补一个） | `backend module <file> exports nothing` |
| 4 | 打 client | esbuild（参数见 §2.2）→ `lib/client.js`；`metafile` 写到内存供步骤 6 用 | esbuild 自身报错 |
| 5 | 去行尾空白 | `replace(/[\t ]+$/gm, '')` 后重新写回 | — |
| 6 | 语言包白名单核对 | 读 `metafile.inputs`，断言 `@codemirror/lang-*` 只出现白名单里的 13 个；断言无 `monaco-editor`、`@gitgraph/`、`elkjs`、`dagre` 路径 | `unexpected language/grammar bundled: <pkg>` |
| 7 | 体积断言 | `gzipSync(Buffer.from(code), { level: 9 }).length` ≤ **1 220 000** 字节（≈1.2 MB）；原始体积只打印不卡 | `client bundle exceeds 1.2 MB gzip (actual <n>)` |
| 8 | 打印 | 一行汇总：backend 文件清单、client raw/gzip、10 个最大的 input | — |

`--check` 分支（供 `pnpm test` 用）：跳过 1/3/4/5，只重跑 0/2/6，并比对 `lib/client.js` 是否比所有源码新；过期则 `throw new Error('lib/client.js is stale; run pnpm build')`，与 `packages/extension-lab-manager/scripts/build.mjs:39` 同款话术。

### 2.2 esbuild 参数表

```js
const result = await esbuild.build({
  entryPoints: [path.join(root, 'frontend/index.js')],
  outfile: path.join(out, 'client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  inject: [path.join(root, 'frontend/jsx-shim.js')],
  minify: true,
  sourcemap: false,
  loader: { '.css': 'text', '.jsx': 'jsx' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel: 'silent',
});
```

| 参数 | 值 | 为什么是这个值 |
| --- | --- | --- |
| `format` | `iife` | 宿主以 `<script>` 注入单文件，没有 ESM 加载器；`iife` 同时把顶层 `await` 变成构建期错误（避免误用） |
| `platform` | `browser` | 决定 `exports` 条件与内建模块 shim；写 `node` 会偷偷带进 `path`/`fs` 的 polyfill |
| `target` | `chrome120` | 宿主 web 端最低 Chromium 基线；由此可放心用 `color-mix`、`@property`、`Array.prototype.at`，且**不做**多余降级 |
| `jsx` | `transform`（`jsxFactory: 'h'`、`jsxFragment: 'Fragment'`） | 走 classic 转换，`h` 由 `inject` 注入的 shim 提供；**不能用 `automatic`**，理由见下方「为什么不用 `jsx: 'automatic'`」 |
| `inject` | `frontend/jsx-shim.js` | 给每个 `.jsx` 注入 `h`/`Fragment` 名字（`export { h, Fragment } from './runtime.js'`），从而**不需要**在视图里 `import react`（R14 因此可成立） |
| `loader['.jsx']` | `jsx` | vite 惯例默认支持 `.jsx`，esbuild 默认不会把 `.jsx` 当 JSX 解析 |
| `minify` | `true` | 体积硬约束；生产构建没有"debug 版"这一说 |
| `sourcemap` | `false` | 宿主不提供 sourcemap 路由，产出 `.map` 只会增加 `files` 噪音；调试用未压缩的模块路径与 `?rev` 重编译 |
| `loader['.css']` | `text` | xterm 与自研样式都以字符串内联，运行时注入 `<style id="dsh-workspace-ide/css">`（`ARCHITECTURE.md` 要求不打包独立 CSS） |
| `external` | 四个 react 入口 | react 由宿主提供；漏掉 `react/jsx-runtime` 会**打第二份 React** → hooks 报错 `Invalid hook call` |
| `define` | `'process.env.NODE_ENV': '"production"'` | 很多库（含 CM6 生态外的依赖）读它做分支；不定义会在浏览器里出 `process is not defined` |
| `metafile` | `true` | §2.1 步骤 6 的白名单核对与体积归因都靠它 |
| `logLevel` | `silent` | 自己打汇总行，避免双份输出 |

**为什么不用 `jsx: 'automatic'`**：`automatic` 会把每个 `.jsx` 编译成 `import { jsx } from 'react/jsx-runtime'`，而 `react/jsx-runtime` 已在 `external` 里——esbuild 会为它生成本地 shim，产出形如 `var require_jsx_runtime = () => (typeof require !== "undefined" ? require("react/jsx-runtime") : new Proxy(...))` 的**顶层** `require(...)`。宿主只把 `require` 交给 ModuleLoader 的 `factory(require)`，模块顶层执行时 `require` 是 `undefined`，于是 bundle 一加载就抛错，连 `apply` 都进不去。`transform` + `inject` 把这件事退化成一次普通的函数引用，`h` 从 `frontend/runtime.js` 的 `getReact()` 取——react 只在 `factory` 里注入一次，bundle 顶层不碰 `react`。

**为什么不能拆 chunk**：宿主只按 `main`/`sidebar` 的 module 入口加载 `./client` 一个 URL；esbuild 的 `splitting` 只对 ESM 生效，且会产出额外 `.js` 文件——`files` 里虽能带上，但**没有运行时能按需取它们**（`import()` 在 IIFE 里会退化成 require shim 并直接抛错）。

**为什么不能用 worker / wasm / 字体**：`ARCHITECTURE.md` 的硬边界——`/plugins/<pkg>/assets` 路由**只服务** `.svg/.png/.webp/.jpg/.jpeg`；`new Worker(new URL(...))` 需要一个可寻址的独立文件，`WebAssembly.instantiateStreaming` 需要一个 `.wasm` URL，`@font-face` 需要一个字体 URL，三者在本包都没有落点。因此：

- 高亮与解析全部在主线程（CM6 + Lezer 是增量同步解析，不需要 worker）；
- 图谱布局在 Host 算完再下发（`backend/git/layout.js`），客户端不做计算密集任务；
- 字体只允许 `var(--dsh-code-font-size)` 等宿主变量与系统字体栈。

**语言包显式白名单**：IIFE 下 `import()` 不能按需加载，动态导入的模块会被**全量**打进来，所以只能"要么白名单引入、要么不引入"。白名单 = `MINI-VSCODE-PLAN.md` 定的 13 个语言 + `@codemirror/merge`；`frontend/editor/languages.ts` 里用一个显式映射表（扩展名 → loader 函数）集中引入，**别处禁 import `@codemirror/lang-*`**（`check.mjs` R13 管这条）。

## 3 `scripts/check.mjs`

单文件、无依赖、`import` 走 `node:fs/promises` + `node:path`；规则逐条检查，**首个失败直接非零退出**（对齐 `packages/dsh-ui-enhancements/scripts/check-contrast.mjs` 的口径）；每条失败信息形如 `[R4] frontend/views/tree/TreeRow.tsx:12 useState in views`。

| id | 检查对象 | 禁止 | 为什么 | 误报豁免 |
| --- | --- | --- | --- | --- |
| R1 | `frontend/**` | `import ... from '@deepseek-ai/*'`（`react`/`react-dom` 除外） | 硬禁：官方 client 包不保证导出面稳定，且会拉入第二份状态 | 无（真需要能力就注入宿主服务，而不是 import 包） |
| R2 | `frontend/**` | `from 'backend/**'`、`from '../../backend/**'` | 浏览器里没有 `fs`/`child_process`；分层硬边界 | 无 |
| R3 | `frontend/**` | `node:*`、裸 `fs`/`path`/`child_process`/`os`/`crypto` | 同上；`path` 用 `frontend/service/paths.ts` 的纯函数版本 | 无 |
| R4 | `frontend/views/**` | 标识符 `useState` / `useReducer` | `views` 只订阅 store、派发动作、绑实例（`AGENTS.md`） | 无 |
| R5 | `frontend/views/**` | `from '*.datasource'` | 视图不许直连 IO；一律经 store action | 无 |
| R6 | `backend/**` | `from '../frontend/**'` 或任何 `frontend/` | Host 侧不能引用浏览器代码 | 无 |
| R7 | `backend/**` | `from 'react'` / `react-dom` | Host 侧没有 DOM | 无 |
| R8 | 全仓库 `.js/.mjs/.css/.ts/.tsx` | 颜色字面量 `#[0-9a-fA-F]{3,8}`、`rgb(`、`hsl(`、`oklch(`、命名色（`white`/`black`/`red` 等） | 明暗两套必须由 token 承载 | 行尾或上一行写 `// check-ignore: color — <理由>`（仅插画、品牌 logo、以及 `docs/**.md` 不受检） |
| R9 | 构建产物 / 源码 | `new Worker(`、`importScripts(`、`.wasm` | 没有可寻址的额外文件（§2.2） | 无 |
| R10 | `shared/**` | `import` 语句、函数副作用、`react`、`node:*` | 两端共享的只能是纯数据与 zod schema | 允许 `import { z } from 'zod'` |
| R11 | `backend/**` | 裸 `child_process`（只允许 `backend/git/exec.js`、`backend/terminal/manager.js`） | 命令必须集中在唯一出口，便于加硬化参数与脱敏 | `// check-ignore: spawn — <理由>` |
| R12 | `package.json` | 黑名单依赖（`monaco-editor`、`@gitgraph/*`、`@uiw/react-codemirror`、`diff2html`、`prismjs`、`highlight.js`、`shiki`、`elkjs`、`dagre`、`simple-git`、`isomorphic-git`、`node-pty`） | 体积、worker/wasm 边界、与"只走系统 git CLI"冲突 | 无（要改就走 RFC，先改本文 §7） |
| R13 | `frontend/**`（`editor/languages.js` 除外） | `@codemirror/lang-*` | 语言包必须集中白名单（§2.2） | 无 |

## 4 本地开发循环

```bash
# 1) 构建（含静态检查、体积断言）
pnpm --dir packages/dsh-workspace-ide run build

# 2) 只跑静态检查（改文档以外的东西前后都该跑一次）
pnpm --dir packages/dsh-workspace-ide run check

# 3) 校验产物是否最新（等价 pnpm test）
pnpm --dir packages/dsh-workspace-ide run build -- --check
```

**为什么改完必须重启或硬刷新**：宿主算 `client` bundle revision 的输入是入口文件的 `mtimeMs` / `ctimeMs` / `size`——`build.mjs` 每次都 `rm -rf lib` 再写，`ctimeMs` 一定变，所以**磁盘 revision 会变**；但这只保证宿主"能发现变了"，浏览器侧仍可能有模块缓存。可靠做法按顺序试：

1. 面板内无刷新重启：关掉面板再打开（`ctx.layout.selectPanel` 走一次卸载/挂载）；
2. 硬刷新页面：`Cmd+Shift+R` / 在 URL 上加 `?rev=<时间戳>` 打开（绕过 HTML 与模块缓存）；
3. 还不对就重启 DSH 宿主进程（`plugin_dev { action: 'stop' }` → `launch`）。

**隔离 profile 内试跑**（不改当前 profile）：

| 步骤 | 调用 | 说明 |
| --- | --- | --- |
| 绑定 | `plugin_dev { action: 'bind', pluginPath: 'packages/dsh-workspace-ide' }` | 绑定信息写 `.dsh/plugin-dev/<session>/binding.json`，只对本次会话有效 |
| 看现状 | `plugin_dev { action: 'status' }` | 返回脚本清单、运行态、最近输出与退出码 |
| 构建 | `plugin_dev { action: 'run', commandId: 'build' }` | 用隔离 profile 的 pnpm 跑 `scripts.build`，等价于上面第 1 条但产物落在隔离目录 |
| 起实例 | `plugin_dev { action: 'launch' }` | 起独立 DSH 实例（独立 profile / 端口），浏览器打开它给的 URL |
| 交互调试 | `plugin_dev { action: 'terminalCreate' }` → `terminalWrite` / `terminalPoll` | 在实例的 PTY 里跑 git 命令、看 Host 侧日志 |
| 收尾 | `plugin_dev { action: 'stop' }` / `unbind` | 停止实例；`unbind` 后不再控制该目录 |

试跑通过后再回主 profile 手动 `build`，**不要**用 `plugin_dev` 去启动当前会话所在实例（会与正在服务的进程抢 profile）。

## 5 调试

| 症状 | 在哪看 | 怎么定位 |
| --- | --- | --- |
| 面板空白，Console 里 `slot entry crashed in 'main'` | 浏览器 DevTools Console 的首个 stack frame | 几乎总是 `lib/client.js` 顶层抛错：① `frontend/index.js` 没走 `window.__ModuleLoader__.load`；② 顶层 `import` 了 `node:*`；③ react 双实例（`Invalid hook call`）；④ 顶层读了 `ctx` 但 `apply` 没被调用。改完重跑 `build` 并硬刷新 |
| `lib/client.js` 404 或 `dsh.client` 缺失 | Network 面板 / 宿主启动日志 | 先跑 `build -- --check`；再确认 `package.json` 的 `exports["./client"]` 与 `dsh.client.platform` 都在 |
| 主题不生效（全黑/全白/文字看不见） | DevTools 里选中元素看 computed `background-color` 是否为空 | token 没解析 → 写成了 `--dsw-alias-xxx` 的不存在名字（**没有 `surface-*` 系列**）；或是硬编码色被 R8 放过 |
| Remote 调用失败 | 错误条上的 `code`，展开错误条看 `detail` | `{ok:false,error:{code,message,detail}}`：`E_GIT_FAILED` 看 `detail.argv` / `detail.stderr`（已脱敏）；`E_VERSION_CONFLICT` 看 `detail.currentVersion`；`E_TOO_LARGE` 看 `detail.limit`；`E_CANCELLED` 应当**静默**（若弹了错误条说明吞错逻辑写反了） |
| Host 侧日志 | 宿主进程的 stdout / stderr（`plugin_dev status` 的最近输出、或桌面端日志目录） | `backend/**` 里的 `console.log` 直接进 Host 进程输出，不进浏览器 Console。生产态只允许 `console.warn/error` + `{ action, code }`，禁止打路径以外的用户内容 |
| CM6 内容/选区不对 | Console：`__widDebug.view` | mount 时挂 `globalThis.__widDebug = { view }`；`view.state.doc.toString()`、`view.state.selection.main`、`view.dispatch({ changes })`。注意 `views` 里只能用 `useRef` 持 view，**不许**把 view 放进 React state |
| xterm 黑屏/不刷新 | Console：`__widDebug.term` 与 `terminal.poll` 的 offset | `__widDebug.term.onData(d => console.log(d))` 看输出方向；`poll` 返回的 `offset` 是**字符**偏移（不是字节），offset 不前进说明 Host 缓冲没写入或 `resize` 尺寸为 0（面板 `display:none` 时 `fit()` 会算成 0 列） |
| 快捷键没反应 | 宿主「快捷键」面板（`Cmd+/`）看是否注册成功 | 注册被拒（id 重复或键位重叠）会走错误条；`regions` 漏了 `editable` 则在编辑器里不触发 |

## 6 版本与发布

按根 `README.md`「发布（只打标签并推送）」执行，**不跑测试、不建 Release**：

| 步 | 动作 |
| --- | --- |
| 1 | 改 `packages/dsh-workspace-ide/package.json` 的 `version` |
| 2 | 在根 `marketplace.json` 的 `extensions[]` 追加本包条目（**首次发布才追加**，之后只改 `version` 与 `ref`）：`{"name":"dsh-workspace-ide","title":"DSH Workspace IDE","description":"文件树 / SCM / 提交图谱 + 编辑器与 diff + PTY 终端。","version":"0.1.0","path":"packages/dsh-workspace-ide","ref":"version-<数字>","spec":"github:zhaowendao2005-lab/dsh-extension-lab#path:/packages/dsh-workspace-ide"}` |
| 3 | 三处一致性检查：`package.json.version` == `marketplace.json.version`；`path` == 目录；`spec` 里的 `#path:` == `/packages/dsh-workspace-ide`。**`spec` 永远不带 `ref`**（带了就锁死在旧 tag，升级拿不到新代码） |
| 4 | `pnpm build` 确认 `lib/` 最新，**提交 `lib/`**（市场按 spec 拉仓库文件，不跑构建） |
| 5 | `git tag version-<数字>`（沿用仓库既有 `version-3.4.2` 这种纯数字递增风格），推 `main` 与 tag |

纪律：`lib/` 是生成产物，**禁止手改**（review 里手改 `lib/` 直接打回）；`--check` 会比对源码与产物，手改必然对不上。

## 7 依赖与许可

| 包 | 版本 | 许可证 | 用途 | 进 bundle |
| --- | --- | --- | --- | --- |
| `@codemirror/state` `view` `language` `commands` `search` | 见 §1（锁定后回填） | MIT | 编辑器内核 | 是 |
| `@codemirror/merge` | 见 §1（锁定后回填） | MIT | 两栏/内联 diff 与 chunk 导航 | 是 |
| `@codemirror/lang-*`（13 个） | 见 §1 | MIT | 语法高亮，显式白名单 | 是 |
| `@lezer/*`（间接） | 随 CM6 | MIT | 增量解析器 | 是（间接） |
| `@xterm/xterm` | `6.0.0` | MIT | 终端视图（复制自 dev-sandbox 的接法） | 是 |
| `@xterm/addon-fit` | `0.11.0` | MIT | 终端尺寸自适应 | 是 |
| `@tanstack/react-virtual` | 见 §1（锁定后回填） | MIT | 文件树 / 图谱行虚拟化 | 是 |
| `zustand` | 见 §1（锁定后回填） | MIT | `*.stores.ts`（vanilla 版，不用 React 绑定） | 是 |
| `zod` | `4.4.3` | MIT | Host 侧 payload 校验 | **否**（Host 运行时依赖，`lib/` 里原样 import） |
| `esbuild` | `0.25.12` | MIT | 构建工具 | 否（devDependency） |
| `react` / `react-dom` | 宿主提供 | MIT | UI 运行时 | 否（`external`） |

**禁止项及理由**：`monaco-editor`（约 5 MB，与 CM6 重复且带 worker）；`@gitgraph/*`、`gitgraph`（拖 D3/Canvas 依赖，布局还会搬进客户端——违反"布局在 Host"）；`@uiw/react-codemirror`（引入一层 React 适配与版本耦合，我们只用 `useRef` 持 view）；`diff2html`（客户端解析 unified diff，契约已给结构化 hunks）；`prismjs`、`highlight.js`、`shiki`（与 Lezer 重复，且 shiki 带 grammar 资源与 wasm）；`elkjs`、`dagre`（布局库，且 elk 需要 worker/wasm）；`node-pty`（只用宿主 `subprocess.spawnTerminal`）；`simple-git`、`isomorphic-git`（"只走系统 git CLI"是硬约束）。

**Apache-2.0 移植代码**：图谱 lane 布局移植自 `git-graph-plus` 的 `git-graph-builder.ts`（`backend/git/layout.js`）。要求：① 文件顶部保留原始版权行与 `SPDX-License-Identifier: Apache-2.0`；② 注释里写明来源仓库与 commit；③ 包内维护 `THIRD-PARTY-NOTICES.md` 记录该文件与许可证全文位置；④ 移植处只做"去掉浏览器依赖 + 改命名"，**算法行为不改**（改了要在 `docs/graph.md` 记差异）。

## 8 纪律

仓库根 `README.md`「测试纪律（最高优先级）」：

1. 是否测试、测什么、怎么测、允许多久，**全部由用户决定**；未批准时不运行测试。
2. 需要测试时先提交**不超过三行**的计划（验证风险 / 测试方法 / 预计耗时），等批准后执行。
3. 编写测试用例、冒烟、截图、对比度与选择器检查、Playwright、DSH 集成回归，同样先报计划并获批。
4. **默认交付 = 实现符合需求 + 构建成功**；不得为了汇报去做长时间调查或搭测试脚手架。
5. 获批测试只汇报结论与关键错误。

对本包的具体含义：`pnpm build`（含 `check.mjs` 与体积断言）就是默认的验收线；**不**顺手跑 `pnpm test`、**不**开浏览器截图、**不**跑 Playwright。`docs/ui-spec.md` 里的对比度表是设计期核算结果，不是运行期测试；若要把它固化成脚本，先按第 2 条报计划。

## 9 故障排查

| # | 现象 | 可能原因 | 处理 |
| --- | --- | --- | --- |
| 1 | `lib/client.js` 不存在 / 404 | 忘了构建；`files` 里漏了 `lib`；`.gitignore` 把 `lib/` 排除了 | `pnpm --dir packages/dsh-workspace-ide run build`；确认 `files: ["lib", …]`；`git ls-files packages/dsh-workspace-ide/lib` 非空 |
| 2 | Console `slot entry crashed in 'main'` | 见 §5 第 1 行四种原因 | 有栈就看栈；无栈就在 `frontend/index.js` 顶部加 `console.log('boot')` 二分定位 |
| 3 | 主题不生效、颜色全灰或不可读 | token 名不存在（如 `--dsw-alias-surface-1`）；`<style>` 没注入 | 只允许 §ui-spec 出现过的 `--dsw-alias-*`；确认注入的 `style#dsh-workspace-ide/css` 在 `document.head` 里且 `textContent` 非空 |
| 4 | 构建报 `client bundle exceeds 1.2 MB gzip` | 误引整包（如 `import * as CM from '@codemirror/view'` 之外又多引了一个大依赖）；语言包白名单被绕过 | 看步骤 8 打的 top-10 inputs；跑 `check.mjs` 的 R12/R13 |
| 5 | 终端打不开，Host 抛 `subprocess.spawnTerminal is not available` | 缺 `@deepseek-ai/dsh-sandbox` peer（或宿主版本低于 `0.2.2-rc.1`） | 确认 `peerDependencies` 在；`dsh` 版本在 `engines.dsh` 区间内；不要自己 `spawn` 伪终端 |
| 6 | 反复出现 `E_TRUST_REQUIRED` | 工作区未信任；或信任键写错（`workspace_ide/trust` 之外的位置） | 面板里走一次显式「信任此工作区」；确认 storage key 与契约一致；`E_TRUST_REQUIRED` 必须走受控对话框而不是无限 toast |
| 7 | 终端中文乱码 / 半个汉字 | 在 `Buffer` 层按字节切了 UTF-8；`poll` 的 offset 被当成字节偏移 | 只在 Host 侧按**字符**切缓冲（`terminalBufferBytes` 是上限，切点必须落在完整码点之间）；`poll` 原样回传 offset，客户端不做换算 |
| 8 | SCM 报 `E_GIT_MISSING` / git 找不到 | 宿主环境的 `PATH` 里没有 `git` | 显示安装引导，**不自动下载**；确认不是拼错可执行名；桌面端用绝对路径提示用户装 Xcode CLT |
| 9 | 改完代码，面板还是旧行为 | 浏览器模块缓存；或面板没重新挂载 | 按 §4 三步走；最后重启宿主；确认 `lib/client.js` 的 `mtime` 真的变了 |
| 10 | `Invalid hook call` / hooks 顺序错乱 | react 被打了两份（`external` 漏了 `react/jsx-runtime`）；或 `views` 里用了 `useState` | 补齐 `external` 四项；跑 `check.mjs` R4 |
| 11 | `require is not defined` | 产物 `format` 不是 `iife`；或某依赖用了 `require` 且未被 esbuild 内联 | 确认 `bundle: true` + `format: 'iife'`；对该依赖改 `import` 形态或换库 |
| 12 | `process is not defined` | 源码或依赖读了 `process.env.*` 而 `define` 没覆盖 | 补 `define`（`NODE_ENV` 之外的新变量必须显式给值，不许透传宿主环境） |
| 13 | 结构改了但面板不重排 | 布局用了 JS 计算宽度而不是 CSS Grid 变量 | 尺寸只能走 `--wid-*` + grid（`docs/ui-spec.md` §2），`ResizeObserver` 只用于 xterm `fit()` 与虚拟滚动 |
| 14 | 图谱泳道错位 / 线条穿行 | 客户端重算了布局，或行高与虚拟滚动单位不一致 | 布局只在 Host；客户端 `y = index * 28`，行高必须等于 28px（`docs/graph.md`） |

## 与契约/仓库现状的差异（已复核）

| # | 差异 | 处置 |
| --- | --- | --- |
| 1 | 根 `build`/`dev` 是**显式 `&&` 链**，不是循环 | **已修正** `AGENTS.md`：新增本包必须在根 `package.json` 的 `build` 与 `dev` 两串末尾各追加一条，并补根 `README.md` 包表格 |
| 2 | 仓库既有包用 `build.mjs --check` / 独立 `check-contrast.mjs`，没有统一 `check.mjs` | 本包同时提供：`scripts/check.mjs`（静态规则）+ `build.mjs --check`（产物新鲜度），两套语义不混用 |
| 3 | `marketplace.json` 尚无本包条目 | 首次发布时按 §6 追加；既有 5 条 `ref` 为 `version-3.4.2`，`spec` 不带 ref |
| 4 | `/plugins/<pkg>/assets` 只服务图片 | 已按此设计（布局在 Host、无 worker、无 web font、无 wasm）；将来要放非图片资产需宿主先扩白名单 |
| 5 | `dsh.client.inject` 无官方字段语义说明 | 固定理解为「仅用于排序激活」；若宿主改为「缺包即失败」，需给每个 inject 项补降级说明 |

**已知未决**：`dsh.client.inject` 里列出的官方包名一旦在宿主侧改名，插件会在加载期报缺包——构建期无法自检，只能靠启动日志发现。
