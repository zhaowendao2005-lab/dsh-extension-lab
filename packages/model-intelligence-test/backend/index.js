import { hostContribution } from '../shared/contract.js';
import { FingerprintEngine } from './fingerprint/engine.js';
import { ModelIntelligenceService } from './service/catalog.js';
import { PluginStorage } from './records/domain.js';
import { RecordsService } from './records/service.js';
import { A6Site } from './a6/site.js';
import { A6Intake } from './a6/intake.js';
import { A6Service } from './a6/service.js';

export const name = 'model-intelligence-test';
export const inject = ['typert', 'storageDomain', 'webServer'];

export function apply(ctx) {
  const storage = new PluginStorage(ctx);
  const site = new A6Site();
  const intake = new A6Intake();
  intake.attachStorage(storage);
  ctx.effect(() => intake.mount(ctx.webServer), 'model-intelligence.a6-intake');
  let records;
  let a6;
  const engine = new FingerprintEngine(ctx, {
    onTouch: job => records?.onTouch(job),
    onSettled: job => records?.onSettled(job),
    // The engine talks to a6api through these three calls only; it never sees credential storage.
    a6: {
      pin: target => a6.site.pin(target),
      unpin: target => a6.site.unpin(target),
      key: tokenId => a6.key(tokenId),
    },
  });
  records = new RecordsService(ctx, storage, engine);
  a6 = new A6Service({ ctx, storage, intake, site, records, engine });
  ctx.effect(() => () => {
    records.dispose();
    engine.dispose();
    void storage.close();
  }, 'model-intelligence.lifecycle');
  new ModelIntelligenceService(ctx, { engine, records, a6 });
  ctx.effect(() => ctx.typert.register(hostContribution), 'model-intelligence.remote-contract');
}
