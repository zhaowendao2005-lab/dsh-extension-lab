import type { Candidate, FingerprintJobView, FingerprintOptions, FingerprintRunView, FingerprintSample, FingerprintStatusView, Metrics, Model, ModelIntelligenceTransport, Round, Run, Stage } from '../types';

/** Real Host jobs only: transport plus projection, with no invented results or timing. */
const SAMPLE_STAGE: Record<FingerprintSample['state'], Stage> = {
  queued: 'queued', waiting: 'waiting-first-token', streaming: 'streaming', complete: 'completed', truncated: 'completed', failed: 'failed', cancelled: 'cancelled',
};

export function createFingerprintRun(id: string, testId: string, sessionId: string, model: Model): Run {
  return { id, testId, sessionId, model: { ...model }, stage: 'queued', output: '', metrics: {}, candidates: [], rounds: [], currentRound: 0, fingerprint: { samples: [], analysis: null } };
}

/** Forward only caller-set options; the Host owns defaults, clamping and slot semantics. */
function optionsOf(options: FingerprintOptions | undefined): FingerprintOptions {
  return {
    ...(options?.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

// The domain captures the returned job ID before validating the snapshot, so even an invalid
// snapshot cannot hide a known job from cancel/delete/dispose cleanup. Async also catches sync IO throws.
export async function startFingerprint(transport: ModelIntelligenceTransport, models: Model[], options?: FingerprintOptions): Promise<FingerprintJobView> {
  return transport.fingerprintStart({ models: models.map(model => ({ provider: model.provider, id: model.id })), ...optionsOf(options) });
}
export async function configureFingerprint(transport: ModelIntelligenceTransport, jobId: string, options: FingerprintOptions): Promise<FingerprintJobView> {
  return transport.fingerprintConfigure({ jobId, ...optionsOf(options) });
}
export async function retryFingerprint(transport: ModelIntelligenceTransport, jobId: string, model: {provider: string; id: string}): Promise<FingerprintJobView> {
  return transport.fingerprintRetry({ jobId, model: { provider: model.provider, id: model.id } });
}
export async function pollFingerprint(transport: ModelIntelligenceTransport, jobId: string, revision: number): Promise<FingerprintStatusView> {
  return transport.fingerprintStatus({ jobId, ...(revision >= 0 ? { revision } : {}) });
}
export async function cancelFingerprint(transport: ModelIntelligenceTransport, jobId: string): Promise<FingerprintJobView> {
  return transport.fingerprintCancel({ jobId });
}

const observed = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function sum(values: (number | null | undefined)[]): number | undefined {
  const known = values.filter(observed);
  return known.length ? known.reduce((total, value) => total + value, 0) : undefined;
}

/** Numerator and denominator always come from the same eligible samples. Missing is not zero. */
function rate(samples: FingerprintSample[], duration: (sample: FingerprintSample) => number | null | undefined): number | undefined {
  let tokens = 0;
  let milliseconds = 0;
  for (const sample of samples) {
    const ms = duration(sample);
    if (!observed(sample.outputTokens) || !observed(ms) || ms <= 0) continue;
    tokens += sample.outputTokens;
    milliseconds += ms;
  }
  return milliseconds > 0 ? tokens / (milliseconds / 1000) : undefined;
}

/**
 * TTFT is first observable text OR reasoning delta, not necessarily first answer text.
 * Request durations are final Host observations (null until ended). Generation is the
 * actual first-to-last observable delta interval, never request-duration minus TTFT.
 * Both rates use ended samples so final token usage is paired with its final interval.
 */
function metricsOf(samples: FingerprintSample[]): Metrics {
  const started = samples.filter(sample => sample.state !== 'queued');
  const ended = started.filter(sample => observed(sample.durationMs));
  const input = sum(started.map(sample => sample.inputTokens));
  const output = sum(started.map(sample => sample.outputTokens));
  const firsts = started.map(sample => sample.firstByteMs).filter(observed);
  const elapsed = sum(ended.map(sample => sample.durationMs));
  const e2e = rate(ended, sample => sample.durationMs);
  const generation = rate(ended, sample => sample.generationMs);
  return {
    ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}), ...(elapsed !== undefined ? { elapsed } : {}),
    ...(firsts.length ? { ttft: firsts.reduce((a, b) => a + b, 0) / firsts.length } : {}),
    ...(e2e !== undefined ? { e2e } : {}), ...(generation !== undefined ? { generation } : {}),
  };
}

function roundsOf(runId: string, samples: FingerprintSample[]): Round[] {
  return samples.map(sample => {
    const state = SAMPLE_STAGE[sample.state];
    const metrics = metricsOf([sample]);
    return { id: `${runId}:sample:${sample.index}`, number: sample.index + 1, state, metrics,
      steps: [{ id: `${runId}:sample:${sample.index}:numbers`, title: `采样 · 已解析 ${sample.count}/${sample.expectedCount} 个数字`, state, metrics }] };
  });
}

function candidatesOf(view: FingerprintRunView): Candidate[] {
  // Preserve every SDK candidate in its original order. Raw ranking scores may be negative;
  // no probability means uncalibrated raw score, not an invented zero probability.
  return (view.analysis?.candidates ?? []).map(item => {
    const probability = item.probability;
    return view.analysis?.decision === 'scored' && view.analysis.probabilityStatus === 'reference_calibrated' && observed(probability) && probability <= 1
      ? { name: item.displayName, family: item.familyName, score: probability, calibrated: true }
      : { name: item.displayName, family: item.familyName, score: item.score, calibrated: false };
  });
}

/** Value equality for the plain wire snapshots; independent of object key insertion order. */
export function fingerprintValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => fingerprintValuesEqual(item, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && fingerprintValuesEqual(a[key], b[key]));
}

/** Unchanged model rows retain identity even when another run advances the job revision. */
export function applyFingerprintRun(run: Run, view: FingerprintRunView): Run {
  if (run.model.provider !== view.provider || run.model.id !== view.model) return run;
  if (run.fingerprint && run.stage === view.stage
    && fingerprintValuesEqual(run.error ?? null, view.error)
    && fingerprintValuesEqual(run.fingerprint.samples, view.samples)
    && fingerprintValuesEqual(run.fingerprint.analysis, view.analysis)) return run;
  const samples = view.samples;
  const active = samples.findIndex(sample => !['complete', 'truncated', 'failed', 'cancelled'].includes(sample.state));
  const output = samples.map(sample => `# 样本 ${sample.index + 1}\n${sample.text}`).join('\n\n');
  return { ...run, stage: view.stage, output, metrics: metricsOf(samples), rounds: roundsOf(run.id, samples),
    currentRound: active === -1 ? samples.length : active + 1, candidates: candidatesOf(view),
    fingerprint: { samples, analysis: view.analysis }, error: view.error ?? undefined };
}

/** Only startup rejection without a known Host job is represented as a local failure. */
export function failFingerprintRun(run: Run, message: string): Run {
  return { ...run, stage: 'failed', error: { stage: 'queued', message } };
}
