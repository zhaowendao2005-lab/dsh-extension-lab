import React from './runtime'

/**
 * Closes a controlled popover when the pointer goes outside its root or Escape
 * is pressed. Ported from `packages/model-intelligence-test/frontend/components/useDismissablePopover.ts`.
 */
export function useDismissablePopover(open: boolean, onClose: () => void) {
  const root = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const node = root.current
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        closeRef.current()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      closeRef.current()
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
