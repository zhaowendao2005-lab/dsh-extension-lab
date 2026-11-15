# a6api 令牌 · 固定商家 · 官方调用口径（bundle 逆向结果）

> 来源：`/tmp/a6.js`（a6api.vip 生产 bundle，7,313,652 字节，676 行，第 657 行为单行 minified 主体）。
> 结论均带代码证据；凡未能从 bundle 证实的，标注「未证实」。
> 用途：指导「3–5 个测试 key 作为并发槽 + token 固定商家钉渠道」的新测试流程实现。

## 1. 结论摘要

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 固定商家是否按 token 维度 | **是**，三元组 `(token_id, model_name) → channel_id` | `POST /api/marketplace/pin` 请求体见 §2 |
| 固定会不会影响官方调用路由 | **会**：固定渠道始终优先调度，即使超出限价也会被调用 | `tipPinnedDesc` 文案 |
| 是否存在 `sk-<key>-<channel_id>` 后缀约定 | **存在**，且这是「广场自助测试」专用隐藏凭证 | `Gc()` 拼接 `Bearer sk-${key}-${channel_id}` |
| 自助测试是否支持 Anthropic messages | **不支持**，只有 chat/responses/embeddings/rerank/images | `OF()` 的 switch 无 `/v1/messages` 分支 |
| 官方调用与自助测试的差别 | 官方 = `Bearer sk-<key>` 走正常路由；自助测试 = `Bearer sk-<key>-<channel_id>` 强制钉渠道并被平台按账号/渠道限流 | §5 |
| 平台 5 次/分钟限额是否写死在前端 | **未证实**（前端只做 60 秒退避，限额应由服务端判定） | §6 |

## 2. 固定商家 / 指定渠道接口

### 2.1 写入（固定）

```js
await ae("/api/marketplace/pin",{method:"POST",body:{
  token_id:Number(K), model_name:ee, channel_id:pr(de), fallback_to_smart_routing:ta
}}),await le()
```

- 方法：`POST`，同源相对路径（见 §4 的 `ae` 封装要求）
- 请求体字段：
  - `token_id`：数字，目标令牌 ID
  - `model_name`：字符串，模型名（如 `deepseek-v4.1-flash-1017`）
  - `channel_id`：数字，由 `pr(de)` 归一化得到（`pr` 取 `de.channel_id ?? de.pin_channel_id ?? de`）
  - `fallback_to_smart_routing`：布尔。默认取既有固定记录的 `fallback_to_smart_routing !== false`，否则 `true`
- 前置校验：`if(!K||!ee||!(pr(de)>0)) throw tokenRoute.invalidPinSelection`（"请选择有效的 Token、模型和渠道"）
- 固定信息未加载完成时抛 `pins_loading`（"固定信息加载中，请稍后重试"）
- 写入后 `await le()` 重新拉取 pins 列表（不是本地乐观更新）

### 2.2 解除固定

```js
await ae("/api/marketplace/unpin",{method:"POST",body:{
  token_id:Number(K), model_name:ee, channel_id:ta
}})
```

- `channel_id` 优先取显式传入，否则取既有固定记录的 channel id；找不到记录抛 `tokenRoute.pinUnavailable`（"未找到当前固定渠道，请刷新"）
- 成功后同样 `await le()` 刷新

### 2.3 读取

```js
const[de,ue,ze,ta,te]=await Promise.all([
  ae("/api/status",{anonymous:!0}), ae("/api/user/self"), ae("/api/user/models"),
  tN(ae), ae("/api/marketplace/pins")
])
…
X.current={unit:Oe,group:…,models:zl(ze)}
const ot=ba.map(V=>vy(V,{unit:Oe,models:zl(ze),subs:Ra,serverPins:Ya}))
```

- `GET /api/marketplace/pins` 与 `/api/status`（匿名）、`/api/user/self`、`/api/user/models`、订阅列表一起拉
- 返回值按 `zl(...)` 取数组，作为 `serverPins` 并入令牌行
- 每条 pin 记录的已证实字段：`token_id`、`model_name`、`channel_id`、`fallback_to_smart_routing`、`deleted`
- 匹配函数：`Nf(list, tokenId, modelName)` / `ve(K,ee)` 均按 `token_id` + `model_name` 且 `!deleted` 匹配
- 其余字段（供应商名、渠道名等）仅在前端通过 `pinnedTarget` 文案拼装，字段名「未证实」

### 2.4 语义（bundle 内中文文案原文）

- `pinnedChannelTip`：已固定商家与渠道（{name}）
- `specifiedChannel`：指定渠道
- `pinDisabledTip`：未开启固定
- `tipPinnedTitle`：固定
- `tipPinnedDesc`：**把指定模型锁定到某一家商家与渠道：固定渠道始终优先调度，即使超出限价也会被调用。固定与禁用互斥 —— 禁用已固定的渠道会自动解除固定。**
- `pinnedTooltip`：固定通道：指定商家 ID 与渠道 ID
- `pinnedTarget`：商家名称: {supplier} · 渠道名称: {channel}
- `pinnedFallback`：固定商家兜底
- `fallbackPinnedTitle`：智能池兜底
- `fallbackPinnedDesc`：固定渠道故障时，降级使用智能池
- `pinnedFallbackTooltip`：固定的商家不能用了，去用限价里面的商家/渠道
- `unpinModelConfirm`：取消 {model} 在当前 Token 下的固定模型。
- `pinSeparate`：固定渠道变更会立即生效，与底部保存分开处理
- `pinNotice`：你有 {count} 条固定路由指向这个商家。拉黑后它们会立刻失效，请求改走智能路由；之后在黑名单里恢复，这些固定路由会自动回来。
- `closeRoutePinned`：这个模型固定的商家不受影响，请求仍会先发给它。

> 结论：固定是**令牌级的模型→渠道锁定**，不是市场页展示态；它直接决定该令牌这个模型的请求落到哪家渠道，并带兜底策略。

### 2.5 与「加入路由 / 订阅」的关系（另一套机制，别混淆）

bundle 里另有一套 `/api/subscriptions`：

```js
{method:"POST", path:"/api/subscriptions", body:{
  token_id:Number(t), model_name:n, channels:[{channel_id:r}], caps:{...Bq}, sort_strategy:"price_asc"
}}
{method:"PATCH",  path:`/api/subscriptions/${a.id}/channels`, body:{channel_id:r}}
{method:"DELETE", path:`/api/subscriptions/${a.id}/channels/${r}`}
```

- `Bq = {input_price_micros:0, output_price_micros:0, cache_read_price_micros:0, cache_write_price_micros:0, per_request_price_micros:0}`（限价 caps）
- 这是市场页「加入路由」用的**手动路由池**（可含多个渠道 + 限价），与 `pin` 的「钉死单一渠道」不是一回事
- 对「必须测某个具体渠道」的场景，`pin` 才是正确工具；`subscriptions` 会在池内按价格排序，可能落到别的渠道

## 3. 令牌接口

| 用途 | 调用 | 说明 |
| --- | --- | --- |
| 列表 | `GET /api/token/` + `?p=&size=` | 分页（页面用 size=100） |
| 搜索 | `GET /api/token/search` + query | 字段名「未证实」 |
| 详情 | `GET /api/token/{id}` | — |
| 查看密钥 | `POST /api/token/{id}/key`，body `{}` → `{key}` | **实测会挂起不返回**，见 §7 |
| 新建 | `POST /api/token/` body `be(...)` | 字段清单「未证实」 |
| 修改 | `PUT /api/token/` body `{id, ...be(...)}` | — |
| 启停 | `PUT /api/token/?status_only=true` body `{id, status}` | `status=1` 启用 / `2` 禁用 |
| 删除单个 | `DELETE /api/token/{id}/` | — |
| 批量删除 | `POST /api/token/batch` body `{ids:[...]}` → 返回删除条数 | `return Number(ee)||0` |
| 路由 | `GET /api/token/{id}/routes` | 与固定/路由相关，形状「未证实」 |

已证实的令牌行字段（经 `vy()` 投影后）：`id`、`key`（前端清空，仅保留 `maskedKey`）、`status`（经 `qh` 映射为 active 等）、`usedUSD`、`quotaUSD`、`unlimited_quota`、以及是否被 pin（`serverPins` 里按 `token_id + model_name` 合并）。
完整原始字段（`name`/`quota`/`model_limits`/`group`/`expired_time`/`allow_ips` 等）**未证实**，需查 `be(...)` 归一化函数。

## 4. 请求封装 `ae()`（所有 `/api/*` 都走它）

```js
async function ae(e,{method="GET",body,query,signal,headers={},responseType="json",
  anonymous=!1,preserveSessionOnAuthError=!1,…})
```

- URL：`new URL(e, window.location.origin)`，必须同源且 pathname 匹配 `/^\/(api|pg)\//`
- 凭据：`credentials: r.Authorization ? "omit" : "same-origin"`（有显式 Authorization 时**不带 cookie**）
- 请求头：`Accept`；有 body 且非 FormData 时 `Content-Type: application/json`；非匿名且无显式 Authorization 时加 `New-Api-User: String(userId)`
- 401：清会话并跳 `#/login`（`#/reset-confirm` 除外）
- 429：message `"Too many requests"`，并挂 `R.retryAfter = response.headers.get("Retry-After")`
- 兼容老接口语义：`message==="success"` / `message==="error"`

**实现含义**：pin/unpin 必须由**持有 a6api 登录态的一方**发同源请求（油猴脚本天然满足；Host 侧则需要 cookie + `New-Api-User`）。

## 5. 官方调用 vs 广场自助测试

### 5.1 自助测试的调用构造函数（`vu`）

```js
function vu(e,a,t={}){const n=String(a||"").trim();if(!n)return null;
  const o=t?.mode===li?li:An, r=t?.kind||mt;
  if(r===dn)return HF(e,n,o===An);
  if(r!==mt)return null;
  const l=OF(e,n,o); return l?{...l,headers:{}}:null}
```

- `e` = `test_endpoint`（`chat` / `responses` / `embeddings` / `rerank` / `images` / `unsupported`）
- `a` = `model_name`；`t.kind` = `connectivity`（`mt`）或 `pelican`（`dn`）；`t.mode` = `stream`（`An`）/ `non_stream`（`li`）
- `OF()` 的请求体：

| endpoint | path | body |
| --- | --- | --- |
| chat | `/v1/chat/completions` | `{model, messages:[{role:"user",content:"Reply with OK only."}], max_tokens:2100, stream}` |
| responses | `/v1/responses` | `{model, input:"Reply with OK only.", max_output_tokens:2100, stream}` |
| embeddings | `/v1/embeddings` | `{model, input:"ok"}` |
| rerank | `/v1/rerank` | `{model, query:"ok", documents:["ok"]}` |
| images | `/v1/images/generations` | `{model, prompt:"a red five-pointed star on a white background", n:1}` |

- `HF()`（pelican/SVG 检测）：`/v1/chat/completions` 或 `/v1/responses`，提示词 `"Generate an SVG of a pelican riding a bicycle. Reply with the SVG code only."`，`max_tokens: 16384`，并带 header `X-A6API-Self-Test-Kind: pelican`
- **没有 `/v1/messages` 分支**（bundle 内 `/v1/messages` 出现 0 次）——自助测试不覆盖 Anthropic 原生协议

### 5.2 隐藏凭证：`sk-<key>-<channel_id>`

```js
function Gc(e,a){const t=String(e||"").trim(),n=Number(a);
  return!t||!Number.isFinite(n)||n<=0?"":`Bearer sk-${t.startsWith("sk-")?t.slice(3):t}-${n}`}
```

- 自助测试统一用 `getAuthorization: async () => Gc(await fetchTokenKey(tokenId), channel_id)`
- 即「取令牌 key → 拼 `-<channel_id>` → 作为 Bearer」，用来**强制钉到指定渠道**
- 这个后缀正是触发平台「广场自助测试」限额（每账号 5 次/分钟、每渠道 20 次/分钟）的调用形态——与截图报错里的 `specific_channel_rate_limited` 一致
- 官方口径（无后缀）`Bearer sk-<key>` 走正常路由，渠道由 token 的 pin / 路由规则决定

### 5.3 基础地址

```js
function j2(){return(kp==null?void 0:kp.VITE_REACT_APP_SERVER_URL)||""}
```

- `VITE_REACT_APP_SERVER_URL` 是 bundle 里唯一的 `VITE_` 环境变量，生产为空串
- 所以自助测试请求发往**同源**：`https://a6api.vip/v1/...`
- 文档文案里另有「统一网关：单一端点 `api.a6api.vip/v1`」（`api.a6api.vip` 在 i18n 中出现 15 次）——即面向用户调用的官方地址是 `https://api.a6api.vip/v1/...`

## 6. 限流

已证实：

- 前端只做 **60 秒退避**，不做配额计算：`vK=60*1e3`，`lr(resp, lane)` 在 `status===429` 时把 `gaUntil` 或 lane 级 `until` 设为 `now+60s`，`cm(lane)` 用于跳过仍在冷却内的请求
- 另有 `yu=6e4`（默认单次测试 60 秒超时）、`Cg`（connectivity 超时）、`LA=3e5`（pelican 300 秒）
- `tokenKeyRateLimited`："操作过于频繁，请稍后再试"（针对取 key 的动作）
- `ae()` 在 429 时读取并暴露 `Retry-After`

未证实：

- 「每账号 5 次 / 每分钟」「每渠道 20 次 / 每分钟」的具体数字**没有**硬编码在前端 bundle 中，判断为服务端判定（与截图报错正文一致）。前端只在收到 429 后统一退避 60 秒。

## 7. 实测记录（浏览器，登录态 user 2744）

- 市场页点「测试」→ 弹出「测试模型连接」：Supplier ID 1664 / `deepseek-v4.1-flash-1017` / Chat Completions / 流式 / 测试类型 连通测试 / 使用令牌「杂项」/ 提示词「让模型只回复 OK」/ 提示「会真实调用一次模型，按所选令牌计费」
- 点「开始测试」后捕获到 `POST /api/token/13758/key`（headers 含 `New-Api-User: 2744`），随后弹窗长时间停在「测试中…」
- 直接在页面里 `fetch('/api/token/13758/key')` 会**挂起直到 JS 求值超时**——该接口不会轻易回传密钥明文
- **实现结论：插件不要复刻「取密钥」这条路；密钥应由用户单独创建并直接填进 DSH 凭据。**

## 8. 对新架构的直接含义

1. 每个测试 key 独立，是天然并发槽；`(token_id, model_name) → channel_id` 的 pin 让每个 key 可以各自钉到不同的目标渠道，互不干扰。
2. 一次测试的编排是：`pin(key_i, model, channel)` → 官方口径调用 `https://api.a6api.vip/v1/...`（`Bearer sk-<key_i>`，无 `-channel` 后缀）→ 测完 `unpin`，key_i 交给下一个模型。
3. pin/unpin 必须由**持登录态**的一方执行（同源 `/api/*` + `New-Api-User`），因此油猴脚本或等价会话持有者是天然执行点；Host 若要做，就需要持久化 a6api 会话 cookie（安全面更大）。
4. 走官方口径可绕开广场自助测试的 5 次/分钟账号限额（该限额绑定的是 `sk-key-channel` 自助测试形态），但仍受渠道自身限流影响——所以仍要保留 429 退避与重试。
