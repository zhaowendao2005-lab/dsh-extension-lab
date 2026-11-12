import type { Metrics, Model, Round, Run, Stage } from '../types';

/** Custom-task simulation only. Fingerprint tests run for real on the Host and never pass through this file. */

const terminal = (stage: Stage): boolean => ['completed', 'failed', 'timeout', 'cancelled'].includes(stage);
const roundDuration = 8_000;
const text = '【模拟输出 · 不调用模型】\n正在理解任务与交付约束，整理关键目标。\n逐步构建可检查的方案，补充边界条件并复核结果。\n本轮已完成：生成内容仅用于界面与性能指标演示，不代表真实模型能力。\n';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" rx="24" fill="#101827"/><circle cx="320" cy="155" r="68" fill="#6366f1"/><path d="m288 156 22 22 43-47" fill="none" stroke="white" stroke-width="12" stroke-linecap="round"/><text x="320" y="282" fill="white" font-size="24" text-anchor="middle">SIMULATED ARTIFACT</text></svg>';
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模拟交付</title><body style="font-family:system-ui;background:#101827;color:#e2e8f0;padding:40px"><h1>模拟 HTML 交付</h1><p>此文件仅为工作台演示，不代表真实模型输出。</p><canvas width="500" height="160" id="art" aria-label="模拟柱状图"></canvas><script>const c=document.getElementById("art").getContext("2d");[80,125,100,145].forEach((h,i)=>{c.fillStyle="#818cf8";c.fillRect(30+i*115,160-h,70,h)});</script></body></html>';

export function createMockRun(id: string, testId: string, sessionId: string, model: Model): Run {
  return { id, testId, sessionId, model: { ...model }, stage: 'queued', output: '', metrics: { elapsed: 0 }, candidates: [], currentRound: 1, rounds: Array.from({ length: 3 }, (_, index) => ({ id: `${id}:round:${index + 1}`, number: index + 1, state: 'queued' as Stage, metrics: {}, steps: [{ id: `${id}:step:${index + 1}:generate`, title: '生成与交付', state: 'queued' as Stage, metrics: {} }, { id: `${id}:step:${index + 1}:review`, title: '结果复核', state: 'queued' as Stage, metrics: {} }] })) };
}

function stageAt(time: number): Stage {
  if (time < 450) return 'queued';
  if (time < 1400) return 'waiting-first-token';
  if (time < 5800) return 'streaming';
  if (time < 6700) return 'finalizing';
  if (time < roundDuration) return 'analyzing';
  return 'completed';
}

function metricsAt(time: number, index: number): Metrics {
  const requestMs = Math.max(0, Math.min(6700, time) - 450);
  if (time < 450) return { elapsed: 0 };
  const input = 256 + index * 31;
  const generationMs = Math.max(0, Math.min(5800, time) - 1400);
  const output = time >= 1400 ? 1 + Math.floor(generationMs / (15 + index)) : 0;
  return { input, cache: Math.floor(input * 0.2), output, elapsed: requestMs,
    ...(time >= 1400 ? { ttft: 950, e2e: output / (requestMs / 1000) } : {}),
    ...(generationMs > 0 ? { generation: output / (generationMs / 1000) } : {}),
    cost: (input * 0.2 + output * 0.8) / 1_000_000,
  };
}

/** Pure simulation: totalMs comes from the domain's private clock, never display metrics. */
export function advanceMockRun(run: Run, index: number, totalMs: number): Run {
  if (terminal(run.stage)) return run;
  const delay = Math.min(index, 12) * 180;
  const rounds = 3;
  const duration = rounds * roundDuration;
  const cutoff = index % 7 === 4 ? 5300 : index % 7 === 6 ? 6800 : duration;
  const time = Math.min(cutoff, Math.max(0, totalMs - delay));
  const failure: Stage | undefined = index % 7 === 4 && time >= 5300 ? 'failed' : index % 7 === 6 && time >= 6800 ? 'timeout' : undefined;
  const stage = failure ?? (time >= duration ? 'completed' : stageAt(time % roundDuration));
  const currentRound = Math.min(rounds, Math.floor(time / roundDuration) + 1);
  const currentTime = Math.min(roundDuration, time - (currentRound - 1) * roundDuration);
  const finishedRounds = Math.min(rounds, Math.floor(time / roundDuration));
  const progress = Math.min(1, Math.max(0, (currentTime - 1400) / 4400));
  const output = Array.from({ length: currentRound }, (_, round) => `第 ${round + 1} 轮\n${round < finishedRounds ? text : text.slice(0, Math.floor(text.length * progress))}`).join('\n');
  const observed = Array.from({ length: currentRound }, (_, round) => metricsAt(Math.max(0, Math.min(roundDuration, time - round * roundDuration)), index));
  const sum = (key: 'input' | 'output' | 'cache' | 'elapsed' | 'cost'): number => observed.reduce((total, item) => total + (item[key] ?? 0), 0);
  const requestMs = sum('elapsed');
  const generationMs = Array.from({ length: currentRound }, (_, round) => Math.max(0, Math.min(5800, time - round * roundDuration) - 1400)).reduce((total, value) => total + value, 0);
  const hasOutput = observed.some(item => item.ttft !== undefined);
  const outputCount = sum('output');
  const metrics: Metrics = { elapsed: requestMs,
    ...(time >= 450 ? { input: sum('input'), output: outputCount, cache: sum('cache'), cost: sum('cost') } : {}),
    ...(hasOutput ? { ttft: 950, e2e: outputCount / (requestMs / 1000) } : {}),
    ...(generationMs > 0 ? { generation: outputCount / (generationMs / 1000) } : {}),
  };
  const nextRounds = run.rounds.map((round, roundIndex): Round => {
    if (terminal(round.state)) return round;
    const local = Math.max(0, Math.min(roundDuration, time - roundIndex * roundDuration));
    let state: Stage = local === 0 ? 'queued' : stageAt(local);
    if (failure && roundIndex >= currentRound - 1) state = roundIndex === currentRound - 1 ? failure : 'cancelled';
    if (state === 'queued' && round.state === 'queued') return round;
    const roundMetrics = metricsAt(local, index);
    return { ...round, state, metrics: roundMetrics, steps: round.steps.map((step, stepIndex) => ({ ...step, state: terminal(state) ? state : stepIndex === 0 ? (local >= 6700 ? 'completed' : state) : local >= 6700 ? 'analyzing' : 'queued', metrics: stepIndex === 0 ? roundMetrics : { elapsed: Math.max(0, local - 6700) } })) };
  });
  return { ...run, stage, output, metrics, currentRound, rounds: nextRounds,
    ...(failure ? { error: { stage: stageAt(time % roundDuration), message: failure === 'timeout' ? '模拟超时：演示等待截止，不代表提供方真实异常。' : '模拟生成失败：演示错误状态，不代表提供方真实异常。' } } : {}),
    ...(stage === 'completed' ? { artifact: index % 2 === 0 ? { type: 'svg' as const, source: svg, name: 'simulated-artifact.svg' } : { type: 'html' as const, source: html, name: 'simulated-artifact.html' } } : {}),
  };
}

export function cancelMockRun(run: Run): Run {
  if (terminal(run.stage)) return run;
  return { ...run, stage: 'cancelled', rounds: run.rounds.map(round => terminal(round.state) ? round : { ...round, state: 'cancelled', steps: round.steps.map(step => terminal(step.state) ? step : { ...step, state: 'cancelled' }) }) };
}
