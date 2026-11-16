/** Host-only provider discovery. Persist observations, never resolved API keys. */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { A6Error } from './errors.js';

const TTL_MS = 5 * 60_000;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => new A6Error(code, message);
const mask = value => typeof value !== 'string' ? '' : /[*•]/u.test(value) ? value.slice(0, 100) : value.length > 12 ? `${value.slice(0, 3)}••••${value.slice(-4)}` : value ? '••••' : '';
export const publicToken = token => ({
  id: Number(token.id), name: String(token.name ?? `令牌 ${token.id}`).slice(0, 120), maskedKey: mask(token.maskedKey),
  ...(token.status === undefined ? {} : { status: token.status }),
  ...(token.expiredTime === undefined ? {} : { expiredTime: token.expiredTime }),
});

export function assertUsableToken(token) {
  if (!token) throw fail('token-not-found', '该令牌已不属于当前账号，请刷新后重选');
  if (token.status !== undefined && ![1, '1', 'enabled', 'active'].includes(token.status)) {
    throw fail('token-unavailable', '该令牌已停用、过期或额度不足');
  }
  if (Number(token.expiredTime) > 0 && Number(token.expiredTime) * 1000 <= Date.now()) {
    throw fail('token-expired', '该令牌已过期，请重新选择');
  }
}

export class A6Providers {
  constructor(service) {
    this.service = service;
    this.revision = 1;
    this.epoch = 0;
    this.account = null;
    this.loading = null;
    this.scan = null;
    this.writeTail = Promise.resolve();
    this.reveals = new Map();
    this.revealActive = 0;
    this.revealWaiters = [];
    this.disposed = false;
  }

  directory() {
    const llm = this.service.ctx.get('llm');
    const providers = llm?.listProviders?.() ?? [];
    return providers.filter(row => row && typeof row.id === 'string' && typeof row.name === 'string')
      .map(({ id, name }) => ({ id, name }));
  }

  /** Only explicit API-key references have a known authentication contract in this version. */
  reference(providerId) {
    const ctx = this.service.ctx;
    try {
      const declaration = ctx.get('llm')?.listConfigurableProviders?.().find(row => row.provider === providerId);
      if (!declaration || declaration.error || !Array.isArray(declaration.settingsPath)) return null;
      const descriptor = ctx.get('settings')?.describe?.({ redactSecrets: true }).find(row => row.ns === declaration.settingsNs);
      let section = descriptor?.value;
      for (const part of declaration.settingsPath) section = section?.[part];
      const secretOverride = descriptor?.secrets?.some(secret => secret.set &&
        declaration.settingsPath.every((part, index) => secret.path[index] === part) &&
        ['apiKey', 'headers', 'auth', 'apiKeys'].includes(secret.path[declaration.settingsPath.length]));
      if (!section || typeof section !== 'object' || secretOverride || section.apiKey || section.auth || section.apiKeys ||
          section.headers && Object.keys(section.headers).length) return null;
      if (typeof section.apiKeyEnv !== 'string' || !section.apiKeyEnv.trim()) return null;
      return { ref: credentialRef(section.apiKeyEnv.trim()), stamp: JSON.stringify([
        declaration.settingsNs, declaration.settingsPath, section.apiKeyEnv, section.baseURL ?? declaration.defaultBaseURL,
        section.api, section.auth, descriptor.revision,
      ]) };
    } catch { return null; }
  }

  async resolve(providerId) {
    if (!this.directory().some(row => row.id === providerId)) throw fail('provider-not-found', '此提供商已从 DSH 移除');
    const reference = this.reference(providerId);
    if (!reference) throw fail('provider-unsupported', '此提供商没有可安全解析的显式 API Key 引用');
    const credentials = this.service.ctx.get('credentials');
    if (!credentials) throw fail('credentials-unavailable', 'Host 凭据服务不可用');
    let resolved;
    try { resolved = await credentials.resolve(reference.ref); }
    catch { throw fail('provider-credential-error', '无法读取此提供商当前凭据'); }
    if (typeof resolved?.value !== 'string' || !resolved.value) throw fail('provider-key-missing', '此提供商当前没有可用的 API Key');
    return { value: resolved.value, stamp: reference.stamp };
  }

  invalidate() {
    this.epoch += 1;
    if (this.account) this.account.observedAt = 0;
    this.scan = null;
    if (this.account) for (const row of Object.values(this.account.matches)) {
      row.state = row.tokenIds?.length ? 'stale' : 'pending';
    }
    this.revision += 1;
  }

  reset() {
    this.invalidate();
    this.account = null;
    this.loading = null;
  }

  async ensure() {
    this.service.assertAvailable();
    await this.service.config();
    this.service.assertAvailable();
    if (this.disposed) throw fail('disposed', '插件正在卸载');
    const identity = this.service.accountIdentity();
    if (this.account?.identity === identity) return this.account;
    if (!this.loading || this.loading.identity !== identity) {
      const generation = this.service.generation;
      const task = (async () => {
        const table = await this.service.table();
        const stored = table.get(`a6-providers:${identity}`);
        if (this.disposed || generation !== this.service.generation) throw fail('account-changed', '账号已切换，请刷新后重试');
        const matches = clone(stored?.matches ?? {});
        for (const row of Object.values(matches)) row.state = row.tokenIds?.length ? 'stale' : 'pending';
        this.account = {
          identity, accountId: this.service.site.configured ? String(this.service.site.userId) : '',
          selectedProviderIds: Array.isArray(stored?.selectedProviderIds) ? stored.selectedProviderIds : [],
          tokens: Array.isArray(stored?.tokens) ? stored.tokens.map(publicToken) : [],
          targets: stored?.targets ?? {}, matches, observedAt: 0, error: undefined,
        };
        return this.account;
      })();
      this.loading = { identity, task };
    }
    return this.loading.task;
  }

  valid(account, epoch) {
    return !this.disposed && !this.service.configSaving && this.account === account && this.epoch === epoch && account.identity === this.service.accountIdentity();
  }

  async persist(account) {
    const task = this.writeTail.catch(() => {}).then(async () => {
      if (this.disposed || this.account !== account || account.identity !== this.service.accountIdentity()) return;
      const table = await this.service.table();
      if (this.disposed || this.account !== account || account.identity !== this.service.accountIdentity()) return;
      await table.put(`a6-providers:${account.identity}`, {
        siteId: 'a6-providers', selectedProviderIds: [...account.selectedProviderIds],
        tokens: account.tokens.map(publicToken), targets: clone(account.targets), matches: clone(account.matches),
      });
    });
    this.writeTail = task;
    await task;
  }

  snapshot(account) {
    return {
      accountId: account.accountId, revision: this.revision,
      providers: this.directory().map(provider => {
        const row = account.matches[provider.id];
        return { ...provider, state: row?.state ?? 'pending', tokenIds: [...(row?.tokenIds ?? [])], ...(row?.error ? { error: row.error } : {}) };
      }),
      tokens: account.tokens.map(publicToken), selectedProviderIds: [...account.selectedProviderIds],
      targets: clone(account.targets), scanning: Boolean(this.scan), ...(account.error ? { error: account.error } : {}),
    };
  }

  async state({ refresh = false, scan = false } = {}) {
    const account = await this.ensure();
    const ttl = account.error || Object.values(account.matches).some(row => ['unmatched', 'error'].includes(row.state)) ? 45_000 : TTL_MS;
    if (!account.accountId) account.error = '请先配置 a6api 账号';
    else if (refresh || scan || !account.observedAt || Date.now() - account.observedAt > ttl) this.start(account, { full: scan || refresh });
    return this.snapshot(account);
  }

  async configure({ providerIds } = {}) {
    const account = await this.ensure();
    if (!account.accountId) throw fail('auth-missing', '请先配置 a6api 账号');
    const allowed = new Set(this.directory().map(row => row.id));
    if (!Array.isArray(providerIds) || providerIds.length > 256 || providerIds.some(id => !allowed.has(id))) {
      throw fail('invalid-providers', '提供商选择无效，请刷新 DSH 目录');
    }
    this.invalidate();
    account.selectedProviderIds = [...new Set(providerIds)];
    await this.persist(account);
    this.start(account, { full: true });
    return this.snapshot(account);
  }

  start(account, { full }) {
    if (this.disposed) return;
    if (this.scan) {
      if (full && !this.scan.full) this.scan.followupFull = true;
      return;
    }
    const epoch = this.epoch;
    // Captured before the first await: repeated UI reads share one account scan.
    const handle = { full, followupFull: false };
    this.scan = handle;
    this.revision += 1;
    handle.promise = this.discover(account, epoch, full).catch(async () => {
      if (!this.valid(account, epoch)) return;
      account.error = '提供商核对未完成，请稍后刷新';
      account.observedAt = Date.now();
      this.revision += 1;
      await this.persist(account);
    }).catch(() => {}).finally(() => {
      if (this.scan === handle) {
        this.scan = null; this.revision += 1;
        if (handle.followupFull && this.valid(account, epoch)) this.start(account, { full: true });
      }
    });
  }

  /** Pending-only single flight, shared by discovery and explicit target checks. */
  reveal(tokenId, account) {
    const generation = this.service.generation;
    const identity = `${account.identity}:${generation}:${tokenId}`;
    if (!this.reveals.has(identity)) {
      const operation = (async () => {
        if (this.revealActive >= 2) await new Promise(resolve => this.revealWaiters.push(resolve));
        else this.revealActive += 1;
        try {
          this.service.assertAvailable();
          if (generation !== this.service.generation || this.account !== account) throw fail('account-changed', '账号已切换');
          return await this.service.site.tokenKey(tokenId);
        } finally {
          const next = this.revealWaiters.shift();
          if (next) next();
          else this.revealActive -= 1;
        }
      })().finally(() => this.reveals.delete(identity));
      this.reveals.set(identity, operation);
    }
    return this.reveals.get(identity);
  }

  async discover(account, epoch, full) {
    const tokens = await this.service.site.tokens();
    if (!this.valid(account, epoch)) return;
    account.tokens = tokens.map(publicToken);
    account.error = undefined;
    const selected = account.selectedProviderIds.filter(id => this.directory().some(row => row.id === id));
    const locals = [];
    for (const id of selected) {
      const old = account.matches[id];
      try {
        const local = await this.resolve(id);
        if (!this.valid(account, epoch)) return;
        locals.push({ id, ...local, tokenIds: [], failed: false, previous: old?.tokenIds ?? [] });
        account.matches[id] = { state: old?.tokenIds?.length ? 'stale' : 'pending', tokenIds: old?.tokenIds ?? [] };
      } catch (error) {
        if (!this.valid(account, epoch)) return;
        account.matches[id] = { state: error.code === 'provider-unsupported' ? 'unsupported' : 'error', tokenIds: old?.tokenIds ?? [], error: error instanceof A6Error ? error.message : '提供商配置读取失败' };
      }
    }
    // A cold start first rechecks persisted relations; a user scan discovers all remaining tokens.
    const revealIds = full || locals.some(local => !local.previous.length)
      ? tokens.map(token => token.id) : [...new Set(locals.flatMap(local => local.previous))].filter(id => tokens.some(token => token.id === id));
    const queue = [...revealIds];
    const worker = async () => {
      while (queue.length && this.valid(account, epoch)) {
        const id = queue.shift();
        try {
          const key = await this.reveal(id, account);
          if (!this.valid(account, epoch)) return;
          for (const local of locals) if (local.value === key) local.tokenIds.push(id);
        } catch {
          for (const local of locals) local.failed = true;
        }
      }
    };
    if (locals.length) await Promise.all([worker(), worker()]);
    if (!this.valid(account, epoch)) return;
    for (const local of locals) {
      // Configuration may have changed without delivering an event to this instance.
      if (this.reference(local.id)?.stamp !== local.stamp) {
        account.matches[local.id] = { state: 'stale', tokenIds: local.previous };
        continue;
      }
      const ids = [...new Set(local.tokenIds)];
      account.matches[local.id] = {
        state: ids.length > 1 ? 'ambiguous' : ids.length === 1 ? 'exact' : local.failed ? 'error' : full ? 'unmatched' : 'stale',
        tokenIds: ids.length ? ids : local.failed ? local.previous : [],
        ...(local.failed ? { error: '部分令牌密钥未能核对，请刷新继续发现' } : {}),
      };
    }
    account.observedAt = Date.now();
    this.revision += 1;
    await this.persist(account);
  }

  async verifyTarget({ tokenId, providerId }, account) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw fail('invalid-token', '令牌 ID 无效');
    const epoch = this.epoch;
    const tokens = await this.service.site.tokens();
    if (!this.valid(account, epoch)) throw fail('account-changed', '账号或提供商配置已变更，请重新选择');
    const token = tokens.find(row => row.id === tokenId);
    assertUsableToken(token);
    if (providerId !== undefined) {
      if (!account.selectedProviderIds.includes(providerId)) throw fail('provider-not-selected', '请先在管理面板选择此提供商');
      const local = await this.resolve(providerId);
      const remote = await this.reveal(tokenId, account);
      if (!this.valid(account, epoch) || this.reference(providerId)?.stamp !== local.stamp) throw fail('provider-changed', '提供商配置已变更，请重新核对');
      if (local.value !== remote) {
        account.matches[providerId] = { state: 'stale', tokenIds: [], error: '当前凭据与此令牌不匹配' };
        this.revision += 1;
        await this.persist(account);
        throw fail('provider-mismatch', '当前提供商凭据与所选令牌不匹配');
      }
      const old = account.matches[providerId];
      const tokenIds = ['exact', 'ambiguous'].includes(old?.state)
        ? [...new Set([...(old.tokenIds ?? []), tokenId])] : [tokenId];
      account.matches[providerId] = { state: tokenIds.length > 1 ? 'ambiguous' : 'exact', tokenIds };
      this.revision += 1;
      await this.persist(account);
    }
    return token;
  }

  dispose() { this.disposed = true; this.invalidate(); }
}
