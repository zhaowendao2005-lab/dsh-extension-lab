import React from '../../runtime';
import type { CustomEvent, CustomRequestView, CustomRunSummary } from '../../types';
import { Empty } from '../../components/common';
import { reasoningText } from '../../chat/rows/reasoning-text';
import { count, decimal, millis, observed, rate } from './presentation';

export interface CustomStepsViewProps {
  requests: CustomRequestView[];
  events: CustomEvent[];
  summary: CustomRunSummary;
  /** Host kept only the newest requests; older steps are absent, not empty. */
  truncated?: boolean;
}

const UNKNOWN = '—';
/** Expanded bodies stop after this many event lines; the rest collapse into a 「…」 note. */
const EVENT_LIMIT = 60;
/** Table cells and event lines are one-liners, so long model text is clipped for display only. */
const PREVIEW_LIMIT = 200;
const TOOL_NAME_LIMIT = 3;
const STEP_COLUMNS: { label: string; title: string }[] = [
  { label: '步骤', title: 'Host 记录的轮次.步骤；未记录时按请求先后编号' },
  { label: '触发', title: '本步开始前最近的用户消息或工具结果' },
  { label: '执行内容', title: '本步的工具调用；无工具时为助手文本，再退化为请求状态' },
  { label: '上下文', title: '本步总输入 Token（含缓存读取与写入）' },
  { label: '缓存命中', title: '缓存读取 Token ÷ 输入 Token' },
  { label: '首字节', title: '请求开始到首个任意流式增量；缺失时用首个文本增量（DSH ttft）' },
  { label: '输出速度', title: '输出 Token ÷ 模型生成耗时；缺失时用端到端耗时' },
  { label: '总用时', title: '本步端到端执行耗时' },
];
const STATUS_LABELS: Record<CustomRequestView['status'], string> = { running: '请求中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const EVENT_LABELS: Record<CustomEvent['type'], string> = { message: '文本', reasoning: '推理', tool: '工具', phase: '阶段', error: '错误' };

/** One line for a table cell: collapse newlines/indentation so rows stay aligned. */
function preview(text: string, limit: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** A column total is only known when every displayed step reported the value; never fabricate 0. */
function total(values: (number | null | undefined)[]): number | null {
  if (!values.length) return null;
  let sum = 0;
  for (const value of values) {
    if (!observed(value)) return null;
    sum += value;
  }
  return sum;
}

function stepLabel(request: CustomRequestView, index: number): { text: string; title: string } {
  if (observed(request.turn) && observed(request.step)) return { text: `${request.turn}.${request.step}`, title: `轮次 ${request.turn} · 步骤 ${request.step}` };
  return { text: `#${index + 1}`, title: 'Host 未记录该步的轮次/步骤，按请求先后编号' };
}

function triggerCell(request: CustomRequestView): { text: string; title: string } {
  const raw = typeof request.trigger === 'string' ? request.trigger.trim() : '';
  if (!raw) return { text: UNKNOWN, title: 'Host 未记录该步的触发来源' };
  return { text: preview(raw, 160), title: raw };
}

/** Tool names called by this step, deduped by call id (a call and its result share one). */
function toolNames(matched: CustomEvent[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const event of matched) {
    if (event.type !== 'tool' || !event.name) continue;
    const key = event.callId || event.name;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(event.name);
  }
  return names;
}

function assistantText(matched: CustomEvent[]): string {
  let text = '';
  for (const event of matched) if (event.type === 'message' && event.text) text = `${text}${event.text}`;
  return text;
}

/** Request events match by execution id; tool events are the exception — Host stamps them with turn/step only. */
function toolEventsForStep(request: CustomRequestView, matched: CustomEvent[], events: CustomEvent[]): CustomEvent[] {
  if (!observed(request.turn) || !observed(request.step)) return [];
  const seen = new Set(matched.map(event => event.id));
  const extra: CustomEvent[] = [];
  for (const event of events) {
    if (event.type !== 'tool' || seen.has(event.id)) continue;
    if (event.turn !== request.turn || event.step !== request.step) continue;
    // A tool event that already names another request's execution stays with that request.
    if (event.executionId && request.executionId && event.executionId !== request.executionId) continue;
    extra.push(event);
  }
  return extra;
}

function requestError(request: CustomRequestView): string | null {
  const error = request.error;
  if (!error) return null;
  if (typeof error === 'string') return error.trim() || null;
  return (error.message ?? error.code ?? '').trim() || null;
}

function actionCell(request: CustomRequestView, matched: CustomEvent[]): { text: string; title: string; error: boolean } {
  const names = toolNames(matched);
  if (names.length) {
    const shown = names.slice(0, TOOL_NAME_LIMIT).join('、');
    const more = names.length > TOOL_NAME_LIMIT ? ` +${names.length - TOOL_NAME_LIMIT}` : '';
    return { text: `${shown}${more}`, title: `工具调用：${names.join('、')}`, error: false };
  }
  const text = assistantText(matched);
  if (text.trim()) return { text: preview(text, PREVIEW_LIMIT), title: preview(text, 500), error: false };
  const status = STATUS_LABELS[request.status];
  const failure = requestError(request);
  return { text: status, title: failure ? `${status}：${failure}` : `该步未记录工具调用或助手文本 · ${status}`, error: request.status === 'failed' || request.status === 'interrupted' };
}

function inputCell(request: CustomRequestView): { text: string; title: string } {
  const totalTokens = observed(request.usage.inputTotalTokens) ? request.usage.inputTotalTokens : null;
  const inputTokens = observed(request.usage.inputTokens) ? request.usage.inputTokens : null;
  const value = totalTokens ?? inputTokens;
  const title = totalTokens !== null ? '总输入 Token（含缓存读取与写入）' : inputTokens !== null ? '输入 Token（Host 未提供总输入，未含缓存）' : 'Host 未回填该步输入用量';
  return { text: value === null ? UNKNOWN : count(value), title };
}

function cacheCell(request: CustomRequestView): { text: string; title: string } {
  const totalTokens = observed(request.usage.inputTotalTokens) ? request.usage.inputTotalTokens : null;
  const inputTokens = observed(request.usage.inputTokens) ? request.usage.inputTokens : null;
  const base = totalTokens ?? inputTokens;
  const read = observed(request.usage.cacheReadTokens) ? request.usage.cacheReadTokens : null;
  if (base === null || read === null || base <= 0) return { text: UNKNOWN, title: 'Host 未回填该步缓存读取或输入用量' };
  // Clamp like Host `cacheRate`: a fallback base (input only) can understate the denominator.
  return { text: rate(Math.min(1, read / base)), title: `缓存读取 ${count(read)} ÷ ${totalTokens !== null ? '总输入' : '输入（不含缓存）'} ${count(base)} Token` };
}

function firstByteCell(request: CustomRequestView): { text: string; title: string } {
  if (observed(request.firstDeltaMs)) return { text: millis(request.firstDeltaMs), title: '请求开始到首个任意流式增量' };
  if (observed(request.metrics.ttftMs)) return { text: millis(request.metrics.ttftMs), title: '首个文本增量（DSH ttft）；该步未记录任意增量首字节' };
  return { text: UNKNOWN, title: '该步未观测到流式增量，首字节未知' };
}

function speedCell(request: CustomRequestView): { text: string; title: string } {
  if (observed(request.metrics.modelTokensPerSecond)) return { text: `${decimal(request.metrics.modelTokensPerSecond)} tok/s`, title: '输出 Token ÷ 模型生成耗时' };
  if (observed(request.metrics.endToEndTokensPerSecond)) return { text: `${decimal(request.metrics.endToEndTokensPerSecond)} tok/s`, title: '输出 Token ÷ 端到端耗时（含工具与等待）' };
  return { text: UNKNOWN, title: 'Host 未回填该步吞吐' };
}

function durationCell(request: CustomRequestView): { text: string; title: string } {
  if (observed(request.metrics.e2eMs)) return { text: millis(request.metrics.e2eMs), title: '端到端执行耗时' };
  if (observed(request.startedAt) && observed(request.finishedAt)) return { text: millis(request.finishedAt - request.startedAt), title: '由开始/结束时间推导' };
  return { text: UNKNOWN, title: request.status === 'running' ? '该步仍在执行，结束时间未知' : 'Host 未回填该步耗时' };
}

interface StepLine { id: string; label: string; text: string; error: boolean }

function eventLine(event: CustomEvent): StepLine | null {
  const error = event.type === 'error' || event.isError === true;
  if (event.type === 'tool') {
    const name = event.name?.trim() || '未命名工具';
    const result = event.phase === 'result';
    const body = result ? event.content : event.arguments;
    const detail = typeof body === 'string' && body.trim() ? ` · ${preview(body, 160)}` : '';
    return { id: event.id, label: EVENT_LABELS.tool, text: `${name} · ${result ? '结果' : '调用'}${detail}`, error };
  }
  if (event.type === 'error') {
    const text = [event.code, preview(event.text ?? '', PREVIEW_LIMIT)].filter(Boolean).join(' · ');
    return text ? { id: event.id, label: EVENT_LABELS.error, text, error: true } : null;
  }
  if (event.type === 'phase') {
    const text = preview([event.phase ?? '', event.text ?? ''].filter(Boolean).join(' · '), PREVIEW_LIMIT);
    return text ? { id: event.id, label: EVENT_LABELS.phase, text, error } : null;
  }
  const raw = event.type === 'reasoning' ? reasoningText(event.text ?? '') : event.text ?? '';
  const text = preview(raw, PREVIEW_LIMIT);
  return text ? { id: event.id, label: EVENT_LABELS[event.type], text, error } : null;
}

function StepEvents({ events, executionId }: { events: CustomEvent[]; executionId: string | null }) {
  if (!events.length) return <p className="mit-custom-steps-event-empty">{executionId ? '该请求未记录到会话事件。' : '该步未记录请求标识，无法关联会话事件。'}</p>;
  const lines = events.map(eventLine).filter((line): line is StepLine => line !== null);
  const shown = lines.slice(0, EVENT_LIMIT);
  if (!shown.length) return <p className="mit-custom-steps-event-empty">该步事件暂无可展示内容。</p>;
  return <div className="mit-custom-steps-events" aria-label="步骤事件">
    {shown.map(line => <div key={line.id} className={line.error ? 'mit-custom-steps-event is-error' : 'mit-custom-steps-event'}><span className="mit-custom-steps-event-kind">{line.label}</span><span className="mit-custom-steps-event-text">{line.text}</span></div>)}
    {lines.length > shown.length && <p className="mit-custom-steps-event-more">… 另有 {count(lines.length - shown.length)} 条事件未展示</p>}
  </div>;
}

/** One row per data-plane request, mirroring the VS Code Chat Debug log table form. */
export function CustomStepsView({ requests, events, summary, truncated }: CustomStepsViewProps) {
  // Events belong to a request through the Host execution id; unmatched ids stay unattributed.
  const grouped = React.useMemo(() => {
    const map = new Map<string, CustomEvent[]>();
    for (const event of events) {
      const id = event.executionId;
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(event);
      else map.set(id, [event]);
    }
    return map;
  }, [events]);
  const rows = React.useMemo(() => requests.map((request, index) => {
    // Events carry the Host-local request id while the row keeps the ledger execution id: try both so steps always resolve.
    const executionId = request.executionId ?? null;
    const matched = grouped.get(request.id) ?? (executionId ? grouped.get(executionId) ?? [] : []);
    const tools = toolEventsForStep(request, matched, events);
    return {
      request,
      executionId,
      matched,
      label: stepLabel(request, index),
      trigger: triggerCell(request),
      action: actionCell(request, tools.length ? [...matched, ...tools] : matched),
      input: inputCell(request),
      cache: cacheCell(request),
      firstByte: firstByteCell(request),
      speed: speedCell(request),
      duration: durationCell(request),
    };
  }), [requests, grouped, events]);
  const inputTotal = total(rows.map(row => observed(row.request.usage.inputTotalTokens) ? row.request.usage.inputTotalTokens : row.request.usage.inputTokens));
  const outputTotal = total(rows.map(row => row.request.usage.outputTokens));
  const durationTotal = total(rows.map(row => observed(row.request.metrics.e2eMs) ? row.request.metrics.e2eMs : observed(row.request.startedAt) && observed(row.request.finishedAt) ? row.request.finishedAt - row.request.startedAt : null));
  const summaryText = '合计仅在每一步都回填用量时给出；未知不按 0 计算。';
  return <div className="mit-custom-steps">
    <div className="mit-custom-steps-toolbar">
      <span className="mit-custom-steps-hint">一步 = 一次数据面请求；未知显示 —</span>
      <span className="mit-custom-steps-count">{count(requests.length)} 步</span>
      {requests.length ? <span className="mit-custom-steps-total" title={summaryText}>合计 输入 {count(inputTotal)} · 输出 {count(outputTotal)} · 用时 {millis(durationTotal)}</span> : null}
    </div>
    {truncated ? <p className="mit-custom-steps-note" role="note">Host 仅保留最新的 {count(requests.length)} 步，更早步骤未展示；合计只统计已展示的步骤。</p> : null}
    {rows.length ? <div className="mit-custom-steps-scroll">
      <p className="mit-custom-sr-only">共 {count(rows.length)} 个步骤，每行可展开该步事件。</p>
      <div className="mit-custom-steps-table">
        <div className="mit-custom-steps-head">{STEP_COLUMNS.map(column => <span key={column.label} title={column.title}>{column.label}</span>)}</div>
        {rows.map(row => <details key={row.request.id} className="mit-custom-steps-row">
          <summary className="mit-custom-steps-summary">
            <span className="mit-custom-steps-cell mit-custom-steps-id" title={row.label.title}>{row.label.text}</span>
            <span className="mit-custom-steps-cell" title={row.trigger.title}>{row.trigger.text}</span>
            <span className={row.action.error ? 'mit-custom-steps-cell mit-custom-steps-action is-error' : 'mit-custom-steps-cell mit-custom-steps-action'} title={row.action.title}>{row.action.text}</span>
            <span className="mit-custom-steps-cell is-num" title={row.input.title}>{row.input.text}</span>
            <span className="mit-custom-steps-cell is-num" title={row.cache.title}>{row.cache.text}</span>
            <span className="mit-custom-steps-cell is-num" title={row.firstByte.title}>{row.firstByte.text}</span>
            <span className="mit-custom-steps-cell is-num" title={row.speed.title}>{row.speed.text}</span>
            <span className="mit-custom-steps-cell is-num" title={row.duration.title}>{row.duration.text}</span>
            <span className="mit-custom-steps-caret" aria-hidden="true" />
          </summary>
          <StepEvents events={row.matched} executionId={row.executionId} />
        </details>)}
      </div>
    </div> : <Empty title="暂无步骤">{summary.phase === 'queued' ? '任务正在等待运行槽位。' : '真实请求产生后，每一步会在这里列出。'}</Empty>}
  </div>;
}
