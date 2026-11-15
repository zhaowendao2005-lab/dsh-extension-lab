import React from './runtime'

/** Why a dismissable popover closed. */
export type DismissReason = 'escape' | 'outside'

/**
 * Closes a controlled popover when the pointer goes outside its root or Escape
 * is pressed. The reason is forwarded so the owner can decide whether focus
 * should return to where it was before opening.
 *
 * `onEscape` may intercept Escape (for example to leave an inline sub-mode
 * first): returning true means the press was consumed and the popover stays
 * open.
 */
export function useDismissablePopover(
  open: boolean,
  onClose: (reason: DismissReason) => void,
  onEscape?: () => boolean,
) {
  const root = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  const escapeRef = React.useRef(onEscape)
  escapeRef.current = onEscape

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const node = root.current
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        closeRef.current('outside')
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      if (escapeRef.current?.() === true) return
      closeRef.current('escape')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return root
}
