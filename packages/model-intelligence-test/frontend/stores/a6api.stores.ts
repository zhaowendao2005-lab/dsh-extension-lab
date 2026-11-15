import { createStore } from 'zustand/vanilla';
import type { A6Channel, A6Draft, A6Operation, A6Preferences, A6Selection, A6State, ModelIntelligenceTransport, StoredRecord } from '../types';
import { consumeA6SelectionLink, copyA6Configuration, createA6Record, performA6Action, readA6Bridge, readA6Preferences, readA6Selections, readConsumedA6Selections, rememberConsumedA6Selection, watchA6SelectionLinks, writeA6Preferences } from './a6api.datasource';

export const a6ChannelKey = (row: A6Channel): string => JSON.stringify([row.listingId, row.channelId, row.supplierId, row.model]);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const preferencesOf = (draft: A6Draft): A6Preferences => ({ slots: draft.slots.map(slot => ({ ...slot })), ...(draft.timeoutMs !== undefined ? { timeoutMs: draft.timeoutMs } : {}) });

/** Selection facts and editable drafts live here. IO only crosses the domain datasource. */
export function createA6Domain(transport: ModelIntelligenceTransport, callbacks: {
  open(selectionId: string): void;
  activate(selectionId: string): void;
  created(record: StoredRecord, attemptId: string): void;
}) {
  const store = createStore<A6State>(() => ({ selections: [], drafts: {}, loaded: false, bridge: null, bridgeLoading: false, copying: false }));
  const consumedIds = new Set(readConsumedA6Selections());
  const seenIds = new Set<string>();
  let pendingActivation: string | undefined;
  const preferenceRevisions = new Map<string, number>();
  let revision = -1;
  let disposed = false;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingLink = consumeA6SelectionLink();
  const unwatchLinks = watchA6SelectionLinks(id => { pendingLink = id; revealLink(); });

  function patch(id: string, value: Partial<A6Draft>): void {
    if (disposed || !store.getState().drafts[id]) return;
    store.setState(state => ({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], ...value } } }));
  }
  function selectionOf(id: string): A6Selection | undefined { return store.getState().selections.find(item => item.id === id); }
  function ensureDraft(id: string): A6Draft | undefined {
    const existing = store.getState().drafts[id];
    if (existing) return existing;
    const selection = selectionOf(id);
    if (!selection) return undefined;
    const draft: A6Draft = { name: `a6api 专项 · ${new Date(selection.createdAt).toLocaleString('zh-CN')}`, models: [...selection.models], slots: selection.tokens.map(token => ({ tokenId: token.id, provider: '' })), loading: false, dirty: false, saving: false, creating: false };
    store.setState(state => ({ drafts: { ...state.drafts, [id]: draft } }));
    void loadPreferences(id);
    return draft;
  }
  function tryActivation(): void {
    if (!pendingActivation) return;
    const id = pendingActivation;
    if (!selectionOf(id)) { pendingActivation = undefined; return; }
    try {
      callbacks.activate(id);
      callbacks.open(id);
      consumedIds.add(id);
      rememberConsumedA6Selection(id);
      pendingActivation = undefined;
      patch(id, { activationError: undefined });
    } catch (error) {
      patch(id, { activationError: `专项已接收，等待会话侧栏就绪：${message(error)}。将自动重试打开。` });
    }
  }
  function reveal(id: string, activate: boolean): void {
    if (!ensureDraft(id)) return;
    callbacks.open(id);
    if (activate) { pendingActivation = id; tryActivation(); }
  }
  function revealLink(): void {
    if (!pendingLink || !selectionOf(pendingLink)) return;
    const id = pendingLink;
    pendingLink = undefined;
    reveal(id, true);
  }
  async function poll(): Promise<void> {
    if (disposed || polling) return;
    polling = true;
    try {
      const result = await readA6Selections(transport, revision);
      if (disposed) return;
      if (!('unchanged' in result)) {
        const initialized = store.getState().loaded;
        const recent = result.selections.filter(item => !consumedIds.has(item.id) && item.createdAt <= Date.now() && Date.now() - item.createdAt <= 120_000).sort((a, b) => b.createdAt - a.createdAt)[0];
        const fresh = initialized ? result.selections.filter(item => !seenIds.has(item.id) && !consumedIds.has(item.id)) : recent ? [recent] : [];
        for (const selection of result.selections) seenIds.add(selection.id);
        revision = result.revision;
        store.setState({ selections: result.selections, loaded: true, error: undefined });
        // Existing IDs establish the baseline. A recent, unconsumed selection also survives first client wake-up.
        for (const selection of fresh.sort((a, b) => a.createdAt - b.createdAt)) if (selection.id !== pendingLink) reveal(selection.id, true);
        revealLink();
      } else store.setState({ loaded: true, error: undefined });
      tryActivation();
    } catch (error) {
      if (!disposed) store.setState({ error: `a6api 选择同步失败：${message(error)}，稍后自动重试。` });
    } finally {
      polling = false;
      if (!disposed) timer = setTimeout(() => { timer = undefined; void poll(); }, store.getState().error ? 3_000 : 2_000);
    }
  }
  async function loadPreferences(id: string): Promise<void> {
    const draft = store.getState().drafts[id];
    const selection = selectionOf(id);
    if (!draft || !selection || draft.loading || draft.saving || draft.creating) return;
    const request = (preferenceRevisions.get(id) ?? 0) + 1;
    preferenceRevisions.set(id, request);
    patch(id, { loading: true, error: undefined, feedback: undefined });
    try {
      const preferences = await readA6Preferences(transport, id);
      if (disposed || request !== preferenceRevisions.get(id)) return;
      const tokens = new Set(selection.tokens.map(token => token.id));
      const unique = new Map(preferences.slots.filter(slot => tokens.has(slot.tokenId)).map(slot => [slot.tokenId, slot]));
      const slots = unique.size ? [...unique.values()].map(slot => ({ ...slot })) : selection.tokens.map(token => ({ tokenId: token.id, provider: '' }));
      patch(id, { slots, timeoutMs: preferences.timeoutMs, loading: false, dirty: false, feedback: '已读取当前 Host profile 与账号的槽位映射。' });
    } catch (error) { patch(id, { loading: false, error: `读取映射失败：${message(error)}` }); }
  }
  function validation(id: string): string | undefined {
    const draft = store.getState().drafts[id];
    const selection = selectionOf(id);
    if (!draft || !selection) return '原网页选择已不可用，请回到 a6api 页面重新选择。';
    if (!draft.slots.length) return '请至少启用一个 token 槽位，并手动选择对应的 DSH 提供方。';
    if (draft.slots.some(slot => !slot.provider.trim())) return '每个启用的 token 槽位都必须手动选择 DSH 提供方。';
    if (new Set(draft.slots.map(slot => slot.tokenId)).size !== draft.slots.length) return '同一个 token 不能重复用作槽位。';
    if (draft.slots.some(slot => !selection.tokens.some(token => token.id === slot.tokenId))) return '部分 token 已不在网页选择中，请重新读取映射。';
    if (draft.timeoutMs !== undefined && (!Number.isFinite(draft.timeoutMs) || draft.timeoutMs <= 0)) return '单请求最大时长必须大于 0。';
    return undefined;
  }
  async function savePreferences(id: string): Promise<void> {
    const draft = store.getState().drafts[id];
    if (!draft || draft.loading || draft.saving || draft.creating) return;
    const error = validation(id);
    if (error) { patch(id, { error }); return; }
    patch(id, { saving: true, error: undefined, feedback: undefined });
    try {
      await writeA6Preferences(transport, id, preferencesOf(draft));
      patch(id, { saving: false, dirty: false, feedback: '映射已保存到当前 Host profile 与账号。' });
    } catch (error) { patch(id, { saving: false, error: `保存映射失败：${message(error)}` }); }
  }
  async function submit(id: string): Promise<void> {
    const draft = store.getState().drafts[id];
    if (!draft || draft.loading || draft.creating || draft.saving || draft.pending) return;
    const error = validation(id) ?? (!draft.models.length ? '请保留至少一项参测渠道。' : draft.models.length > 64 ? '每条专项测试最多 64 项，请先移除多余项。' : undefined);
    if (error) { patch(id, { error }); return; }
    patch(id, { creating: true, error: undefined, feedback: undefined });
    try {
      const { record, attemptId } = await createA6Record(transport, { selectionId: id, name: draft.name.trim() || 'a6api 专项测试', ...preferencesOf(draft), models: draft.models.map(row => ({ ...row })) });
      if (disposed) return;
      patch(id, { creating: false, feedback: '专项记录已持久保存，已打开测试记录。' });
      callbacks.created(record, attemptId);
    } catch (error) { patch(id, { creating: false, error: `创建专项测试失败：${message(error)}` }); }
  }
  async function action(id: string, operation: A6Operation): Promise<void> {
    const draft = store.getState().drafts[id];
    const selection = selectionOf(id);
    if (!draft || !selection || draft.pending || draft.creating) return;
    const channel = draft.models.find(row => a6ChannelKey(row) === draft.targetChannel);
    const token = selection.tokens.find(token => token.id === draft.targetTokenId);
    if (!channel || !token) { patch(id, { error: '请明确选择一个 token 和一个渠道目标。' }); return; }
    patch(id, { pending: operation, error: undefined, result: undefined });
    try {
      const result = await performA6Action(transport, { selectionId: id, tokenId: token.id, model: channel.model, channelId: channel.channelId, operation });
      const target = result.result && 'target' in result.result ? result.result.target as {model?: string; channelId?: number} : undefined;
      patch(id, { pending: undefined, result: `${operation === 'restore' && result.result && 'skipped' in result.result && result.result.skipped ? '无需恢复（没有待恢复的固定操作）' : `${({ pin: '固定', route: '加入路由', restore: '恢复' })[operation]}成功`} · token ${token.name} (#${token.id}) · ${target?.model??channel.model} / 渠道 #${target?.channelId??channel.channelId}${result.result ? `\n${JSON.stringify(result.result, null, 2)}` : ''}` });
    } catch (error) { patch(id, { pending: undefined, error: `${({ pin: '固定', route: '加入路由', restore: '恢复' })[operation]}失败：${message(error)}` }); }
  }
  async function loadBridge(): Promise<void> {
    if (disposed || store.getState().bridgeLoading) return;
    store.setState({ bridgeLoading: true, bridgeError: undefined, bridgeFeedback: undefined });
    try {
      const bridge = await readA6Bridge(transport);
      if (!disposed) store.setState({ bridge, bridgeLoading: false });
    } catch (error) { if (!disposed) store.setState({ bridgeLoading: false, bridgeError: `读取连接配置失败：${message(error)}` }); }
  }
  async function copyBridge(): Promise<void> {
    const state = store.getState();
    if (disposed || state.copying || !state.bridge) return;
    store.setState({ copying: true, bridgeFeedback: undefined, bridgeError: undefined });
    try { await copyA6Configuration(state.bridge.configuration); if (!disposed) store.setState({ copying: false, bridgeFeedback: '连接配置已复制，请粘贴到 a6api 油猴脚本的连接设置。' }); }
    catch (error) { if (!disposed) store.setState({ copying: false, bridgeError: message(error) }); }
  }

  void poll();
  return {
    store,
    open(id: string): void { reveal(id, false); },
    patch(id: string, value: Partial<Pick<A6Draft, 'name' | 'timeoutMs' | 'targetTokenId' | 'targetChannel'>>): void {
      const draft = store.getState().drafts[id];
      if (!draft || draft.loading || draft.creating || draft.saving || draft.pending) return;
      patch(id, { ...value, error: undefined, feedback: undefined, ...(Object.hasOwn(value, 'timeoutMs') ? { dirty: true } : {}) });
    },
    removeModel(id: string, key: string): void {
      const draft = store.getState().drafts[id];
      if (draft && !draft.creating && !draft.pending) patch(id, { models: draft.models.filter(row => a6ChannelKey(row) !== key), ...(draft.targetChannel === key ? { targetChannel: undefined } : {}), error: undefined });
    },
    toggleSlot(id: string, tokenId: number): void {
      const draft = store.getState().drafts[id];
      if (!draft || draft.loading || draft.creating || draft.saving || !selectionOf(id)?.tokens.some(token => token.id === tokenId)) return;
      patch(id, { slots: draft.slots.some(slot => slot.tokenId === tokenId) ? draft.slots.filter(slot => slot.tokenId !== tokenId) : [...draft.slots, { tokenId, provider: '' }], dirty: true, error: undefined, feedback: undefined });
    },
    setProvider(id: string, tokenId: number, provider: string): void {
      const draft = store.getState().drafts[id];
      if (draft && !draft.loading && !draft.creating && !draft.saving) patch(id, { slots: draft.slots.map(slot => slot.tokenId === tokenId ? { ...slot, provider } : slot), dirty: true, error: undefined, feedback: undefined });
    },
    loadPreferences, savePreferences, submit, action, loadBridge, copyBridge,
    dispose(): void { if (disposed) return; disposed = true; if (timer !== undefined) clearTimeout(timer); unwatchLinks(); },
  };
}
