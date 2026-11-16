import { createStore } from '../store.js';
import { buildPathTree } from '../service/path-tree.js';
import { createCommandsDatasource } from './commands.datasource.js';

function initial() {
  return {
    phase: 'idle', packages: [], packageTree: null, selected: null,
    scripts: [], scriptsPhase: 'idle', packageInfo: null,
    collapsed: {}, running: [], error: null, scriptError: null,
    truncated: false, warnings: [], root: null,
  };
}

/** Presentation state only: package manifests and script commands always come from Host. */
export function createCommandsDomain({ client, workspace, notify, terminals, onRun }) {
  const store = createStore(initial());
  const source = createCommandsDatasource(client);
  let scanEpoch = 0;
  let scriptsEpoch = 0;
  let lifetime = 0;
  const rootOf = () => workspace.getSnapshot().root;

  async function selectPackage(path) {
    if (!store.getSnapshot().packages.some((item) => item.path === path)) return null;
    const epoch = ++scriptsEpoch;
    const root = rootOf();
    store.patch({ selected: path, scripts: [], packageInfo: null, scriptsPhase: 'loading', scriptError: null });
    try {
      const result = await source.packageScripts(path);
      if (epoch !== scriptsEpoch || root !== rootOf()) return null;
      store.patch({ scripts: result.scripts, packageInfo: result, scriptsPhase: 'ready', scriptError: null });
      return result;
    } catch (error) {
      if (epoch !== scriptsEpoch || root !== rootOf()) return null;
      store.patch({ scriptsPhase: 'error', scriptError: error?.message ?? '读取脚本失败' });
      notify?.('error', error?.message ?? '读取脚本失败', { code: error?.code });
      return null;
    }
  }

  async function load(inventory) {
    const root = rootOf();
    const epoch = ++scanEpoch;
    scriptsEpoch += 1;
    if (!root) { reset(); return null; }
    if (store.getSnapshot().root !== root) {
      lifetime += 1;
      store.set({ ...initial(), root });
    }
    store.patch({ phase: 'loading', error: null, scriptsPhase: 'idle' });
    try {
      const reusable = Array.isArray(inventory?.packages) && (inventory.phase === undefined || inventory.phase === 'ready');
      const result = reusable ? inventory : await source.scan();
      if (epoch !== scanEpoch || root !== rootOf()) return null;
      const packages = result.packages ?? [];
      const previous = store.getSnapshot().selected;
      const selected = packages.some((item) => item.path === previous) ? previous : (packages[0]?.path ?? null);
      store.patch({
        phase: 'ready', packages, packageTree: buildPathTree(packages, { rootName: 'package.json' }),
        selected, scripts: [], packageInfo: null, error: null,
        truncated: Boolean(result.truncated), warnings: result.warnings ?? [],
      });
      if (selected) await selectPackage(selected);
      return result;
    } catch (error) {
      if (epoch !== scanEpoch || root !== rootOf()) return null;
      store.patch({ phase: 'error', error: error?.message ?? '扫描 package.json 失败' });
      notify?.('error', error?.message ?? '扫描 package.json 失败', { code: error?.code });
      return null;
    }
  }

  async function run(pathOrScript, scriptName) {
    const path = scriptName === undefined ? store.getSnapshot().selected : pathOrScript;
    const script = scriptName === undefined ? pathOrScript : scriptName;
    if (!path || path !== store.getSnapshot().selected || !store.getSnapshot().scripts.some((item) => item.name === script)) return null;
    const key = JSON.stringify([path, script]);
    if (store.getSnapshot().running.includes(key)) return null;
    const root = rootOf();
    const generation = lifetime;
    const current = () => generation === lifetime && root === rootOf();
    store.patch({ running: [...store.getSnapshot().running, key], scriptError: null });
    try {
      const tab = await terminals.runScript(path, script);
      if (tab && current()) onRun?.(tab);
      else if (!tab && current() && path === store.getSnapshot().selected) store.patch({ scriptError: terminals.store?.getSnapshot().error ?? '无法运行脚本' });
      return tab;
    } catch (error) {
      if (current() && path === store.getSnapshot().selected) store.patch({ scriptError: error?.message ?? '无法运行脚本' });
      notify?.('error', error?.message ?? '无法运行脚本', { code: error?.code });
      return null;
    } finally {
      if (current()) store.patch({ running: store.getSnapshot().running.filter((item) => item !== key) });
    }
  }

  function toggle(id) {
    const collapsed = store.getSnapshot().collapsed;
    store.patch({ collapsed: { ...collapsed, [id]: !collapsed[id] } });
  }

  function reset() {
    lifetime += 1;
    scanEpoch += 1;
    scriptsEpoch += 1;
    store.set(initial());
  }

  return { store, load, selectPackage, toggle, run, reset };
}
