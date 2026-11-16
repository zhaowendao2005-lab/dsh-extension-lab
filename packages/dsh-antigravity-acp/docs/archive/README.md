# 历史调查归档

本目录将旧插件的调查、ACP 设计演进、三轮本机测试，以及用户提供的首轮报告集中保存。**历史结论不是当前规范**；优先阅读[研究勘误](../RESEARCH.md)与[整体设计](../DESIGN.md)。

原件保留在原路径，本目录是加了存档说明的副本。含账号邮箱的背景文件已隐去邮箱；来源与哈希见[来源清单](../evidence/SOURCES.json)。旧报告中的相对源码链接、临时目录与行号未必仍有效，不作为当前执行入口。

## ACP 研究与测试

| 存档 | 历史位置和当前解释 |
|---|---|
| [初期架构研究](acp/ACP-REARCHITECTURE-RESEARCH.md) | 英文原始设计，保留完整 agy agent 的方向已被用户否决；新文档统一中文 |
| [早期中文计划](acp/DSH-AGY-ACP-PLAN.md) | 上下文/MCP/skill 初稿；enabledTools 与零风险断言已修正 |
| [用户提供的可行性报告](acp/AGY-ACP-FEASIBILITY-REPORT.md) | 读取成功和桥调用的初期证据；B05 缺禁用参数，不能单独否决架构 |
| [本机第一轮隔离测试](acp/AGY-ACP-ISOLATED-TOOL-TEST-2026-11-15.md) | 补测 enabledTools、strict 与自定义 agent |
| [第二轮门控研究](acp/AGY-ACP-GATING-RESEARCH.md) | strict/eager 正向闭环；仅门控路线不满足当前用户要求 |
| [第三轮纯净外壳报告](acp/AGY-ACP-CLEAN-SHELL.md) | 找到 excludeDefaultComponents 候选组合；“目标达成/等价直连/所有工具消失”超出证据 |

第三轮成功候选实际含 `tools: null`，而报告示例省略字段；原报告称 13 个 prompt，现存只留 8 个用例摘要。当前不据此重构权威总调用数。

## 旧直连背景

这些文件解释为何转向本机 ACP，不是新插件的实现路线。里面的 UA、OAuth、私有 API、号池和直连发布步骤不适用于本项目。

| 存档 | 用途 |
|---|---|
| [插件生态调研](direct-background/ANTIGRAVITY-PLUGIN-SURVEY.md) | 作者自述与当时生态路线；风险、统计和推荐未做新一轮核验 |
| [直连实现分析](direct-background/ANTIGRAVITY-PLUGIN-ANALYSIS.md) | 旧接口、缓存计量和生命周期背景 |
| [请求差异调查](direct-background/ANTIGRAVITY-REQUEST-DIFF.md) | 小型 raw adapter 抓包，不能代表完整 DSH 请求；有后续澄清 |
| [机器差异摘要](direct-background/REPORT-DIFF.md) | 历史结构数据，不含原始捕获 |
| [直连修复计划](direct-background/ANTIGRAVITY-DIRECT-REMEDIATION-PLAN.md) | 已被当前 ACP 目标取代，仍可追溯假设和方法边界 |

## 没有迁入的内容

- 含凭据或正文的原始 MITM、JSONL、官方日志和用户账号文件。
- 参照仓库的实现源码、依赖树或下载的官方二进制。
- 旧插件运行数据与 profile 配置。

探针只保留两份非执行文本快照，用于检查配置构造错误；它们不能作为已审核测试工具直接运行。
