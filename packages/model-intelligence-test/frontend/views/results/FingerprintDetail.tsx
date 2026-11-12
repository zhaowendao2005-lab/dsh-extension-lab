import React,{ useEffect,useRef,useStore } from '../../runtime';
import type { FingerprintAnalysis,FingerprintChallenge,FingerprintErrorDetail,FingerprintSample,Metrics,Run,SampleState,Workbench } from '../../types';
import { formatMetric,Icon,MetricGrid } from '../../components/common';
import { FINGERPRINT_DECISIONS,SAMPLE_LABELS,fingerprintDecisionNote,formatRankingScore,hasCalibratedProbability,isSampleEnded } from './fingerprintPresentation';
import { isEndedStage } from './runOrder';

const LANGUAGES: Record<string,string> = { en: '英语',zh: '中文',ja: '日语',ko: '韩语',fr: '法语',de: '德语',es: '西班牙语' };

// Host 已把供应商错误信息脱敏后随采样返回；这里原样展示，便于定位是认证、限流还是适配器抛错。
export function ErrorStack({ detail }: { detail?: FingerprintErrorDetail | null }) {  if(!detail) return null;
  const facts=[detail.source&&`来源 ${detail.source}`,detail.code&&`code ${detail.code}`,detail.status!=null&&`status ${detail.status}`].filter(Boolean);
  return <details className="mit-error-stack">
    <summary>{facts.length? `错误详情 · ${facts.join(' · ')}`:'错误详情'}</summary>
    {detail.text&&<><p className="mit-muted">供应商原始信息</p><pre className="mit-output mit-error-stack-text" tabIndex={0}>{detail.text}</pre></>}
    <p className="mit-muted">堆栈</p>
    <pre className="mit-output mit-error-stack-text" tabIndex={0}>{detail.stack||'供应商未返回堆栈，只有上面的错误信息。'}</pre>
  </details>;
}

function CandidateRanking({ analysis }: { analysis: FingerprintAnalysis }) {
  const calibrated=hasCalibratedProbability(analysis,analysis.probability);
  const scores=analysis.candidates.map(candidate => candidate.score).filter(Number.isFinite);
  const minimum=Math.min(0,...scores),maximum=Math.max(0,...scores);
  const span=maximum-minimum||1;
  const origin=(-minimum/span)*100;
  return <section className="mit-candidates" aria-label="全部候选模型排名">
    <div className="mit-detail-section-title">
      <h4>全部候选模型 · {analysis.candidates.length}</h4>
      <span className="mit-muted">{calibrated? '参考库内闭集校准概率':'RAW 原始排序分数 · 非概率'}</span>
    </div>
    <p className="mit-muted mit-fingerprint-note">{calibrated? '按官方排序展示。概率仅覆盖参考库内候选；同时保留原始排序分数。缺少概率的候选仅展示 RAW 分数及其条形。':'按官方排序展示。条形以 0 为基线，同一比例尺展示原始分数（可为负值）；不转换为百分比。'}</p>
    {analysis.candidates.length? <ol className="mit-candidate-list">
      {analysis.candidates.map((candidate,index) => {
        const probability=hasCalibratedProbability(analysis,candidate.probability)? candidate.probability:null;
        const score=Number.isFinite(candidate.score)? candidate.score:0;
        const position=((score-minimum)/span)*100;
        const value=calibrated&&probability!==null? `${(probability*100).toFixed(1)}%`:`RAW ${formatRankingScore(candidate.score)}`;
        return <li className="mit-candidate" key={`${candidate.model}-${index}`}>
          <div className="mit-label-row">
            <div className="mit-candidate-name"><span className="mit-muted mit-tabular">{index+1}.</span><strong>{candidate.displayName||candidate.model}</strong><span className="mit-muted">{candidate.familyName||candidate.family}</span></div>
            <div className="mit-candidate-value"><strong className="mit-tabular">{value}</strong>{calibrated&&probability!==null&&<small className="mit-muted">RAW {formatRankingScore(candidate.score)}</small>}</div>
          </div>
          <div className="mit-score-track" role="img" aria-label={`${candidate.displayName||candidate.model}：${value}${calibrated&&probability!==null? '，参考库内闭集校准概率':'，原始排序分数，非概率'}`}>
            {(!calibrated||probability===null)&&<span className="mit-score-zero" style={{ left: `${origin}%` }} />}
            <span className={`mit-score-fill ${(!calibrated||probability===null)&&score<0? 'is-negative':''}`} style={calibrated&&probability!==null? { left: 0,width: `${probability*100}%` }:{ left: `${Math.min(origin,position)}%`,width: `${Math.abs(position-origin)}%` }} />
          </div>
        </li>;
      })}
    </ol>:<p className="mit-muted mit-fingerprint-note">本次未生成候选排名。请查看分析结论与采样诊断。</p>}
  </section>;
}

function SampleCard({ store,runId,index,sample,challenge,diagnostic,metrics,fallbackState }: {
  store: Workbench; runId: string; index: number; sample?: FingerprintSample; challenge?: FingerprintChallenge;
  diagnostic?: FingerprintAnalysis['diagnostics'][number]; metrics: Metrics; fallbackState: SampleState;
}) {
  const state=sample?.state??fallbackState;
  const key=`${runId}:sample:${index}`;
  const expanded=useStore(store.presentation,value => value.expanded[key]??(value.followLatest&&(state==='waiting'||state==='streaming'||index===0)));
  const followLatest=useStore(store.presentation,value => value.followLatest);
  const output=useRef<HTMLPreElement>(null);
  useEffect(() => {
    if(expanded&&followLatest&&output.current)
      output.current.scrollTop=output.current.scrollHeight;
  },[expanded,followLatest,sample?.text]);
  const language=challenge?.language;
  const expected=challenge?.expectedCount??sample?.expectedCount;
  const bodyId=`${store.sessionId}-mit-${key}`;
  return <section className="mit-fingerprint-sample">
    <button type="button" className="mit-sample-heading" aria-expanded={expanded} aria-controls={bodyId} onClick={() => store.actions.toggleRound(key,expanded)}>
      <span className={expanded? 'mit-chevron is-open':'mit-chevron'}><Icon name="chevron" size={14} /></span>
      <strong>样本 {index+1}</strong>
      <span className={`mit-sample-state mit-sample-state-${state}`}>{SAMPLE_LABELS[state]}</span>
      <span className="mit-muted">{language? `${LANGUAGES[language]??language} · ${language}`:'语言待返回'}</span>
      <span className="mit-sample-count mit-tabular">已解析 {diagnostic?.parsed??sample?.count??0} / 目标 {expected??'—'} 个数字</span>
    </button>
    {expanded&&<div className="mit-sample-body" id={bodyId}>
      <dl className="mit-sample-diagnostics">
        <div><dt>有效数字</dt><dd>{diagnostic?.parsed??sample?.count??0}</dd></div>
        <div><dt>最低要求（SDK）</dt><dd>{diagnostic? `${diagnostic.minimum} 个`:'等待分析'}</dd></div>
        <div><dt>分析采用</dt><dd>{diagnostic? (diagnostic.accepted? '已采用':'未采用'):'待判定'}</dd></div>
        <div><dt>越界数字</dt><dd>{diagnostic?.outOfRange??'—'}</dd></div>
      </dl>
      {sample?.error&&<div className="mit-error-box" role="alert"><strong>{state==='truncated'? '样本输出不完整':'采样信息'}</strong><p>{sample.error}</p><ErrorStack detail={sample.errorDetail} /></div>}
      {state==='truncated'&&!sample?.error&&<p className="mit-info">输出被截断，是否可用于分析以 SDK 的最低数字数量检查为准。</p>}
      <div className="mit-detail-section-title"><h4>实际请求提示词</h4><span className="mit-muted">共享挑战 · {challenge?.id??'等待创建'}</span></div>
      <pre className="mit-output mit-sample-prompt" tabIndex={0}>{challenge?.prompt||'挑战尚未返回；不会使用模拟提示词。'}</pre>
      <div className="mit-detail-section-title"><h4>原始输出</h4><span className="mit-muted">真实模型响应 · 纯文本</span></div>
      <pre className="mit-output mit-sample-output" ref={output} tabIndex={0}>{sample?.text||(isSampleEnded(state)? '本样本没有返回文本。':'等待模型输出…')}</pre>
      <div className="mit-detail-section-title"><h4>本次请求指标</h4><span className="mit-muted">缺失项显示 —，不估造</span></div>
      <MetricGrid metrics={metrics} source="real" />
      <dl className="mit-sample-diagnostics">
        <div><dt>首输出（含推理）</dt><dd>{formatMetric('elapsed',sample?.firstByteMs??undefined)}</dd></div>
        <div><dt>首正文延迟</dt><dd>{formatMetric('elapsed',sample?.firstTextMs??undefined)}</dd></div>
        <div><dt>生成区间</dt><dd>{formatMetric('elapsed',sample?.generationMs??undefined)}</dd></div>
        <div><dt>结束原因（原值）</dt><dd>{sample?.finish??'—'}</dd></div>
      </dl>
    </div>}
  </section>;
}

export function FingerprintDetail({ store,run }: { store: Workbench; run: Run }) {
  const record=useStore(store.evaluations,state => state.records.find(item => item.id===run.testId));
  const analysis=run.fingerprint?.analysis;
  const samples=run.fingerprint?.samples??[];
  const ended=samples.filter(sample => isSampleEnded(sample.state)).length;
  const calibrated=analysis? hasCalibratedProbability(analysis,analysis.probability):false;
  const fallbackState: SampleState=run.stage==='cancelled'? 'cancelled':run.stage==='failed'||run.stage==='timeout'? 'failed':'queued';
  return <div className="mit-fingerprint-detail">
    <section className={`mit-fingerprint-verdict ${analysis? `mit-verdict-${analysis.decision}`:''}`} aria-label="官方指纹分析结论">
      <div className="mit-label-row"><h3>指纹分析</h3><span className="mit-badge">官方 lmfpd-sdk · 真实采样</span></div>
      <div className="mit-fingerprint-decision" role="status"><strong>{analysis? FINGERPRINT_DECISIONS[analysis.decision]:run.stage==='analyzing'? '正在分析样本':isEndedStage(run.stage)? '未生成分析结论':'等待采样与分析'}</strong>{analysis&&<span className="mit-muted">有效样本 {analysis.usedOutputs}/3</span>}</div>
      <p className="mit-muted">{analysis? fingerprintDecisionNote(analysis):isEndedStage(run.stage)? '本次没有可用分析。保留下方真实输出、错误和已测得的指标，不填充模拟结论。':'每个模型计划执行 3 次真实请求；分析前不生成候选排名或概率。'}</p>
      {analysis&&(analysis.decision==='scored'||analysis.decision==='partial')&&<div className="mit-fingerprint-best">
        <span className="mit-muted">最高匹配候选</span><strong>{analysis.predictionName||analysis.prediction||'—'}</strong>
        {analysis.familyName&&<span className="mit-muted">{analysis.familyName}</span>}
        <span className="mit-tabular">{calibrated? `${((analysis.probability??0)*100).toFixed(1)}% · 参考库内闭集概率`:`RAW ${formatRankingScore(analysis.rankingScore)}`}</span>
      </div>}
      {analysis&&<p className="mit-muted mit-fingerprint-method">方法：{analysis.method} · 校准状态：{calibrated? '参考库内已校准':'不可用'}</p>}
      <p className="mit-muted mit-fingerprint-method">参考库版本：{record?.fingerprint?.reference?.builtAt||'尚未取得'} · SDK：{record?.fingerprint?.reference?.sdk||'等待加载'}</p>
      {record?.fingerprint?.error&&<div className="mit-error-box" role="alert"><strong>任务或连接信息</strong><p>{record.fingerprint.error}</p></div>}
    </section>
    <div className="mit-detail-section-title"><h4>真实请求汇总</h4><span className="mit-muted">供应商未返回的用量不估算；实际费用不可用</span></div>
    <MetricGrid metrics={run.metrics} source="real" />
    <p className="mit-muted mit-fingerprint-note">TTFT 为首个正文或推理增量的可观测延迟，汇总显示已测样本的均值；生成区间为首尾可观测增量之间的时间。用量与请求耗时汇总已知值，速率仅采用同时有用量与时长的样本，不含排队或分析。缺失项显示 —，实际费用不可用，并非模型质量指标。</p>
    {analysis&&<CandidateRanking analysis={analysis} />}
    {analysis?.sequence&&<section aria-label="数字序列诊断">
      <div className="mit-detail-section-title"><h4>数字序列诊断</h4><span className="mit-muted">SDK 返回值 · 不作身份结论</span></div>
      <dl className="mit-sample-diagnostics">
        <div><dt>自相关</dt><dd>{formatRankingScore(analysis.sequence.autocorrelation)}</dd></div>
        <div><dt>小步长占比（0–1）</dt><dd>{formatRankingScore(analysis.sequence.smallStepShare)}</dd></div>
        <div><dt>序列形态</dt><dd>{analysis.sequence.modelLike? '符合参考模型特征':'不符合参考模型特征'}</dd></div>
      </dl>
    </section>}
    <section aria-label="指纹采样详情">
      <div className="mit-detail-section-title"><h4>3 条真实采样</h4><span className="mit-muted" role="status">{ended}/3 已结束{analysis? ` · ${analysis.usedOutputs}/3 被采用`:''}</span></div>
      <p className="mit-muted mit-fingerprint-note">展开查看共享挑战、原始输出、有效性诊断及请求指标。采样结束不等于样本通过分析。</p>
      {[0,1,2].map(index => <SampleCard key={`${run.id}:${index}`} store={store} runId={run.id} index={index} sample={samples.find(sample => sample.index===index)} challenge={record?.fingerprint?.challenges[index]} diagnostic={analysis?.diagnostics.find(item => item.index===index)} metrics={run.rounds.find(round => round.number===index+1)?.metrics??{}} fallbackState={fallbackState} />)}
    </section>
  </div>;
}
