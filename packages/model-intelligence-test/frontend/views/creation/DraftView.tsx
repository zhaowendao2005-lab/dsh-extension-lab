import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { FIXED_FOOTER } from '../../types';
import { ModelPicker } from './ModelPicker';
import { Icon } from '../../components/common';
import { InfoTooltip } from '../../components/InfoTooltip';
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
            <div className="mit-preset-actions">
              <button type="button" className="mit-text-button" onClick={() => store.actions.renamePreset(preset.id)} aria-label={`重命名 ${preset.name}`}>改名
              </button>
              <button type="button" className="mit-icon-button" onClick={() => store.actions.deletePreset(preset.id)} aria-label={`删除 ${preset.name}`}>
                <Icon name="trash" size={14} />
              </button>
            </div>
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
  const canSubmit=draft.selected.length>0&&(draft.kind==='fingerprint'||Boolean(draft.body.trim()));
  return <div className="mit-draft">
    <div className="mit-draft-fields">
      <div className="mit-title-row">
        <div>
          <h2>新建模型测试
          </h2>
          <p className="mit-muted">配置一次，横向观察多个模型。指纹使用真实请求，自定义 Agent 任务仍为 Mock。
          </p>
        </div>
        <span className="mit-badge">{draft.kind==='fingerprint'? '真实指纹':'MOCK'}
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
              <strong>自定义 Agent 测试 · Mock
                <InfoTooltip id={`${store.sessionId}-mit-custom-info`} text="将任务提示词与固定交付约束提交给每个参测模型，逐轮观察步骤、消耗和成果。当前仅为可取消的模拟执行。" />
              </strong>
              <small>使用任务提示词，逐轮观察执行步骤与最终成果。
              </small>
            </span>
          </label>
        </div>
      </fieldset>
      <ModelPicker store={store} />
      {draft.kind==='fingerprint'&&<div className="mit-info"><strong>真实调用授权提示：</strong>开始后将向每个所选模型发送 3 次真实付费请求，共 {draft.selected.length*3} 次计划请求，按供应商计费；取消前已发出的请求仍可能产生费用。使用官方 lmfpd-sdk 生成共享挑战并分析。校准概率只在参考库内有效，不包含库外模型；无校准时只显示 RAW 分数，不代表身份鉴定或质量排名。实际费用暂不可用。
      </div>}
    </div>
    {draft.kind==='custom'&&<PromptEditor store={store} />}
    <div className="mit-draft-footer">
      {draft.error? <p role="alert" className="mit-error">
        {draft.error}
      </p>:<span className="mit-muted">
        {draft.selected.length? `已选 ${draft.selected.length} 个模型 · 每个模型独立运行`:'先选择参测模型'}
        {draft.kind==='custom'&&!draft.body.trim()? ' · 请填写任务提示词':''}
      </span>}
      <button type="button" className="mit-button mit-primary" disabled={!canSubmit} onClick={store.actions.submit}>
        <Icon name="play" />{draft.kind==='fingerprint'? '开始真实指纹测试':'开始模拟测试（Mock）'}
      </button>
    </div>
  </div>;
}
