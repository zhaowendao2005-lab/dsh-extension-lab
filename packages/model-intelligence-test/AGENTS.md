# 模型智能程度测试：插件内架构规则

仅适用于本目录，不提升为 Extension Lab 规则。

- React + TypeScript + Zustand vanilla + Tailwind。浏览器 React 只从 DSH ModuleLoader 传入，禁止打包第二份 React。
- `frontend/views` 按语义 DOM 层级组织页面；订阅 store、调用 actions，不进行 IO。禁止 useState/useReducer，ref 仅用于 DOM/焦点。
- `frontend/components` 是小型受控复用组件，不依赖特定页面，不保存业务状态。
- `frontend/stores/<domain>.stores.ts` 是各域唯一状态与动作入口；IO 只经同域 `.datasource.ts` 路由。
- `.datasource.ts` 仅选择真实前端 service、Host transport 或 `.mock.ts`，不承载页面业务状态。
- `frontend/service` 封装浏览器持久化、模型目录 transport 等前端基础能力；`backend/service` 封装 Host 能力。禁止浏览器导入 backend；两端只能共享无环境依赖的 `shared` wire 契约。
- 主入口持有唯一全局 store；记录/请求、槽位映射与恢复租约由 Host 持久化，tab 只引用记录 ID。再次请求固定原模型，运行中排队。关闭 tab 不删除记录、不停止任务；删除/取消通过显式动作。
- 业务事实在 evaluations 域；布局、展开、列宽、筛选等展示状态不复制事实。每行订阅稳定的 run 对象；真实指纹事实来自 Host，客户端仅投影。
- 所有资源生命周期属于 plugin apply/dispose；取消真实任务要中止 Host 请求，延迟返回不得复活删除/销毁的记录。轮询断连不可伪装成 Host 任务失败。
- 模型列表只读真实配置，无 Mock 回退。指纹使用官方 lmfpd-sdk 生成挑战与分析，通过 Host llm.stream 采样，不把凭据传给浏览器，不自行重写检测算法。
- 指纹概率仅指参考库内的闭集校准概率，不是身份鉴定、真实性能或质量排名；无校准时只显示原始排序分数。自定义任务是真实 Host Agent 会话；Mock 不能作为正式实现或数据回退，未知用量、账单和成果必须保持未知/缺失，不得伪造为 0 或成功。
- 指纹并发仍按既有语义：同一模型的 3 条挑战同时发出；自定义任务并发单位是模型会话，由 Host 全局上限与任务并发共同限制，a6api 会话另受已选测试令牌数限制。两类任务共享 Host 全局请求池与 a6api 令牌身份锁。调整并发必须非抢占；指纹失败样本重试只重发失败项并保留已完成样本，自定义模型重试创建新 attempt/run 并保留旧账单。
- a6api 的指纹与自定义测试可从油猴网页或「按 Key 查看」的渠道选择进入现有草稿；自定义测试也可从 a6api 指纹结果创建。普通创建页不提供渠道查询、密钥输入或 JSON 导入。网页的测试令牌选择按站点 origin + a6api 账号 ID 存入 localStorage，只存 ID/name。网页只是发令器：一次 POST 到 `/mit-a6/select`（口令鉴权），不回传、不轮询、不持有 cookie。固定/取 key/解除固定全部由 Host 用账户访问令牌直连站点完成。
- 槽位就是用户勾选的测试令牌（数量以用户选择为准），不核验 key、不修改 DSH 提供商配置。每令牌一 worker、跨作业共享身份锁。指纹测试在固定读回 `route_effective` 后用该令牌的 key 经 `backend/a6/transport.js` 同时采样三题；自定义 a6 会话由独立 Agent stream 发出实际请求。两者均须等待全部请求/流清理和固定恢复后才领取下一项；固定未生效必须零采样请求；专项与普通任务共用全局请求池；取消不得提前复用令牌，恢复失败必须可见。
- pin 关闭智能兜底；新的日常固定不创建恢复租约，历史租约保留兼容恢复；任务侧固定由 worker 自行解除，外部修改不覆盖。`dsh://open` 只唤起安装版（不解析任何 path/query/hash）；选择数据走 Host intake，常驻 Client 用 `sidebarRight.openTab` 导航，不能编造原生插件路径或宣称能切 Host/profile。
- 油猴脚本的 `@updateURL`/`@downloadURL` 必须指向固定的网络地址（仓库内该文件的 raw 链接），不得使用本机回环端口：DSH 每次重启都会换端口，写死端口会让已安装脚本的自动更新永久失效。本机安装路由只用于「应用正在运行时」的一次性安装。
- 用户预设只在当前浏览器持久化；读取验证，失败可见。运行保存 prompt/footer/preset 快照，指纹另保存共享挑战和参考库版本。
- 自定义任务由 Host 为每个模型创建独立 DSH Agent 会话与 UUID 沙箱目录；只挂载该 run 的受限文件工具，无 shell、网络、浏览器、外部 workspace、凭据或其它 run 访问。这是工具能力隔离，不是操作系统容器；不得声称可抵御有权限访问 Host 进程/文件系统的恶意插件。不得启动成果服务；预览仅在无 same-origin 权限、带 CSP 的 iframe 中执行。输出格式由沙箱白名单控制；只有「龙猫测试」预设强制 HTML，预设本身只是提示词快照。真实推理仅由用户显式启动，构建与静态检查不得调用模型。
- 自定义运行详情是 Panel content 级独立子页（`navigation.runId` → `CustomRunPage`），不嵌在记录视图里。Chat 只读镜像照搬 DSH ui-chat 呈现层（reasoning 每 block 一行、默认折叠、turn usage），不自创样式；模块顶层禁止 JSX 与 `React.memo/forwardRef/createContext`（React 在 ModuleLoader factory 才注入）。
- 失败必须保留可诊断信息：Host 持久化脱敏后的 message/stack/cause/上游 HTTP 状态与响应体（`backend/custom/errors.js`），界面折叠展示。失败/取消/中断的 run 可「补发 continue」：`agents.resume` 同一会话与沙箱后发送 `continue`；「重试」才是新轮次新沙箱。
- a6api 自定义的接口格式只用 DSH 原生协议 id（openai-completions / openai-responses / anthropic-messages / google-generative-ai），草稿可批量或逐渠道设置；指纹仍走旧 chat/messages 三题传输。「在 VS Code 打开」必须走 Host `sessionController.workspacePathApplications/openWorkspacePath`，找不到 VS Code 时如实告知并在访达中显示，不得假装成功。
- CSS 限定 `.mit-workbench`，Tailwind 禁用 preflight，继承 Host 字体及主题令牌。
- `pnpm build` 包含 TypeScript 编译诊断和静态依赖约束；lib 为生成产物，禁止手改。
- 遵守上层 README：未经用户批准，不编写/运行测试、不浏览器验证、不截图。不要默认安装插件。
