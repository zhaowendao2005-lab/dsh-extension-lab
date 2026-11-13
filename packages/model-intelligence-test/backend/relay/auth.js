import { siteOf } from './site.js';
import { RelayError } from './client.js';

/**
 * Relay credentials live in the Host credential store, referenced by name; values never leave the
 * Host. `apiKey` calls models; `accessToken` + `userId` (a6api "系统访问令牌") read dashboard data.
 * The API-key reference doubles as the `apiKeyEnv` of providers this plugin writes into pi-ai.
 */
const FIELDS = ['apiKey', 'accessToken', 'userId'];
const SUFFIX = { apiKey: 'API_KEY', accessToken: 'ACCESS_TOKEN', userId: 'USER_ID' };

export function credentialName(siteId, field) {
  return `MIT_${siteId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${SUFFIX[field]}`;
}

export class RelayAuth {
  constructor(ctx, storage) {
    this.ctx = ctx;
    this.storage = storage;
    this.verified = new Map();
  }
  /** Plugin-owned credential records; see `managedDomain` for why the credential store is not enough. */
  async vault() {
    const domain = await this.storage.managed();
    if (!domain) throw new RelayError('storage-unavailable', '凭据存储不可用');
    return domain.table('auth');
  }
  site(siteId) {
    const site = siteOf(siteId);
    if (!site) throw new RelayError('relay-unknown-site', '未适配的中转站');
    return site;
  }
  credentials() {
    const service = this.ctx.get('credentials');
    if (!service) throw new RelayError('credentials-unavailable', '当前运行时没有凭据服务');
    return service;
  }

  async resolve(siteId, field) {
    this.site(siteId);
    const stored = await (await this.vault()).get(siteId);
    const value = stored?.[field];
    if (typeof value === 'string' && value) return value;
    const service = this.ctx.get('credentials');
    if (!service) return null;
    const hit = await service.resolve(credentialName(siteId, field));
    return typeof hit?.value === 'string' && hit.value ? hit.value : null;
  }

  async status(siteId) {
    const site = this.site(siteId);
    const service = this.ctx.get('credentials');
    const stored = await (await this.vault()).get(siteId);
    const entries = await Promise.all(FIELDS.map(async field => {
      const local = typeof stored?.[field] === 'string' && stored[field];
      if (local) return [field, { configured: true, source: 'plugin', writable: true }];
      const info = service ? await service.describe(credentialName(siteId, field)) : null;
      return [field, { configured: Boolean(info?.configured), source: info?.source ?? null, writable: info?.writable !== false }];
    }));
    const result = Object.fromEntries(entries);
    // The user id is an identifier, not a secret: show it so the user can recognise the account.
    const userId = result.userId.configured ? await this.resolve(siteId, 'userId') : null;
    return {
      siteId: site.id, apiKey: result.apiKey, accessToken: result.accessToken,
      userId: userId ? { configured: true, value: userId } : { configured: false, value: null },
      apiKeyRef: credentialName(siteId, 'apiKey'),
      verified: this.verified.get(siteId) ?? null,
    };
  }

  async set(siteId, patch) {
    this.site(siteId);
    const table = await this.vault();
    const current = (await table.get(siteId)) ?? { siteId };
    const next = { ...current, siteId };
    const service = this.ctx.get('credentials');
    for (const field of FIELDS) {
      const value = patch?.[field];
      if (value === undefined) continue;
      const name = credentialName(siteId, field);
      if (value === null || value === '') {
        delete next[field];
        // Mirror the removal into the credential store when this runtime accepts writes.
        try { await service?.unset(name); } catch { /* overlay-owned store: the registry is authoritative */ }
        continue;
      }
      const text = String(value).trim();
      if (field === 'userId' && !/^\d{1,12}$/.test(text)) throw new RelayError('invalid-user-id', '用户 ID 必须是数字');
      if (text.length > 512) throw new RelayError('invalid-credential', '凭据过长');
      next[field] = text;
      // Best effort: providers this plugin publishes read `apiKeyEnv`, so mirror the API key there.
      try { await service?.set(name, text); } catch { /* overlay-owned store: the registry is authoritative */ }
      if (field !== 'apiKey') this.verified.delete(siteId);
    }
    await table.put(siteId, next);
    return this.status(siteId);
  }

  /** Headers for dashboard (login-only) endpoints, or null when the token is not configured. */
  async dashboardHeaders(siteId) {
    const [token, userId] = await Promise.all([this.resolve(siteId, 'accessToken'), this.resolve(siteId, 'userId')]);
    if (!token || !userId) return null;
    return { authorization: token, 'new-api-user': userId };
  }

  async verify(siteId) {
    const site = this.site(siteId);
    const headers = await this.dashboardHeaders(siteId);
    if (!headers) throw new RelayError('auth-missing', '请先填写系统访问令牌与用户 ID');
    let response;
    try {
      response = await fetch(`${site.webUrl}/api/user/self`, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
    } catch { throw new RelayError('relay-network', '无法连接中转站，请检查网络后重试。'); }
    let body = null;
    try { body = await response.json(); } catch { /* not json */ }
    if (response.status === 401 || response.status === 403 || body?.success === false) {
      this.verified.delete(siteId);
      throw new RelayError('auth-invalid', '系统访问令牌或用户 ID 无效，请在 a6api 个人设置中重新生成');
    }
    if (!response.ok) throw new RelayError('relay-unavailable', `中转站校验失败（HTTP ${response.status}）`);
    const user = body?.data ?? body;
    const verified = { username: typeof user?.username === 'string' ? user.username.slice(0, 64) : null, displayName: typeof user?.display_name === 'string' ? user.display_name.slice(0, 64) : null, at: Date.now() };
    this.verified.set(siteId, verified);
    return this.status(siteId);
  }
}
