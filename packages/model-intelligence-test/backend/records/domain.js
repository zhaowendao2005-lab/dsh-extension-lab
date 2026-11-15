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
  },
});

/**
 * Host-side settings that must survive a restart but are not test records: today the a6api test
 * token/provider mappings and pin-recovery leases (no API keys). A separate domain on purpose — bumping the records domain discards every stored record, and
 * these two lifetimes must not be coupled.
 */
export const settingsDomain = defineDomain({
  name: 'model_intelligence_settings',
  version: 1,
  layout: 'per-record',
  tables: {
    // Account-scoped preferences and lease records; no test API key is stored by this flow.
    auth: domainTable(z.object({ siteId: z.string().min(1) }).passthrough()),
  },
});

/** Opens both domains once; every consumer awaits the same handles. */
export class PluginStorage {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = (async () => {
      const records = await ctx.storageDomain.open(recordsDomain);
      let managed = null;
      try { managed = await ctx.storageDomain.open(settingsDomain); }
      catch (error) { ctx.logger?.('model-intelligence')?.warn?.('settings domain unavailable', error); }
      return { records, managed };
    })();
    this.ready.catch(() => {});
  }
  async records() { return (await this.ready).records; }
  async managed() { return (await this.ready).managed; }
  async close() {
    try {
      const { records, managed } = await this.ready;
      await Promise.allSettled([records.close(), managed?.close()]);
    } catch { /* open failed: nothing to close */ }
  }
}
