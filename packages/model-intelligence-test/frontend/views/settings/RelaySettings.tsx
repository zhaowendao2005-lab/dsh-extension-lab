import React,{ useEffect, useStore } from '../../runtime';
import type { CredentialState,RelayApi,Workbench } from '../../types';
import { Icon } from '../../components/common';

const FORMAT_LABELS: Record<RelayApi,string> = {
  chat: 'Chat Completions',
  responses: 'Responses',
  messages: 'Messages',
};

function CredentialBadge({ state }: {
  state: CredentialState|undefined;
}) {
  if(!state)
    return <span className="mit-settings-state">未知</span>;
  return <span className={`mit-settings-state ${state.configured? 'is-ok':''}`}>
    {state.configured? '已配置':'未配置'}
    {state.configured&&state.source? ` · ${state.source}`:''}
  </span>;
}

export function RelaySettingsSection({ store }: {
  store: Workbench;
}) {
  const settings=useStore(store.settings,value => value);
  const status=settings.status;
  const busy=settings.busy;
  const actions=store.actions;
  // Load the credential status once the section mounts so the badges never sit on “未知”.
  useEffect(() => { actions.settingsLoad(); },[actions]);
  const formats: RelayApi[]=status?.apis.length? status.apis:['chat','responses','messages'];
  const routes=status?.providers??[];
  const managedCount=routes.reduce((sum,route) => sum+route.models.length,0);
  return <section className="mit-workbench mit-settings" aria-labelledby={`${store.sessionId}-mit-relay-settings`}>
    <header className="mit-settings-head">
      <div>
        <h3 id={`${store.sessionId}-mit-relay-settings`}>中转站凭据 · {settings.siteId||'a6api'}</h3>
        <p className="mit-muted">凭据仅保存在 Host，浏览器只读取配置状态。</p>
      </div>
      <button type="button" className="mit-text-button" disabled={settings.loading} onClick={() => actions.settingsLoad()}>
        <Icon name="refresh" size={14} />
        {settings.loading? '读取中':'刷新'}
      </button>
    </header>

    {settings.error&&<p className="mit-error-box" role="alert">{settings.error}</p>}
    {settings.message&&<p className="mit-settings-message" role="status">{settings.message}</p>}
    {settings.loading&&!status&&<p className="mit-muted">正在读取配置状态…</p>}

    <div className="mit-settings-block">
      <div className="mit-settings-row-head">
        <strong>API Key</strong>
        <CredentialBadge state={status?.apiKey} />
      </div>
      <p className="mit-muted">用于中转渠道指纹测试与加入提供商，按 sk-KEY-&lt;渠道ID&gt; 定向渠道{status?.apiKeyRef? `（${status.apiKeyRef}）`:''}。</p>
      <div className="mit-settings-inline">
        <input type="password" className="mit-settings-input" autoComplete="off" aria-label="API Key" placeholder={status?.apiKey.configured? '已配置，输入新值以替换':'sk-…'} value={settings.drafts.apiKey} disabled={status?.apiKey.writable===false} onChange={event => actions.settingsDraft('apiKey',event.currentTarget.value)} />
        <button type="button" className="mit-button mit-primary" disabled={Boolean(busy)||!settings.drafts.apiKey.trim()} onClick={() => actions.settingsSave()}>
          {busy==='save'? '保存中':'保存'}
        </button>
        <button type="button" className="mit-button" disabled={Boolean(busy)||!status?.apiKey.configured||status.apiKey.writable===false} onClick={() => actions.settingsClear('apiKey')}>
          {busy==='clear'? '清除中':'清除'}
        </button>
      </div>
      {status?.apiKey.writable===false&&<small className="mit-muted">该凭据来自外部配置，不可在此修改。</small>}
    </div>

    <div className="mit-settings-block">
      <div className="mit-settings-row-head">
        <strong>系统访问令牌</strong>
        <CredentialBadge state={status?.accessToken} />
        {status?.verified&&<span className="mit-settings-state is-ok">
          <Icon name="check" size={12} />
          已校验 · {status.verified.displayName||status.verified.username||'未知用户'}
          {status.verified.username&&status.verified.displayName? `（${status.verified.username}）`:''}
        </span>}
      </div>
      <p className="mit-muted">仅用于需要登录的功能（如 SVG 检测），与用户 ID 一起校验。</p>
      <div className="mit-settings-grid">
        <label className="mit-settings-field">
          <span>访问令牌</span>
          <input type="password" className="mit-settings-input" autoComplete="off" placeholder={status?.accessToken.configured? '已配置，输入新值以替换':'系统访问令牌'} value={settings.drafts.accessToken} disabled={status?.accessToken.writable===false} onChange={event => actions.settingsDraft('accessToken',event.currentTarget.value)} />
        </label>
        <label className="mit-settings-field is-narrow">
          <span>用户 ID</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" className="mit-settings-input mit-tabular" placeholder={status?.userId.value??'数字 ID'} value={settings.drafts.userId} onChange={event => actions.settingsDraft('userId',event.currentTarget.value.replace(/\D+/g,''))} />
        </label>
      </div>
      <div className="mit-settings-inline">
        <button type="button" className="mit-button mit-primary" disabled={Boolean(busy)||(!settings.drafts.accessToken.trim()&&!settings.drafts.userId.trim())} onClick={() => actions.settingsSave()}>
          {busy==='save'? '保存中':'保存'}
        </button>
        <button type="button" className="mit-button" disabled={Boolean(busy)||!status?.accessToken.configured} onClick={() => actions.settingsVerify()}>
          {busy==='verify'? '校验中':'校验'}
        </button>
        <button type="button" className="mit-text-button" disabled={Boolean(busy)||!status?.accessToken.configured||status.accessToken.writable===false} onClick={() => actions.settingsClear('accessToken')}>清除令牌
        </button>
        <button type="button" className="mit-text-button" disabled={Boolean(busy)||!status?.userId.configured} onClick={() => actions.settingsClear('userId')}>清除用户 ID
        </button>
      </div>
    </div>

    <div className="mit-settings-block is-managed">
      <div className="mit-settings-row-head">
        <strong>插件管理的提供商</strong>
        <span className="mit-managed-badge">由模型智能测试插件管理</span>
        <span className="mit-muted mit-tabular">{managedCount} 个模型</span>
        <button type="button" className="mit-text-button mit-danger-text mit-settings-push" disabled={Boolean(busy)||!managedCount||settings.confirmClear} onClick={() => actions.settingsRequestClear()}>
          <Icon name="trash" size={14} />
          {busy==='clear'? '清理中':'一键清理'}
        </button>
      </div>
      {settings.confirmClear&&<div className="mit-managed-confirm" role="alertdialog" aria-label="确认清理插件管理的提供商">
        <p>将从 DSH 模型配置中移除本插件写入的全部 a6api 提供商（3 种格式），你自己配置的提供商不受影响。</p>
        <div className="mit-settings-inline">
          <button type="button" className="mit-button mit-danger" disabled={Boolean(busy)} onClick={() => actions.settingsClearProviders()}>清理</button>
          <button type="button" className="mit-button" disabled={Boolean(busy)} onClick={() => actions.settingsCancelClear()}>取消</button>
        </div>
      </div>}
      <p className="mit-muted">从中转渠道加入的模型写入以下 Host 提供商，删除或清理只影响插件创建的条目。若当前运行时的提供商配置由配置补丁或 overlay 提供，插件无法写入，会给出可直接粘贴的配置片段。</p>
      {routes.length? <ul className="mit-managed-routes">
        {routes.map(route => <li key={route.id} className={`mit-managed-route ${route.present? '':'is-absent'}`}>
          <div className="mit-managed-route-head">
            <span className="mit-relay-api">{route.format}</span>
            <strong>{route.label}</strong>
            <span className="mit-muted">{FORMAT_LABELS[route.format]} · {route.api}</span>
            {!route.present&&(route.models.length? <span className="mit-settings-state is-pending">待手动写入</span> : <span className="mit-settings-state">未创建</span>)}
          </div>
          {route.models.length? <ul className="mit-managed-models">
            {route.models.map(model => <li key={`${model.id}#${model.channelId ?? ''}`}>
              <span className="mit-managed-model-id">{model.id}</span>
              {model.name&&model.name!==model.id&&<span className="mit-muted">{model.name}</span>}
              {model.channelId!==undefined&&<span className="mit-muted mit-tabular">#{model.channelId}</span>}
              <button type="button" className={`mit-trait-chip ${model.image? 'is-on':''}`} aria-pressed={Boolean(model.image)} title="图片输入（按模型名推断，可改）" disabled={Boolean(busy)} onClick={() => actions.settingsToggleTrait(route.format,model,'image')}>图片</button>
              <button type="button" className={`mit-trait-chip ${model.reasoning? 'is-on':''}`} aria-pressed={Boolean(model.reasoning)} title="思考等级（按模型名推断，可改）" disabled={Boolean(busy)} onClick={() => actions.settingsToggleTrait(route.format,model,'reasoning')}>思考</button>
              <button type="button" className="mit-text-button" disabled={Boolean(busy)} onClick={() => actions.settingsRemoveModel(route.format,model.id,model.channelId)}>移除
              </button>
            </li>)}
          </ul>:<p className="mit-muted mit-managed-empty">暂无模型</p>}
        </li>)}
      </ul>:<p className="mit-muted">尚未创建插件管理的提供商。</p>}
      <div className="mit-settings-inline mit-managed-add">
        <select className="mit-settings-input is-select" aria-label="接口格式" value={settings.addFormat} onChange={event => actions.settingsAddForm({ format: event.currentTarget.value as RelayApi })}>
          {formats.map(format => <option key={format} value={format}>{format} · {FORMAT_LABELS[format]}</option>)}
        </select>
        <input type="text" className="mit-settings-input" aria-label="模型 ID" placeholder="模型 ID，如 gpt-4o-mini" value={settings.addModel} onChange={event => actions.settingsAddForm({ model: event.currentTarget.value })} />
        <button type="button" className="mit-button" disabled={Boolean(busy)||!settings.addModel.trim()||!status?.apiKey.configured} onClick={() => actions.settingsAddModel()}>
          <Icon name="plus" size={14} />
          {busy==='provider'? '添加中':'添加'}
        </button>
      </div>
      {status&&!status.apiKey.configured&&<small className="mit-muted">需先配置 API Key 才能添加模型。</small>}
      {settings.managedReason&&<div className="mit-managed-notice" role="status">
        <p className="mit-managed-notice-text">{settings.managedReason}</p>
        <textarea className="mit-managed-snippet" readOnly rows={Math.min(14,Math.max(4,settings.managedSnippet.split('\n').length))} value={settings.managedSnippet} aria-label="提供商配置片段" />
        <button type="button" className="mit-button" onClick={() => actions.settingsCopySnippet()}>
          <Icon name="copy" size={14} />
          复制配置片段
        </button>
      </div>}
    </div>
  </section>;
}
