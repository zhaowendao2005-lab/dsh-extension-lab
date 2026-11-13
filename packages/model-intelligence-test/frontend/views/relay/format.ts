import type { Partition } from '../../types';

/** Rates arrive as percent (0–100) or as basis points (0–10000); normalize to percent. */
export function pct(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value > 100 ? value / 100 : value;
}

export function percentText(value: number | null | undefined, digits = 1): string {
  const v = pct(value);
  return v === null ? '—' : `${v.toFixed(digits)}%`;
}

/** Timestamps arrive as unix seconds or milliseconds; normalize to ms. */
export function ms(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? (Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)) : value;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

export function price(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '免费';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function duration(value: number | null): string {
  if (value === null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

export function stamp(value: number | string | null | undefined): string {
  const time = ms(value);
  if (time === null) return '—';
  return new Date(time).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
}

export function relative(value: number | string | null | undefined, now = Date.now()): string {
  const time = ms(value);
  if (time === null) return '—';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

/** Realtime ratio: the snapshot stores it per token; present per-1M multiplier. */
export function ratioText(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scaled = value < 0.001 ? value * 1_000_000 : value;
  return `×${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(2)}`;
}

export type RateTone = 'good' | 'fair' | 'warn' | 'bad' | 'none';
export function rateTone(value: number | null | undefined): RateTone {
  const v = pct(value);
  if (v === null) return 'none';
  if (v >= 95) return 'good';
  if (v >= 90) return 'fair';
  if (v >= 80) return 'warn';
  return 'bad';
}

const ROUTE_LABELS: Record<string, {text: string; tone: string}> = {
  stable: {text: '稳定', tone: 'stable'}, 稳定: {text: '稳定', tone: 'stable'},
  cheap: {text: '低价', tone: 'cheap'}, low_price: {text: '低价', tone: 'cheap'}, 低价: {text: '低价', tone: 'cheap'},
  fast: {text: '高速', tone: 'fast'}, 高速: {text: '高速', tone: 'fast'},
  quality: {text: '高质', tone: 'quality'}, high_quality: {text: '高质', tone: 'quality'}, 高质: {text: '高质', tone: 'quality'},
};
export function routeLabel(label: string): {text: string; tone: string} {
  return ROUTE_LABELS[label] ?? ROUTE_LABELS[label.toLowerCase()] ?? {text: label, tone: 'plain'};
}

const BADGES: Record<string, string> = {gold: '金', silver: '银', bronze: '铜'};
export function badgeText(badge: string): string | null {
  return BADGES[badge.toLowerCase()] ?? null;
}

const STATUS: Record<string, {text: string; tone: string}> = {
  healthy: {text: '正常', tone: 'good'}, normal: {text: '正常', tone: 'good'}, ok: {text: '正常', tone: 'good'}, available: {text: '可用', tone: 'good'}, active: {text: '可用', tone: 'good'},
  degraded: {text: '降级', tone: 'warn'}, unstable: {text: '波动', tone: 'warn'}, limited: {text: '限流', tone: 'warn'},
  down: {text: '不可用', tone: 'bad'}, unavailable: {text: '不可用', tone: 'bad'}, offline: {text: '离线', tone: 'bad'}, disabled: {text: '停用', tone: 'bad'},
  no_token: {text: '无令牌', tone: 'warn'}, token: {text: '有令牌', tone: 'good'}, configured: {text: '已配置', tone: 'good'}, none: {text: '未配置', tone: 'plain'},
};
export function statusOf(routeStatus: string, availability: number): {text: string; tone: string} {
  if (routeStatus) return STATUS[routeStatus.toLowerCase()] ?? {text: routeStatus, tone: 'plain'};
  return availability > 0 ? {text: '可用', tone: 'good'} : {text: '—', tone: 'plain'};
}

export function favoriteKeys(partitions: Partition[]): Set<string> {
  const favorites = partitions.find(partition => partition.id === 'favorites');
  return new Set((favorites?.items ?? []).map(item => `${item.channelId}|${item.model}`));
}

export function memberKey(channelId: number, model: string): string {
  return `${channelId}|${model}`;
}

const SAMPLE_STATE: Record<string, string> = {rate: '采样率', no_data: '无数据', none: '无数据', stale: '已过期'};
export function sampleState(value: string): string { return value ? SAMPLE_STATE[value.toLowerCase()] ?? value : '—'; }
const LIMIT_STATE: Record<string, string> = {configured: '已配置', unconfigured: '未配置', none: '未配置', limited: '已限流', unlimited: '未限流'};
export function limitState(value: string): string { return value ? LIMIT_STATE[value.toLowerCase()] ?? value : '—'; }
const QUALITY: Record<string, string> = {approximate: '近似', exact: '精确', estimated: '估算'};
export function qualityText(value: string): string { return value ? QUALITY[value.toLowerCase()] ?? value : '—'; }
const CHARGE: Record<string, string> = {per_token: '按 Token', per_request: '按次', free: '免费'};
export function chargeText(value: string): string { return value ? CHARGE[value.toLowerCase()] ?? value : ''; }
