import React from '../runtime';
import type { CustomRunSummary } from '../types';
import { ChatMarkdown } from '../chat/md';
import { CodeBlock } from '../chat/md/CodeBlock';
import { languageForPath } from '../chat/md/code-language';
import { useStepClock } from '../presentation/step-clock';
import { field, numberField, projectRun, textField, type FlowErrorPart, type FlowPart, type FlowRun, type FlowStep, type FlowTextPart, type FlowToolPart, type FlowTurn } from './project';
import type { CustomEvent, CustomRequestView } from '../types';

/*
 * Self-built streaming chat flow for custom runs.
 * Disclosure state uses native <details>; no component-local React state, so the
 * views/ architecture rule holds and expanded/collapsed survives every poll.
 * React is only injected at ModuleLoader factory time: no top-level JSX or React.memo here.
 */

const CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' };
const PREVIEW_LINES = 14;

const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const num = (value: number | null | undefined): string => known(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—';
const compact = (value: number | null | undefined): string => !known(value) ? '—' : value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : num(value);
const secs = (value: number | null | undefined): string => !known(value) ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
const pct = (value: number | null | undefined): string => known(value) ? `${Math.round(value * 100)}%` : '—';
const bytes = (value: number | null | undefined): string => !known(value) ? '—' : value < 1024 ? `${value} B` : value < 1_048_576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1_048_576).toFixed(2)} MB`;
const money = (value: number | null | undefined, currency: string | null | undefined): string => !known(value) ? '—' : `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''}${value.toFixed(value < 0.01 ? 6 : 4)}`;
const time = (value: number | null | undefined): string => known(value) && value > 0 ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
const lines = (text: string): number => text ? text.split('\n').length : 0;
const head = (text: string, count: number): string => text.split('\n').slice(0, count).join('\n');

const STEP_STATUS: Record<FlowStep['status'], { label: string; tone: string }> = {
  waiting: { label: '等待首字节', tone: 'live' },
  streaming: { label: '生成中', tone: 'live' },
  tooling: { label: '执行工具', tone: 'live' },
  done: { label: '完成', tone: 'ok' },
  failed: { label: '失败', tone: 'error' },
  cancelled: { label: '已取消', tone: 'muted' },
  unknown: { label: '状态未知', tone: 'muted' },
};

const TOOL_LABEL: Record<string, string> = {
  readRules: '读取规则', readInput: '读取任务输入', readFile: '读取文件', listFiles: '列出文件', statFile: '查看文件信息', writeFile: '写入文件', declareOutput: '声明成果',
};

function Glyph({ name }: { name: 'book' | 'inbox' | 'file' | 'list' | 'info' | 'pen' | 'flag' | 'tool' | 'spark' | 'alert' | 'user' | 'retry' | 'chevron' }) {
  const paths: Record<string, string> = {
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm2 14h13',
    inbox: 'M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6l1-8Z',
    file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9h.01',
    pen: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
    flag: 'M5 21V4h11l-2 4 2 4H5',
    tool: 'M14 7a4 4 0 0 0-5 5l-5 5 3 3 5-5a4 4 0 0 0 5-5l-2 2-3-3 2-2Z',
    spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
    retry: 'M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0 0 12.6 2M18.5 9A7 7 0 0 0 5.9 7',
    chevron: 'm9 6 6 6-6 6',
  };
  return <svg className="mit-flow-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
const TOOL_GLYPH: Record<string, Parameters<typeof Glyph>[0]['name']> = { readRules: 'book', readInput: 'inbox', readFile: 'file', listFiles: 'list', statFile: 'info', writeFile: 'pen', declareOutput: 'flag' };

function Copy({ text, label = '复制' }: { text: string; label?: string }) {
  return <button type="button" className="mit-flow-copy" title={`${label}：${text}`} onClick={event => { event.preventDefault(); event.stopPropagation(); void navigator.clipboard?.writeText(text).catch(() => {}); }}>{label}</button>;
}

/** Preview of a code/text payload: first lines highlighted, full text in a disclosure. */
function CodePreview({ code, path, streaming }: { code: string; path: string | null; streaming?: boolean }) {
  const lang = path ? languageForPath(path) : undefined;
  const total = lines(code);
  if (total <= PREVIEW_LINES) return <CodeBlock code={code} lang={lang} streaming={streaming} className="mit-flow-code" {...CODE_LABELS} />;
  return <details className="mit-flow-more">
    <summary><CodeBlock code={head(code, PREVIEW_LINES)} lang={lang} className="mit-flow-code is-clipped" showHeader={false} {...CODE_LABELS} /><span className="mit-flow-more-label">展开全部 {num(total)} 行</span></summary>
    <CodeBlock code={code} lang={lang} className="mit-flow-code" lineNumbers {...CODE_LABELS} />
  </details>;
}

function Raw({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return <details className="mit-flow-raw"><summary>{label}</summary><pre>{text}</pre></details>;
}

function ToolCard({ part, live }: { part: FlowToolPart; live: boolean }) {
  const now = useStepClock(live && part.status === 'running');
  const label = TOOL_LABEL[part.short] ?? part.name;
  const glyph = TOOL_GLYPH[part.short] ?? 'tool';
  const path = textField(part.args, 'path') ?? textField(part.result, 'path') ?? textField(part.result, 'relativePath');
  const elapsed = part.endedAt !== null ? part.endedAt - part.startedAt : now !== null ? now - part.startedAt : null;
  const resultError = part.isError ? (textField(part.result, 'message') ?? textField(part.result, 'error') ?? part.resultText) : null;
  const meta: string[] = [];
  let body: React.ReactNode = null;
  let compactCard = false;
  switch (part.short) {
    case 'readRules':
    case 'readInput': {
      compactCard = true;
      const text = textField(part.result, 'text');
      if (text) meta.push(`${num(text.length)} 字`);
      body = text ? <CodePreview code={text} path={path} /> : null;
      break;
    }
    case 'readFile': {
      const offset = numberField(part.args, 'offset');
      const limit = numberField(part.args, 'limit');
      if (offset || limit) meta.push(`范围 ${num(offset ?? 0)}${limit ? ` + ${num(limit)}` : ''}`);
      const text = textField(part.result, 'text');
      if (text) meta.push(`${num(text.length)} 字`);
      body = text ? <CodePreview code={text} path={path} /> : null;
      compactCard = true;
      break;
    }
    case 'statFile': {
      compactCard = true;
      const size = numberField(part.result, 'size');
      if (size !== null) meta.push(bytes(size));
      const modified = numberField(part.result, 'modifiedAt');
      if (modified) meta.push(`修改于 ${time(modified)}`);
      break;
    }
    case 'listFiles': {
      compactCard = true;
      const files = field(part.result, 'files');
      const list = Array.isArray(files) ? files : Array.isArray(part.result) ? part.result as unknown[] : [];
      if (list.length) meta.push(`${list.length} 项`);
      body = list.length ? <ul className="mit-flow-files">{list.slice(0, 50).map((item, index) => { const name = typeof item === 'string' ? item : textField(item, 'path') ?? JSON.stringify(item); const size = numberField(item, 'size'); return <li key={index}><code>{name}</code>{size !== null && <span>{bytes(size)}</span>}</li>; })}</ul> : null;
      break;
    }
    case 'writeFile': {
      const text = textField(part.args, 'text') ?? textField(part.args, 'content');
      const size = part.file?.size ?? numberField(part.result, 'size');
      if (size !== null) meta.push(bytes(size));
      if (text) meta.push(`${num(lines(text))} 行`);
      if (part.argsClipped) meta.push('内容已截断');
      body = text ? <CodePreview code={text} path={path} streaming={live && part.status === 'running'} /> : null;
      break;
    }
    case 'declareOutput': {
      const state = textField(part.result, 'state');
      const validation = textField(part.result, 'validation');
      const size = numberField(part.result, 'size') ?? part.file?.size ?? null;
      if (size !== null) meta.push(bytes(size));
      const errors = field(part.result, 'errors');
      body = <div className={`mit-flow-output is-${validation === 'valid' ? 'ok' : state === 'invalid' || validation === 'invalid' ? 'error' : 'pending'}`}>
        <strong>{validation === 'valid' ? '成果已通过验证' : validation === 'invalid' || state === 'invalid' ? '成果未通过验证' : '等待验证'}</strong>
        {Array.isArray(errors) && errors.length > 0 && <ul>{errors.slice(0, 8).map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul>}
      </div>;
      break;
    }
    default: {
      body = <>
        {part.argsRaw && <Raw label="参数" text={part.args ? JSON.stringify(part.args, null, 2) : part.argsRaw} />}
        {part.resultText && <Raw label="结果" text={typeof part.result === 'object' && part.result !== null ? JSON.stringify(part.result, null, 2) : part.resultText} />}
      </>;
    }
  }
  if (part.resultClipped) meta.push('结果已截断');
  const status = part.status === 'running' ? '执行中' : part.status === 'error' ? '失败' : part.status === 'unknown' ? '未返回' : null;
  const title = <span className="mit-flow-tool-title"><Glyph name={glyph} /><span className="mit-flow-tool-label">{label}</span>{path && <code className="mit-flow-tool-path" title={path}>{path}</code>}{meta.map(item => <span key={item} className="mit-flow-tool-meta">{item}</span>)}<span className="mit-flow-spacer" />{status && <span className={`mit-flow-tool-status is-${part.status}`}>{status}</span>}{known(elapsed) && <span className="mit-flow-tool-time">{secs(elapsed)}</span>}</span>;
  const error = resultError ? <p className="mit-flow-tool-error">{resultError}</p> : null;
  if (!body && !error) return <div className={`mit-flow-tool is-${part.status} is-flat`}>{title}</div>;
  return <details className={`mit-flow-tool is-${part.status}${compactCard ? ' is-compact' : ''}`} open={!compactCard && (part.short === 'declareOutput' || part.status === 'running' || part.isError) ? true : undefined}>
    <summary>{title}<Glyph name="chevron" /></summary>
    <div className="mit-flow-tool-body">{error}{body}</div>
  </details>;
}

function Reasoning({ part }: { part: FlowTextPart }) {
  const chars = part.text.trim().length;
  return <details className={`mit-flow-reasoning${part.streaming ? ' is-streaming' : ''}`} open={part.streaming ? true : undefined}>
    <summary><Glyph name="spark" /><span>{part.streaming ? '正在思考' : '思考'}</span><span className="mit-flow-muted">{num(chars)} 字</span><Glyph name="chevron" /></summary>
    <div className="mit-flow-reasoning-body"><ChatMarkdown text={part.text} running={part.streaming} /></div>
  </details>;
}

function ErrorCard({ part }: { part: FlowErrorPart }) {
  const detail = part.detail;
  const tags = [part.code, part.status ? `HTTP ${part.status}` : null].filter(Boolean) as string[];
  return <div className="mit-flow-error" role="alert">
    <div className="mit-flow-error-head"><Glyph name="alert" />{tags.map(tag => <span key={tag} className="mit-flow-tag">{tag}</span>)}{part.requestId && <span className="mit-flow-request-id"><code>{part.requestId}</code><Copy text={part.requestId} /></span>}</div>
    <p className="mit-flow-error-message">{part.message}</p>
    {part.hint && <p className="mit-flow-error-hint">{part.hint}</p>}
    {detail && (detail.body || detail.stack || detail.causes?.length) ? <details className="mit-flow-raw">
      <summary>诊断信息</summary>
      {detail.body && <section><h5>上游响应</h5><pre>{prettyBody(detail.body)}</pre></section>}
      {detail.causes?.map((cause, index) => <section key={index}><h5>Cause #{index + 1}{cause.code ? ` · ${cause.code}` : ''}</h5><pre>{[cause.message, cause.stack].filter(Boolean).join('\n\n')}</pre></section>)}
      {detail.stack && <section><h5>堆栈</h5><pre>{detail.stack}</pre></section>}
    </details> : null}
  </div>;
}
function prettyBody(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

function Part({ part, live }: { part: FlowPart; live: boolean }) {
  switch (part.kind) {
    case 'reasoning': return <Reasoning part={part} />;
    case 'text': return <div className="mit-flow-text"><ChatMarkdown text={part.text} running={part.streaming} /></div>;
    case 'tool': return <ToolCard part={part} live={live} />;
    case 'error': return <ErrorCard part={part} />;
  }
}

function LiveIndicator({ step }: { step: FlowStep }) {
  const active = step.status === 'waiting' || step.status === 'streaming' || step.status === 'tooling';
  const now = useStepClock(active);
  if (!active || now === null) return null;
  const request = step.request;
  const started = request?.startedAt ?? step.at;
  let text: string;
  if (step.status === 'waiting') text = `等待首字节 · ${secs(now - started)}`;
  else if (step.status === 'tooling') {
    const tool = [...step.parts].reverse().find((part): part is FlowToolPart => part.kind === 'tool' && part.status === 'running');
    text = `执行 ${tool ? TOOL_LABEL[tool.short] ?? tool.name : '工具'} · ${secs(now - (tool?.startedAt ?? started))}`;
  } else {
    const first = request?.timing?.firstOutputAt ?? request?.timing?.firstTextAt;
    text = `生成中 · ${secs(now - started)}${first ? ` · 首字节 ${secs(first - started)}` : ''}`;
  }
  return <div className="mit-flow-live" role="status"><span className="mit-flow-pulse" aria-hidden="true" />{text}</div>;
}

function StepMeta({ step }: { step: FlowStep }) {
  const metrics = step.metrics;
  if (!metrics) return <span className="mit-flow-step-meta"><span title="此步未关联到请求记录">无请求记录</span></span>;
  const items: { label: string; value: string; title: string }[] = [
    { label: 'TTFT', value: secs(metrics.ttftMs), title: '请求开始到首个流式增量' },
    { label: 'tok/s', value: known(metrics.tokensPerSecond) ? metrics.tokensPerSecond.toFixed(1) : '—', title: '输出 Token ÷ 生成耗时' },
    { label: '输入', value: compact(metrics.inputTokens), title: '本步总输入 Token（含缓存）' },
    { label: '输出', value: compact(metrics.outputTokens), title: '本步输出 Token' },
    { label: '缓存', value: pct(metrics.cacheRate), title: '缓存读取 ÷ 输入' },
    { label: '用时', value: secs(metrics.e2eMs), title: '本步端到端耗时' },
  ];
  if (known(metrics.cost)) items.push({ label: '费用', value: money(metrics.cost, metrics.currency), title: '账单回填的本步费用' });
  return <span className="mit-flow-step-meta">{items.map(item => <span key={item.label} title={item.title}><em>{item.label}</em>{item.value}</span>)}</span>;
}

function StepCard({ step, live }: { step: FlowStep; live: boolean }) {
  const status = STEP_STATUS[step.status];
  const trigger = step.trigger?.replace(/^用户指令：/, '用户：').replace(/^工具 /, '');
  return <article className={`mit-flow-step is-${status.tone}${step.requestOnly ? ' is-request-only' : ''}`}>
    <header className="mit-flow-step-head">
      <span className="mit-flow-step-index">{step.number}</span>
      <span className={`mit-flow-step-status is-${status.tone}`}>{status.label}</span>
      {trigger && <span className="mit-flow-step-trigger" title={step.trigger ?? undefined}>{trigger}</span>}
      <span className="mit-flow-spacer" />
      <StepMeta step={step} />
    </header>
    {step.parts.length > 0 && <div className="mit-flow-step-body">{step.parts.map(part => <Part key={part.id} part={part} live={live} />)}</div>}
    {step.requestOnly && !step.parts.length && <p className="mit-flow-step-note">该步骤的会话事件已被 Host 截断，仅保留请求记录。</p>}
    <LiveIndicator step={step} />
  </article>;
}

function UsageBar({ turn }: { turn: FlowTurn }) {
  const usage = turn.usage;
  if (!usage) return null;
  return <footer className="mit-flow-usage">
    <span>{usage.requests} 次请求</span>
    <span>输入 {compact(usage.inputTokens)}</span>
    <span>输出 {compact(usage.outputTokens)}</span>
    {known(usage.cacheReadTokens) && known(usage.inputTokens) && usage.inputTokens > 0 && <span>缓存 {pct(usage.cacheReadTokens / usage.inputTokens)}</span>}
    {known(usage.cost) && <span>费用 {money(usage.cost, usage.currency)}</span>}
  </footer>;
}

function UserBubble({ text }: { text: string }) {
  // Strip the fixed delivery footer the Host appends to every prompt; keep it one click away.
  const marker = text.indexOf('\n\n【最终交付约束');
  const body = marker > 0 ? text.slice(0, marker) : text;
  const footer = marker > 0 ? text.slice(marker + 2) : null;
  return <div className="mit-flow-user">
    <div className="mit-flow-user-bubble">
      <p>{body.trim()}</p>
      {footer && <details className="mit-flow-user-footer"><summary>交付约束</summary><p>{footer}</p></details>}
    </div>
  </div>;
}

function Turn({ turn, live }: { turn: FlowTurn; live: boolean }) {
  return <section className="mit-flow-turn" aria-label={`第 ${turn.number} 轮`}>
    {turn.continuation > 0 && <div className="mit-flow-divider"><span>继续会话 #{turn.continuation}</span></div>}
    {turn.user && (turn.continuation === 0 ? <UserBubble text={turn.user.text} /> : <div className="mit-flow-continue-note">发送 <code>{turn.user.text}</code></div>)}
    <ol className="mit-flow-steps">{turn.steps.map(step => <li key={step.id}><StepCard step={step} live={live} /></li>)}</ol>
    {turn.errors.map(error => <ErrorCard key={error.id} part={error} />)}
    <UsageBar turn={turn} />
  </section>;
}

function RetryTrail({ flow }: { flow: FlowRun }) {
  if (!flow.retries.length) return null;
  return <details className="mit-flow-retries">
    <summary><Glyph name="retry" />此前 {flow.retries.length} 次运行失败后原位重试<span className="mit-flow-muted">请求仍保留在账本中</span><Glyph name="chevron" /></summary>
    <ol>{flow.retries.map((item, index) => <li key={`${item.at}-${index}`}>
      <span className="mit-flow-tag">#{index + 1}</span>
      <span>{time(item.startedAt)} → {time(item.finishedAt)}</span>
      <span>{item.requestCount} 次请求</span>
      {item.code && <span className="mit-flow-tag is-error">{item.code}</span>}
      {item.message && <span className="mit-flow-muted" title={item.message}>{item.message}</span>}
    </li>)}</ol>
  </details>;
}

function Waiting({ summary }: { summary: CustomRunSummary }) {
  const now = useStepClock(true);
  const since = summary.startedAt ?? summary.updatedAt;
  const label = summary.phase === 'queued' ? '等待运行槽位' : summary.phase === 'preparing' ? '准备沙箱与固定渠道' : '等待模型响应';
  return <div className="mit-flow-live is-standalone" role="status"><span className="mit-flow-pulse" aria-hidden="true" />{label}{now !== null && since ? ` · ${secs(now - since)}` : ''}</div>;
}

export interface ChatFlowProps {
  events: CustomEvent[];
  requests: CustomRequestView[];
  summary: CustomRunSummary;
  truncated?: boolean;
}

/** Turns → steps → parts. Pure render of {@link projectRun}; the caller owns scrolling. */
export function ChatFlowView({ events, requests, summary, truncated }: ChatFlowProps) {
  const flow = React.useMemo(() => projectRun(events, requests, summary), [events, requests, summary]);
  return <div className="mit-flow">
    {truncated && <p className="mit-flow-note" role="note">Host 仅保留最近的会话事件，更早的步骤只显示请求记录。</p>}
    <RetryTrail flow={flow} />
    {flow.turns.map(turn => <Turn key={turn.id} turn={turn} live={flow.live} />)}
    {flow.pending && <Waiting summary={summary} />}
    {flow.empty && !flow.live && <p className="mit-flow-note">此运行没有会话内容。</p>}
  </div>;
}
