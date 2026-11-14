# 终端：PTY 通道、环形缓冲与 xterm 装配

> 本文是 `terminal.*` 的实现规格：Host 侧 PTY/缓冲/偏移协议、客户端 xterm 装配与轮询、生命周期、安全边界、性能与已知限制。
> 与官方 `ctx.webTerminals` 的关系见 [ARCHITECTURE.md](../ARCHITECTURE.md)（hold 冲突）；动作/字段唯一出处 [remote-contract.md](./remote-contract.md) §5；env 白名单与转义欺骗的唯一出处 [security.md](./security.md) §7。
> 实现来源是**复制** `packages/dsh-plugin-dev-sandbox`（下称 sandbox），不共享模块、不改该包。**不写实现代码**。

## 1. 与 sandbox 的关系

### 1.1 复制的精确清单

| # | 源文件 | 复制什么 | 落到本包 | 改动 |
|---|---|---|---|---|
| 1 | `backend/manager.js` L8–L20 | `SESSION_ID`、`DEFAULT_LOG_BYTES`、`MAX_MANIFEST_BYTES`、`FORBIDDEN_ENV` | `backend/terminal.js` | `SESSION_ID` → `WID_ID` |
| 2 | 同 L96–L110 | `cleanEnvironment(source, home)` | 同名 | 公式不变（先按 `FORBIDDEN_ENV` 剔除，再强制自己的 `HOME`/`XDG_*`） |
| 3 | 同 L112–L117 | `terminalId(value)` | `widTerminalId` | 抛 `ErrCode` 而非裸 `TypeError` |
| 4 | 同 L119–L123 | `terminalDimension(value, fallback, name)` | 同名 | 上限改 `cols ≤ 500 / rows ≤ 300`（对齐 sandbox `contract.js` 的 zod 区间） |
| 5 | 同 L125–L140 | `terminalOverrides(env)`：把 `process.env` 全部键置 `undefined` 再合并白名单（墓碑法） | 同名 | **必须保留**，这是"不继承 `...process.env`"的实现手段 |
| 6 | 同 L142–L150 | `terminalArguments(shell, platform)` | 同名 | 无改动 |
| 7 | 同 L365–L373 | `maxTerminalChars` + `appendTerminalOutput(terminal, chunk)` | 同名，`maxTerminalChars = 512 * 1024` | sandbox 是 256 KiB，契约 `limits.terminalBufferBytes` 是 **512 KiB** → 必改 |
| 8 | 同 L502–L526 | `terminalFailure` / `terminalSpec(ctx, input)` | 同名 | `cwd`/`env` 见 §2；报错改 `E_UNSUPPORTED` |
| 9 | 同 L528–L568 | `startTerminal(item, terminal, spec)` | `startPty(entry, spec)` | 保留三件事：`done` 立即挂 rejection、`setEncoding('utf8')`、reader 里不 await 关闭 |
| 10 | 同 L570–L589 | `terminateTerminal(item, terminal)` | `stopPty(entry)` | 加 `stopTimeoutMs = 500` |
| 11 | 同 L699–L830 | `terminalCreate/Write/Poll/Resize/Close` 的**形状** | `backend/terminal.js` 按契约六个动作重写 | 返回值必须是契约字段（§13 #1–#3） |
| 12 | `frontend/service/terminal.service.js` L1–L64 | `createTerminalChannel({poll, terminalId, onData, interval = 120})` 骨架 | `frontend/service/terminal.service.ts` | 加退避、可见性暂停、`E_TERMINAL_GONE`（§5） |
| 13 | `frontend/views/body/work/terminals/TerminalView.js` L1–L59 | 装配顺序（`new Terminal` → `FitAddon` → `open` → `onData` → channel → `ResizeObserver` → 清理） | `frontend/views/panel/TerminalView.tsx` | 主题与字号改读 token（§4），**禁止**硬编码色值 |

**不复制**：`groupAlive`/`signal`/`terminate`（sandbox 给自己子进程用的，PTY 组由 provider 的 `terminate()` 负责）、`cleanTerminal()`（ANSI/OSC 剥离，只为塞 `<pre>` 而写）、`terminalStateGlyph` 的 emoji 文案。

### 1.2 为什么不共享模块

| 理由 | 说明 |
|---|---|
| 不改存量包 | sandbox 是已发布能力的实现，往它里面加导出面 = 动它的构建与契约，风险外溢 |
| 契约不同 | sandbox 的 `poll` 返回 `state`、`dropped` 是数字（§13 #1/#2），共享等于把两套 wire 揉成一套 |
| 生命周期不同 | sandbox 的终端绑 `pluginPath` + binding；本包绑 workspace root + 标签 |
| 体积 | 单独抽包多一层间接，而复制量只有 ~200 行 |

将来抽公共包的条件（**三条全中**）：①除这两个插件外还有第三个终端消费者；②wire 已统一（`dropped:boolean` + `exited/exitCode`）；③能在一个 PR 里同时改三处且各自有测试。

### 1.3 复制后允许的差异

| 项 | 规则 |
|---|---|
| 命名 | 类名 `wid-`、函数 `wid*`（`widSpawn`）、CSS 变量 `--wid-*`；`WID_ID` 替代 `SESSION_ID` |
| 错误码 | 一律映射 `ErrCode`，不抛裸 `Error`；sandbox 的 `Error("True PTY terminals require…")` → `E_UNSUPPORTED` |
| 日志 | 前缀 `[wid-terminal]`；只记 `{terminalId, pid, state, exitCode}`，**永不记终端内容** |
| 上限 | `maxTerminalChars = 512 * 1024`、`stopTimeoutMs = 500`、`MAX_TABS = 8` |
| 保留 | `graceMs = 250`（sandbox L244）：交互式 shell 忽略 `SIGTERM`，长 grace 只是拖慢必然要来的 `SIGKILL` |
| 保留 | 墓碑法 env、`exitCode ?? null`、`for await` 排空、`done` 立即挂 rejection —— 四处注释在 sandbox 里已写明原因，**照抄注释** |

## 2. Host 侧 PTY

### 2.1 spec 构造

```js
async function widTerminalSpec(ctx, input) {
  const subprocess = ctx.subprocess
  if (typeof subprocess?.spawnTerminal !== 'function') {
    throw ideError('E_UNSUPPORTED', '需要官方 subprocess 服务才能创建真终端（当前宿主未提供 subprocess.spawnTerminal）')
  }
  const environment = await subprocess.terminalEnvironment()      // 白名单来源，不是 process.env
  const platform = environment.platform || (process.platform === 'win32' ? 'windows' : 'posix')
  let shell = environment.defaultShell
    || (platform === 'windows' ? environment.env.ComSpec || 'cmd.exe' : environment.env.SHELL || '/bin/sh')
  if (typeof shell !== 'string' || shell.includes('\0')) throw ideError('E_UNSUPPORTED', '终端默认外壳不可用')
  const env = widTerminalOverrides({ ...widEnvWhitelist(environment.env), PWD: input.cwd, TERM: 'xterm-256color' })
  if (typeof subprocess.resolveExecutable === 'function') shell = await subprocess.resolveExecutable(shell, env)
  return { argv: [shell, ...widTerminalArguments(shell, platform)], cwd: input.cwd, env,
           rows: input.rows ?? 24, cols: input.cols ?? 80, terminalType: 'xterm-256color', graceMs: 250 }
}
```

| spec 字段 | 值 |
|---|---|
| `argv[0]` | 已 `resolveExecutable` 的绝对路径（`terminalEnvironment().defaultShell`） |
| `argv[1..]` | §1.1 #6 的交互参数（`bash --noprofile --norc -i` / `zsh -f -i` / `fish --no-config -i` / `pwsh -NoLogo -NoProfile` / `cmd /d /q`） |
| `cwd` | `path.resolve(root, rel)` → `realpath`，带 `/` 边界前缀校验；越界 `E_OUTSIDE_ROOT`；默认 workspace root |
| `rows`/`cols` | 客户端 `fit()` 后的值，缺省 24/80；zod `rows` 2..300、`cols` 10..500 |
| `env` | §2.2 的 11 个键 + `PWD` + `TERM`；禁止 `...process.env`、禁止 `...ctx.env` 直传 |
| `terminalType` | 固定 `xterm-256color`（与 `TERM` 一致） |
| `graceMs` | `250` |

`E_UNSUPPORTED` 的 UI：创建按钮 `disabled` + tooltip「需要官方 subprocess 服务」，面板顶部一行说明；**不弹 toast**（未实现能力不许"点了没反应"）。

### 2.2 env 白名单（security.md §7.2 的实现）

| 键 | 取值 | 缺失时 |
|---|---|---|
| `PATH` | `environment.env.PATH` | spec 照发，debug 记 `path-missing` |
| `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` | 同源 | 缺则略过 |
| `PWD` | `input.cwd` | 必填 |
| `LANG` `LC_ALL` `LC_CTYPE` | 用户 locale（CJK/emoji 正常） | 缺则不加，**不**伪造 `C` |
| `TERM` | 固定 `xterm-256color` | 必填 |

白名单输出里永不出现的键（Host 单测断言）：`^DSH_`、`*_API_KEY`、`OPENAI_*`、`ANTHROPIC_*`、`DEEPSEEK_*`、`AWS_*`、`GCP_*`、`AZURE_*`、`GITHUB_TOKEN`、`CI_*`、`GIT_DIR`、`GIT_TERMINAL_PROMPT`、`GIT_OPTIONAL_LOCKS`、`npm_*`、`npm_config_*`、`AUTH`、`COOKIE`、`SECRET`、`TOKEN`。实现 = `FORBIDDEN_ENV` 正则剔除 + 墓碑法：provider 会把 overrides 合并到它自己的环境，墓碑防止被剔掉的键借 provider 回归。

### 2.3 handle 消费

```js
async function startPty(entry, spec) {
  const handle = await entry.subprocess.spawnTerminal(spec)
  entry.pid = handle.pid ?? null; entry.state = 'running'
  // ① done 立即挂 rejection：provider 失败可能独立于 Readable 的 end/error
  entry.done = Promise.resolve(handle.done)
    .then((o) => { entry.exitCode = o?.exitCode ?? null; entry.signal = o?.signal ?? null; entry.exited = true })
    .catch((error) => { entry.exited = true; entry.error = error })
  handle.output.setEncoding('utf8')                       // ② 字符边界由 JS 字符串保证（§3.3）
  entry.outputDone = (async () => {                       // ③ reader 里绝不 await 关闭
    try {
      for await (const chunk of handle.output) {
        const { body, title } = widExtractTitle(chunk)    // §8 OSC 0/2
        if (title) entry.title = title
        if (body) appendOutput(entry, body)
      }
    } catch (error) { entry.error = error; void stopPty(entry).catch(() => {}) }
  })()
  void entry.done.then(() => stopPty(entry)).catch(() => {})   // ④ shell 退出 ≠ 进程组全灭
}
```

| 收尾动作 | 顺序 |
|---|---|
| `stopPty` | memo `cleanup` → `stopping=true` → `await handle.terminate()`（provider 负责 `SIGTERM`→`graceMs`→`SIGKILL` 整个进程组）→ `await Promise.all([entry.done, entry.outputDone])` → `handle=null`、`state='closed'` |
| 客户端 `terminal.close` 预算 | `terminate()` ≤250 ms + `done` ≤250 ms + 兜底 **2 s 强杀**；客户端超时 2 s 先乐观移除标签，失败回滚 |
| 进程组 | 由 provider 的 `detached:true` + `kill(-pid)` 保证；本包**不**自己 `process.kill`（跨平台不可靠） |

## 3. 环形缓冲与偏移协议

### 3.1 结构（实为"尾窗字符串"，不是块式环）

```js
// entry.buffer: string  —— 最近 maxTerminalChars 个 UTF-16 code unit
// entry.end:    number  —— 从 PTY 启动至今累计写入的 code unit 数（单调递增，永不回退）
const maxTerminalChars = 512 * 1024        // limits.terminalBufferBytes
function appendOutput(entry, text) {
  if (!text) return
  entry.end += text.length                 // 字符偏移，不是 Buffer.byteLength
  entry.buffer += text
  if (entry.buffer.length > maxTerminalChars) entry.buffer = entry.buffer.slice(entry.buffer.length - maxTerminalChars)
}
```

不用块式环的原因：块式环要"按块擦除"才能让 offset → 块索引的映射稳定；尾窗只需 `end - buffer.length` 一个算式得到窗口起点，且**天然不切半个码点**（切片点是整段拼接边界，§3.3）。

| 字段 | 语义 |
|---|---|
| `end` | 累计 code unit 数 = 下一个字符将写入的游标 |
| `start` | `end - buffer.length` = 窗口起点 = 累计丢弃量 |

### 3.2 `poll(offset)`

```js
function pollTerminal(entry, offsetInput) {
  const offset = Number.isSafeInteger(offsetInput) && offsetInput >= 0 ? offsetInput : 0
  const start = entry.end - entry.buffer.length
  const from = Math.max(offset, start)                       // 落后就截到窗口起点
  return { data: entry.buffer.slice(from - start), offset: entry.end, dropped: from > offset,
           exited: entry.exited === true, exitCode: entry.exitCode ?? null, title: entry.title ?? null }
}
```

| 客户端拿到的 `offset` | 含义 |
|---|---|
| 用响应里的 `offset` 覆盖本地值 | 唯一正确用法；**不要** `offset += data.length`（Host 丢弃时必然算错） |
| `dropped:true` | 本地游标落后超过 512 KiB，已丢数据；照样采用新 `offset`，toast「输出已截断」（同终端 3 s 内只提示一次，防 `yes` 刷屏） |
| `exited:true` | 标签转"已结束"，保留输出与 `exitCode`；停轮询，`关闭`仍可用 |

> 契约写"落后超限时 `dropped:true`"，sandbox 返回的是**数值**（丢弃字符数，§13 #1）。本包 Host 必须返回 boolean；丢弃量只进 debug 日志。

### 3.3 UTF-8 / 多字节安全（三条硬规则）

1. **偏移单位是 UTF-16 code unit**（`String.prototype.length`）——两端都是 JS，天然一致。`offset` 的真实含义是"码元数"，不是字节数，也不是 grapheme 数（emoji = 2，CJK = 1）。
2. **绝不按字节切**：不出现 `Buffer`、`byteLength`、`subarray` 这类按固定字节数截断的写法。`setEncoding('utf8')` 已让 Node 解码器处理跨 chunk 的多字节序列；进入 buffer 的每个 chunk 都是完整码点。
3. **切片点只来自 `end` 的算术**：`from` 恒为"某次写入后的 `end`"或窗口起点，两者都落在字符串拼接边界上，因此 `buffer.slice()` 不会产生孤立代理项。任何固定大小分块（`slice(i, i + 4096)`）都会破坏这条不变量 —— 禁止。

自检（Host 单测）：写入 `'你好🙂世界'` 后反复 `poll(0)`，断言拼回等于原文、每个码点 `length ≤ 2`、无单独 `\uD800–\uDBFF`。

## 4. 客户端 xterm 装配

### 4.1 配置

```tsx
const term = new Terminal({
  fontSize: readFontSize(),                       // --dsh-terminal-font-size，缺省 12
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  scrollback: 2000, allowProposedApi: false, convertEol: false, cursorBlink: true, cursorStyle: 'block',
  theme: readTermTheme(),                         // §4.2，禁止字面色值
})
const fit = new FitAddon(); term.loadAddon(fit); term.open(hostRef.current!)
```

| 项 | 值 | 理由 |
|---|---|---|
| `fontSize` | `parseFloat(getComputedStyle(document.body).getPropertyValue('--dsh-terminal-font-size')) \|\| 12` | 与面板其他 mono 文本一致；字号变化要重算 cell（§6） |
| `scrollback` | `2000` | 内存上限（§11）；更早历史在 Host 512 KiB 窗口外不可回看 |
| `allowProposedApi` | `false` | 不依赖私有 API；开了等于允许后续偷偷用 `_core` |
| `convertEol` | `false` | 打开会让多行输出错位（PTY 已用 `\r\n`） |

### 4.2 从 token 取色（`color-mix()` 必须过探针）

`getComputedStyle(el).getPropertyValue('--x')` 对 `var()` 会代换，但对 `color-mix(...)` 返回的是原始函数串（不能喂给 xterm）。统一用探针把 token 解析成 `rgb()`：

```js
const probe = document.createElement('span'); probe.style.display = 'none'; document.body.appendChild(probe)
function tokenColor(name, fallback) {
  probe.style.color = ''
  probe.style.color = `var(${name}${fallback ? `, ${fallback}` : ''})`
  const resolved = getComputedStyle(probe).color          // 恒为 rgb()/rgba()
  return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : null
}
const TERM_TOKENS = { background: '--dsw-alias-bg-layer-1', foreground: '--dsw-alias-label-primary',
  cursor: '--dsw-alias-label-primary', cursorAccent: '--dsw-alias-bg-layer-1',
  selectionBackground: '--dsw-alias-state-business-tertiary', black: '--dsw-alias-label-primary',
  red: '--dsw-alias-state-error-primary', green: '--dsw-alias-state-success-primary',
  yellow: '--dsw-alias-state-warn-primary', blue: '--dsw-alias-state-business-primary',
  magenta: '--dsw-alias-link', cyan: '--dsw-alias-state-done-primary', white: '--dsw-alias-label-secondary',
  brightBlack: '--dsw-alias-label-tertiary', brightRed: '--dsw-alias-state-error-primary',
  brightGreen: '--dsw-alias-state-success-primary', brightYellow: '--dsw-alias-state-warn-label',
  brightBlue: '--dsw-alias-state-business-tertiary', brightMagenta: '--dsw-alias-link',
  brightCyan: '--dsw-alias-state-done-primary', brightWhite: '--dsw-alias-label-primary' }
const readTermTheme = () => Object.fromEntries(Object.entries(TERM_TOKENS).map(([k, v]) => [k, tokenColor(v)]))
```

主题切换的重读时机：`MutationObserver` 观察 `document.body` 的 `class`/`data-*`（命中 `data-ds-dark-theme` 变化）+ `matchMedia('(prefers-color-scheme: dark)')` 的 `change`（宿主跟系统走时不改 body 属性）。回调里：①`term.options.theme = readTermTheme()`（xterm 重绘，不丢 buffer）②下一帧重读字号 ③重新 `fit()`。

### 4.3 输入、IME 与 fit

| 事件 | 处理 |
|---|---|
| `term.onData((d) => store.write(terminalId, d))` | 直接发 `terminal.write`，**不做任何节流** |
| 为什么不节流 | IME 组合期 `onData` 连续产出中间串；节流/合并会丢字符或把 `\x7f` 与后续字符拼错。顺序由浏览器保证，我们只当下游 |
| 单次写入上限 | 实际限制 64 KiB（§13 #4）→ `d.length > 65536` 时按 UTF-16 边界切成多段依次发（`slice` 到算术边界，同 §3.3） |
| 组合期 | `compositionstart` 时只加 `aria-busy`（不改 xterm 选项）；`compositionend` 后清除 |
| `fit()` | `ResizeObserver` observe 容器 + 分隔条 `pointerup` + 标签切换 + `document.fonts.ready` |

## 5. 轮询循环

```js
export function createTerminalChannel({ poll, terminalId, onData, onLost, interval = 120 }) {
  let offset = 0, busy = false, stopped = false, failures = 0, delay = interval, timer = null
  async function tick() {
    if (stopped || busy) return                  // in-flight 标记：永不堆积
    busy = true
    try {
      const res = await poll({ terminalId, offset })
      failures = 0; delay = interval
      offset = res.offset                        // 只用响应里的 offset
      if (res.dropped) onData(null, { dropped: true })
      if (res.data) onData(res.data)
      if (res.exited) { onLost?.('exited'); stop() }
    } catch (error) {
      failures += 1
      if (isGone(error)) { onLost?.('gone'); stop(); return }
      if (failures >= 5) { onLost?.('disconnected'); stop(); return }
      delay = failures < 3 ? interval : failures === 3 ? 1000 : 5000
    } finally {
      busy = false
      if (!stopped) { clearTimeout(timer); timer = setTimeout(tick, delay) }   // setTimeout 链，不用 setInterval
    }
  }
  const resume = () => { if (!stopped && !timer) void tick() }
  return { resume, stop() { stopped = true; clearTimeout(timer); timer = null }, get offset() { return offset } }
}
```

| 条件 | 行为 |
|---|---|
| 间隔 | `120` ms（术语表 / ARCHITECTURE）；`setTimeout` 链避免上一拍慢时排队 |
| 页面隐藏 | `visibilityState === 'hidden'` → 停定时器（保留 `offset`）；`visibilitychange` 回来自动 `resume()` 并立刻拉一拍 |
| 标签/面板未激活 | 只轮询**活动标签**；切走保存 `offset` 并停，切回 `resume()`（8 标签全轮询 = 66 req/s，没必要） |
| 失败退避 | 1–2 次保持 120 ms；第 3 次 1000 ms；第 4 次 5000 ms；第 5 次停 + 「连接中断」+ 重连按钮 |
| `E_TERMINAL_GONE` | 立刻停 + 标签标"已关闭" + 从 store 移除，不重试 |
| 重连 | 清 `failures`，`offset` 保留（Host 窗口还在则续上；已过窗口则 `dropped:true`） |
| 卸载 | `useEffect` cleanup 调 `channel.stop()`；Host 端**不动**（标签切走不 kill） |
| 首帧 | `terminal.create` 后立即跑一拍，不等 120 ms，避免空屏 |

## 6. 尺寸协同

| 时机 | 动作 |
|---|---|
| 面板拖拽结束（`pointerup`） | `scheduleFit()`：`fit.fit()` → `term.cols/rows` 变化 → `terminal.resize` |
| 窗口 `resize` | 同上（`ResizeObserver` 已覆盖，防抖 100 ms） |
| 标签切换 | 目标容器挂载后才可测 → `useLayoutEffect` 里 fit 一次 |
| `document.fonts.ready` | 等宽字体迟到会让 cell 宽变 → fit 后补一次 `terminal.resize` |
| 首个终端创建 | fit **先**、create 后（create 需要 `cols/rows`） |
| 字号变化 | fit → resize（cell 尺寸变，行列数也变） |

`terminal.resize` 节流 **≥100 ms**（`scheduleFit` 内 `clearTimeout` + `setTimeout(flush, 100)`，尾触发保证最后一次一定发出；连续拖拽只发最后一拍）。

Host 语义：行/列变化 → `handle.resize(cols, rows)`（**参数顺序 cols 在前、rows 在后**，与 spec 对象 `{rows, cols}` 相反，sandbox L784 即如此）→ provider 对 PTY 做 `TIOCSWINSZ` → 内核向前台进程组发 `SIGWINCH`。含义：行数变小**不会**丢已有输出（输出是流，只是屏幕重排）；列数变化会让 `vim`/`htop` 重绘、`bash` 的 `COLUMNS` 跟着更新。handle 没有 `resize` 方法时：返回当前快照、不抛错，首次提示一次「该外壳不支持动态改尺寸」（照抄 sandbox 的 optional-method 判断）。

## 7. 生命周期与孤儿回收

```text
create   terminal.create{cwd,cols,rows} → {terminalId,pid,shell,title} → tabs[terminalId]，offset=0，channel.start()
attach   标签切到该终端 → 重新 fit → channel.resume()（offset 继续）
detach   标签切走 → channel.stop()，Host PTY 照跑（这是设计，不是泄漏）
close    乐观移除标签 → terminal.close → 成功即弃；失败回滚标签 + 错误条（Host：terminate() → 等 done → 2 s 内强杀）
refresh  mount → terminal.list → Host 有而 tabs 无 → 逐个 terminal.close（孤儿）
                              → tabs 有而 list 无 → 标"已关闭"、移除并 toast
idle     Host 空闲 30 min 回收 → 下次 poll 返回 E_TERMINAL_GONE → 按 §5 处理
dispose  ctx.effect disposer：所有 terminal.close（并发 4，失败只记日志）→ 清所有定时器
```

| 场景 | 期望 |
|---|---|
| 浏览器刷新 | 标签全丢；对账后旧终端被 close，新会话从空白开始（**不**复用旧 PTY） |
| 面板关闭（插件仍加载） | 标签留在 store，轮询停；重开面板恢复标签并按 `offset` 续上 |
| 插件禁用/卸载 | dispose 后 `terminal.list` 为空（单测断言） |
| 进程内崩溃 | 下次启动 `list` 对账发现孤儿 → close（Host 30 min 兜底） |

## 8. 多标签与标题

| 项 | 规则 |
|---|---|
| 创建 | `terminal.create` 返回 `title`，Host 生成 `${basename(shell)} ${序号}`（如 `zsh 1`），序号取"当前活跃终端数 + 1"避免重名 |
| 显示 | 标签文字 = `tabs[i].customTitle ?? hostTitle`（`customTitle` 仅客户端，P1） |
| 重命名 | 双击标签 → 内联输入（≤64 字）→ 只写 store（契约无 `terminal.rename`，§13 #6）；重启后丢 |
| 上限 | `MAX_TABS = 8`；达到后「新终端」`disabled` + tooltip「最多 8 个终端（内存预算）」；其他入口触发 → toast「最多 8 个终端，请先关闭一个」 |
| 结束态 | `exited` → 标签加灰色 `exit 0`/`exit 137` 徽章，内容可滚动查看，关闭按钮仍可用 |
| 状态点 | 运行中实心点；连接中断空心点 + 感叹号；已结束无点 |

OSC 0/2 标题（P1）：从**字节流里剥离**，经 `poll.title` 单独下发，屏幕数据不受污染。

```js
const OSC_TITLE = /[\u001b\][02];([^\u0007\u001b]*)(?:\u0007|\u001b\\)/
function widExtractTitle(text) {
  const match = OSC_TITLE.exec(text)
  if (!match) return { body: text, title: null }
  const title = match[1].replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256)   // security.md §7.3
  return { body: text.replace(OSC_TITLE, ''), title }
}
```

> 其余 OSC（含 OSC 8 超链接、OSC 52 剪贴板）**原样留在流里交给 xterm**，我们不注册任何 handler —— 这正是 security.md §7.3 的边界：不裁剪就无害（xterm 不执行），裁剪反而会让用户以为是我们的能力。

## 9. 剪贴板与链接

| 操作 | 行为 |
|---|---|
| `Cmd/Ctrl+V` | **不拦截**，交给 xterm 的 paste 路径（含 bracketed paste：目标程序要求时自动包 `\e[200~…\e[201~`） |
| `Cmd/Ctrl+C` 有选区 | 拦截：`navigator.clipboard.writeText(term.getSelection())`，**不**发 `\x03` |
| `Cmd/Ctrl+C` 无选区 | **不拦截**：xterm 自己发 `\x03`（SIGINT）；拦截会破坏 `^C` 语义 |
| `Cmd/Ctrl+Shift+C` | 始终复制（"想复制又不确定有没有选区"的兜底） |
| 右键 | 菜单：复制 / 粘贴 / 全选 / 清屏（`term.clear()` 只清屏不清 buffer） |
| 多行粘贴 | 不额外插 `\r`、不自动回车；目标程序未开 bracketed paste 时换行会被 shell 执行 —— 终端固有行为，非插件引入（P2 可加"≥3 行先确认"） |

URL 检测结论：**自写**，且**不注册** provider。三条理由：①`@xterm/addon-web-links` 的实现就是 `term.registerLinkProvider(...)`，匹配的正是 OSC 8 序列 —— 等于给 security.md §7.3 明令不注册的东西开后门，其 provider 还会拦容器内鼠标事件；②多一个依赖（体积与环境白名单都紧）；③我们要"先确认再打开"，addon 的悬浮下划线 + 单击直开不符合。

```ts
function urlAt(term: Terminal, event: MouseEvent): string | null {
  const screen = term.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!screen) return null
  const rect = screen.getBoundingClientRect()
  const col = Math.floor((event.clientX - rect.left) / (rect.width / term.cols))       // 等宽字体的平均 cell
  const row = Math.floor((event.clientY - rect.top) / (rect.height / term.rows))
  const text = term.buffer.active.getLine(term.buffer.active.viewportY + row)?.translateToString(true) ?? ''
  for (const m of text.matchAll(/(?:https?|file):\/\/[^\s"'<>]+/g))
    if (col >= m.index! && col <= m.index! + m[0].length) return m[0]
  return null
}
```

触发：按住 `Cmd`（macOS）/`Ctrl`（其他）时容器 `cursor: pointer`，点击 → 二次确认弹窗（显示**完整** URL）→ 宿主 `openExternal`。宿主无该能力时弹窗只提供「复制链接」并注明。仅允许 `https:`/`http:`/`file:`（`file:` 需二次确认且必须在 root 内）。限制：命中基于平均 cell，极端 DPI 可能偏 1 列 —— 弹窗显示完整 URL 兜底；精确命中要 `allowProposedApi: true` 读 `_core`，不做。

## 10. 安全

| 项 | 规则 | 出处 |
|---|---|---|
| 未信任目录 | `trust !== 'trusted'` → `E_TRUST_REQUIRED`，弹确认框（绝对 `cwd` + 「终端里的命令以你的身份执行，不经任何沙箱」），确认后**一次一个**终端；确认状态不缓存到仓库 | security.md §7.1 |
| env | §2.2 白名单；禁止 `...process.env` | security.md §7.2 |
| 不自动执行 | 无"运行"按钮、不自动 `cd`、不自动 `source`、不自动粘贴命令；终端只响应键盘 | security.md §7.1 |
| 多行粘贴 | 不自动回车（§9） | 本文 |
| 转义欺骗 | `\e]0` → 只经 `poll.title` 显示、截 256 字、去控制字符（§8）；`\e[8m` 隐藏文本**不防御**，但终端内容只进 xterm buffer，永不进我们的 Markdown/diff/通知渲染 | security.md §7.3 / §12 |
| 隐藏字符警告 | P2：检测 SGR 8（conceal）出现的行，标签旁加「含隐藏字符」，不隐藏、不改内容 | security.md §12 |
| 剪贴板 | 不注册 OSC 52 handler → 终端输出改不了系统剪贴板；只有我们的 `Cmd+C/V` 能读写 | security.md §7.3 |
| 日志 | 不记终端内容 | 本文 |
| 路径 | `cwd` 走 §2.1 校验；`file:` URL 必须在 root 内 | security.md §5 |

## 11. 性能与内存

| 项 | 预算 |
|---|---|
| 一个终端 Host 侧 | 512 KiB（`terminalBufferBytes`）+ 数十字节状态 |
| 8 个终端 Host | ≤ 4 MiB |
| 一个终端客户端 | xterm 实例 + 2000 行 scrollback ≈ 1–2 MiB |
| 8 个终端客户端 | ≤ 16 MiB |
| 轮询请求 | 活动标签 1 个 × 120 ms ≈ 8.3 req/s；切走的标签 0 |
| 回显延迟 | ≤ 60 ms（p95 < 120 ms）：输入 → 下一拍 ≤120 ms + IPC |
| 单次 `poll` 响应 | ≤ 512 KiB（= 缓冲上限），超大响应可能触发 `dropped` |

长输出（`yes` 跑 1 分钟）：PTY 以 MB/s 产出，`for await` 全速消费 → `appendOutput` 每秒做约 20 次 512 KiB 的 `slice` 拷贝（≈10 MiB/s 拷贝，CPU 明显升高）；Host 永远只留最后 512 KiB；客户端每拍最多取 512 KiB，几乎每拍都 `dropped:true` → 提示节流为 3 s 一次；`term.write` 的背压由 xterm 内部队列吸收（丢渲染帧，不丢数据）。用户可 `Ctrl+C`（`\x03`）或关标签。观感是"跳跃式刷新"，可接受。P1 优化点：①分块队列 + 取时合并，把 O(n) 字符串拼接换成每 50 ms 合并一次；②`appendOutput` 的字符串重建节流（仍保留 `end` 单调）。

## 12. 已知限制

| # | 限制 | 影响 | 计划 |
|---|---|---|---|
| 1 | 不做流式推送，只能 120 ms 轮询 | 回显延迟下限 ≈120 ms；长输出跳跃 | P1 评估事件通道 |
| 2 | 断连后不能重放已丢弃输出 | `dropped:true` 之后内容永久丢失 | 设计如此（内存换不可重放） |
| 3 | 不做终端复用/分屏 | 一标签一 PTY，无 tmux 式 attach/detach | P2 |
| 4 | 不用官方 `ctx.webTerminals` | 必须自己管 PTY + 缓冲（官方 hold 会被 `reconcileHolds()` 释放） | 不计划（见 ARCHITECTURE） |
| 5 | 刷新后不能恢复滚动位置 | 新会话 `offset` 从 0 起，重画只有最后 512 KiB | 设计如此 |
| 6 | 重命名只在客户端 | 刷新后丢 | P1（需契约字段） |
| 7 | URL 命中是平均 cell 近似 | 极端 DPI 可能偏 1 列 | 确认弹窗兜底 |
| 8 | `\e[8m` 隐藏文本不防御 | 恶意程序可藏文字 | P2 警告条 |

## 13. 与契约的差异（已复核：6 条并入、4 条就地定案）

| # | 初版诉求 | 处置 |
|---|---|---|
| 1 | sandbox 的 `dropped` 是数值 | **契约坚持 boolean**；丢弃字符数只进 Host 调试日志，不上 wire（客户端只需要"要不要重置游标"这一个事实） |
| 2 | `poll` 要 `exited`/`exitCode`/`title` | 契约本就如此；Host 由内部态映射（`state==='closed'` → `exited`），sandbox 的 `state` 字符串不泄露到 wire |
| 3 | 未知 id 应 `E_TERMINAL_GONE` | 契约本就如此，实现里必须抛（不许返回空数据装正常），客户端据此移除标签 |
| 4 | `write` 无单次上限 | **已并入契约 v2**：`data.length ≤ 65536`，超限 `E_TOO_LARGE`，客户端分段发 |
| 5 | resize 外壳不支持改尺寸 | 契约 v2 写明「静默成功」，不新增字段；UI 首次提示一次即止 |
| 6 | 无 `terminal.rename` | **契约定为 P1**；本期标签改名走客户端呈现态 |
| 7 | `create` 的信任确认 | 契约 v2 明确 Host 一票否决、UI 确认后**用同一参数重试**（不引入可伪造凭据） |
| 8 | Host 剥离 OSC 0/2 | **已并入契约 v2**（Host 责任，客户端不做标题嗅探） |
| 9 | shell 不存在 | **契约 v2 写明** `E_UNSUPPORTED` + `detail.reason:'shell-unavailable'` |
| 10 | `list` 无缓冲游标 | 不加字段：刷新后对每个 id 先 `poll(offset:0)`，据 `dropped` 判断旧内容是否被截断 |

**安全约束（不随契约变）**：不注册 link provider（`@xterm/addon-web-links` 实现的正是 OSC 8，与 `docs/security.md` §7.3 冲突）；URL 走「修饰键 + cell 命中 + 二次确认」。
