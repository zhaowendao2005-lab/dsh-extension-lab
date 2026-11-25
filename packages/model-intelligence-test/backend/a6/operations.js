/** Account-scoped operation token metadata and relation snapshots. No key reveal or provider IO. */
import { A6Error } from './errors.js';

const mask = value => typeof value !== 'string' ? '' : /[*•]/u.test(value) ? value.slice(0, 100) : value.length > 12 ? `${value.slice(0, 3)}••••${value.slice(-4)}` : value ? '••••' : '';
export const publicToken = token => ({
  id: Number(token.id), name: String(token.name ?? `令牌 ${token.id}`).slice(0, 120), maskedKey: mask(token.maskedKey),
  ...(token.status === undefined ? {} : { status: token.status }),
  ...(token.expiredTime === undefined ? {} : { expiredTime: token.expiredTime }),
});

export function assertUsableToken(token) {
  if (!token) throw new A6Error('token-not-found', '该令牌已不属于当前账号，请刷新后重选');
  if (token.status !== undefined && ![1, '1', 'enabled', 'active'].includes(token.status)) {
    throw new A6Error('token-unavailable', '该令牌已停用、过期或额度不足');
  }
  if (Number(token.expiredTime) > 0 && Number(token.expiredTime) * 1000 <= Date.now()) {
    throw new A6Error('token-expired', '该令牌已过期，请重新选择');
  }
}

const idOf = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const messageOf = (error, fallback) => error instanceof A6Error ? error.message : fallback;
// Per-record storage keys must match /^[a-zA-Z0-9_-]+$/; raw origins contain ':' and '/'.
const storageKey = identity => `a6-operations-${Buffer.from(identity, 'utf8').toString('base64url')}`;
/** Must match the client's channelTestKey: JSON pair keeps model names with '|' unambiguous. */
const priceKey = (model, channelId) => JSON.stringify([model, channelId]);

export class A6Operations {
  constructor(service) {
    this.service = service;
    this.account = null;
    this.loading = null;
    this.epoch = 0;
    this.revision = 1;
    this.writeTail = Promise.resolve();
    this.channelCache = new Map();
    this.marketCache = new Map();
    this.billingCache = null;
    this.disposed = false;
  }

  invalidate() {
    this.epoch += 1;
    this.account = null;
    this.loading = null;
    this.revision += 1;
    this.channelCache.clear();
  }

  valid(account, epoch = this.epoch) {
    return !this.disposed && !this.service.disposed && !this.service.configSaving &&
      this.epoch === epoch && this.account === account && account.identity === this.service.accountIdentity();
  }

  assert(account) {
    this.service.assertAvailable();
    if (!this.valid(account)) throw new A6Error('account-changed', '账号已切换，请刷新');
  }

  async ensure() {
    this.service.assertAvailable();
    await this.service.config();
    this.service.assertAvailable();
    const identity = this.service.accountIdentity();
    if (this.account?.identity === identity) return this.account;
    if (!this.loading || this.loading.identity !== identity) {
      const epoch = this.epoch;
      const generation = this.service.generation;
      const task = (async () => {
        const table = await this.service.table();
        const stored = table.get(storageKey(identity)) ?? table.get(`a6-operations:${identity}`);
        if (this.disposed || epoch !== this.epoch || generation !== this.service.generation || identity !== this.service.accountIdentity()) {
          throw new A6Error('account-changed', '账号已切换，请刷新');
        }
        this.account = {
          identity, accountId: this.service.site.configured ? String(this.service.site.userId) : '',
          tokenId: idOf(stored?.tokenId), tokens: [], pins: [], routes: [],
          tokensAt: null, pinsAt: null, routesAt: null,
          attempted: { tokens: false, pins: false, routes: false }, errors: {}, flights: new Map(), activeWrites: new Map(),
          selectionVersion: 0, selectionRequestVersion: 0, writeVersion: { pins: 0, routes: 0 },
        };
        return this.account;
      })();
      this.loading = { identity, task };
    }
    return this.loading.task;
  }

  async persist(account) {
    const task = this.writeTail.catch(() => {}).then(async () => {
      this.assert(account);
      const table = await this.service.table();
      this.assert(account);
      try {
        await table.put(storageKey(account.identity), { siteId: 'a6-operations', tokenId: account.tokenId });
      } catch {
        throw new A6Error('operation-storage-failed', '操作 Key 选择保存失败，请检查本地存储后重试');
      }
    });
    this.writeTail = task;
    await task;
  }

  snapshot(account) {
    const loading = { tokens: false, pins: false, routes: false };
    for (const flight of account.flights.values()) if (flight.current()) loading[flight.kind] = true;
    for (const kind of ['pins', 'routes']) if (account.activeWrites.has(`${account.tokenId}:${kind}`)) loading[kind] = true;
    return {
      accountId: account.accountId, revision: this.revision, tokenId: account.tokenId,
      tokens: account.tokens.map(publicToken), tokensAt: account.tokensAt,
      pins: account.pins.map(row => ({ ...row })), routes: account.routes.map(row => ({ ...row, channelIds: [...row.channelIds] })),
      pinsAt: account.pinsAt, routesAt: account.routesAt, loading, errors: { ...account.errors },
      legacyLeases: [...this.service.manualLeases.values()]
        .filter(lease => lease.accountId === account.accountId)
        .map(lease => ({ recordId: lease.recordId ?? null, tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId, stage: lease.stage ?? 'pending' })),
    };
  }

  read(account, kind, suppliedRows, fromWrite = false) {
    this.assert(account);
    const activeWrite = kind === 'tokens' ? null : account.activeWrites.get(`${account.tokenId}:${kind}`);
    // The writer supplies the authoritative post-write snapshot before releasing this gate.
    if (activeWrite && !fromWrite) return activeWrite.promise;
    const epoch = this.epoch;
    const tokenId = account.tokenId;
    const selectionVersion = account.selectionVersion;
    const writeVersion = account.writeVersion[kind];
    const key = kind === 'tokens' ? `${kind}:${epoch}` : `${kind}:${epoch}:${selectionVersion}:${writeVersion}`;
    const existing = account.flights.get(key);
    if (existing) return existing.promise;
    if (kind !== 'tokens' && tokenId === null) return Promise.resolve();
    const current = () => this.valid(account, epoch) && (kind === 'tokens' ||
      account.tokenId === tokenId && account.selectionVersion === selectionVersion && account.writeVersion[kind] === writeVersion &&
      (fromWrite || !account.activeWrites.has(`${tokenId}:${kind}`)));
    account.attempted[kind] = true;
    const flight = { kind, current, promise: null };
    const promise = (async () => {
      try {
        const rows = await (suppliedRows ?? (kind === 'tokens' ? this.service.site.tokens() : kind === 'pins' ? this.service.site.pins() : this.service.site.subscriptions()));
        if (!Array.isArray(rows)) throw new A6Error('relations-invalid', '站点返回的关系列表格式无效');
        if (!current()) return;
        if (kind === 'tokens') {
          account.tokens = rows.map(publicToken).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id);
          if (account.tokenId !== null && !account.tokens.some(token => token.id === account.tokenId)) {
            account.errors.tokens = '已选操作令牌不在当前账号列表中，请重新选择';
          } else delete account.errors.tokens;
        } else if (kind === 'pins') {
          account.pins = rows.filter(row => Number(row.tokenId) === tokenId && idOf(row.channelId) && typeof row.model === 'string')
            .map(row => ({ model: row.model, channelId: Number(row.channelId), routeEffective: row.routeEffective === true, status: String(row.status ?? '') }));
          delete account.errors.pins;
        } else {
          const routes = new Map();
          for (const row of rows) {
            if (Number(row.token_id ?? row.tokenId) !== tokenId) continue;
            const model = row.model_name ?? row.model;
            if (typeof model !== 'string' || !Array.isArray(row.channels)) continue;
            const channels = routes.get(model) ?? new Set();
            for (const item of row.channels) {
              const id = idOf(typeof item === 'number' || typeof item === 'string' ? item : item?.channel_id ?? item?.id);
              if (id !== null) channels.add(id);
            }
            routes.set(model, channels);
          }
          account.routes = [...routes].map(([model, ids]) => ({ model, channelIds: [...ids] }));
          delete account.errors.routes;
        }
        account[`${kind}At`] = Date.now();
      } catch (error) {
        if (current()) account.errors[kind] = messageOf(error, '站点读取失败，请显式刷新重试');
      } finally {
        if (account.flights.get(key) === flight) account.flights.delete(key);
        this.revision += 1;
      }
    })();
    flight.promise = promise;
    account.flights.set(key, flight);
    this.revision += 1;
    return promise;
  }

  async settle(account) {
    while (true) {
      this.assert(account);
      const tasks = [...account.flights.values()].filter(flight => flight.current()).map(flight => flight.promise);
      for (const kind of ['pins', 'routes']) {
        const write = account.activeWrites.get(`${account.tokenId}:${kind}`);
        if (write) tasks.push(write.promise);
      }
      if (!tasks.length) return;
      await Promise.all(tasks);
    }
  }

  pending(account, kind) {
    return [...account.flights.values()].some(flight => flight.kind === kind && flight.current());
  }

  async state({ refreshTokens = false, refreshRelations = false } = {}) {
    const account = await this.ensure();
    await this.service.loadLeases();
    this.assert(account);
    if (!account.accountId) {
      account.errors.tokens = '请先配置 a6api 账号';
      return this.snapshot(account);
    }
    const tasks = [];
    if (refreshTokens || !account.attempted.tokens || this.pending(account, 'tokens')) tasks.push(this.read(account, 'tokens'));
    if (account.tokenId !== null) for (const kind of ['pins', 'routes']) {
      if (refreshRelations || !account.attempted[kind] || this.pending(account, kind)) tasks.push(this.read(account, kind));
    }
    await Promise.all(tasks);
    await this.settle(account);
    this.assert(account);
    return this.snapshot(account);
  }

  async select({ tokenId } = {}) {
    if (tokenId !== null && (!Number.isSafeInteger(tokenId) || tokenId <= 0)) throw new A6Error('invalid-token', '操作令牌 ID 无效');
    const account = await this.ensure();
    if (!account.accountId) throw new A6Error('auth-missing', '请先配置 a6api 账号');
    const requestVersion = ++account.selectionRequestVersion;
    if (tokenId !== null) {
      if (!account.attempted.tokens || !account.tokens.some(token => token.id === tokenId)) await this.read(account, 'tokens');
      this.assert(account);
      if (requestVersion !== account.selectionRequestVersion) throw new A6Error('token-superseded', '操作令牌选择已更新');
      assertUsableToken(account.tokens.find(token => token.id === tokenId));
    }
    const previousTokenId = account.tokenId;
    const selectionVersion = ++account.selectionVersion;
    account.tokenId = tokenId;
    account.pins = []; account.routes = [];
    account.pinsAt = null; account.routesAt = null;
    account.attempted.pins = false; account.attempted.routes = false;
    delete account.errors.pins; delete account.errors.routes;
    this.revision += 1;
    try { await this.persist(account); }
    catch (error) {
      if (this.valid(account) && account.selectionVersion === selectionVersion) {
        account.tokenId = previousTokenId;
        account.selectionVersion += 1;
        account.pins = []; account.routes = [];
        account.pinsAt = null; account.routesAt = null;
        account.attempted.pins = false; account.attempted.routes = false;
        this.revision += 1;
      }
      throw error;
    }
    this.assert(account);
    if (selectionVersion !== account.selectionVersion) throw new A6Error('token-superseded', '操作令牌选择已更新');
    return this.state();
  }

  /**
   * Read-only binding view for one key: pins (fixed) plus routing pools (subscriptions).
   * Both site calls are account-wide, so one round trip serves every key; nothing is persisted.
   */
  async channels({ tokenId, refresh = false } = {}) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error('invalid-token', 'Key ID 无效');
    this.service.assertAvailable();
    await this.service.config();
    this.service.assertAvailable();
    if (!this.service.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    const identity = `${this.service.accountIdentity()}:${tokenId}`;
    const cached = this.channelCache.get(identity);
    if (!refresh && cached && cached.until > Date.now()) return { ...cached.value, cached: true };
    const [pins, subscriptions] = await Promise.all([this.service.site.pins(), this.service.site.subscriptions()]);
    this.service.assertAvailable();
    const rows = new Map();
    const row = (model, channelId) => {
      const key = `${model}|${channelId}`;
      let item = rows.get(key);
      if (!item) {
        item = { model, channelId, supplierId: 0, pinned: false, routed: false, routeEffective: false, poolSize: 0, status: '' };
        rows.set(key, item);
      }
      return item;
    };
    for (const pin of pins) {
      if (Number(pin.tokenId) !== tokenId) continue;
      const model = typeof pin.model === 'string' ? pin.model : '';
      const channelId = Number(pin.channelId);
      if (!model || !Number.isSafeInteger(channelId) || channelId <= 0) continue;
      const item = row(model, channelId);
      item.pinned = true;
      item.supplierId = Number(pin.supplierId) || item.supplierId;
      item.routeEffective = item.routeEffective || pin.routeEffective === true;
      if (typeof pin.status === 'string') item.status = pin.status;
    }
    for (const subscription of subscriptions) {
      if (Number(subscription?.token_id) !== tokenId) continue;
      const model = typeof (subscription.model_name ?? subscription.model) === 'string' ? (subscription.model_name ?? subscription.model) : '';
      const channels = (Array.isArray(subscription.channels) ? subscription.channels : [])
        .map(item => Number(typeof item === 'number' ? item : item?.channel_id ?? item?.id))
        .filter(channelId => Number.isSafeInteger(channelId) && channelId > 0);
      if (!model || !channels.length) continue;
      for (const channelId of channels) {
        const item = row(model, channelId);
        item.routed = true;
        item.poolSize = Math.max(item.poolSize, channels.length);
      }
    }
    const value = {
      tokenId,
      channels: [...rows.values()].sort((a, b) => a.model.localeCompare(b.model, 'zh-CN') || a.channelId - b.channelId),
      generatedAt: Date.now(),
    };
    this.channelCache.set(identity, { value, until: Date.now() + 30_000 });
    if (this.channelCache.size > 200) for (const [key, item] of this.channelCache) if (item.until <= Date.now()) this.channelCache.delete(key);
    return value;
  }

  async refresh({ kind = 'all' } = {}) {
    if (!['pins', 'routes', 'all'].includes(kind)) throw new A6Error('invalid-refresh', '刷新类型无效');
    const account = await this.ensure();
    await this.service.loadLeases();
    if (!account.accountId) throw new A6Error('auth-missing', '请先配置 a6api 账号');
    await Promise.all((kind === 'all' ? ['pins', 'routes'] : [kind]).map(item => this.read(account, item)));
    await this.settle(account);
    this.assert(account);
    return this.snapshot(account);
  }

  assertSelected(account, tokenId, selectionVersion = account.selectionVersion) {
    this.assert(account);
    if (account.tokenId !== tokenId || account.selectionVersion !== selectionVersion) throw new A6Error('token-changed', '操作令牌已变更，请重试');
    assertUsableToken(account.tokens.find(token => token.id === tokenId));
  }

  async removeRoute({ tokenId, model, channelId } = {}) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error('invalid-token', 'Key ID 无效');
    this.service.assertAvailable();
    if (!this.service.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    const result = await this.service.site.removeRoute({ tokenId, model, channelId });
    this.channelCache.clear();
    return result;
  }

  /** Public market rows for one channel, cached far longer than the pin/route view (prices move slowly). */
  async marketRows(channelId, refresh = false) {
    const cached = this.marketCache.get(channelId);
    if (!refresh && cached && cached.until > Date.now()) return cached.rows;
    const rows = await this.service.site.marketChannels({ channelId });
    this.marketCache.set(channelId, { rows, until: Date.now() + 10 * 60_000 });
    if (this.marketCache.size > 500) for (const [key, item] of this.marketCache) if (item.until <= Date.now()) this.marketCache.delete(key);
    return rows;
  }

  async billing() {
    if (this.billingCache && this.billingCache.until > Date.now()) return this.billingCache;
    const value = await this.service.site.billingSettings();
    this.billingCache = { ...value, until: Date.now() + 10 * 60_000 };
    return this.billingCache;
  }

  /** The site's own listed price for every channel of this key; unknown stays absent, never zero. */
  async channelPrices({ tokenId, refresh = false } = {}) {
    const view = await this.channels({ tokenId });
    const channels = [...new Map(view.channels.map(channel => [channel.channelId, channel])).values()];
    const prices = {};
    let failures = 0;
    await Promise.all(channels.map(async channel => {
      try {
        const rows = (await this.marketRows(channel.channelId, refresh)).filter(row => row.model === channel.model);
        if (!rows.length) return;
        const available = rows.filter(row => row.availability === undefined || row.availability === 1);
        const pool = available.length ? available : rows;
        const pick = pool.reduce((best, row) => best === null || (row.input ?? Infinity) < (best.input ?? Infinity) ? row : best, null);
        prices[priceKey(channel.model, channel.channelId)] = { currency: pick.currency ?? null, unit: pick.unit ?? null, chargeType: pick.chargeType ?? null,
          input: pick.input ?? null, output: pick.output ?? null, cacheRead: pick.cacheRead ?? null, cacheWrite: pick.cacheWrite ?? null, perRequest: pick.perRequest ?? null };
      } catch { failures += 1; }
    }));
    let exchangeRate = null;
    if (Object.values(prices).some(price => price.currency === 'USD')) {
      try { exchangeRate = (await this.billing()).usdExchangeRate ?? null; } catch { exchangeRate = null; }
    }
    this.service.assertAvailable();
    return { tokenId, prices, exchangeRate, generatedAt: Date.now(), error: failures ? `有 ${failures} 个渠道的市场报价未能读取` : null };
  }

  /** Bind one channel to one key for one model, then verify the site reports it as the route. */
  async pin({ tokenId, model, channelId } = {}) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error('invalid-token', 'Key ID 无效');
    this.service.assertAvailable();
    if (!this.service.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    const identity = `${this.service.accountIdentity()}:${tokenId}`;
    if (this.service.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该 Key 正在执行测试，结束后再绑定');
    await this.service.loadLeases();
    if (this.service.manualLeases.has(`${identity}:${model}`)) throw new A6Error('lease-held', '此模型还有待恢复的旧固定租约，请先恢复');
    const outcome = await this.service.site.pin({ tokenId, model, channelId, fallback: false });
    const pins = await this.service.site.pins();
    const current = pins.find(item => item.tokenId === tokenId && item.model === model && item.channelId === channelId);
    if (!current) throw new A6Error('pin-unverified', '未能读回固定结果，请刷新后检查');
    this.channelCache.clear();
    return { verified: true, tokenId, model, channelId, supplierId: current.supplierId ?? outcome.supplierId ?? 0, routeEffective: current.routeEffective === true };
  }

  async unpin({ tokenId, model, channelId } = {}) {
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error('invalid-token', 'Key ID 无效');
    this.service.assertAvailable();
    if (!this.service.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    const identity = `${this.service.accountIdentity()}:${tokenId}`;
    if (this.service.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该 Key 正在执行测试，结束后再取消固定');
    await this.service.loadLeases();
    if (this.service.manualLeases.has(`${identity}:${model}`)) throw new A6Error('lease-held', '此模型还有待恢复的旧固定租约，请先恢复');
    await this.service.site.unpin({ tokenId, model, channelId });
    const pins = await this.service.site.pins();
    if (pins.some(pin => pin.tokenId === tokenId && pin.model === model && pin.channelId === channelId)) throw new A6Error('unpin-unverified', '未能读回取消固定结果，请刷新后检查');
    this.channelCache.clear();
    return { verified: true, tokenId, model, channelId };
  }

  invalidateRelation(account, kind) {
    account.writeVersion[kind] += 1;
    account[kind] = [];
    account[`${kind}At`] = null;
    account.attempted[kind] = false;
    delete account.errors[kind];
    this.revision += 1;
  }

  /** Block ordinary reads for this token until its write and authoritative readback finish. */
  beginWrite(account, kind, context) {
    this.assert(account);
    const tokenId = context?.tokenId ?? account.tokenId;
    const key = `${tokenId}:${kind}`;
    if (account.activeWrites.has(key)) throw new A6Error('slot-busy', '该令牌的站点关系正在修改');
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    account.activeWrites.set(key, { promise, resolve });
    if (account.tokenId === tokenId) this.invalidateRelation(account, kind);
  }

  async afterWrite(account, kind, context, rows) {
    const key = `${context?.tokenId ?? account.tokenId}:${kind}`;
    const gate = account.activeWrites.get(key);
    try {
      if (!this.valid(account)) return;
      // A->B->A must refresh the current A selection; B must never receive A's snapshot.
      if (context && account.tokenId !== context.tokenId) return;
      this.invalidateRelation(account, kind);
      await this.read(account, kind, rows, true);
    } finally {
      if (account.activeWrites.get(key) === gate) account.activeWrites.delete(key);
      gate?.resolve();
      this.revision += 1;
    }
  }

  dispose() { this.disposed = true; this.invalidate(); }
}
