import { createHash } from 'node:crypto';
import { siteOf } from './site.js';
import { credentialName } from './auth.js';
import { RelayError } from './client.js';
import { inferImage, inferReasoning } from './traits.js';

/**
 * Option B: relay channels become ordinary pi-ai routes. One route per (site, API format):
 * `a6api-<format>-<hash4>`, pinned by a hash of this plugin + site so the routes can be
 * recognised and removed again.
 *
 * A DSH runtime whose `llm-pi-ai` section is owned by a home patch or a command-line overlay
 * refuses every settings write (`Configuration for "llm-pi-ai" is overridden by ...`). The
 * desktop profile and the plugin-dev sandbox are both such runtimes, so writing the config is
 * only the *preferred* path: the registry below always records what the user asked for, and
 * `snippet()` returns a ready-to-paste YAML block for the case where the write is refused.
 */
export const PI_NS = 'llm-pi-ai';
const FORMATS = {
  chat: { api: 'openai-completions', path: '', label: 'Chat Completions' },
  responses: { api: 'openai-responses', path: '/v1', label: 'Responses' },
  messages: { api: 'anthropic-messages', path: '', label: 'Anthropic Messages' },
};

function hash4(siteId, format) {
  return createHash('sha1').update(`model-intelligence-test:${siteId}:${format}`).digest('hex').slice(0, 4);
}
export function routeId(siteId, format) { return `${siteId}-${format}-${hash4(siteId, format)}`; }
export function managedRoutes(siteId) {
  return Object.keys(FORMATS).map(format => ({ format, id: routeId(siteId, format), ...FORMATS[format] }));
}
/** Every route id this plugin may own (for read-only display in Settings). */
export function allManagedRouteIds(siteIds) {
  return siteIds.flatMap(siteId => managedRoutes(siteId).map(route => route.id));
}
/** A settings write refused because the section belongs to a patch/overlay rather than the profile. */
function isReadOnlyConfig(error) {
  const message = String(error && error.message ? error.message : error);
  return /overridden by a home patch|command-line overlay|settings-rejected|read-only/i.test(message);
}

export class ManagedProviders {
  constructor(ctx, storage) { this.ctx = ctx; this.storage = storage; this.onChange = undefined; }

  /** Called after every registry write so the adapter can re-register its route set. */
  changed() {
    try { this.onChange?.(); } catch { /* a listener must never fail the write */ }
  }

  /**
   * The routes this plugin's own LLM adapter owns: registry rows only.
   *
   * Config rows (`source: 'config'`) belong to pi-ai and must never be claimed here — registering a
   * route that already has an adapter throws DUPLICATE_ADAPTER and would take the whole plugin down.
   */
  async adapterRoutes() {
    const table = await this.table();
    const routes = new Map();
    for (const [, value] of table.entries()) {
      if (!value || !Array.isArray(value.models) || !value.models.length) continue;
      const site = siteOf(value.siteId);
      const spec = FORMATS[value.format];
      if (!site || !spec) continue;
      const id = routeId(value.siteId, value.format);
      routes.set(id, {
        id,
        siteId: value.siteId,
        format: value.format,
        apiUrl: site.apiUrl,
        label: `${site.name} · ${spec.label}（模型智能测试）`,
        models: value.models.map(model => ({
          id: String(model.id),
          name: model.name ? String(model.name) : null,
          channelId: model.channelId === undefined || model.channelId === null ? undefined : Number(model.channelId),
          image: model.image,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow,
        })),
      });
    }
    return routes;
  }

  settings() {
    const service = this.ctx.get('settings');
    if (!service || typeof service.mutate !== 'function') throw new RelayError('settings-unavailable', '当前运行时没有设置服务，无法写入提供商');
    return service;
  }

  async table() {
    const domain = await this.storage.managed();
    if (!domain) throw new RelayError('storage-unavailable', '提供商注册表不可用');
    return domain.table('routes');
  }

  /** Registry rows: what the user asked to publish, independent of whether the write landed. */
  async registry(siteId) {
    const table = await this.table();
    const rows = new Map();
    for (const entry of table.entries()) {
      const value = entry[1];
      if (!value || value.siteId !== siteId) continue;
      rows.set(String(value.format), Array.isArray(value.models) ? value.models : []);
    }
    return rows;
  }

  async writeRegistry(siteId, format, models) {
    const table = await this.table();
    const key = `${siteId}-${format}`;
    if (!models.length) { await table.delete(key); return; }
    await table.put(key, { id: key, siteId, format, models });
  }

  /** Current models per managed route: the config wins when present, the registry fills the gap. */
  current(siteId) {
    const routes = managedRoutes(siteId);
    let providers = {};
    try {
      const descriptors = this.settings().describe({ redactSecrets: true });
      const entry = Array.isArray(descriptors) ? descriptors.find(item => String(item?.ns) === PI_NS) : null;
      providers = entry?.value?.providers ?? {};
    } catch { providers = {}; }
    return routes.map(route => {
      const config = providers[route.id];
      const models = Array.isArray(config?.models)
        ? config.models.map(model => ({ id: String(model.id), name: model.name ? String(model.name) : null }))
        : [];
      return { id: route.id, format: route.format, api: route.api, label: route.label, present: Boolean(config), models, source: config ? 'config' : 'registry' };
    });
  }

  /** Registry-filled view, used when the runtime refuses config writes. */
  async currentWithRegistry(siteId) {
    const routes = this.current(siteId);
    const registry = await this.registry(siteId);
    return routes.map(route => {
      if (route.models.length || !registry.has(route.format)) return route;
      return { ...route, models: registry.get(route.format).map(model => ({
        id: String(model.id),
        name: model.name ? String(model.name) : null,
        channelId: model.channelId === undefined || model.channelId === null ? undefined : Number(model.channelId),
        image: model.image === undefined ? undefined : Boolean(model.image),
        reasoning: model.reasoning === undefined ? undefined : Boolean(model.reasoning),
        contextWindow: Number.isInteger(model.contextWindow) ? model.contextWindow : undefined,
      })), source: 'registry' };
    });
  }

  /** Ready-to-paste provider block for the case where the plugin cannot write the config itself. */
  snippet(siteId, routes) {
    const site = siteOf(siteId);
    if (!site) return '';
    const lines = ['- id: llm-pi-ai', '  config:', '    providers:'];
    for (const route of routes) {
      if (!route.models.length) continue;
      lines.push(`      ${route.id}:`);
      lines.push(`        displayName: ${JSON.stringify(`${site.name} · ${route.label}（模型智能测试）`)}`);
      lines.push(`        api: ${route.api}`);
      lines.push(`        baseURL: ${JSON.stringify(`${site.apiUrl}${FORMATS[route.format]?.path ?? ''}`)}`);
      lines.push(`        apiKeyEnv: ${credentialName(siteId, 'apiKey')}`);
      lines.push('        models:');
      for (const model of route.models) lines.push(`          - id: ${model.id}${model.name ? `\n            name: ${model.name}` : ''}`);
    }
    return lines.join('\n');
  }

  /**
   * Add (or remove) one model on the route of the given format. Writes the runtime config when the
   * runtime allows it, and always records the intent in the registry so the UI can show the model
   * and hand back a config snippet when the write is refused.
   */
  async setModel(siteId, { format, model, name, remove = false, channelId, image, reasoning, contextWindow }) {
    const site = siteOf(siteId);
    if (!site) throw new RelayError('relay-unknown-site', '未适配的中转站');
    const spec = FORMATS[format];
    if (!spec) throw new RelayError('invalid-format', 'API 格式无效');
    const id = String(model ?? '').trim();
    if (!id || id.length > 256) throw new RelayError('invalid-model', '模型名称无效');
    const route = routeId(siteId, format);
    const registry = await this.registry(siteId);
    const channel = channelId === undefined || channelId === null ? undefined : Number(channelId);
    // One channel can host several models and several channels can host the same model, so the
    // identity of a published model is the (model, channel) pair, not the model name alone.
    const same = item => item.id === id && (item.channelId === undefined || item.channelId === null ? undefined : Number(item.channelId)) === channel;
    const existing = (registry.get(format) ?? []).filter(item => !same(item));
    // Image support and thinking levels are inferred from the model name by default (the user only
    // overrides them when the guess is wrong), so 加入模型池 needs no capability questionnaire.
    const extras = {
      ...(name ? { name: String(name).slice(0, 120) } : {}),
      ...(channel === undefined ? {} : { channelId: channel }),
      image: typeof image === 'boolean' ? image : inferImage(id),
      reasoning: typeof reasoning === 'boolean' ? reasoning : inferReasoning(id),
      ...(Number.isInteger(contextWindow) ? { contextWindow } : {}),
    };
    const models = remove ? existing : [...existing, { id, ...extras }];
    await this.writeRegistry(siteId, format, models);
    this.changed();

    let applied = false;
    let reason;
    try {
      const settings = this.settings();
      // The runtime config sees only the pi-ai field set; channel ids and trait overrides are ours.
      const configured = models.map(item => ({ id: item.id, ...(item.name ? { name: item.name } : {}) }));
      if (!models.length) await settings.mutate(PI_NS, [{ op: 'unset', path: ['providers', route] }]);
      else {
        await settings.mutate(PI_NS, [{
          op: 'set', path: ['providers', route], value: {
            displayName: `${site.name} · ${spec.label}（模型智能测试）`,
            api: spec.api, baseURL: `${site.apiUrl}${spec.path}`,
            apiKeyEnv: credentialName(siteId, 'apiKey'),
            models: configured,
          },
        }]);
      }
      applied = true;
    } catch (error) {
      if (!isReadOnlyConfig(error)) throw error;
      reason = '当前运行时的提供商配置由配置补丁或 overlay 提供，插件无法直接写入；模型已加入插件自带的适配器，可直接使用。';
    }
    const providers = await this.currentWithRegistry(siteId);
    return { providers, applied, reason, snippet: this.snippet(siteId, providers) };
  }

  /** Feature off / one-click cleanup: drop the registry and every route that is actually in config. */
  async clear(siteId) {
    const registry = await this.registry(siteId);
    for (const format of Object.keys(FORMATS)) await this.writeRegistry(siteId, format, []);
    this.changed();
    const present = this.current(siteId).filter(item => item.present);
    let reason;
    if (present.length) {
      try {
        await this.settings().mutate(PI_NS, present.map(route => ({ op: 'unset', path: ['providers', route.id] })));
      } catch (error) {
        if (!isReadOnlyConfig(error)) throw error;
        reason = '配置由配置补丁或 overlay 提供，插件无法删除其中的提供商，请手动移除。';
      }
    }
    const providers = await this.currentWithRegistry(siteId);
    return { providers, applied: !present.length, reason, snippet: routesWithModels(providers) ? this.snippet(siteId, providers) : '', cleared: registry.size };
  }
}

function routesWithModels(routes) {
  return routes.some(route => route.models.length > 0);
}
