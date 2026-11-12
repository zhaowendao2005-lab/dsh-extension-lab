import { useEffect, useRef } from '../runtime';

/**
 * Closes a controlled popover when the pointer goes outside its root or Escape
 * is pressed. The root must wrap both the trigger and the popover so clicking
 * the trigger remains an ordinary toggle instead of a dismiss + reopen.
 */
export function useDismissablePopover(open: boolean, onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = root.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return root;
}
