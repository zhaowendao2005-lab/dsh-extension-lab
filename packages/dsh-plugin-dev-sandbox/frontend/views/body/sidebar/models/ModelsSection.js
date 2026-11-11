import { h } from '../../../../runtime.js';
import { Section } from '../../../Section.js';
import { ModelProvider } from './ModelProvider.js';

/** Provider → model picker. The catalog is loaded lazily on first expand. */
export function ModelsSection({ store, state }) {
  const ui = state.ui;
  const expanded = ui.sections.models === true;
  const catalog = state.catalog;
  const selected = state.snapshot?.models ?? [];
  const chosen = new Set(selected.map((item) => `${item.provider}\u0000${item.model}`));
  const credentials = state.snapshot?.credentials ?? [];

  return h(Section, {
    id: 'models',
    title: '提供商与模型',
    count: selected.length || undefined,
    expanded,
    onToggle: () => store.toggleSection('models'),
  },
    catalog.loading ? h('div', { className: 'pds-model-hint' }, '正在读取模型目录…') : null,
    catalog.error ? h('div', { className: 'pds-model-error' }, catalog.error) : null,
    !catalog.loading && !catalog.error ? h('div', { className: 'pds-models' },
      catalog.providers.map((provider) => h(ModelProvider, {
        key: provider.id,
        provider,
        open: ui.providers[provider.id] === true,
        chosen,
        disabled: state.busy,
        onToggle: () => store.toggleProvider(provider.id),
        onToggleModel: (model, checked) => { void store.toggleModel(provider.id, model.id, checked); },
      })),
      h('div', { className: 'pds-model-hint' },
        '勾选的模型与参数会写入沙箱 profile；启动时把对应凭据复制到沙箱 .credentials.yaml（权限 0600），沙箱停止即删除。',
        credentials.length ? ` 已复制 ${credentials.length} 个凭据。` : '')) : null);
}
