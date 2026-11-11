# dsh-plugin-dev-sandbox

按 DSH 会话绑定插件目录，为该会话提供独立 DSH 实例和调试命令。绑定文件位于工作区 `.dsh/plugin-dev/<sessionId>/binding.json`，只保存规范化后的插件目录；不同会话可绑定不同插件。

## 入口与操作

绑定会话的对话页标题区显示「插件沙箱」入口，右侧面板提供状态、启动/停止、插件 `package.json` 中脚本的运行、日志查看和解除绑定。未绑定的会话不显示入口。模型工具 `plugin_dev` 与面板共用同一组 Host 操作；工具动作限定为当前 Agent 会话，浏览器 Remote 仅允许 DSH owner 调用。

`bind` 接受相对当前工作区的插件目录。目录必须位于原始工作区内、包含有效 `package.json` 和包入口；脚本通过精确 `commandId` 选择，不把脚本内容当 shell 命令拼接。`status` 只返回当前会话绑定、可运行脚本、运行状态和有界日志。

## 运行隔离与安全边界

- 每会话使用独立 `.dsh/plugin-dev/<sessionId>/runtime` 作为 `DSH_HOME`，并隔离 HOME/XDG 目录；真实 DSH 命令使用 `dsh web --patch <overlay> --host 127.0.0.1 --port 0 --no-open`。
- Host 从当前会话的 `session.header.cwd` 取得工作区权威路径，不信任 Remote 提供的 workspace。会话 ID 校验、目录 containment、符号链接/硬链接检查、进程组回收和有界输出均在 Host 执行。
- 独立 `DSH_HOME` 是 profile/进程隔离，**不是 OS 安全沙箱**。本地插件模块和 npm 脚本仍以当前用户权限运行。模型 `plugin_dev` 工具对变更操作使用 DSH escalation/approval；右侧面板的控制由 DSH owner 显式点击触发，不经过模型审批流。不要对不可信代码使用本功能。
- 面板的「官方终端」打开的是当前会话终端，并不会自动继承沙箱 `DSH_HOME`。沙箱 DSH 通过独立 loopback URL 访问。

## API 与结构

包通过 `ctx.typert.register(hostContribution)` 注册显式 Typert 描述符；客户端通过 `ctx.remote.$mount(remoteInfo)` 挂载同一描述符。两个容易踩的契约点：`$mount` 不会把方法挂到 `ctx.remote` 上，而是安装名为 `remote.<namespace>` 的 Cordis 服务（这里必须 `ctx.inject(['remote.pluginDev'], …)` 后取 `ctx.get('remote.pluginDev')`）；Gateway 的 invocation 只能从 scoped `this.ctx.invocation` 读取，`this.invocation` 恒为 undefined。Host 实现为 Cordis `Service`，owner 检查对缺少 invocation 的情况 fail closed；抛出的 `RemoteError` 必须带第三个 `details` 参数（`{}` 也可），否则连接层解析 `server-response` 失败，客户端只能看到 `invalid server-response failure`。客户端入口用 ModuleLoader 和官方 `conversation.session.header.utilities`、`sidebar.right.pane.tab`、`sidebarRightTabs` API，不使用全局左侧栏。

- `src/host.js`：纯 Node 会话目录、绑定、真实 DSH/脚本进程生命周期
- `src/index.js`：Host `apply`、会话解析、Cordis Service、模型工具和 Remote
- `src/remote.js`：共享严格 Zod 请求与 Typert 描述符
- `src/client-state.js`：按会话维护的可观察状态
- `src/client.template.js`：浏览器 ModuleLoader、会话入口与调试面板
- `lib/`：由 `pnpm build` 生成并提交，不手工编辑

## 开发与验证

在仓库根目录运行 `pnpm --dir packages/dsh-plugin-dev-sandbox run build` 和 `pnpm --dir packages/dsh-plugin-dev-sandbox test`。Host 核心测试使用临时工作区和注入进程规格；当前包真实 DSH 集成 smoke 使用 `DSH_SANDBOX_PLUGIN_SMOKE=1` 显式启用，且会启动独立 loopback DSH 实例，结束时停止进程并解除临时绑定。不要把通用 fixture smoke 当作本包 Remote/Host 集成验收。

在真实 GUI 中验证会话入口和交互需要安装/加载构建产物，并在有绑定插件的会话中测试。

已完成的真实端到端回归（临时独立预览实例 + Playwright 操作页面，非 mock）：boot 无 entry 失败、绑定会话出现「插件沙箱」入口、未绑定/移除绑定后入口消失、右侧面板读取绑定与脚本列表、启动沙箱得到独立 DSH URL 并确认 `runtime/stdout` 日志、运行 `build` 脚本得到 `Process exited: 0`、停止后状态回到「已停止」且子进程退出、`官方终端` 打开当前会话终端 tab。回归脚本未提交（放在 `.dsh/`，已被忽略）。

仍未验收：模型工具 `plugin_dev` 的真实调用路径（预览实例无可用模型凭据，未跑通 LLM 轮次）；`官方终端` 的环境不等同沙箱 `DSH_HOME`；插件代码仍以当前用户权限运行，profile 隔离不等于 OS 安全沙箱。
