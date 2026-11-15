import React,{ useStore } from '../../runtime';
import type { Workbench } from '../../types';
import { a6ChannelKey } from '../../stores/a6api.stores';
import { Empty,Icon } from '../../components/common';

/** This page can only open an existing selection delivered by the webpage bridge. */
export function A6SelectionView({store,selectionId}: {store: Workbench; selectionId: string}) {
  const state=useStore(store.a6,value => value);
  const catalog=useStore(store.models,value => value);
  const selection=state.selections.find(item => item.id===selectionId);
  const draft=state.drafts[selectionId];
  if(!selection||!draft) return <Empty title="网页选择已不可用">请回到 a6api 页面勾选渠道并发送新的专项选择。</Empty>;
  const busy=draft.loading||draft.saving||draft.creating;
  const locked=busy||Boolean(draft.pending);
  const count=draft.models.length;
  const slots=draft.slots.length;
  const canSubmit=count>0&&count<=64&&slots>0&&draft.slots.every(slot => Boolean(slot.provider.trim()))&&!locked;
  const target=draft.models.find(row => a6ChannelKey(row)===draft.targetChannel);
  const targetToken=selection.tokens.find(token => token.id===draft.targetTokenId);
  const base=`${store.sessionId}-a6-${selectionId}`;
  return <div className="mit-draft mit-a6-selection">
    <div className="mit-draft-fields">
      <header className="mit-title-row">
        <div><h2>a6api 专项指纹测试</h2><p className="mit-muted">来自 {selection.siteOrigin} · 账号 {selection.accountId} · {new Date(selection.createdAt).toLocaleString('zh-CN')}</p></div>
        <span className="mit-badge">a6api 专项</span>
      </header>
      {state.error&&<p className="mit-error" role="alert">{state.error}</p>}
      {draft.activationError&&<p className="mit-muted" role="status">{draft.activationError}</p>}
      <label className="mit-field">测试名称<input value={draft.name} maxLength={120} disabled={locked} onChange={event => store.actions.patchA6(selectionId,{name: event.currentTarget.value})} /></label>
      <section className="mit-a6-section" aria-labelledby={`${base}-models`}>
        <div className="mit-label-row"><h3 id={`${base}-models`}>网页参测清单</h3><span className="mit-muted">{count} / 64 项</span></div>
        {count>64&&<p className="mit-error" role="alert">清单超过 64 项，请移除多余渠道后开始。</p>}
        <div className="mit-a6-channel-list">{draft.models.map(row => <div className="mit-a6-channel-row" key={a6ChannelKey(row)}>
          <div><strong>{row.model}</strong><span className="mit-muted">{row.supplierName||`供应商 #${row.supplierId}`} · {row.channelName||`渠道 #${row.channelId}`}{row.channelName? ` (#${row.channelId})`:''}{row.brand? ` · ${row.brand}`:''}</span></div>
          <button type="button" className="mit-icon-button" disabled={locked} aria-label={`移除 ${row.model} 渠道 ${row.channelId}`} onClick={() => store.actions.removeA6Model(selectionId,a6ChannelKey(row))}><Icon name="close" size={14} /></button>
        </div>)}</div>
        {!count&&<p className="mit-muted">清单已清空。请从 a6api 网页发送新的选择。</p>}
      </section>
      <section className="mit-a6-section" aria-labelledby={`${base}-slots`}>
        <div className="mit-label-row"><h3 id={`${base}-slots`}>token 与 DSH 提供方映射</h3><button type="button" className="mit-text-button" disabled={catalog.loading||locked} onClick={store.actions.refreshModels}><Icon name="refresh" size={14} />{catalog.loading? '读取中':'刷新提供方'}</button></div>
        <p className="mit-muted">按你在 DSH 中配置的对应关系手动选择；每个启用的 token 是一个并发槽位。这里只读取提供方目录，不读取密钥。</p>
        {catalog.error&&<p className="mit-error" role="alert">{catalog.error}</p>}
        <div className="mit-a6-slots">{selection.tokens.map(token => {
          const slot=draft.slots.find(item => item.tokenId===token.id);
          const provider=catalog.providers.find(item => item.id===slot?.provider);
          const missing=Boolean(slot?.provider&&!provider);
          return <div className="mit-a6-slot" key={token.id}>
            <label className="mit-a6-token"><input type="checkbox" checked={Boolean(slot)} disabled={locked} onChange={() => store.actions.toggleA6Slot(selectionId,token.id)} /><span><strong>{token.name||`token #${token.id}`}</strong><small className="mit-muted">Token ID {token.id}</small></span></label>
            <label className="mit-a6-provider"><span className="mit-muted">对应 DSH 提供方</span><select aria-label={`Token ${token.name||token.id} 对应 DSH 提供方`} value={slot?.provider??''} disabled={!slot||locked} onChange={event => store.actions.setA6Provider(selectionId,token.id,event.currentTarget.value)}>
              <option value="">请手动选择提供方</option>
              {missing&&<option value={slot?.provider}>{slot?.provider}（目录中已失效）</option>}
              {catalog.providers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}{item.error? '（读取异常）':''}</option>)}
            </select>{missing&&<small className="mit-error">已保存的提供方不在当前目录中，请检查手动映射。</small>}{provider?.error&&<small className="mit-error">{provider.error}</small>}</label>
          </div>;
        })}</div>
        {!selection.tokens.length&&<p className="mit-error">这次网页选择没有 token，请回到网页重新选择。</p>}
        <label className="mit-field mit-a6-timeout">单请求最大时长（秒）<input type="number" min={1} step={30} value={draft.timeoutMs===undefined? '':draft.timeoutMs/1000} placeholder="使用 Host 默认时长" disabled={locked} onChange={event => store.actions.patchA6(selectionId,{timeoutMs: event.currentTarget.value===''? undefined:Number(event.currentTarget.value)*1000})} /></label>
        <div className="mit-a6-actions"><button type="button" className="mit-button" disabled={locked} onClick={() => store.actions.loadA6Preferences(selectionId)}>{draft.loading? '读取中…':'重新读取映射'}</button><button type="button" className="mit-button" disabled={locked||!draft.dirty} onClick={() => store.actions.saveA6Preferences(selectionId)}>{draft.saving? '保存中…':'保存映射'}</button><span className="mit-muted">Host profile + 账号保存{draft.dirty? ' · 有未保存修改':''}</span></div>
      </section>
      <section className="mit-a6-section" aria-labelledby={`${base}-actions`}>
        <h3 id={`${base}-actions`}>快速渠道操作</h3>
        <p className="mit-muted">每次操作仅作用于下方明确选择的一个 token 和一个渠道。</p>
        <div className="mit-a6-targets">
          <label className="mit-field">目标 token<select value={draft.targetTokenId??''} disabled={locked} onChange={event => store.actions.patchA6(selectionId,{targetTokenId: event.currentTarget.value===''? undefined:Number(event.currentTarget.value)})}><option value="">选择一个 token</option>{selection.tokens.map(token => <option value={token.id} key={token.id}>{token.name||'token'} (#{token.id})</option>)}</select></label>
          <label className="mit-field">目标渠道<select value={draft.targetChannel??''} disabled={locked} onChange={event => store.actions.patchA6(selectionId,{targetChannel: event.currentTarget.value||undefined})}><option value="">选择一个渠道</option>{draft.models.map(row => <option key={a6ChannelKey(row)} value={a6ChannelKey(row)}>{row.model} · {row.supplierName||row.supplierId} · 渠道 #{row.channelId}</option>)}</select></label>
        </div>
        {target&&targetToken&&<p className="mit-muted">本次目标：{targetToken.name} (#{targetToken.id}) → {target.model} / 渠道 #{target.channelId}</p>}
        <div className="mit-a6-actions">{(['pin','route','restore'] as const).map(operation => <button type="button" className="mit-button" key={operation} disabled={locked||!target||!targetToken} onClick={() => store.actions.a6Action(selectionId,operation)}>{draft.pending===operation? '等待网页确认…':({pin: '快速固定',route: '加入路由',restore: '恢复'})[operation]}</button>)}</div>
        {draft.pending&&<p role="status" className="mit-muted">正在等待 a6api 网页执行并回传结果…</p>}
        {draft.result&&<pre className="mit-a6-operation-result" role="status">{draft.result}</pre>}
      </section>
      <div className="mit-info"><strong>真实请求：</strong>{count} 项 · {slots} 槽 · {count*3} 次计划请求 · 最多 {slots*3} 路并发。同一模型的 3 条挑战同时请求，每个槽位完成一项后领取下一项。实际运行受 Host 全局请求池限制，已发出的请求可能产生费用。指纹概率仅针对参考库内的闭集校准。</div>
    </div>
    <footer className="mit-draft-footer">
      <div aria-live="polite">{draft.error? <p className="mit-error" role="alert">{draft.error}</p>:<p className="mit-muted">{draft.feedback||`${count} 项 · ${slots} 槽 · ${count*3} 请求 · 最多 ${slots*3} 并发`}</p>}</div>
      <button type="button" className="mit-button mit-primary" disabled={!canSubmit} onClick={() => store.actions.submitA6(selectionId)}><Icon name="play" />{draft.creating? '创建并启动中…':'开始专项指纹测试'}</button>
    </footer>
  </div>;
}
