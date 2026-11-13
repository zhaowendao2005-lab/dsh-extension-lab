import type { AttemptStatus,AttemptSummary,Model } from '../../types';

/** Provider label for a run model; relay channels read `a6api #<channelId>`. */
export function providerLabel(model: Pick<Model,'providerName'|'relay'>): string {
  return model.relay? `${model.relay.siteId||'a6api'} #${model.relay.channelId}`:model.providerName;
}

/** Model label for a run model; relay channels show the upstream model name. */
export function modelLabel(model: Pick<Model,'name'|'id'|'relay'>): string {
  return model.relay? model.relay.model||model.name||model.id:model.name||model.id;
}

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus,string> = {
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
};

/** The attempt currently shown: explicit selection, else the latest. */
export function currentAttempt(attempts: AttemptSummary[],attemptId: string|undefined): AttemptSummary|undefined {
  return attempts.find(attempt => attempt.id===attemptId)??attempts[attempts.length-1];
}
