/**
 * Pure path/validation helpers and DOM hit-testing/insertion utilities for
 * Explorer internal drag-move and cross-surface drag-to-chat interactions.
 */

export function parentDirOf(path) {
  if (typeof path !== 'string' || !path.includes('/')) return '';
  return path.slice(0, path.lastIndexOf('/'));
}

export function baseNameOf(path) {
  if (typeof path !== 'string') return '';
  return path.split('/').pop() ?? path;
}

/** Collapse child paths whose ancestor folder is already in the dragged set. */
export function normalizeMoveTargets(items) {
  const list = [...new Map(
    (items ?? [])
      .filter((item) => item && typeof item.path === 'string' && item.path.length > 0)
      .map((item) => [item.path, { path: item.path, type: item.type === 'directory' ? 'directory' : 'file' }]),
  ).values()].sort((a, b) => a.path.length - b.path.length);

  const kept = [];
  for (const item of list) {
    if (kept.some((parent) => parent.type === 'directory' && item.path.startsWith(parent.path + '/'))) {
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/** Validate whether `sources` can be moved into `targetDir` ('' means workspace root). */
export function canMoveToDir(sources, targetDir) {
  const normalized = normalizeMoveTargets(sources);
  if (!normalized.length) return { valid: false, reason: '没有可移动的项目' };
  const dest = typeof targetDir === 'string' ? targetDir : '';
  let hasEffectiveMove = false;
  for (const item of normalized) {
    if (dest === item.path) {
      return { valid: false, reason: '不能移动到自身' };
    }
    if (item.type === 'directory' && dest.startsWith(item.path + '/')) {
      return { valid: false, reason: '不能将文件夹移动到其子目录内' };
    }
    if (parentDirOf(item.path) !== dest) {
      hasEffectiveMove = true;
    }
  }
  if (!hasEffectiveMove) return { valid: false, reason: '已在当前目录中' };
  return { valid: true };
}

export function formatDropPathsForChat(paths) {
  const clean = (paths ?? []).filter((p) => typeof p === 'string' && p.length > 0);
  if (!clean.length) return '';
  return clean.map((p) => '@' + p).join(' ') + ' ';
}

const COMPOSER_INPUT_SELECTOR = '[data-composer-input]';
const COMPOSER_CARD_SELECTOR = '[data-composer-card]';
const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]';

function isNodeVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

/** Locate the active chat composer input outside workbench dialogs. */
export function findChatComposerInput() {
  if (typeof document === 'undefined') return null;
  const inputs = Array.from(document.querySelectorAll(COMPOSER_INPUT_SELECTOR));
  const match = inputs.find((el) => isNodeVisible(el) && !el.closest('[role="dialog"]'));
  if (match) return match;
  const fallback = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
    .filter((el) => isNodeVisible(el) && !el.closest('[role="dialog"]') && !el.closest('.wid-root'))
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  return fallback[0] ?? null;
}

/** Hit-test whether (clientX, clientY) is over the Host chat composer or conversation area. */
export function findChatDropTarget(clientX, clientY) {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!el || typeof el.closest !== 'function') continue;
    if (el.closest('.wid-root') || el.closest('.wid-fullview-shadow') || el.closest('.wid-ext-dragghost')) continue;
    const composer = el.closest(COMPOSER_CARD_SELECTOR) || el.closest(COMPOSER_INPUT_SELECTOR);
    if (composer && isNodeVisible(composer)) return { kind: 'composer', element: composer };
    const scroll = el.closest(CONVERSATION_SCROLL_SELECTOR);
    if (scroll && isNodeVisible(scroll)) return { kind: 'conversation', element: scroll };
  }
  return null;
}

function placeCaretAtEnd(el) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const end = el.value.length;
    el.setSelectionRange?.(end, end);
    return;
  }
  if (!el.isContentEditable) return;
  const selection = window.getSelection();
  if (!selection) return;
  if (selection.rangeCount > 0 && selection.anchorNode && el.contains(selection.anchorNode)) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Insert formatted `@path` references into the Host chat composer without losing existing draft. */
export function insertTextIntoChatComposer(text) {
  if (!text) return false;
  const input = findChatComposerInput();
  if (!input) return false;
  input.focus({ preventScroll: true });
  placeCaretAtEnd(input);

  const existingText = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
    ? input.value
    : (input.textContent ?? '');
  const needsLeadingSpace = existingText.length > 0 && !/\s$/.test(existingText);
  const payload = (needsLeadingSpace ? ' ' : '') + text;

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(payload, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  let inserted = false;
  if (typeof document.execCommand === 'function') {
    try {
      inserted = document.execCommand('insertText', false, payload);
    } catch {
      inserted = false;
    }
  }
  if (!inserted && typeof InputEvent === 'function') {
    input.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: payload,
      bubbles: true,
      cancelable: true,
    }));
    inserted = true;
  }
  return inserted;
}

/**
 * Top-level floating drag ghost & FullView peeking controller.
 * Uses document.body absolute coordinates (no fixed positioning, keeping R15 happy)
 * so it remains visible even when FullView Shadow DOM fades to peeking mode.
 */
export function createDragOverlayController(sourceElement) {
  const shadowRoot = sourceElement?.getRootNode?.();
  const isShadow = typeof ShadowRoot !== 'undefined' && shadowRoot instanceof ShadowRoot;
  const fullViewBackdrop = isShadow ? shadowRoot.querySelector('.wid-fullview-backdrop') : null;
  const fullViewDialog = isShadow ? shadowRoot.querySelector('.wid-fullview') : null;
  const initialDialogRect = fullViewDialog ? fullViewDialog.getBoundingClientRect() : null;

  let ghostEl = null;
  let highlightedChatEl = null;
  let peeking = false;

  function ensureGhost() {
    if (ghostEl || typeof document === 'undefined' || !document.body) return ghostEl;
    const el = document.createElement('div');
    el.className = 'wid-ext-dragghost';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    ghostEl = el;
    return el;
  }

  function setPeeking(next) {
    if (peeking === next) return;
    peeking = next;
    if (fullViewBackdrop) {
      if (next) fullViewBackdrop.setAttribute('data-wid-peeking', 'true');
      else fullViewBackdrop.removeAttribute('data-wid-peeking');
    }
  }

  function setChatHighlight(targetEl, label) {
    if (highlightedChatEl && highlightedChatEl !== targetEl) {
      highlightedChatEl.removeAttribute('data-wid-chat-drop');
      highlightedChatEl.removeAttribute('data-wid-chat-drop-label');
    }
    highlightedChatEl = targetEl ?? null;
    if (highlightedChatEl) {
      highlightedChatEl.setAttribute('data-wid-chat-drop', 'true');
      if (label) highlightedChatEl.setAttribute('data-wid-chat-drop-label', label);
    }
  }

  return {
    isFullView: Boolean(fullViewBackdrop && initialDialogRect),
    isPeeking: () => peeking,

    updatePosition(clientX, clientY, label, tone = 'neutral') {
      const el = ensureGhost();
      if (!el) return;
      el.style.display = '';
      const bodyRect = document.body.getBoundingClientRect();
      el.style.left = (clientX - bodyRect.left + 14) + 'px';
      el.style.top = (clientY - bodyRect.top + 12) + 'px';
      el.dataset.tone = tone;
      el.textContent = label;
    },

    hideGhost() {
      if (ghostEl) ghostEl.style.display = 'none';
    },

    updatePeeking(clientX, clientY) {
      if (!initialDialogRect) return false;
      // Add small hysteresis when returning inside so the border does not flicker.
      const pad = peeking ? 14 : -6;
      const inside = clientX >= initialDialogRect.left + pad
        && clientX <= initialDialogRect.right - pad
        && clientY >= initialDialogRect.top + pad
        && clientY <= initialDialogRect.bottom - pad;
      setPeeking(!inside);
      return peeking;
    },

    setChatTarget(target, label) {
      setChatHighlight(target?.element ?? null, label);
    },

    dispose() {
      setPeeking(false);
      setChatHighlight(null, '');
      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
      }
    },
  };
}
