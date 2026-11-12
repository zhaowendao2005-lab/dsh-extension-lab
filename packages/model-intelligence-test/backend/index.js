import { hostContribution } from '../shared/contract.js';
import { FingerprintEngine } from './fingerprint/engine.js';
import { ModelIntelligenceService } from './service/catalog.js';
export const name = 'model-intelligence-test';
export const inject = ['typert'];
export function apply(ctx) {
  const engine = new FingerprintEngine(ctx);
  ctx.effect(() => () => engine.dispose(), 'model-intelligence.fingerprint-jobs');
  new ModelIntelligenceService(ctx, engine);
  ctx.effect(() => ctx.typert.register(hostContribution), 'model-intelligence.remote-contract');
}
