---
name: dsh-doc
description: Use when a task needs facts about DeepSeek Harness (DSH) itself, such as how a feature, setting, plugin, agent preset, tool, or Cordis API of the running installation works; when the user asks to design, review, build, install, enable, or debug a DSH plugin, bundle, MCP connection, agent preset, plugin icon or detail page, or a DSH tool definition or skill; and when upgrading a plugin or profile to a newer DSH release. Loading it grants no permission to change files or the profile.
---


## 本机快照（Antigravity CLI 适配）

你在 Antigravity CLI 里运行，读不了 `app.asar`：`cat`、`grep`、`ls`、`find` 对它一律失效。
所以本 Agent 的事实来源是本目录下的快照，不是 DSH 安装目录。

- 已安装 DSH 版本：`0.2.2-rc.3`（导出时间 `2026-11-15T08:33:00.596Z`）
- 文档镜像：`/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/dsh-docs`
- 包参考（每个 `@deepseek-ai/*` 包的 README）：`/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/packages`
- 出处与刷新方式：`/Volumes/Lenovo/dsh-extension-lab/.agents/skills/dsh-doc/VERSION.md`

按下面的顺序查：

1. 先读本目录的 `references/`（插件开发、组合包、UI、MCP、验证等专题）。
2. 再按需读 `dsh-docs/`：`user/`（用户指南）、`subsystems/`（子系统契约）、`upgrade-guide/`（版本迁移）、`tool-catalog.md`、`config-catalog.md`、`persistence-catalog.md`。
3. 要找具体包的行为，读 `packages/<包名>.zh.md`；`README.zh.md` 缺失时读 `packages/<包名>.md`。
4. 快照里没有的（活进程、活的 Config 默认值、当前挂载的插件），说明“需要在 DSH 会话里用 cordis_inspect 查”，不要凭空补。

写文件、装包这些动作仍然照 SKILL.md 正文的授权规则办：查资料不授权改动，改动要用户明确要求。

# DeepSeek Harness documentation

Answer questions about DSH from the documentation and source of the installed version, not from memory, and extend DSH through bundles installed in the current profile.

Loading this skill does not authorize changes. Write bundle files, run mutating `plugin_manager` actions such as installing, enabling, disabling, or removing, or change a preset only when the user asks to change DSH or its profile. For a question, design, or review, read-only lookups, including `list_plugins` and `list_bundles` within your tool permissions, remain available; report findings and leave files and the profile unchanged. A request for an image, widget, or decoration that does not target DSH, such as its Web UI or profile, is not a request for a DSH plugin; deliver the ordinary artifact the task asks for.

## Find facts in this order

1. Runtime inspection, when `cordis_inspect_list` and `cordis_inspect_query` are among your tools: exact Service methods and Event modes, a mounted plugin's Config schema and `packageDir`, the Tools this Agent can call, and live Client Slots and theme tokens.
2. The installed documentation and package sources, located as `references/locate-docs.md` describes.
3. When an answer depends on a live API that you can neither inspect nor read, state what remains unverified. Do not change a preset or the profile to gain tools.

## Read next

The files below live in this skill's base directory, which the `skill` tool reported, and the table is the complete list: do not enumerate that directory. Read them with the file-read tool, write copies into the workspace with the file-write tool, and verify a copy by reading it back. In Desktop the directory sits inside `app.asar`, which the file-read tool and the runtime that `references/locate-docs.md` describes can open; native utilities such as `ls`, `cat`, `cp`, and `cmp`, the glob and search tools, a `node` from `PATH`, and pnpm fail on it. Never install or syntax-check a template in place; copy its contents into the workspace first.

| Task | File |
|---|---|
| Find the installed version's documentation and package sources | `references/locate-docs.md` |
| Build, install, enable, or debug a plugin or bundle | `references/plugin-development.md` |
| Bundle manifest, locale resources, detail document, icons, installation, Host exports and Config | `references/host-plugin.md` |
| Bundle descriptions, optional single-image details, locale paths and preview verification | `references/plugin-details.md` |
| Save plugin configuration or credentials | `references/configuration.md` |
| Web UI: Client manifest, module loader, slot registration | `references/ui-plugin.md` |
| Connect an MCP server through a configuration-only bundle | `references/mcp-bundle.md` |
| Choose extension points, contexts, and state mechanisms | `references/practices.md` |
| Share application operations between UI actions and agent tools | `references/user-actions.md` |
| Verify a page or panel, review its user experience, or work without browser control | `references/verification.md` |
| Draw icons and feature images | `references/artwork.md` |
| Create, change, or migrate an agent preset; choose Host or preset placement | `references/compositions.md` |
| Upgrade a plugin or profile to a newer DSH release | `references/upgrading.md` |
| Loader patch dialect | `references/composition-reference.md` |
| Installable plugin packages, one table per package group | `references/packages.md` |
| Write a DSH tool definition, skill, or multi-step workflow | `references/tool-design.md` |
| UI plugin template | `templates/decoration/package.json`, `templates/decoration/cordis.patch.yml`, `templates/decoration/index.js`, `templates/decoration/client.js`, `templates/decoration/locale`, `templates/decoration/docs/DETAIL.md`, `templates/decoration/docs/preview.svg`, `templates/decoration/icon.svg` |
| MCP bundle template | `templates/mcp/package.json`, `templates/mcp/cordis.patch.yml`, `templates/mcp/locale`, `templates/mcp/docs/DETAIL.md`, `templates/mcp/docs/preview.svg`, `templates/mcp/icon.svg` |
