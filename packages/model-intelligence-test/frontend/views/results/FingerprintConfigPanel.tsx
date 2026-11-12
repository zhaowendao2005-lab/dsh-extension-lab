import React,{ useRef,useStore } from '../../runtime';
import type { Evaluation,Workbench } from '../../types';
import { Icon } from '../../components/common';
import { useDismissablePopover } from '../../components/useDismissablePopover';

const FALLBACK_MAX_CONCURRENCY=6;
const FALLBACK_TIMEOUT_MS=180_000;
const FALLBACK_MIN_TIMEOUT_MS=30_000;
const FALLBACK_MAX_TIMEOUT_MS=1_800_000;
const FALLBACK_REQUESTS_PER_MODEL=3;

function clamp(value: number,minimum: number,maximum: number): number {
  return Math.min(Math.max(value,minimum),maximum);
}
function parseInput(input: HTMLInputElement|null,fallback: number): number {
  if(!input)
    return fallback;
  const value=Number.parseFloat(input.value);
  return Number.isFinite(value)? value:fallback;
}

/**
 * Live Host sampling limits. Values come from the Host snapshot only; edits are
 * applied on commit (blur / Enter / stepper) so typing never sends a request.
 */
export function FingerprintConfigPanel({ store,record }: {
  store: Workbench;
  record: Evaluation;
}) {
  const open=useStore(store.presentation,state => state.configOpen);
  const root=useDismissablePopover(open,store.actions.toggleConfig);
  const concurrencyInput=useRef<HTMLInputElement>(null);
  const fingerprint=record.fingerprint;
  const limits=fingerprint?.limits;
  const busy=Boolean(fingerprint?.busy);
  const ready=Boolean(fingerprint?.jobId);
  const cancelled=fingerprint?.status==='cancelled';
  const maxConcurrency=Math.max(1,limits?.maxConcurrency??FALLBACK_MAX_CONCURRENCY);
  const concurrency=clamp(fingerprint?.concurrency??limits?.defaultConcurrency??FALLBACK_MAX_CONCURRENCY,1,maxConcurrency);
  const requestsPerModel=Math.max(1,limits?.requestsPerModel??FALLBACK_REQUESTS_PER_MODEL);
  const minTimeoutS=Math.max(0.001,(limits?.minTimeoutMs??FALLBACK_MIN_TIMEOUT_MS)/1000);
  const maxTimeoutS=Math.max(minTimeoutS,(limits?.maxTimeoutMs??FALLBACK_MAX_TIMEOUT_MS)/1000);
  const timeoutMs=clamp(fingerprint?.timeoutMs??limits?.defaultTimeoutMs??FALLBACK_TIMEOUT_MS,minTimeoutS*1000,maxTimeoutS*1000);
  const timeoutS=timeoutMs/1000;
  const models=record.runIds.length;
  const locked=busy||!ready||cancelled;
  const expanded=open&&ready;
  const base=`${store.sessionId}-mit-fingerprint-config`;

  function applyConcurrency(next: number): void {
    if(locked)
      return;
    const value=clamp(Math.round(next),1,maxConcurrency);
    if(value!==concurrency)
      store.actions.setFingerprintConfig(record.id,{ concurrency: value });
  }
  function commitConcurrency(input: HTMLInputElement): void {
    const value=clamp(Math.round(parseInput(input,concurrency)),1,maxConcurrency);
    input.value=String(value);
    applyConcurrency(value);
  }
  function stepConcurrency(delta: number): void {
    const input=concurrencyInput.current;
    const current=input? clamp(Math.round(parseInput(input,concurrency)),1,maxConcurrency):concurrency;
    const next=clamp(current+delta,1,maxConcurrency);
    if(input)
      input.value=String(next);
    applyConcurrency(next);
  }
  function commitTimeout(input: HTMLInputElement): void {
    const seconds=clamp(parseInput(input,timeoutS),minTimeoutS,maxTimeoutS);
    const value=Math.round(seconds*1000);
    input.value=String(Number((value/1000).toFixed(3)));
    if(locked||value===timeoutMs)
      return;
    store.actions.setFingerprintConfig(record.id,{ timeoutMs: value });
  }
  return <div className="mit-config" ref={root}>
    <button type="button" className="mit-button mit-config-trigger" aria-haspopup="dialog" aria-expanded={expanded} aria-controls={base} disabled={!ready} title={ready? '调整模型并发槽位与单请求时长（Host 实时生效）':'指纹任务尚未就绪，配置暂不可用'} onClick={store.actions.toggleConfig}>
      <Icon name="settings" size={14} />配置
    </button>
    {expanded&&<div className="mit-config-popover mit-frosted" id={base} role="dialog" aria-label="指纹采样配置" aria-describedby={`${base}-help`}>
      <div className="mit-config-head">
        <strong>采样配置</strong>
        <span className="mit-muted">Host 实时生效</span>
      </div>
      {fingerprint?.error&&<p className="mit-config-error" role="alert">{fingerprint.error}</p>}
      <div className="mit-config-field">
        <label htmlFor={`${base}-concurrency`}>模型并发槽位</label>
        <div className="mit-stepper">
          <button type="button" className="mit-icon-button" aria-label="减少一个模型并发槽位" disabled={locked||concurrency<=1} onClick={() => stepConcurrency(-1)}>
            <span aria-hidden="true">−</span>
          </button>
          <input id={`${base}-concurrency`} ref={concurrencyInput} key={`concurrency:${concurrency}`} className="mit-config-number" type="number" inputMode="numeric" min={1} max={maxConcurrency} step={1} defaultValue={concurrency} disabled={locked} onBlur={event => commitConcurrency(event.currentTarget)} onKeyDown={event => {
            if(event.key==='Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }} />
          <button type="button" className="mit-icon-button" aria-label="增加一个模型并发槽位" disabled={locked||concurrency>=maxConcurrency} onClick={() => stepConcurrency(1)}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
      <div className="mit-config-field">
        <label htmlFor={`${base}-timeout`}>单请求最大时长（秒）</label>
        <input id={`${base}-timeout`} key={`timeout:${timeoutMs}`} className="mit-config-number" type="number" inputMode="numeric" min={minTimeoutS} max={maxTimeoutS} step={30} defaultValue={Number(timeoutS.toFixed(3))} disabled={locked} onBlur={event => commitTimeout(event.currentTarget)} onKeyDown={event => {
          if(event.key==='Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }} />
      </div>
      <p className="mit-config-derived">
        <strong className="mit-tabular">{concurrency} 槽 · {concurrency*requestsPerModel} 路并发</strong>
        {models>0&&models<concurrency&&<span className="mit-muted">本记录 {models} 个模型 · 实际最多 {models*requestsPerModel} 路并发</span>}
        {limits&&<span className="mit-muted">Host 上限 {limits.maxConcurrency} 槽 / {limits.maxConcurrentRequests} 路请求</span>}
      </p>
      <p className="mit-config-help mit-muted" id={`${base}-help`}>每模型 {requestsPerModel} 条挑战同时发出；降低并发或时长不会打断已开始的请求，提高时长会延长进行中的请求。</p>
      {busy&&<p className="mit-config-busy" role="status">正在应用…</p>}
      {!busy&&cancelled&&<p className="mit-config-note" role="status">任务已取消，配置不可修改。</p>}
    </div>}
  </div>;
}
