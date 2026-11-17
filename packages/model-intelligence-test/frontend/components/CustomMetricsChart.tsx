import React, { useEffect, useRef } from '../runtime';
import { init, getInstanceByDom, use } from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { CustomRequestView } from '../types';

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, CanvasRenderer]);

export interface CustomMetricsChartProps {
  requests: CustomRequestView[];
  kind: 'speed' | 'latency' | 'tokens' | 'cache';
}
const numberOrGap = (value: number | null | undefined): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const seriesInfo = {
  speed: [['模型吞吐', 'modelTokensPerSecond'], ['端到端吞吐', 'endToEndTokensPerSecond']],
  latency: [['TTFT', 'ttftMs'], ['生成耗时', 'generationMs']],
  tokens: [['输入 Token', 'inputTokens'], ['输出 Token', 'outputTokens']],
  cache: [['缓存命中率', 'cacheRate']],
} as const;

/** Uses only observed request values. Missing observations stay null, including cache usage. */
export function CustomMetricsChart({ requests, kind }: CustomMetricsChartProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'canvas' });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => chart.resize());
    observer?.observe(element);
    return () => { observer?.disconnect(); chart.dispose(); };
  }, []);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const chart = getInstanceByDom(element);
    if (!chart) return;
    const css = getComputedStyle(element);
    const text = css.getPropertyValue('--mit-muted').trim() || '#8a929f';
    const border = css.getPropertyValue('--mit-border').trim() || '#303743';
    const unit = kind === 'cache' ? '%' : kind === 'latency' ? 'ms' : kind === 'speed' ? 'tok/s' : 'Token';
    const option: EChartsCoreOption = {
      animation: false,
      color: ['#4f8fff', '#3cba93'],
      textStyle: { color: text, fontFamily: 'inherit', fontSize: 10 },
      grid: { left: 50, right: 14, top: 36, bottom: requests.length > 18 ? 54 : 30 },
      legend: { top: 2, textStyle: { color: text, fontSize: 10 }, itemWidth: 14, itemHeight: 7 },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (value: unknown) => typeof value === 'number' ? `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit}` : '未提供' },
      xAxis: { type: 'category', boundaryGap: false, data: requests.map((_, index) => `#${index + 1}`), axisLine: { lineStyle: { color: border } }, axisTick: { show: false }, axisLabel: { color: text } },
      yAxis: { type: 'value', min: 0, ...(kind === 'cache' ? { max: 100 } : {}), name: unit, nameTextStyle: { color: text }, splitLine: { lineStyle: { color: border, type: 'dashed' } }, axisLabel: { color: text, fontSize: 10 } },
      dataZoom: requests.length > 18 ? [{ type: 'inside', filterMode: 'none' }, { type: 'slider', height: 13, bottom: 4, borderColor: border, textStyle: { color: text } }] : [],
      series: seriesInfo[kind].map(([name, key]) => ({
        name, type: 'line', connectNulls: false, smooth: false, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2 }, emphasis: { focus: 'series' },
        data: requests.map(request => {
          const source = kind === 'tokens' ? request.usage : request.metrics;
          const value = numberOrGap(source[key as keyof typeof source]);
          return kind === 'cache' ? value !== null && value >= 0 && value <= 1 ? value * 100 : null : value;
        }),
      })),
    };
    chart.setOption(option, true);
  }, [requests, kind]);
  const label = kind === 'speed' ? '模型与端到端吞吐' : kind === 'latency' ? 'TTFT 与生成耗时' : kind === 'tokens' ? '输入与输出 Token' : '请求缓存命中率';
  return <div className="mit-custom-chart" ref={root} role="img" aria-label={`${label}，按真实请求顺序绘制，缺失值保留空缺`} />;
}
