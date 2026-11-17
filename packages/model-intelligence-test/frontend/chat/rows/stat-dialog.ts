// One trigger-anchored stat dialog seat shared by the Turn-stat pills
// (TurnUsagePanel) and the composer-dock session stats pills (StatsPills);
// the matching dialog surface skin lives in the stat-dialog CSS domain.
import React from '../../runtime';
import { useDismissOnOutsidePointer } from './use-dismiss-on-outside-pointer';

/** Open state, refs, and CSS anchor identity for one stat dialog. */
export interface StatDialogSeat {
  open: boolean;
  setOpen: (open: boolean) => void;
  rootRef: React.MutableRefObject<HTMLSpanElement | null>;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  anchorName: string;
}

/**
 * One trigger-anchored dialog seat: open state, CSS anchor placement, outside-close.
 * @returns the seat; assign the anchor name to the trigger and the portaled panel.
 */
export function useStatDialog(): StatDialogSeat {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const anchorName = `--dsh-stat-${React.useId().replaceAll(':', '')}`;

  // Outside pointerdown closes through the shared primitive; the portaled
  // panel counts as inside. An outside click also closes, because keyboard
  // activation of a sibling trigger fires click without pointerdown; the
  // capture phase lets that click close this dialog before the sibling opens.
  // Escape closes.
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      if (e.target instanceof Node
        && rootRef.current?.contains(e.target) !== true
        && panelRef.current?.contains(e.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick, true);
    };
  }, [open, setOpen]);

  return { open, setOpen, rootRef, panelRef, anchorName };
}
