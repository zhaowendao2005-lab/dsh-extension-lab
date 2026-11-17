import { useStore } from '../../runtime.js';

const LABELS = {
  left: '拆分到左侧',
  right: '拆分到右侧',
  top: '拆分到上方',
  bottom: '拆分到下方',
  center: '移动到此处',
};

const EXPLORER_LABELS = {
  left: '在左侧分栏打开',
  right: '在右侧分栏打开',
  top: '在上方分栏打开',
  bottom: '在下方分栏打开',
  center: '在此打开文件',
};

/** The five-zone highlight shown inside the group the pointer is over. */
export function DropOverlay({ stores, groupId }) {
  const layout = useStore(stores.layout);
  const ui = useStore(stores.ui);
  const extDrop = ui.explorerDrop;
  if (extDrop && extDrop.groupId === groupId) {
    return (
      <div className="wid-dropzone" data-zone={extDrop.zone} aria-hidden="true">
        <span className="wid-dropzone__label">{EXPLORER_LABELS[extDrop.zone] ?? '在此打开文件'}</span>
      </div>
    );
  }
  const drag = layout.drag;
  if (!drag || !drag.target || drag.target.groupId !== groupId) return null;
  const zone = drag.target.zone;
  return (
    <div className="wid-dropzone" data-zone={zone} aria-hidden="true">
      <span className="wid-dropzone__label">{LABELS[zone] ?? '移动到此处'}</span>
    </div>
  );
}
