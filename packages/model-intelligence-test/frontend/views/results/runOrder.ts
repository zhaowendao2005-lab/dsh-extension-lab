import type { Run, Stage } from '../../types';

const ENDED_STAGES: Stage[] = ['completed','failed','timeout','cancelled'];

export function isEndedStage(stage: Stage): boolean {
  return ENDED_STAGES.includes(stage);
}

export function bestCandidateScore(run: Run | undefined): number {
  if(run?.fingerprint) {
    const analysis=run.fingerprint.analysis;
    return analysis&&(analysis.decision==='scored'||analysis.decision==='partial')&&analysis.rankingScore!==null&&Number.isFinite(analysis.rankingScore)? analysis.rankingScore:Number.NEGATIVE_INFINITY;
  }
  if(!run?.candidates.length)
    return Number.NEGATIVE_INFINITY;
  return run.candidates.reduce((best,candidate) => Number.isFinite(candidate.score)? Math.max(best,candidate.score):best,Number.NEGATIVE_INFINITY);
}

/** Ended runs only, highest match first; failures without candidates sort last. */
export function endedRunIds(ids: string[],runs: Record<string,Run>): string[] {
  return ids.filter(id => {
    const run = runs[id];
    return run !== undefined && isEndedStage(run.stage);
  }).sort((a,b) => {
    const aScore=bestCandidateScore(runs[a]),bScore=bestCandidateScore(runs[b]);
    if(aScore!==bScore)
      return bScore>aScore? 1:-1;
    return runs[a].model.name.localeCompare(runs[b].model.name,'zh-CN');
  });
}
