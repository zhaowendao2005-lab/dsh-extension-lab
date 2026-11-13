/**
 * Tag vocabulary shared by favorites, test results and filters. A tag is a plain string with a
 * category prefix so any component can filter on it without extra bookkeeping:
 *   close:<model>          接近：<模型>   (fingerprint probability distribution; coloured per model)
 *   quality:intact|degraded  不降智 / 降智
 *   tested                  带真实测试
 */
export type TagCategory = 'close' | 'quality' | 'tested';
export interface TagCategoryInfo { id: TagCategory; label: string }
export const TAG_CATEGORIES: TagCategoryInfo[] = [
  {id: 'close', label: '接近模型'},
  {id: 'quality', label: '智力表现'},
  {id: 'tested', label: '真实测试'},
];
export const FIXED_TAGS: {tag: string; category: TagCategory; label: string}[] = [
  {tag: 'quality:intact', category: 'quality', label: '不降智'},
  {tag: 'quality:degraded', category: 'quality', label: '降智'},
  {tag: 'tested', category: 'tested', label: '带真实测试'},
];
const PALETTE = ['#2F7D52', '#2F6FBF', '#7A4FB5', '#C0492F', '#B8860B', '#1F8A8A', '#B83280', '#5B6B2F', '#3F5BB5', '#8A5A2B'];

export function categoryOf(tag: string): TagCategory | 'custom' {
  if (tag.startsWith('close:')) return 'close';
  if (tag.startsWith('quality:')) return 'quality';
  if (tag === 'tested') return 'tested';
  return 'custom';
}
export function tagLabel(tag: string): string {
  if (tag.startsWith('close:')) return `接近：${tag.slice(6)}`;
  const fixed = FIXED_TAGS.find(item => item.tag === tag);
  return fixed ? fixed.label : tag;
}
/** Stable colour per tag (hash of the model name for `close:`, fixed hues for the rest). */
export function tagColor(tag: string): string {
  if (tag === 'quality:intact') return '#2F9E5B';
  if (tag === 'quality:degraded') return '#D0443A';
  if (tag === 'tested') return '#2F6FBF';
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
export function closeTag(model: string): string { return `close:${model}`; }
/** Tag target for a relay channel serving one model. */
export function relayTarget(siteId: string, channelId: number, model: string): string { return `relay:${siteId}:${channelId}:${model}`; }
/** Tag target for a DSH-configured model. */
export function modelTarget(provider: string, id: string): string { return `model:${provider}/${id}`; }
