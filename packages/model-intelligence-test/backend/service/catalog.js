import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { FingerprintError } from '../fingerprint/engine.js';

function assertOwner(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== 'owner' || principalOf(invocation)) {
    throw new RemoteError('model-intelligence/owner-required', 'Only the owner may use the model intelligence test.', {});
  }
}
function remoteFailure(error) {
  if (error instanceof FingerprintError) return new RemoteError(`model-intelligence/${error.code}`, error.message, {});
  return new RemoteError('model-intelligence/internal', '指纹服务执行失败，请稍后重试。', {});
}

/** Catalog (metadata only) plus real fingerprint jobs; credentials never leave the runtime llm service. */
export class ModelIntelligenceService extends Service {
  constructor(ctx, engine) {
    super(ctx, 'modelIntelligence');
    this.engine = engine;
    this.typertRemote = bindTypertRemote(this, 'modelIntelligence');
    for (const initialize of remoteInitializers) initialize.call(this);
  }
  async fingerprintStart(request) {
    assertOwner(this.ctx.invocation);
    try { return await this.engine.start(request.models, { concurrency: request.concurrency, timeoutMs: request.timeoutMs }); } catch (error) { throw remoteFailure(error); }
  }
  async fingerprintConfigure(request) {
    assertOwner(this.ctx.invocation);
    try { return this.engine.configure(request.jobId, { concurrency: request.concurrency, timeoutMs: request.timeoutMs }); } catch (error) { throw remoteFailure(error); }
  }
  async fingerprintRetry(request) {
    assertOwner(this.ctx.invocation);
    try { return this.engine.retry(request.jobId, request.model); } catch (error) { throw remoteFailure(error); }
  }
  async fingerprintStatus(request) {
    assertOwner(this.ctx.invocation);
    try { return this.engine.status(request.jobId, request.revision); } catch (error) { throw remoteFailure(error); }
  }
  async fingerprintCancel(request) {
    assertOwner(this.ctx.invocation);
    try { return this.engine.cancel(request.jobId); } catch (error) { throw remoteFailure(error); }
  }
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
        return {id: provider.id, name: provider.name, models: [], error: '此供应商的模型目录加载失败，请检查当前运行时配置后重试。'};
      }
      if (!Array.isArray(models) || models.some(model =>
        !model || typeof model.id !== 'string' || typeof model.name !== 'string' ||
        (model.description !== undefined && typeof model.description !== 'string'))) {
        throw new RemoteError('model-intelligence/catalog-invalid', '当前运行时返回的模型目录格式无效。', {});
      }
      return {id: provider.id, name: provider.name, models: models.map(model => ({
        id: model.id, name: model.name, ...(model.description === undefined ? {} : {description: model.description}),
      }))};
    }));
    return {providers};
  }
}
const remoteInitializers = [];
for (const name of ['catalog', 'fingerprintStart', 'fingerprintConfigure', 'fingerprintRetry', 'fingerprintStatus', 'fingerprintCancel']) {
  Remote(name)(ModelIntelligenceService.prototype[name], {
    kind: 'method', name, static: false, private: false,
    addInitializer(initialize) { remoteInitializers.push(initialize); },
  });
}
