发布插件前必须遵循 `.agents/skills/package-release/SKILL.md`。
按包发布，先运行 `pnpm release --package <name> --dry-run` 完成只读预检。
确认预检无误后，仅执行一次正式命令：`pnpm release --package <name>`。
默认递增补丁版本；主版本或次版本升级必须显式传入 `--version X.Y.Z`。
正式命令按目标包和 `marketplace.json` 精准暂存，保留其他工作区改动。
正式命令中分别输入包代码与 marketplace 两次提交信息，再创建包级 Tag 并推送。
无 TTY 的环境（管道、CI、代理）改用 `--message` 与 `--market-message` 成对传入，或加 `--yes` 使用默认信息；两者都缺时命令在构建前即报错。
发布在包提交之前失败会自动还原 package.json 等改动且不留下提交；包提交之后失败不复位，按 CLI 提示人工补完。
