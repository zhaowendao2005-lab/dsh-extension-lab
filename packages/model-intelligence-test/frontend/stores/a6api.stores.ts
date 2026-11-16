import { createStore } from 'zustand/vanilla';
import type { A6Channel, A6Config, A6Draft, A6Operation, A6Selection, A6State, ModelIntelligenceTransport, StoredRecord } from '../types';
import { copyIntakeToken, createA6Record, oneClickLink, performA6Action, readA6Config, readA6Selections, rotateA6Intake, writeA6Config } from './a6api.datasource';

export const a6ChannelKey = (row: A6Channel): string => JSON.stringify([row.listingId, row.channelId, row.supplierId, row.model]);
export const a6ChannelOf = (rows: A6Channel[], key: string): A6Channel | undefined => rows.find(row => a6ChannelKey(row) === key);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Selections pushed by the userscript, plus per-selection drafts.
 * There is no pairing state any more: the page authenticates itself with the intake token and the
 * Host owns every a6api write, so this store only polls selections and edits a draft.
 */
export function createA6Domain(transport: ModelIntelligenceTransport, callbacks: {
  open(selectionId: string): void;
  created(record: StoredRecord, attemptId: string): void;
}) {
  const store = createStore<A6State>(() => ({ selections: [], drafts: {}, loaded: false, config: null, configLoading: false, form: { accessToken: '', userId: '' }, saving: false, rotating: false, copying: false }));
  const seen = new Set<string>();
  let primed = false;
  let revision = -1;
  let disposed = false;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function patch(id: string, value: Partial<A6Draft>): void {
    if (disposed || !store.getState().drafts[id]) return;
    store.setState(state => ({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], ...value } } }));
  }
  const selectionOf = (id: string): A6Selection | undefined => store.getState().selections.find(item => item.id === id);

  function ensureDraft(id: string): A6Draft | undefined {
    const existing = store.getState().drafts[id];
    if (existing) return existing;
    const selection = selectionOf(id);
    if (!selection) return undefined;
    const draft: A6Draft = {
      name: `a6api 专项 · ${new Date(selection.createdAt).toLocaleString('zh-CN')}`,
      models: [...selection.models],
      tokens: selection.tokens.map(token => token.id),
      creating: false,
    };
    store.setState(state => ({ drafts: { ...state.drafts, [id]: draft } }));
    return draft;
  }

  async function poll(): Promise<void> {
    if (disposed || polling) return;
    polling = true;
    try {
      const view = await readA6Selections(transport, revision);
      if (disposed) return;
      revision = view.revision;
      if (!('unchanged' in view)) {
        const fresh: string[] = [];
        for (const selection of view.selections) {
          if (seen.has(selection.id)) continue;
          seen.add(selection.id);
          // The first listing is history, not a push: only later arrivals steal focus.
          if (primed) fresh.push(selection.id);
        }
        primed = true;
        store.setState({ selections: view.selections, loaded: true, error: undefined });
        const newest = fresh.at(-1);
        if (newest) {
          ensureDraft(newest);
          callbacks.open(newest);
        }
      }
    } catch (error) {
      if (!disposed) store.setState({ error: message(error) });
    } finally {
      polling = false;
      if (!disposed) timer = setTimeout(() => void poll(), 2_000);
    }
  }

  return {
    store,
    start(): void {
      if (disposed) return;
      void poll();
      if (!store.getState().config) void this.loadConfig();
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
    open(selectionId: string): void {
      if (!ensureDraft(selectionId)) return;
      callbacks.open(selectionId);
    },
    patch(selectionId: string, value: Partial<Pick<A6Draft, 'name' | 'timeoutMs' | 'targetTokenId' | 'targetChannel'>>): void {
      patch(selectionId, value);
    },
    removeModel(selectionId: string, key: string): void {
      const draft = store.getState().drafts[selectionId];
      if (!draft) return;
      patch(selectionId, { models: draft.models.filter(row => a6ChannelKey(row) !== key), result: undefined });
    },
    toggleToken(selectionId: string, tokenId: number): void {
      const draft = store.getState().drafts[selectionId];
      if (!draft) return;
      const selected = draft.tokens.includes(tokenId);
      patch(selectionId, { tokens: selected ? draft.tokens.filter(id => id !== tokenId) : [...draft.tokens, tokenId], error: undefined, result: undefined });
    },
    async submit(selectionId: string): Promise<void> {
      const draft = store.getState().drafts[selectionId];
      if (!draft || draft.creating) return;
      if (!draft.models.length) { patch(selectionId, { error: '清单为空，请回到网页重新选择' }); return; }
      if (!draft.tokens.length) { patch(selectionId, { error: '请至少勾选一个测试令牌作为并发槽' }); return; }
      patch(selectionId, { creating: true, error: undefined, feedback: undefined });
      try {
        const { record, attemptId } = await createA6Record(transport, {
          selectionId, name: draft.name.trim() || 'a6api 专项指纹',
          slots: draft.tokens.map(tokenId => ({ tokenId })),
          models: draft.models,
          ...(draft.timeoutMs !== undefined ? { timeoutMs: draft.timeoutMs } : {}),
        });
        patch(selectionId, { creating: false, feedback: `已开始：${draft.models.length} 项 × ${draft.tokens.length} 槽` });
        callbacks.created(record, attemptId);
      } catch (error) {
        patch(selectionId, { creating: false, error: message(error) });
      }
    },
    async action(selectionId: string, operation: A6Operation): Promise<void> {
      const draft = store.getState().drafts[selectionId];
      const target = draft ? a6ChannelOf(draft.models, draft.targetChannel ?? '') : undefined;
      if (!draft || !target) { patch(selectionId, { error: '请先在清单里选择一个目标渠道' }); return; }
      if (!draft.targetTokenId) { patch(selectionId, { error: '请先选择一个测试令牌' }); return; }
      patch(selectionId, { pending: operation, error: undefined, result: undefined });
      try {
        const { result } = await performA6Action(transport, { selectionId, tokenId: draft.targetTokenId, model: target.model, channelId: target.channelId, operation });
        patch(selectionId, { pending: undefined, result: `${operation === 'restore' ? '已恢复' : operation === 'pin' ? '已固定' : '已加入路由'}：渠道 ${target.channelId} · ${result ? '已核对' : '未返回明细'}` });
      } catch (error) {
        patch(selectionId, { pending: undefined, error: message(error) });
      }
    },
    async loadConfig(): Promise<void> {
      if (store.getState().configLoading) return;
      store.setState({ configLoading: true, configError: undefined });
      try {
        const config = await readA6Config(transport);
        store.setState({ config: { ...config, link: oneClickLink(config) }, configLoading: false });
      } catch (error) {
        store.setState({ configLoading: false, configError: message(error) });
      }
    },
    patchForm(value: Partial<{ accessToken: string; userId: string }>): void {
      store.setState(state => ({ form: { ...state.form, ...value } }));
    },
    async saveConfig(): Promise<void> {
      if (store.getState().saving) return;
      const { accessToken, userId } = store.getState().form;
      store.setState({ saving: true, configError: undefined, configFeedback: undefined });
      try {
        const config: A6Config & { account: {id: number; name: string}; pins: number } = await writeA6Config(transport, accessToken, userId);
        store.setState({ config: { ...config, link: oneClickLink(config) }, saving: false, form: { accessToken: '', userId: '' }, configFeedback: `已验证：${config.account.name || config.account.id} · 现有固定 ${config.pins} 条` });
      } catch (error) {
        store.setState({ saving: false, configError: message(error) });
      }
    },
    async rotateIntake(): Promise<void> {
      if (store.getState().rotating) return;
      store.setState({ rotating: true, configError: undefined, configFeedback: undefined });
      try {
        const config = await rotateA6Intake(transport);
        store.setState({ config: { ...config, link: oneClickLink(config) }, rotating: false, configFeedback: '导入口令已更换，请在油猴面板里更新' });
      } catch (error) {
        store.setState({ rotating: false, configError: message(error) });
      }
    },
    async copyIntake(): Promise<void> {
      const token = store.getState().config?.intakeToken ?? '';
      store.setState({ copying: true });
      try {
        await copyIntakeToken(token);
        store.setState({ copying: false, configFeedback: '导入口令已复制' });
      } catch (error) {
        store.setState({ copying: false, configError: message(error) });
      }
    },
  };
}
