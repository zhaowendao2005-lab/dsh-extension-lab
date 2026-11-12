import type { FingerprintAnalysis,FingerprintDecision,SampleState } from '../../types';

export const FINGERPRINT_DECISIONS: Record<FingerprintDecision,string> = {
  scored: '已评分', partial: '部分样本排名', unscorable: '暂不可评分', not_model: '不像语言模型回答',
};
export const SAMPLE_LABELS: Record<SampleState,string> = {
  queued: '排队中', waiting: '等待响应', streaming: '生成中', complete: '采样完成', truncated: '输出截断', failed: '采样失败', cancelled: '已取消',
};
export function isSampleEnded(state: SampleState): boolean {
  return state==='complete'||state==='truncated'||state==='failed'||state==='cancelled';
}
export function hasCalibratedProbability(analysis: FingerprintAnalysis,value: number|null): value is number {
  return analysis.decision==='scored'&&analysis.probabilityStatus==='reference_calibrated'&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
}
export function formatRankingScore(value: number|null): string {
  if(value===null||!Number.isFinite(value))
    return '—';
  return new Intl.NumberFormat('zh-CN',{ maximumSignificantDigits: 6 }).format(value);
}
export function fingerprintDecisionNote(analysis: FingerprintAnalysis): string {
  if(analysis.decision==='partial')
    return `仅 ${analysis.usedOutputs}/3 条回答通过有效性检查；展示原始排序分数，不提供校准概率。`;
  if(analysis.decision==='unscorable')
    return `当前有效回答 ${analysis.usedOutputs}/3 条，未生成可用排名。请查看各样本的数字数量、最低要求和错误。`;
  if(analysis.decision==='not_model')
    return '数字序列的变化方式与参考库中的语言模型回答不同，SDK 未生成排名。这不是对模型身份或供应商真实性的判定。';
  return hasCalibratedProbability(analysis,analysis.probability)
    ? '概率仅在当前参考库的候选模型中校准，不包含库外模型，不是身份鉴定、真实性能或质量排名。'
    : '当前没有可用的参考库校准概率。RAW 是官方排序分数，可为负值，不是百分比或置信度。';
}
