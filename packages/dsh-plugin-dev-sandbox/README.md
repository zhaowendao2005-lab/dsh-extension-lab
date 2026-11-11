# dsh-plugin-dev-sandbox

按 DSH 会话绑定插件目录，为该会话提供独立 DSH 实例、真实 PTY 终端与调试工作区。绑定保存在工作区 `.dsh/plugin-dev/<sessionId>/binding.json`。

## 面板

右侧「插件沙箱」页签，白色 VS Code 风格，两个折叠区：

- **调试**：插件运行（启动/停止独立 DSH）、构建/测试/检查三组 package script，点击即真实执行并回显有界日志。
- **提供商与模型**：按 provider → model 展开勾选。选择写入 `.dsh/plugin-dev/<sessionId>/models.json`；启动沙箱时把选中 provider 的 profile（模型与参数）写入 overlay patch，并把对应凭据复制到沙箱 `$DSH_HOME/.credentials.yaml`（权限 0600，停止沙箱即删除）。

右侧是真实 PTY 终端：`+` 在插件目录新建终端，输入直接写入 stdin，`×` 关闭会 `terminate()` 并等待进程组静默。终端输出来自 Host 有界日志（按 `terminalId` 归属），不是前端伪造状态。

## 能力与边界

- Host 从当前会话 `session.header.cwd` 取得工作区路径；绑定目录必须在工作区内，入口必须解析到包内真实文件。
- 每会话使用独立 `.dsh/plugin-dev/<sessionId>/runtime` 作为 `DSH_HOME`，并隔离 HOME/XDG 目录、清理父进程敏感环境变量。此为 profile/进程隔离，不是 OS 安全沙箱；本地插件仍以当前用户权限运行。
- Remote 动作：`status` / `bind` / `launch` / `run` / `stop` / `unbind` / `terminalCreate` / `terminalWrite` / `terminalClose` / `models` / `saveModels`；模型工具 `plugin_dev` 与面板走同一 dispatcher。除 `status`、`models` 外的动作都要 danger-full-access 审批。
- 凭据只写进沙箱自己的 `.credentials.yaml`，值不经过浏览器、不进入 Remote 结果；`headers` 等可能含密钥的字段不复制。
- 官方终端属于当前会话，不会继承 sandbox `DSH_HOME`，因此沙箱命令请在面板内置终端里执行。

## 构建

在仓库根目录运行 `pnpm --dir packages/dsh-plugin-dev-sandbox run build`，生成的 `lib/` 需提交，不要手改。

## 验收规则

默认只要求实现符合需求并构建成功。测试、用例编写、冒烟、截图、浏览器回归或集成验证，都必须先向用户提交测试范围、方法与预计耗时并获批准后再执行。
