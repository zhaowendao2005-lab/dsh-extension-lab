import type { Run } from '../../types';

/** Whether the fingerprint verdict agrees with the model id the channel actually served. */
export type MatchVerdict = 'match' | 'mismatch' | 'unknown';

export const MATCH_VERDICT_LABELS: Record<MatchVerdict, string> = {match: '符合', mismatch: '不符合', unknown: '无法判定'};

/** Reference-bank names carry aliases after a slash, e.g. `gpt-6-astra/6.1-sol` covers the `gpt-6.1-sol` entry. */
function aliases(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value.split('/').map(part => part.trim().toLowerCase()).filter(Boolean);
}

/**
 * Compare the tested model id with the reference bank's prediction.
 * Only a scored/partial analysis can agree or disagree; everything else stays unknown so the UI never guesses.
 */
export function matchVerdict(run: Run): MatchVerdict {
  const analysis = run.fingerprint?.analysis;
  if (!analysis || (analysis.decision !== 'scored' && analysis.decision !== 'partial')) return 'unknown';
  const prediction = analysis.prediction;
  if (!prediction) return 'unknown';
  const target = run.model.id.trim().toLowerCase();
  if (!target) return 'unknown';
  const winner = analysis.candidates?.[0]?.displayName;
  const predicted = new Set([...aliases(prediction), ...aliases(analysis.predictionName), ...aliases(winner)]);
  return predicted.has(target) ? 'match' : 'mismatch';
}

/** Mismatch label for a prediction that is neither the tested id nor one of its aliases. */
export function matchVerdictTitle(run: Run, verdict: MatchVerdict): string {
  const analysis = run.fingerprint?.analysis;
  if (verdict === 'unknown') return '没有可用于对照的闭集判定（未收录、样本不足或不像语言模型）。';
  const predicted = analysis?.predictionName || analysis?.prediction || '—';
  return verdict === 'match' ? `参考库判定为 ${predicted}，与测试的模型 ${run.model.id} 一致（含别名）。` : `参考库判定为 ${predicted}，与测试的模型 ${run.model.id} 不一致。`;
}
