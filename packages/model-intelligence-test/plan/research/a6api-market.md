# a6api 模型市场 · 「选渠道」数据链接口说明

> 目标：支撑「从市场里挑出某模型的所有渠道，逐个测试」。
> 本文只答三条：① `channels/search` 签名与字段 ② 取数上限与限流 ③ 测试按钮的可用性判定。
> 其余接口一句话带过。
>
> 证据来源：`/tmp/a6.js`（生产 bundle，7,313,652 B）+ 本仓库 `backend/relay/snapshot.js`（既有用法）+ 真实匿名 HTTP 实测（2026-11-15，已在下发「停止实测」指令**之前**完成，之后未再发请求）。

---

## 0. 三条结论 + 一处必须先纠正的前提

| # | 结论 |
| --- | --- |
| **0** | **⚠️ 匿名没有被拒。** `GET /api/marketplace/public/channels/search` 不带 cookie / `New-Api-User` / `Authorization` 就是 **HTTP 200**，返回真实数据（实测 `page=1&page_size=5` → 200，20,649 B，0.87 s，`total=12751`）。所以「匿名多半被拒所以实测价值不大」这个前提不成立——实测反而是这条链最可靠的证据来源 |
| 1 | **GET + query string**（不是 POST body）。参数构造器只有一处 `BN()`。每行主键 = `listing_id + channel_id + supplier_id` 复合键 |
| 2 | `page_size` 服务端钳 **500**，但 **>100 静默丢时序字段**（`b24`/`b7d`/`cache_hit_rate_24h`）→ 要高保真必须用 **100**。页码**越界不报错**，夹回末页重复返回（实测 `page=129/500/1000` 全部回显 `page:128`）→ 必须用 `total` 收敛。边缘限流 **30 请求 / 3 秒 / IP**（实测 45 并发恰好 30×200 + 15×429，两轮一致） |
| 3 | 测试按钮可见性由一个纯函数 `ZF()` 决定：**`unsupported` 或空 `test_endpoint` 直接不渲染**；可见但**未登录 / 无令牌 / 未选令牌**时置灰。另有一条独立的指纹检测门槛 `Ak()`：只允许 `chat`/`responses` |

---

## 1. `/api/marketplace/public/channels/search`：方法、参数、字段

### 1.1 签名

```
GET https://a6api.vip/api/marketplace/public/channels/search?<query>
Accept: application/json
```

| 项 | 值 | 证据 |
| --- | --- | --- |
| 方法 | `GET`，全部参数走 query string | 实测；bundle 用 `ae(url,{query:a})` 而非 `body` |
| 鉴权 | **匿名可用**；登录版 `GET /api/marketplace/channels/search` 匿名 **401** `dashboard_auth_required` | 实测 |
| `New-Api-User` | **可缺省**。该头只在「有 cookie 会话且无 `Authorization`」时才被前端补上；公开端点走匿名分支 `credentials:'omit'` | 实测（有/无该头均 200）+ bundle |
| 响应外壳 | `{data, message, success}` | 实测 |

代码证据 A —— 登录版/公开版的分流与「匿名不带凭据」（`Wi()`，bundle）：

```js
if(e==="channels/search"&&!St()) e="public/channels/search";
const n=await ae(`/api/marketplace/${e}`,{query:a,signal:t,anonymous:e.startsWith("public/")});
// ae():  ...!s&&!r.Authorization&&y!==null?{"New-Api-User":String(y)}:{}  ;  credentials: r.Authorization?"omit":"same-origin"
```

### 1.2 参数全集（拼写以 bundle `BN()` 为准，逐项实测生效性）

代码证据 B —— 唯一的查询构造器（bundle `BN()`，市场页所有请求都经它）：

```js
function BN(e={}){return{model:e.selectedModel||(a.length?a.join(","):void 0),description_keyword:e.descriptionKeyword||void 0,
 channel_id:e.channelId||void 0,supplier_id:e.supplierId||void 0,brand:e.brand||void 0,...e.modelCategory&&!e.selectedModel?{category:e.modelCategory}:{},
 channel_kinds:Qf(e.channelKinds).join(",")||void 0,page:Math.max(1,Number(e.page)||1),page_size:Math.max(1,Number(e.pageSize)||20),
 sort:e.sort||void 0,token_id:e.tokenId||void 0,favorites_only:e.favoritesOnly===!0?!0:void 0,...NE(e.rangeFilter)}}
```

**A. 定位 / 过滤**

| 参数 | 类型 | 精确说明 | 实测 |
| --- | --- | --- | --- |
| `model` | string | **精确、大小写敏感**；支持逗号分隔多模型（OR） | `hy3`→53；`hy`→0；`Claude-Sonnet-5-5`→0（大小写不同即 0） |
| `brand` | string | 品牌，如 `tencent` / `OpenAI` | `tencent`→106 |
| `supplier_id` | int | 供应商 ID | `370`→3 |
| `channel_id` | int | 渠道 ID | `1329`→3 |
| `description_keyword` | string | 渠道描述关键词（前端截 50 字） | `wb`→34 |
| `category` | enum | **文本/图片/视频过滤就是它**：`text` / `image` / `video`。**仅在无 `model` 时才发送** | `image`→717；`hot-models` 分面实测取值恰为 `text`121/`image`22/`video`21 |
| `channel_kinds` | csv | `guaranteed` / `official` / `pool` 多选 | `guaranteed`→750；`official`→52；并集→802 |
| `guaranteed_only` | bool | **fidelity（保真）过滤就是这个**，等价 `channel_kinds=guaranteed` | `true`→750 |
| `charge_type` | enum | `per_token` / `per_request` | `per_request`→847 |
| `exclude_unavailable` | bool | 默认 `true`；`false` 放回不可用渠道 | 12748 → 13732 |
| `include_seed` | bool | 默认 `true` | 当前数据无差异 |
| `token_id` | int | 登录态字段；公开分支会被前端剥掉 | 匿名传 0 无效果 |
| `favorites_only` | bool | 需登录；前端有硬校验（响应须回显 `favorites_only:true` 且 `favorite_scope==='model'`，否则抛「收藏筛选暂不可用」） | 匿名无回显 |

> **「能力特性」筛选（对话/视觉/图像/视频/128K…）没有服务端参数。** 那 15 个 `market.cap*` 只是 i18n 文案，`BN()` 里不存在对应键；服务端的「模态」纬度只有 `category`。「文本/图片/视频」请用 `category`。

**B. 分页 / 排序**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `page` | `1` | `<1` 夹到 1；**超出末页夹回末页**（见 §2.2） |
| `page_size` | 前端 `20`（插件用 `100`） | 服务端钳 `500`；**>100 丢时序字段**；非法值 → 不分页模式 |
| `sort` | `comprehensive` | 未知值静默回退 `comprehensive` |

`sort` 枚举（实测逐值验证；`recent` 是 `last_success_desc` 的别名）：

`comprehensive` · `cache_hit_desc` · `rating_desc` · `p50_asc` · `success_desc` · `output_asc` · `input_asc` · `last_success_desc`（别名 `recent`）

**C. 区间过滤**（`NE()` 展开成平铺参数，服务端归一化后回显进 `data.query.ranges`）

| 参数 | 单位 | 实测 |
| --- | --- | --- |
| `ratio_min` / `ratio_max` | 倍率（挂牌价÷官方价） | `0.5~1`→2028 |
| `ratio_basis` | `cny` / `usd` | 随 `ratio_*` 回显 |
| `success_min_bp` / `success_max_bp` | **bp（万分之一）**：9900 = 99.00% | `9900`→3718 |
| `cache_min_bp` / `cache_max_bp` | bp | — |
| `ttft_min_ms` / `ttft_max_ms` | 毫秒 | `2000`→1011 |
| `include_no_data`（前端亦用 `incl_nodata=1`） | bool | `9900&incl_nodata=1`→3706 |

代码证据 C —— 区间参数名与 bp/ms 换算（bundle `NE()` / `or`）：

```js
const h={ratio_min:a===null?void 0:a,ratio_max:t===null?void 0:t,ratio_basis:...,success_min_bp:u(n),success_max_bp:u(o),cache_min_bp:u(r),cache_max_bp:u(l),ttft_min_ms:m(s),ttft_max_ms:m(c),include_no_data:...};
// or=[{key:"ratio",limit:1e3,decimals:4},{key:"success",limit:100},{key:"cache",limit:100},{key:"ttft",limit:3600,decimals:3}]
```

### 1.3 响应结构

```json
{"success":true,"message":"","data":{
  "items":[…],"total":12751,"page":1,"page_size":5,
  "source":"memory","snapshot_generated_at":1794733565,
  "official_direct_enabled":true,"self_test_enabled":true,"pelican_test_enabled":true,
  "pelican_hover_enabled":true,"model_detection_enabled":true,"model_detection_public_enabled":true,
  "reviews_enabled":true,"column_settings_enabled":true,
  "category_filter_enabled":true,"range_filter_enabled":true,
  "query":{…归一化参数回显，区间收进 ranges…}}}
```

> `data` 顶层那 11 个 `*_enabled` 是**功能开关**（决定是否渲染自测/指纹/评价/列设置/筛选入口），不是数据。`snapshot_generated_at` 是快照版本号（前端当 `revision`），`source:"memory"` 表示读内存快照。

### 1.4 每行渠道字段清单（`items[]`）

主键：**`listing_id + channel_id + supplier_id`**（实测跨页会重复，必须三者一起当 key）。

| 字段 | 类型/单位 | 说明 |
| --- | --- | --- |
| `listing_id` | int | 挂牌 ID（渠道×模型一行） |
| `channel_id` | int | 渠道 ID（并发查询/自测用它） |
| `supplier_id` | int | 供应商 ID |
| `supplier_name` / `supplier_nickname` / `supplier_slug` | string | 匿名态脱敏为 `Supplier ID 370` 形态 |
| `channel_name` | string | 匿名态 `Channel ID 1329` |
| `model_name` | string | 精确名 |
| `brand` | string | `tencent` / `OpenAI`… |
| `description` | string | 渠道备注（如 `wb渠道`） |
| `charge_type` | `per_token`/`per_request` | 计费方式 |
| `pricing_currency` / `pricing_unit` | `USD` / `per_1m_tokens`\|`per_request` | 计价口径 |
| `input_price_micros` / `output_price_micros` / `cache_read_price_micros` / `cache_write_price_micros` / `per_request_price_micros` | int **micros（1e-6 USD）** → `/1e6` = USD/1M tokens | 挂牌价 |
| `official_price` | object：`source, provider_id, model_id, model_name, input/output/cache_read/cache_write_price_micros, last_updated, synced_at` | 官方基准价 |
| `confirmed_price_snapshot` | object：各 price_micros + `charge_type` + `markup_percent` | 已确认价快照（可全 0＝未确认） |
| **`realtime_ratio_usd`** | float **＝挂牌价÷官方价** | **这就是「倍率」**；实测 `336/140000=0.0024`、`288000/2000000=0.144` |
| `realtime_ratio_cny` / `realtime_ratio_exchange_rate` | float | 人民币倍率 / 汇率（实测 6.6719） |
| `realtime_ratio_unavailable` | string | 倍率不可用原因 |
| `recent_success_rate` | int **bp**（10000＝100%） | 近期成功率 |
| `success_rate_24h` / `success_rate_7d` | int bp | 24h / 7d 成功率（7d 常缺） |
| `sr_24h_state` / `sr_7d_state` | `rate`/`no_data` | **先看 state 再用值** |
| `sample_count` | int | 近期样本数 |
| `success_buckets` | array `[{sample_count,success_count,success_rate}]` | 近期分桶（实测 10 项） |
| **`p50_ttft_ms`** | int ms（0＝无数据） | 首字延迟 P50 |
| **`recent_p50_ms`** | int ms | 近期端到端 P50（实测 ~14479；别和 ttft 混用） |
| `throughput_tps` | float tokens/s | 吞吐（实测 78.2） |
| `b24` / `b7d` | array `[{s:样本,k:成功,r:成功率bp,t:桶起点unix秒,d:延迟ms,f:首字ms,c:缓存率bp}]` | **仅 `page_size ≤ 100` 才返回** |
| `cache_hit_rate_24h` / `cache_hit_state` | int bp / enum | **仅 `page_size ≤ 100`** |
| `last_success_at` / `last_failure_at` / `last_sample_at` | unix 秒 | 时间线 |
| `last_failure_code` | string | 如 `unknown_error` |
| `last_test_time` / `last_test_response_ms` | int（0＝从未） | 平台最近测试 |
| `listing_availability` | int | 实测全 `1` |
| `supplier_channel_disabled` / `user_channel_disabled` / `is_favorite` / `is_seed` | bool | 可测性/归属 |
| `route_type` / `route_status` / `route_target_id` | 匿名态 `default`/`no_token`/`0` | 用户路由（登录态） |
| `pin_status` / `pin_target_id` | 匿名态 `""`/`0` | 固定渠道（登录态） |
| `smart_status` / `smart_target_id` / `smart_routing_status` / `smart_routing_labels` | 匿名态 + `["stable","cheap"]` 等 | 智能路由标签（实测分布：空 5079、`cheap` 3558、`stable+cheap` 1197、`stable` 727） |
| `authenticity_guaranteed` | bool | **保真标记**（＝`channel_kinds=guaranteed`），实测 750/12748 |
| **`test_endpoint`** | enum | 实测分布：`chat` 7883 / `responses` 4110 / `images` 615 / `embeddings` 23 / **`unsupported` 117** |
| `svg_test_protocol_enabled` / `svg_custom_test_enabled` / `svg_prompt_version` | bool/bool/int | 实测全站皆 `true`/`true`/`2` |
| **`model_detection_supported`** | bool | 指纹检测是否支持，实测 5861/12748 |
| `custom_image_test` / `ref_images_supported` | bool | 自定义图片测试 / 参考图（实测 717 支持图片测试） |
| `claude_capability_badge` / `claude_code_recommended` | bool | 徽章 |
| `price_change_direction` / `last_price_change_at` / `last_price_change_summary` | — | 调价信息 |
| `merchant_block_stats` | object | 商户拉黑统计 |
| `review_count` / `review_rating_tenths` | int | **偶发出现**（`reviews_enabled` 时） |

价格口径三例核对（确认 `micros/1e6 = USD/1M tokens` 且倍率自洽）：

| 模型 | 挂牌输入 micros | 官方输入 micros | `realtime_ratio_usd` | 读法 |
| --- | --- | --- | --- | --- |
| `claude-sonnet-5-5` | 288000 | 2000000 | **0.144** | $0.288/1M vs 官方 $2.00/1M ＝ 14.4% |
| `gpt-5.6-luna` | 16080 | 200000 | **0.0804** | $0.01608/1M vs $0.20/1M ＝ 8.04% |
| `hy3` | 336 | 140000 | **0.0024** | $0.000336/1M vs $0.14/1M ＝ **0.24%（招徕价，重点怀疑对象）** |

> 按价格升序取「最便宜的渠道」，排在最前的全是 `hy3` 这类 0.24% 倍率号——**这正是需要逐个实测的对象**，不能当可靠渠道。

代码证据 D —— 插件既有的字段映射（`snapshot.js` `compact()`，交叉验证字段名与单位）：

```js
const {listing_id,channel_id,supplier_id}=item, official=item.official_price??{};
inputPrice: item.input_price_micros/1e6, successRate: item.recent_success_rate/100,
ttftMs: item.p50_ttft_ms, guaranteed: Boolean(item.authenticity_guaranteed), testEndpoint: item.test_endpoint
```

---

## 2. 取数上限、翻页方式、限流钳制

### 2.1 `page_size`（实测四档，全部可复现）

| `page_size` | 实际返回 | 时序字段 `b24`/`b7d`/`cache_hit_rate_24h` |
| --- | --- | --- |
| `1 … 100` | 原样 | ✅ **在** |
| `101 … 500` | 原样（回显同值） | ❌ **消失** |
| `> 500` | **钳成 `500`**，返回 500 行 | ❌ |
| `0` / `-1` / `abc` | 回显无 `page_size` 键，**一次返回全量 12748 行 / 34.7 MB / 3.3 s** | ❌ |

**100 是硬边界**：`page_size=100` 两次复测均 `b24=True b7d=True cache24=True`；`page_size=101` 两次复测全部 `False`。

### 2.2 翻页方式与「越界不报错」陷阱

| 请求（`total=12748`, `page_size=100`） | 回显 `page` | 返回 |
| --- | --- | --- |
| `page=127` / `128`（末页） | `127` / `128` | 100 / 48 行 |
| `page=129` / `130` / `500` / `1000` | **全部 `128`** | **都是那 48 行** |

→ **循环必须写成 `for p in 1..ceil(total/page_size)`**。绝不能写「翻到返回空页/短页为止」——越界会永远返回末页，死循环。

`page` 与 `page_size` 先钳后算：`page=3&page_size=1000` 与 `page=3&page_size=500` 返回**同一集合**（实测集合相等）。

**重复风险**：未筛选全站翻 4 页共 400 行出现 2 条重复（快照翻页期间重建）；**按 model 筛选很稳**——`gpt-6-astra` 翻 10 页拿 908 条，去重后 **908/908、0 重复**。无论如何都要按 `listing_id:channel_id:supplier_id` 去重。

### 2.3 限流（实测，边缘层 IP 级）

```
HTTP/2 429                      ← 响应体是 HTML 错误页，不是 JSON！
content-type: text/html; charset=utf-8
x-ratelimit: true
x-ratelimit-limit: 30
x-ratelimit-reset: 3            ← 秒；窗口 3 s。（没有 retry-after）
```

| 并发场景（同 IP、`page_size=100`） | 结果 |
| --- | --- |
| 12 并发 / 20 顺序 | **全 200，0×429** |
| 30 并发 | 27×200，3×429 |
| 40 并发 | 30×200，10×429 |
| 45 并发（连测 2 轮） | **恰好 30×200 + 15×429，两轮完全一致** |

→ **配额 = 每 IP 每 3 秒 30 个请求**。两个实现约束：
1. 429 **没有 JSON 体**，必须按**状态码**判错（不能判 `success:false`）。
2. **没有 `retry-after`**，只有 `x-ratelimit-reset`(=3)。`client.js` 现在只读 `retry-after` → 读不到就退化成立刻重试，会再撞。

代码证据 E —— 插件现有分页/并发常数与错判风险（`snapshot.js` / `client.js`）：

```js
const PAGE_SIZE = 100; const PAGE_CONCURRENCY = 6;   // 100 正确（>100 丢时序字段）
const retryAfter = Number(headers?.get?.('retry-after')); // ← 该站不返回此头，只有 x-ratelimit-reset
const url = number => `${site.webUrl}/api/marketplace/public/channels/search?page=${number}&page_size=${PAGE_SIZE}`;
```

> 与 `plan/限流与采样节流方案.md` 的「每账号 5 次/分钟、每渠道 20 次/分钟」是**两套不同限流**：那是**自助测试**打上游的配额，这里是**市场读接口**的边缘 IP 配额，互不相干。

---

## 3. 市场页「测试」按钮怎么判断这一行能不能自测

三层，全部在前端，且**都不额外发请求**——数据全在 `channels/search` 的行里。

### 第一层：全局开关 + `test_endpoint` 白名单/黑名单 → `ZF()`

代码证据 F —— 按钮可见性判定（bundle `ZF()`，`UF="unsupported"`）：

```js
function ZF({selfTestEnabled:e,testEndpoint:a,isLoggedIn:t,hasAnyToken:n,selectedTokenId:o}){
 return e?(!a||a===UF?{visible:!1}:t?(n?(o?{visible:!0,disabled:!1,reason:""}:{visible:!0,disabled:!0,reason:"no_selection"})
 :{visible:!0,disabled:!0,reason:"no_token"}):{visible:!0,disabled:!0,reason:"login"}):{visible:!1}}
```

翻译成规则：

| 条件 | 结果 |
| --- | --- |
| `self_test_enabled !== true`（`data` 顶层开关） | **不渲染** |
| `test_endpoint` 为空 —— 或等于 `"unsupported"` | **不渲染**（实测全站 117 行属此列） |
| 未登录 | 渲染但置灰，`reason:"login"`（提示「请先登录后再测试」） |
| 已登录、无令牌 | 置灰，`reason:"no_token"`（「请先创建并在上方选择令牌，测试将从该令牌扣费」） |
| 已登录有令牌但未选中 | 置灰，`reason:"no_selection"`（「请先在上方选择令牌」） |
| 以上都过 | 可点 |

> 自测凭证格式（与本仓库 `plan/research/a6api-pin.md` 一致）：`Gc(tokenKey, channelId)` → **`Bearer sk-<key>-<channel_id>`**，即「钉到该渠道」的隐藏凭证——这就是「逐个渠道测试」的落点。

### 第二层：每行字段可能被前端**主动清空**

代码证据 G —— 只保留「本次真正取回的那一页」的测试字段（bundle `Ay()` / `my()`）：

```js
Ay=(e=[],a,t=new Set())=>{const n=e.map(o=>o.map(r=>({...r,...a.listingFlags,reviews_enabled:...,
 ...a.listingFlags.self_test_enabled!==!0||t.has(_t(r))?{self_test_enabled:!1,test_endpoint:"",custom_image_test:!1,ref_images_supported:!1}:{}})));return{blocks:n,channels:n.flat()}}
my=(e,a=[])=>{const t=new Map(a.map(n=>[_t(n),n]));return e.map(n=>n.map(o=>{const r=t.get(_t(o));return r?{...o,test_endpoint:...,...}:o}))}
// _t=e=>String(e._id||e.listing_id||e.id)
```

含义：某行若**不在本次 `channels/search` 响应里**（比如来自缓存的旧页），它的 `test_endpoint` 会被**置空**，于是第一层判定直接不渲染按钮。
→ **实现启示：自己缓存渠道行时，不要信缓存里的 `test_endpoint`，要么每次重新取该页，要么把 `test_endpoint` 当作「取回时有效」的瞬时字段。**

### 第三层：指纹检测（model detection）另有更严的门槛 → `Ak()`

代码证据 H：

```js
function Ak(e){return["chat","responses"].includes(e?.test_endpoint)&&e?.model_detection_supported===!0&&e?.model_detection_enabled===!0}
```

即：**只有 `chat` / `responses` 才能做指纹检测**；`images` / `embeddings` 即便 `model_detection_supported=true` 也不行。另有 `KF=e=>e===mc||e===rm`（`mc="chat"`, `rm="responses"`）用于流式能力判定。
`test_endpoint` 枚举全集（bundle）：`chat` / `responses` / `images` / `embeddings` / `rerank` / `unsupported`（实测数据里没有出现 `rerank`）。

**因此「挑出某模型全部渠道并逐个测试」的可测性矩阵：**

| `test_endpoint` | 协议自测（SVG/pelican） | 指纹检测 | 实测条数 |
| --- | --- | --- | --- |
| `chat` / `responses` | ✅ | ✅（需 `model_detection_supported`） | 7883 / 4110 |
| `images` | ✅ | ❌ | 615 |
| `embeddings` | ✅ | ❌ | 23 |
| `unsupported` | ❌ 按钮不渲染 | ❌ | 117 |

---

## 4. 其余接口（一句话，不展开）

| 接口 | 用途 | 方法 | 匿名 |
| --- | --- | --- | --- |
| `/api/marketplace/hot-models` | 品牌/模型分面（左侧筛选树数据源，164 个模型，含 `listing_count`） | GET | ✅ 200 |
| `/api/marketplace/public/channel-concurrency/query` | 渠道实时并发占用与上限 | POST `{listing_ids:[]}` ≤100（101 → 400） | ✅ 200 |
| `/api/marketplace/peak-schedule` | 高峰时段规则（`multiplier_bps:20000`） | GET | ✅ 200 |
| `/api/marketplace/circuit-states/query` | 渠道×模型熔断状态 | POST `{pairs:[{channel_id,model}]}` ≤100 | ❌ 401 |
| `/api/marketplace/model-detections`（+`/summary`、`/{id}`） | 启动/批量查/轮询指纹检测 | POST `{channel_id,model,token_id}`；summary POST `{pairs:[]}` ≤100 | ❌ 401 |
| `/api/marketplace/self-tests/pelican/latest` · `svg-tests` · `channel-reports/challenge` | 协议自测结果/触发 | GET / GET / POST | ❌ 401 |

---

## 5. 实测原始证据（关键几条）

```bash
curl -s 'https://a6api.vip/api/marketplace/public/channels/search?page=1&page_size=5' \
  -H 'accept: application/json' -H 'referer: https://a6api.vip/marketplace'
# → HTTP/2 200, 0.87s, 20649 B；server: Edge/1.1.35；x-new-api-version: r933-deb0588fa
# → data.total=12751, items[0].model_name="hy3", input_price_micros=336, test_endpoint="chat"
```

样例行（长数组已折叠，无任何密钥；`supplier_name` 等为站点匿名态自身返回的脱敏名）：

```json
{"listing_id":48688,"channel_id":1329,"supplier_id":370,
 "channel_name":"Channel ID 1329","supplier_name":"Supplier ID 370",
 "model_name":"hy3","brand":"tencent","description":"wb渠道",
 "charge_type":"per_token","pricing_currency":"USD","pricing_unit":"per_1m_tokens",
 "input_price_micros":336,"output_price_micros":1392,"cache_read_price_micros":84,
 "official_price":{"input_price_micros":140000,"output_price_micros":580000},
 "realtime_ratio_usd":0.0024,"realtime_ratio_cny":0.01601256,"realtime_ratio_exchange_rate":6.6719,
 "recent_success_rate":10000,"success_rate_24h":9997,"sr_24h_state":"rate","sr_7d_state":"no_data",
 "sample_count":100,"p50_ttft_ms":0,"recent_p50_ms":14479,"throughput_tps":78.2,
 "cache_hit_rate_24h":6425,"cache_hit_state":"rate",
 "b24":[{"s":9006,"k":8987,"r":9978,"t":1794650400,"d":26113,"f":3517,"c":7756},"…共12项"],
 "b7d":[{"s":294330,"k":293620,"r":9975,"t":1794182400,"d":35092,"f":11883,"c":3428},"…共7项"],
 "last_success_at":1794733617,"last_failure_at":1794733152,"last_failure_code":"unknown_error",
 "test_endpoint":"chat","svg_test_protocol_enabled":true,"svg_prompt_version":2,
 "model_detection_supported":false,"custom_image_test":false,"ref_images_supported":false,
 "authenticity_guaranteed":false,"smart_routing_labels":["stable","cheap"],
 "listing_availability":1,"route_status":"no_token","pin_status":""}
```

---

## 6. 给实现的三条硬约束

1. **枚举某模型全部渠道**：`?model=<精确名>&page_size=100&page=<1..ceil(total/100)>`，按 `listing_id:channel_id:supplier_id` 去重，**用 `total` 收敛**（越界会夹回末页 → 死循环）。实测 `gpt-6-astra` → 908 条 / 10 页 / 覆盖率 100% / 0 重复。
2. **速率**：单 IP ≤30 请求/3 s。300 条以内 3 个请求、1000 条以内 10 个请求，完全安全；`PAGE_CONCURRENCY=6` 无需改。429 按状态码判、退避 3 s（该站不给 `retry-after`）。
3. **可测性判定别自己发明**：`test_endpoint` ∈ {空, `unsupported`} → 不可测；指纹检测再加 `["chat","responses"]` + `model_detection_supported`；且**不要复用缓存行的 `test_endpoint`**（前端会主动置空非当页行）。

### 未证实 / 风险

- `channel_type` 取值含义、`view` 参数语义、`include_disabled`/`favorites_only`/`token_id` 的**登录态**行为：未证实（匿名无效果）。
- `supplier_name` 对登录用户是否返回真实商户名：未证实。
- 429 窗口是否严格 3 s 滑动窗口：实测「30/3s」两轮完全一致，但未探窗口边界，保守按 ≤25 请求/3 s 设计。
- `total` 漂移幅度：观测 ±3（12748~12751），未长时观察。
