import React from '../../runtime';
import type { CustomBillingState, CustomRunPhase, CustomRunSummary } from '../../types';

export const CUSTOM_PHASE_LABELS: Record<CustomRunPhase, string> = { queued: '排队中', preparing: '准备沙箱', running: '生成中', tooling: '工具执行', validating: '验证成果', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
export const CUSTOM_BILLING_LABELS: Record<CustomBillingState, string> = { pending: '等待账单', observed: '已匹配（暂定）', partial: '部分回填', settled: '已结算', ambiguous: '归属不确定', unknown: '未提供账单' };
export const ended = (phase: CustomRunPhase): boolean => ['completed', 'failed', 'cancelled', 'interrupted'].includes(phase);
export const observed = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
export function count(value: number | null | undefined): string { return observed(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—'; }
export function decimal(value: number | null | undefined): string { return observed(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : '—'; }
export function millis(value: number | null | undefined): string { return observed(value) ? `${decimal(value)} ms` : '—'; }
export function rate(value: number | null | undefined): string { return observed(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(1)}%` : '—'; }
export function cost(value: number | null | undefined, currency: string | null | undefined): string {
  if (!observed(value)) return '—';
  return `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''}${value.toFixed(4)}${currency && !['CNY', 'USD'].includes(currency) ? ` ${currency}` : !currency ? '（币种未提供）' : ''}`;
}
export function fileSize(value: number): string { return value < 1024 ? `${count(value)} B` : value < 1048576 ? `${decimal(value / 1024)} KB` : `${decimal(value / 1048576)} MB`; }
export function clock(value: number | null | undefined): string { return observed(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—'; }
export function outputLabel(summary: CustomRunSummary): string {
  if (summary.output.state === 'ready' && summary.output.validation === 'valid') return '可查看';
  if (summary.output.state === 'invalid' || summary.output.validation === 'invalid') return '验证失败';
  return summary.output.state === 'writing' ? '写入中' : '尚无成果';
}
export function CustomPhaseBadge({ phase }: { phase: CustomRunPhase }) {
  return <span className={`mit-custom-phase is-${phase}`}><span aria-hidden="true" />{CUSTOM_PHASE_LABELS[phase]}</span>;
}
