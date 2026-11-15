/**
 * Workbench layout domain: tab ownership, editor groups and the split tree.
 * The tree only stores structure; groups only store tab ids. Pure operations live in
 * service/split.js, so this file is the single mutable owner (AGENTS.md: one store per domain).
 */
import { createStore } from '../store.js';
import {
  canSplit, dirOf, firstOf, groupLeaf, groupIds, leafEntries, pruneTree, removeLeaf,
  splitLeaf, updateRatio,
} from '../service/split.js';
import { TAB_KINDS, kindOfViewId } from '../service/tabs.js';

const MAX_TABS = 40;

function freshGroup() {
  return { tabs: [], active: null };
}

function emptyState() {
  return {
    groups: { g1: freshGroup() },
    tree: groupLeaf('g1'),
    tabs: {},
    activeGroup: 'g1',
    drag: null,
    sizes: {},
    nextGroup: 2,
  };
}

function groupOfTab(state, tabId) {
  for (const [groupId, group] of Object.entries(state.groups)) {
    if (group.tabs.includes(tabId)) return groupId;
  }
  return null;
}

function withoutTab(group, tabId) {
  const index = group.tabs.indexOf(tabId);
  if (index < 0) return group;
  const tabs = group.tabs.filter((id) => id !== tabId);
  const active = group.active === tabId ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : group.active;
  return { ...group, tabs, active };
}

function insertTab(group, tabId, index) {
  const tabs = [...group.tabs];
  const at = Number.isInteger(index) ? Math.min(Math.max(0, index), tabs.length) : tabs.length;
  tabs.splice(at, 0, tabId);
  return { ...group, tabs, active: tabId };
}

function normalizeGroupIds(ids) {
  const next = ids.filter((id) => id && typeof id === 'string');
  return [...new Set(next)];
}

export function createLayoutStore({ onChange } = {}) {
  const store = createStore(emptyState());

  function commit(next) {
    store.set(next);
    try { onChange?.(); } catch (error) { console.error('[workspace-ide] layout persist failed', error); }
    return next;
  }

  const actions = {
    /** Seed from a persisted snapshot; bad nodes are dropped instead of throwing. */
    restore(saved) {
      const tabs = {};
      const savedTabs = saved && typeof saved.tabs === 'object' ? saved.tabs : {};
      let count = 0;
      for (const [id, tab] of Object.entries(savedTabs)) {
        if (count >= MAX_TABS) break;
        if (!tab || typeof tab !== 'object') continue;
        const kind = typeof tab.kind === 'string' ? tab.kind : kindOfViewId(id);
        if (!TAB_KINDS.includes(kind)) continue;
        if (kind === 'file' && typeof tab.path !== 'string') continue;
        tabs[id] = {
          id,
          kind,
          ...(kind === 'file' ? { path: tab.path, title: typeof tab.title === 'string' ? tab.title : undefined } : {}),
        };
        count += 1;
      }

      const groups = {};
      let nextGroup = 2;
      const savedGroups = saved && typeof saved.groups === 'object' ? saved.groups : {};
      for (const [groupId, group] of Object.entries(savedGroups)) {
        if (!group || typeof group !== 'object') continue;
        const ids = normalizeGroupIds(Array.isArray(group.tabs) ? group.tabs : []);
        const kept = ids.filter((id) => tabs[id]);
        if (!kept.length && Object.keys(groups).length > 0) continue;
        const active = kept.includes(group.active) ? group.active : (kept[0] ?? null);
        groups[groupId] = { tabs: kept, active };
        const numeric = Number(String(groupId).replace(/^g/, ''));
        if (Number.isFinite(numeric)) nextGroup = Math.max(nextGroup, numeric + 1);
      }

      let tree = saved && saved.tree ? saved.tree : null;
      const keep = new Set(Object.keys(groups));
      if (tree) tree = pruneTree(tree, keep);
      if (!tree) {
        const first = Object.keys(groups)[0];
        if (first) tree = groupLeaf(first);
      }
      if (!tree) {
        commit(emptyState());
        return store.getSnapshot();
      }
      const order = groupIds(tree);
      const reachable = new Set(order);
      for (const groupId of Object.keys(groups)) {
        if (!reachable.has(groupId)) delete groups[groupId];
      }
      const activeGroup = groups[saved?.activeGroup] ? saved.activeGroup : (order[0] ?? 'g1');
      return commit({
        groups,
        tree,
        tabs,
        activeGroup,
        drag: null,
        sizes: {},
        nextGroup,
      });
    },

    /** Persistable shape; view-only state (drag/sizes) is not stored. */
    serialize() {
      const state = store.getSnapshot();
      return {
        version: 1,
        tree: state.tree,
        groups: state.groups,
        tabs: state.tabs,
        activeGroup: state.activeGroup,
      };
    },

    /** Open or reveal a tab. Returns { groupId, created }. */
    open(tab, options = {}) {
      if (!tab || typeof tab.id !== 'string' || !TAB_KINDS.includes(tab.kind)) return null;
      const state = store.getSnapshot();
      const existing = groupOfTab(state, tab.id);
      if (existing) {
        const group = state.groups[existing];
        if (group.active !== tab.id) {
          commit({
            ...state,
            activeGroup: existing,
            groups: { ...state.groups, [existing]: { ...group, active: tab.id } },
          });
        } else if (state.activeGroup !== existing) {
          commit({ ...state, activeGroup: existing });
        }
        return { groupId: existing, created: false };
      }

      let target = options.groupId && state.groups[options.groupId] ? options.groupId : state.activeGroup;
      if (!state.groups[target]) target = Object.keys(state.groups)[0];
      if (!target) {
        const seeded = emptyState();
        seeded.tabs[tab.id] = normalizeTab(tab);
        seeded.groups.g1 = { tabs: [tab.id], active: tab.id };
        commit(seeded);
        return { groupId: 'g1', created: true };
      }

      const group = state.groups[target];
      const anchor = group.active ? group.tabs.indexOf(group.active) : group.tabs.length - 1;
      const groups = {
        ...state.groups,
        [target]: insertTab(group, tab.id, anchor + 1),
      };
      const tabs = { ...state.tabs, [tab.id]: normalizeTab(tab) };
      if (Object.keys(tabs).length > MAX_TABS) return null;
      commit({ ...state, groups, tabs, activeGroup: target });
      return { groupId: target, created: true };
    },

    /** Close one tab; an emptied group collapses unless it is the only group. */
    close(tabId) {
      const state = store.getSnapshot();
      const groupId = groupOfTab(state, tabId);
      if (!groupId) return null;
      const group = withoutTab(state.groups[groupId], tabId);
      const groups = { ...state.groups };
      const tabs = { ...state.tabs };
      delete tabs[tabId];
      let tree = state.tree;
      let activeGroup = state.activeGroup;
      if (group.tabs.length === 0 && groupIds(tree).length > 1) {
        delete groups[groupId];
        tree = removeLeaf(tree, groupId) ?? groupLeaf(Object.keys(groups)[0] ?? 'g1');
        if (!groups[Object.keys(groups)[0]]) {
          groups.g1 = freshGroup();
          tree = groupLeaf('g1');
          activeGroup = 'g1';
        }
        if (activeGroup === groupId) activeGroup = groupIds(tree)[0];
      } else {
        groups[groupId] = group;
      }
      commit({ ...state, groups, tabs, tree, activeGroup });
      return { groupId, groupRemoved: !groups[groupId] };
    },

    activate(groupId, tabId) {
      const state = store.getSnapshot();
      const group = state.groups[groupId];
      if (!group || !group.tabs.includes(tabId)) return;
      commit({
        ...state,
        activeGroup: groupId,
        groups: { ...state.groups, [groupId]: { ...group, active: tabId } },
      });
    },

    setActiveGroup(groupId) {
      const state = store.getSnapshot();
      if (!state.groups[groupId] || state.activeGroup === groupId) return;
      commit({ ...state, activeGroup: groupId });
    },

    /** Split a group toward a zone and move the tab into the new group. */
    split(tabId, groupId, zone) {
      const state = store.getSnapshot();
      if (!state.tabs[tabId] || !state.groups[groupId]) return false;
      if (groupIds(state.tree).length >= 4) return false;
      if (!zone || zone === 'center') return false;
      const sourceId = groupOfTab(state, tabId);
      const newGroupId = 'g' + state.nextGroup;
      const groups = { ...state.groups };
      if (sourceId) groups[sourceId] = withoutTab(groups[sourceId], tabId);
      groups[newGroupId] = { tabs: [tabId], active: tabId };
      let tree = splitLeaf(state.tree, groupId, {
        dir: dirOf(zone),
        first: firstOf(zone),
        newGroupId,
      });
      if (sourceId && sourceId !== groupId && groups[sourceId] && groups[sourceId].tabs.length === 0) {
        delete groups[sourceId];
        tree = removeLeaf(tree, sourceId) ?? tree;
      }
      commit({
        ...state,
        groups,
        tree,
        activeGroup: newGroupId,
        nextGroup: state.nextGroup + 1,
        drag: null,
      });
      return true;
    },

    /** Move a tab into another group (center drop) or reorder within one. */
    move(tabId, groupId, index) {
      const state = store.getSnapshot();
      if (!state.tabs[tabId] || !state.groups[groupId]) return false;
      const sourceId = groupOfTab(state, tabId);
      if (sourceId === groupId) {
        const group = state.groups[groupId];
        if (Number.isInteger(index)) {
          const next = insertTab(withoutTab(group, tabId), tabId, index);
          commit({ ...state, groups: { ...state.groups, [groupId]: next }, activeGroup: groupId });
        } else {
          commit({
            ...state,
            activeGroup: groupId,
            groups: { ...state.groups, [groupId]: { ...group, active: tabId } },
          });
        }
        return true;
      }
      const groups = { ...state.groups };
      if (sourceId) groups[sourceId] = withoutTab(groups[sourceId], tabId);
      groups[groupId] = insertTab(groups[groupId], tabId, index);
      let tree = state.tree;
      if (sourceId && groups[sourceId] && groups[sourceId].tabs.length === 0 && groupIds(tree).length > 1) {
        delete groups[sourceId];
        tree = removeLeaf(tree, sourceId) ?? tree;
      }
      commit({ ...state, groups, tree, activeGroup: groupId, drag: null });
      return true;
    },

    resize(path, ratio) {
      const state = store.getSnapshot();
      commit({ ...state, tree: updateRatio(state.tree, path, ratio) });
    },

    /** Measured group sizes, used to decide whether a split fits. Not persisted. */
    measure(groupId, width, height) {
      const state = store.getSnapshot();
      const previous = state.sizes[groupId];
      if (previous && Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1) return;
      store.patch({ sizes: { ...state.sizes, [groupId]: { width, height } } });
    },

    beginDrag(tabId, fromGroup, x, y) {
      commit({ ...store.getSnapshot(), drag: { tabId, fromGroup, x, y, target: null } });
    },

    moveDrag(x, y, target) {
      const state = store.getSnapshot();
      if (!state.drag) return;
      const previous = state.drag.target;
      if (previous && target && previous.groupId === target.groupId && previous.zone === target.zone) {
        store.patch({ drag: { ...state.drag, x, y } });
        return;
      }
      if (!previous && !target) {
        store.patch({ drag: { ...state.drag, x, y } });
        return;
      }
      store.patch({ drag: { ...state.drag, x, y, target: target ?? null } });
    },

    endDrag() {
      const state = store.getSnapshot();
      if (!state.drag) return;
      commit({ ...state, drag: null });
    },

    /** Can this tab be split into this group/zone at the measured size? */
    canDrop(groupId, zone) {
      const state = store.getSnapshot();
      if (!zone || zone === 'center') return true;
      if (groupIds(state.tree).length >= 4) return false;
      const size = state.sizes[groupId];
      if (!size) return true;
      return canSplit({ width: size.width, height: size.height, left: 0, top: 0 }, zone);
    },

    groupIds() {
      return groupIds(store.getSnapshot().tree);
    },
  };

  return { store, actions };
}

function normalizeTab(tab) {
  const kind = tab.kind;
  if (kind === 'file') {
    return { id: tab.id, kind, path: tab.path, title: typeof tab.title === 'string' ? tab.title : undefined };
  }
  return { id: tab.id, kind };
}
