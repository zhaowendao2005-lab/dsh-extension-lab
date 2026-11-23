import React from '../runtime';

/**
 * Draggable column separator shared by every data table. Dragging and the arrow keys both feed the
 * same clamped width callback, so the pointer and keyboard paths cannot disagree.
 */
export function ColumnResizer({ width,label,min=88,max=560,onResize }: {
  width: number;
  label: string;
  min?: number;
  max?: number;
  onResize(width: number): void;
}) {
  const clamp = (value: number): number => Math.max(min,Math.min(max,value));
  return <span role="separator" tabIndex={0} aria-label={`调整${label}列宽`} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} className="mit-column-resizer" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={event => {
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      onResize(clamp(width+event.movementX));
  }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={event => {
    if(event.key==='ArrowLeft'||event.key==='ArrowRight') {
      event.preventDefault();
      onResize(clamp(width+(event.key==='ArrowRight'? 16:-16)));
    }
  }} />;
}
