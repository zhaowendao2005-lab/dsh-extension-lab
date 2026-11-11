import { h } from '../../../../runtime.js';

/** A single model checkbox row: name, then the model id/description as a hint. */
export function ModelItem({ model, checked, disabled, onChange }) {
  return h('label', { className: 'pds-model-item' },
    h('input', { type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked) }),
    h('span', { className: 'pds-model-label' },
      h('span', { className: 'pds-model-id' }, model.name || model.id),
      model.description ? h('span', { className: 'pds-model-desc' }, model.description) : null));
}
