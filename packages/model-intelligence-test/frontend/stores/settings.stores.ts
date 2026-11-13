import {createStore} from 'zustand/vanilla';
import type {ManagedModel, ModelIntelligenceTransport, RelayApi, RelaySettingsState} from '../types';
import {clearProviders, readAuth, readManagedRoutes, setProviderModel, verifyAuth, writeAuth} from './settings.datasource';

type Field = 'apiKey' | 'accessToken' | 'userId';
const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

/** Relay site settings: credential *status* (never values), the access-token check and plugin-managed providers. */
export function createSettingsDomain(transport: ModelIntelligenceTransport) {
  const store = createStore<RelaySettingsState>(() => ({
    siteId: 'a6api', loading: false, drafts: {apiKey: '', accessToken: '', userId: ''}, addFormat: 'chat', addModel: '', managedRoutes: [], managedReadOnly: false, managedSnippet: '', confirmClear: false,
  }));
  let disposed = false;
  let loaded = false;

  function run(busy: RelaySettingsState['busy'], work: () => Promise<Partial<RelaySettingsState>>, done?: string): void {
    if (disposed || store.getState().busy) return;
    store.setState({busy, error: undefined, message: undefined});
    void work().then(patch => { if (!disposed) store.setState({...patch, busy: undefined, ...(done ? {message: done} : {})}); })
      .catch(error => { if (!disposed) store.setState({busy: undefined, error: message(error, '操作失败')}); });
  }

  function load(): void {
    if (disposed) return;
    const {siteId} = store.getState();
    store.setState({loading: true, error: undefined});
    void Promise.all([readAuth(transport, siteId), readManagedRoutes(transport).catch(() => [] as string[])]).then(([status, managedRoutes]) => {
      if (disposed) return;
      loaded = true;
      store.setState({status, managedRoutes, loading: false, drafts: {...store.getState().drafts, userId: status.userId.value ?? store.getState().drafts.userId}});
    }).catch(error => { if (!disposed) store.setState({loading: false, error: message(error, '读取中转站设置失败')}); });
  }

  return {
    store,
    ensure(): void { if (!loaded && !store.getState().loading) load(); },
    load,
    draft(field: Field, value: string): void { store.setState({drafts: {...store.getState().drafts, [field]: value}, message: undefined}); },
    save(): void {
      const {siteId, drafts, status} = store.getState();
      const patch: {apiKey?: string; accessToken?: string; userId?: string} = {};
      if (drafts.apiKey.trim()) patch.apiKey = drafts.apiKey.trim();
      if (drafts.accessToken.trim()) patch.accessToken = drafts.accessToken.trim();
      if (drafts.userId.trim() && drafts.userId.trim() !== (status?.userId.value ?? '')) patch.userId = drafts.userId.trim();
      if (!Object.keys(patch).length) { store.setState({message: '没有需要保存的变更'}); return; }
      run('save', async () => {
        const next = await writeAuth(transport, {siteId, ...patch});
        return {status: next, drafts: {apiKey: '', accessToken: '', userId: next.userId.value ?? ''}};
      }, '已保存到 DSH 凭据存储');
    },
    clear(field: Field): void {
      const {siteId} = store.getState();
      run('save', async () => {
        const next = await writeAuth(transport, {siteId, [field]: null});
        return {status: next, drafts: {...store.getState().drafts, [field]: ''}};
      }, '已清除');
    },
    verify(): void {
      const {siteId} = store.getState();
      run('verify', async () => ({status: await verifyAuth(transport, siteId)}), '系统访问令牌校验通过');
    },
    addForm(value: {format?: RelayApi; model?: string}): void {
      store.setState({...(value.format ? {addFormat: value.format} : {}), ...(value.model !== undefined ? {addModel: value.model} : {})});
    },
    addModel(): void {
      const {siteId, addFormat, addModel, status} = store.getState();
      const model = addModel.trim();
      if (!model) { store.setState({error: '请填写模型名称'}); return; }
      run('provider', async () => {
        const result = await setProviderModel(transport, {siteId, format: addFormat, model});
        return {
          addModel: '',
          managedReadOnly: !result.applied,
          managedSnippet: result.snippet,
          managedReason: result.reason,
          ...(status ? {status: {...status, providers: result.providers}} : {}),
        };
      }, undefined);
    },
    /** Add one model to the plugin-managed providers on behalf of the 加入模型池 dialog. */
    async addDirect(format: RelayApi, model: string, extras?: {channelId?: number; image?: boolean; reasoning?: boolean; contextWindow?: number}): Promise<{applied: boolean; reason?: string}> {
      const {siteId, status} = store.getState();
      const result = await setProviderModel(transport, {siteId, format, model, ...extras});
      if (!disposed) store.setState({managedReadOnly: !result.applied, managedSnippet: result.snippet, managedReason: result.reason, ...(status ? {status: {...status, providers: result.providers}} : {})});
      return {applied: result.applied, reason: result.reason};
    },
    /** Capability overrides: the adapter registered this model, so the change is live immediately. */
    toggleTrait(format: RelayApi, model: ManagedModel, trait: 'image' | 'reasoning'): void {
      const {siteId, status} = store.getState();
      const value = !(trait === 'image' ? model.image : model.reasoning);
      run('provider', async () => {
        const result = await setProviderModel(transport, {
          siteId, format, model: model.id, channelId: model.channelId, image: model.image, reasoning: model.reasoning, contextWindow: model.contextWindow,
          [trait]: value,
        } as Parameters<typeof setProviderModel>[1]);
        return {
          managedReadOnly: !result.applied,
          managedSnippet: result.snippet,
          managedReason: result.reason,
          ...(status ? {status: {...status, providers: result.providers}} : {}),
        };
      }, undefined);
    },
    removeModel(format: RelayApi, model: string, channelId?: number): void {
      const {siteId, status} = store.getState();
      run('provider', async () => {
        const result = await setProviderModel(transport, {siteId, format, model, channelId, remove: true});
        return {
          managedReadOnly: !result.applied,
          managedSnippet: result.snippet,
          managedReason: result.reason,
          ...(status ? {status: {...status, providers: result.providers}} : {}),
        };
      }, undefined);
    },
    requestClear(): void { store.setState({confirmClear: true}); },
    cancelClear(): void { store.setState({confirmClear: false}); },
    clearProviders(): void {
      store.setState({confirmClear: false});
      const {siteId, status} = store.getState();
      run('clear', async () => {
        const result = await clearProviders(transport, siteId);
        return {
          managedReadOnly: !result.applied,
          managedSnippet: result.snippet,
          managedReason: result.reason || undefined,
          ...(status ? {status: {...status, providers: result.providers}} : {}),
        };
      }, undefined);
    },
    /** Copy the generated config block; the clipboard is a browser facility, so it stays out of the views. */
    copySnippet(): void {
      const snippet = store.getState().managedSnippet;
      if (!snippet) return;
      const done = (): void => { if (!disposed) store.setState({message: '已复制配置片段'}); };
      const legacy = (): boolean => {
        if (typeof document === 'undefined') return false;
        const field = document.createElement('textarea');
        field.value = snippet;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        let ok = false;
        try { ok = typeof document.execCommand === 'function' && document.execCommand('copy'); } catch { ok = false; }
        field.remove();
        if (ok) done();
        else if (!disposed) store.setState({message: '复制失败，请手动选择片段文本复制'});
        return ok;
      };
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard || typeof clipboard.writeText !== 'function') { legacy(); return; }
      // Electron and plain HTTP origins can refuse the async clipboard even though execCommand still works.
      void clipboard.writeText(snippet).then(done, () => { legacy(); });
    },
    dispose(): void { disposed = true; },
  };
}
