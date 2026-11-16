/**
 * a6api specialised tests: credential configuration, token slots, and record creation.
 *
 * Automatic test slots use the user's selected test token IDs. Daily result actions use one
 * account-level operation token and metadata only; they never inspect DSH providers or API keys.
 */
import { A6Error } from './errors.js';
import { channelKey, channelOf } from './intake.js';
import { tokenIdentity } from './slots.js';
import { SITE_ORIGIN } from './site.js';
import { A6Operations, publicToken } from './operations.js';

const CONFIG_KEY = 'a6-site';
const KEY_TTL_MS = 10 * 60_000;

export class A6Service {
  constructor({ ctx, storage, records, intake, site, engine }) {
    Object.assign(this, { ctx, storage, records, intake, site, engine });
    this.manualLeases = new Map();
    this.deletingRecords = new Set();
    this.clearInProgress = false;
    this.keyCache = new Map();
    this.keyFlights = new Map();
    this.generation = 0;
    this.configSaving = false;
    this.creating = 0;
    this.disposed = false;
    this.operations = new A6Operations(this);
  }

  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new A6Error('storage-unavailable', '专项配置存储不可用');
    return domain.table('auth');
  }

  // ---- access token --------------------------------------------------------------------------
  async config() {
    await this.intake.ready;
    const row = (await this.table()).get(CONFIG_KEY);
    // Credentials are restored into the client on boot but never echoed; only a mask is returned.
    if (row?.accessToken && !this.site.configured) this.site.configure({ accessToken: row.accessToken, userId: row.userId });
    return {
      configured: this.site.configured,
      mask: this.site.mask,
      userId: this.site.userId,
      intakeToken: this.intake.token,
      origin: this.intake.origin ?? '',
      userscript: await this.intake.scriptInfo(),
    };
  }

  async saveConfig({ accessToken, userId }) {
    await this.config();
    if (this.configSaving || this.creating || this.engine.starting || this.engine.tokenSlots.busy.size ||
        [...this.engine.jobs.values()].some(job => job.a6api && job.status === 'running')) {
      throw new A6Error('account-busy', '专项任务或令牌操作正在执行，请结束后再切换账号凭据');
    }
    const previous = { accessToken: this.site.accessToken, userId: this.site.userId };
    const next = {
      accessToken: typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : previous.accessToken,
      userId: userId === undefined ? previous.userId : String(userId ?? '').trim(),
    };
    if (!next.accessToken) throw new A6Error('auth-missing', '请填写 a6api 访问令牌');
    if (!next.userId) throw new A6Error('auth-user-id-missing', '请填写 a6api 用户 ID');
    this.configSaving = true;
    this.generation += 1;
    this.keyCache.clear(); this.keyFlights.clear(); this.operations.invalidate();
    try {
      this.site.configure(next);
      const verified = await this.site.verify();
      if (String(verified.account?.id) !== next.userId) throw new A6Error('account-mismatch', '访问令牌与用户 ID 不一致');
      await (await this.table()).put(CONFIG_KEY, { siteId: CONFIG_KEY, ...next });
      return { ok: true, ...(await this.config()), account: verified.account, pins: verified.pins };
    } catch (error) {
      this.site.configure(previous);
      this.generation += 1;
      this.operations.invalidate();
      throw error;
    } finally { this.configSaving = false; }
  }

  async rotateIntake() {
    await this.intake.rotate();
    return this.config();
  }

  // ---- test keys -----------------------------------------------------------------------------
  accountIdentity() { return `${SITE_ORIGIN}:${this.site.configured ? this.site.userId : ''}`; }

  assertAvailable() {
    if (this.disposed) throw new A6Error('disposed', '插件正在卸载');
    if (this.configSaving) throw new A6Error('account-busy', '账号凭据正在切换，请稍后重试');
  }

  /** Account/generation-scoped cache for the automatic sampling lane only. */
  async key(tokenId) {
    this.assertAvailable();
    const generation = this.generation;
    const identity = `${this.accountIdentity()}:${generation}:${tokenId}`;
    const cached = this.keyCache.get(identity);
    if (cached && cached.until > Date.now()) return cached.key;
    if (!this.keyFlights.has(identity)) {
      const flight = this.site.tokenKey(tokenId).then(key => {
        if (generation !== this.generation || this.disposed) throw new A6Error('account-changed', '账号凭据已切换');
        this.keyCache.set(identity, { key, until: Date.now() + KEY_TTL_MS });
        return key;
      }).finally(() => this.keyFlights.delete(identity));
      this.keyFlights.set(identity, flight);
    }
    return this.keyFlights.get(identity);
  }

  async tokens() {
    if (!this.site.configured) await this.config();
    this.assertAvailable();
    if (!this.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    return { tokens: (await this.site.tokens()).map(publicToken) };
  }

  operationState(input) { return this.operations.state(input); }
  operationSelect(input) { return this.operations.select(input); }
  operationRefresh(input) { return this.operations.refresh(input); }
  invalidateOperations() { this.operations.invalidate(); }

  assertRecordActive(recordId) {
    if (this.clearInProgress) throw new A6Error('records-clearing', '记录正在清空，请稍后重试');
    if (this.deletingRecords.has(recordId)) throw new A6Error('record-deleting', '此记录正在删除，请稍后重试');
  }

  /** Keep a record reachable until every daily pin associated with it is restored. */
  async removeRecord(recordId) {
    this.assertRecordActive(recordId);
    // Publish synchronously, before either domain or lease loading can yield to an operation.
    this.deletingRecords.add(recordId);
    try {
      const domain = await this.records.domain();
      const record = domain.table('records').get(recordId);
      if (record?.a6api) {
        await this.loadLeases();
        if ([...this.manualLeases.values()].some(lease => lease.recordId === recordId)) {
          throw new A6Error('record-has-lease', '此记录仍有日常固定或待恢复租约，请先恢复后再删除');
        }
        // An action may already have passed record validation and be awaiting a pin/readback.
        if (this.engine.tokenSlots.busy.size) {
          throw new A6Error('record-busy', '令牌槽位仍在执行操作，请结束或恢复后再删除专项记录');
        }
      }
      return await this.records.remove(recordId);
    } finally { this.deletingRecords.delete(recordId); }
  }

  async clearRecords() {
    this.assertRecordActive();
    if (this.deletingRecords.size || this.creating) throw new A6Error('records-busy', '记录正在创建或删除，请稍后清空');
    // Fence new operations before loading either the record snapshot or durable leases.
    this.clearInProgress = true;
    try {
      const domain = await this.records.domain();
      const entries = [...domain.table('records').entries()];
      const ids = new Set(entries.map(([id]) => id));
      await this.loadLeases();
      if ([...this.manualLeases.values()].some(lease => ids.has(lease.recordId))) {
        throw new A6Error('records-have-leases', '记录中仍有日常固定或待恢复租约，请先恢复后再清空');
      }
      if (entries.some(([, record]) => record?.a6api) && this.engine.tokenSlots.busy.size) {
        throw new A6Error('records-busy', '令牌槽位仍在执行操作，请结束或恢复后再清空专项记录');
      }
      return await this.records.clear();
    } finally { this.clearInProgress = false; }
  }

  async recordTarget(input) {
    this.assertRecordActive(input.recordId);
    this.assertAvailable();
    await this.config();
    this.assertAvailable();
    const domain = await this.records.domain();
    const record = domain.table('records').get(input.recordId);
    this.assertRecordActive(input.recordId);
    if (!record?.a6api) throw new A6Error('record-not-found', '专项记录不存在或已删除');
    this.assertAccount(record.a6api);
    if (!record.models.some(row => row.id === input.model && row.a6api?.model === input.model &&
        (input.channelId === undefined || row.a6api.channelId === input.channelId))) {
      throw new A6Error('invalid-selection', '模型或渠道不属于此专项记录');
    }
    return record;
  }

  assertAccount(meta) {
    if (!this.site.configured || String(meta.accountId) !== String(this.site.userId) || ![SITE_ORIGIN, 'https://www.a6api.vip'].includes(meta.siteOrigin)) {
      throw new A6Error('account-mismatch', '当前 a6api 账号与记录来源不同，请切换到原账号');
    }
  }

  // ---- selections ----------------------------------------------------------------------------
  selections(request) {
    return this.intake.list(request?.revision);
  }

  selection(id) {
    return this.intake.selection(id);
  }

  slots(selection, input) {
    if (!Array.isArray(input) || !input.length) throw new A6Error('invalid-slots', '请至少选择一个测试槽位');
    const seen = new Set();
    return input.map(slot => {
      const token = selection.tokens.find(item => item.id === slot.tokenId);
      if (!token || seen.has(slot.tokenId)) throw new A6Error('invalid-slots', '测试令牌未选择或重复');
      seen.add(slot.tokenId);
      return { tokenId: token.id, name: token.name };
    });
  }

  async create(input) {
    this.assertRecordActive();
    this.assertAvailable();
    await this.config();
    this.assertRecordActive();
    this.assertAvailable();
    const selection = this.selection(input.selectionId);
    this.assertAccount(selection);
    this.creating += 1;
    try {
      const slots = this.slots(selection, input.slots);
      const allowed = new Map(selection.models.map(channel => [channelKey(channel), channel]));
      const requested = input.models ? input.models.map(channelOf) : selection.models;
      if (!requested.length || requested.length > 64 || requested.some(model => !allowed.has(channelKey(model)))) {
        throw new A6Error('invalid-selection', '待测项不属于网页选择或数量无效');
      }
      const channels = requested.map(model => allowed.get(channelKey(model)));
      if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error('invalid-selection', '待测清单重复');
      // Daily pins are never silently removed to make room for automatic tests.
      await this.releaseManual(selection, slots);
      this.assertRecordActive();
      const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: SITE_ORIGIN, slots };
      return await this.records.create({
        kind: 'fingerprint', name: input.name || 'a6api 专项指纹', a6api,
        options: { timeoutMs: input.timeoutMs ?? 180_000, concurrency: slots.length },
        models: channels.map(channel => ({
          // Stable identity is the tested channel, not the worker that happens to claim it.
          provider: `a6api:${channel.channelId}:${channel.supplierId}`, id: channel.model, name: channel.model,
          a6api: channel,
          relay: { siteId: 'a6api', channelId: channel.channelId, supplierId: channel.supplierId, listingId: channel.listingId, model: channel.model, api: channel.model && /claude|anthropic/i.test(`${channel.brand} ${channel.model}`) ? 'messages' : 'chat' },
        })),
      });
    } finally { this.creating -= 1; }
  }

  async loadLeases() {
    if (!this.leasesReady) this.leasesReady = (async () => {
      const table = await this.table();
      for (const [key, lease] of table.entries()) {
        if (key.startsWith('a6-lease:') && lease?.identity && lease?.model) this.manualLeases.set(key.slice('a6-lease:'.length), lease);
      }
    })();
    return this.leasesReady;
  }

  async deleteLease(key) {
    await (await this.table()).delete(`a6-lease:${key}`);
    this.manualLeases.delete(key);
  }

  async releaseManual(selection, slots) {
    await this.loadLeases();
    const identities = new Set(slots.map(slot => tokenIdentity({ ...selection, siteOrigin: SITE_ORIGIN }, slot.tokenId)));
    if ([...this.manualLeases.values()].some(lease => identities.has(lease.identity))) {
      throw new A6Error('lease-held', '测试令牌仍有日常固定或待恢复租约，请先显式恢复，或改用专用测试令牌');
    }
    const pins = await this.site.pins();
    if (pins.some(pin => slots.some(slot => slot.tokenId === pin.tokenId))) {
      throw new A6Error('pin-conflict', '测试令牌已有站点固定，请先在原处恢复，或选择专用测试令牌');
    }
  }

  /** Called by the engine under its token lock, including retries of historical records. */
  async assertTestSlot(tokenId, meta) {
    this.assertRecordActive();
    this.assertAvailable();
    await this.config();
    this.assertAvailable();
    if (!meta) throw new A6Error('account-missing', '测试槽位缺少账号身份，拒绝修改固定');
    this.assertAccount(meta);
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw new A6Error('invalid-token', '测试令牌 ID 无效');
    await this.releaseManual(meta, [{ tokenId }]);
  }

  async resultAction(input) {
    const record = await this.recordTarget(input);
    if (input.operation === 'restore') {
      await this.loadLeases();
      const candidates = [...this.manualLeases.values()].filter(lease =>
        lease.accountId === String(record.a6api.accountId) && lease.siteOrigin === SITE_ORIGIN &&
        (lease.recordId === input.recordId || lease.recordId == null) && lease.model === input.model && lease.channelId === input.channelId);
      const original = candidates.find(lease => lease.tokenId === input.tokenId) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!original && candidates.length > 1) throw new A6Error('lease-ambiguous', '此结果有多个待恢复目标，请选择原令牌后恢复');
      if (original) input = { ...input, tokenId: original.tokenId };
    }
    return this.performAction(input, record.a6api, async () => this.recordTarget(input));
  }

  async performAction(input, meta, validate) {
    if (!['pin', 'route', 'restore'].includes(input.operation)) throw new A6Error('invalid-operation', '只支持固定、加入路由与旧租约恢复');
    this.assertAvailable();
    this.assertRecordActive(input.recordId);
    this.assertAccount(meta);
    if (this.creating) throw new A6Error('slot-busy', '专项任务正在创建，请稍后重试');
    const generation = this.generation;
    const identity = tokenIdentity({ ...meta, siteOrigin: SITE_ORIGIN }, input.tokenId);
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该令牌正在执行任务，请等槽位空闲后再操作');
    await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
    const key = `${identity}:${input.model}`;
    let account;
    let selectionVersion;
    const assertCurrent = () => {
      this.assertAvailable();
      this.assertRecordActive(input.recordId);
      this.assertAccount(meta);
      if (generation !== this.generation) throw new A6Error('account-changed', '账号已切换，请刷新');
      if (input.operation !== 'restore') this.operations.assertSelected(account, input.tokenId, selectionVersion);
    };
    const relationKind = input.operation === 'route' ? 'routes' : 'pins';
    let written = false;
    try {
      await this.loadLeases();
      await validate();
      const lease = this.manualLeases.get(key);
      if (input.operation === 'restore') {
        assertCurrent();
        if (!lease) return { ok: true, result: { skipped: true, operation: 'restore' }, state: await this.operationState() };
        if (lease.channelId !== input.channelId) throw new A6Error('lease-conflict', '当前旧固定租约属于其他渠道，请先恢复原目标');
        account = await this.operations.ensure();
        selectionVersion = account.selectionVersion;
        this.operations.beginWrite(account, relationKind, { tokenId: input.tokenId, selectionVersion });
        written = true;
        const outcome = await this.restoreLease(key, lease);
        await this.operations.afterWrite(account, relationKind, { tokenId: input.tokenId, selectionVersion });
        written = false;
        return { ...outcome, state: this.operations.snapshot(account) };
      }
      account = await this.operations.ensure();
      if (!account.attempted.tokens) await this.operations.read(account, 'tokens');
      selectionVersion = account.selectionVersion;
      assertCurrent();
      if (input.operation === 'pin' && lease) throw new A6Error('lease-held', '此模型仍有旧固定恢复租约，请先恢复旧租约后再设置固定');
      // Invalidate every relation read started before this write. New pins are permanent settings,
      // so neither a previous-channel snapshot nor a new recovery lease is created here.
      this.operations.beginWrite(account, relationKind, { tokenId: input.tokenId, selectionVersion });
      assertCurrent();
      written = true;
      const outcome = input.operation === 'pin'
        ? await this.site.pin({ tokenId: input.tokenId, model: input.model, channelId: input.channelId, fallback: false })
        : await this.site.addRoute({ tokenId: input.tokenId, model: input.model, channelId: input.channelId });
      await this.operations.afterWrite(account, relationKind, { tokenId: input.tokenId, selectionVersion }, input.operation === 'pin' ? outcome.pins : outcome.subscriptions);
      written = false;
      if (account.selectionVersion !== selectionVersion) throw new A6Error('token-changed', '操作期间令牌选择已变更，请检查当前令牌的最新关系');
      if (input.operation === 'pin') {
        const pins = account.pins.filter(pin => pin.model === input.model);
        if (!outcome?.routeEffective || account.tokenId !== input.tokenId || account.errors.pins ||
            pins.length !== 1 || pins[0].channelId !== input.channelId || pins[0].routeEffective !== true) {
          throw new A6Error('pin-unverified', '站点固定读回未确认，请刷新固定关系检查实际状态');
        }
      } else if (outcome?.verified !== true || account.tokenId !== input.tokenId || account.errors.routes ||
          !account.routes.some(route => route.model === input.model && route.channelIds.includes(input.channelId))) {
        throw new A6Error('route-unverified', '站点路由读回未确认，请刷新路由关系检查实际状态');
      }
      return { ok: true, result: { verified: true, operation: input.operation, tokenId: input.tokenId, model: input.model, channelId: input.channelId, ...(input.operation === 'pin' ? { supplierId: outcome.supplierId } : { subscriptionId: outcome.subscriptionId }) }, state: this.operations.snapshot(account) };
    } finally {
      try { if (written && account) await this.operations.afterWrite(account, relationKind, { tokenId: input.tokenId, selectionVersion }); }
      finally { this.engine.tokenSlots.release(identity); }
    }
  }

  samePin(actual, expected) {
    return Boolean(actual && expected && actual.channelId === expected.channelId &&
      (expected.supplierId === undefined || actual.supplierId === expected.supplierId) &&
      (expected.fallback === undefined || actual.fallback === expected.fallback));
  }

  async restoreLease(key, lease) {
    const pins = (await this.site.pins()).filter(pin => pin.tokenId === lease.tokenId && pin.model === lease.model);
    if (pins.length > 1) throw new A6Error('lease-conflict', '站点固定关系不唯一，保留恢复租约');
    const current = pins[0] ?? null;
    // An interrupted restore may already have finished. Never repeat it over an external change.
    if ((!current && !lease.previous) || this.samePin(current, lease.previous)) {
      await this.deleteLease(key);
      return { ok: true, result: { restored: true, operation: 'restore', tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId } };
    }
    if (!this.samePin(current, lease)) throw new A6Error('lease-conflict', '站点固定已被外部修改，未覆盖修改且保留恢复租约');
    if (lease.previous) {
      const outcome = await this.site.pin({ tokenId: lease.tokenId, model: lease.model, channelId: lease.previous.channelId, fallback: lease.previous.fallback });
      if (!outcome.routeEffective) throw new A6Error('restore-unverified', '原固定恢复未生效，保留租约');
    } else {
      await this.site.unpin({ tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId });
    }
    const after = (await this.site.pins()).filter(pin => pin.tokenId === lease.tokenId && pin.model === lease.model);
    if (lease.previous ? after.length !== 1 || !this.samePin(after[0], lease.previous) : after.length !== 0) {
      throw new A6Error('restore-unverified', '恢复读回不一致，保留租约');
    }
    await this.deleteLease(key);
    return { ok: true, result: { restored: true, operation: 'restore', tokenId: lease.tokenId, model: lease.model, channelId: lease.channelId } };
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.keyCache.clear(); this.keyFlights.clear();
    this.operations.dispose();
  }
}
