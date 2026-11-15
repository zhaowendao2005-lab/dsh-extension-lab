# dsh-extension-lab

私有 DSH（DeepSeek Harness）扩展源码仓库与发布目录。包通过 Git 仓库子目录安装，构建产物需随源码提交。

## 仓库内容

| 包 | 作用 |
| --- | --- |
| `packages/dsh-ui-enhancements` | DSH 界面样式增强 |
| `packages/dsh-plugin-dev-sandbox` | 会话绑定插件的独立 DSH 调试工作区（不是 OS 安全沙箱） |
| `packages/dsh-btw-side` | 旁路提问（BTW）：基于最新真实请求上下文独立作答，输入框上方常驻栏，不打断主线 |
| `packages/dsh-workspace-ide` | DSH 右栏工作台：文件树 / 标签页 / 拖动分栏 / SCM 与提交图谱 / 编辑器 / 真终端 |
| `packages/model-intelligence-test` | 模型智能测试：真实模型指纹（lm-detector 共享参考库）与自定义 Agent 任务评测（模拟） |
| `packages/dsh-antigravity-acp` | 官方本机 agy ACP 适配器开发预览；支持登录复用和模型目录，生成仍受纯净性门禁阻断 |

## 开发约定

- 环境：Node.js `>=22.19.0`，pnpm `12.15.0`。
- 代码修改后运行 `pnpm build` 确认编译；不默认运行测试。
- `lib/` 是构建产物，必须提交，禁止手改。
- `marketplace.json` 的条目必须符合 Format 1 Schema（必须包含 `metadata` 和 `versions` 列表）。`spec` 一律用浮动的 monorepo 形式 `github:zhaowendao2005-lab/dsh-extension-lab#path:/packages/<目录名>`。
- Host 入口使用 `export function apply(ctx, config)`；Client 入口使用 DSH ModuleLoader。新增 Host 源文件时，build 必须一并复制到 `lib/`。
- 接入宿主 API 前先确认签名；资源注册使用生命周期清理，错误不得静默吞掉。

## 测试纪律（最高优先级）

1. 是否测试、测什么、怎么测、允许多久，全部由用户决定。用户未批准时不运行测试。
2. 需要测试时，先提交不超过三行的计划：验证风险、测试方法、预计耗时；等待用户审查批准后执行。
3. 编写测试用例、冒烟、截图、对比度/选择器检查、Playwright 或 DSH 集成回归，同样必须先报计划并获批。
4. 默认交付为代码实现符合需求且构建成功。不得为汇报长时间调查或搭测试脚手架。
5. 获批测试只汇报结论与关键错误。

## 发布（按包）

```bash
pnpm release --package dsh-ui-enhancements --dry-run
pnpm release --package dsh-ui-enhancements
pnpm release --package dsh-ui-enhancements --version 2.0.0
```

预检只读；正式命令只构建目标包，默认递增补丁版本。第一提交仅包含 `packages/<包>/`，第二提交仅包含 `marketplace.json`；随后创建 `<包名>-v<版本>` 包级 Tag，并推送 `main` 与 Tag。其他目录的未提交内容保留。正式发布前须确认目标包内所有改动都属于本次发布。

首次登记新包时，在包内准备 `marketplace-entry.json`，只包含本地化的 `title`、`description` 和 `metadata`（`keywords` / `labels` / `sortKeys`）。预检和正式命令均显式追加 `--init-marketplace`；包名来自 manifest，首个版本由正式命令在包提交后写入市场。没有该选项时缺少市场条目仍然失败，已有条目则拒绝该选项。开发版本无法自动递增，首次稳定版本须同时传入 `--version`。

```bash
pnpm release --package dsh-antigravity-acp --version 0.1.0 --init-marketplace --dry-run
pnpm release --package dsh-antigravity-acp --version 0.1.0 --init-marketplace --yes
```

提交信息默认交互询问（需要真实 TTY）。管道、CI 或代理环境改用显式参数，避免拿到 EOF 后才发现：

```bash
pnpm release --package <包> --message "feat(<包>): ..." --market-message "chore(marketplace): publish <包>@<版本>"
pnpm release --package <包> --yes   # 使用默认信息
```

`--message` 与 `--market-message` 必须成对给出；两者都缺、又没有 `--yes` 和 TTY 时，CLI 在构建之前就报错并列出这些选项。

失败处理：包提交之前失败会自动还原 `packages/<包>/package.json`（以及已改写的 `marketplace.json`）并取消暂存，不留下任何提交、Tag 或推送；包提交之后失败不复位该提交，只还原未提交的 `marketplace.json` 并说明需要人工补完的步骤。

CLI 不执行测试；遵循仓库测试纪律，测试须先经用户批准。
