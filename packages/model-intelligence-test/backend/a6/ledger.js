import { randomUUID } from 'node:crypto';

const DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = value => number(value) !== null && value >= 0 ? value : null;
const text = (value, max = 256) => typeof value === 'string' ? value.slice(0, max) : '';
const terminalBilling = new Set(['reconciled', 'ambiguous', 'unattributed']);
const identity = (origin, account) => JSON.stringify([origin || 'https://a6api.vip', String(account ?? '')]);
const usageOf = usage => Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens'].filter(key => nonnegative(usage?.[key]) !== null).map(key => [key, usage[key]]));
const confirmedBilling = row => ['observed', 'reconciled'].includes(row.billingState) ? row.billing : null;

/** Durable data-plane facts. No keys, prompts, raw errors, IPs or log bodies enter this domain. */
export class A6Ledger {
  constructor({ storage, site, onChange } = {}) {
    this.storage = storage; this.site = site; this.onChange = onChange;
    this.generation = 0; this.account = null; this.disposed = false; this.authPaused = false;
    this.timers = new Map(); this.pending = new Map(); this.queues = new Map(); this.removed = new Set(); this.creating = new Set();
    this.ready = storage.records(); this.ready.catch(() => {});
  }

  configure({ siteOrigin = 'https://a6api.vip', accountId = this.site?.userId } = {}) {
    this.generation += 1; this.authPaused = false;
    this.account = identity(siteOrigin, accountId);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const generation = this.generation;
    // Resume billing only. Interrupted data-plane executions are never sent again.
    void this.ready.then(async domain => {
      for (const [, row] of domain.table('executions').entries()) {
        if (!this.current(row, generation)) continue;
        if (row.state === 'dispatching' || row.state === 'response-received') await this.change(row.id, generation, item => ({ ...item, state: 'unknown', finishedAt: item.finishedAt ?? Date.now() }));
        if (row.requestId && !terminalBilling.has(row.billingState)) this.schedule(row.id, 0, generation);
      }
    }).catch(() => {});
  }

  current(row, generation = this.generation) {
    return !this.disposed && generation === this.generation && !this.removed.has(row.recordId)
      && identity(row.siteOrigin, row.accountId) === (this.account ?? identity(row.siteOrigin, this.site?.userId))
      && String(row.accountId) === String(this.site?.userId ?? '');
  }

  async change(id, generation, mutate) {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const domain = await this.ready, table = domain.table('executions'), row = table.get(id);
      if (!row || !this.current(row, generation) || !domain.table('records').get(row.recordId) || !domain.table('attempts').get(row.attemptId)) return null;
      const updated = mutate(row);
      if (!updated) return null;
      await table.put(id, updated);
      try { this.onChange?.(updated); } catch { /* a notification cannot discard a billing fact */ }
      return updated;
    });
    this.queues.set(id, next);
    try { return await next; } finally { if (this.queues.get(id) === next) this.queues.delete(id); }
  }

  async begin(input) {
    const generation = this.generation;
    const domain = await this.ready;
    const row = {
      id: `exe-${randomUUID()}`, recordId: input.recordId, attemptId: input.attemptId, jobId: text(input.jobId),
      siteOrigin: input.siteOrigin || 'https://a6api.vip', accountId: String(input.accountId ?? ''),
      provider: text(input.provider), model: text(input.model), tokenId: input.tokenId, intendedChannelId: input.intendedChannelId,
      challengeIndex: input.challengeIndex, createdAt: Date.now(), dispatchStartedAt: null, finishedAt: null,
      state: 'prepared', requestId: null, httpStatus: null, streamUsage: {}, usageState: 'missing', billingState: 'pending', billing: null,
      generation,
    };
    if (!this.current(row, generation) || !domain.table('records').get(row.recordId) || !domain.table('attempts').get(row.attemptId)) return null;
    row.retryOrdinal = [...domain.table('executions').entries()].filter(([, item]) => item.attemptId === row.attemptId && item.provider === row.provider && item.model === row.model && item.challengeIndex === row.challengeIndex).length;
    const work = (async () => {
      await domain.table('executions').put(row.id, row);
      if (!this.current(row, generation) || !domain.table('records').get(row.recordId) || !domain.table('attempts').get(row.attemptId)) {
        await domain.table('executions').delete(row.id);
        return null;
      }
      try { this.onChange?.(row); } catch { /* notification only */ }
      return { id: row.id, generation };
    })();
    this.creating.add(work);
    try { return await work; } finally { this.creating.delete(work); }
  }

  async dispatch(handle) {
    if (!handle) return;
    const row = await this.change(handle.id, handle.generation, item => ({ ...item, state: 'dispatching', dispatchStartedAt: Date.now() }));
    if (!row) throw new Error('请求记录或账号已变更，未发送采样请求');
  }

  async metadata(handle, metadata) {
    if (!handle) return;
    const updated = await this.change(handle.id, handle.generation, row => ({ ...row, requestId: text(metadata.requestId) || null,
      httpStatus: Number.isInteger(metadata.httpStatus) ? metadata.httpStatus : null, responseReceivedAt: Date.now(), state: 'response-received' }));
    if (!updated?.requestId) return;
    const domain = await this.ready;
    const duplicates = [...domain.table('executions').entries()].map(([, row]) => row).filter(row => row.requestId === updated.requestId
      && identity(row.siteOrigin, row.accountId) === identity(updated.siteOrigin, updated.accountId));
    if (duplicates.length > 1) for (const duplicate of duplicates) {
      await this.change(duplicate.id, handle.generation, row => ({ ...row, billingState: 'ambiguous', requestIdCollision: true }));
      clearTimeout(this.timers.get(duplicate.id)); this.timers.delete(duplicate.id);
    }
  }

  async finish(handle, { state, finishKind, streamUsage } = {}) {
    if (!handle) return;
    const usage = usageOf(streamUsage);
    const row = await this.change(handle.id, handle.generation, item => ({ ...item, state: item.dispatchStartedAt ? state || 'ended' : 'not-sent', finishKind: text(finishKind, 80), finishedAt: Date.now(),
      streamUsage: usage, usageState: Object.keys(usage).length ? 'stream' : 'missing', billingState: item.requestIdCollision ? 'ambiguous' : !item.dispatchStartedAt ? 'not-sent' : item.requestId ? 'pending' : 'unattributed' }));
    if (row?.requestId && !row.requestIdCollision) this.schedule(row.id, 0, handle.generation);
  }

  schedule(id, index, generation = this.generation, delay = DELAYS[index]) {
    if (this.disposed || this.authPaused || generation !== this.generation || this.timers.has(id)) return;
    if (index >= DELAYS.length) return;
    const timer = setTimeout(() => { this.timers.delete(id); void this.reconcile(id, generation, index).catch(() => {}); }, delay);
    timer.unref?.(); this.timers.set(id, timer);
  }

  reconcile(id, generation = this.generation, index = 0) {
    const key = `${generation}:${id}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.query(id, generation, index).finally(() => { if (this.pending.get(key) === work) this.pending.delete(key); });
    this.pending.set(key, work); return work;
  }

  async query(id, generation, index) {
    if (this.authPaused || generation !== this.generation || this.disposed) return;
    let row = await this.change(id, generation, item => item.requestId && !item.requestIdCollision ? { ...item, billingState: 'querying' } : null);
    if (!row) return;
    try {
      const [result, settings] = await Promise.all([this.site.requestLogs(row.requestId), this.site.billingSettings()]);
      if (!this.current(row, generation)) return;
      const matching = (result.rows ?? []).filter(log => log.request_id === row.requestId);
      const relevant = matching.filter(log => Number(log.type) === 2 || Number(log.type) === 6);
      const mismatch = matching.some(log => String(log.token_id) !== String(row.tokenId) || log.model_name !== row.model);
      // Event IDs are not globally unique; unproven refund/multi-event semantics must not be summed.
      const ambiguous = mismatch || relevant.length > 1 || relevant.some(log => Number(log.type) === 6) || result.complete !== true;
      const log = relevant.length === 1 && Number(relevant[0].type) === 2 && !ambiguous ? relevant[0] : null;
      let other = log?.other;
      if (typeof other === 'string') { try { other = JSON.parse(other); } catch { other = {}; } }
      const quota = nonnegative(log?.quota), quotaPerUnit = nonnegative(settings?.quotaPerUnit), usdExchangeRate = nonnegative(settings?.usdExchangeRate);
      const settled = other?.settle_phase === 'request_settled';
      const billing = log ? {
        quota, quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : null, usdExchangeRate,
        costCny: quota !== null && quotaPerUnit > 0 && usdExchangeRate > 0 ? quota / quotaPerUnit * usdExchangeRate : null,
        inputTokens: nonnegative(log.prompt_tokens), outputTokens: nonnegative(log.completion_tokens), cacheReadTokens: nonnegative(other?.cache_tokens),
        actualChannelId: nonnegative(other?.actual_channel_id) ?? nonnegative(log.channel), billedChannelId: nonnegative(other?.billed_channel_id),
        settlePhase: text(other?.settle_phase, 80), observedAt: Date.now(), source: 'site-log',
      } : null;
      row = await this.change(id, generation, item => ({ ...item, billingState: item.requestIdCollision || ambiguous ? 'ambiguous' : billing ? (settled ? 'reconciled' : 'observed') : index + 1 >= DELAYS.length ? 'deferred' : 'not-found-yet',
        ...(billing ? { billing: item.billing?.quotaPerUnit > 0 && item.billing?.usdExchangeRate > 0 ? { ...billing, quotaPerUnit: item.billing.quotaPerUnit, usdExchangeRate: item.billing.usdExchangeRate,
          costCny: billing.quota !== null ? billing.quota / item.billing.quotaPerUnit * item.billing.usdExchangeRate : null } : billing } : {}),
        billingCheckedAt: Date.now(), billingError: null,
        channelMismatch: billing?.actualChannelId != null ? billing.actualChannelId !== item.intendedChannelId : item.channelMismatch ?? false,
      }));
      if (row && !terminalBilling.has(row.billingState)) this.schedule(id, index + 1, generation);
    } catch (error) {
      const auth = /auth|401|403/.test(String(error?.code ?? ''));
      if (auth && this.current(row, generation)) {
        this.authPaused = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
      }
      row = await this.change(id, generation, item => ({ ...item, billingState: item.requestIdCollision ? 'ambiguous' : auth ? 'unavailable' : index + 1 >= DELAYS.length ? 'deferred' : 'not-found-yet', billingError: auth ? 'auth' : 'query-failed', billingCheckedAt: Date.now() }));
      if (row && !auth && !terminalBilling.has(row.billingState)) this.schedule(id, index + 1, generation, Math.max(DELAYS[index + 1] ?? 0, nonnegative(error?.retryAfterMs) ?? 0));
    }
  }

  async view({ attemptId, recordId, refresh = false } = {}) {
    const domain = await this.ready;
    const attempts = [...domain.table('attempts').entries()].map(([, item]) => item).filter(item => (!attemptId || item.id === attemptId) && (!recordId || item.recordId === recordId));
    const ids = new Set(attempts.map(item => item.id));
    const rows = [...domain.table('executions').entries()].map(([, item]) => item).filter(row => ids.has(row.attemptId) && row.dispatchStartedAt != null);
    if (refresh) for (const row of rows) if (this.current(row) && row.requestId && !row.requestIdCollision) {
      clearTimeout(this.timers.get(row.id)); this.timers.delete(row.id);
      void this.reconcile(row.id).catch(() => {});
    }
    const legacy = attempts.some(attempt => attempt.ledgerVersion !== 1);
    const billed = rows.filter(row => row.billing?.costCny != null && ['observed', 'reconciled'].includes(row.billingState));
    const tokenRows = rows.map(row => ({ input: confirmedBilling(row)?.inputTokens ?? row.streamUsage?.inputTokens, output: confirmedBilling(row)?.outputTokens ?? row.streamUsage?.outputTokens }));
    const sum = key => { const known = tokenRows.map(row => nonnegative(row[key])).filter(value => value !== null); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
    return {
      executions: rows.map(({ generation, ...row }) => ({ ...row, inputTokens: confirmedBilling(row)?.inputTokens ?? row.streamUsage?.inputTokens ?? null, outputTokens: confirmedBilling(row)?.outputTokens ?? row.streamUsage?.outputTokens ?? null,
        costCny: confirmedBilling(row)?.costCny ?? null, usageState: confirmedBilling(row) ? 'billing' : row.usageState,
        accountState: this.current(row) ? 'current' : 'historical' })),
      summary: {
        requestCount: legacy && !rows.length ? null : rows.length, knownCostCny: billed.length ? billed.reduce((sum, row) => sum + row.billing.costCny, 0) : null,
        billedCount: billed.length, pendingCount: rows.length - rows.filter(row => row.billingState === 'reconciled').length,
        inputTokens: sum('input'), outputTokens: sum('output'),
        coverage: { legacy, requestIdCount: rows.filter(row => row.requestId).length, billingCompleteCount: rows.filter(row => row.billingState === 'reconciled').length,
          usageCount: tokenRows.filter(row => nonnegative(row.input) !== null && nonnegative(row.output) !== null).length,
          inputCount: tokenRows.filter(row => nonnegative(row.input) !== null).length, outputCount: tokenRows.filter(row => nonnegative(row.output) !== null).length,
          unattributedCount: rows.filter(row => !row.requestId).length, ambiguousCount: rows.filter(row => row.billingState === 'ambiguous').length },
      },
    };
  }

  async removeRecord(recordId) {
    this.removed.add(recordId);
    await Promise.allSettled([...this.creating]);
    const domain = await this.ready;
    const ids = [...domain.table('executions').entries()].filter(([, row]) => row.recordId === recordId).map(([id]) => id);
    for (const id of ids) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    await Promise.allSettled(ids.map(id => this.queues.get(id)));
    await domain.table('executions').deleteMany(ids);
  }

  async dispose() {
    this.disposed = true; this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.creating, ...this.queues.values(), ...this.pending.values()]);
    this.pending.clear();
  }
}
