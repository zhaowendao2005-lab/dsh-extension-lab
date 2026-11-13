import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { FingerprintError } from '../fingerprint/engine.js';
import { RelayError } from '../relay/client.js';
import { SITES, SORTS, siteOf } from '../relay/site.js';
import { snapshotOf } from '../relay/snapshot.js';
import { RELAY_APIS } from '../relay/stream.js';
import { allManagedRouteIds } from '../relay/providers.js';

function assertOwner(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== 'owner' || principalOf(invocation)) {
    throw new RemoteError('model-intelligence/owner-required', 'Only the owner may use the model intelligence test.', {});
  }
}
function remoteFailure(error) {
  if (error instanceof FingerprintError || error instanceof RelayError) {
    return new RemoteError(`model-intelligence/${error.code}`, error.message, {});
  }
  if (error instanceof RemoteError) return error;
  return new RemoteError('model-intelligence/internal', '服务执行失败，请稍后重试。', {});
}
const siteView = site => ({ id: site.id, name: site.name, label: site.label, webUrl: site.webUrl, docsUrl: site.docsUrl, anonymous: site.anonymous, note: site.note });

/**
 * Remote surface of the plugin. Records/attempts, partitions and relay credentials are Host state;
 * credentials never cross the wire (only their configured/verified status does).
 */
export class ModelIntelligenceService extends Service {
  constructor(ctx, deps) {
    super(ctx, 'modelIntelligence');
    this.engine = deps.engine;
    this.records = deps.records;
    this.auth = deps.auth;
    this.providers = deps.providers;
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

  // ---- partitions ----------------------------------------------------------------------------
  partitionsList() { return this.guard(() => this.records.partitions()); }
  partitionSave(request) { return this.guard(() => this.records.partitionSave(request)); }
  partitionDelete(request) { return this.guard(() => this.records.partitionDelete(request.partitionId)); }
  partitionItem(request) { return this.guard(() => this.records.partitionItem(request)); }

  // ---- relay site auth & managed providers ---------------------------------------------------
  relayAuthStatus(request) { return this.guard(async () => ({ ...(await this.auth.status(request.siteId)), providers: await this.providers.currentWithRegistry(request.siteId), apis: RELAY_APIS })); }
  relayAuthSet(request) { return this.guard(async () => ({ ...(await this.auth.set(request.siteId, request)), providers: await this.providers.currentWithRegistry(request.siteId), apis: RELAY_APIS })); }
  relayAuthVerify(request) { return this.guard(async () => ({ ...(await this.auth.verify(request.siteId)), providers: await this.providers.currentWithRegistry(request.siteId), apis: RELAY_APIS })); }
  relayProviderModel(request) {
    return this.guard(async () => {
      if (!request.remove && !(await this.auth.resolve(request.siteId, 'apiKey'))) throw new RelayError('relay-key-missing', '请先填写 API Key，再把模型加入提供商');
      return this.providers.setModel(request.siteId, request);
    });
  }
  relayProvidersClear(request) { return this.guard(async () => this.providers.clear(request.siteId)); }
  relayManagedRoutes() { return this.guard(async () => ({ routes: allManagedRouteIds(SITES.map(site => site.id)) })); }

  // ---- relay directory -----------------------------------------------------------------------
  async relaySites() {
    assertOwner(this.ctx.invocation);
    return { sites: SITES.map(siteView), sorts: SORTS };
  }
  relaySnapshot(request) {
    return this.guard(async () => {
      const site = siteOf(request?.siteId);
      if (!site) throw new RelayError('relay-unknown-site', '没有找到该中转站站点。');
      const snapshot = snapshotOf(site.id);
      // First read starts the fetch but does not block the UI for 28 pages.
      void snapshot.ensure(Boolean(request?.force));
      return { site: siteView(site), status: snapshot.status(), ...snapshot.facets(), sorts: SORTS };
    });
  }
  relayRows(request) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request.siteId);
      // A rebuild keeps serving the previous snapshot until the new one lands; only a
      // first-ever load has nothing to answer with.
      if (snapshot.state !== 'ready' && !snapshot.rows.length) {
        void snapshot.ensure(false);
        return { status: snapshot.status(), rows: [], total: 0, offset: 0 };
      }
      if (snapshot.stale()) void snapshot.ensure(false);
      const page = snapshot.query({ brands: request.brands, models: request.models, fidelity: request.fidelity, sort: request.sort, offset: request.offset, limit: request.limit });
      return { status: snapshot.status(), ...page };
    });
  }
  relayRow(request) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request.siteId);
      const row = snapshot.detail(request.rowKey);
      if (!row) throw new RelayError('relay-row-not-found', '没有找到这条渠道记录。');
      return { row, status: snapshot.status() };
    });
  }
  tagsList() { return this.guard(() => this.records.tags()); }
  tagsSet(request) { return this.guard(() => this.records.tagsSet(request)); }
  relayResolve(request) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request.siteId);
      // Make sure a snapshot exists (or is being built) so a lookup never stays unanswerable forever.
      void snapshot.ensure(false);
      return { status: snapshot.status(), items: snapshot.resolve(request.refs) };
    });
  }
  relayRetryMissing(request) {
    return this.guard(async () => {
      const snapshot = snapshotOf(request.siteId);
      void snapshot.retryMissing();
      return { status: snapshot.status() };
    });
  }
  relayHistory(request) { return this.guard(() => snapshotOf(request.siteId).history(request.rowKey)); }
  relayConcurrency(request) { return this.guard(() => snapshotOf(request.siteId).concurrency(request.rowKey)); }
  relaySvg(request) { return this.guard(async () => snapshotOf(request.siteId).svg(request.rowKey, await this.auth.dashboardHeaders(request.siteId))); }

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
  'partitionsList', 'partitionSave', 'partitionDelete', 'partitionItem',
  'relayAuthStatus', 'relayAuthSet', 'relayAuthVerify', 'relayProviderModel', 'relayProvidersClear', 'relayManagedRoutes',
  'relaySites', 'relaySnapshot', 'relayRows', 'relayRow', 'relayHistory', 'relayConcurrency', 'relaySvg', 'relayResolve', 'relayRetryMissing', 'tagsList', 'tagsSet',
];
const remoteInitializers = [];
for (const name of REMOTE_METHODS) {
  Remote(name)(ModelIntelligenceService.prototype[name], {
    kind: 'method', name, static: false, private: false,
    addInitializer(initialize) { remoteInitializers.push(initialize); },
  });
}
