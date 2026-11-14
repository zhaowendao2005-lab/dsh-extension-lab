# 文件工作台：插件内架构规则

仅适用于本目录，不提升为 Extension Lab 规则。规则要么可被构建期检查判定，要么可被 review 一眼判定；含糊条目不许进来。

## 分层与依赖

- 浏览器 React 由 DSH ModuleLoader 传入（`require('react')`），**禁止打包第二份 React**。`react`/`react-dom`/`react/jsx-runtime` 一律 esbuild external。
- `frontend/views` 按语义 DOM 层级组织，只做三件事：订阅 store、派发动作、绑定 DOM/CM6/xterm 实例。**禁止 `useState`/`useReducer`**；`useRef` 只用于 DOM、焦点、编辑器与终端句柄。
- `frontend/stores/<domain>.stores.ts` 是该域唯一状态与动作入口；IO 只经同域 `.datasource.ts`。
- `.datasource.ts` 只负责选择「真实 Remote 动作」，不承载业务状态，不吞 `ok:false`。
- 跨域编排只允许一处：`stores/workbench.stores.ts`（打开文件、选中变更出 diff、切分支刷新）。
- `frontend/service` 只放无 IO 的纯函数（路径、键位、语言探测、diff 文案、语法高亮映射）。禁止浏览器导入 `backend/**`、`node:*`；两端只能共享 `shared/`（纯数据 + zod schema）。
- **禁止 require 任何 `@deepseek-ai/*` client 包**（`practices.md:35`）。需要控件就自己写，类名统一加 `wid-` 前缀。

## 状态与真相

- Host 是唯一真相。客户端只做呈现态（选中、展开、面板高度、草稿、终端标签），一切业务事实来自 Remote 响应。
- 响应带 `seq`（`git.status`）或 `version`（`files.*`）；**旧 seq 的响应必须丢弃**，不得回写。
- `views` 不持业务状态；同一事实只存一处，展示派生值用 selector 计算。
- 乐观 UI 只允许用于：标签高亮、终端标签关闭、文件树展开、输入框草稿。失败必须回滚并出错误条。
- 未实现的能力必须 `disabled` + tooltip 说明，**不许做成"点了没反应"或假成功**。

## Host 侧

- `backend/service.js` 是唯一动作分发点：严格 zod 校验 payload、解析根目录、信任门禁、并发闸门、写队列、错误映射。
- 根目录**只能**由 Host 解析：`ctx.sessionController.resolveAgent(sessionId)?.session.header.cwd` 或用户在面板里显式选择；不允许 wire 传任意绝对路径直接当根。
- 所有路径先 `path.resolve(root, rel)` 再 `realpath`，前缀比较带 `/` 边界；越界一律 `E_OUTSIDE_ROOT`。**校验在 Host，不在前端。**
- 错误不得静默：每个 `catch` 都要落到 `ErrCode` 之一；`E_GIT_FAILED` 必须带过滤后的 stderr，且脱敏。
- 生命周期：终端、git 子进程、watcher、定时器都挂 `ctx.effect` 的 disposer；插件 dispose 后不得有残留进程。

## git

- 只走系统 `git` CLI，`spawn(argv)` 不经过 shell。命令集中在 `backend/git/exec.js`，禁止在其它文件里裸调 `child_process`。
- 只读命令必须带硬化参数：`--no-optional-locks`、`-c core.fsmonitor=false`、`-c core.pager=cat`、`-c core.hooksPath=<空目录>`、`-c credential.helper=`、`-c core.askPass=`、`-c diff.external=`、`-c core.sshCommand=`，env 固定 `LC_ALL=en_US.UTF-8`、`LANGUAGE=en`、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`。**文档 `docs/security.md` 是这份清单的唯一出处。**
- 状态入口只有一个：`status --porcelain=v2 -z --branch --untracked-files=all`。不要用 `porcelain=v1`，不要解析人类可读输出。
- 路径一律 `-z`；日志解析用**多字符哨兵**（subject 里可能含 `\x1f`/`\x00`）。任何格式串改动都要同时更新 `docs/git-model.md` 与解析器的 0 坏行断言。
- 写操作进每仓库**串行队列**；写前检查工作区状态，写后不自动 stash、不自动 reset，失败要能回滚。
- 不加 `--force`、不写用户 `.git/config`、不自动 `safe.directory`、不自动 `git init`（必须用户点击确认）。
- hunk 暂存只用 `hash-object -w` + `update-index --cacheinfo` 路线，**禁止 `git apply --cached --3way`**。

## 文件

- 读按行分页（`readLinesDefault`），写必须带 `expectedVersion`；冲突返回 `E_VERSION_CONFLICT`，不静默覆盖。
- 写盘原子：同目录临时文件 + `rename`；保留原文件 mode；按原 `eol`/`bom` 还原后再写。
- 目录懒加载，不递归遍历；缓存 500 ms；不做 `.gitignore` 过滤（P0）。
- 二进制与非 UTF-8 不硬开：`E_BINARY` / 只读提示。

## 终端

- PTY 只用 `subprocess.spawnTerminal`，**不要用官方 `ctx.webTerminals`**（`reconcileHolds()` 会 release 我们的 hold）。
- 通道是 Host 环形缓冲 + **字符**游标：`poll(offset)` 返回 `{data, offset, dropped, exited}`；缓冲 512 KB；UTF-8 不能在 `Buffer` 层按字节切。
- 未信任工作区创建终端需显式确认；env 白名单，不带任何 DSH 凭据或 `DSH_*` 敏感项。
- 关闭 = `terminate()` + 等 `done` + 2 s 强杀；标签切走不 kill；插件 dispose 全 kill。
- 实现复制自 `packages/dsh-plugin-dev-sandbox`，**不改该包、不共享模块**。

## 图谱

- 布局在 Host 算（`backend/git/layout.js`，移植 `git-graph-plus`，Apache-2.0 版权头必须保留），wire 只传 `rows[].{hash,lane,color,segments}`。
- 客户端只做可视区间切片 + SVG 生成，**不重算布局**。
- 分页追加只重算尾部，保留已发前缀；过滤只影响列表不影响布局。
- 泳道配色走主题 token 索引，不传色值。

## 打包与体积

- 单文件 IIFE：**不能**拆 chunk、不能用 `new Worker`、不能加载 `.wasm` 或字体、不能依赖图片资源路由。
- 语言包**显式白名单**（IIFE 下动态 import 不省体积）。
- bundle ≤ **1.2 MB gzip**，构建期断言；超限先查是否误引入了整包。
- CSS 内联进 JS，运行时注入 `<style id="dsh-workspace-ide/css">`，卸载时移除。
- 样式只用 `--dsw-alias-*` / `--dsw-*` token；**禁止硬编码色值**（构建期扫描，`// check-ignore: color` 可豁免并注明原因）。

## 文档同步

改下列内容必须同一提交内更新对应文档，否则 review 打回：

| 改动 | 必须同步 |
| --- | --- |
| 任何 Remote 动作/字段/错误码 | `docs/remote-contract.md` + `shared/contract.js` |
| git 命令或解析 | `docs/git-model.md` |
| 编辑器扩展组合/阈值 | `docs/editor.md` |
| 图谱布局或 wire 结构 | `docs/graph.md` |
| PTY 通道或轮询 | `docs/terminal.md` |
| 布局/尺寸/token 映射/快捷键 | `docs/ui-spec.md` |
| 构建参数/依赖/体积预算 | `docs/build.md` |
| 里程碑任务状态 | `docs/milestones.md` |

## 纪律

- **不注册模型工具**、不写 session event、不读 session log、不碰会话历史。这个插件只服务人的操作。
- 不改动其它包；`marketplace.json` 只在本包发布时追加条目。
- **接入根脚本要两处都改**：根 `package.json` 的 `build` 与 `dev` 都是显式 `&&` 链（不是循环），新增本包后在两串末尾各追加一条 `pnpm --dir packages/dsh-workspace-ide run build` / `run build:dev`；漏掉 `dev` 会导致本地调试图省。根 `README.md` 的包表格同样需要加一行。
- `pnpm build` 必须包含静态检查（`scripts/check.mjs`）；`lib/` 是生成产物，禁止手改。
- 遵守上层 README 的「测试纪律（最高优先级）」：是否测试/浏览器验证/截图由用户决定，未批准不跑；默认交付 = 实现符合需求 + 构建成功。
