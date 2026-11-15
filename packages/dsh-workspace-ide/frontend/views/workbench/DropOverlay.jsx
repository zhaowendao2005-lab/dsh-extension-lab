import { useStore } from '../../runtime.js';

const LABELS = {
  left: '拆分到左侧',
  right: '拆分到右侧',
  top: '拆分到上方',
  bottom: '拆分到下方',
  center: '移动到此处',
};

/** The five-zone highlight shown inside the group the pointer is over. */
export function DropOverlay({ stores, groupId }) {
  const layout = useStore(stores.layout);
  const drag = layout.drag;
  if (!drag || !drag.target || drag.target.groupId !== groupId) return null;
  const zone = drag.target.zone;
  return (
    <div className="wid-dropzone" data-zone={zone} aria-hidden="true">
      <span className="wid-dropzone__label">{LABELS[zone] ?? '移动到此处'}</span>
    </div>
  );
}
