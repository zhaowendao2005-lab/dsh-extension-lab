# dsh-antigravity-acp

通过本机官方 `agy acp` 复用当前 Antigravity CLI 登录，在 DSH 中使用订阅模型。DSH 负责上下文、工具、MCP、skill、审批与界面；目标是从模型可见声明中移除 Antigravity 的原生工具和默认指导。

**这是 0.1 系列开发预览，已有 Host adapter、隔离 runtime、正式 MCP 桥和离线验证。真实生成因工具纯净性尚未核验而阻断。** 包通过 Git 市场分发，不代表已满足“只保留 DSH 工具”的最终要求；完整进度、限制与验证边界见[实现状态](docs/STATUS.md)。

CLI 子进程默认使用当前操作系统用户的主目录复用已有登录，不继承 DSH 调试沙箱的独立 `HOME`。可在插件配置 `loginHome` 指定绝对目录；该设置只影响 CLI 子进程，独立 gemini 配置、空工作区和临时目录仍由插件管理。CLI 未认证时显示 `ACP_AUTH_REQUIRED`。

## 当前结论

- 本机 agy 1.5.9 的登录复用、ACP 生成、提示追加和 MCP 测试桥有正向实测。
- `excludeDefaultComponents: true` 加 `inheritMcp: true`、隔离 gemini 根目录中的 MCP 配置及 eager 工具，取得了“模型报告的原生工具减少，测试桥仍能调用”的行为证据。
- 尚未证明“与直连 Google Cloud 等价”。仍有模型报告的 `manage_task`、`list_resources`、`read_resource`，其真实能力边界和完整上游声明未核验。**这三项残留未解决前，不满足用户对工具纯净性的完整要求。**
- 目前记录来自 macOS arm64、agy 1.5.9、DSH 0.2.2-rc.3；不等于其他版本或平台兼容。

## 文档导航

| 文档 | 用途 |
|---|---|
| [实现状态](docs/STATUS.md) | 已实现能力、生成门禁、构建与当前验证边界 |
| [整体设计](docs/DESIGN.md) | 产品边界、进程隔离、模块划分、会话和工具循环 |
| [上下文、MCP 与 skill 接入](docs/CONTEXT-MCP-SKILLS.md) | 三个通道的映射与一致性约束 |
| [研究结论与勘误](docs/RESEARCH.md) | 证据分级、成功与失败路径、历史结论修正 |
| [官方 SDK 与 CLI ACP 边界](docs/SDK-CLI-BOUNDARY.md) | 模型上下文过滤、manage_task 来源与尚未连通的 CLI 配置入口 |
| [测试计划](docs/TEST-PLAN.md) | 离线、协议、隔离在线、DSH 集成和发布门槛 |
| [实施路线](docs/IMPLEMENTATION-PLAN.md) | 从文档到可安装插件的阶段交付 |
| [参考资料与 DSH Skill 路径](docs/REFERENCES.md) | 官方文档、参照仓库、本机文档定位 |
| [历史调查归档](docs/archive/README.md) | 前期设计、三轮报告、外部测试报告及旧直连背景 |
| [脱敏证据目录](docs/evidence/README.md) | 用例结果、来源清单与证据缺口 |

## 固定范围

1. 使用用户本机已安装的官方 CLI，不下载、修改或替换程序。
2. 由官方进程自行使用当前登录；插件不做 OAuth，不读写或复制账号凭据，不自动登录、登出或切号。
3. 使用插件拥有的独立配置与空代理工作区；真实项目的读写仅通过 DSH 工具。
4. 工具必须来自当前 DSH 会话实际可见工具集；DSH 已连接的 MCP 也走同一桥，不再启动另一套服务器。
5. 对原生工具的要求是“从模型可见工具中去除”。仅拒绝原生执行的方案不是产品达标方案。
6. 不实现直连 `v1internal`、客户端身份伪装、自动轮换、隐藏重试或直连回退。

## 阅读优先级

当前设计与决策以本文及 `docs/` 下当前主文档为准。历史存档用于追溯，不能直接当成当前配置规范；冲突解释见[研究结论与勘误](docs/RESEARCH.md)。

包名为 `dsh-antigravity-acp`，provider ID 为 `antigravity-acp`；旧研究中的 `dsh-agy-acp` 只是早期暂名。

本包内 `pnpm build` 生成 `lib/`；`pnpm probe` 仅报告离线状态；离线测试命令及已验证范围见[实现状态](docs/STATUS.md)。生成门禁尚未通过，当前版本用于开发和模型目录诊断，不能作为可用的生成模型提供方。
