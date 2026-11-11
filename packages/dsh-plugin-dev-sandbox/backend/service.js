import path from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote, Remote, RemoteError, principalOf } from '@deepseek-ai/dsh-typert-protocol';
import { createSandboxManager } from './manager.js';
import { requestSchema } from './contract.js';

/** Workspace authority always comes from the Host's existing session, never the wire. */
export async function sessionInput(ctx, sessionId) {
  const resolved = await ctx.sessionController.resolveAgent(sessionId);
  if (!resolved || typeof resolved !== 'object') throw new Error('Session not found');
  if ('error' in resolved) throw new Error(resolved.error?.message || 'Session not found');
  const agent = 'session' in resolved ? resolved : resolved.agent;
  if (!agent?.session) throw new Error('Session not found');
  const { session } = agent;
  if (session.id !== sessionId) throw new Error('Session identity mismatch');
  const workspaceRoot = session.header.cwd;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new Error('Session has no absolute original workspace');
  }
  return { workspaceRoot, sessionId };
}

export function assertOwnerInvocation(invocation) {
  if (!invocation || invocation.peer?.principal?.kind !== 'owner' || principalOf(invocation)) {
    throw new RemoteError('plugin-dev/owner-required', 'Only the owner can access plugin sandboxes.', {});
  }
}

// Provider profiles keep request headers (which may hold bearer credentials) out of
// the sandbox; `apiKeyEnv` is only a credential *name*, never a secret value.
const UNSAFE_PROFILE_KEY = /token|secret|password|credential|authorization/i;

function safeProfile(value, modelIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const profile = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'headers') { profile.headers = {}; continue; }
    if (UNSAFE_PROFILE_KEY.test(key) && key !== 'apiKeyEnv') continue;
    if (key === 'models' && Array.isArray(item)) {
      profile.models = item.filter((model) => model && typeof model === 'object' && modelIds.has(String(model.id))).map((model) => structuredClone(model));
      continue;
    }
    if (key === 'modelOverrides' && item && typeof item === 'object') {
      profile.modelOverrides = Object.fromEntries(Object.entries(item).filter(([id]) => modelIds.has(id)).map(([id, override]) => [id, structuredClone(override)]));
      continue;
    }
    profile[key] = structuredClone(item);
  }
  return Object.keys(profile).length ? profile : undefined;
}

export class PluginDevService extends Service {
  constructor(ctx, manager) {
    super(ctx, 'pluginDev');
    this.manager = manager ?? createSandboxManager({ subprocess: ctx.get('subprocess') });
    this.typertRemote = bindTypertRemote(this, 'pluginDev');
    for (const initialize of remoteInitializers) initialize.call(this);
  }

  /** Listed for the panel: every routable provider and its models. */
  async catalog() {
    const llm = this.ctx.get('llm');
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      throw new Error('The LLM service is unavailable in this profile');
    }
    const providers = await Promise.all(llm.listProviders().map(async (provider) => {
      try {
        const models = await llm.listModels(provider.id);
        return { id: provider.id, name: provider.name, models: models.map((model) => ({
          id: model.id, name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
        })) };
      } catch (error) {
        return { id: provider.id, name: provider.name, models: [], error: error.message };
      }
    }));
    return { providers };
  }

  /** Translate the saved selection into overlay patches for the sandbox profile. */
  async modelPatches(selected) {
    if (!Array.isArray(selected) || selected.length === 0) return [];
    const settings = this.ctx.get('settings');
    const llm = this.ctx.get('llm');
    if (!settings || typeof settings.describe !== 'function' || !llm || typeof llm.listConfigurableProviders !== 'function') return [];
    const described = settings.describe({ redactSecrets: true });
    const patches = new Map();
    for (const entry of llm.listConfigurableProviders()) {
      const models = new Set(selected.filter((item) => item.provider === entry.provider).map((item) => item.model));
      if (models.size === 0) continue;
      const namespace = described.find((item) => item.ns === entry.settingsNs);
      if (!namespace) continue;
      let profile = namespace.value;
      for (const segment of entry.settingsPath ?? []) {
        if (!profile || typeof profile !== 'object') { profile = undefined; break; }
        profile = profile[segment];
      }
      profile = profile?.[entry.provider] ?? profile;
      const sanitized = safeProfile(profile, models);
      if (!sanitized) continue;
      // settingsPath already names the provider slot (["providers", provider]), so
      // appending the provider again would nest it one level too deep and the
      // sandbox route would come up without models.
      const segments = [...(entry.settingsPath ?? [])];
      if (segments.at(-1) !== entry.provider) segments.push(entry.provider);
      const patch = patches.get(entry.settingsNs) ?? { id: entry.settingsNs, config: {} };
      let target = patch.config;
      for (const segment of segments.slice(0, -1)) {
        target[segment] = target[segment] && typeof target[segment] === 'object' ? target[segment] : {};
        target = target[segment];
      }
      target[segments.at(-1)] = sanitized;
      patches.set(entry.settingsNs, patch);
    }
    return [...patches.values()];
  }

  /**
   * Copy the selected providers' credentials into the sandbox DSH home. Values stay
   * in the Host process and only reach the isolated `.credentials.yaml` (mode 0600).
   */
  async credentialEntries(patches) {
    const credentials = this.ctx.get('credentials');
    if (!credentials || typeof credentials.resolve !== 'function') return [];
    const refs = new Set();
    for (const patch of patches) {
      const providers = patch?.config?.providers;
      if (!providers || typeof providers !== 'object') continue;
      for (const profile of Object.values(providers)) {
        if (profile && typeof profile === 'object' && typeof profile.apiKeyEnv === 'string') refs.add(profile.apiKeyEnv);
      }
    }
    const entries = [];
    for (const ref of refs) {
      try {
        const resolved = await credentials.resolve(ref);
        if (resolved && typeof resolved.value === 'string' && resolved.value.length > 0) entries.push({ ref, value: resolved.value });
      } catch { /* An unresolvable reference is reported by the provider at call time. */ }
    }
    return entries;
  }

  // Called by both the Remote adapter and the model tool; all semantics live here.
  async dispatch(request) {
    const parsed = requestSchema.parse(request);
    const input = await sessionInput(this.ctx, parsed.sessionId);
    const action = parsed.action;
    if (action === 'bind' && !parsed.pluginPath) throw new Error('pluginPath is required for bind');
    if (action === 'run' && !parsed.commandId) throw new Error('commandId is required for run');
    if ((action === 'terminalWrite' || action === 'terminalClose') && !parsed.terminalId) throw new Error('terminalId is required for terminal operations');
    if (action === 'terminalWrite' && typeof parsed.data !== 'string') throw new Error('data is required for terminalWrite');
    if (action === 'models') return this.catalog();
    if (action === 'saveModels') {
      const { providers } = await this.catalog();
      const known = new Set(providers.flatMap((provider) => provider.models.map((model) => `${provider.id}\u0000${model.id}`)));
      const selected = parsed.selectedModels ?? [];
      const unknown = selected.find((item) => !known.has(`${item.provider}\u0000${item.model}`));
      if (unknown) throw new Error(`Unknown model selection: ${unknown.provider}/${unknown.model}`);
      return this.manager.saveModels({ ...input, selectedModels: selected });
    }
    if (action === 'launch') {
      const current = await this.manager.status(input);
      const patches = await this.modelPatches(current.models);
      const credentials = await this.credentialEntries(patches);
      return this.manager.launch({ ...input, modelPatches: patches, credentials });
    }
    // Manager actions receive only the fields the caller actually supplied.
    const fields = {};
    for (const key of ['pluginPath', 'commandId', 'terminalId', 'data', 'rows', 'cols']) {
      if (parsed[key] !== undefined) fields[key] = parsed[key];
    }
    return this.manager[action]({ ...input, ...fields });
  }

  async execute(request) {
    // Gateway scopes Cordis services with the current invocation. Missing context
    // is denied by default so a broken adapter cannot grant owner privileges.
    assertOwnerInvocation(this.ctx?.invocation);
    try { return await this.dispatch(request); }
    catch (error) { throw new RemoteError('plugin-dev/operation-failed', error.message, {}); }
  }
}
// Apply the public standard-decorator API in plain JavaScript (not private markers).
const remoteInitializers = [];
Remote('execute')(PluginDevService.prototype.execute, {
  kind: 'method', name: 'execute', static: false, private: false,
  addInitializer(initialize) { remoteInitializers.push(initialize); },
});
