import type { ColumnSort, Metrics, Run, Stage } from '../../types';

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


/** Canonical stage order so "按状态排序" groups queued → running → ended instead of alphabetically. */
const STAGE_ORDER: Stage[] = ['queued','waiting-first-token','preparing','running','tooling','streaming','finalizing','validating','analyzing','completed','failed','timeout','cancelled','interrupted'];

/** `null` means "no value for this column": those rows always sink to the bottom. */
function sortValue(run: Run | undefined,column: string): number | string | null {
  if(!run)
    return null;
  if(column==='model')
    return run.model.name;
  if(column==='stage')
    return STAGE_ORDER.indexOf(run.stage);
  if(column==='match') {
    const score=bestCandidateScore(run);
    return Number.isFinite(score)? score:null;
  }
  if(column==='round')
    return run.currentRound||null;
  const value=run.metrics[column as keyof Metrics];
  return typeof value==='number'&&Number.isFinite(value)? value:null;
}

/** User-chosen column order; ties fall back to the model name so the table never jitters between renders. */
export function sortRunIds(ids: string[],runs: Record<string,Run>,sort: ColumnSort): string[] {
  const direction=sort.direction==='asc'? 1:-1;
  const tie=(a: string,b: string): number => {
    const aRun=runs[a],bRun=runs[b];
    return (aRun?.model.name??a).localeCompare(bRun?.model.name??b,'zh-CN');
  };
  return [...ids].sort((a,b) => {
    const aValue=sortValue(runs[a],sort.column),bValue=sortValue(runs[b],sort.column);
    if(aValue===null&&bValue===null)
      return tie(a,b);
    if(aValue===null)
      return 1;
    if(bValue===null)
      return -1;
    if(typeof aValue==='string'||typeof bValue==='string') {
      const compared=String(aValue).localeCompare(String(bValue),'zh-CN');
      return compared===0? tie(a,b):compared*direction;
    }
    if(aValue===bValue)
      return tie(a,b);
    return (aValue<bValue? -1:1)*direction;
  });
}
