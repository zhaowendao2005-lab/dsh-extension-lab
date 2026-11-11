import { h } from '../../runtime.js';
import { Sidebar } from './sidebar/Sidebar.js';
import { WorkPane } from './work/WorkPane.js';

/** Split body: the state tree on the left, the terminal workspace on the right. */
export function Body({ store, state }) {
  return h('div', { className: 'pds-main' },
    h(Sidebar, { store, state }),
    h(WorkPane, { store, state }));
}
