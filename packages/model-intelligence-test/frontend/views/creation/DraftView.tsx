import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { FIXED_FOOTER } from '../../types';
import { ModelPicker } from './ModelPicker';
import { Icon } from '../../components/common';
import { InfoTooltip } from '../../components/InfoTooltip';
import { A6_PROTOCOLS, type A6Protocol } from '../../types';
/** Same default the Host applies when no protocol is chosen. */
const defaultProtocol=(model: {brand?: string; model: string}): A6Protocol => /claude|anthropic/i.test(`${model.brand??''} ${model.model}`)? 'anthropic-messages':'openai-completions';
function PromptEditor({ store }: {
  store: Workbench;
}) {
  const draft=useStore(store.draft,value => value);
  const presets=useStore(store.presets,value => value);
  return <section className={`mit-prompt-workspace ${presets.collapsed? 'is-collapsed':''}`} aria-label="提示词编辑器">
    <aside className="mit-presets">
      <div className="mit-section-heading">
        <button type="button" className="mit-text-button" onClick={store.actions.togglePresets} aria-expanded={!presets.collapsed}>
          <Icon name="sidebar" />
          {!presets.collapsed&&'提示词预设'}
        </button>
        {!presets.collapsed&&<button type="button" className="mit-icon-button" onClick={store.actions.addPreset} aria-label="新建预设">
          <Icon name="plus" />
        </button>}
      </div>
      {!presets.collapsed&&<>
        <div className="mit-preset-list">
          {presets.items.length===0&&<p className="mit-muted">暂无预设，可保存当前提示词。
          </p>}
          {presets.items.map(preset => <div className={`mit-preset-row ${draft.presetId===preset.id? 'is-selected':''}`} key={preset.id}>
            <button type="button" className="mit-preset-name" aria-pressed={draft.presetId===preset.id} onClick={() => store.actions.selectPreset(preset.id)}>
              {preset.name}
            </button>
            {preset.id!=='builtin-totoro'&&<div className="mit-preset-actions">
              <button type="button" className="mit-text-button" onClick={() => store.actions.renamePreset(preset.id)} aria-label={`重命名 ${preset.name}`}>改名</button>
              <button type="button" className="mit-icon-button" onClick={() => store.actions.deletePreset(preset.id)} aria-label={`删除 ${preset.name}`}><Icon name="trash" size={14} /></button>
            </div>}
          </div>)}
        </div>
        <div className="mit-preset-note">切换、覆盖与删除前会确认未保存修改。
        </div>
      </>}
    </aside>
    <div className="mit-editor">
      <div className="mit-section-heading">
        <label htmlFor={`${store.sessionId}-mit-prompt`}>任务提示词
          {draft.dirty&&<span className="mit-muted">· 未保存
          </span>}
        </label>
        <button type="button" className="mit-text-button" onClick={store.actions.savePreset} disabled={!draft.body.trim()}>保存预设
        </button>
      </div>
      <textarea id={`${store.sessionId}-mit-prompt`} className="mit-prompt-input" placeholder="描述任务目标、约束和期望结果…" value={draft.body} onChange={event => store.actions.patchDraft({ body: event.currentTarget.value })} spellCheck={false} />
      <div className="mit-fixed-footer">
        <div className="mit-label-row">
          <strong>固定交付约束
          </strong>
          <span className="mit-muted">自动附加 · 只读
          </span>
        </div>
        <pre>
          {FIXED_FOOTER.trim()}
        </pre>
      </div>
    </div>
    {presets.error&&<p role="alert" className="mit-error mit-editor-error">
      {presets.error}
    </p>}
  </section>;
}
export function DraftView({ store }: {
  store: Workbench;
}) {
  const draft=useStore(store.draft,value => value);
  const custom=useStore(store.custom,value => value.draft);
  const selectedCount=draft.selected.length;
  const targetCount=selectedCount+(draft.kind==='custom'? custom.a6Models.length:0);
  const canSubmit=targetCount>0&&(draft.kind==='fingerprint'||Boolean(draft.body.trim()))&&(draft.kind!=='custom'||!custom.a6Models.length||custom.tokens.length>0)&&!custom.creating;
  return <div className="mit-draft">
    <div className="mit-draft-fields">
      <div className="mit-title-row">
        <div>
          <h2>新建模型测试
          </h2>
          <p className="mit-muted">配置一次，横向观察多个模型。指纹使用真实请求；自定义任务由 Host 隔离会话并记录实际可观测数据。
          </p>
        </div>
        <span className="mit-badge">{draft.kind==='fingerprint'? '真实指纹':'Host 自定义任务'}
        </span>
      </div>
      <label className="mit-field">测试名称
        <input value={draft.name} onChange={event => store.actions.patchDraft({ name: event.currentTarget.value })} placeholder="可选，例如：代码生成对照" maxLength={120} />
      </label>
      <fieldset className="mit-kind-field">
        <legend>测试类型
        </legend>
        <div className="mit-kind-options">
          <label className={`mit-kind ${draft.kind==='fingerprint'? 'is-selected':''}`}>
            <input type="radio" name={`${store.sessionId}-mit-test-kind`} checked={draft.kind==='fingerprint'} onChange={() => store.actions.patchDraft({ kind: 'fingerprint' })} />
            <span>
              <strong>指纹测试
                <InfoTooltip id={`${store.sessionId}-mit-fingerprint-info`} text="由官方 lmfpd-sdk 生成 3 条数字挑战并分析真实响应。同一测试共享挑战；通过后端向每个模型发送 3 次真实付费请求。概率仅在参考库内校准，无校准时显示 RAW 原始排序分数。" />
              </strong>
              <small>每个模型 3 次真实付费请求，展示官方排名、采样与实测指标。
              </small>
            </span>
          </label>
          <label className={`mit-kind ${draft.kind==='custom'? 'is-selected':''}`}>
            <input type="radio" name={`${store.sessionId}-mit-test-kind`} checked={draft.kind==='custom'} onChange={() => store.actions.patchDraft({ kind: 'custom' })} />
            <span>
              <strong>自定义 Agent 测试
                <InfoTooltip id={`${store.sessionId}-mit-custom-info`} text="Host 为每模型创建独立会话与 UUID 工作目录，并只挂载受限文件读写和声明输出工具；这是工具权限隔离，不是操作系统容器。网络、外部工作区与凭据默认不可用；未知数据保持未知。" />
              </strong>
              <small>每模型独立执行，结果与账单状态由 Host 回填。
              </small>
            </span>
          </label>
        </div>
      </fieldset>
      <ModelPicker store={store} />
      {draft.kind==='custom'&&<>
        {custom.a6Models.length>0&&<section className="mit-a6-section" aria-label="a6api 自定义目标">
          <div className="mit-label-row"><h3>a6api 参测渠道</h3><span className="mit-muted">{custom.a6Models.length} 项</span>
            <label className="mit-a6-protocol-batch">接口格式（批量）<select value="" disabled={custom.creating} onChange={event => { if (event.currentTarget.value) store.actions.setCustomProtocol(null, event.currentTarget.value as A6Protocol); }}><option value="">统一设置为…</option>{A6_PROTOCOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
          <div className="mit-a6-channel-list">{custom.a6Models.map(model => <div className="mit-a6-channel-row" key={`${model.channelId}:${model.model}`}>
            <div><strong>{model.model}</strong><span className="mit-muted">{model.supplierName||`供应商 #${model.supplierId}`} · {model.channelName||`渠道 #${model.channelId}`}</span></div>
            <select className="mit-a6-protocol" aria-label={`${model.model} 接口格式`} disabled={custom.creating} value={custom.protocols[`${model.channelId}:${model.model}`]??defaultProtocol(model)} onChange={event => store.actions.setCustomProtocol(`${model.channelId}:${model.model}`, event.currentTarget.value as A6Protocol)}>{A6_PROTOCOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <button type="button" className="mit-icon-button" disabled={custom.creating} aria-label={`移除 ${model.model}`} onClick={() => store.actions.removeCustomA6Model(`${model.channelId}:${model.model}`)}><Icon name="close" size={14} /></button>
          </div>)}</div>
          <strong className="mit-a6-slots-heading">执行令牌</strong>
          <div className="mit-a6-slots">{custom.a6Tokens.map(token => <label className="mit-a6-slot is-inline" key={token.id}><input type="checkbox" checked={custom.tokens.includes(token.id)} disabled={custom.creating} onChange={() => store.actions.toggleCustomToken(token.id)} /><span className="mit-a6-slot-name"><strong>{token.name}</strong><small className="mit-muted">令牌 #{token.id}</small></span></label>)}</div>
          <p className="mit-a6-slot-help">默认只选 1 个令牌执行所选模型；需要并行时再增加令牌。令牌数限制 a6api 同时运行的模型数，不代表模型选择数量。</p>
          {custom.sourceRecordId&&<p className="mit-muted">模型来自已完成的指纹结果；可在此增减执行令牌。</p>}
        </section>}
        <div className="mit-field-row">
          <label className="mit-field">任务并发<input type="number" min={1} max={6} step={1} value={custom.concurrency} disabled={custom.creating} onChange={event => store.actions.patchCustom({ concurrency: Number(event.currentTarget.value) })} /></label>
          <label className="mit-field">单模型最长时长（秒）<input type="number" min={30} max={1800} step={30} value={custom.timeoutMs/1000} disabled={custom.creating} onChange={event => store.actions.patchCustom({ timeoutMs: Number(event.currentTarget.value)*1000 })} /></label>
        </div>
        <div className="mit-info"><strong>执行快照：</strong>{targetCount} 个目标 · DSH {selectedCount} / a6api {custom.a6Models.length} · 并发上限 {custom.concurrency} · 每模型独立 UUID 工作目录（工具权限隔离，非 OS 容器）。只开放受限文件读取、写入与 declareOutput；成果由 Host 校验后开放。
        </div>
      </>}
      {draft.kind==='fingerprint'&&<div className="mit-info"><strong>真实调用授权提示：</strong>开始后将向每个所选模型发送 3 次真实付费请求，共 {selectedCount*3} 次计划请求，按供应商计费；取消前已发出的请求仍可能产生费用。使用官方 lmfpd-sdk 生成共享挑战并分析。校准概率只在参考库内有效，不包含库外模型；无校准时只显示 RAW 分数，不代表身份鉴定或质量排名。实际费用暂不可用。
      </div>}
    </div>
    {draft.kind==='custom'&&<PromptEditor store={store} />}
    <div className="mit-draft-footer">
      {draft.error||custom.error? <p role="alert" className="mit-error">{draft.error||custom.error}</p>:<span className="mit-muted">
        {targetCount? `已选 ${targetCount} 个模型 · 每个模型独立运行`:'先选择参测模型'}
        {draft.kind==='custom'&&!draft.body.trim()? ' · 请填写任务提示词':''}
      </span>}
      <button type="button" className="mit-button mit-primary" disabled={!canSubmit} onClick={store.actions.submit}>
        <Icon name="play" />{custom.creating? '创建并启动中…':draft.kind==='fingerprint'? '开始真实指纹测试':'创建并开始自定义测试'}
      </button>
    </div>
  </div>;
}
