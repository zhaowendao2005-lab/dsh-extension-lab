/** Viewport coordinates stay physical; positioned workbench children use logical pixels. */
export function workbenchRoot(element) {
  return element?.closest?.('.wid-root') ?? null;
}

export function workbenchScale(element) {
  const root = workbenchRoot(element);
  const percent = Number(root?.dataset.uiScale);
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
}

/** Convert to this element's logical coordinates, keeping an overlay inside its bounds. */
export function localPoint(element, clientX, clientY, width = 0, height = 0, margin = 4) {
  const scale = workbenchScale(element);
  const rect = element?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 1200, height: 800 };
  const x = (clientX - rect.left) / scale;
  const y = (clientY - rect.top) / scale;
  return {
    x: Math.max(margin, Math.min(x, rect.width / scale - width - margin)),
    y: Math.max(margin, Math.min(y, rect.height / scale - height - margin)),
  };
}
