import type { A6ActionInput, A6CreateInput, ModelIntelligenceTransport } from '../types';

// The Host Remote is the only path to a6api; the client never holds the account access token.
export const readA6Config = (transport: ModelIntelligenceTransport) => transport.a6Config();

/**
 * One-click connect payload: the userscript reads `#mit-a6=`, stores it, and erases the hash so the
 * intake token never lands in browser history or a shared URL.
 */
export function oneClickLink(config: { origin: string; intakeToken: string }): string {
  if (!config.origin || !config.intakeToken) return '';
  return `https://a6api.vip/#mit-a6=${btoa(JSON.stringify({ origin: config.origin, intake: config.intakeToken }))}`;
}
export const writeA6Config = (transport: ModelIntelligenceTransport, accessToken: string, userId: string) => transport.a6ConfigSave({ ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}), ...(userId.trim() ? { userId: userId.trim() } : {}) });
export const rotateA6Intake = (transport: ModelIntelligenceTransport) => transport.a6IntakeRotate();
export const readA6Tokens = (transport: ModelIntelligenceTransport) => transport.a6Tokens();
export const readA6Selections = (transport: ModelIntelligenceTransport, revision: number) => transport.a6Selections(revision >= 0 ? { revision } : {});
export const createA6Record = (transport: ModelIntelligenceTransport, input: A6CreateInput) => transport.a6Create(input);
export const performA6Action = (transport: ModelIntelligenceTransport, input: A6ActionInput) => transport.a6Action(input);

export async function copyIntakeToken(token: string): Promise<void> {
  if (!token) throw new Error('导入口令尚未生成');
  if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前浏览器不支持剪贴板，请手动复制导入口令。');
  await navigator.clipboard.writeText(token);
}
