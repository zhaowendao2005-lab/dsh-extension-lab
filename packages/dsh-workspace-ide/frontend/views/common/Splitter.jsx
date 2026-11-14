import { useEffect, useRef } from '../../runtime.js';

/**
 * Row-resize handle for the bottom panel (docs/ui-spec.md §9). It writes on every
 * pointer move (so the drag tracks the cursor) and persists once on release.
 */
export function Splitter({ value, min, max, onChange, onCommit, label }) {
  const dragging = useRef(false);
  const start = useRef({ y: 0, value: 0 });
  const node = useRef(null);

  useEffect(() => {
    function move(event) {
      if (!dragging.current) return;
      const delta = start.current.y - event.clientY;
      const next = Math.min(max, Math.max(min, start.current.value + delta));
      onChange(next);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      if (node.current) node.current.dataset.dragging = 'false';
      document.body.style.cursor = '';
      onCommit?.();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [max, min, onChange, onCommit]);

  return (
    <div
      ref={node}
      className="wid-split"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      data-dragging="false"
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        start.current = { y: event.clientY, value };
        if (node.current) node.current.dataset.dragging = 'true';
        document.body.style.cursor = 'row-resize';
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const step = event.shiftKey ? 40 : 8;
        const next = Math.min(max, Math.max(min, value + (event.key === 'ArrowUp' ? step : -step)));
        onChange(next);
        onCommit?.();
      }}
    />
  );
}
