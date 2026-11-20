# 任务需求：笔趣阁小说爬虫全栈应用（隔离工作区首个任务）

## 0. 交付物

在 `workspace/` 内交付一个可运行的 Python 后端 + Vue 前端的单机应用：

- 后端：Python 3（建议 FastAPI + uvicorn），SQLite 持久化，爬取主体使用 **系统 Playwright 无头浏览器**（Python `playwright` 包，chromium headless）。
- 前端：Vue 3 + Vite + TailwindCSS + Pinia；左侧栏 + 右侧 content 布局。
- 一键启动脚本（`workspace/start.sh` 或等价），一条命令同时起后端与前端；README 说明环境与启动方式。

## 1. 页面与交互

1. **书架（首页，路由 `/`）**
   - 卡片/网格展示已收录小说：封面（可选占位）、书名、作者、章节数、最近更新时间、操作（阅读 / 下载 / 移除）。
   - 「添加小说」：粘贴书籍详情页 URL 或从搜索结果加入。
   - 空态引导去搜索页。
2. **搜索页（路由 `/search`）**
   - 搜索输入框 + 提交；支持回车。
   - **结果流式渲染**：边搜边出，结果逐条到达即渲染（禁止一次性 loading 全量返回）。后端提供 SSE 或 chunked NDJSON 流式接口。
   - 每条结果：书名、作者、简介摘要、详情链接；可「加入书架」。
3. **书籍详情 / 章节页（路由 `/books/:id`）**
   - 书籍信息 + 完整章节目录（虚拟滚动或分页均可），点击章节进入阅读。
   - 「在线阅读」「下载 TXT」。
4. **阅读页（路由 `/books/:id/read/:chapterId`）**
   - 左侧章节列表（当前章高亮），右侧正文；上一章/下一章；字号与行宽可调（可选）。
   - 正文按需抓取并缓存到 SQLite，重复打开不重复抓取。
5. **设置页（路由 `/settings`）**
   - 爬取并发数（1–8，滑块或数字输入）、请求间隔（ms）、重试次数；保存后立即对后续抓取生效。
   - 显示当前并发使用情况（可选）。

## 2. 爬虫要求

- 站点：`https://www.biquga.com`（列表页 `https://www.biquga.com/list/0/2.html` 用于侦查，真实选择器以 `recon/selectors.json` 为准）。
- 全部抓取经 Playwright headless chromium 完成（搜索、目录、正文）；允许并发，但受设置页并发上限与请求间隔约束。
- 编码：站点为 gb18030/GBK 时正确解码；对反爬（如 Cloudflare/JS 挑战）有可观测的失败上报，不静默重试。
- 目录与正文解析结果必须可校验：章节正文非空、字数下限、去广告行。
- 失败重试有上限，错误进入日志（后端标准输出 + `workspace/logs/`），前端可见「部分章节抓取失败」。
- 下载：整本 TXT（章节顺序、标题分隔、UTF-8），流式响应，文件名含书名。

## 3. 数据模型（SQLite）

- `books(id, url UNIQUE, title, author, cover_url, intro, created_at, updated_at)`
- `chapters(id, book_id, url UNIQUE, idx, title, content TEXT NULL, fetched_at)`
- `settings(key PRIMARY KEY, value)`：`concurrency`、`delay_ms`、`retries`

## 4. 非功能要求

- 前端构建 `pnpm build` 必须成功；后端 `python -m compileall` 通过。
- 后端启动时校验设置值范围；爬虫并发不得绕过设置。
- 不在生产环境安装任何东西；`playwright` 与浏览器使用系统已有缓存（`~/Library/Caches/ms-playwright`），如缺失再在实例内下载。
- 不提交任何凭据；`.gitignore` 覆盖 `.venv/`、`node_modules/`、`dist/`、`logs/`、`*.db`。
- 所有页面在 1280px 与 768px 宽度下可用。

## 5. 验收（必须实际执行并留证）

1. `uv venv && uv pip install`（或 venv+pip）成功，`playwright install --dry-run` 显示所需 chromium 已存在。
2. 后端启动，`GET /api/health` 200；前端 `pnpm build` 成功，开发/预览服务可访问。
3. 用 Playwright（或 playwright-cli）跑通一条完整业务线：搜索「斗破苍穹」→ 结果流式出现 → 加入书架 → 打开详情 → 打开第 1 章阅读 → 下载 TXT 且文件含至少 3 章。
4. 设置页把并发从 2 改为 4，保存后后端读到新值（`GET /api/settings` 验证），并发信号量随之变化。
5. 截图：书架、搜索结果（流式中）、阅读页、设置页各 1 张，存放在 `recon/` 或 `workspace/docs/screenshots/`。
6. 验收结果写入 `runs/` 对应 meta 与 `workspace/README.md` 的「验证」小节；失败项如实记录。

## 6. 已知事实来源

- 侦查证据：`recon/notes.md`、`recon/selectors.json`、`recon/*.html`、`recon/*.png`（由本实例上一轮侦查产生；若与真实页面不符，以真实页面为准并在 notes 中修正）。
