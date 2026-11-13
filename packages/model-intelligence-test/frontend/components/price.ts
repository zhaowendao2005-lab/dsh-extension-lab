import type { Currency } from '../types';
/** Price display unit. The exchange rate comes from the relay snapshot (`status.exchangeRate`). */
export const CURRENCY_LABELS: Record<Currency, string> = {usd: '美元 $', cny: '人民币 ¥'};
export const FALLBACK_RATE = 6.7;

export function formatPrice(value: number | null | undefined, currency: Currency, rate = FALLBACK_RATE): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '免费';
  const amount = currency === 'cny' ? value * (rate > 0 ? rate : FALLBACK_RATE) : value;
  const symbol = currency === 'cny' ? '¥' : '$';
  if (amount < 0.01) return `${symbol}${amount.toFixed(4)}`;
  return `${symbol}${amount.toFixed(2)}`;
}
