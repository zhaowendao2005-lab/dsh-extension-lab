# 文件工作台 E2E 验收流程

> 用法：在真实 DSH 里打开「文件工作台」面板，按编号顺序点一遍。每条流程末尾「通过判据」全勾才算过。
> 定位约定：role + 可见文字（不用坐标、不用 DOM 快照）。根节点 `[data-wid-root]`，编辑器 `[data-wid-editor]`，终端 `[data-wid-terminal]`。
> 环境：macOS 14+（`--dsh-frame-top-clearance` 生效）、git ≥ 2.11、DSH 当前仓库版本。动作名以 `docs/remote-contract.md` 为准；缺的记到 `plan/全方案.md` §十一。

## 0. 准备

```bash
export WID=/tmp/wid-e2e && rm -rf "$WID" && mkdir -p "$WID"
G="git -c user.email=e2e@local -c user.name=e2e"

git init -q -b main "$WID/repo" && cd "$WID/repo"          # 主仓库
printf 'export const a = 1\n' > a.ts
printf '# 标题\n\n正文\n' > README.md
mkdir -p src && printf 'x\ny\n' > src/one.txt
$G add -A && $G commit -qm init && git branch feature/x

git init -q -b main "$WID/repo2" && cd "$WID/repo2"        # 未信任仓库（流程 9）
printf 'v1\n' > t.txt && $G add -A && $G commit -qm init

mkdir -p "$WID/plain" && printf 'hello\n' > "$WID/plain/n.txt"   # 非仓库（流程 10）
git init -q -b main "$WID/big" && cd "$WID/big"            # 30 MB（流程 11）
yes 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | head -c 30000000 > big.txt
$G add -A && $G commit -qm big
git init -q -b main "$WID/many" && cd "$WID/many"          # 3000 文件（流程 11）
for d in $(seq 1 60); do mkdir -p "d$d"; for f in $(seq 1 50); do printf 'x\n' > "d$d/f$f.txt"; done; done
$G add -A && $G commit -qm many
```

准备工作：①新建会话，工作目录设为 `$WID/repo`（面板解析根的来源）；②若面板已有历史根，先在空态点「忘记当前目录」（未实现则改用 `$WID/repo2` 走"选择目录"分支）；③新目录 trust 为 `unknown`（等同未信任）。

---

## 1. 首次打开面板（M0 / M1）

前置：会话 cwd = `$WID/repo`，面板从未打开。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 点侧栏「文件工作台」图标 | 主面板出现；顶部留出 macOS 红绿灯带（48 px） |
| 2 | 观察首帧 | 壳 + 骨架屏 ≤400 ms 可交互；无白屏闪烁；树随后填入 |
| 3 | 看状态栏与树 | 分支 `main`、变更 `0`、`UTF-8`；根显示 `repo`，`src/` 可展开，目录在前 |
| 4 | 切三个视图再切回 | 三视图都渲染；切回资源管理器后展开态保持（不重拉） |
| 5 | 看 SCM 四组 | Staged / Changes / Untracked / Conflicts 标题齐全且计数为 0 |

失败分支：`root:null` → 空态卡片 +「选择目录」（`ctx.uiWorkspace.pickDirectory()` → `workspace.open`）；`E_NOT_DIR` → 卡片内红字，不退出空态。
**通过判据**
- [ ] 400 ms 内可交互（录屏帧）
- [ ] 树 / 状态栏 / SCM 三处变更数一致
- [ ] 控制台无报错，`git.status` 间隔 ≈1.5 s（不是 0.2 s 连发）
涉及动作：`workspace.resolve`、`workspace.open`、`workspace.state`、`files.list`、`git.status`、`git.graph`、`git.refs`。

## 2. 打开文件并编辑保存（M1）

前置：流程 1 通过。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 点 `a.ts` | 标签高亮；状态栏 `Ln 1, Col 1` / `TypeScript` / `UTF-8` / `LF`；≤120 ms 首屏 |
| 2 | 点 `README.md`，再输入 `// x` | 两标签并存；`a.ts` 标签出现脏点 + 状态栏 `●`；树里不另标脏 |
| 3 | `Cmd+S` | 脏点消失；状态栏「已保存 hh:mm:ss」；1.5 s 内 `a.ts` 进 Changes（`M`） |
| 4 | `Cmd+Z` 后保存 | 文件回原内容；Changes 里消失 |
| 5 | 改 `README.md` 后点标签 × | 弹「未保存修改」保存/不保存/取消；取消则标签保留 |

失败分支：`E_TOO_LARGE` → 标签位信息卡（字节数 + 阈值）；`E_BINARY` → 「二进制，N 字节」；`E_TRUST_REQUIRED` → 只读横幅 + 保存 disabled + tooltip。
**通过判据**
- [ ] dirty 只在标签 + 状态栏表达
- [ ] 连续两次保存不触发冲突（版本已更新）
- [ ] 关闭未保存标签一定拦一次
涉及动作：`files.stat`、`files.read`、`files.write`、`git.status`。

## 3. 外部修改冲突（M1）

前置：`a.ts` 已打开且 clean；终端可用。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 终端执行 `echo '// ext' >> $WID/repo/a.ts` | 编辑器不自动重载（不打断输入） |
| 2 | 编辑器改成 `export const a = 2`，`Cmd+S` | 冲突对话框：两个版本号 + 重新加载 / 另存为 / 强制覆盖 |
| 3 | 选「重新加载」 | 内容变为磁盘版（含 `// ext`）；dirty 清空 |
| 4 | 重做 1–2，选「强制覆盖」 | 保存成功、`// ext` 被覆盖；对话框写明「无法撤销」 |
| 5 | 重做 1–2，选「另存为」 | 同目录生成备份文件并出现在树里；原文件不改 |

失败分支：覆盖时 `E_TRUST_REQUIRED` → 对话框关闭 + 错误条；另存越界 → `E_OUTSIDE_ROOT`，输入框标红。
**通过判据**
- [ ] 三个分支都用 `cat` 核对过磁盘
- [ ] 不静默覆盖、不丢用户输入
- [ ] 对话框中能看到两个版本号
涉及动作：`files.write`（`expectedVersion` → `E_VERSION_CONFLICT`）、`files.read`、`files.create`。

## 4. 暂存单文件并提交（M2）

前置：`$WID/repo` 干净。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 终端 `printf 'y\n' >> src/one.txt`，等 2 s | Changes 出现 `M src/one.txt`；状态栏变更 `1` |
| 2 | 悬停点 `+` | 行移到 Staged；两组计数各自正确，总数仍 1 |
| 3 | 提交框只输入空格再删掉 | Commit disabled（不是点了才报错） |
| 4 | 输入 `feat: e2e 提交` + `Cmd+Enter` | Staged 清空、变更数 0、输入框清空；图谱顶行出现该提交 |
| 5 | 点 `−` 再点 `+` | 文件在两组间往返，不重复不丢失 |

失败分支：pre-commit hook 拒绝 → 错误条显示过滤后 stderr 前 8 行，**暂存区不变**、输入保留；空暂存区 → disabled；GPG 失败 → 错误条含 `gpg` 行。
**通过判据**
- [ ] `git log -1 --format=%s` 与界面一致
- [ ] MM 文件同时出现在两组（没去重）
- [ ] 失败时无任何"假成功"
涉及动作：`git.status`、`git.stage`、`git.unstage`、`git.commitCreate`、`git.graph`。

## 5. 丢弃工作区修改（M2）

前置：`src/one.txt` 已提交且编辑器打开。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 终端 `printf 'lost\n' > src/one.txt`，等刷新 | Changes 出现 `M` |
| 2 | 点 `↺` | 二次确认：文件清单 +「此操作不可撤销」 |
| 3 | 点「取消」 | 零副作用，磁盘仍是 `lost` |
| 4 | 再点 `↺` → 确认 | 回滚成 `y`；Changes 清空；标签显「磁盘已变」徽章 |
| 5 | 标签「重新加载」 | 内容为 `y`，dirty 清空 |
| 6 | 对未跟踪文件 Discard | 提示「将删除 N 个文件，不进回收站」；确认后从树里消失 |

失败分支：unborn 分支 → 走 `rm --cached` + 删除，确认文案需说明；`E_TRUST_REQUIRED` → 按钮 disabled。
**通过判据**
- [ ] 取消分支零副作用
- [ ] 丢弃后 `git status` 干净、`git diff` 为空
- [ ] 不因 discard 丢编辑器里未保存的编辑
涉及动作：`git.discard`、`git.status`、`files.stat`、`files.read`。

## 6. 切分支（M2 / M3）

前置：`main` 与 `feature/x`；`feature/x` 上 `a.ts` 内容不同。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 改 `README.md` 不提交 | Changes 出现 `README.md` |
| 2 | 状态栏分支名 → 选 `feature/x` | 先弹「工作区有 1 项变更」：取消 / 先暂存（P1）/ 仍要切换 |
| 3 | 点「仍要切换」 | `E_GIT_FAILED`，错误条含 "would be overwritten"；分支仍 `main` |
| 4 | 提交或暂存后再切 | 成功；状态栏变 `feature/x`；树/SCM/图谱/标签 2 s 内全部更新 |
| 5 | 打开 `a.ts` 标签 | 「磁盘已变」徽章 → 重新加载得到新分支内容 |
| 6 | 切回 `main`，看终端 | 终端内容不变、未重启；`git branch --show-current` 为 `main` |
| 7 | 快速连点两个分支 | 最终与最后一次选择一致，不出现分支名与内容错配 |

失败分支：有未跟踪冲突文件 → `E_GIT_FAILED` + 建议先 stash；目标分支不存在 → 菜单不出现。
**通过判据**
- [ ] 脏状态**不**被自动 stash
- [ ] 切换后整代刷新（不只刷 status）
- [ ] 在途旧响应不会覆盖新分支数据
涉及动作：`git.checkout`、`git.refs`、`git.status`、`git.graph`、`files.list`、`workspace.state`。

## 7. 提交图谱（M3）

前置：≥3 个提交、2 个分支。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 切「提交图谱」 | ≤250 ms 出首屏；行高 28 px；左 SVG 车道、右提交信息与 refs 徽章 |
| 2 | 切暗色主题 | 车道颜色随 token 变（非写死色值） |
| 3 | 滚到底触发分页 | 追加下一页、不闪、不重排已看行 |
| 4 | 点提交 → 点文件列表里的 `a.ts` | 详情（hash/作者/父提交/body/文件统计）→ 单文件 diff（与 SCM 同一组件） |
| 5 | 过滤框输入 subject 片段 | 列表即时过滤，车道布局不变（`layoutMs` 不涨） |
| 6 | 有未提交变更时看顶行 | 「Changes」虚拟节点；点开是四组合并视图 |

失败分支：`E_NOT_A_REPO`/`E_GIT_MISSING` → 信息卡 + 重试；病态拓扑布局超时 → 该页退化为"仅列表无线"并提示一次；分页失败 → 保留已加载行 + 底部重试。
**通过判据**
- [ ] 5 万 commit 仓库首屏仍 ≤250 ms
- [ ] 过滤不触发重新布局
- [ ] 无硬编码颜色（构建期扫描通过）
- [ ] 详情 → diff 可 `Esc` 逐级返回
涉及动作：`git.graph`、`git.log`、`git.commit`、`git.diff`、`git.refs`。

## 8. 终端（M0 / M4）

前置：面板已打开。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 点「+」 | 新标签（`$SHELL` 名）；提示符 ≤300 ms；cwd = 仓库根 |
| 2 | 跑 `git status`、`echo 中文 ✅` | 输出正确、无乱码；回显 p95 ≤60 ms |
| 3 | 拖动上边缘 | 高度跟手、松手持久化、不盖住编辑器 |
| 4 | 切图谱再切回、点面板外再点回 | 内容/光标保留；`echo $$` 两次相同（PTY 未重启） |
| 5 | 建第二个终端跑 `sleep 3` | 两标签输出不串台 |
| 6 | 关第一个标签，后 `ps -p <pid>` | 进程 2 s 内消失 |
| 7 | 终端里 `exit` | 标签保留 +「已退出（code 0）」；输入禁用；仍可关闭 |

失败分支：未信任目录 → 二次确认（契约缺口见 §十一 第 3 条）；spawn 失败 → 标签内红色错误行 + 重试；`dropped:true` → 顶部灰条「输出超过 512 KB，已丢弃早期内容」。
**通过判据**
- [ ] 关标签杀得掉进程（无孤儿 PTY）
- [ ] 切视图/切面板不重启不清屏
- [ ] `vim`/`less`/`top` 渲染正常
涉及动作：`terminal.create`、`terminal.write`、`terminal.resize`、`terminal.poll`、`terminal.close`、`terminal.list`。

## 9. 未信任目录（M2）

前置：`$WID/repo2` 在本实例从未打开（trust `unknown`）。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 打开 `$WID/repo2` | 顶部黄条「只读模式：目录尚未信任」+ 状态栏盾牌 |
| 2 | 改 `t.txt` 后 `Cmd+S` | `E_TRUST_REQUIRED`；dirty 保留；保存 disabled + tooltip |
| 3 | 看 SCM | `git.status` 可跑（只读）；Stage/Commit/Discard/切分支全 disabled |
| 4 | 点「信任此目录」→ 确认风险 | 黄条消失；盾牌实心；再保存成功并出现在 Changes |
| 5 | 未信任态起终端 | 弹二次确认（或按缺口 3 直接禁用并说明） |

失败分支：trust 写入失败 → 黄条保留 + 错误条（不得假装信任）。
**通过判据**
- [ ] 未信任时 Host 拒绝**所有**写路径（不只 UI 灰）
- [ ] 只读下 `git.status` 仍可用
- [ ] 信任状态刷新页面后仍有效
- [ ] 未信任时不自动轮询
涉及动作：`workspace.open`、`workspace.trust`、`workspace.state`、`files.write`、`git.stage`、`terminal.create`。

## 10. git 缺失 / 非仓库（降级）

前置：`$WID/plain`；另需一台无 git 环境做 10b。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 打开 `$WID/plain` | 文件树与编辑器可用；SCM/图谱显示「不是 git 仓库」信息卡 |
| 2 | 看信息卡按钮 | 「初始化仓库」disabled + tooltip（未实现，见 §十一 第 1 条）；**不自动 git init** |
| 3 | 看状态栏 | 分支位显示 `—`，不伪造 `main` |
| 4 | 新建/编辑/保存 | 全部可用（文件功能不依赖 git） |
| 5 | 10b：无 git 环境打开 `$WID/repo` | `E_GIT_MISSING`；状态栏「git: 未找到」；文件功能不受影响；不重试风暴 |

失败分支：git <2.11 → 启动探测降级或提示版本过低并禁用 git 视图；dubious ownership → `E_GIT_FAILED` + 可读提示，不写全局 `safe.directory`。
**通过判据**
- [ ] 无 git 不拖垮文件功能
- [ ] 非仓库不显示任何伪造 git 数据
- [ ] 10 s 内只尝试一次（无重试风暴）
涉及动作：`workspace.state`、`git.status`、`files.*`。

## 11. 超大文件与超大仓库（M1 / M2）

前置：`$WID/big`（30 MB）、`$WID/many`（3000 文件）。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 点 `big.txt` | ≤1 s 出信息卡：`E_TOO_LARGE`，30 MB / 阈值 20 MB，带「分页只读」 |
| 2 | 点「分页只读」 | 首屏 2000 行可翻页；只读；高亮关闭 |
| 3 | 在 `$WID/many` 展开根与 `d1` | 60 目录秒出；`d1` 显示 50 文件；不递归预读 |
| 4 | 看 status 耗时 | 3000 文件干净态 ≤150 ms |
| 5 | 造 12000 未跟踪：`for i in $(seq 1 12000); do : > u$i.txt; done` | `isHuge:true`；状态栏「变更 >1 万，已停自动刷新」；列表截断显示 |
| 6 | 点手动刷新 | 能刷一次；isHuge 提示保留 |

失败分支：目录超 5000 项 → `truncated` +「仅显示前 5000 项」；读超 16 MB → `E_TOO_LARGE`；status 超 8 s → `E_TIMEOUT` 退回手动刷新。
**通过判据**
- [ ] 30 MB 不进编辑器（不建 EditorState）
- [ ] 降级后仍有行号与可读排版
- [ ] 截断/分页都显式提示
涉及动作：`files.stat`、`files.read`、`files.list`、`git.status`。

## 12. 关闭再打开 / 浏览器刷新（M1 / M4）

前置：2 个标签（一个 dirty）、1 个终端在跑 `ping 127.0.0.1`。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 切到对话视图 | 面板消失；终端进程仍在（Host 未 kill） |
| 2 | 等 5 s 再切回 | 标签/滚动/展开态/终端高度恢复；dirty 点仍在 |
| 3 | 看终端 | 5 s 输出补齐（`poll(offset)`），无断行乱码 |
| 4 | 浏览器 `Cmd+R` | 页面重建；`terminal.list` 对账后标签回来 |
| 5 | 刷新后看编辑器 | 标签恢复、内容从磁盘重读；未保存编辑按 `docs/ui-spec.md` 的约定处理（提示或草稿） |

失败分支：`terminal.list` 为空但本地有标签 → 标灰「已结束」，不伪造输出；`workspace.state` 根不一致 → 整代作废重拉。
**通过判据**
- [ ] 卸载不杀 PTY
- [ ] 重开不重放动作、不重读全部文件
- [ ] 离线输出能补上或明确提示截断
- [ ] 刷新后无幽灵标签/幽灵终端
涉及动作：`workspace.state`、`terminal.list`、`terminal.poll`、`git.status`、`files.stat`。

## 13. Remote 断连与恢复（M1 / 可选）

前置：面板已加载数据。

| 步骤 | 操作 | 期望 |
| --- | --- | --- |
| 1 | 插件管理里禁用再启用 | 顶部红条「连接已断开」；写动作 disabled；内容保留为只读 |
| 2 | 断连期间点保存 | 不显示成功；错误条说明连接断开 |
| 3 | 重新启用后重开面板 | 红条消失；自动 `workspace.state` 对齐；不一致缓存整代作废 |
| 4 | 重连后看终端 | 恢复或标「已结束」，不出现半截输出 |

**通过判据**
- [ ] 断连可感知（红条），不是默默失败
- [ ] 重连后无需手动刷新即对齐
- [ ] 断连不产生孤儿 PTY / git 子进程
涉及动作：`workspace.state`、`terminal.list`、`git.status`。

---

## 清理

```bash
rm -rf /tmp/wid-e2e
```

信任记录在 `storageDomain: workspace_ide/trust`（不进仓库）；复测流程 9 前需清掉 `$WID/repo2` 的记录。

## 已知问题（走查发现，尚未修复）

1. 契约无 `git.init`，「初始化仓库」只能 disabled（§十一 第 1 条）。
2. 契约无 `repoEpoch`，流程 6/13 的整代作废只能靠 `branch.sha` 间接判断（§十一 第 4 条）。
3. 未跟踪文件 diff 语义未定，流程 4/7 点未跟踪文件可能得到空 diff（§十一 第 2 条）。
4. 浏览器刷新后未保存编辑的处置（草稿 vs 丢失提示）未定，流程 12 步骤 5 暂按"提示"验收。
