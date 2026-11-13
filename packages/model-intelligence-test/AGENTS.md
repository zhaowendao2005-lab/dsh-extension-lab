# 模型智能程度测试：插件内架构规则

仅适用于本目录，不提升为 Extension Lab 规则。

- React + TypeScript + Zustand vanilla + Tailwind。浏览器 React 只从 DSH ModuleLoader 传入，禁止打包第二份 React。
- `frontend/views` 按语义 DOM 层级组织页面；订阅 store、调用 actions，不进行 IO。禁止 useState/useReducer，ref 仅用于 DOM/焦点。
- `frontend/components` 是小型受控复用组件，不依赖特定页面，不保存业务状态。
- `frontend/stores/<domain>.stores.ts` 是各域唯一状态与动作入口；IO 只经同域 `.datasource.ts` 路由。
- `.datasource.ts` 仅选择真实前端 service、Host transport 或 `.mock.ts`，不承载页面业务状态。
- `frontend/service` 封装浏览器持久化、模型目录 transport 等前端基础能力；`backend/service` 封装 Host 能力。禁止浏览器导入 backend；两端只能共享无环境依赖的 `shared` wire 契约。
- 主入口持有唯一全局 store；记录/请求/分区由 Host 持久化，tab 只引用记录 ID。再次请求固定原模型，运行中排队。关闭 tab 不删除记录、不停止任务；删除/取消通过显式动作。
- 业务事实在 evaluations 域；布局、展开、列宽、筛选等展示状态不复制事实。每行订阅稳定的 run 对象；真实指纹事实来自 Host，客户端仅投影。
- 所有资源生命周期属于 plugin apply/dispose；取消真实任务要中止 Host 请求，延迟返回不得复活删除/销毁的记录。轮询断连不可伪装成 Host 任务失败。
- 模型列表只读真实配置，无 Mock 回退。指纹使用官方 lmfpd-sdk 生成挑战与分析，通过 Host llm.stream 采样，不把凭据传给浏览器，不自行重写检测算法。
- 指纹概率仅指参考库内的闭集校准概率，不是身份鉴定、真实性能或质量排名；无校准时只显示原始排序分数。自定义任务尚为 Mock，所有相关指标与成果须显式标识。
- 并发槽位与单请求时长是 Host 运行参数：同一模型的 3 条挑战始终同时发出，槽位/全局请求池上限只在 Host 定义，客户端只读快照并发送增量配置。调整必须非抢占（降低并发或时长不得打断已开始的请求），失败样本重试只能按模型重发失败项并保留已完成样本。
- 中转站数据必须经 Host 代理与快照缓存；浏览器不得直连第三方、不得持有第三方密钥。API Key/访问令牌只进 DSH credentials，Remote 只回配置状态；登录态接口仅在用户配置令牌后由 Host 调用。插件写入的 pi-ai 提供商只用固定 route，必须可一键清理。快照行身份是 `listing_id + channel_id + supplier_id` 的复合键，分页并发可能重复，加载时去重且 React key/详情都用复合键。快照失败显示固定错误，不回退 Mock。
- 用户预设只在当前浏览器持久化；读取验证，失败可见。运行保存 prompt/footer/preset 快照，指纹另保存共享挑战和参考库版本。
- 不启动成果服务、不创建自定义 Agent 沙箱。真实模型推理仅用于已授权的指纹采样。绘图成果限定 Canvas + HTML 或 SVG；内置 Mock 成果预览在无同源权限 iframe 中。
- CSS 限定 `.mit-workbench`，Tailwind 禁用 preflight，继承 Host 字体及主题令牌。
- `pnpm build` 包含 TypeScript 编译诊断和静态依赖约束；lib 为生成产物，禁止手改。
- 遵守上层 README：未经用户批准，不编写/运行测试、不浏览器验证、不截图。不要默认安装插件。
