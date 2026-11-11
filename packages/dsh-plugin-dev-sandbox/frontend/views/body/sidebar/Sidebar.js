import { h } from '../../../runtime.js';
import { DebugSection } from './debug/DebugSection.js';
import { ModelsSection } from './models/ModelsSection.js';

/** Left column: two sections, both expanded/collapsed through the store. */
export function Sidebar({ store, state }) {
  return h('div', { className: 'pds-side' },
    h('div', { className: 'pds-side-scroll' },
      h(DebugSection, { store, state }),
      h(ModelsSection, { store, state })));
}
