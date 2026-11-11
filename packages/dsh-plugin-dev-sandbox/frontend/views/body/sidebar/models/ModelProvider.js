import { h } from '../../../../runtime.js';
import { ModelItem } from './ModelItem.js';

/** One provider row, expandable to its model checkboxes. */
export function ModelProvider({ provider, open, chosen, disabled, onToggle, onToggleModel }) {
  const count = provider.models.filter((model) => chosen.has(`${provider.id}\u0000${model.id}`)).length;
  return h('div', null,
    h('button', {
      type: 'button', className: 'pds-model-provider', 'aria-expanded': open, onClick: onToggle,
    },
      h('span', { className: 'pds-tree-caret' }, open ? '⌄' : '›'),
      h('span', { className: 'pds-model-name' }, provider.name || provider.id),
      h('span', { className: 'pds-model-count' }, count ? `${count}/${provider.models.length}` : String(provider.models.length))),
    provider.error ? h('div', { className: 'pds-model-error' }, provider.error) : null,
    open ? h('div', { className: 'pds-model-list' }, provider.models.map((model) => h(ModelItem, {
      key: model.id,
      model,
      checked: chosen.has(`${provider.id}\u0000${model.id}`),
      disabled,
      onChange: (next) => onToggleModel(model, next),
    }))) : null);
}
