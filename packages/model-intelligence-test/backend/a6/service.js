/**
 * a6api specialised tests: credential configuration, token slots, and record creation.
 *
 * User decisions are authoritative — no key matching, no endpoint interrogation, no provider
 * mutation. The account access token only ever lives in Host storage; the client sees a mask.
 */
import { A6Error } from './errors.js';
import { channelKey, channelOf } from './intake.js';
import { tokenIdentity } from './slots.js';

const CONFIG_KEY = 'a6-site';
const KEY_TTL_MS = 10 * 60_000;

export class A6Service {
  constructor({ ctx, storage, records, intake, site, engine }) {
    Object.assign(this, { ctx, storage, records, intake, site, engine });
    this.manualLeases = new Map();
    this.keyCache = new Map();
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
    };
  }

  async saveConfig({ accessToken, userId }) {
    const next = {
      accessToken: typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : this.site.accessToken,
      userId: userId === undefined ? this.site.userId : String(userId ?? '').trim(),
    };
    if (!next.accessToken) throw new A6Error('auth-missing', '请填写 a6api 访问令牌');
    if (!next.userId) throw new A6Error('auth-user-id-missing', '请填写 a6api 用户 ID');
    this.site.configure(next);
    let verified;
    try { verified = await this.site.verify(); }
    catch (error) { this.site.configure({ accessToken: '', userId: '' }); throw error; }
    await (await this.table()).put(CONFIG_KEY, { siteId: CONFIG_KEY, ...next });
    return { ok: true, ...(await this.config()), account: verified.account, pins: verified.pins };
  }

  async rotateIntake() {
    await this.intake.rotate();
    return this.config();
  }

  // ---- test keys -----------------------------------------------------------------------------
  /** Plaintext key for one token, cached briefly so a whole run reuses one lookup. */
  async key(tokenId) {
    const cached = this.keyCache.get(tokenId);
    if (cached && cached.until > Date.now()) return cached.key;
    const key = await this.site.tokenKey(tokenId);
    this.keyCache.set(tokenId, { key, until: Date.now() + KEY_TTL_MS });
    return key;
  }

  async tokens() {
    if (!this.site.configured) await this.config();
    if (!this.site.configured) throw new A6Error('auth-missing', '请先配置 a6api 访问令牌');
    return { tokens: await this.site.tokens() };
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
    const selection = this.selection(input.selectionId);
    const slots = this.slots(selection, input.slots);
    const allowed = new Set(selection.models.map(channelKey));
    const channels = input.models ? input.models.map(channelOf) : selection.models;
    if (!channels.length || channels.length > 64 || channels.some(model => !allowed.has(channelKey(model)))) {
      throw new A6Error('invalid-selection', '待测项不属于网页选择或数量无效');
    }
    if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error('invalid-selection', '待测清单重复');
    // A manual pin made from this page must be released before the automatic slots start moving them.
    await this.releaseManual(selection, slots);
    const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: selection.siteOrigin, slots };
    return this.records.create({
      kind: 'fingerprint', name: input.name || 'a6api 专项指纹', a6api,
      options: { timeoutMs: input.timeoutMs ?? 180_000, concurrency: slots.length },
      models: channels.map(channel => ({
        // Stable identity is the tested channel, not the worker that happens to claim it.
        provider: `a6api:${channel.channelId}:${channel.supplierId}`, id: channel.model, name: channel.model,
        a6api: channel,
        relay: { siteId: 'a6api', channelId: channel.channelId, supplierId: channel.supplierId, listingId: channel.listingId, model: channel.model, api: channel.model && /claude|anthropic/i.test(`${channel.brand} ${channel.model}`) ? 'messages' : 'chat' },
      })),
    });
  }

  async releaseManual(selection, slots) {
    for (const slot of slots) {
      const identity = tokenIdentity(selection, slot.tokenId);
      const held = [...this.manualLeases.entries()].filter(([key]) => key.startsWith(`${identity}:`));
      if (!held.length) continue;
      if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '此测试令牌正在执行任务');
      await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
      try {
        for (const [key, lease] of held) {
          await this.site.unpin({ tokenId: slot.tokenId, model: lease.model, channelId: lease.channelId });
          this.manualLeases.delete(key);
        }
      } finally { this.engine.tokenSlots.release(identity); }
    }
  }

  async action(input) {
    const selection = this.selection(input.selectionId);
    if (!selection.tokens.some(token => token.id === input.tokenId)) throw new A6Error('token-not-selected', '只能操作你选择的测试令牌');
    if (!selection.models.some(channel => channel.model === input.model && channel.channelId === input.channelId)) {
      throw new A6Error('invalid-selection', '目标不属于当前待测清单');
    }
    const identity = tokenIdentity(selection, input.tokenId);
    // A user action must never change the pin of a token currently sampling three challenges.
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该测试令牌正在执行任务，请等槽位空闲后再操作');
    await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
    const key = `${identity}:${input.model}`;
    try {
      const lease = this.manualLeases.get(key);
      if (input.operation === 'restore') {
        if (!lease) return { ok: true, result: { skipped: true } };
        await this.site.unpin({ tokenId: input.tokenId, model: lease.model, channelId: lease.channelId });
        this.manualLeases.delete(key);
        return { ok: true, result: { restored: true, target: lease } };
      }
      if (lease) throw new A6Error('already-pinned', '请先恢复本次手动固定，再选择其他目标');
      if (input.operation === 'pin') {
        const outcome = await this.site.pin({ tokenId: input.tokenId, model: input.model, channelId: input.channelId });
        if (!outcome.routeEffective) throw new A6Error('pin-unverified', '固定渠道未生效，请检查该渠道是否可用');
        const target = { tokenId: input.tokenId, model: input.model, channelId: input.channelId, supplierId: outcome.supplierId };
        this.manualLeases.set(key, target);
        return { ok: true, result: { verified: true, target } };
      }
      throw new A6Error('invalid-operation', '只支持固定与恢复');
    } finally { this.engine.tokenSlots.release(identity); }
  }
}
