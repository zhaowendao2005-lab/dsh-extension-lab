import { z } from 'zod';

const amount = z.number().finite().nonnegative();
/** Market facts only: quotes and the site's display exchange rate, never credentials or ratio FX. */
export const marketSchema = z.strictObject({
  capturedAt: z.number().int().nonnegative(),
  chargeType: z.string().max(40), currency: z.string().max(12), unit: z.string().max(40),
  inputPriceMicros: amount.optional(), outputPriceMicros: amount.optional(),
  cacheReadPriceMicros: amount.optional(), cacheWritePriceMicros: amount.optional(), perRequestPriceMicros: amount.optional(),
  exchangeRate: z.number().finite().positive().optional(),
  cacheHitRate24h: z.number().finite().min(0).max(10000).optional(),
  cacheHitState: z.string().max(40).optional(),
});
export function marketOf(value) {
  if (!value || typeof value !== 'object') return undefined;
  const parsed = marketSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
