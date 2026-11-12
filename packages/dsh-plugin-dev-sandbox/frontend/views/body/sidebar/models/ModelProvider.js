import { h } from '../../../../runtime.js';
import { ModelItem } from './ModelItem.js';

/** One provider row, expandable to its model checkboxes. */
export function ModelProvider({ provider, open, chosen, disabled, onToggle, onToggleModel, onToggleAll }) {
  const total = provider.models.length;
  const count = provider.models.filter((model) => chosen.has(`${provider.id}\u0000${model.id}`)).length;
  const all = total > 0 && count === total;
  const partial = count > 0 && count < total;
  const label = provider.name || provider.id;
  return h('div', null,
    h('div', { className: 'pds-model-provider-row' },
      h('input', {
        type: 'checkbox',
        className: 'pds-model-provider-check',
        checked: all,
        disabled: disabled || total === 0,
        'aria-label': `选择 ${label} 的全部模型`,
        // A half-checked provider must read as "some selected", which the DOM only
        // exposes as a property, never as an attribute.
        ref: (node) => { if (node) node.indeterminate = partial; },
        onChange: (event) => onToggleAll(event.target.checked),
      }),
      h('button', {
        type: 'button', className: 'pds-model-provider', 'aria-expanded': open, onClick: onToggle,
      },
        h('span', { className: 'pds-tree-caret' }, open ? '⌄' : '›'),
        h('span', { className: 'pds-model-name' }, label),
        h('span', { className: 'pds-model-count' }, count ? `${count}/${total}` : String(total)))),
    provider.error ? h('div', { className: 'pds-model-error' }, provider.error) : null,
    open ? h('div', { className: 'pds-model-list' }, provider.models.map((model) => h(ModelItem, {
      key: model.id,
      model,
      checked: chosen.has(`${provider.id}\u0000${model.id}`),
      disabled,
      onChange: (next) => onToggleModel(model, next),
    }))) : null);
}
