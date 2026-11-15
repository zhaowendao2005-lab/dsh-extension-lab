# DSH 扩展面调研：把「小号 VS Code」做成 DSH 插件可行吗

> 调研对象：本机 DSH 运行时（`/Applications/DeepSeek Harness.app`，profile `desktop`）。
> 结论先行：**可行**。渲染面用「全局面板 + 侧栏图标」，文件/编辑器在前端（CM6 或 Monaco 二选一），
> git/文件写/PTY 在 Host 半侧自建 Remote，终端复用官方 `subprocess.spawnTerminal` 真 PTY。
> 下面每条结论都标了它在运行时装里的出处，便于复核。

---

## 1. 渲染面：第三方插件能注册全局面板（`main` slot）

`@deepseek-ai/dsh-client-ui-layout/src/client/index.ts:71-75`：

```ts
/**
 * Central panel selected by sidebar entry id. The reserved `conversation`
 * key hosts the Conversation; other keys receive no Session binding.
 */
'main': { kind: 'keyed'; scope: 'root' }
```

`dsh-client-ui-layout/README.zh.md:36`：「全局面板占据 root 作用域的 `main` keyed slot；
`conversation` 是为会话界面保留的 key。`ctx.layout.selectPanel(id)` 选中已注册面板，`null` 则选中会话界面」。
插件管理器页（Plugins）就是一个全局面板，其客户端源码 `dsh-client-ui-plugin-manager/src/client/index.ts`
是完整可抄的注册样板：

```ts
ctx.slots.inject('main', function* () {
  const handle = createNavigationStore()
  const instance = handle.create()
  yield ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    store: { ...handle, create: () => instance },
    inject: () => ({ /* face */ }),
    children: { 'plugins.tab': { kind: 'list', scope: 'root' }, /* … */ },
  }, PluginManagerPage)
  // …
})
```

要点：

- 主面板组件**不接收 sessionId**（上引注释：非 `conversation` 的 key 没有 Session 绑定）。
  所以 IDE 面板不预设「当前会话」，工作区根目录要自己解析（见 §3）。
- 面板内的子 slot 由自己的 `children` 声明（`kind`/`scope`），Scope 用 `'root'`。
- 侧栏图标入口：`sidebar.panellist`（`dsh-client-ui-sidebar/src/client/contract/slots.ts:47`：
  `{ kind: 'list'; scope: 'root'; owner: SidebarPanelIconOwnerProps }`，注释「Each list id addresses the
  matching main panel；sidebar owns the button and resolves its label from list metadata」）。
  注册 `{ name: 'sidebar.panellist', id: <与 main key 相同>, order, label, locale }` + 图标组件；
  `dsh-client-ui-sidebar/src/client/index.ts:57-70` 的 `syncPanels()` 会把它们变成可点条目，
  点击走 `ctx.layout.selectPanel(id)`。
- 布局适配（`dsh-client-ui-layout/README.zh.md:43`）：主面板里的**入口型页面**（非对话）必须用
  `--dsh-frame-top-clearance`（macOS 48px 红绿灯带）做顶部内边距，另外有
  `--dsh-frame-leading-clearance`。照抄插件管理器页的处理方式。
- 其它 root 级座位：`shell.bottom`（横跨三列底部的整行，占地方自己控制高度与显隐，默认组合不占用
  —— 可做 IDE 的集成终端/状态栏）、`shell.overlay`（浮层列表，click-through）、`shell.leading`（窗口控件）。
- 硬规则（`dsh-doc/references/practices.md:12,33-36`）：插件 UI 属于宿主 UI 的一部分；只用
  `--dsw-alias-*` 主题 token；**不得**把 Host 生成的 HTML 用 iframe 嵌进来（拿不到主题/明暗/locale）；
  **不得** `require` 任何其它 Harness Client 包（`dsh-client-ui-primitives` 等），必须自己写控件并复制
  markup/CSS/行为，类名加插件前缀；`dsh.client.inject` 只用于排序激活。

## 2. 前端 bundle 的打包与加载协议

`@deepseek-ai/dsh-client-modules/README.zh.md`：

- 宿主扫已启用 Loader 条目的 `dsh.client`（`platform: 'web'`）→ `/plugins/<package>/client.js?rev=` 供 bundle，
  浏览器 `window.__ModuleLoader__` 惰性加载；执行 bundle 只注册 factory（id = 包名），模块副作用在物化时跑。
- **代码分割支持但需要 tsdown**：源码 `import()` 编译成 `require.async("./client.<name>.js")`，
  「该协议只支持自包含 chunk」。本仓库现有做法是 esbuild `format: 'iife'` 单文件（见 §6），
  即**不支持拆 chunk**；xterm/Monaco 这类大依赖都得进同一个 `client.js`。
- 共享模块表 `PLATFORM_MODULES`（外壳初始化时冻结），每个动态 bundle 对其解析 external；
  `dsh.client.external` 只加基座之外的**精确**请求。`react` 在基座里（`require('react')` 可用），
  其它第三方库一律打包进 bundle。
- **包资源路由** `/plugins/<package>/assets/<path>` 只服务 `.svg/.png/.webp/.jpg/.jpeg`
  （SHA-1 前 12 位插文件名，引用编译成 `require.asset(...)`）。→ **wasm / 字体不能走资源路由**：
  Shiki 的 oniguruma wasm、`.ttf/.woff2` 必须内联进 bundle（base64）或另起宿主路由。
- 启动前必须已产出 `lib/client.js`（缺失会报构建说明）。bundle revision 由入口 mtime/ctime/size 派生。

## 3. 工作区根目录怎么来

- 会话的真实工作区 = `session.header.cwd`（Host 侧）。官方做法见
  `packages/dsh-plugin-dev-sandbox/backend/service.js:13-25`：Host 从 `sessionId` 经
  `ctx.sessionController.resolveAgent(sessionId)` 取出 `session.header.cwd`，
  **绝不信任 wire 上传来的路径**。
- 前端也能自己拿到默认根：`ctx.sessions.list`（`ISessions.list: ObservableSnapshot<SessionListState>`，
  `dsh-api-session-controller/src/client/contract/sessions.ts:51`），
  `SessionListState = { ids: SessionId[], byId: Record<SessionId, SessionSummary>, phase, projectionsBySession }`，
  `SessionSummary` 含 `cwd?: string`、`updatedAt: number`、`displayTitle`（`src/client/sessions/service.ts:27-51`）。
  → 取 `updatedAt` 最大且有 `cwd` 的会话作为默认根目录，UI 里再提供「Open Folder」换根。
- 选目录：客户端 `ctx.uiWorkspace.pickDirectory()`；Host 侧有 `directoryPickerController`。

## 4. 文件读写通道（两种，可组合）

| 通道 | 位置 | 能力 | 评价 |
| --- | --- | --- | --- |
| 官方 Remote `workspaceFiles` | 客户端 `ctx.remote.workspaceFiles` | `read(scope,path,range,signal)` 分页文本、`readBytes`、`stat`、`list`（目录）、`search`、流式 `changes`（watch） | 官方文档预览正在用（`dsh-client-ui-sidebar-documentpreview/src/client/index.ts:83` inject `remote.workspaceFiles`，`code/index.ts` 是代码预览渲染器）；只读 |
| 自建 Host Remote（本仓库惯用法） | `packages/dsh-plugin-dev-sandbox/backend/contract.js` | 任意 fs/git/PTY，单入口 `execute(request)` + zod 校验 | 读写都能做，协议自由；要自己写安全校验 |

**决策建议**：读写都走**自建 Remote**（一个 namespace、一组 action），理由：写文件、git、PTY 本来就要自建；
混两套通道会让「同一路径的两个真相」出现。只读场景也不必借 `workspaceFiles`。
同时把官方 `fs` 服务的 `FsVersion` 乐观并发语义学过来（`writeText(expected)` 带版本），避免覆盖用户/AI 的并发修改。

## 5. 终端：复用「现场的」真 PTY

已经跑在本 profile 里的 `dsh-plugin-dev-sandbox` 就是现成实现（`backend/manager.js:508-556`）：

```js
// spec
{ argv: [shell, ...args], cwd, env, rows, cols, terminalType: 'xterm-256color', graceMs }
// handle
const handle = await subprocess.spawnTerminal(spec) // { pid, done, output: Readable, terminate() }
```

- `subprocess` 是官方 Host Service（`resolveExecutable` / `terminalEnvironment` / `spawn` / `spawnTerminal`）。
- 字节流由 Host 每终端环形缓冲 + 字符游标提供，前端 `terminalPoll(terminalId, offset)` 续读
  （落后过多返回 `dropped`）；`terminalResize` 把窗口尺寸同步给 PTY；`graceMs` 是 SIGTERM→SIGKILL 宽限。
- 前端 xterm：`@xterm/xterm 6.0.0` + `@xterm/addon-fit 0.11.0`，resize 用 ResizeObserver → `fit()`。
- 官方右侧终端（`dsh-api-terminal-controller` 的客户端服务 `ctx.webTerminals`）有更完整的模型
  （`TerminalView`：`phase/environment/title/info/writable/render`，`TerminalFrame` = snapshot/output/state/ack，
  输入窗口流控、重连、close 请求持久化）。但 `ClientTerminals.reconcileHolds()`
  （`src/client/index.ts:236-256`）只用官方 sidebar-terminal 通过 `retainTabs()` 独占写入的 `openTabs`
  构造 wanted 集合，插件把嵌入式终端塞进同一服务会被下一次侧栏变更 release 掉 hold
  → **嵌入到我们自己的面板里时不要复用 `ctx.webTerminals`，用 `subprocess.spawnTerminal` 自管**（沙箱已验证）。
  若将来想「在 IDE 里打开官方终端 tab」，走 `ctx.sidebarRight.openTabIn(...)`，那是另一条路。

## 6. 本仓库既有的插件骨架（直接作为新包模板）

`packages/dsh-plugin-dev-sandbox`：

- `package.json`：`"type":"module"`，`exports` = `./lib/index.js`（Host）+ `./lib/client.js`（浏览器），
  `"dsh": { manifestVersion: 1, bundle: { patch: './integration/cordis.patch.yml' }, client: { platform: 'web', inject: [...] } }`。
- `scripts/build.mjs`：清空 `lib/`；backend/*.js 逐个原样拷进 `lib/`（只拷入口会 ERR_MODULE_NOT_FOUND）；
  frontend 用 esbuild `format:'iife'` 打成单文件 `lib/client.js`，`loader: {'.css': 'text'}`（样式随 JS 走，
  运行时 `<style>` 注入）；构建前断言入口里有 `window.__ModuleLoader__.load` 和 `export function apply`。
- 前端入口 `frontend/index.js` 形状：
  ```js
  window.__ModuleLoader__.load({ id: '<包名>', factory(require) {
    const React = require('react')
    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(remoteInfo)   // 挂自己的 Remote
      ctx.effect(() => unmount)
      ctx.inject(['remote.<namespace>'], (c) => { /* slots 注册 */ })
    }
    return { name: '<包名>', inject: ['slots', 'remote', /* … */], apply }
  }})
  ```
- Host 入口 `backend/index.js`：`export const name/inject`、`export function apply(ctx)`，
  `ctx.effect(() => ctx.typert.register(hostContribution))`，服务类 `extends Service`，
  `bindTypertRemote(this, '<namespace>')` + `createTypertRemoteInfo({...})` 描述符（`backend/contract.js`）。
- 状态规则：views 不持有本地 state，展开/选中都在全局 store；Host snapshot 是唯一真相，
  所有读写经 `stores/*.datasource.js` 一次 Remote 调用。

## 7. 主题与外观

- 只用 `--dsw-alias-*` token（`ctx.theme.getTheme()` / `ctx.on('theme/change')`；
  明暗切换由宿主完成）。字面颜色仅限插画。
- 官方约定：代码字体 `--dsh-code-font-size` / 内容字号 `--dsh-content-font-size` / 终端字号
  `--dsh-terminal-font-size`（由主题呈现器写到 `body`）。编辑器/终端应读这几个变量。
- 语言文案走 `ctx.locale.register(NS, {zh,en,…})`，slot 注册带 `locale: NS`。

## 8. 待定/风险

1. **单文件 bundle 的体积**：esbuild IIFE 不能拆 chunk。CM6 路线约 0.6–1.0 MB(min)，Monaco 路线
   约 3–5 MB(min) 且 worker 需 blob 内联（资源路由不服务 `.wasm`/`.js`）。→ 见 `research/editor.md`。
2. **主面板没有 sessionId**：需自带「工作区选择」状态并持久化（插件 storage 或 Host 侧 json）。
3. **大文件/超大目录**：`workspaceFiles.read` 的分页语义适合流式读；自建 Remote 要自己定分页协议
   （按行 range，返回 `eof` 与 `nextOffset`）。
4. **git 命令注入面**：Host 侧 spawn 必须 `argv` 数组（不过 shell），并默认禁用网络操作（fetch/push 需显式点）。
5. **写文件与 AI 并发**：借鉴 `fs.writeText(expected)` 的版本校验，冲突时提示重新加载。
