import { h } from '../../../../runtime.js';
import { Section } from '../../../Section.js';
import { debugGroups } from '../../../../service/debug.service.js';
import { DebugGroup } from './DebugGroup.js';

/** Debug tree: fixed runtime rows first, then one collapsible group per script kind. */
export function DebugSection({ store, state }) {
  const snapshot = state.snapshot;
  const ui = state.ui;
  const groups = debugGroups(snapshot);
  const count = (snapshot?.commands ?? []).length || undefined;
  return h(Section, {
    id: 'debug',
    title: '调试',
    count,
    expanded: ui.sections.debug !== false,
    onToggle: () => store.toggleSection('debug'),
  },
    h('div', { className: 'pds-tree' },
      groups.map((group) => h(DebugGroup, {
        key: group.id,
        group,
        open: ui.groups[group.id] !== false,
        selected: ui.selectedNode,
        runningCommandId: snapshot?.command?.state === 'running' ? snapshot.command.id : null,
        onToggle: () => store.toggleGroup(group.id),
        onSelect: (node) => {
          store.selectNode(node.id);
          if (node.action) { void store[mapAction(node.action)](); return; }
          if (node.commandId) void store.createTerminal(node.commandId);
        },
      }))));
}

const mapAction = (action) => (action === 'launch' ? 'launch' : action === 'stop' ? 'stop' : action);
