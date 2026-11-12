import type { Preset } from '../types';

const KEY = 'model-intelligence-test:presets:v1';
const MAX_PRESETS = 200;
const MAX_BODY = 100_000;

export function validatePreset(preset: Preset): Preset {
  if (!preset || typeof preset.id !== 'string' || !preset.id.trim() || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.trim().length > 100 || typeof preset.body !== 'string' || preset.body.length > MAX_BODY) throw new Error('预设无效：名称须为 1–100 字，正文最多 100,000 字。');
  return { id: preset.id, name: preset.name.trim(), body: preset.body };
}
function storage(): Storage {
  if (typeof localStorage === 'undefined') throw new Error('本地存储不可用，无法读取或保存预设。');
  return localStorage;
}
function parse(raw: string | null): Preset[] {
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('本地预设数据损坏；未覆盖已有数据。'); }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('items' in value) || !Array.isArray(value.items) || value.items.length > MAX_PRESETS) throw new Error('本地预设版本或结构不受支持；未覆盖已有数据。');
  const ids = new Set<string>();
  return value.items.map((item: Preset) => {
    const preset = validatePreset(item);
    if (ids.has(preset.id)) throw new Error('本地预设 ID 重复；未覆盖已有数据。');
    ids.add(preset.id);
    return preset;
  });
}

/** Each session tracks its read revision; stale writers fail instead of overwriting. */
export function createPresetRepository() {
  let expectedRaw: string | null | undefined;
  return {
    read(): Preset[] {
      const raw = storage().getItem(KEY);
      const items = parse(raw);
      expectedRaw = raw;
      return items;
    },
    write(items: Preset[]): void {
      if (items.length > MAX_PRESETS) throw new Error('最多可保存 200 个预设。');
      const valid = items.map(validatePreset);
      if (new Set(valid.map(item => item.id)).size !== valid.length) throw new Error('预设 ID 重复，保存已中止。');
      try {
        const target = storage();
        if (expectedRaw === undefined || target.getItem(KEY) !== expectedRaw) throw new Error('其他会话或窗口已修改本地预设；为避免覆盖，保存已中止。请复制未保存提示词后刷新页面重试（内存记录会清空）。');
        const raw = JSON.stringify({ version: 1, items: valid });
        target.setItem(KEY, raw);
        expectedRaw = raw;
      } catch (error) { throw new Error(`保存预设失败：${error instanceof Error ? error.message : '存储权限或容量不足'}`); }
    },
  };
}
