# dsh-extension-lab

私有 DSH（DeepSeek Harness）扩展源码仓库与发布目录。包通过 Git 仓库子目录安装，构建产物需随源码提交。

## 仓库内容

| 包 | 作用 |
| --- | --- |
| `packages/extension-lab-manager` | 扩展市场管理器 |
| `packages/dsh-ui-enhancements` | DSH 界面样式增强 |
| `packages/dsh-plugin-dev-sandbox` | 会话绑定插件的独立 DSH 调试工作区（不是 OS 安全沙箱） |
| `packages/dsh-btw-side` | 旁路提问（BTW）：基于最新真实请求上下文独立作答，输入框上方常驻栏，不打断主线 |

## 开发约定

- 环境：Node.js `>=22.19.0`，pnpm `12.15.0`。
- 代码修改后运行 `pnpm build` 确认编译；不默认运行测试。
- `lib/` 是构建产物，必须提交，禁止手改。
- `marketplace.json` 的包名、目录、版本和 tag spec 必须匹配；生产 spec 不得包含本机路径或 `link:`。
- Host 入口使用 `export function apply(ctx, config)`；Client 入口使用 DSH ModuleLoader。新增 Host 源文件时，build 必须一并复制到 `lib/`。
- 接入宿主 API 前先确认签名；资源注册使用生命周期清理，错误不得静默吞掉。

## 测试纪律（最高优先级）

1. 是否测试、测什么、怎么测、允许多久，全部由用户决定。用户未批准时不运行测试。
2. 需要测试时，先提交不超过三行的计划：验证风险、测试方法、预计耗时；等待用户审查批准后执行。
3. 编写测试用例、冒烟、截图、对比度/选择器检查、Playwright 或 DSH 集成回归，同样必须先报计划并获批。
4. 默认交付为代码实现符合需求且构建成功。不得为汇报长时间调查或搭测试脚手架。
5. 获批测试只汇报结论与关键错误。

## 发布（只打标签并推送）

1. 按需更新包版本及 `marketplace.json` 的版本、tag `ref` 和 `spec`。
2. 提交变更并创建 `version-<数字...>` tag。
3. 推送 `main` 和 tag；不执行额外测试/校验，不创建 GitHub Release。
