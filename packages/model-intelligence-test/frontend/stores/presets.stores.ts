import { createStore } from 'zustand/vanilla';
import type { Preset, PresetsState } from '../types';
import { createPresetSource } from './presets.datasource';

const BUILTIN_TOTORO: Preset = { id: 'builtin-totoro', name: '龙猫测试', body: '以龙猫与森林为主题，设计一份完整、可直接打开的单页 HTML 作品。请先读取沙箱规则与任务输入，完成后写入 output/ 并声明一个有效的 HTML 成果。' };

export function createPresetsDomain() {
  const store = createStore<PresetsState>(() => ({ items: [BUILTIN_TOTORO], collapsed: false }));
  let readFailed = false;
  const source = createPresetSource();
  return {
    store,
    load(): void {
      try { store.setState({ items: [BUILTIN_TOTORO, ...source.read().filter(item => item.id !== BUILTIN_TOTORO.id)], error: undefined }); readFailed = false; }
      catch (error) { readFailed = true; store.setState({ error: error instanceof Error ? error.message : String(error) }); }
    },
    persist(items: Preset[]): string | undefined {
      let error: string | undefined;
      if (readFailed) error = '本地预设未能完整读取。为保护已有数据，本次写入已阻止；请恢复存储权限或修复本地数据，复制未保存提示词后刷新页面重试（内存记录会清空）。';
      else {
        try { const userItems = items.filter(item => item.id !== BUILTIN_TOTORO.id); source.write(userItems); store.setState({ items: [BUILTIN_TOTORO, ...userItems], error: undefined }); }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
      }
      if (error) store.setState({ error });
      return error;
    },
    toggle(): void { store.setState(state => ({ collapsed: !state.collapsed })); },
  };
}
