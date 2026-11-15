import { randomUUID } from 'node:crypto';
import { A6Error, channelKey, channelOf } from './bridge.js';
import { tokenIdentity } from './slots.js';

/** User decisions are authoritative: no key matching, endpoint interrogation or provider mutation. */
export class A6Service {
  constructor({ ctx, storage, records, bridge, engine }) {
    Object.assign(this, { ctx, storage, records, bridge, engine });
    this.manualLeases = new Map();
  }
  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new A6Error('storage-unavailable', '专项配置存储不可用');
    return domain.table('auth');
  }
  preferenceKey(selection) { return `prefs:${selection.siteOrigin}:${selection.accountId}`; }
  slots(selection, input) {
    if (!Array.isArray(input) || !input.length || input.length > 8) throw new A6Error('invalid-slots', '请选择 1–8 个测试槽位');
    const seen = new Set();
    return input.map(slot => {
      if (!selection.tokens.some(token => token.id === slot.tokenId) || seen.has(slot.tokenId)) throw new A6Error('invalid-slots', '测试令牌未选择或重复');
      seen.add(slot.tokenId);
      if (typeof slot.provider !== 'string' || !slot.provider.trim() || slot.provider.length > 128) throw new A6Error('invalid-slots', '请为每个测试令牌选择 DSH 提供商');
      return { tokenId: slot.tokenId, provider: slot.provider };
    });
  }
  async preferences({ selectionId }) {
    const selection = this.bridge.selection(selectionId);
    const row = (await this.table()).get(this.preferenceKey(selection));
    return { slots: (row?.slots ?? []).filter(slot => selection.tokens.some(token => token.id === slot.tokenId)), timeoutMs: row?.timeoutMs ?? 180_000 };
  }
  async savePreferences(input) {
    const selection = this.bridge.selection(input.selectionId);
    const slots = this.slots(selection, input.slots);
    const key = this.preferenceKey(selection);
    await (await this.table()).put(key, { siteId: key, slots, timeoutMs: input.timeoutMs ?? 180_000 });
    return { ok: true };
  }
  async create(input) {
    const selection = this.bridge.selection(input.selectionId);
    const slots = this.slots(selection, input.slots);
    this.bridge.assertReady(selection, slots);
    const llm = this.ctx.get('llm');
    const providers = new Set(llm?.listProviders().map(provider => provider.id) ?? []);
    if (slots.some(slot => !providers.has(slot.provider))) throw new A6Error('unknown-provider', '选择的 DSH 提供商已不可用，请重新选择');
    const allowed = new Set(selection.models.map(channelKey));
    const channels = input.models ? input.models.map(channelOf) : selection.models;
    if (!channels.length || channels.length > 64 || channels.some(model => !allowed.has(channelKey(model)))) throw new A6Error('invalid-selection', '待测项不属于网页选择或数量无效');
    if (new Set(channels.map(channelKey)).size !== channels.length) throw new A6Error('invalid-selection', '待测清单重复');
    // A quick manual pin on this page must be restored before the automatic lease starts.
    // Otherwise the userscript correctly refuses a second outstanding lease for the same token.
    for (const slot of slots) {
      const identity = tokenIdentity(selection, slot.tokenId);
      const leases = [...this.manualLeases.entries()].filter(([key]) => key.startsWith(`${identity}:`));
      if (!leases.length) continue;
      if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '此测试令牌正在执行任务');
      await this.engine.tokenSlots.acquire(identity, new AbortController().signal);
      try {
        for (const [key, lease] of leases) {
          const restored = await this.bridge.execute(selection, { operation: 'restore', tokenId: slot.tokenId, model: lease.model, channelId: lease.channelId, leaseId: lease.leaseId });
          if (restored.conflict || !restored.restored && !restored.skipped) throw new A6Error('restore-unverified', '请先恢复快捷固定，再开始专项测试');
          this.manualLeases.delete(key);
        }
      } finally { this.engine.tokenSlots.release(identity); }
    }
    await this.savePreferences(input);
    const a6api = { selectionId: selection.id, accountId: selection.accountId, siteOrigin: selection.siteOrigin, connectionId: selection.connectionId, slots };
    return this.records.create({
      kind: 'fingerprint', name: input.name || 'a6api 专项指纹', a6api,
      options: { timeoutMs: input.timeoutMs ?? 180_000, concurrency: slots.length },
      models: channels.map(channel => ({
        // Stable identity is the tested channel, not the worker that happens to claim it.
        provider: `a6api:${channel.channelId}:${channel.supplierId}`, id: channel.model, name: channel.model,
        a6api: channel,
        relay: { siteId: 'a6api', channelId: channel.channelId, supplierId: channel.supplierId, listingId: channel.listingId, model: channel.model, api: 'chat' },
      })),
    });
  }
  async action(input) {
    const selection = this.bridge.selection(input.selectionId);
    if (!selection.tokens.some(token => token.id === input.tokenId)) throw new A6Error('token-not-selected', '只能操作你选择的测试令牌');
    if (!selection.models.some(channel => channel.model === input.model && channel.channelId === input.channelId)) throw new A6Error('invalid-selection', '目标不属于当前待测清单');
    const identity = tokenIdentity(selection, input.tokenId);
    // A user action must never change the pin of a token currently sampling three challenges.
    if (this.engine.tokenSlots.busy.has(identity)) throw new A6Error('slot-busy', '该测试令牌正在执行任务，请等槽位空闲后再操作');
    const controller = new AbortController();
    if (!await this.engine.tokenSlots.acquire(identity, controller.signal)) throw new A6Error('slot-busy', '槽位繁忙');
    const key = `${identity}:${input.model}`;
    try {
      const savedLease = this.manualLeases.get(key);
      let leaseId = savedLease?.leaseId;
      if (input.operation === 'restore' && !leaseId) return { ok: true, result: { skipped: true } };
      if (input.operation === 'pin') {
        if (leaseId) throw new A6Error('already-pinned', '请先恢复本次手动固定，再选择其他目标');
        leaseId = randomUUID(); this.manualLeases.set(key, { leaseId, model: input.model, channelId: input.channelId });
      }
      const result = await this.bridge.execute(selection, { operation: input.operation, tokenId: input.tokenId, model: savedLease?.model ?? input.model, channelId: input.operation === 'restore' ? savedLease.channelId : input.channelId, leaseId: leaseId ?? randomUUID() });
      if (input.operation === 'pin' && !result.verified) throw new A6Error('pin-unverified', '固定渠道未确认');
      if (input.operation === 'restore') {
        if (result.conflict) throw new A6Error('restore-conflict', '固定已被外部修改，没有覆盖');
        this.manualLeases.delete(key);
      }
      return { ok: true, result: { ...result, target: { tokenId: input.tokenId, model: savedLease?.model ?? input.model, channelId: input.operation === 'restore' ? savedLease.channelId : input.channelId } } };
    } finally { this.engine.tokenSlots.release(identity); }
  }
}
