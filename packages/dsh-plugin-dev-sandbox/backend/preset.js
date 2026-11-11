/**
 * Derive the "插件开发" agent preset from the live creative-mode declaration.
 *
 * The creative preset (`preset-cordis`) is a group row: the Loader keeps its
 * `config.plugins` list un-interpolated so each child row still evaluates its own
 * `!!js` expressions when it mounts. Reading that list from the preset registry and
 * re-registering it under our own id means this mode follows every upstream change
 * to creative mode automatically — nothing is copied into this repository.
 */
const PRESET_ID = 'plugin-dev';
const SOURCE_ID = 'cordis';
const PRESET_NAME = '插件开发';
const PRESET_DESCRIPTION = '开发并调试当前会话绑定的插件：独立 DSH 实例、真实终端、模型注入。组合跟随创造模式自动更新。';
const ORDER = 5;
const POLL_MS = 100;
const MAX_ATTEMPTS = 100;

export function registerDerivedPreset(ctx) {
  // Optional injection: a profile without the preset registry keeps the sandbox working.
  ctx.inject(['agentPresets'], (scope) => {
    const presets = scope.agentPresets;
    if (!presets || typeof presets.register !== 'function') return;
    let attempts = 0;
    let timer;
    let release;
    let settled = false;

    const stopPolling = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const warn = (message) => { try { ctx.logger?.warn?.(`plugin-dev preset: ${message}`); } catch { /* logging is best effort */ } };

    const attempt = () => {
      if (settled) return;
      attempts += 1;
      // `definitions` holds the parsed declarations (including the raw child rows).
      const definitions = presets.definitions;
      if (!(definitions instanceof Map)) {
        settled = true;
        stopPolling();
        warn('preset registry does not expose definitions; the derived mode is unavailable');
        return;
      }
      const record = definitions.get(SOURCE_ID);
      const plugins = record?.config?.plugins;
      if (!Array.isArray(plugins) || plugins.length === 0) {
        if (attempts >= MAX_ATTEMPTS) { settled = true; stopPolling(); warn(`creative preset "${SOURCE_ID}" never registered`); }
        return;
      }
      settled = true;
      stopPolling();
      if (definitions.has(PRESET_ID)) return;
      Promise.resolve(presets.register({
        id: PRESET_ID,
        name: PRESET_NAME,
        description: PRESET_DESCRIPTION,
        order: ORDER,
        plugins,
      })).then(
        (dispose) => { release = dispose; },
        (error) => warn(`registration failed: ${error?.message ?? error}`),
      );
    };

    scope.effect(() => {
      timer = setInterval(attempt, POLL_MS);
      attempt();
      return () => {
        settled = true;
        stopPolling();
        if (typeof release === 'function') { try { void release(); } catch { /* already gone */ } }
      };
    }, 'plugin-dev.preset');
  });
}
