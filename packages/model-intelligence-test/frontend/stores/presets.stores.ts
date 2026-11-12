import { createStore } from 'zustand/vanilla';
import type { Preset, PresetsState } from '../types';
import { createPresetSource } from './presets.datasource';

export function createPresetsDomain() {
  const store = createStore<PresetsState>(() => ({ items: [], collapsed: false }));
  let readFailed = false;
  const source = createPresetSource();
  return {
    store,
    load(): void {
      try { store.setState({ items: source.read(), error: undefined }); readFailed = false; }
      catch (error) { readFailed = true; store.setState({ error: error instanceof Error ? error.message : String(error) }); }
    },
    persist(items: Preset[]): string | undefined {
      let error: string | undefined;
      if (readFailed) error = '本地预设未能完整读取。为保护已有数据，本次写入已阻止；请恢复存储权限或修复本地数据，复制未保存提示词后刷新页面重试（内存记录会清空）。';
      else {
        try { source.write(items); store.setState({ items, error: undefined }); }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
      }
      if (error) store.setState({ error });
      return error;
    },
    toggle(): void { store.setState(state => ({ collapsed: !state.collapsed })); },
  };
}
