import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { FingerprintError } from '../fingerprint/engine.js';
import { A6Error } from '../a6/bridge.js';

function assertOwner(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== 'owner' || principalOf(invocation)) {
    throw new RemoteError('model-intelligence/owner-required', 'Only the owner may use the model intelligence test.', {});
  }
}
function remoteFailure(error) {
  if (error instanceof FingerprintError || error instanceof A6Error) {
    return new RemoteError(`model-intelligence/${error.code}`, error.message, {});
  }
  if (error instanceof RemoteError) return error;
  return new RemoteError('model-intelligence/internal', '服务执行失败，请稍后重试。', {});
}

/**
 * Remote surface of the plugin. Records/attempts and the test keys are Host state; key plaintext
 * never crosses the wire (only a mask and the slot count do).
 */
export class ModelIntelligenceService extends Service {
  constructor(ctx, deps) {
    super(ctx, 'modelIntelligence');
    this.engine = deps.engine;
    this.records = deps.records;
    this.a6 = deps.a6;
    this.bridge = deps.bridge;
    this.typertRemote = bindTypertRemote(this, 'modelIntelligence');
    for (const initialize of remoteInitializers) initialize.call(this);
  }
  async guard(run) {
    assertOwner(this.ctx.invocation);
    try { return await run(); } catch (error) { throw remoteFailure(error); }
  }

  // ---- records & attempts --------------------------------------------------------------------
  recordsList(request) { return this.guard(() => this.records.list(request?.revision)); }
  recordCreate(request) { return this.guard(() => this.records.create(request)); }
  recordRerun(request) { return this.guard(() => this.records.rerun(request.recordId)); }
  recordDelete(request) { return this.guard(() => this.records.remove(request.recordId)); }
  recordsClear() { return this.guard(() => this.records.clear()); }
  attemptView(request) { return this.guard(() => this.records.attempt(request.attemptId, request.revision)); }
  attemptCancel(request) { return this.guard(() => this.records.cancel(request.attemptId)); }
  attemptConfigure(request) { return this.guard(() => this.records.configure(request.attemptId, { concurrency: request.concurrency, timeoutMs: request.timeoutMs })); }
  attemptRetry(request) { return this.guard(() => this.records.retry(request.attemptId, request.model)); }
  customSave(request) { return this.guard(() => this.records.saveCustom(request.recordId, request.snapshot)); }

  // Owner-only control plane; browser pages use the paired, narrowly scoped bridge instead.
  a6BridgeInfo() { return this.guard(() => this.bridge.info()); }
  a6Selections(request) { return this.guard(() => this.bridge.list(request?.revision)); }
  a6Preferences(request) { return this.guard(() => this.a6.preferences(request)); }
  a6PreferencesSave(request) { return this.guard(() => this.a6.savePreferences(request)); }
  a6Create(request) { return this.guard(() => this.a6.create(request)); }
  a6Action(request) { return this.guard(() => this.a6.action(request)); }

  // ---- DSH model catalog ---------------------------------------------------------------------
  async catalog() {
    assertOwner(this.ctx.invocation);
    const llm = this.ctx.get('llm');
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      throw new RemoteError('model-intelligence/unavailable', '模型目录不可用：当前运行时未注册完整的 LLM 服务。', {});
    }
    let configuredProviders;
    try { configuredProviders = llm.listProviders(); }
    catch { throw new RemoteError('model-intelligence/catalog-failed', '无法读取当前运行时的模型目录，请重试。', {}); }
    if (!Array.isArray(configuredProviders) || configuredProviders.some(provider =>
      !provider || typeof provider.id !== 'string' || typeof provider.name !== 'string')) {
      throw new RemoteError('model-intelligence/catalog-invalid', '当前运行时返回的模型目录格式无效。', {});
    }
    const providers = await Promise.all(configuredProviders.map(async provider => {
      let models;
      try { models = await llm.listModels(provider.id); }
      catch {
        // Provider errors can contain headers/URLs: never relay arbitrary adapter errors.
        return { id: provider.id, name: provider.name, models: [], error: '此供应商的模型目录加载失败，请检查当前运行时配置后重试。' };
      }
      if (!Array.isArray(models) || models.some(model =>
        !model || typeof model.id !== 'string' || typeof model.name !== 'string' ||
        (model.description !== undefined && typeof model.description !== 'string'))) {
        throw new RemoteError('model-intelligence/catalog-invalid', '当前运行时返回的模型目录格式无效。', {});
      }
      return { id: provider.id, name: provider.name, models: models.map(model => ({
        id: model.id, name: model.name, ...(model.description === undefined ? {} : { description: model.description }),
      })) };
    }));
    return { providers };
  }
}

export const REMOTE_METHODS = [
  'catalog',
  'recordsList', 'recordCreate', 'recordRerun', 'recordDelete', 'recordsClear',
  'attemptView', 'attemptCancel', 'attemptConfigure', 'attemptRetry', 'customSave',
  'a6BridgeInfo', 'a6Selections', 'a6Preferences', 'a6PreferencesSave', 'a6Create', 'a6Action',
];
const remoteInitializers = [];
for (const name of REMOTE_METHODS) {
  Remote(name)(ModelIntelligenceService.prototype[name], {
    kind: 'method', name, static: false, private: false,
    addInitializer(initialize) { remoteInitializers.push(initialize); },
  });
}
