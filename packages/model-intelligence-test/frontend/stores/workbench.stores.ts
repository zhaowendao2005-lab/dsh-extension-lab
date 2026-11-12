import { createStore } from 'zustand/vanilla';
import type { ModelIntelligenceTransport, Evaluation, Navigation, Notice, Preset, Workbench, WorkbenchState } from '../types';
import { FIXED_FOOTER, FIXED_FOOTER_VERSION } from '../types';
import { createDraftStore, emptyDraft } from './draft.stores';
import { createModelsDomain } from './models.stores';
import { createPresetsDomain } from './presets.stores';
import { createEvaluationsDomain } from './evaluations.stores';
import { createPresentationDomain } from './presentation.stores';
import { createNoticeStore } from './notice.stores';

let sequence = 0;
const uniqueId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

/** One instance per session; its owner must call dispose on actual plugin/session teardown. */
export function createWorkbench(sessionId: string, transport: ModelIntelligenceTransport): Workbench {
  const draft = createDraftStore();
  const modelsDomain = createModelsDomain(transport, keys => draft.setState(state => ({ selected: state.selected.filter(key => keys.has(key)) })));
  const presetsDomain = createPresetsDomain();
  const evaluationsDomain = createEvaluationsDomain(sessionId, transport);
  const presentationDomain = createPresentationDomain();
  const stores = {
    workbench: createStore<WorkbenchState>(() => ({ tabs: [{ id: 'draft', title: '新建测试', type: 'draft' }], activeTab: 'draft', sidebarCollapsed: false, navigation: {} })),
    draft, models: modelsDomain.store, presets: presetsDomain.store, evaluations: evaluationsDomain.store, presentation: presentationDomain.store, notice: createNoticeStore(),
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
  function cancelRecord(id: string): void { evaluationsDomain.cancel(id); }
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

  const actions: Workbench['actions'] = {
    openDraft,
    openRecord,
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
      if (models.getState().loading) { draft.setState({ error: '模型目录正在读取，请稍后提交。' }); return; }
      const available = new Map(models.getState().items.map(model => [model.key, model]));
      const selected = value.selected.map(key => available.get(key)).filter(model => model !== undefined);
      if (!selected.length || selected.length !== value.selected.length) { draft.setState({ error: '请从当前真实模型目录选择至少一个可用模型。' }); return; }
      if (value.kind === 'fingerprint' && selected.length > 64) { draft.setState({ error: '每条指纹测试最多选择 64 个模型。' }); return; }
      if (value.kind === 'custom' && !value.body.trim()) { draft.setState({ error: '请填写自定义提示词。' }); return; }
      if (value.body.length > 100_000) { draft.setState({ error: '提示词正文最多 100,000 字。' }); return; }
      const id = uniqueId('evaluation');
      const preset = presets.getState().items.find(item => item.id === value.presetId);
      const record: Evaluation = evaluationsDomain.submit({ id, name: value.name.trim() || `${value.kind === 'custom' ? '自定义测试' : '模型指纹'} ${evaluations.getState().records.length + 1}`, kind: value.kind, createdAt: Date.now(), runIds: selected.map(() => uniqueId('run')), prompt: (value.kind === 'custom' ? value.body + FIXED_FOOTER : 'lm-detector 数字指纹：3 道共享挑战题（由 Host 侧官方 lmfpd-sdk 生成），各模型独立作答后与官方参考库比对。'), footerVersion: FIXED_FOOTER_VERSION, ...(value.kind === 'custom' && preset ? { preset: { ...preset, body: value.body } } : {}) }, selected);
      draft.setState(emptyDraft(), true);
      const tabId = `record:${id}`;
      workbench.setState(state => ({ tabs: state.tabs.some(tab => tab.id === 'draft') ? state.tabs.map(tab => tab.id === 'draft' ? { id: tabId, title: record.name, type: 'record' as const, recordId: id } : tab) : [...state.tabs, { id: tabId, title: record.name, type: 'record' as const, recordId: id }], activeTab: tabId, navigation: { ...state.navigation, [tabId]: { mode: 'progress' } } }));
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
    setFingerprintConfig(id, options) { evaluationsDomain.setFingerprintConfig(id, options); },
    retryFailedSample(id, runId) { evaluationsDomain.retryFailedSample(id, runId); },
    deleteRecord(id) {
      const item = evaluations.getState().records.find(record => record.id === id);
      if (!item) return;
      ask({ title: '删除测试记录？', message: `「${item.name}」的运行中请求将被取消，记录和结果将删除，无法撤销。`, choices: [{ id: 'delete', label: '取消运行并删除', danger: true }, { id: 'cancel', label: '保留' }] }, choice => {
        if (choice !== 'delete') return;
        evaluationsDomain.remove(id);
        removeTab(`record:${id}`);
      });
    },
    resetMocks() {
      ask({ title: '清空测试记录？', message: '取消所有运行中的测试并清空本会话的测试记录。模型目录、本地预设和当前草稿会保留。', choices: [{ id: 'reset', label: '清空记录', danger: true }, { id: 'cancel', label: '取消' }] }, choice => {
        if (choice !== 'reset') return;
        evaluationsDomain.reset();
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
  refreshModels();
  return { sessionId, ...stores, actions: guardedActions, dispose() { if (disposed) return; disposed = true; modelsDomain.dispose(); evaluationsDomain.dispose(); noticeAnswer = undefined; notice.setState(null, true); } };
}
