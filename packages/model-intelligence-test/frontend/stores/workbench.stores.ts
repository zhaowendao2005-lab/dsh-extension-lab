import { createStore } from 'zustand/vanilla';
import type { ModelIntelligenceTransport, Model, Navigation, Notice, PartitionItem, Preset, RecordModelRef, RelayApi, Workbench, WorkbenchState } from '../types';
import { FIXED_FOOTER, FIXED_FOOTER_VERSION } from '../types';
import { createDraftStore, emptyDraft } from './draft.stores';
import { createModelsDomain } from './models.stores';
import { createPresetsDomain } from './presets.stores';
import { createEvaluationsDomain } from './evaluations.stores';
import { createPresentationDomain } from './presentation.stores';
import { createRelayDomain } from './relay.stores';
import { createSettingsDomain } from './settings.stores';
import { createTagsDomain } from './tags.stores';
import { createNoticeStore } from './notice.stores';

let sequence = 0;
const uniqueId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

/** Default protocol for a relay channel (mirrors the Host `defaultApi`). */
function relayApiOf(item: Pick<PartitionItem, 'brand' | 'model' | 'testEndpoint' | 'api'>): RelayApi {
  if (item.api) return item.api;
  if (/claude|anthropic/i.test(`${item.brand} ${item.model}`)) return 'messages';
  return item.testEndpoint === 'responses' ? 'responses' : 'chat';
}
function relayModelOf(item: PartitionItem): Model {
  const providerName = `${item.siteId} #${item.channelId}`;
  return {
    key: `relay:${item.key}`, provider: `relay:${item.siteId}:${item.channelId}`, providerName, id: item.model, name: item.model,
    search: `${providerName} ${item.supplier} ${item.channelName} ${item.model}`.toLowerCase(),
    relay: { siteId: item.siteId, channelId: item.channelId, model: item.model, api: relayApiOf(item) },
  };
}

/**
 * The single global workbench: records are Host-persisted and shared by every session, so one
 * instance serves all mounted panels. The plugin lifecycle owns dispose.
 */
export function createWorkbench(sessionId: string, transport: ModelIntelligenceTransport): Workbench {
  const draft = createDraftStore();
  const modelsDomain = createModelsDomain(transport, keys => draft.setState(state => ({ selected: state.selected.filter(key => keys.has(key)) })));
  const presetsDomain = createPresetsDomain();
  const evaluationsDomain = createEvaluationsDomain(transport);
  const presentationDomain = createPresentationDomain();
  const relayDomain = createRelayDomain(transport);
  const settingsDomain = createSettingsDomain(transport);
  const tagsDomain = createTagsDomain(transport);
  const stores = {
    workbench: createStore<WorkbenchState>(() => ({ tabs: [{ id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft', sidebarCollapsed: false, navigation: {} })),
    draft, models: modelsDomain.store, presets: presetsDomain.store, evaluations: evaluationsDomain.store, presentation: presentationDomain.store, relay: relayDomain.store, settings: settingsDomain.store, tags: tagsDomain.store, notice: createNoticeStore(),
  };
  const { workbench, models, presets, evaluations, notice } = stores;
  let disposed = false;
  let noticeAnswer: ((choice: string, input: string) => void) | undefined;

  function ask(value: Notice, answer: (choice: string, input: string) => void): void {
    if (disposed || notice.getState()) return;
    noticeAnswer = answer;
    notice.setState(value, true);
  }
  function showError(title: string, message: string): void {
    ask({ title, message, choices: [{ id: 'ok', label: '知道了' }] }, () => {});
  }
  function persist(items: Preset[]): boolean {
    const error = presetsDomain.persist(items);
    if (error) showError('预设保存失败', error);
    return error === undefined;
  }
  function saveDraft(after?: () => void): void {
    const value = draft.getState();
    const existing = presets.getState().items.find(item => item.id === value.presetId);
    if (existing) {
      const updated = { ...existing, body: value.body };
      if (persist(presets.getState().items.map(item => item.id === existing.id ? updated : item))) {
        draft.setState({ dirty: false }); after?.();
      }
      return;
    }
    ask({ title: '保存为新预设', message: '为当前提示词命名。固定交付约束会在提交时自动附加，不写入预设。', input: '', choices: [{ id: 'save', label: '保存' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
      if (choice !== 'save') return;
      const item: Preset = { id: uniqueId('preset'), name: input.trim(), body: value.body };
      if (persist([...presets.getState().items, item])) { draft.setState({ presetId: item.id, dirty: false }); after?.(); }
    });
  }
  function guardDirty(after: () => void): void {
    if (!draft.getState().dirty) { after(); return; }
    ask({ title: '提示词有未保存修改', message: '保存到预设后继续，或放弃修改。取消将保留当前内容。', choices: [{ id: 'save', label: '保存并继续' }, { id: 'discard', label: '放弃修改', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
      if (choice === 'save') saveDraft(after);
      if (choice === 'discard') {
        const item = presets.getState().items.find(preset => preset.id === draft.getState().presetId);
        draft.setState({ body: item?.body ?? '', dirty: false });
        after();
      }
    });
  }
  function openDraft(): void {
    workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === 'draft') ? state.tabs : [...state.tabs, { id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft' }));
  }
  function openRecord(id: string): void {
    const record = evaluations.getState().records.find(item => item.id === id);
    if (!record) return;
    const tabId = `record:${id}`;
    workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === tabId) ? state.tabs : [...state.tabs, { id: tabId, title: record.name, type: 'record', recordId: id }], activeTab: tabId, navigation: state.navigation[tabId] ? state.navigation : { ...state.navigation, [tabId]: { mode: 'progress' } } }));
  }
  /** Keep the evaluations domain loading exactly the records that have an open tab. */
  function syncWatch(): void {
    const open = workbench.getState().tabs.flatMap(tab => tab.recordId ? [tab.recordId] : []);
    evaluationsDomain.watch(open);
    resolveOpenRecords();
  }
  /** Price / 已过期 for the relay channels that open result tabs reference. */
  function resolveOpenRecords(): void {
    const open = new Set(workbench.getState().tabs.flatMap(tab => tab.recordId ? [tab.recordId] : []));
    const refs = evaluations.getState().records.filter(record => open.has(record.id)).flatMap(record => (record.models ?? []).flatMap(model => model.relay ? [{ channelId: model.relay.channelId, model: model.relay.model }] : []));
    if (refs.length) relayDomain.resolve(refs);
  }
  /** Run an async domain call and surface failure as a notice. */
  function attempt(title: string, work: Promise<unknown>): void {
    void work.catch(error => showError(title, message(error, '操作失败，请稍后重试。')));
  }
  function removeTab(id: string): void {
    workbench.setState(state => {
      const index = state.tabs.findIndex(tab => tab.id === id);
      if (index === -1) return state;
      let tabs = state.tabs.filter(tab => tab.id !== id);
      if (!tabs.length) tabs = [{ id: 'draft', title: '新建测试', type: 'draft' }];
      const navigation = { ...state.navigation };
      delete navigation[id];
      return { tabs, activeTab: state.activeTab === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeTab, navigation };
    });
  }
  function cancelRecord(id: string): void { attempt('取消失败', evaluationsDomain.cancel(id)); }
  function navigate(value: Partial<Navigation>): void {
    const state = workbench.getState();
    const tab = state.tabs.find(item => item.id === state.activeTab);
    if (!tab?.recordId) return;
    const record = evaluations.getState().records.find(item => item.id === tab.recordId);
    if (!record || (value.runId && !record.runIds.includes(value.runId))) return;
    const previous = state.navigation[tab.id] ?? { mode: 'progress' as const };
    workbench.setState({ navigation: { ...state.navigation, [tab.id]: { ...previous, ...(value.runId !== undefined && value.runId !== previous.runId ? { artifact: false } : {}), ...value } } });
  }
  function refreshModels(): void { modelsDomain.refresh(); }
  function openFeature(feature: 'hub' | 'relay'): void {
    const id = `feature:${feature}`;
    const title = feature === 'relay' ? '中转站来源适配' : '功能中心';
    workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, title, type: 'feature' as const, feature }], activeTab: id }));
    if (feature === 'relay') relayDomain.init();
  }
  function promptName(title: string, initial: string, run: (name: string) => void): void {
    ask({ title, message: '名称最多 40 个字。', input: initial, choices: [{ id: 'ok', label: '保存' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
      const name = input.trim();
      if (choice === 'ok' && name) run(name.slice(0, 40));
    });
  }
  function partitionItemOf(partitionId: string, key: string): PartitionItem | undefined {
    return stores.relay.getState().partitions.find(partition => partition.id === partitionId)?.items.find(item => item.key === key);
  }

  const actions: Workbench['actions'] = {
    openDraft,
    openRecord,
    openFeature,
    activateTab(id) { if (workbench.getState().tabs.some(tab => tab.id === id)) workbench.setState({ activeTab: id }); },
    closeTab(id) {
      if (id !== 'draft') { removeTab(id); return; }
      const close = (): void => { draft.setState(emptyDraft(), true); removeTab(id); };
      const value = draft.getState();
      if (value.dirty) { guardDirty(close); return; }
      if (value.name.trim() || value.selected.length || value.body || value.presetId || value.kind !== 'fingerprint') {
        ask({ title: '关闭未提交的测试？', message: '当前模型选择、测试名称和草稿内容将被丢弃；已保存的预设不会删除。', choices: [{ id: 'discard', label: '丢弃并关闭', danger: true }, { id: 'cancel', label: '继续编辑' }] }, choice => { if (choice === 'discard') close(); });
      } else close();
    },
    toggleSidebar() { workbench.setState(state => ({ sidebarCollapsed: !state.sidebarCollapsed })); },
    navigate,
    patchDraft(value) {
      const apply = (): void => { draft.setState(state => {
        const base = presets.getState().items.find(item => item.id === state.presetId)?.body ?? '';
        return { ...value, error: undefined, ...(value.body !== undefined ? { dirty: value.body !== base } : {}) };
      }); };
      if (value.kind !== undefined && value.kind !== draft.getState().kind) guardDirty(apply); else apply();
    },
    toggleModel(key) {
      if (!models.getState().items.some(item => item.key === key)) return;
      draft.setState(state => ({ selected: state.selected.includes(key) ? state.selected.filter(item => item !== key) : [...state.selected, key], error: undefined }));
    },
    refreshModels,
    submit() {
      const value = draft.getState();
      if (value.selected.length && models.getState().loading) { draft.setState({ error: '模型目录正在读取，请稍后提交。' }); return; }
      const available = new Map(models.getState().items.map(model => [model.key, model]));
      const dshSelected = value.selected.map(key => available.get(key)).filter((model): model is Model => model !== undefined);
      if (dshSelected.length !== value.selected.length) { draft.setState({ error: '部分已选模型已不在当前模型目录中，请刷新后重选。' }); return; }
      const relaySelected = Object.values(value.relaySelected);
      const selected = [...dshSelected, ...relaySelected];
      if (!selected.length) { draft.setState({ error: '请至少选择一个 DSH 模型或中转站渠道。' }); return; }
      if (selected.length > 64) { draft.setState({ error: '每条测试最多选择 64 个模型或渠道。' }); return; }
      if (value.kind === 'custom' && relaySelected.length) { draft.setState({ error: '自定义测试当前仅支持 DSH 模型（模拟），请移除中转站渠道。' }); return; }
      if (value.kind === 'custom' && !value.body.trim()) { draft.setState({ error: '请填写自定义提示词。' }); return; }
      if (value.body.length > 100_000) { draft.setState({ error: '提示词正文最多 100,000 字。' }); return; }
      const preset = presets.getState().items.find(item => item.id === value.presetId);
      const name = value.name.trim() || `${value.kind === 'custom' ? '自定义测试' : '模型指纹'} ${evaluations.getState().records.length + 1}`;
      const refs: RecordModelRef[] = selected.map(model => ({ provider: model.provider, id: model.id, name: model.name, ...(model.relay ? { relay: model.relay } : {}) }));
      draft.setState({ error: undefined, pickerOpen: false });
      void evaluationsDomain.create({
        kind: value.kind, name, models: refs,
        prompt: value.kind === 'custom' ? value.body + FIXED_FOOTER : 'lm-detector 数字指纹：每次请求 3 道共享挑战题（Host 侧官方 lmfpd-sdk 生成），各模型独立作答后与官方参考库比对。',
        footerVersion: FIXED_FOOTER_VERSION, ...(value.kind === 'custom' && preset ? { preset: { ...preset, body: value.body } } : {}),
      }).then(id => {
        if (disposed) return;
        const keep = { source: value.source, partitionId: value.partitionId };
        draft.setState({ ...emptyDraft(), ...keep }, true);
        const tabId = `record:${id}`;
        workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === 'draft') ? state.tabs.map(tab => tab.id === 'draft' ? { id: tabId, title: name, type: 'record' as const, recordId: id } : tab) : [...state.tabs, { id: tabId, title: name, type: 'record' as const, recordId: id }], activeTab: tabId, navigation: { ...state.navigation, [tabId]: { mode: 'progress' } } }));
      }).catch(error => { if (!disposed) draft.setState({ error: `创建测试失败：${message(error, 'Host 未接受请求')}` }); });
    },
    setDraftSource(source, partitionId) {
      draft.setState(state => ({ source, partitionId: partitionId ?? state.partitionId }));
      if (source === 'partition') relayDomain.loadPartitions();
    },
    toggleRelayItem(item) {
      const key = `relay:${item.key}`;
      draft.setState(state => {
        const next = { ...state.relaySelected };
        if (next[key]) delete next[key]; else next[key] = relayModelOf(item);
        return { relaySelected: next, error: undefined };
      });
    },
    rerunRecord(id) { attempt('再次请求失败', evaluationsDomain.rerun(id)); },
    selectAttempt(recordId, attemptId) {
      evaluationsDomain.selectAttempt(recordId, attemptId);
      const tabId = `record:${recordId}`;
      workbench.setState(state => ({ navigation: { ...state.navigation, [tabId]: { ...(state.navigation[tabId] ?? { mode: 'progress' as const }), runId: undefined, artifact: false } } }));
    },
    selectPreset(id) {
      const item = presets.getState().items.find(preset => preset.id === id);
      if (!item || id === draft.getState().presetId) return;
      guardDirty(() => draft.setState({ presetId: item.id, body: item.body, dirty: false, error: undefined }));
    },
    addPreset() {
      guardDirty(() => ask({ title: '新建提示词预设', message: '输入名称，随后编辑正文并保存。', input: '', choices: [{ id: 'create', label: '创建' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
        if (choice !== 'create') return;
        const item: Preset = { id: uniqueId('preset'), name: input.trim(), body: '' };
        if (persist([...presets.getState().items, item])) draft.setState({ presetId: item.id, body: '', dirty: false, kind: 'custom' });
      }));
    },
    renamePreset(id) {
      const item = presets.getState().items.find(preset => preset.id === id);
      if (!item) return;
      ask({ title: '重命名预设', message: '历史测试快照不受此修改影响。', input: item.name, choices: [{ id: 'rename', label: '保存名称' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
        if (choice === 'rename') persist(presets.getState().items.map(preset => preset.id === id ? { ...preset, name: input.trim() } : preset));
      });
    },
    deletePreset(id) {
      const item = presets.getState().items.find(preset => preset.id === id);
      if (!item) return;
      const confirm = (): void => ask({ title: '删除提示词预设？', message: `将删除「${item.name}」。已提交测试中的快照保持不变。`, choices: [{ id: 'delete', label: '删除', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
        if (choice !== 'delete' || !persist(presets.getState().items.filter(preset => preset.id !== id))) return;
        if (draft.getState().presetId === id) draft.setState(state => ({ presetId: undefined, dirty: state.body !== '' }));
      });
      if (draft.getState().presetId === id) guardDirty(confirm); else confirm();
    },
    savePreset() { saveDraft(); },
    togglePresets() { presetsDomain.toggle(); },
    cancelRecord,
    setFingerprintConfig(id, options) { void evaluationsDomain.configure(id, options); },
    retryFailedSample(id, runId) { void evaluationsDomain.retry(id, runId); },
    deleteRecord(id) {
      const item = evaluations.getState().records.find(record => record.id === id);
      if (!item) return;
      ask({ title: '删除测试记录？', message: `「${item.name}」的运行中请求将被取消，记录和结果将删除，无法撤销。`, choices: [{ id: 'delete', label: '取消运行并删除', danger: true }, { id: 'cancel', label: '保留' }] }, choice => {
        if (choice !== 'delete') return;
        removeTab(`record:${id}`);
        attempt('删除失败', evaluationsDomain.remove(id));
      });
    },
    resetMocks() {
      ask({ title: '清空测试记录？', message: '取消所有运行中的请求并删除全部已保存的测试记录（所有会话共享）。模型目录、预设、分区和当前草稿会保留。', choices: [{ id: 'reset', label: '清空记录', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
        if (choice !== 'reset') return;
        attempt('清空失败', evaluationsDomain.reset());
        workbench.setState({ tabs: [{ id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft', navigation: {} });
        presentationDomain.resetExpansion();
      });
    },
    toggleColumn: presentationDomain.toggleColumn,
    resizeColumn: presentationDomain.resizeColumn,
    toggleColumns: presentationDomain.toggleColumns,
    toggleView: presentationDomain.toggleView,
    toggleConfig: presentationDomain.toggleConfig,
    toggleRound: presentationDomain.toggleRound,
    toggleFollow: presentationDomain.toggleFollow,
    setFilter: presentationDomain.setFilter,
    relayRefresh: relayDomain.refresh,
    relaySite: relayDomain.site,
    relaySort: relayDomain.sort,
    toggleRelayColumn: relayDomain.toggleColumn,
    resizeRelayColumn: relayDomain.resizeColumn,
    toggleRelayColumns: relayDomain.toggleColumns,
    relayScroll: relayDomain.scroll,
    openRelayDetail: relayDomain.openDetail,
    closeRelayDetail: relayDomain.closeDetail,
    relayMenu: relayDomain.menu,
    relayMenuQuery: relayDomain.menuQuery,
    relayToggleBrand: relayDomain.toggleBrand,
    relayToggleModel: relayDomain.toggleModel,
    relayClearFilter: relayDomain.clearFilter,
    relayFidelity: relayDomain.fidelity,
    relayView: relayDomain.view,
    relayCurrency: relayDomain.currency,
    relayRetryMissing: relayDomain.retryMissing,
    relayClearExpired: relayDomain.clearExpired,
    relayPoolOpen: relayDomain.poolOpen,
    relayPoolFormat: relayDomain.poolFormat,
    relayPoolClose: relayDomain.poolClose,
    relayPoolConfirm() {
      const pool = stores.relay.getState().pool;
      if (!pool) return;
      const item = partitionItemOf(pool.partitionId, pool.key);
      relayDomain.poolClose();
      if (!item) return;
      void settingsDomain.addDirect(pool.format, item.model, { channelId: item.channelId }).then(() => {
        relayDomain.updateItem(pool.partitionId, pool.key, { api: pool.format });
        ask({ title: '已加入模型池', message: `「${item.model}」已加入 ${pool.format} 协议的插件路由，可直接在模型列表中选择（渠道 #${item.channelId}）。`, choices: [{ id: 'ok', label: '知道了' }] }, () => {});
      }).catch(error => showError('加入模型池失败', message(error, '请先在设置「API 适配站点」填写 API Key。')));
    },
    tagsMenu: tagsDomain.menu,
    tagsQuery: tagsDomain.query,
    tagsCategory: tagsDomain.category,
    tagsToggle: tagsDomain.toggle,
    tagsSet: tagsDomain.set,
    tagsLoad: tagsDomain.load,
    relayLoadHistory: relayDomain.loadHistory,
    relayLoadConcurrency: relayDomain.loadConcurrency,
    relayLoadSvg: relayDomain.loadSvg,
    relayToggleFavorite: relayDomain.toggleFavorite,
    relayPartitionMenu: relayDomain.partitionMenu,
    relayAssign: relayDomain.assign,
    partitionCreate() { promptName('新建分区', '', name => relayDomain.createPartition(name)); },
    partitionRename(id) {
      const current = stores.relay.getState().partitions.find(partition => partition.id === id);
      if (!current || current.builtin) return;
      promptName('重命名分区', current.name, name => relayDomain.renamePartition(id, name));
    },
    partitionDelete(id) {
      const current = stores.relay.getState().partitions.find(partition => partition.id === id);
      if (!current || current.builtin) return;
      ask({ title: '删除分区？', message: `将删除「${current.name}」及其中 ${current.items.length} 个渠道。已创建的测试记录不受影响。`, choices: [{ id: 'delete', label: '删除', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
        if (choice !== 'delete') return;
        relayDomain.deletePartition(id);
        if (draft.getState().partitionId === id) draft.setState({ partitionId: 'favorites' });
      });
    },
    partitionRemoveItem(partitionId, key) {
      relayDomain.updateItem(partitionId, key, { remove: true });
      draft.setState(state => { const next = { ...state.relaySelected }; delete next[`relay:${key}`]; return { relaySelected: next }; });
    },
    partitionTags(partitionId, key) {
      const item = partitionItemOf(partitionId, key);
      if (!item) return;
      ask({ title: '编辑标签', message: '用逗号或空格分隔，最多 12 个，每个最多 24 字。', input: item.tags.join(', '), choices: [{ id: 'ok', label: '保存' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
        if (choice !== 'ok') return;
        relayDomain.updateItem(partitionId, key, { tags: input.split(/[,，\s]+/).map(tag => tag.trim()).filter(Boolean) });
      });
    },
    partitionApi(partitionId, key, api) {
      relayDomain.updateItem(partitionId, key, { api });
      draft.setState(state => {
        const current = state.relaySelected[`relay:${key}`];
        return current?.relay ? { relaySelected: { ...state.relaySelected, [`relay:${key}`]: { ...current, relay: { ...current.relay, api } } } } : {};
      });
    },
    settingsLoad: settingsDomain.load,
    settingsDraft: settingsDomain.draft,
    settingsSave: settingsDomain.save,
    settingsClear: settingsDomain.clear,
    settingsVerify: settingsDomain.verify,
    settingsAddForm: settingsDomain.addForm,
    settingsAddModel: settingsDomain.addModel,
    settingsRemoveModel: settingsDomain.removeModel,
    settingsToggleTrait: settingsDomain.toggleTrait,
    settingsCopySnippet: settingsDomain.copySnippet,
    settingsRequestClear: settingsDomain.requestClear,
    settingsCancelClear: settingsDomain.cancelClear,
    settingsClearProviders: settingsDomain.clearProviders,
    answerNotice(choice) {
      const value = notice.getState();
      if (!value?.choices.some(item => item.id === choice)) return;
      const answer = noticeAnswer;
      noticeAnswer = undefined;
      notice.setState(null, true);
      answer?.(choice, value.input ?? '');
    },
    setNoticeInput(input) { const current = notice.getState(); if (current && current.input !== undefined) notice.setState({ ...current, input }, true); },
  };
  // Ignore late UI callbacks after teardown, in addition to cancelling asynchronous work.
  const guardedActions = Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, (...args: unknown[]) => { if (!disposed) (action as (...values: unknown[]) => void)(...args); }])) as Workbench['actions'];
  presetsDomain.load();
  // Partitions are Host state shared by the relay page and the model picker: load them once at
  // startup so the picker can offer 中转渠道 without the user opening the relay tab first.
  relayDomain.loadPartitions();
  tagsDomain.load();
  refreshModels();
  const unwatch = workbench.subscribe(syncWatch);
  // Tabs whose record disappeared (deleted elsewhere) close themselves.
  const unprune = evaluations.subscribe(() => {
    const state = evaluations.getState();
    if (!state.loaded) return;
    const ids = new Set(state.records.map(record => record.id));
    for (const tab of workbench.getState().tabs) if (tab.recordId && !ids.has(tab.recordId)) removeTab(tab.id);
    resolveOpenRecords();
  });
  return { sessionId, ...stores, actions: guardedActions, dispose() { if (disposed) return; disposed = true; unwatch(); unprune(); modelsDomain.dispose(); evaluationsDomain.dispose(); relayDomain.dispose(); settingsDomain.dispose(); tagsDomain.dispose(); noticeAnswer = undefined; notice.setState(null, true); } };
}
