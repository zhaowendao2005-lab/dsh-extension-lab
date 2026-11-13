import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

/**
 * Durable plugin data, stored through the Host storage domain (it lives under the current DSH data
 * directory, i.e. the sandbox directory during development). Schemas only pin identity fields:
 * the owning modules validate their own payloads, so additive field changes never reject an open.
 */
const identified = z.object({ id: z.string().min(1) }).passthrough();

export const recordsDomain = defineDomain({
  name: 'model_intelligence_test',
  version: 1,
  layout: 'per-record',
  global: { schema: z.record(z.string(), z.unknown()), initial: {} },
  tables: {
    records: domainTable(identified),
    attempts: domainTable(z.object({ id: z.string().min(1), recordId: z.string().min(1) }).passthrough()),
    partitions: domainTable(identified),
    partition_items: domainTable(z.object({ key: z.string().min(1), partitionId: z.string().min(1) }).passthrough()),
  },
});

/**
 * Relay models the user asked to publish as DSH providers. A separate domain on purpose: the
 * registry is user data, so it must never share a version bump with the records domain (bumping
 * that domain discards every stored record).
 */
export const managedDomain = defineDomain({
  name: 'model_intelligence_managed',
  version: 1,
  layout: 'per-record',
  tables: {
    routes: domainTable(z.object({ id: z.string().min(1) }).passthrough()),
    // Relay credentials (API key, 系统访问令牌, 用户 ID) per site. The Host credential store is
    // regenerated from the launcher overlay on restart, so plugin-written refs would vanish; the
    // registry keeps them and mirrors them into the credential service for provider `apiKeyEnv` use.
    auth: domainTable(z.object({ siteId: z.string().min(1) }).passthrough()),
  },
});

export const relayDomain = defineDomain({
  name: 'model_intelligence_relay',
  // v2: rows carry the 24h / 7d success series and the cache-hit rate, which the old
  // 500-row pages dropped. Bumping the version discards the stale cache instead of
  // rendering a table full of dashes until the TTL expires.
  version: 2,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    snapshots: domainTable(z.object({ siteId: z.string().min(1), fetchedAt: z.number(), rows: z.array(z.unknown()) }).passthrough()),
  },
});

/** Opens both domains once; every consumer awaits the same handles. */
export class PluginStorage {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = (async () => {
      const records = await ctx.storageDomain.open(recordsDomain);
      let relay = null;
      try { relay = await ctx.storageDomain.open(relayDomain); }
      catch (error) { ctx.logger?.('model-intelligence')?.warn?.('relay cache unavailable', error); }
      let managed = null;
      try { managed = await ctx.storageDomain.open(managedDomain); }
      catch (error) { ctx.logger?.('model-intelligence')?.warn?.('managed provider registry unavailable', error); }
      return { records, relay, managed };
    })();
    this.ready.catch(() => {});
  }
  async records() { return (await this.ready).records; }
  async relay() { return (await this.ready).relay; }
  async managed() { return (await this.ready).managed; }
  async close() {
    try {
      const { records, relay, managed } = await this.ready;
      await Promise.allSettled([records.close(), relay?.close(), managed?.close()]);
    } catch { /* open failed: nothing to close */ }
  }
}
