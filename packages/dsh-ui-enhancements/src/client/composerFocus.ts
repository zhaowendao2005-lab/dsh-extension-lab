/**
 * Composer focus helpers.
 *
 * The conversation composer is a Lexical contenteditable rendered by the app as
 * `[data-composer-input]` inside its `[data-composer-card]` card. Overlays such
 * as the model picker take focus while they are open, so when they close we
 * hand focus back — otherwise the next keystroke goes nowhere and the user has
 * to click the input again.
 */

const COMPOSER_INPUT = '[data-composer-input]'
const COMPOSER_CARD = '[data-composer-card]'
const OVERLAY = '.dsh-enh-mp-popover'
const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]'

/** Frames to keep retrying while the host re-renders the composer. */
const RETRY_FRAMES = 20

function isInsideOverlay(el: Element): boolean {
  return el.closest(OVERLAY) !== null
}

function isFocusable(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (isInsideOverlay(el)) return false
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** The conversation editor — the place typing should resume. */
export function findComposerInput(): HTMLElement | null {
  const direct = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_INPUT)).find(
    (el) => isFocusable(el) && isVisible(el) && el.isContentEditable,
  )
  if (direct) return direct

  // Fallback for a host that drops the hook: the bottom-most visible editor
  // outside dialogs and overlays.
  const fallback = Array.from(document.querySelectorAll<HTMLElement>(EDITABLE)).filter(
    (el) => isFocusable(el) && isVisible(el) && el.closest('[role="dialog"]') === null,
  )
  fallback.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)
  return fallback[0] ?? null
}

/**
 * Keep the caret where the user left it; only build one when the editor has no
 * selection of its own (fresh focus would otherwise start at the top).
 */
function placeCaretAtEnd(el: HTMLElement): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const end = el.value.length
    try {
      el.setSelectionRange(end, end)
    } catch {
      /* not selectable */
    }
    return
  }
  if (!el.isContentEditable) return
  const selection = window.getSelection()
  if (!selection) return
  if (selection.rangeCount > 0 && selection.anchorNode && el.contains(selection.anchorNode)) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function resolveTarget(preferred: HTMLElement | null): HTMLElement | null {
  if (preferred && preferred !== document.body && isFocusable(preferred)) {
    const continuesTyping =
      preferred.isContentEditable ||
      preferred.matches('textarea, [role="textbox"]') ||
      preferred.closest(COMPOSER_CARD) !== null
    // Typing in the composer is the expected continuation, so an editor or
    // anything inside the composer card resolves to the composer itself.
    // Any other trigger (a settings control, say) simply gets its focus back.
    return continuesTyping ? findComposerInput() ?? preferred : preferred
  }
  return findComposerInput()
}

export interface RestoreComposerFocusOptions {
  /** Element that owned focus before the overlay opened. */
  preferred?: HTMLElement | null
}

/**
 * Move focus back where typing should continue.
 *
 * Retries across a few frames because switching the host model re-renders the
 * composer and can drop focus again. Retries stop as soon as the user interacts
 * or something else takes focus, so this never pulls focus away from a place
 * the user just chose.
 */
export function restoreComposerFocus(options: RestoreComposerFocusOptions = {}): void {
  const preferred = options.preferred ?? null
  const initial = resolveTarget(preferred)
  if (!initial) return
  let target: HTMLElement = initial

  let cancelled = false
  const cancel = (): void => {
    cancelled = true
  }
  const listenOptions: AddEventListenerOptions = { capture: true, passive: true }
  const stopListening = (): void => {
    document.removeEventListener('pointerdown', cancel, listenOptions)
    document.removeEventListener('keydown', cancel, listenOptions)
    document.removeEventListener('wheel', cancel, listenOptions)
  }
  document.addEventListener('pointerdown', cancel, listenOptions)
  document.addEventListener('keydown', cancel, listenOptions)
  document.addEventListener('wheel', cancel, listenOptions)

  let frames = 0
  const attempt = (): boolean => {
    if (cancelled) return true
    // The host can rebuild the composer while switching the model, so a target
    // captured earlier may be detached by now: look it up again.
    if (!target.isConnected || !isFocusable(target)) {
      const replacement = resolveTarget(preferred)
      if (!replacement) return false
      target = replacement
    }
    const active = document.activeElement as HTMLElement | null
    const ownedElsewhere =
      active !== null &&
      active !== target &&
      active !== document.body &&
      active.isConnected &&
      !isInsideOverlay(active)
    if (ownedElsewhere) return true
    if (active !== target) {
      try {
        target.focus({ preventScroll: true })
      } catch {
        target.focus()
      }
    }
    if (document.activeElement !== target) return false
    placeCaretAtEnd(target)
    return true
  }

  const tick = (): void => {
    if (attempt()) {
      stopListening()
      return
    }
    frames += 1
    if (frames > RETRY_FRAMES) {
      stopListening()
      return
    }
    window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}
