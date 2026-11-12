import { pinyin } from 'pinyin-pro';
import type { CatalogTransport, Model, Provider } from '../types';

export function modelSearchText(value: string): string {
  const full = pinyin(value, { toneType: 'none' });
  const initials = pinyin(value, { pattern: 'first', toneType: 'none' });
  return `${value} ${full} ${full.replace(/\s/g, '')} ${initials} ${initials.replace(/\s/g, '')}`.toLocaleLowerCase();
}

/** This is the only model source. Transport errors never produce invented models. */
export async function fetchModelCatalog(transport: CatalogTransport): Promise<{ items: Model[]; providers: Provider[] }> {
  const catalog = await transport.catalog();
  if (!catalog || !Array.isArray(catalog.providers)) throw new Error('模型目录格式无效');
  const providers: Provider[] = [];
  const items: Model[] = [];
  const keys = new Set<string>();
  for (const raw of catalog.providers) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.models)) throw new Error('提供方目录格式无效');
    const provider: Provider = { id: raw.id, name: raw.name, models: [], ...(typeof raw.error === 'string' ? { error: raw.error } : {}) };
    for (const entry of raw.models) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string') throw new Error('模型条目格式无效');
      const key = JSON.stringify([raw.id, entry.id]);
      if (keys.has(key)) continue;
      keys.add(key);
      provider.models.push({ id: entry.id, name: entry.name, ...(typeof entry.description === 'string' ? { description: entry.description } : {}) });
      items.push({ key, provider: raw.id, providerName: raw.name, id: entry.id, name: entry.name, search: modelSearchText(`${raw.id} ${raw.name} ${entry.id} ${entry.name} ${entry.description ?? ''}`) });
    }
    providers.push(provider);
  }
  return { providers, items };
}
