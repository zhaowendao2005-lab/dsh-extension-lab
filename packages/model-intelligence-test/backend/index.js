import { hostContribution } from '../shared/contract.js';
import { FingerprintEngine } from './fingerprint/engine.js';
import { ModelIntelligenceService } from './service/catalog.js';
import { PluginStorage } from './records/domain.js';
import { RecordsService } from './records/service.js';
import { A6Bridge } from './a6/bridge.js';
import { A6Service } from './a6/service.js';

export const name = 'model-intelligence-test';
export const inject = ['typert', 'storageDomain', 'webServer'];

export function apply(ctx) {
  const storage = new PluginStorage(ctx);
  const bridge = new A6Bridge();
  bridge.attachStorage(storage);
  ctx.effect(() => bridge.mount(ctx.webServer), 'model-intelligence.a6-bridge');
  let records;
  const engine = new FingerprintEngine(ctx, {
    onTouch: job => records?.onTouch(job),
    onSettled: job => records?.onSettled(job),
    bridge,
  });
  records = new RecordsService(ctx, storage, engine);
  const a6 = new A6Service({ ctx, storage, bridge, records, engine });
  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    // Outstanding pin leases were persisted before sending; the next page reconnect recovers them.
    bridge.dispose();
    void storage.close();
  }, 'model-intelligence.lifecycle');
  new ModelIntelligenceService(ctx, { engine, records, a6, bridge });
  ctx.effect(() => ctx.typert.register(hostContribution), 'model-intelligence.remote-contract');
}
