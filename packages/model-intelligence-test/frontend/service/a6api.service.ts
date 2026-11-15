import type { A6ActionInput, A6CreateInput, A6Preferences, ModelIntelligenceTransport } from '../types';

// No third-party HTTP or credential access: the owner-only Host Remote owns the bridge.
export const readA6Bridge = (transport: ModelIntelligenceTransport) => transport.a6BridgeInfo();
export const readA6Selections = (transport: ModelIntelligenceTransport, revision: number) => transport.a6Selections(revision >= 0 ? { revision } : {});
export const readA6Preferences = (transport: ModelIntelligenceTransport, selectionId: string) => transport.a6Preferences({ selectionId });
export const writeA6Preferences = (transport: ModelIntelligenceTransport, selectionId: string, preferences: A6Preferences) => transport.a6PreferencesSave({ selectionId, ...preferences });
export const createA6Record = (transport: ModelIntelligenceTransport, input: A6CreateInput) => transport.a6Create(input);
export const performA6Action = (transport: ModelIntelligenceTransport, input: A6ActionInput) => transport.a6Action(input);
export async function copyA6Configuration(configuration: {origin: string; capability: string}): Promise<void> {
  if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前浏览器不支持剪贴板，请手动复制下方连接配置。');
  await navigator.clipboard.writeText(JSON.stringify(configuration, null, 2));
}
/** Consume only this plugin's hash parameter; preserve other route/hash parameters. */
export function consumeA6SelectionLink(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const hash = window.location.hash.slice(1);
  const match = /(?:^|[?&])mit-a6-selection=([^&]*)/.exec(hash);
  if (!match) return undefined;
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { return undefined; }
  const remaining = hash.replace(/(^|[?&])mit-a6-selection=[^&]*&?/, (value, prefix: string) => value.endsWith('&') ? prefix : '').replace(/[?&]$/, '');
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`);
  return id || undefined;
}
const CONSUMED_KEY = 'model-intelligence-test.a6-consumed.v1';
export function readConsumedA6Selections(): string[] {
  try {
    const parsed: unknown = globalThis.sessionStorage?.getItem(CONSUMED_KEY);
    const ids: unknown = typeof parsed === 'string' ? JSON.parse(parsed) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(-512) : [];
  } catch { return []; }
}
export function rememberConsumedA6Selection(id: string): void {
  try { globalThis.sessionStorage?.setItem(CONSUMED_KEY, JSON.stringify([...new Set([...readConsumedA6Selections(), id])].slice(-512))); } catch { /* In-memory seen IDs still prevent repeated focus in this lifecycle. */ }
}
export function watchA6SelectionLinks(onLink: (id: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => { const id = consumeA6SelectionLink(); if (id) onLink(id); };
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
