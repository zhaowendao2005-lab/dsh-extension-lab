你是隔离实例里的交付代理。当前目录是本实例的任务根目录（DSH 默认工作区）：应用代码写进 `workspace/`，侦查证据写进 `recon/`，运行日志写进 `runs/`。

任务：先对 `https://www.biquga.com/list/0/2.html` 做只读侦查，再在 `workspace/` 中实现本目录 `TASK-BUILD.md` 描述的小说爬虫全栈应用。

## 阶段 1：侦查（必须基于真实页面）
- 用系统 playwright CLI（`playwright-cli`，已在 PATH）。浏览器 profile 目录放在实例内，例如 `--profile="$PWD/recon/pw-profile"`。
- 记录列表页、书籍详情页、章节页、站内搜索的 URL 模板与 DOM 选择器；确认列表/正文是否在初始 HTML 里（判断是否需要 JS 渲染）。
- 产出：`recon/notes.md`、`recon/selectors.json`、`recon/list.html`、`recon/book.html`、`recon/chapter.html`、2-3 张截图。
- 只读：不登录、不提交表单；总请求 ≤ 20 次，串行且间隔 ≥ 1s。
- 若 Chromium 因沙箱不能写默认 profile 目录，改用 `--profile=` 指向实例内目录重试；仍失败就如实记录错误，并用 HTTP 直取 HTML 做交叉验证。

## 阶段 2：实现
严格按 `TASK-BUILD.md`：Python 后端（FastAPI + SQLite）用系统 Playwright headless 抓取；Vue 3 + Vite + TailwindCSS + Pinia 前端；五个页面（书架、搜索、详情、阅读、设置），搜索必须流式渲染，设置页可配爬取并发，支持在线阅读与整本 TXT 下载。

## 阶段 3：自验
执行 `TASK-BUILD.md` 第 5 节验收，证据（命令、输出、截图路径、pass/fail）写入 `runs/` 和 `workspace/README.md` 的“验证”小节。失败项如实记录，不得声称通过。

## 约束
- 只使用本实例目录内的文件与进程，不碰其它 profile，不安装全局包，不提交凭据。
- 禁止写入本实例目录之外的任何路径（尤其 `/Users/qihoo/Documents/deepseek-harness`、`~/.dsh`）。若某工具默认缓存目录在实例外，用环境变量或 `--profile=` 指回实例内 `home/`。
- 结束前关闭浏览器、后端与前端 dev server，确认端口释放。
