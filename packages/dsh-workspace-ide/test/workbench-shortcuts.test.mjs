import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  matchWorkbenchShortcut,
  handleWorkbenchKeyDown,
  WORKBENCH_SCOPE_ATTR,
  WORKBENCH_SCOPE_ACTIVE_ATTR,
} from '../frontend/service/shortcuts.js';
import { createStore } from '../frontend/store.js';
import { createExplorerSelectionDomain } from '../frontend/stores/explorer-selection.stores.js';
import { previewKindForPath, defaultPreviewForPath } from '../frontend/service/preview.js';
import { DEFAULT_EDITOR_PREFS, normalizeEditorPrefs } from '../frontend/service/layout.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function makeKeyEvent(overrides = {}) {
  const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
  return {
    code: 'KeyP',
    key: 'p',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    keyCode: 80,
    preventDefault() {
      this.defaultPrevented = true;
      calls.preventDefault += 1;
    },
    stopPropagation() {
      calls.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      calls.stopImmediatePropagation += 1;
    },
    calls,
    ...overrides,
  };
}

test('matchWorkbenchShortcut matches exact Ctrl+P and Ctrl+Shift+P only', () => {
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true })), 'quickOpen');
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, shiftKey: true, key: 'P' })), 'commandPalette');

  // Must not match Meta+P, Alt+P, Ctrl+Alt+P, plain P, or IME / prevented events.
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ metaKey: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, metaKey: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, altKey: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ altKey: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, isComposing: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, keyCode: 229 })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, defaultPrevented: true })), null);
  assert.equal(matchWorkbenchShortcut(makeKeyEvent({ ctrlKey: true, code: 'KeyM', key: 'm' })), null);
});

test('handleWorkbenchKeyDown consumes and dispatches, guarding repeat and recording', () => {
  let quickCalls = 0;
  let paletteCalls = 0;
  let recording = false;
  const actions = {
    openQuick() {
      quickCalls += 1;
    },
    openCommandPalette() {
      paletteCalls += 1;
    },
  };

  // Ctrl+P opens file search and consumes event.
  const evQuick = makeKeyEvent({ ctrlKey: true });
  assert.equal(handleWorkbenchKeyDown(evQuick, { actions, isRecording: () => recording }), true);
  assert.equal(quickCalls, 1);
  assert.equal(paletteCalls, 0);
  assert.equal(evQuick.calls.preventDefault, 1);
  assert.equal(evQuick.calls.stopPropagation, 1);
  assert.equal(evQuick.calls.stopImmediatePropagation, 1);

  // Ctrl+Shift+P opens command palette and consumes event.
  const evPalette = makeKeyEvent({ ctrlKey: true, shiftKey: true, key: 'P' });
  assert.equal(handleWorkbenchKeyDown(evPalette, { actions, isRecording: () => recording }), true);
  assert.equal(paletteCalls, 1);
  assert.equal(evPalette.calls.preventDefault, 1);

  // Key repeat is consumed without re-triggering.
  const evRepeat = makeKeyEvent({ ctrlKey: true, repeat: true });
  assert.equal(handleWorkbenchKeyDown(evRepeat, { actions, isRecording: () => recording }), true);
  assert.equal(quickCalls, 1);
  assert.equal(evRepeat.calls.preventDefault, 1);

  // Shortcut recording suppresses handling and does not consume.
  recording = true;
  const evRecording = makeKeyEvent({ ctrlKey: true });
  assert.equal(handleWorkbenchKeyDown(evRecording, { actions, isRecording: () => recording }), false);
  assert.equal(quickCalls, 1);
  assert.equal(evRecording.calls.preventDefault, 0);
});

test('built client bundle declares workbench scope attributes, focusable root, and keeps global defaults empty', async () => {
  const clientCode = await readFile(path.join(root, 'lib/client.js'), 'utf8');
  assert.match(clientCode, new RegExp(WORKBENCH_SCOPE_ATTR));
  assert.match(clientCode, new RegExp(WORKBENCH_SCOPE_ACTIVE_ATTR));
  assert.match(clientCode, /isShortcutRecording/);
  assert.match(clientCode, /\.wid-root:focus\s*\{\s*outline:\s*none;\s*\}/);
});

test('explorer selection domain supports root blank-area context menu', () => {
  const files = createStore({
    entries: {
      '': { entries: [{ name: 'README.md', type: 'file' }] },
    },
    expanded: [],
    visible: {},
    loading: [],
  });
  const workspace = createStore({ root: '/tmp/repo' });
  const domain = createExplorerSelectionDomain({ files, workspace });

  domain.select('README.md');
  assert.deepEqual(domain.store.getSnapshot().selected, ['README.md']);

  domain.openMenu('', { x: 40, y: 180, surface: 'explorer-1' });
  const snap = domain.store.getSnapshot();
  assert.deepEqual(snap.selected, []);
  assert.deepEqual(snap.menu, { path: '', x: 40, y: 180, surface: 'explorer-1' });

  // File tree refresh keeps the root menu open until closed or root changes.
  files.patch({
    entries: {
      '': { entries: [{ name: 'README.md', type: 'file' }, { name: 'a.txt', type: 'file' }] },
    },
  });
  assert.deepEqual(domain.store.getSnapshot().menu, { path: '', x: 40, y: 180, surface: 'explorer-1' });

  domain.closeMenu();
  assert.equal(domain.store.getSnapshot().menu, null);
  domain.dispose();
});

test('preview classification and default-render preferences default to false', () => {
  assert.equal(previewKindForPath('index.html'), 'html');
  assert.equal(previewKindForPath('docs/Page.HTM'), 'html');
  assert.equal(previewKindForPath('README.md'), 'markdown');
  assert.equal(previewKindForPath('notes/guide.MARKDOWN'), 'markdown');
  assert.equal(previewKindForPath('src/app.ts'), null);

  assert.equal(DEFAULT_EDITOR_PREFS.defaultPreviewHtml, false);
  assert.equal(DEFAULT_EDITOR_PREFS.defaultPreviewMd, false);
  assert.equal(defaultPreviewForPath('index.html', DEFAULT_EDITOR_PREFS), false);
  assert.equal(defaultPreviewForPath('README.md', DEFAULT_EDITOR_PREFS), false);

  const enabled = normalizeEditorPrefs({ defaultPreviewHtml: true, defaultPreviewMd: true });
  assert.equal(enabled.defaultPreviewHtml, true);
  assert.equal(enabled.defaultPreviewMd, true);
  assert.equal(defaultPreviewForPath('index.html', enabled), true);
  assert.equal(defaultPreviewForPath('README.md', enabled), true);
  assert.equal(defaultPreviewForPath('src/app.ts', enabled), false);
});
