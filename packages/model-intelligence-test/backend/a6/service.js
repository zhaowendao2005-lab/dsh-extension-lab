/**
 * a6api specialised tests: credential configuration, token slots, and record creation.
 *
 * Automatic test slots use the user's selected token IDs. Explicit daily-provider association is
 * separate and resolves Host credentials per operation; it never changes the DSH configuration.
 */
import { A6Error } from './errors.js';
import { channelKey, channelOf } from './intake.js';
import { tokenIdentity } from './slots.js';
import { SITE_ORIGIN } from './site.js';
import { A6Providers, publicToken } from './providers.js';

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
    this.providers = new A6Providers(this);
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
    this.keyCache.clear(); this.keyFlights.clear(); this.providers.reset();
    try {
      this.site.configure(next);
      const verified = await this.site.verify();
      if (String(verified.account?.id) !== next.userId) throw new A6Error('account-mismatch', '访问令牌与用户 ID 不一致');
      await (await this.table()).put(CONFIG_KEY, { siteId: CONFIG_KEY, ...next });
      return { ok: true, ...(await this.config()), account: verified.account, pins: verified.pins };
    } catch (error) {
      this.site.configure(previous);
      this.generation += 1;
      this.providers.reset();
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

  providerState(input) { return this.providers.state(input); }
  providerConfigure(input) { return this.providers.configure(input); }
  invalidateProviders() { this.providers.invalidate(); }

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

  async targetSave(input) {
    await this.recordTarget(input);
    const account = await this.providers.ensure();
    const generation = this.generation;
    const epoch = this.providers.epoch;
    // Assign after validation starts but before IO: an old verification cannot replace a newer choice.
    this.targetVersions ??= new Map();
    const id = `${account.identity}:${input.model}`;
    const version = (this.targetVersions.get(id) ?? 0) + 1;
    this.targetVersions.set(id, version);
    await this.providers.verifyTarget(input, account);
    await this.recordTarget(input);
    if (generation !== this.generation || epoch !== this.providers.epoch || this.targetVersions.get(id) !== version) throw new A6Error('target-superseded', '目标选择已更新，请刷新');
    account.targets[input.model] = { tokenId: input.tokenId, ...(input.providerId === undefined ? {} : { providerId: input.providerId }) };
    this.providers.revision += 1;
    await this.providers.persist(account);
    return this.providers.snapshot(account);
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

  async putLease(key, lease) {
    await (await this.table()).put(`a6-lease:${key}`, { ...lease, siteId: 'a6-lease' });
    this.manualLeases.set(key, lease);
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
        lease.recordId === input.recordId && lease.model === input.model && lease.channelId === input.channelId);
      const original = candidates.find(lease => lease.tokenId === input.tokenId) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!original && candidates.length > 1) throw new A6Error('lease-ambiguous', '此结果有多个待恢复目标，请选择原令牌后恢复');
      if (original) input = { ...input, tokenId: original.tokenId };
    }
    return this.performAction(input, record.a6api, async () => {
      await this.recordTarget(input);
      if (input.operation === 'restore') return;
      const account = await this.providers.ensure();
      const target = account.targets[input.model];
      if (!target || target.tokenId !== input.tokenId || target.providerId !== input.providerId) {
        throw new A6Error('target-changed', '此模型的使用目标已变更，请重新选择');
      }
      await this.providers.verifyTarget(input, account);
      await this.recordTarget(input);
    });
  }

  async performAction(input, meta, validate) {
    if (!['pin', 'route', 'restore'].includes(input.operation)) throw new A6Error('invalid-operation', '只支持固定、加入路由与恢复');
    this.assertAvailable();
    this.assertRecordActive(input.recordId);
    this.assertAccount(meta);
    if (this.creating) throw new A6Error('slot-busy', '专项任务正在创建，请稍后重试');
    const generation = this.generation;
    const identity = tokenIdentity({ ...meta, siteOrigin: SITE_ORIGIN }, input.tokenId);
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该令牌正在执行任务，请等槽位空闲后再操作');
    await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
    const key = `${identity}:${input.model}`;
    const targetId = `${this.accountIdentity()}:${input.model}`;
    const targetVersion = this.targetVersions?.get(targetId);
    const providerEpoch = this.providers.epoch;
    const assertCurrent = () => {
      this.assertAvailable();
      this.assertRecordActive(input.recordId);
      if (input.recordId && input.operation !== 'restore' && (targetVersion !== this.targetVersions?.get(targetId) || providerEpoch !== this.providers.epoch)) {
        throw new A6Error('target-changed', '目标或提供商配置已变更，请重新选择');
      }
    };
    try {
      await this.loadLeases();
      await validate();
      assertCurrent();
      if (generation !== this.generation) throw new A6Error('account-changed', '账号已切换，请刷新');
      const lease = this.manualLeases.get(key);
      if (input.operation === 'restore') {
        if (!lease) return { ok: true, result: { skipped: true, operation: 'restore' } };
        if (lease.channelId !== input.channelId) throw new A6Error('lease-conflict', '当前固定租约属于其他渠道，请先恢复原目标');
        return await this.restoreLease(key, lease);
      }
      if (input.operation === 'route') {
        assertCurrent();
        const outcome = await this.site.addRoute({ tokenId: input.tokenId, model: input.model, channelId: input.channelId });
        if (outcome?.verified !== true) throw new A6Error('route-unverified', '未能读回路由新增结果');
        return { ok: true, result: outcome };
      }
      if (lease) throw new A6Error('already-pinned', '此目标尚有固定或恢复租约，请先恢复');
      const current = (await this.site.pins()).filter(pin => pin.tokenId === input.tokenId && pin.model === input.model);
      if (current.length > 1) throw new A6Error('pin-conflict', '站点固定关系不唯一，请先在站点处理');
      const previous = current[0] ?? null;
      if (previous && typeof previous.fallback !== 'boolean') {
        throw new A6Error('pin-conflict', '无法确认已有固定的智能兜底设置，未覆盖现有固定');
      }
      const target = {
        identity, accountId: String(meta.accountId), siteOrigin: SITE_ORIGIN,
        tokenId: input.tokenId, model: input.model, channelId: input.channelId,
        recordId: input.recordId ?? null, previous, fallback: false, stage: 'preparing', createdAt: Date.now(),
      };
      // A crash or ambiguous write failure must leave a durable recovery handle.
      await this.putLease(key, target);
      const before = (await this.site.pins()).filter(pin => pin.tokenId === input.tokenId && pin.model === input.model);
      if (previous ? before.length !== 1 || !this.samePin(before[0], previous) : before.length !== 0) {
        throw new A6Error('pin-conflict', '固定准备期间站点关系已变化，未执行覆盖且保留租约');
      }
      assertCurrent();
      const outcome = await this.site.pin({ tokenId: input.tokenId, model: input.model, channelId: input.channelId, fallback: false });
      if (!outcome.routeEffective) throw new A6Error('pin-unverified', '固定渠道未生效；已保留恢复租约，请先恢复');
      const observed = (await this.site.pins()).filter(pin => pin.tokenId === input.tokenId && pin.model === input.model);
      const pinned = observed[0];
      if (observed.length !== 1 || pinned.channelId !== input.channelId || pinned.fallback !== false || pinned.routeEffective !== true) {
        throw new A6Error('pin-unverified', '固定读回未确认，已保留恢复租约');
      }
      await this.putLease(key, { ...target, stage: 'pinned', supplierId: pinned.supplierId });
      return { ok: true, result: { verified: true, operation: 'pin', tokenId: input.tokenId, model: input.model, channelId: input.channelId, target: { tokenId: input.tokenId, model: input.model, channelId: input.channelId, supplierId: pinned.supplierId } } };
    } finally { this.engine.tokenSlots.release(identity); }
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

  async action(input) {
    await this.config();
    this.assertAvailable();
    const selection = this.selection(input.selectionId);
    this.assertAccount(selection);
    if (!selection.tokens.some(token => token.id === input.tokenId)) throw new A6Error('token-not-selected', '只能操作你选择的测试令牌');
    if (!selection.models.some(channel => channel.model === input.model && channel.channelId === input.channelId)) {
      throw new A6Error('invalid-selection', '目标不属于当前待测清单');
    }
    return this.performAction(input, selection, async () => this.assertAccount(selection));
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.keyCache.clear(); this.keyFlights.clear();
    this.providers.dispose();
  }
}
