# dsh-plugin-dev-sandbox

按 DSH 会话绑定插件目录，为该会话提供独立 DSH 实例、真实 PTY 终端与调试工作区。绑定保存在工作区 `.dsh/plugin-dev/<sessionId>/binding.json`。

## 面板

右侧「插件沙箱」页签，白色 VS Code 风格，两个折叠区：

- **调试**：插件运行（启动/停止独立 DSH）、构建/测试/检查三组 package script，点击即真实执行并回显有界日志。
- **提供商与模型**：按 provider → model 展开勾选；provider 行左侧复选框可一次勾选或取消该 provider 的全部模型（部分选中显示为半选）。选择写入 `.dsh/plugin-dev/<sessionId>/models.json`；启动沙箱时把选中 provider 的 profile（模型与参数）写入 overlay patch，并把对应凭据复制到沙箱 `$DSH_HOME/.credentials.yaml`（权限 0600，停止沙箱即删除）。这些选择是沙箱配置输入；被调试插件运行时应从沙箱自己的公开 `llm` 服务读取最终可用目录。
- 启动时会校验绑定包的 Host entry，以及 `dsh.client` 声明的 Web Client export 和 inject 格式；包声明错误会显示在运行时错误中。有效 Host/Client 仍由 DSH 通过临时 overlay 在沙箱 profile 中加载，不安装或启用到宿主 profile。

右侧是真实 PTY 终端，由 xterm.js 渲染：`+` 在插件目录新建终端，光标就在终端里，键盘输入直接写入 PTY stdin（不再有底部输入行）。`×` 先在面板上立刻移除该标签并切到相邻终端，再由 Host `terminate()` 并等待进程组静默，失败（如终端已不在）会把标签和选中状态回滚并显示错误。PTY 的 SIGTERM/SIGKILL 宽限期是独立选项 `terminalGraceMs`（默认 250ms，交互式 shell 普遍忽略 SIGTERM，长宽限只会推迟本来就要发的 SIGKILL），与实例/脚本停止用的 `stopTimeoutMs` 分开。终端字节由 Host 每终端环形缓冲 + 字符游标提供（`terminalPoll` 从客户端自己的 offset 续读，落后过多时返回 `dropped`），窗口尺寸变化通过 `terminalResize` 同步到 PTY。

## 目录结构

```
backend/     Host 侧：index.js（入口/工具注册）service.js（Remote 与业务规则）
             manager.js（绑定、实例、PTY、凭据）contract.js（Typert 描述符）preset.js（模式派生）
frontend/    浏览器侧：index.js（ModuleLoader 入口）runtime.js（React 绑定）styles.js
             views/（与 DOM 树一一对应的组件）stores/（datasource 唯一数据通道 + 全局 store + mock）
             service/（纯业务函数与终端通道）
integration/ 打包契约：cordis.patch.yml（bundle patch）
```

状态规则：views 不持有本地 state，展开/选中/当前终端等都在全局 store；Host snapshot 是沙箱状态的唯一真相，所有读写都经 `stores/sandbox.datasource.js` 一次 Remote 调用。

## 模式

插件注册一个「插件开发」Agent 预设：运行时从预设注册表读取创造模式（`cordis`）当前的 `config.plugins` 原始行，再以自己的 id 注册同名组合。因此创造模式上游增删工具时，这个模式自动跟随，不需要复制官方 YAML，也不修改创造模式本身。

## 能力与边界

- Host 从当前会话 `session.header.cwd` 取得工作区路径；绑定目录必须在工作区内，入口必须解析到包内真实文件。
- 每会话使用独立 `.dsh/plugin-dev/<sessionId>/runtime` 作为 `DSH_HOME`，并隔离 HOME/XDG 目录、清理父进程敏感环境变量。此为 profile/进程隔离，不是 OS 安全沙箱；本地插件仍以当前用户权限运行。
- Remote 动作：`status` / `bind` / `launch` / `run` / `stop` / `unbind` / `terminalCreate` / `terminalWrite` / `terminalPoll` / `terminalResize` / `terminalClose` / `models` / `saveModels`；模型工具 `plugin_dev` 与面板走同一 dispatcher。除 `status`、`models` 外的动作都要 danger-full-access 审批。
- 凭据只写进沙箱自己的 `.credentials.yaml`，值不经过浏览器、不进入 Remote 结果；`headers` 等可能含密钥的字段不复制。
- 官方终端属于当前会话，不会继承 sandbox `DSH_HOME`，因此沙箱命令请在面板内置终端里执行。

## 构建

在仓库根目录运行 `pnpm --dir packages/dsh-plugin-dev-sandbox run build`，生成的 `lib/` 需提交，不要手改。

## 验收规则

默认只要求实现符合需求并构建成功。测试、用例编写、冒烟、截图、浏览器回归或集成验证，都必须先向用户提交测试范围、方法与预计耗时并获批准后再执行。
