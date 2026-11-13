import { hostContribution } from '../shared/contract.js';
import { FingerprintEngine } from './fingerprint/engine.js';
import { ModelIntelligenceService } from './service/catalog.js';
import { PluginStorage } from './records/domain.js';
import { RecordsService } from './records/service.js';
import { RelayAdapter } from './relay/adapter.js';
import { RelayAuth } from './relay/auth.js';
import { ManagedProviders } from './relay/providers.js';
import { siteOf, SITES } from './relay/site.js';
import { snapshotOf, disposeSnapshots } from './relay/snapshot.js';

export const name = 'model-intelligence-test';
export const inject = ['typert', 'storageDomain', 'credentials'];

export function apply(ctx) {
  const storage = new PluginStorage(ctx);
  const auth = new RelayAuth(ctx, storage);
  const providers = new ManagedProviders(ctx, storage);
  let records;
  const engine = new FingerprintEngine(ctx, {
    onTouch: job => records?.onTouch(job),
    onSettled: job => records?.onSettled(job),
    relayKey: siteId => auth.resolve(siteId, 'apiKey'),
    relayApiUrl: siteId => siteOf(siteId)?.apiUrl,
  });
  records = new RecordsService(ctx, storage, engine);

  // Relay snapshots survive restarts: restore the persisted copy, persist every fresh load.
  void storage.relay().then(domain => {
    if (!domain) return;
    const table = domain.table('snapshots');
    for (const site of SITES) {
      const snapshot = snapshotOf(site.id);
      snapshot.restore(table.get(site.id));
      snapshot.onLoaded = loaded => table.put(site.id, loaded.serialize());
    }
  }).catch(() => {});

  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    for (const site of SITES) snapshotOf(site.id).onLoaded = undefined;
    disposeSnapshots();
    void storage.close();
  }, 'model-intelligence.lifecycle');
  new ModelIntelligenceService(ctx, { engine, records, auth, providers });
  ctx.effect(() => ctx.typert.register(hostContribution), 'model-intelligence.remote-contract');

  // Relay channels as first-class provider routes. DSH owns the request pipeline; the adapter only
  // maps the normalised request onto chat/responses/messages and back. Registered lazily because
  // `llm` may mount after this plugin, and re-registered whenever the managed-provider registry
  // changes so 加入模型池 takes effect without a restart.
  const adapter = new RelayAdapter({ auth });
  ctx.inject(['llm'], llmCtx => {
    const llm = llmCtx.get('llm');
    let handle = null;
    const sync = async () => {
      const routes = await providers.adapterRoutes();
      adapter.setRoutes(routes);
      const ids = [...routes.keys()];
      if (!ids.length) {
        handle?.();
        handle = null;
        return;
      }
      if (handle) handle.replace(ids);
      else handle = llm.registerAdapter(ids, adapter);
    };
    providers.onChange = () => { void sync().catch(error => { void error; }); };
    llmCtx.effect(() => () => {
      providers.onChange = undefined;
      handle?.();
      handle = null;
    }, 'model-intelligence.relay-adapter');
    void sync().catch(error => { void error; });
  });
}
