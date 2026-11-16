import React from '../../runtime';
import type { A6MarketSnapshot } from '../../types';

const price = (value: number): string => value.toLocaleString('zh-CN', {maximumFractionDigits: 6});
export function marketPrices(market?: A6MarketSnapshot): string[] {
  if (!market) return ['未携带报价快照'];
  const currency = market.currency?.toUpperCase();
  const rate = currency === 'CNY' ? 1 : currency === 'USD' && typeof market.exchangeRate === 'number' && Number.isFinite(market.exchangeRate) && market.exchangeRate > 0 ? market.exchangeRate : undefined;
  const unit = market.unit?.toLowerCase();
  const tokenUnit = unit === 'per_million_tokens' || unit === 'million_tokens' || unit === '1m_tokens' || unit === 'per_1m_tokens';
  const requestUnit = unit === 'per_request' || unit === 'request';
  if (rate === undefined) return [currency === 'USD' ? '缺少快照汇率，人民币报价未知' : '报价币种未知'];
  const money = (micros: number): string => `¥${price(micros / 1_000_000 * rate)}`;
  if (requestUnit && market.chargeType === 'per_request' && typeof market.perRequestPriceMicros === 'number' && Number.isFinite(market.perRequestPriceMicros) && market.perRequestPriceMicros >= 0) return [`${money(market.perRequestPriceMicros)}/次`];
  if (!tokenUnit || market.chargeType !== 'per_token') return ['报价单位或计费方式未知'];
  const entries: [string, number | undefined][] = [['输入', market.inputPriceMicros], ['输出', market.outputPriceMicros], ['缓存读', market.cacheReadPriceMicros], ['缓存写', market.cacheWritePriceMicros]];
  const lines = entries.filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0).map(([label, micros]) => `${label} ${money(micros)}/百万 Token`);
  return lines.length ? lines : ['报价未知'];
}
export function MarketPrice({market}: {market?: A6MarketSnapshot}) {
  return <div className="mit-a6-market" title={market ? `网页报价快照 · ${new Date(market.capturedAt).toLocaleString('zh-CN')}${market.currency === 'USD' && market.exchangeRate ? ` · USD/CNY ${market.exchangeRate}` : ''} · 不等于实际消费` : undefined}>
    {marketPrices(market).map(line => <span key={line} className="mit-tabular">{line}</span>)}
    <small className="mit-muted">渠道报价快照</small>
  </div>;
}
export function MarketCache({market}: {market?: A6MarketSnapshot}) {
  const rate = market?.cacheHitRate24h;
  const known = market?.cacheHitState !== 'no_data' && typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 10_000;
  return <div className="mit-a6-market"><span className="mit-tabular">{known ? `${(rate / 100).toFixed(2)}%` : market?.cacheHitState === 'no_data' ? '暂无数据' : '未知'}</span><small className="mit-muted" title="市场近 24 小时缓存率，非本轮测试命中率">渠道近 24h 缓存率</small></div>;
}
