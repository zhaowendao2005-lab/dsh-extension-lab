/** Host-only a6api control plane. Account access credentials never cross the wire. */
import { A6Error } from './errors.js';

export const SITE_ORIGIN = 'https://a6api.vip';
const TIMEOUT_MS = 25_000;
const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const rowsOf = payload => Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.items) ? payload.data.items : Array.isArray(payload) ? payload : [];
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function failure(status, payload) {
  const code = text(payload?.code ?? payload?.error?.code, 80);
  const message = text(payload?.message ?? payload?.error?.message, 300);
  if (status === 401 || status === 403) return new A6Error(code === 'dashboard_auth_user_id_missing' ? 'auth-user-id-missing' : 'auth-invalid', code === 'dashboard_auth_user_id_missing' ? '访问令牌缺少用户 ID，请同时填写。' : '访问令牌无效或已过期，请重新配置。');
  if (status === 429) return new A6Error('rate-limited', 'a6api 接口限流，请稍后重试。');
  return new A6Error(`http-${status}`, message || `a6api 返回 HTTP ${status}`);
}
function retryDelay(headers) {
  const value = headers.get('retry-after');
  const seconds = value !== null && value.trim() !== '' ? Number(value) : NaN;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = value ? Date.parse(value) : NaN;
  if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  if (Number.isFinite(reset) && reset > 0) return reset > 1e9 ? Math.max(1000, reset * 1000 - Date.now()) : reset * 1000;
  return 5000;
}

export class A6Site {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { fetchImpl, accessToken: '', userId: '', generation: 0, active: 0, cooldownUntil: 0 });
    this.controller = new AbortController();
  }
  configure({ accessToken, userId }) {
    this.accessToken = typeof accessToken === 'string' ? accessToken.trim() : '';
    this.userId = userId === undefined || userId === null ? '' : String(userId).trim();
    this.generation += 1;
    this.onConfigure?.({ siteOrigin: SITE_ORIGIN, accountId: this.userId });
    if (this.accessToken && !this.userId) throw new A6Error('auth-user-id-missing', '请同时填写访问令牌与用户 ID。');
  }
  get configured() { return Boolean(this.accessToken && this.userId); }
  get mask() { return !this.accessToken ? '' : this.accessToken.length <= 8 ? '••••' : `${this.accessToken.slice(0, 3)}••••${this.accessToken.slice(-4)}`; }
  headers() {
    if (!this.configured) throw new A6Error('auth-missing', '尚未配置 a6api 访问令牌。');
    return { authorization: this.accessToken, 'new-api-user': this.userId, accept: 'application/json' };
  }
  /** Shared bounded control-plane budget; model inference does not consume this queue. */
  async request(path, { method = 'GET', query, body, timeoutMs = TIMEOUT_MS } = {}) {
    const generation = this.generation;
    const headers = this.headers();
    while (this.active >= 2 || Date.now() < this.cooldownUntil) {
      if (this.controller.signal.aborted) throw new A6Error('disposed', '服务已关闭');
      if (generation !== this.generation) throw new A6Error('account-changed', '账号已变化，请重试');
      await wait(Math.min(250, Math.max(20, this.cooldownUntil - Date.now())));
    }
    if (generation !== this.generation) throw new A6Error('account-changed', '账号已变化，请重试');
    if (this.controller.signal.aborted) throw new A6Error('disposed', '服务已关闭');
    this.active += 1;
    try {
      const url = new URL(path, SITE_ORIGIN);
      for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      if (body !== undefined) headers['content-type'] = 'application/json';
      let response;
      try {
        response = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeoutMs)]) });
      } catch { throw new A6Error('network', '无法连接 a6api，连接超时或请求已中止。'); }
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
      if (generation !== this.generation) throw new A6Error('account-changed', '账号已变化，已忽略旧响应');
      if (!response.ok || payload?.success === false) {
        const error = failure(response.status, payload);
        if (response.status === 429) {
          error.retryAfterMs = Math.min(300_000, retryDelay(response.headers));
          this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + error.retryAfterMs);
        }
        throw error;
      }
      return payload;
    } finally { this.active -= 1; }
  }
  async self() {
    const payload = await this.request('/api/user/self');
    const data = payload?.data ?? payload;
    return { id: data?.id ?? Number(this.userId), name: text(data?.display_name ?? data?.username, 120), quota: number(data?.quota) };
  }
  async verify() {
    const account = await this.self();
    if (String(account.id) !== this.userId) throw new A6Error('wrong-account', '用户 ID 与访问令牌的账号不一致');
    return { account, pins: (await this.pins()).length };
  }
  async tokens() {
    const found = new Map();
    let previous = '';
    for (let p = 1; p <= 1000; p += 1) {
      const payload = await this.request('/api/token/search', { query: { p, page_size: 100 } });
      const rows = rowsOf(payload);
      const signature = rows.map(row => row.id).join(',');
      if (rows.length && signature === previous) throw new A6Error('pagination-incomplete', '令牌分页重复，未能确认完整列表，请刷新');
      previous = signature;
      for (const row of rows) {
        const id = Number(row.id);
        if (Number.isSafeInteger(id) && id > 0) found.set(id, { id, name: text(row.name, 120) || `令牌 ${id}`, maskedKey: text(row.key, 120), status: number(row.status), expiredTime: number(row.expired_time), unlimited: Boolean(row.unlimited_quota), remainQuota: number(row.remain_quota) });
      }
      const total = number(payload?.data?.total ?? payload?.total);
      if (!rows.length || (total !== undefined ? found.size >= total : rows.length < 100)) return [...found.values()];
    }
    throw new A6Error('pagination-incomplete', '令牌数量超出单次同步预算，请稍后刷新');
  }
  async tokenKey(tokenId) {
    const payload = await this.request(`/api/token/${Number(tokenId)}/key`, { method: 'POST', body: {}, timeoutMs: 10_000 });
    const key = payload?.data?.key ?? payload?.key;
    if (typeof key !== 'string' || !key) throw new A6Error('key-unavailable', `令牌 ${tokenId} 没有可用的密钥`);
    return key;
  }
  async pins() {
    return rowsOf(await this.request('/api/marketplace/pins')).filter(row => Number(row?.token_id) > 0).map(row => ({ tokenId: Number(row.token_id), channelId: Number(row.channel_id), supplierId: Number(row.supplier_id ?? 0), model: text(row.model_name, 256), status: text(row.status, 40), fallback: typeof row.fallback_to_smart_routing === 'boolean' ? row.fallback_to_smart_routing : undefined, routeEffective: row.route_effective === true }));
  }
  async pin({ tokenId, model, channelId, fallback = false }) {
    await this.request('/api/marketplace/pin', { method: 'POST', body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId), fallback_to_smart_routing: Boolean(fallback) } });
    const pins = await this.pins();
    const matching = pins.filter(row => row.tokenId === Number(tokenId) && row.model === model);
    const current = matching.length === 1 ? matching[0] : null;
    return { routeEffective: current?.channelId === Number(channelId) && current?.routeEffective === true, supplierId: current?.supplierId ?? 0, pins };
  }
  async unpin({ tokenId, model, channelId }) {
    await this.request('/api/marketplace/unpin', { method: 'POST', body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId) } });
    return { ok: true };
  }
  /** Public market listing for one channel: every model it offers, with the site's shown prices. */
  async marketChannels({ channelId } = {}) {
    const payload = await this.request('/api/marketplace/public/channels/search', { query: { channel_id: Number(channelId), page: 1, page_size: 50 } });
    return rowsOf(payload).map(row => ({
      channelId: Number(row.channel_id), model: text(row.model_name, 256), supplierId: Number(row.supplier_id ?? 0),
      availability: number(row.listing_availability), chargeType: text(row.charge_type, 32),
      currency: text(row.pricing_currency, 8), unit: text(row.pricing_unit, 32),
      input: number(row.input_price_micros), output: number(row.output_price_micros),
      cacheRead: number(row.cache_read_price_micros), cacheWrite: number(row.cache_write_price_micros), perRequest: number(row.per_request_price_micros),
    }));
  }
  async billingSettings() {
    const payload = await this.request('/api/status');
    const data = payload?.data ?? payload;
    return { quotaPerUnit: number(data?.quota_per_unit), usdExchangeRate: number(data?.usd_exchange_rate) };
  }
  async requestLogs(requestId) {
    const rows = [];
    let previous = '';
    for (let p = 1; p <= 20; p += 1) {
      const payload = await this.request('/api/log/self', { query: { request_id: requestId, p, page_size: 100 } });
      const page = rowsOf(payload);
      const signature = JSON.stringify(page);
      if (page.length && signature === previous) return { rows, complete: false };
      previous = signature;
      rows.push(...page);
      const total = number(payload?.data?.total ?? payload?.total);
      if (!page.length || (total !== undefined ? rows.length >= total : page.length < 100)) return { rows, complete: payload?.data?.total_capped !== true };
    }
    return { rows, complete: false };
  }
  async subscriptions() {
    const payload = await this.request('/api/subscriptions');
    // The site uses either a flat array or its usual data.items envelope.
    return rowsOf(payload);
  }
  async addRoute({ tokenId, model, channelId }) {
    const read = async () => (await this.subscriptions()).find(row => Number(row.token_id) === Number(tokenId) && (row.model_name ?? row.model) === model);
    const has = row => Array.isArray(row?.channels) && row.channels.some(item => Number(typeof item === 'number' ? item : item.channel_id ?? item.id) === Number(channelId));
    const existing = await read();
    if (!has(existing)) {
      if (existing) {
        if (!existing.id) throw new A6Error('route-unverified', '路由池缺少可验证的 ID');
        await this.request(`/api/subscriptions/${existing.id}/channels`, { method: 'PATCH', body: { channel_id: Number(channelId) } });
      } else {
        await this.request('/api/subscriptions', { method: 'POST', body: { token_id: Number(tokenId), model_name: model, channels: [{ channel_id: Number(channelId) }], caps: { input_price_micros: 0, output_price_micros: 0, cache_read_price_micros: 0, cache_write_price_micros: 0, per_request_price_micros: 0 }, sort_strategy: 'price_asc' } });
      }
    }
    const subscriptions = await this.subscriptions();
    const observed = subscriptions.find(row => Number(row.token_id) === Number(tokenId) && (row.model_name ?? row.model) === model);
    if (!has(observed)) throw new A6Error('route-unverified', '未能读回加入路由结果，请检查站点状态');
    return { verified: true, tokenId: Number(tokenId), model, channelId: Number(channelId), subscriptionId: observed.id, subscriptions };
  }
  async removeRoute({ tokenId, model, channelId }) {
    const channel = Number(channelId);
    const read = async () => (await this.subscriptions()).find(row => Number(row.token_id) === Number(tokenId) && (row.model_name ?? row.model) === model);
    const members = row => (Array.isArray(row?.channels) ? row.channels : []).map(item => Number(typeof item === 'number' ? item : item?.channel_id ?? item?.id));
    const existing = await read();
    if (!existing?.id) throw new A6Error('route-missing', '没有找到该模型的路由池');
    if (members(existing).includes(channel)) await this.request(`/api/subscriptions/${existing.id}/channels/${channel}`, { method: 'DELETE' });
    const subscriptions = await this.subscriptions();
    const observed = subscriptions.find(row => Number(row.token_id) === Number(tokenId) && (row.model_name ?? row.model) === model);
    if (members(observed).includes(channel)) throw new A6Error('route-unverified', '未能读回取消路由结果，请检查站点状态');
    return { verified: true, tokenId: Number(tokenId), model, channelId: channel, subscriptions };
  }
  dispose() { this.controller.abort(); }
}
