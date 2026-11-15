/**
 * a6api control plane: channel pinning and test-key retrieval, authenticated with the account's
 * system access token.
 *
 * The site accepts `authorization: <access token>` plus `new-api-user: <user id>` as an alternative
 * to the browser cookie session — that is the only reason this plugin can drive pins without a
 * userscript. Credentials live in the Host credential store; the browser never sees them.
 */

import { A6Error } from './errors.js';

export const SITE_ORIGIN = 'https://a6api.vip';
const TIMEOUT_MS = 25_000;

const text = (value, max = 300) => (typeof value === 'string' ? value.slice(0, max) : '');

function failure(status, payload) {
  const code = text(payload?.code ?? payload?.error?.code, 80);
  const message = text(payload?.message ?? payload?.error?.message, 300);
  if (status === 401 || status === 403) {
    if (code === 'dashboard_auth_user_id_missing') return new A6Error('auth-user-id-missing', '访问令牌缺少用户 ID：请同时填写访问令牌与用户 ID。');
    return new A6Error('auth-invalid', '访问令牌无效或已过期，请在 a6api 设置页重新生成。');
  }
  if (status === 429) return new A6Error('rate-limited', 'a6api 接口限流，请稍后重试。');
  return new A6Error(`http-${status}`, message || `a6api 返回 HTTP ${status}`);
}

export class A6Site {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.accessToken = '';
    this.userId = '';
  }

  /** Tokens are account-wide, so only the tail is ever echoed back to the UI. */
  configure({ accessToken, userId }) {
    this.accessToken = typeof accessToken === 'string' ? accessToken.trim() : '';
    this.userId = userId === undefined || userId === null ? '' : String(userId).trim();
    if (this.accessToken && !this.userId) throw new A6Error('auth-user-id-missing', '请同时填写访问令牌与用户 ID。');
  }

  get configured() {
    return Boolean(this.accessToken && this.userId);
  }

  get mask() {
    if (!this.accessToken) return '';
    return this.accessToken.length <= 8 ? '••••' : `${this.accessToken.slice(0, 3)}••••${this.accessToken.slice(-4)}`;
  }

  headers() {
    if (!this.configured) throw new A6Error('auth-missing', '尚未配置 a6api 访问令牌。');
    return { authorization: this.accessToken, 'new-api-user': this.userId, accept: 'application/json' };
  }

  async request(path, { method = 'GET', query, body } = {}) {
    const url = new URL(path, SITE_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = this.headers();
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await this.fetchImpl(url, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new A6Error('network', `无法连接 a6api：${text(error?.message, 160) || '网络错误'}`);
    }
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* non-JSON error page */ }
    if (!response.ok) throw failure(response.status, payload);
    if (payload && payload.success === false) throw failure(response.status, payload);
    return payload;
  }

  async self() {
    const payload = await this.request('/api/user/self');
    const data = payload?.data ?? payload;
    return { id: data?.id ?? Number(this.userId), name: text(data?.display_name ?? data?.username, 120), quota: Number(data?.quota ?? 0) };
  }

  /** Probe the credential pair and report what it can see. */
  async verify() {
    const account = await this.self();
    const pins = await this.pins();
    return { account, pins: pins.length };
  }

  async tokens() {
    const payload = await this.request('/api/token/search', { query: { p: 1, page_size: 100 } });
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.items) ? payload.data.items : [];
    return rows.map(row => ({
      id: Number(row.id),
      name: text(row.name, 120) || `令牌 ${row.id}`,
      maskedKey: text(row.key, 80),
      unlimited: Boolean(row.unlimited_quota),
      remainQuota: Number(row.remain_quota ?? 0),
    })).filter(token => Number.isInteger(token.id) && token.id > 0);
  }

  /** Plaintext test key. Host-only; never persisted and never sent to the client. */
  async tokenKey(tokenId) {
    const payload = await this.request(`/api/token/${Number(tokenId)}/key`, { method: 'POST', body: {} });
    const key = payload?.data?.key ?? payload?.key;
    if (typeof key !== 'string' || !key) throw new A6Error('key-unavailable', `令牌 ${tokenId} 没有可用的密钥`);
    return key;
  }

  async pins() {
    const payload = await this.request('/api/marketplace/pins');
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return rows.filter(row => row && Number(row.token_id) > 0).map(row => ({
      tokenId: Number(row.token_id),
      channelId: Number(row.channel_id),
      supplierId: Number(row.supplier_id ?? 0),
      model: text(row.model_name, 256),
      status: text(row.status, 40),
    }));
  }

  /** Pin (token, model) to one channel. Returns false when the site refuses to route there. */
  async pin({ tokenId, model, channelId, fallback = false }) {
    const payload = await this.request('/api/marketplace/pin', {
      method: 'POST',
      body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId), fallback_to_smart_routing: Boolean(fallback) },
    });
    const data = payload?.data ?? payload;
    return { routeEffective: data?.route_effective !== false, supplierId: Number(data?.supplier_id ?? 0) };
  }

  async unpin({ tokenId, model, channelId }) {
    await this.request('/api/marketplace/unpin', {
      method: 'POST',
      body: { token_id: Number(tokenId), model_name: model, channel_id: Number(channelId) },
    });
    return { ok: true };
  }
}
