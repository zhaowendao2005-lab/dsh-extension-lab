import { createStore } from 'zustand/vanilla';
import type { ModelIntelligenceTransport, Model, Navigation, Notice, Preset, RecordModelRef, Workbench, WorkbenchState } from '../types';
import { FIXED_FOOTER_VERSION } from '../types';
import { createDraftStore, emptyDraft } from './draft.stores';
import { createModelsDomain } from './models.stores';
import { createPresetsDomain } from './presets.stores';
import { createEvaluationsDomain } from './evaluations.stores';
import { createPresentationDomain } from './presentation.stores';
import { createA6Domain } from './a6api.stores';
import { createA6InsightsDomain } from './a6insights.stores';
import { createCustomDomain } from './custom.stores';
import { createNoticeStore } from './notice.stores';

let sequence = 0;
const uniqueId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

const message = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;

/**
 * The single global workbench: records are Host-persisted and shared by every session, so one
 * instance serves all mounted panels. The plugin lifecycle owns dispose.
 */
export interface WorkbenchWindow { fullscreen: boolean; open(): void; close(): void }
const singletonWindow: WorkbenchWindow = { fullscreen: false, open() {}, close() {} };
export function createWorkbench(sessionId: string, transport: ModelIntelligenceTransport, openPane: (selectionId: string) => void = () => {}, window: WorkbenchWindow = singletonWindow): Workbench {
  const draft = createDraftStore();
  const modelsDomain = createModelsDomain(transport, keys => draft.setState(state => ({ selected: state.selected.filter(key => keys.has(key)) })));
  const presetsDomain = createPresetsDomain();
  const evaluationsDomain = createEvaluationsDomain(transport);
  const customDomain = createCustomDomain(transport);
  const presentationDomain = createPresentationDomain();
  const insightsDomain = createA6InsightsDomain(transport);
  const a6Domain = createA6Domain(transport, {
    open(selectionId) {
      const selection = a6Domain.store.getState().selections.find(item => item.id === selectionId);
      if (selection?.kind === 'custom') {
        customDomain.beginFromSelection(selection, a6Domain.store.getState().drafts[selectionId]);
        const preset = presets.getState().items.find(item => item.id === 'builtin-totoro');
        draft.setState({ ...emptyDraft(), kind: 'custom', name: `自定义测试 ${selection.models.length} 个渠道`, body: preset?.body ?? '', presetId: preset?.id, pickerOpen: false });
        openDraft();
        return;
      }
      const id = `a6:${selectionId}`;
      workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, title: 'a6api 专项', type: 'a6' as const, selectionId }], activeTab: id }));
      openPane(selectionId);
    },
    created(record, attemptId) { evaluationsDomain.acceptCreated(record, attemptId); openRecord(record.id); },
  });
  const stores = {
    workbench: createStore<WorkbenchState>(() => ({ tabs: [{ id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft', sidebarCollapsed: false, navigation: {}, fullscreen: window.fullscreen })),
    a6Insights: insightsDomain.store,
    draft, custom: customDomain.store, models: modelsDomain.store, presets: presetsDomain.store, evaluations: evaluationsDomain.store, presentation: presentationDomain.store, a6: a6Domain.store, notice: createNoticeStore(),
  };
  const { workbench, models, presets, evaluations, notice } = stores;
  // Selections pushed by the userscript arrive without any DSH page action, so polling starts here.
  a6Domain.start();
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
    if (existing && existing.id !== 'builtin-totoro') {
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
    const state = workbench.getState();
    const open = state.tabs.flatMap(tab => tab.recordId ? [tab.recordId] : []);
    evaluationsDomain.watch(open);
    const tab = state.tabs.find(item => item.id === state.activeTab);
    const record = tab?.recordId ? evaluations.getState().records.find(item => item.id === tab.recordId) : undefined;
    customDomain.watch(record?.kind === 'custom' ? record.attemptId : undefined, record?.kind === 'custom' ? state.navigation[state.activeTab]?.runId : undefined);
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
    const nextNavigation = { ...previous, ...(value.runId !== undefined && value.runId !== previous.runId ? { artifact: false } : {}), ...value };
    workbench.setState({ navigation: { ...state.navigation, [tab.id]: nextNavigation } });
    customDomain.watch(record.kind === 'custom' ? record.attemptId : undefined, record.kind === 'custom' ? nextNavigation.runId : undefined);
  }
  function refreshModels(): void { modelsDomain.refresh(); }
  function openFeature(feature: 'hub'): void {
    const id = `feature:${feature}`;
    workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, title: '功能中心', type: 'feature' as const, feature }], activeTab: id }));
  }
  function promptName(title: string, initial: string, run: (name: string) => void): void {
    ask({ title, message: '名称最多 40 个字。', input: initial, choices: [{ id: 'ok', label: '保存' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
      const name = input.trim();
      if (choice === 'ok' && name) run(name.slice(0, 40));
    });
  }
  function submitCustom(): void {
    const value = draft.getState();
    const customDraft = customDomain.store.getState().draft;
    const available = new Map(models.getState().items.map(model => [model.key, model]));
    const chosen = value.selected.map(key => available.get(key)).filter((model): model is Model => Boolean(model));
    if (chosen.length !== value.selected.length) { draft.setState({ error: '部分已选模型已不在目录中，请刷新后重选。' }); return; }
    const count = chosen.length + customDraft.a6Models.length;
    if (!value.body.trim()) { draft.setState({ error: '请填写自定义提示词。' }); return; }
    if (!count || count > 64) { draft.setState({ error: '自定义任务需选择 1–64 个 DSH/a6api 模型。' }); return; }
    if (customDraft.a6Models.length && !customDraft.sourceSelectionId && !customDraft.sourceRecordId) { draft.setState({ error: 'a6api 渠道只能来自网页选择或已完成的指纹记录。' }); return; }
    if (customDraft.a6Models.length && !customDraft.tokens.length) { draft.setState({ error: '请至少选择一个 a6api 测试令牌槽位。' }); return; }
    // Concurrency is not a user setting: it is exactly the allocated a6api test tokens (or the target count for DSH-only tasks), capped by the Host.
    const concurrency = Math.max(1, Math.min(6, customDraft.a6Models.length ? customDraft.tokens.length : count));
    if (!Number.isInteger(customDraft.timeoutMs) || customDraft.timeoutMs < 30_000 || customDraft.timeoutMs > 1_800_000) { draft.setState({ error: '单模型最长时长须为 30–1800 秒的整数。' }); return; }
    const preset = presets.getState().items.find(item => item.id === value.presetId) ?? null;
    const name = value.name.trim() || `自定义测试 ${evaluations.getState().records.length + 1}`;
    const dshModels: RecordModelRef[] = chosen.map(model => ({ provider: model.provider, id: model.id, name: model.name }));
    const slots = customDraft.tokens.map(tokenId => ({ tokenId, name: customDraft.a6Tokens.find(token => token.id === tokenId)?.name }));
    customDomain.store.setState(state => ({ draft: { ...state.draft, creating: true, error: undefined } }));
    draft.setState({ error: undefined, pickerOpen: false });
    void customDomain.createTask({ selectionId: customDraft.sourceSelectionId, sourceRecordId: customDraft.sourceRecordId, name, a6Models: customDraft.a6Models, protocols: customDraft.protocols, slots, dshModels, prompt: value.body, footerVersion: FIXED_FOOTER_VERSION, preset, concurrency, timeoutMs: customDraft.timeoutMs }).then(({ record, attemptId }) => {
      if (disposed) return;
      evaluationsDomain.acceptCreated(record, attemptId);
      customDomain.resetSource();
      draft.setState(emptyDraft(), true);
      openRecord(record.id);
    }).catch(error => {
      if (!disposed) customDomain.store.setState(state => ({ draft: { ...state.draft, error: message(error, 'Host 未接受请求') } }));
    }).finally(() => {
      if (!disposed) customDomain.store.setState(state => ({ draft: { ...state.draft, creating: false } }));
    });
  }
  function customContext(runId: string): {attemptId: string; runId: string} | undefined {
    const record = evaluations.getState().records.find(item => item.kind === 'custom' && item.attemptId && item.runIds.includes(runId));
    return record?.attemptId ? { attemptId: record.attemptId, runId } : undefined;
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
    openFullscreen() { window.open(); },
    closeFullscreen() { window.close(); },
    navigate,
    patchDraft(value) {
      const apply = (): void => { draft.setState(state => {
        const builtin = presets.getState().items.find(item => item.id === 'builtin-totoro');
        const base = presets.getState().items.find(item => item.id === state.presetId)?.body ?? '';
        const initialCustom = value.kind === 'custom' && state.kind !== 'custom' && !state.presetId && builtin;
        return { ...value, ...(initialCustom ? { presetId: builtin.id, body: builtin.body, dirty: false } : {}), error: undefined, ...(value.body !== undefined && !initialCustom ? { dirty: value.body !== base } : {}) };
      }); };
      if (value.kind !== undefined && value.kind !== draft.getState().kind) guardDirty(apply); else apply();
    },
    toggleModel(key) {
      if (!models.getState().items.some(item => item.key === key)) return;
      draft.setState(state => ({ selected: state.selected.includes(key) ? state.selected.filter(item => item !== key) : [...state.selected, key], error: undefined }));
    },
    refreshModels,
    beginCustomFromFingerprint(recordId, runIds) {
      const record = evaluations.getState().records.find(item => item.id === recordId);
      const requested = Array.isArray(runIds) ? runIds : runIds ? [runIds] : undefined;
      const runs = requested ? requested.map(id => evaluations.getState().runs[id]) : record?.runIds.map(id => evaluations.getState().runs[id]).filter(item => item?.model.a6api && item.stage === 'completed').slice(0, 1);
      if (!record || !runs?.length || runs.some(run => !run?.model.a6api || run.stage !== 'completed')) { showError('无法创建自定义测试', '请选择至少一个已完成的 a6api 指纹模型。'); return; }
      customDomain.beginFromFingerprint(recordId, runs.map(run => run.model), record.a6api?.slots ?? []);
      const preset = presets.getState().items.find(item => item.id === 'builtin-totoro');
      draft.setState({ ...emptyDraft(), kind: 'custom', name: `${record.name} 自定义`, body: preset?.body ?? '', presetId: preset?.id });
      openDraft();
    },
    startCustomSelection(recordId) { customDomain.startSelection(recordId); },
    toggleCustomRunSelection(recordId, runId) { customDomain.toggleRunSelection(recordId, runId); },
    cancelCustomSelection() { customDomain.cancelSelection(); },
    createCustomFromSelection(recordId) {
      const state = customDomain.store.getState();
      if (state.selectionRecordId !== recordId || !state.selectedRunIds.length) return;
      const ids = [...state.selectedRunIds];
      const record = evaluations.getState().records.find(item => item.id === recordId);
      const runs = ids.map(id => evaluations.getState().runs[id]);
      if (!record || runs.some(run => !run?.model.a6api || run.stage !== 'completed')) { showError('无法创建自定义测试', '所选模型已发生变化，请重新选择。'); return; }
      customDomain.clearSelection();
      customDomain.beginFromFingerprint(recordId, runs.map(run => run.model), record.a6api?.slots ?? []);
      const preset = presets.getState().items.find(item => item.id === 'builtin-totoro');
      draft.setState({ ...emptyDraft(), kind: 'custom', name: `${record.name} 自定义`, body: preset?.body ?? '', presetId: preset?.id });
      openDraft();
    },
    patchCustom: customDomain.patchDraft,
    removeCustomA6Model: customDomain.removeA6Model,
    setCustomProtocol: customDomain.setProtocol,
    toggleCustomToken: customDomain.toggleToken,
    resetCustomSource: customDomain.resetSource,
    setCustomDetailTab(runId, tab) { const context = customContext(runId); if (context) customDomain.setTab(context.attemptId, runId, tab); },
    readCustomFile(runId, path) { const context = customContext(runId); if (context) void customDomain.readFile(context.attemptId, runId, path); },
    openCustomOutput(runId, mode, application) { const context = customContext(runId); return context ? customDomain.openOutput(context.attemptId, runId, mode, application) : Promise.reject(new Error('自定义运行已不可用')); },
    continueCustomRun(runId) { const context = customContext(runId); if (context) void customDomain.continueRun(context.attemptId, runId); },
    dismissPreview() { customDomain.dismissPreview(); },
    submit() {
      const value = draft.getState();
      if (value.kind === 'custom') { submitCustom(); return; }
      if (value.selected.length && models.getState().loading) { draft.setState({ error: '模型目录正在读取，请稍后提交。' }); return; }
      const available = new Map(models.getState().items.map(model => [model.key, model]));
      const dshSelected = value.selected.map(key => available.get(key)).filter((model): model is Model => model !== undefined);
      if (dshSelected.length !== value.selected.length) { draft.setState({ error: '部分已选模型已不在当前模型目录中，请刷新后重选。' }); return; }
      const selected = dshSelected;
      if (!selected.length) { draft.setState({ error: '请至少选择一个 DSH 模型。' }); return; }
      if (selected.length > 64) { draft.setState({ error: '每条测试最多选择 64 个模型。' }); return; }
      if (value.body.length > 100_000) { draft.setState({ error: '提示词正文最多 100,000 字。' }); return; }
      const name = value.name.trim() || `模型指纹 ${evaluations.getState().records.length + 1}`;
      const refs: RecordModelRef[] = selected.map(model => ({ provider: model.provider, id: model.id, name: model.name, ...(model.relay ? { relay: model.relay } : {}) }));
      draft.setState({ error: undefined, pickerOpen: false });
      void evaluationsDomain.create({
        kind: 'fingerprint', name, models: refs,
        prompt: 'lm-detector 数字指纹：每次请求 3 道共享挑战题（Host 侧官方 lmfpd-sdk 生成），各模型独立作答后与官方参考库比对。',
        footerVersion: FIXED_FOOTER_VERSION,
      }).then(id => {
        if (disposed) return;
        draft.setState(emptyDraft(), true);
        const tabId = `record:${id}`;
        workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === 'draft') ? state.tabs.map(tab => tab.id === 'draft' ? { id: tabId, title: name, type: 'record' as const, recordId: id } : tab) : [...state.tabs, { id: tabId, title: name, type: 'record' as const, recordId: id }], activeTab: tabId, navigation: { ...state.navigation, [tabId]: { mode: 'progress' } } }));
      }).catch(error => { if (!disposed) draft.setState({ error: `创建测试失败：${message(error, 'Host 未接受请求')}` }); });
    },
    openA6: a6Domain.open,
    patchA6: a6Domain.patch,
    removeA6Model: a6Domain.removeModel,
    toggleA6Token: a6Domain.toggleToken,
    submitA6(id) { void a6Domain.submit(id); },
    loadA6Config() { void a6Domain.loadConfig(); },
    patchA6Form: a6Domain.patchForm,
    saveA6Config() { void a6Domain.saveConfig(); },
    rotateA6Intake() { void a6Domain.rotateIntake(); },
    copyA6Intake() { void a6Domain.copyIntake(); },
    loadA6Operations: insightsDomain.load,
    setA6OperationQuery: insightsDomain.setQuery,
    selectA6OperationToken: insightsDomain.select,
    refreshA6OperationTokens: insightsDomain.refreshTokens,
    refreshA6Relations: insightsDomain.refreshRelations,
    a6ResultAction(input) { void insightsDomain.action(input); },
    setA6LedgerScope: insightsDomain.scope,
    refreshA6Ledger: insightsDomain.refreshLedger,
    rerunRecord(id) { attempt('再次测试失败', evaluationsDomain.rerun(id)); },
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
      if (!item || id === 'builtin-totoro') return;
      ask({ title: '重命名预设', message: '历史测试快照不受此修改影响。', input: item.name, choices: [{ id: 'rename', label: '保存名称' }, { id: 'cancel', label: '取消' }] }, (choice, input) => {
        if (choice === 'rename') persist(presets.getState().items.map(preset => preset.id === id ? { ...preset, name: input.trim() } : preset));
      });
    },
    deletePreset(id) {
      const item = presets.getState().items.find(preset => preset.id === id);
      if (!item || id === 'builtin-totoro') return;
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
    retryFailedSample(id, runId) { void evaluationsDomain.retry(id, runId).then(nextRunId => { if (nextRunId) navigate({ runId: nextRunId, artifact: false }); }); },
    deleteRecord(id) {
      const item = evaluations.getState().records.find(record => record.id === id);
      if (!item) return;
      ask({ title: '删除测试记录？', message: `「${item.name}」的运行中请求将被取消，记录和结果将删除，无法撤销。`, choices: [{ id: 'delete', label: '取消运行并删除', danger: true }, { id: 'cancel', label: '保留' }] }, choice => {
        if (choice !== 'delete') return;
        removeTab(`record:${id}`);
        attempt('删除失败', evaluationsDomain.remove(id));
      });
    },
    resetRecords() {
      ask({ title: '清空测试记录？', message: '取消所有运行中的请求并删除全部已保存的测试记录（所有会话共享）。模型目录、预设、分区和当前草稿会保留。', choices: [{ id: 'reset', label: '清空记录', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
        if (choice !== 'reset') return;
        attempt('清空失败', evaluationsDomain.reset());
        workbench.setState({ tabs: [{ id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft', navigation: {} });
        presentationDomain.resetExpansion();
      });
    },
    toggleColumn: presentationDomain.toggleColumn,
    toggleSort: presentationDomain.toggleSort,
    resizeColumn: presentationDomain.resizeColumn,
    toggleColumns: presentationDomain.toggleColumns,
    toggleView: presentationDomain.toggleView,
    toggleConfig: presentationDomain.toggleConfig,
    toggleRound: presentationDomain.toggleRound,
    toggleFollow: presentationDomain.toggleFollow,
    setFilter: presentationDomain.setFilter,
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
  const guardedActions = Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, (...args: unknown[]) => { if (disposed) return undefined; return (action as (...values: unknown[]) => unknown)(...args); }])) as Workbench['actions'];
  presetsDomain.load();
  refreshModels();
  const unwatch = workbench.subscribe(syncWatch);
  const syncInsights = (): void => {
    const ids = new Set(workbench.getState().tabs.flatMap(tab => tab.recordId ? [tab.recordId] : []));
    const config = a6Domain.store.getState().config;
    insightsDomain.watch(evaluations.getState().records.filter(record => ids.has(record.id)), config?.userId ?? '', JSON.stringify([config?.configured,config?.userId,config?.mask]));
  };
  const unwatchInsights = workbench.subscribe(syncInsights);
  const unevalInsights = evaluations.subscribe(syncInsights);
  const unaccountInsights = a6Domain.store.subscribe(syncInsights);
  syncInsights();
  insightsDomain.start();
  // Tabs whose record disappeared (deleted elsewhere) close themselves.
  const unprune = evaluations.subscribe(() => {
    const state = evaluations.getState();
    if (!state.loaded) return;
    const ids = new Set(state.records.map(record => record.id));
    for (const tab of workbench.getState().tabs) if (tab.recordId && !ids.has(tab.recordId)) removeTab(tab.id);
  });
  return { sessionId, ...stores, actions: guardedActions, dispose() { if (disposed) return; disposed = true; unwatch(); unwatchInsights(); unevalInsights(); unaccountInsights(); unprune(); insightsDomain.dispose(); customDomain.dispose(); modelsDomain.dispose(); evaluationsDomain.dispose(); a6Domain.dispose(); noticeAnswer = undefined; notice.setState(null, true); } };
}
